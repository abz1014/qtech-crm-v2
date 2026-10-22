-- 0091_misc_expenses (owner request 2026-10-22): record a one-off expense (e.g. "Courier from shop to office") by choosing
-- "Other" and typing a title, without creating a category.
--
--   1. expense_categories.is_misc: the "Other" of a group. One per group (partial unique index).
--   2. Every group gets one: the existing 'Other' (ca7e...0010, in "Bank, taxes and other") is marked, the rest are seeded with
--      fixed ids (ca7e0000-0000-4000-8000-0000000000NN, NN 31 to 35) and take the group's P&L kind. Idempotent: a group that
--      already has a misc category is skipped.
--   3. A guard: a misc category cannot be archived, deleted, merged away or moved to another group.
--   4. A title is required on a misc expense: an INSERT, or an UPDATE that changes category_id or description, with no
--      description under a misc category is refused (23514, HINT title_required). Imported rows that are not touched stay valid.
--      merge_expense_categories / promote_misc_title re-file under the qtech.category_merge flag and are exempt.
--   5. suggest_misc_categories(): titles used 3+ times in 90 days under a misc category. Admin only, SECURITY INVOKER.
--   6. promote_misc_title(misc, title_key, name): re-files the matching expenses to a category (new, or an existing one of the
--      same name and kind), keeping their descriptions. Closed months only through 0086's category_merge allowance (category_id
--      only, one kind). Admin only, SECURITY INVOKER.
-- Nothing here changes a figure: category_id moves inside one kind; pgTAP 0091 proves the report totals.

-- ================================================================ 1. column and index
alter table public.expense_categories add column is_misc boolean not null default false;
comment on column public.expense_categories.is_misc is
  '0091: the "Other" of its group, where one-off expenses are filed under a typed title (expenses.description). One per group; cannot be archived, deleted, merged away or moved.';

-- ================================================================ 2. one Other per group (seed data: the audit log stays empty)
alter table public.expense_categories disable trigger expense_categories_audit;

update public.expense_categories set is_misc = true where id = 'ca7e0000-0000-4000-8000-000000000010';

create unique index expense_categories_one_misc_per_group on public.expense_categories (group_id) where is_misc;

insert into public.expense_categories (id, name, grp, group_id, default_paid_via, sort, is_misc)
select v.id,
       case when exists (select 1 from public.expense_categories c where lower(btrim(c.name)) = lower(btrim(v.name)))
            then v.name || ' (one-off)' else v.name end,
       g.kind, g.id, v.via, v.sort, true
from (values
  ('ca7e0000-0000-4000-8000-000000000031'::uuid, 'ca7e9000-0000-4000-8000-000000000001'::uuid, 'Other (Office running)',  'cash', 28),
  ('ca7e0000-0000-4000-8000-000000000032'::uuid, 'ca7e9000-0000-4000-8000-000000000002'::uuid, 'Other (Vehicles)',        'cash', 48),
  ('ca7e0000-0000-4000-8000-000000000033'::uuid, 'ca7e9000-0000-4000-8000-000000000003'::uuid, 'Other (Staff)',           'cash', 18),
  ('ca7e0000-0000-4000-8000-000000000034'::uuid, 'ca7e9000-0000-4000-8000-000000000005'::uuid, 'Other (Order costs)',     'bank', 128),
  ('ca7e0000-0000-4000-8000-000000000035'::uuid, 'ca7e9000-0000-4000-8000-000000000006'::uuid, 'Other (Owner and loans)', 'bank', 168)
) as v (id, group_id, name, via, sort)
join public.expense_groups g on g.id = v.group_id
where not exists (select 1 from public.expense_categories c where c.group_id = v.group_id and c.is_misc)
  and not exists (select 1 from public.expense_categories c where c.id = v.id);

alter table public.expense_categories enable trigger expense_categories_audit;

-- ================================================================ 3. guard
create function public.expense_categories_misc_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_misc then
      raise exception 'The "Other" category of a group is where one-off expenses go, so it cannot be archived, removed, merged away or moved to another group.'
        using errcode = '23514';
    end if;
    return old;
  end if;
  if old.is_misc
     and (new.is_misc is distinct from old.is_misc
          or (old.active and not new.active)
          or new.group_id is distinct from old.group_id) then
    raise exception 'The "Other" category of a group is where one-off expenses go, so it cannot be archived, removed, merged away or moved to another group.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.expense_categories_misc_guard() from public, anon, authenticated;

-- The 'a' prefix runs it before expense_categories_group, so a refused move is reported with this text.
create trigger a_expense_categories_misc_guard before update or delete on public.expense_categories
  for each row execute function public.expense_categories_misc_guard();

-- ================================================================ 4. a title is required on a misc expense
create function public.expenses_misc_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := (select public.current_user_role());
begin
  if auth.uid() is not null and v_role is distinct from 'admin' then
    return new;   -- row security answers for everyone else
  end if;
  if tg_op = 'INSERT' and (cardinality(new.legacy_flags) > 0 or new.legacy_source is not null) then
    return new;   -- an imported row (0025: legacy rows are exempt)
  end if;
  if tg_op = 'UPDATE'
     and new.category_id is not distinct from old.category_id
     and new.description is not distinct from old.description then
    return new;   -- an imported or older row that is not re-filed or re-titled stays as it is
  end if;
  if coalesce(current_setting('qtech.category_merge', true), '') = 'on' then
    return new;   -- 0086: a merge or promote moves category_id only
  end if;
  if btrim(coalesce(new.description, '')) = ''
     and exists (select 1 from public.expense_categories c where c.id = new.category_id and c.is_misc) then
    raise exception 'Write what it was for, e.g. Courier from shop to office'
      using errcode = '23514', hint = 'title_required';
  end if;
  return new;
