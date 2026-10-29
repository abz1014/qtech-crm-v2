-- 0109_visit_type_default (owner answer to Q6, 2026-10-28): a visit has a TYPE (installation, survey or service) and a DATE.
-- It has no time of day. EXPAND-ONLY: no column, constraint or privilege is dropped or narrowed.
--
--   * orders.visit_type (0101) is now always set once a visit date is: a trigger fills 'installation' when an order is given a
--     commissioning_planned_on and no type (the order's commissioning is an installation unless somebody says survey or service).
--     It runs AFTER 0101's engineer guard (triggers fire by name), so the guard still judges what the engineer actually changed.
--   * Open visits that already have a date and no type are given 'installation' once, here.
--   * orders.commissioning_time (0101) stays in the table so nothing that reads it breaks and no data is lost, but nothing writes or
--     shows it any more. The application no longer reads it. A later migration may drop it once the owner agrees.

comment on column public.orders.commissioning_time is
  'Retired (owner answer to Q6, 2026-10-28: a visit has a date only, no time of day). Kept so old rows and old readers do not break; the app neither writes nor shows it.';
comment on column public.orders.visit_type is
  'Kind of visit: installation, survey or service (owner answer to Q6). Filled with installation when a visit date is set and no type is given.';

create function public.default_order_visit_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.commissioning_planned_on is not null and new.visit_type is null then
    new.visit_type := 'installation';
  end if;
  return new;
end;
$$;

revoke all on function public.default_order_visit_type() from public, anon, authenticated;

-- named so it fires after orders_guard_visit_fields (0101): BEFORE triggers run in name order
create trigger orders_set_default_visit_type before insert or update on public.orders
  for each row execute function public.default_order_visit_type();

update public.orders
   set visit_type = 'installation'
 where commissioning_planned_on is not null
   and visit_type is null
   and commissioning_done_on is null
   and cancelled_on is null;
