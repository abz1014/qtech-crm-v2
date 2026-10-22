-- 0086_expense_book (owner request 2026-10-22: "expense category, expense keeping and expense report are utmost priority").
-- Admin only, like every expense table (DECISIONS 2026-10-13). Nothing here changes a figure: totals by month, by P&L kind
-- (overhead / order cost / not in P&L) and by payment method stay exactly what they were; pgTAP 0086 proves it.
--
--   A. expense_groups: the first level of the two-level list (group -> category), e.g. "Office running" -> Water, Electricity.
--      A group carries the P&L kind; every category in it takes that kind (expense_categories.grp is kept and synced, so every
--      report, view and snapshot that reads grp is unchanged). Six groups are seeded with fixed ids; every existing category is
--      filed under one (the 0025 seed by id, any other by its kind).
--   B. expense_categories.group_id (NOT NULL, RESTRICT) and monthly_budget_pkr (optional, > 0). A BEFORE trigger keeps grp equal
--      to the group's kind. Moving a category to a group of another kind is refused while it has expenses in a closed month (a
--      closed month's profit must not change); the kind of a group that holds categories cannot change.
--   C. Default categories a Pakistani small business uses (Water, Electricity, Internet and phone, Vehicle repairs, Token tax,
--      Staff meals, Customs duty), added only where no category of that name exists, so nothing the owner made is touched.
--   D. recurring_expenses.paid_via (optional): how a monthly expense is usually paid, so "Record all" needs no question.
--   E. merge_expense_categories(from, into): moves every expense and recurring template of one category into another, then
--      removes the emptied category. It may re-file expenses in a closed month (only their category changes: amounts, dates and
--      kinds stay, so every closed figure stays), which the month lock allows for this one function and nothing else.

-- ================================================================ A. expense_groups
create table public.expense_groups (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- overhead and order_cost are in the P&L; non_pnl (drawings, loan principal) is shown below the result.
  kind        text not null check (kind in ('overhead', 'order_cost', 'non_pnl')),
  sort        smallint not null default 0
);

comment on table public.expense_groups is
  '0086: the first level of the expense list (group -> category). The kind is the P&L place of every category in the group. Admin only.';

create unique index expense_groups_name_key on public.expense_groups (lower(btrim(name)));

-- Fixed ids: ca7e9000-0000-4000-8000-0000000000NN.
insert into public.expense_groups (id, name, kind, sort) values
  ('ca7e9000-0000-4000-8000-000000000001', 'Office running',         'overhead',   10),
  ('ca7e9000-0000-4000-8000-000000000002', 'Vehicles',               'overhead',   20),
  ('ca7e9000-0000-4000-8000-000000000003', 'Staff',                  'overhead',   30),
  ('ca7e9000-0000-4000-8000-000000000004', 'Bank, taxes and other',  'overhead',   40),
  ('ca7e9000-0000-4000-8000-000000000005', 'Order costs',            'order_cost', 50),
  ('ca7e9000-0000-4000-8000-000000000006', 'Owner and loans',        'non_pnl',    60);

alter table public.expense_groups enable row level security;

revoke all on table public.expense_groups from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_groups to authenticated, qtech_engineer;   -- 0081: the engineer's API role mirrors authenticated (the policies still give them nothing)

create policy expense_groups_select_admin on public.expense_groups for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy expense_groups_insert_admin on public.expense_groups for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');
create policy expense_groups_update_admin on public.expense_groups for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy expense_groups_delete_admin on public.expense_groups for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');

-- ================================================================ B. categories: group and budget
-- The backfill and the default categories are seed data, not a person's edit: the audit log stays empty (as in 0025).
alter table public.expense_categories disable trigger expense_categories_audit;

alter table public.expense_categories
  add column group_id uuid references public.expense_groups (id) on delete restrict,
  add column monthly_budget_pkr numeric(14,2) check (monthly_budget_pkr > 0);

