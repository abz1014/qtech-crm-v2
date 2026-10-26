-- 0101_engineer_visits: orders.commissioning_time and orders.visit_type. An engineer sets them only on an order assigned to them
-- (order_engineers), cannot touch a price, and admin and sales are unchanged.
begin;
select * from no_plan();

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000010101', '0101 Customer');
-- created yesterday: 0065's guard lets an engineer write a price only in the transaction that creates the order
insert into public.orders (id, company_id, owner_id, created_at) values
  ('a1000000-0000-4000-8000-000000010101', 'c0000000-0000-4000-8000-000000010101', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day'),
  ('a1000000-0000-4000-8000-000000010102', 'c0000000-0000-4000-8000-000000010101', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, gst_rate) values
  ('a3000000-0000-4000-8000-000000010101', 'a1000000-0000-4000-8000-000000010101', 0, '0101 line', 1, 'ea', 5000, 18);
-- the engineer is assigned to the first order only
insert into public.order_engineers (order_id, user_id) values
  ('a1000000-0000-4000-8000-000000010101', 'a0000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ the columns
select is((select commissioning_time is null and visit_type is null from public.orders where id = 'a1000000-0000-4000-8000-000000010101'), true,
          'both columns start empty');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'commissioning_time'),
          'time without time zone', 'commissioning_time is a time');
select throws_ok($$update public.orders set visit_type = 'party' where id = 'a1000000-0000-4000-8000-000000010101'$$, '23514', null,
                 'visit_type accepts only installation, survey or service');
select lives_ok($$update public.orders set visit_type = 'installation' where id = 'a1000000-0000-4000-8000-000000010101'$$, 'installation is accepted');
select lives_ok($$update public.orders set visit_type = 'service' where id = 'a1000000-0000-4000-8000-000000010101'$$, 'service is accepted');
select lives_ok($$update public.orders set visit_type = null where id = 'a1000000-0000-4000-8000-000000010101'$$, 'and it can be cleared');

-- ------------------------------------------------------------------ an engineer on an assigned order
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set commissioning_time = '10:00', visit_type = 'survey' where id = 'a1000000-0000-4000-8000-000000010101' returning 1) select count(*)::text from u$q$),
  '1', 'an engineer sets the visit time and type on an order assigned to them');
select is((select commissioning_time::text || '|' || visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010101'), '10:00:00|survey', 'and they are stored');
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set notes = 'engineer note' where id = 'a1000000-0000-4000-8000-000000010101' returning 1) select count(*)::text from u$q$),
  '1', 'other writes on the assigned order are as before');

-- ------------------------------------------------------------------ an engineer on someone else's order
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set commissioning_time = '11:00' where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  'E:42501', 'an engineer cannot set the visit time on an order that is not assigned to them');
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set visit_type = 'service' where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  'E:42501', 'nor the visit type');
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set commissioning_time = commissioning_time, visit_type = visit_type where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  '1', 'a write that leaves both unchanged is not refused');
select is((select commissioning_time is null and visit_type is null from public.orders where id = 'a1000000-0000-4000-8000-000000010102'), true, 'the other order is untouched');

-- ------------------------------------------------------------------ no money
select is(pg_temp.as_('engineer', $q$with u as (update public.order_items set unit_price_net = 1 where id = 'a3000000-0000-4000-8000-000000010101' returning 1) select count(*)::text from u$q$),
  'E:42501', 'an engineer still cannot change a price on their assigned order');
select is(pg_temp.as_('engineer', $q$select unit_price_net::text from public.order_items where id = 'a3000000-0000-4000-8000-000000010101'$q$),
  'E:42501', 'nor read one');

-- ------------------------------------------------------------------ admin and sales are unchanged
select is(pg_temp.as_('admin', $q$with u as (update public.orders set commissioning_time = '09:30', visit_type = 'installation' where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  '1', 'the admin sets them on any order');
select is(pg_temp.as_('sales', $q$with u as (update public.orders set commissioning_time = '14:00', visit_type = 'service' where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  '1', 'sales set them on any order');
select is(pg_temp.as_('deactivated', $q$with u as (update public.orders set visit_type = 'survey' where id = 'a1000000-0000-4000-8000-000000010102' returning 1) select count(*)::text from u$q$),
  '0', 'a deactivated person sets nothing');
select is((select commissioning_time::text || '|' || visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010102'), '14:00:00|service', 'the last allowed write stands');

-- ------------------------------------------------------------------ the guard is not callable
select is(pg_temp.as_('sales', 'select public.guard_order_visit_fields()::text'), 'E:42501', 'nobody can call the guard function');

select * from finish();
rollback;
