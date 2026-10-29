-- 0109_visit_type_default: a visit has a type and a date, no time. Setting a visit date on an order with no type files it as an installation.
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
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000010901', '0109 Customer');
insert into public.orders (id, company_id, owner_id, created_at) values
  ('a1000000-0000-4000-8000-000000010901', 'c0000000-0000-4000-8000-000000010901', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day'),
  ('a1000000-0000-4000-8000-000000010902', 'c0000000-0000-4000-8000-000000010901', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day'),
  ('a1000000-0000-4000-8000-000000010903', 'c0000000-0000-4000-8000-000000010901', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
insert into public.order_engineers (order_id, user_id) values
  ('a1000000-0000-4000-8000-000000010901', 'a0000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ the default
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010901'), null, 'an order with no visit date has no visit type');
update public.orders set commissioning_planned_on = current_date + 3 where id = 'a1000000-0000-4000-8000-000000010901';
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010901'), 'installation',
  'planning a visit date with no type files it as an installation');
update public.orders set visit_type = 'survey', commissioning_planned_on = current_date + 5 where id = 'a1000000-0000-4000-8000-000000010902';
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010902'), 'survey', 'a type that is given is kept');
update public.orders set visit_type = null where id = 'a1000000-0000-4000-8000-000000010902';
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010902'), 'installation',
  'clearing the type of a planned visit gives it the default again: a planned visit always has a type');
update public.orders set commissioning_planned_on = null, visit_type = null where id = 'a1000000-0000-4000-8000-000000010902';
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010902'), null, 'with the date cleared too, no type is forced');
insert into public.orders (id, company_id, owner_id, commissioning_planned_on) values
  ('a1000000-0000-4000-8000-000000010904', 'c0000000-0000-4000-8000-000000010901', 'a0000000-0000-4000-8000-000000000002', current_date + 2);
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000010904'), 'installation', 'an order created with a visit date gets the default too');
select throws_ok($$update public.orders set visit_type = 'party' where id = 'a1000000-0000-4000-8000-000000010901'$$, '23514', null, 'the three types are still the only ones');

-- ------------------------------------------------------------------ the engineer guard still judges what the engineer changed
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set commissioning_planned_on = current_date + 4 where id = 'a1000000-0000-4000-8000-000000010903' returning visit_type) select coalesce(visit_type, 'none') from u$q$),
  'installation', 'an engineer who sets a date on an order that is not assigned to them is not refused, and the default is filed');
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set visit_type = 'service' where id = 'a1000000-0000-4000-8000-000000010903' returning 1) select count(*)::text from u$q$),
  'E:42501', 'but changing the type of an order that is not theirs is still refused');
select is(pg_temp.as_('engineer', $q$with u as (update public.orders set visit_type = 'service' where id = 'a1000000-0000-4000-8000-000000010901' returning visit_type) select visit_type from u$q$),
  'service', 'and on their own order they may change it');

select * from finish();
rollback;