update public.expense_categories c
set group_id = case c.id
  when 'ca7e0000-0000-4000-8000-000000000001' then 'ca7e9000-0000-4000-8000-000000000003'::uuid   -- Salaries
  when 'ca7e0000-0000-4000-8000-000000000002' then 'ca7e9000-0000-4000-8000-000000000001'::uuid   -- Rent
  when 'ca7e0000-0000-4000-8000-000000000003' then 'ca7e9000-0000-4000-8000-000000000001'::uuid   -- Utilities
  when 'ca7e0000-0000-4000-8000-000000000004' then 'ca7e9000-0000-4000-8000-000000000002'::uuid   -- Fuel & travel
  when 'ca7e0000-0000-4000-8000-000000000005' then 'ca7e9000-0000-4000-8000-000000000001'::uuid   -- Office supplies & snacks
  when 'ca7e0000-0000-4000-8000-000000000006' then 'ca7e9000-0000-4000-8000-000000000001'::uuid   -- Courier & postage
  when 'ca7e0000-0000-4000-8000-000000000007' then 'ca7e9000-0000-4000-8000-000000000001'::uuid   -- Repairs & maintenance
  when 'ca7e0000-0000-4000-8000-000000000008' then 'ca7e9000-0000-4000-8000-000000000004'::uuid   -- Bank charges
  when 'ca7e0000-0000-4000-8000-000000000009' then 'ca7e9000-0000-4000-8000-000000000004'::uuid   -- Taxes & fees
  when 'ca7e0000-0000-4000-8000-000000000010' then 'ca7e9000-0000-4000-8000-000000000004'::uuid   -- Other
  else case c.grp
    when 'order_cost' then 'ca7e9000-0000-4000-8000-000000000005'::uuid
    when 'non_pnl'    then 'ca7e9000-0000-4000-8000-000000000006'::uuid
    else                   'ca7e9000-0000-4000-8000-000000000001'::uuid
  end
end;
-- The seed ids above all sit in a group of their own kind; a category whose kind was changed in Settings is filed by its kind.
update public.expense_categories c
set group_id = case c.grp
  when 'order_cost' then 'ca7e9000-0000-4000-8000-000000000005'::uuid
  when 'non_pnl'    then 'ca7e9000-0000-4000-8000-000000000006'::uuid
  else                   'ca7e9000-0000-4000-8000-000000000001'::uuid
end
where c.grp <> (select g.kind from public.expense_groups g where g.id = c.group_id);

alter table public.expense_categories alter column group_id set not null;
create index expense_categories_group_idx on public.expense_categories (group_id);

comment on column public.expense_categories.group_id is '0086: the group the category is listed under; grp follows the group''s kind.';
comment on column public.expense_categories.monthly_budget_pkr is '0086: optional monthly budget (gross paid), shown against what was spent. NULL = no budget.';

-- grp follows the group. A category given no group (an older client sending only grp) goes to the first group of its kind; a
-- grp changed without a group change moves it to the first group of the new kind.
create function public.expense_categories_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_group  uuid;
  v_closed date;
begin
  if new.group_id is null
     or (tg_op = 'UPDATE' and new.grp is distinct from old.grp and new.group_id is not distinct from old.group_id) then
    select g.id into v_group from public.expense_groups g where g.kind = new.grp order by g.sort, g.name limit 1;
    if v_group is null then
      raise exception 'There is no expense group for this kind of expense. Add a group first.' using errcode = '23514';
    end if;
    new.group_id := v_group;
  end if;

  select g.kind into v_kind from public.expense_groups g where g.id = new.group_id;
  if v_kind is null then
    return new;   -- the foreign key answers
  end if;
  new.grp := v_kind;

  if tg_op = 'UPDATE' and new.grp is distinct from old.grp then
    select min(date_trunc('month', e.paid_on)::date) into v_closed
    from public.expenses e
    where e.category_id = old.id and public.month_is_closed(e.paid_on);
    if v_closed is not null then
      raise exception '"%" has expenses in % and that month is closed. Moving it to a group of another kind would change that month''s profit. Pick a group of the same kind, or reopen the month first.',
        old.name, to_char(v_closed, 'FMMonth YYYY') using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.expense_categories_group() from public, anon, authenticated;