end;
$$;

revoke all on function public.expenses_misc_title() from public, anon, authenticated;

-- 'zz' runs it after the month lock and the other expense triggers.
create trigger zz_expenses_misc_title before insert or update on public.expenses
  for each row execute function public.expenses_misc_title();

-- ================================================================ 5. suggestions
-- Titles (description trimmed, lower-cased, inner spaces squeezed: detailKey in the app and v_month_cash_out_detail, 0079) used
-- three or more times in the last 90 days under a misc category. `spent` is gross.
create function public.suggest_misc_categories()
returns table (misc_category_id uuid, title_key text, title text, uses integer, spent numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can turn a one-off title into a category.' using errcode = '42501';
  end if;
  return query
  select e.category_id,
         lower(btrim(regexp_replace(e.description, '\s+', ' ', 'g'))),
         (array_agg(btrim(regexp_replace(e.description, '\s+', ' ', 'g')) order by e.paid_on desc, e.created_at desc))[1],
         count(*)::integer,
         sum(e.amount_pkr)
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id and c.is_misc
  where btrim(coalesce(e.description, '')) <> ''
    and e.paid_on >= public.today_pkt() - 90
  group by e.category_id, lower(btrim(regexp_replace(e.description, '\s+', ' ', 'g')))
  having count(*) >= 3
  order by sum(e.amount_pkr) desc, 3;
end;
$$;

revoke all on function public.suggest_misc_categories() from public, anon, authenticated;
grant execute on function public.suggest_misc_categories() to authenticated, qtech_engineer;   -- 0081: mirrors authenticated; refused inside for anyone but an admin

comment on function public.suggest_misc_categories() is
  '0091: titles used 3 or more times in 90 days under a misc ("Other") category, with count and gross total. Admin only.';

-- ================================================================ 6. promote a title to a category
-- Re-files the expenses of p_misc_category whose title matches p_title_key to a category named p_name: a new one in the same
-- group, or an existing active one of that name and the same kind. Descriptions stay. Returns how many expenses moved.
-- Closed months: only category_id changes, inside one kind, through the qtech.category_merge allowance (0086).
create function public.promote_misc_title(p_misc_category uuid, p_title_key text, p_name text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_misc  public.expense_categories;
  v_key   text := lower(btrim(regexp_replace(coalesce(p_title_key, ''), '\s+', ' ', 'g')));
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_to    public.expense_categories;
  v_moved integer;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can turn a one-off title into a category.' using errcode = '42501';
  end if;
  select * into v_misc from public.expense_categories c where c.id = p_misc_category for update;
  if v_misc.id is null then
    raise exception 'One of these categories is no longer there. Reload the page, then try again.' using errcode = 'P0002';
  end if;
  if not v_misc.is_misc then
    raise exception 'Only the Other category of a group has one-off titles to promote.' using errcode = '23514';
  end if;
  if v_key = '' then
    raise exception 'Choose which title to turn into a category.' using errcode = '23514';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the new category a name.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.expenses e where e.category_id = v_misc.id
                   and lower(btrim(regexp_replace(coalesce(e.description, ''), '\s+', ' ', 'g'))) = v_key) then
    raise exception 'No expense under "%" has that title any more. Reload the page, then try again.', v_misc.name using errcode = 'P0002';
  end if;

  select * into v_to from public.expense_categories c where lower(btrim(c.name)) = lower(v_name) for update;
  if v_to.id is not null then
    if v_to.is_misc then
      raise exception '"%" is the Other category of a group. Choose a different name for the new category.', v_to.name using errcode = '23514';
    end if;
    if v_to.grp <> v_misc.grp then
      raise exception '"%" is a category of another kind, so these expenses cannot move there without changing the profit. Choose a different name.', v_to.name
        using errcode = '23514';
    end if;
    if not v_to.active then
      raise exception '"%" is archived. Bring it back first, or choose a different name.', v_to.name using errcode = '23514';
    end if;
  else
    insert into public.expense_categories (name, grp, group_id, default_paid_via, sort)
    values (v_name, v_misc.grp, v_misc.group_id, v_misc.default_paid_via, v_misc.sort - 1)
    returning * into v_to;
  end if;

  perform set_config('qtech.category_merge', 'on', true);
  update public.expenses e set category_id = v_to.id
  where e.category_id = v_misc.id
    and lower(btrim(regexp_replace(coalesce(e.description, ''), '\s+', ' ', 'g'))) = v_key;
  get diagnostics v_moved = row_count;
  perform set_config('qtech.category_merge', 'off', true);
  return v_moved;
end;
$$;

revoke all on function public.promote_misc_title(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promote_misc_title(uuid, text, text) to authenticated, qtech_engineer;   -- 0081: mirrors authenticated; refused inside for anyone but an admin

comment on function public.promote_misc_title(uuid, text, text) is
  '0091: re-files the expenses of a misc category that carry one title to a (new or existing, same kind) category, keeping descriptions. Closed months keep every figure (only category_id changes). Admin only.';
