-- 0130_order_visits: several visits per order. The orders columns commissioning_planned_on / commissioning_done_on / visit_type are the summary
-- of the visits; an old-style write of those columns lands in a visit; who may read and write a visit; the existing visit becomes a row.
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
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000013001', '0130 Customer');
insert into public.orders (id, company_id, owner_id, created_at)
select ('a1000000-0000-4000-8000-0000000130' || n)::uuid, 'c0000000-0000-4000-8000-000000013001', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day'
from unnest(array['01', '02', '03', '04', '05', '06']) n;
-- order 03 is the engineer's (assigned)
insert into public.order_engineers (order_id, user_id) values ('a1000000-0000-4000-8000-000000013003', 'a0000000-0000-4000-8000-000000000003');

-- ------------------------------------------------------------------ an old-style write lands in a visit
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), 0, 'an order with no visit date has no visit');
update public.orders set commissioning_planned_on = current_date + 3 where id = 'a1000000-0000-4000-8000-000000013001';
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), 1, 'planning a date creates the first visit');
select is((select visit_type from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), 'installation', 'a visit is an installation unless it says otherwise');
select is((select visit_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), current_date + 3, 'on the planned date');
update public.orders set commissioning_planned_on = current_date + 6 where id = 'a1000000-0000-4000-8000-000000013001';
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), 1, 'moving the date moves that visit, it does not add one');
update public.orders set commissioning_done_on = current_date where id = 'a1000000-0000-4000-8000-000000013001';
select is((select done_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001'), current_date, 'marking the order done marks the visit done');
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), current_date, 'and the order is done');

-- ------------------------------------------------------------------ a second visit
insert into public.order_visits (id, order_id, visit_type, visit_on, notes) values
  ('b1000000-0000-4000-8000-000000013001', 'a1000000-0000-4000-8000-000000013001', 'service', current_date + 10, 'Return for the service call');
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), null, 'a new open visit means the order is not done any more');
select is((select commissioning_planned_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), current_date + 10, 'the order shows the date of the next open visit');
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), 'service', 'and its type');
update public.order_visits set done_on = current_date + 10 where id = 'b1000000-0000-4000-8000-000000013001';
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), current_date + 10, 'with every visit done, the order is done on the day of the last');
select is((select commissioning_planned_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), current_date + 10, 'and shows the date of the last visit');
delete from public.order_visits where id = 'b1000000-0000-4000-8000-000000013001';
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), current_date, 'deleting the later visit brings the summary back to the first');
select is((select visit_type from public.orders where id = 'a1000000-0000-4000-8000-000000013001'), 'installation', 'and its type');
delete from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013001';
select is((select commissioning_planned_on is null and commissioning_done_on is null and visit_type is null from public.orders where id = 'a1000000-0000-4000-8000-000000013001'),
  true, 'with no visit left the order shows none');

-- two visits: the next open one is what the old one-tap actions touch
insert into public.order_visits (order_id, visit_type, visit_on, done_on) values
  ('a1000000-0000-4000-8000-000000013002', 'survey', current_date - 5, current_date - 5),
  ('a1000000-0000-4000-8000-000000013002', 'installation', current_date + 7, null);