create trigger expense_categories_group before insert or update on public.expense_categories
  for each row execute function public.expense_categories_group();

-- A group's kind is fixed once a category is filed under it.
create function public.expense_groups_kind_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     and exists (select 1 from public.expense_categories c where c.group_id = old.id) then
    raise exception 'The group "%" has categories, so its kind cannot change. Move its categories to another group first.', old.name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.expense_groups_kind_lock() from public, anon, authenticated;

create trigger expense_groups_kind_lock before update on public.expense_groups
  for each row execute function public.expense_groups_kind_lock();

-- 0065 L-1: created_by is always the caller.
create trigger expense_groups_force_created_by before insert or update on public.expense_groups
  for each row execute function public.force_created_by();

-- Attached after the seed, like expense_categories_audit (0025): the log stays empty until a person edits a group.
create trigger expense_groups_audit after insert or update or delete on public.expense_groups
  for each row execute function public.audit_row_change();

-- ================================================================ C. default categories (only names that do not exist yet)
insert into public.expense_categories (id, name, grp, group_id, default_paid_via, sort)
select v.id, v.name, g.kind, v.group_id, v.via, v.sort
from (values
  ('ca7e0000-0000-4000-8000-000000000018'::uuid, 'Water',             'ca7e9000-0000-4000-8000-000000000001'::uuid, 'cash', 22),
  ('ca7e0000-0000-4000-8000-000000000019'::uuid, 'Electricity',       'ca7e9000-0000-4000-8000-000000000001'::uuid, 'bank', 24),
  ('ca7e0000-0000-4000-8000-000000000020'::uuid, 'Internet and phone','ca7e9000-0000-4000-8000-000000000001'::uuid, 'bank', 26),
  ('ca7e0000-0000-4000-8000-000000000021'::uuid, 'Vehicle repairs',   'ca7e9000-0000-4000-8000-000000000002'::uuid, 'cash', 42),
  ('ca7e0000-0000-4000-8000-000000000022'::uuid, 'Token tax',         'ca7e9000-0000-4000-8000-000000000002'::uuid, 'bank', 44),
  ('ca7e0000-0000-4000-8000-000000000023'::uuid, 'Staff meals',       'ca7e9000-0000-4000-8000-000000000003'::uuid, 'cash', 12),
  ('ca7e0000-0000-4000-8000-000000000024'::uuid, 'Customs duty',      'ca7e9000-0000-4000-8000-000000000005'::uuid, 'bank', 125)
) as v (id, name, group_id, via, sort)
join public.expense_groups g on g.id = v.group_id
where not exists (select 1 from public.expense_categories c where c.id = v.id or lower(btrim(c.name)) = lower(btrim(v.name)));

alter table public.expense_categories enable trigger expense_categories_audit;

-- ================================================================ D. recurring_expenses.paid_via
alter table public.recurring_expenses
  add column paid_via text check (paid_via in ('bank', 'cash'));
comment on column public.recurring_expenses.paid_via is '0086: how this monthly expense is usually paid; NULL = the category''s own default.';

-- ================================================================ E. merge, and the month lock's one exception
-- The month lock (0027) lets a closed month's expense change its category only inside merge_expense_categories, which sets
-- the transaction-local flag below; amounts, dates, tags and everything else stay locked, and the kinds of the two categories
-- must agree (checked in the function), so no closed figure moves.
create or replace function public.enforce_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
  v_new date;
  v_touched boolean;
  v_month date;
