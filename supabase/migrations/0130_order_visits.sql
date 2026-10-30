-- 0130_order_visits (process gaps, item 1): an order can have several engineer visits, not one. EXPAND-ONLY: one new table; no column,
-- constraint or privilege of an existing table is dropped or narrowed.
--
-- Until now the visit lived on the order: orders.commissioning_planned_on (the date), orders.commissioning_done_on (done), orders.visit_type
-- (0101, 0109) and the engineers in order_engineers. A second visit (a survey first, then the installation, then a service call) had nowhere
-- to go. Now each visit is a row of order_visits: a TYPE (installation, survey or service; default installation), a DATE (no time of day, owner
-- answer to Q6), one engineer, a few words of notes, and done on / not done.
--
-- The three orders columns stay, as the SUMMARY of the visits, so the order state views (0016, 0099), Today, the Jobs list and every reader that
-- exists keep working untouched:
--   commissioning_planned_on  the date of the next open visit; with no open visit left, the date of the last one
--   commissioning_done_on     set only when there is at least one visit and every visit is done: the day the last one was done
--   visit_type                the type of that same visit (the next open one, else the last)
-- order_visits_sync (after a visit is added, changed or removed) keeps them true, and writes the order only when a figure would change.
--
-- Old writers keep working too: an update of those three orders columns (the order dialog before this change, the import, e2e fixtures) is
-- mirrored into the order's "main" visit by orders_mirror_visit_fields (the next open visit, else the last), or creates the first visit when the
-- order has none. It acts on a direct write only (pg_trigger_depth() = 1); the sync above writes at depth 2 or more, so the two never loop.
--
-- Existing data: every order that has a planned or a done date becomes one visit (one per assigned engineer when several are assigned, so each
-- of them still has their visit; none assigned = a visit with no engineer). Nothing is lost: orders.commissioning_* and order_engineers are untouched.
--
-- Who (as the orders rule today: every active role reads; an engineer writes only what is theirs):
--   select  admin, sales, engineer
--   insert  admin, sales
--   update  admin, sales; an engineer only on a visit assigned to them (engineer_id = them, or no engineer on the visit and they are on the order
--           in order_engineers). An engineer cannot hand a visit to someone else or move it to another order (guard below).
--   delete  admin, sales
-- No price anywhere on the table. As 0087, 0102 and 0110 do, the grants mirror authenticated's to qtech_engineer (0081's coverage test).

create table public.order_visits (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  visit_type  text not null default 'installation' check (visit_type in ('installation', 'survey', 'service')),
  visit_on    date,
  engineer_id uuid references public.users (id) on delete restrict,
  notes       text check (notes is null or char_length(notes) <= 2000),
  done_on     date,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at  timestamptz not null default now()
);

create index order_visits_order_idx on public.order_visits (order_id);
create index order_visits_engineer_idx on public.order_visits (engineer_id) where engineer_id is not null;
create index order_visits_created_by_idx on public.order_visits (created_by) where created_by is not null;
create index order_visits_open_idx on public.order_visits (visit_on) where done_on is null;

comment on table public.order_visits is
  'An engineer visit to a customer site for an order: type (installation, survey, service), date (no time), engineer, notes, done on. orders.commissioning_planned_on / commissioning_done_on / visit_type are the summary of these rows (0130).';
comment on column public.order_visits.visit_on is 'The day of the visit (Pakistan local date, no time of day). NULL while not planned.';
comment on column public.order_visits.done_on is 'The day the visit was done; NULL = not done yet.';

create trigger order_visits_set_updated_at before update on public.order_visits
  for each row execute function public.set_updated_at();

-- ================================================================ the existing visit of every order becomes a row
insert into public.order_visits (order_id, visit_type, visit_on, engineer_id, done_on, created_at)
select o.id, coalesce(o.visit_type, 'installation'), o.commissioning_planned_on, e.user_id, o.commissioning_done_on, o.created_at
from public.orders o
left join public.order_engineers e on e.order_id = o.id
where o.commissioning_planned_on is not null or o.commissioning_done_on is not null;

-- ================================================================ privileges and row security
alter table public.order_visits enable row level security;

revoke all on table public.order_visits from public, anon, authenticated;
grant select, insert, update, delete on table public.order_visits to authenticated, qtech_engineer;

create policy order_visits_select_staff on public.order_visits for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) is not null);
create policy order_visits_insert_office on public.order_visits for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) in ('admin', 'sales'));
create policy order_visits_update_office on public.order_visits for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'))
  with check ((select public.current_user_role()) in ('admin', 'sales'));
create policy order_visits_update_engineer on public.order_visits for update to authenticated, qtech_engineer
  using (
    (select public.current_user_role()) = 'engineer'
    and (
      engineer_id = (select auth.uid())
      or (engineer_id is null and exists (select 1 from public.order_engineers oe where oe.order_id = order_visits.order_id and oe.user_id = (select auth.uid())))
    )
  )
  with check (
    (select public.current_user_role()) = 'engineer'
    and (
      engineer_id = (select auth.uid())
      or (engineer_id is null and exists (select 1 from public.order_engineers oe where oe.order_id = order_visits.order_id and oe.user_id = (select auth.uid())))
    )
  );
