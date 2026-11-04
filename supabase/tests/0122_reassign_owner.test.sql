-- 0122_reassign_owner (process audit 1): an admin moves an enquiry, job or order to another owner, one at a time or all of a leaver's open
-- work at once. Past credit stays with the person who earned it; a payment recorded after the move credits the new owner.
--
-- Fixture: a0..02 (sales) owns RFQ-A (open), RFQ-B (closed), order OA (live, from RFQ-A) and order OB (cancelled).
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
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
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

-- Runs stmt as the persona and KEEPS its effect (as_ rolls it back); returns 'ok' or 'E:<sqlstate>'.
create function pg_temp.do_as(persona text, stmt text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002' end, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform qtech_private.pre_request();
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return 'E:' || sqlstate;
  end;
  execute 'reset role';
  return 'ok';
end
$f$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000001221', 'Reassign customer');
insert into public.rfqs (id, company_id, owner_id, closed_on, close_reason) values
  ('b0000000-0000-4000-8000-000000001221', 'c0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000002', null, null),
  ('b0000000-0000-4000-8000-000000001222', 'c0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000002', '2026-01-10', 'price');
insert into public.orders (id, company_id, rfq_id, owner_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000001221', 'c0000000-0000-4000-8000-000000001221', 'b0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000001222', 'c0000000-0000-4000-8000-000000001221', null, 'a0000000-0000-4000-8000-000000000002', '2026-01-20');
-- a payment received while the salesperson owned the order: credited to them
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000001221', '2026-02-01', 100);

select is((select credited_user_id::text from public.payments_in where order_id = 'a1000000-0000-4000-8000-000000001221'),
  'a0000000-0000-4000-8000-000000000002', 'the payment was credited to the owner at the time');

-- structure
select ok(not has_function_privilege('anon', 'public.reassign_owner(text, uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.reassign_open_work(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.open_work_of(uuid)', 'execute'), 'no anon grant');
select ok(has_function_privilege('qtech_engineer', 'public.reassign_open_work(uuid, uuid)', 'execute'), 'the engineer role mirrors authenticated (0081); the function refuses inside');

-- who may
select is(pg_temp.as_('sales', $q$select public.reassign_owner('rfq', 'b0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000001')::text$q$), 'E:42501', 'sales cannot reassign');
select is(pg_temp.as_('engineer', $q$select public.reassign_open_work('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001')::text$q$), 'E:42501', 'an engineer cannot reassign');
select is(pg_temp.as_('sales', $q$select rfqs::text from public.open_work_of('a0000000-0000-4000-8000-000000000002')$q$), 'E:42501', 'sales cannot read the open-work count');

-- who can take it
select is(pg_temp.as_('admin', $q$select public.reassign_owner('rfq', 'b0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000004')::text$q$), 'E:22023', 'a deactivated person cannot take work');
select is(pg_temp.as_('admin', $q$select public.reassign_owner('rfq', 'b0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000003')::text$q$), 'E:22023', 'an engineer cannot take work');
select is(pg_temp.as_('admin', $q$select public.reassign_open_work('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002')::text$q$), 'E:22023', 'not to the same person');

-- the open-work count: RFQ-A and order OA (the closed RFQ and the cancelled order are not open work)
select is(pg_temp.as_('admin', $q$select rfqs || '/' || orders from public.open_work_of('a0000000-0000-4000-8000-000000000002')$q$), '1/1', 'open work of the leaver: 1 RFQ, 1 order');

-- one at a time: a single order
select is(pg_temp.do_as('admin', $q$select public.reassign_owner('order', 'a1000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000001')$q$), 'ok', 'one order moved');
select is((select owner_id::text from public.orders where id = 'a1000000-0000-4000-8000-000000001221'), 'a0000000-0000-4000-8000-000000000001', 'the order has its new owner');
select is((select owner_id::text from public.rfqs where id = 'b0000000-0000-4000-8000-000000001221'), 'a0000000-0000-4000-8000-000000000002', 'the RFQ was not touched');

-- credit: the old payment keeps its credit, a new one goes to the new owner
select is((select credited_user_id::text from public.payments_in where order_id = 'a1000000-0000-4000-8000-000000001221' and received_on = '2026-02-01'),
  'a0000000-0000-4000-8000-000000000002', 'past credit stays with the person who earned it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000001221', '2026-03-01', 50);
select is((select credited_user_id::text from public.payments_in where order_id = 'a1000000-0000-4000-8000-000000001221' and received_on = '2026-03-01'),
  'a0000000-0000-4000-8000-000000000001', 'a payment recorded after the move credits the new owner');

-- a job: the enquiry and the orders that came from it
update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000002' where id = 'a1000000-0000-4000-8000-000000001221';
select is(pg_temp.do_as('admin', $q$select public.reassign_owner('job', 'b0000000-0000-4000-8000-000000001221', 'a0000000-0000-4000-8000-000000000001')$q$), 'ok', 'a job moves the enquiry and its order');
select is((select owner_id::text from public.rfqs where id = 'b0000000-0000-4000-8000-000000001221'), 'a0000000-0000-4000-8000-000000000001', 'the enquiry of the job moved');
select is((select count(*)::int from public.orders where id = 'a1000000-0000-4000-8000-000000001221' and owner_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'the order of the job moved with it');

-- in bulk: put them back with the leaver, then move everything open
update public.rfqs set owner_id = 'a0000000-0000-4000-8000-000000000002' where id in ('b0000000-0000-4000-8000-000000001221');
update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000002' where id = 'a1000000-0000-4000-8000-000000001221';
select is(pg_temp.do_as('admin', $q$select * from public.reassign_open_work('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001')$q$), 'ok', 'move all open work');
select is((select count(*)::int from public.rfqs where id = 'b0000000-0000-4000-8000-000000001221' and owner_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*)::int from public.orders where id = 'a1000000-0000-4000-8000-000000001221' and owner_id = 'a0000000-0000-4000-8000-000000000001'), 2,
  'the open RFQ and the live order both moved');
select is((select owner_id::text from public.rfqs where id = 'b0000000-0000-4000-8000-000000001222'), 'a0000000-0000-4000-8000-000000000002', 'a closed RFQ stays with the leaver (history)');
select is((select owner_id::text from public.orders where id = 'a1000000-0000-4000-8000-000000001222'), 'a0000000-0000-4000-8000-000000000002', 'a cancelled order stays with the leaver (history)');
select is(pg_temp.as_('admin', $q$select rfqs || '/' || orders from public.open_work_of('a0000000-0000-4000-8000-000000000002')$q$), '0/0', 'nothing open is left with the leaver');

select * from finish();
rollback;
