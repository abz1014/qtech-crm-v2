begin;
select * from no_plan();

-- I01 (0055): the two service-role-only import helpers. Fixture users come from supabase/seed.sql: admin a0..01.

-- ------------------------------------------------------------------ shape and grants
select has_function('public', 'import_purge_audit', array['uuid[]'], 'import_purge_audit exists');
select has_function('public', 'import_reset_numbers', array[]::text[], 'import_reset_numbers exists');
select is((select bool_and(p.prosecdef) from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('import_purge_audit', 'import_reset_numbers')), true, 'both are security definer');
select is((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('import_purge_audit', 'import_reset_numbers')), true, 'both fix an empty search_path');
select is(has_function_privilege('service_role', 'public.import_purge_audit(uuid[])', 'execute'), true, 'service_role may purge audit rows of the import');
select is(has_function_privilege('service_role', 'public.import_reset_numbers()', 'execute'), true, 'service_role may reset the numbers');
select is(has_function_privilege('authenticated', 'public.import_purge_audit(uuid[])', 'execute'), false, 'a signed-in user may not purge audit rows');
select is(has_function_privilege('authenticated', 'public.import_reset_numbers()', 'execute'), false, 'a signed-in user may not reset the numbers');
select is(has_function_privilege('anon', 'public.import_purge_audit(uuid[])', 'execute'), false, 'anon may not purge audit rows');
select is(has_function_privilege('anon', 'public.import_reset_numbers()', 'execute'), false, 'anon may not reset the numbers');

-- ------------------------------------------------------------------ import_purge_audit
-- Rows written with no signed-in user (as the import does): one for an import id (version 5), one for a v2 id (version 4).
insert into public.companies (id, name) values
  ('c0000000-0000-5000-8000-0000000000e1', 'Import Co'),
  ('c0000000-0000-4000-8000-0000000000e2', 'V2 Co');
select is((select count(*)::int from public.audit_log where record_id = 'c0000000-0000-5000-8000-0000000000e1' and changed_by is null), 1,
  'setup: the import-style insert was audited');

-- A person (admin) edits an imported company afterwards: that audit row has a user and must survive.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.companies set notes = 'edited by a person' where id = 'c0000000-0000-5000-8000-0000000000e1';
select set_config('request.jwt.claims', '', true);

select is(public.import_purge_audit(array['c0000000-0000-5000-8000-0000000000e1'::uuid]), 1::bigint,
  'removes exactly the audit row written without a user');
select is((select count(*)::int from public.audit_log where record_id = 'c0000000-0000-5000-8000-0000000000e1' and changed_by is null), 0,
  'the import-written audit row is gone');
select is((select count(*)::int from public.audit_log where record_id = 'c0000000-0000-5000-8000-0000000000e1' and changed_by is not null), 1,
  'the audit row of the edit a person made stays');
select is((select count(*)::int from public.audit_log where record_id = 'c0000000-0000-4000-8000-0000000000e2'), 1,
  'the audit rows of other records are untouched');
select is(public.import_purge_audit(array[]::uuid[]), 0::bigint, 'an empty list removes nothing');
select is(public.import_purge_audit(array['c0000000-0000-5000-8000-0000000000e1'::uuid]), 0::bigint, 'running it again removes nothing (idempotent)');
select throws_ok($$select public.import_purge_audit(array['c0000000-0000-4000-8000-0000000000e2'::uuid])$$, '22023', null,
  'a v2 (version 4) id is refused, so v2 history cannot be named');
select is((select count(*)::int from public.audit_log where record_id = 'c0000000-0000-4000-8000-0000000000e2'), 1, 'and its audit row is still there');
select throws_ok($$select public.import_purge_audit(array['c0000000-0000-5000-8000-0000000000e1'::uuid, 'c0000000-0000-4000-8000-0000000000e2'::uuid])$$,
  '22023', null, 'one bad id in a list refuses the whole list');

-- ------------------------------------------------------------------ import_reset_numbers
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.rfqs (id, company_id) values
  ('f0000000-0000-5000-8000-0000000000a1', 'c0000000-0000-5000-8000-0000000000e1'),
  ('f0000000-0000-5000-8000-0000000000a2', 'c0000000-0000-5000-8000-0000000000e1');
insert into public.orders (id, company_id) values
  ('d0000000-0000-5000-8000-0000000000a1', 'c0000000-0000-5000-8000-0000000000e1'),
  ('d0000000-0000-5000-8000-0000000000a2', 'c0000000-0000-5000-8000-0000000000e1');
create temp table before_numbers as
  select (select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000a2') as rfq_n,
         (select number from public.orders where id = 'd0000000-0000-5000-8000-0000000000a2') as order_n;
-- The import deletes its rows: the counters have moved on, the table has not.
delete from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000a2';
delete from public.orders where id = 'd0000000-0000-5000-8000-0000000000a2';
select lives_ok($$select public.import_reset_numbers()$$, 'the numbers can be reset');
insert into public.rfqs (id, company_id) values ('f0000000-0000-5000-8000-0000000000a3', 'c0000000-0000-5000-8000-0000000000e1');
insert into public.orders (id, company_id) values ('d0000000-0000-5000-8000-0000000000a3', 'c0000000-0000-5000-8000-0000000000e1');
select is((select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000a3'), (select rfq_n from before_numbers),
  'the next RFQ takes the number the deleted one had (no gap)');
select is((select number from public.orders where id = 'd0000000-0000-5000-8000-0000000000a3'), (select order_n from before_numbers),
  'the next order takes the number the deleted one had (no gap)');
select ok((select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000a3') > (select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000a1'),
  'and the surviving row keeps its number below it');

-- ------------------------------------------------------------------ nobody but the service role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.import_purge_audit(array['c0000000-0000-5000-8000-0000000000e1'::uuid])$$, '42501', null,
  'even an admin cannot call import_purge_audit');
select throws_ok($$select public.import_reset_numbers()$$, '42501', null, 'even an admin cannot call import_reset_numbers');
reset role;

select * from finish();
rollback;