create policy order_visits_delete_office on public.order_visits for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'));

-- ================================================================ an engineer changes the visit, never who it is for or which order it is on
create function public.guard_order_visit_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id is distinct from old.order_id then
    raise exception 'A visit cannot be moved to another order.' using errcode = '42501', hint = 'visit_order_fixed';
  end if;
  if current_user in ('authenticated', 'qtech_engineer') and public.current_user_role() = 'engineer'
     and new.engineer_id is distinct from old.engineer_id then
    raise exception 'Only an admin or sales can change who a visit is for.' using errcode = '42501', hint = 'not_assigned';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_visit_row() from public, anon, authenticated;

create trigger order_visits_guard_row before update on public.order_visits
  for each row execute function public.guard_order_visit_row();

-- ================================================================ the summary on the order
-- The next open visit decides the date and the type; with every visit done, the last one does. Done is "there are visits and none is open".
create function public.order_visit_summary(p_order_id uuid)
returns table (planned_on date, done_on date, visit_type text)
language sql
stable
set search_path = ''
as $$
  with v as (select * from public.order_visits where order_id = p_order_id),
  nxt as (select * from v where v.done_on is null order by v.visit_on asc nulls last, v.created_at asc, v.id limit 1),
  lst as (select * from v order by coalesce(v.done_on, v.visit_on) desc nulls last, v.created_at desc, v.id limit 1)
  select
    case when exists (select 1 from nxt) then (select nxt.visit_on from nxt) else (select lst.visit_on from lst) end,
    case when exists (select 1 from v) and not exists (select 1 from nxt) then (select max(v.done_on) from v) end,
    case when exists (select 1 from nxt) then (select nxt.visit_type from nxt) else (select lst.visit_type from lst) end
$$;

revoke all on function public.order_visit_summary(uuid) from public, anon, authenticated;

create function public.sync_order_visit_summary(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  select * into s from public.order_visit_summary(p_order_id);
  update public.orders o
     set commissioning_planned_on = s.planned_on,
         commissioning_done_on = s.done_on,
         visit_type = s.visit_type
   where o.id = p_order_id
     and (o.commissioning_planned_on, o.commissioning_done_on, o.visit_type) is distinct from (s.planned_on, s.done_on, s.visit_type);
end;
$$;

revoke all on function public.sync_order_visit_summary(uuid) from public, anon, authenticated;

create function public.order_visits_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_order_visit_summary(old.order_id);
    return null;
  end if;
  perform public.sync_order_visit_summary(new.order_id); -- order_id never changes (guard_order_visit_row)
  -- the person a visit is for is on the order's crew (Today and My jobs read order_engineers)
  if new.engineer_id is not null then
    insert into public.order_engineers (order_id, user_id) values (new.order_id, new.engineer_id) on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.order_visits_sync() from public, anon, authenticated;

create trigger order_visits_sync after insert or update or delete on public.order_visits
  for each row execute function public.order_visits_sync();

-- ================================================================ old writers: a direct write of the three orders columns lands in a visit
create function public.orders_mirror_visit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  p public.order_visits%rowtype;
begin
  if pg_trigger_depth() > 1 then
    return null; -- the sync above is writing the summary; nothing to mirror back
  end if;
  select * into s from public.order_visit_summary(new.id);
  if s.planned_on is not distinct from new.commissioning_planned_on
     and s.done_on is not distinct from new.commissioning_done_on
     and (s.visit_type is not distinct from new.visit_type or new.visit_type is null) then
    return null;
  end if;

  select * into p from public.order_visits where order_id = new.id and done_on is null
   order by visit_on asc nulls last, created_at asc, id limit 1;
  if not found then
    select * into p from public.order_visits where order_id = new.id
     order by coalesce(done_on, visit_on) desc nulls last, created_at desc, id limit 1;
  end if;

  if not found then
    if new.commissioning_planned_on is not null or new.commissioning_done_on is not null then
      insert into public.order_visits (order_id, visit_type, visit_on, done_on, created_by)
      values (new.id, coalesce(new.visit_type, 'installation'), new.commissioning_planned_on, new.commissioning_done_on, auth.uid());
    end if;
    return null;
  end if;

  if new.commissioning_planned_on is null and new.commissioning_done_on is null and p.notes is null and p.engineer_id is null then
    delete from public.order_visits where id = p.id; -- an empty visit: the date was cleared and nothing else is on it
  else
    update public.order_visits
       set visit_on = new.commissioning_planned_on,
           done_on = new.commissioning_done_on,
           visit_type = coalesce(new.visit_type, p.visit_type)
     where id = p.id;
  end if;
  return null;
end;
$$;

revoke all on function public.orders_mirror_visit_fields() from public, anon, authenticated;

create trigger orders_mirror_visit_fields after insert or update of commissioning_planned_on, commissioning_done_on, visit_type on public.orders
  for each row execute function public.orders_mirror_visit_fields();

create trigger order_visits_audit after insert or update or delete on public.order_visits
  for each row execute function public.audit_row_change();