begin
  if tg_table_name = 'payments_in' then
    if tg_op <> 'INSERT' then v_old := old.received_on; end if;
    if tg_op <> 'DELETE' then v_new := new.received_on; end if;
  elsif tg_table_name = 'expenses' then
    if tg_op <> 'INSERT' then v_old := old.paid_on; end if;
    if tg_op <> 'DELETE' then v_new := new.paid_on; end if;
  else  -- invoices
    if tg_op <> 'INSERT' then v_old := old.invoice_date; end if;
    if tg_op <> 'DELETE' then v_new := new.invoice_date; end if;
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'invoices' then
      v_touched := (new.number, new.invoice_date, new.net_amount, new.gst_amount, new.order_id, new.company_id)
        is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount, old.order_id, old.company_id);
    elsif tg_table_name = 'expenses' and coalesce(current_setting('qtech.category_merge', true), '') = 'on' then
      -- 0086: inside merge_expense_categories only the category may change
      v_touched := (to_jsonb(new) - 'bank_month' - 'category_id') is distinct from (to_jsonb(old) - 'bank_month' - 'category_id');
    else
      v_touched := (to_jsonb(new) - 'bank_month') is distinct from (to_jsonb(old) - 'bank_month');
    end if;
    if not v_touched then
      return new;
    end if;
  end if;

  if public.month_is_closed(v_old) then
    v_month := date_trunc('month', v_old)::date;
  elsif public.month_is_closed(v_new) then
    v_month := date_trunc('month', v_new)::date;
  end if;
  if v_month is not null then
    raise exception '% is closed. An admin can reopen it.', to_char(v_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_month_lock() from public, anon, authenticated;

-- Moves every expense and recurring template of p_from into p_into, then deletes p_from. Returns how many expenses moved.
-- Admin only (42501). Refused (23514) when the two are the same, when p_into is archived, and when their kinds differ while
-- p_from has an expense in a closed month. SECURITY INVOKER: the caller's own row security applies to every read and write.
create function public.merge_expense_categories(p_from uuid, p_into uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_from   public.expense_categories;
  v_into   public.expense_categories;
  v_closed date;
  v_moved  integer;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can merge categories.' using errcode = '42501';
  end if;
  select * into v_from from public.expense_categories c where c.id = p_from for update;
  select * into v_into from public.expense_categories c where c.id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'One of these categories is no longer there. Reload the page, then try again.' using errcode = 'P0002';
  end if;
  if v_from.id = v_into.id then
    raise exception 'Pick two different categories to merge.' using errcode = '23514';
  end if;
  if not v_into.active then
    raise exception '"%" is archived. Bring it back first, or merge into another category.', v_into.name using errcode = '23514';
  end if;
  if v_from.grp <> v_into.grp then
    select min(date_trunc('month', e.paid_on)::date) into v_closed
    from public.expenses e where e.category_id = v_from.id and exists (select 1 from public.closed_months m where m.month = date_trunc('month', e.paid_on)::date);   -- invoker: the admin reads closed_months
    if v_closed is not null then
      raise exception '"%" has expenses in % and that month is closed. Merging it into a category of another kind would change that month''s profit. Pick a category of the same kind, or reopen the month first.',
        v_from.name, to_char(v_closed, 'FMMonth YYYY') using errcode = '23514';
    end if;
  end if;

  perform set_config('qtech.category_merge', 'on', true);
  update public.expenses e set category_id = v_into.id where e.category_id = v_from.id;
  get diagnostics v_moved = row_count;
  perform set_config('qtech.category_merge', 'off', true);
  update public.recurring_expenses r set category_id = v_into.id where r.category_id = v_from.id;
  delete from public.expense_categories c where c.id = v_from.id;
  return v_moved;
end;
$$;

revoke all on function public.merge_expense_categories(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_expense_categories(uuid, uuid) to authenticated, qtech_engineer;   -- 0081: mirrors authenticated; refused inside for anyone but an admin

comment on function public.merge_expense_categories(uuid, uuid) is
  '0086: moves every expense and recurring template of one category into another and removes the first. Admin only. Closed months keep every figure (only the category of their expenses changes, and only between categories of the same kind).';
