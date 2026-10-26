-- 0101_engineer_visits (redesign L5, plan (j2)): the engineer's home shows the day's sites as "10:00 · Install". That needs a
-- time and a kind for the visit. EXPAND-ONLY: two nullable columns on orders. Nothing here depends on 0093-0095.
--
--   orders.commissioning_time  the time of the visit on commissioning_planned_on (nullable, no default; a plain time, Pakistan
--                              local like the date beside it)
--   orders.visit_type          'installation' | 'survey' | 'service' (nullable). Owner-question default (Q6): these three. The
--                              list is a CHECK constraint, so it is extended later by replacing the constraint (an expand).
--
-- Privileges: orders carries no money column, and the orders grants are table-level for authenticated and (0081) for
-- qtech_engineer, so a new column is granted to both automatically, exactly as commissioning_planned_on was. The engineer's
-- price columns live on other tables and stay refused. What the existing row security does not say is WHICH orders an
-- engineer may write: it lets any active role update any order. The engineer's home writes these two columns only on the
-- sites assigned to them (order_engineers), so a guard says so. Admin and sales are untouched by it.

alter table public.orders
  add column commissioning_time time,
  add column visit_type text;

alter table public.orders
  add constraint orders_visit_type_check check (visit_type in ('installation', 'survey', 'service'));

comment on column public.orders.commissioning_time is
  'Time of the commissioning or site visit on commissioning_planned_on (engineer home: "10:00 - Install"). NULL when not set.';
comment on column public.orders.visit_type is
  'Kind of visit: installation, survey or service (owner question Q6 default; extend by replacing the check). NULL when not set.';

-- ================================================================ an engineer sets them only on an order assigned to them
-- An engineer's request runs as qtech_engineer (0081), a person with the engineer role in a 'authenticated' transaction runs as
-- authenticated; both are checked. Postgres roles used by migrations, the import and the service role are not (current_user).
create function public.guard_order_visit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'qtech_engineer') or public.current_user_role() is distinct from 'engineer' then
    return new;
  end if;
  if (new.commissioning_time is distinct from old.commissioning_time or new.visit_type is distinct from old.visit_type)
     and not exists (select 1 from public.order_engineers oe where oe.order_id = new.id and oe.user_id = auth.uid()) then
    raise exception 'Only an engineer assigned to this order can set its visit time or type.' using errcode = '42501', hint = 'not_assigned';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_visit_fields() from public, anon, authenticated;

create trigger orders_guard_visit_fields before update on public.orders
  for each row execute function public.guard_order_visit_fields();