select is((select commissioning_planned_on from public.orders where id = 'a1000000-0000-4000-8000-000000013002'), current_date + 7, 'a done survey and an open installation: the order is planned for the installation');
update public.orders set commissioning_planned_on = current_date + 8 where id = 'a1000000-0000-4000-8000-000000013002';
select is((select visit_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013002' and visit_type = 'installation'), current_date + 8, 'changing the planned date moves the next open visit');
select is((select visit_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013002' and visit_type = 'survey'), current_date - 5, 'and leaves the done one alone');
update public.orders set commissioning_done_on = current_date where id = 'a1000000-0000-4000-8000-000000013002';
select is((select done_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013002' and visit_type = 'installation'), current_date, 'marking done marks the next open visit');
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013002'), current_date, 'and now every visit is done');

-- clearing the only date of an empty visit removes the visit
update public.orders set commissioning_planned_on = current_date + 1 where id = 'a1000000-0000-4000-8000-000000013004';
update public.orders set commissioning_planned_on = null where id = 'a1000000-0000-4000-8000-000000013004';
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013004'), 0, 'clearing the date of a visit with nothing else on it removes it');
-- ... but a visit with notes is kept
update public.orders set commissioning_planned_on = current_date + 1 where id = 'a1000000-0000-4000-8000-000000013004';
update public.order_visits set notes = 'Gate pass needed' where order_id = 'a1000000-0000-4000-8000-000000013004';
update public.orders set commissioning_planned_on = null where id = 'a1000000-0000-4000-8000-000000013004';
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013004'), 1, 'a visit with notes is kept when its date is cleared');
select is((select visit_on from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013004'), null, 'and has no date');

-- an engineer on a visit is on the order's crew
insert into public.order_visits (id, order_id, visit_on, engineer_id) values
  ('b1000000-0000-4000-8000-000000013005', 'a1000000-0000-4000-8000-000000013005', current_date + 2, 'a0000000-0000-4000-8000-000000000003');
select ok(exists (select 1 from public.order_engineers where order_id = 'a1000000-0000-4000-8000-000000013005' and user_id = 'a0000000-0000-4000-8000-000000000003'),
  'giving a visit to an engineer puts them on the order');

-- ------------------------------------------------------------------ the existing visit becomes a row (the migration's backfill statement)
alter table public.orders disable trigger orders_mirror_visit_fields;
insert into public.orders (id, company_id, owner_id, commissioning_planned_on, commissioning_done_on, visit_type) values
  ('a1000000-0000-4000-8000-000000013011', 'c0000000-0000-4000-8000-000000013001', 'a0000000-0000-4000-8000-000000000002', current_date + 4, null, 'survey'),
  ('a1000000-0000-4000-8000-000000013012', 'c0000000-0000-4000-8000-000000013001', 'a0000000-0000-4000-8000-000000000002', current_date - 9, current_date - 8, null),
  ('a1000000-0000-4000-8000-000000013013', 'c0000000-0000-4000-8000-000000013001', 'a0000000-0000-4000-8000-000000000002', null, null, null);
alter table public.orders enable trigger orders_mirror_visit_fields;
insert into public.order_engineers (order_id, user_id) values
  ('a1000000-0000-4000-8000-000000013012', 'a0000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000013012', 'a0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.order_visits where order_id in ('a1000000-0000-4000-8000-000000013011', 'a1000000-0000-4000-8000-000000013012', 'a1000000-0000-4000-8000-000000013013')), 0, 'before the backfill those orders have no visit row');

insert into public.order_visits (order_id, visit_type, visit_on, engineer_id, done_on, created_at)
select o.id, coalesce(o.visit_type, 'installation'), o.commissioning_planned_on, e.user_id, o.commissioning_done_on, o.created_at
from public.orders o
left join public.order_engineers e on e.order_id = o.id
where (o.commissioning_planned_on is not null or o.commissioning_done_on is not null)
  and o.id in ('a1000000-0000-4000-8000-000000013011', 'a1000000-0000-4000-8000-000000013012', 'a1000000-0000-4000-8000-000000013013');

select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013011'), 1, 'backfill: a planned order becomes one visit');
select is((select visit_type from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013011'), 'survey', 'with its type');
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013012'), 2, 'backfill: one visit per assigned engineer, so each keeps theirs');
select is((select count(distinct done_on)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013012'), 1, 'both with the same done date');
select is((select visit_type from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013012' limit 1), 'installation', 'no type on file = installation');
select is((select count(*)::int from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013013'), 0, 'backfill: an order with no visit date gets no visit');
select is((select commissioning_planned_on from public.orders where id = 'a1000000-0000-4000-8000-000000013011'), current_date + 4, 'the order summary is unchanged by the backfill');
select is((select commissioning_done_on from public.orders where id = 'a1000000-0000-4000-8000-000000013012'), current_date - 8, 'and so is a done order');

-- ------------------------------------------------------------------ who can do what
insert into public.order_visits (id, order_id, visit_on, engineer_id) values
  ('b1000000-0000-4000-8000-000000013101', 'a1000000-0000-4000-8000-000000013003', current_date + 1, 'a0000000-0000-4000-8000-000000000003'),   -- the engineer's
  ('b1000000-0000-4000-8000-000000013102', 'a1000000-0000-4000-8000-000000013003', current_date + 2, 'a0000000-0000-4000-8000-000000000001'),   -- the admin's
  ('b1000000-0000-4000-8000-000000013103', 'a1000000-0000-4000-8000-000000013003', current_date + 3, null),                                       -- nobody's, on the engineer's order
  ('b1000000-0000-4000-8000-000000013104', 'a1000000-0000-4000-8000-000000013006', current_date + 3, null);                                       -- nobody's, on an order that is not theirs

select is(pg_temp.as_('admin', $q$select count(*)::text from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013003'$q$), '3', 'admin reads every visit');
select is(pg_temp.as_('sales', $q$select count(*)::text from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013003'$q$), '3', 'sales reads every visit');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.order_visits where order_id = 'a1000000-0000-4000-8000-000000013003'$q$), '3', 'an engineer reads the visits of an order');
select is(pg_temp.as_('deactivated', $q$select count(*)::text from public.order_visits$q$), '0', 'a deactivated person reads none');

select ok(pg_temp.as_('sales', $q$insert into public.order_visits (order_id, visit_type, visit_on) values ('a1000000-0000-4000-8000-000000013006', 'survey', current_date + 5) returning id::text$q$) ~ '^[0-9a-f-]{36}$', 'sales adds a visit');
select ok(pg_temp.as_('admin', $q$insert into public.order_visits (order_id, visit_on, engineer_id) values ('a1000000-0000-4000-8000-000000013006', current_date + 6, 'a0000000-0000-4000-8000-000000000003') returning id::text$q$) ~ '^[0-9a-f-]{36}$', 'admin adds a visit');
select is(pg_temp.as_('engineer', $q$insert into public.order_visits (order_id, visit_on) values ('a1000000-0000-4000-8000-000000013003', current_date + 5) returning id::text$q$), 'E:42501', 'an engineer does not add visits');
select is(pg_temp.as_('deactivated', $q$insert into public.order_visits (order_id, visit_on) values ('a1000000-0000-4000-8000-000000013003', current_date + 5) returning id::text$q$), 'E:42501', 'nor a deactivated person');

select is(pg_temp.as_('engineer', $q$update public.order_visits set notes = 'Done, customer happy', done_on = current_date where id = 'b1000000-0000-4000-8000-000000013101' returning notes$q$),
  'Done, customer happy', 'an engineer edits and completes their own visit');
select is(pg_temp.as_('engineer', $q$update public.order_visits set notes = 'x' where id = 'b1000000-0000-4000-8000-000000013102' returning notes$q$),
  '<none>', 'but not a visit that is someone else''s');
select is(pg_temp.as_('engineer', $q$update public.order_visits set notes = 'on my order' where id = 'b1000000-0000-4000-8000-000000013103' returning notes$q$),
  'on my order', 'a visit with no engineer on an order they are assigned to is theirs to edit');
select is(pg_temp.as_('engineer', $q$update public.order_visits set notes = 'not mine' where id = 'b1000000-0000-4000-8000-000000013104' returning notes$q$),
  '<none>', 'and one with no engineer on an order that is not theirs is not');
select is(pg_temp.as_('engineer', $q$update public.order_visits set engineer_id = 'a0000000-0000-4000-8000-000000000002' where id = 'b1000000-0000-4000-8000-000000013101' returning id::text$q$),
  'E:42501', 'an engineer cannot hand a visit to someone else');
select is(pg_temp.as_('engineer', $q$update public.order_visits set order_id = 'a1000000-0000-4000-8000-000000013006' where id = 'b1000000-0000-4000-8000-000000013101' returning id::text$q$),
  'E:42501', 'nor move it to another order');
select is(pg_temp.as_('sales', $q$update public.order_visits set engineer_id = 'a0000000-0000-4000-8000-000000000003' where id = 'b1000000-0000-4000-8000-000000013102' returning id::text$q$),
  'b1000000-0000-4000-8000-000000013102', 'sales can assign a visit');
select is(pg_temp.as_('sales', $q$update public.order_visits set order_id = 'a1000000-0000-4000-8000-000000013006' where id = 'b1000000-0000-4000-8000-000000013102' returning id::text$q$),
  'E:42501', 'but no one moves a visit to another order');
select is(pg_temp.as_('engineer', $q$delete from public.order_visits where id = 'b1000000-0000-4000-8000-000000013101' returning id::text$q$), '<none>', 'an engineer does not delete visits');
select is(pg_temp.as_('sales', $q$delete from public.order_visits where id = 'b1000000-0000-4000-8000-000000013104' returning id::text$q$), 'b1000000-0000-4000-8000-000000013104', 'sales deletes a visit');

select throws_ok($$insert into public.order_visits (order_id, visit_type) values ('a1000000-0000-4000-8000-000000013006', 'party')$$, '23514', null, 'the three types are the only ones');
select throws_ok($$insert into public.order_visits (order_id, notes) values ('a1000000-0000-4000-8000-000000013006', repeat('x', 2001))$$, '23514', null, 'notes are short');

-- ------------------------------------------------------------------ audited, no price column
select ok(exists (select 1 from public.audit_log where table_name = 'order_visits' and action = 'insert'), 'a visit being added is in the audit log');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'order_visits' and column_name ~ 'price|amount|total|rate'), 0, 'no price on a visit');
select ok(has_table_privilege('qtech_engineer', 'public.order_visits', 'update'), 'an engineer request can reach the table (row security says which rows)');

select * from finish();
rollback;
