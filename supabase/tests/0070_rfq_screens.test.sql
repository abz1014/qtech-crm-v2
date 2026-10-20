begin;
select * from no_plan();

-- 0070: float_rfq says whether it created the RFQ; search_closed_rfqs searches every won and closed RFQ, word by word.
-- Fixtures are written as the table owner; the calls are made as the fixture sales person (supabase/seed.sql).

insert into public.companies (id, name) values
  ('70000000-0000-4000-8000-000000000001', '0070 Indus Textile Mills'),
  ('70000000-0000-4000-8000-000000000002', '0070 Punjab Cement'),
  ('70000000-0000-4000-8000-000000000003', '0070 Supplier');

-- ---------------------------------------------------------------- float_rfq: created, then already existed
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.float_rfq('70000000-0000-4000-8000-000000000100', '70000000-0000-4000-8000-000000000001',
            '[{"description":"Pump A"}]'::jsonb, array['70000000-0000-4000-8000-000000000003']::uuid[]),
  jsonb_build_object('id', '70000000-0000-4000-8000-000000000100', 'created', true),
  'float_rfq returns the id and created = true when it makes the RFQ');
select is(public.float_rfq('70000000-0000-4000-8000-000000000100', '70000000-0000-4000-8000-000000000002',
            '[{"description":"Something else"},{"description":"And more"}]'::jsonb, '{}', null, null, null, null, false),
  jsonb_build_object('id', '70000000-0000-4000-8000-000000000100', 'created', false),
  'a second call with the same id says created = false (a restored draft, another tab, a retry)');
select ok((select company_id = '70000000-0000-4000-8000-000000000001' from public.rfqs where id = '70000000-0000-4000-8000-000000000100')
          and (select count(*) from public.rfq_items where rfq_id = '70000000-0000-4000-8000-000000000100') = 1
          and (select count(*) from public.supplier_inquiries where rfq_id = '70000000-0000-4000-8000-000000000100' and sent_on is not null) = 1,
  'and writes nothing: same company, one item, the inquiry still sent');
select throws_ok($$select public.float_rfq('70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000001', '[]'::jsonb)$$,
  '22023', null, 'the checks are unchanged: no items is refused');
reset role;

-- ---------------------------------------------------------------- search_closed_rfqs fixtures
-- Closed (old), closed (newer), won (live order), won-then-cancelled order (so: open), and open RFQs of the same customer.
insert into public.rfqs (id, number, company_id, customer_ref, received_on, closed_on, close_reason) overriding system value values
  ('70000000-0000-4000-8000-000000000010', 90001, '70000000-0000-4000-8000-000000000001', 'ENQ-70/1 (A)', '2025-01-10', '2025-02-01', 'price'),
  ('70000000-0000-4000-8000-000000000011', 90002, '70000000-0000-4000-8000-000000000001', 'ENQ-70-2',     '2026-03-10', '2026-04-01', 'competitor'),
  ('70000000-0000-4000-8000-000000000012', 90003, '70000000-0000-4000-8000-000000000002', null,           '2026-05-10', null, null),
  ('70000000-0000-4000-8000-000000000013', 90004, '70000000-0000-4000-8000-000000000002', null,           '2026-06-10', null, null),
  ('70000000-0000-4000-8000-000000000014', 90005, '70000000-0000-4000-8000-000000000001', 'ENQ-70-OPEN',  '2026-07-10', null, null),
  ('70000000-0000-4000-8000-000000000015', 90006, '70000000-0000-4000-8000-000000000001', '100% sure',    '2026-07-11', '2026-07-12', 'other');
insert into public.rfq_items (rfq_id, position, description) values
  ('70000000-0000-4000-8000-000000000010', 0, 'Rosemount 3051 pressure transmitter'),
  ('70000000-0000-4000-8000-000000000010', 1, 'Belimo damper actuator'),
  ('70000000-0000-4000-8000-000000000011', 0, 'Endress Hauser flow meter'),
  ('70000000-0000-4000-8000-000000000012', 0, 'Rosemount gauge'),
  ('70000000-0000-4000-8000-000000000013', 0, 'Rosemount transmitter'),
  ('70000000-0000-4000-8000-000000000014', 0, 'Rosemount 3051 pressure transmitter');
insert into public.orders (id, company_id, rfq_id) values
  ('70000000-0000-4000-8000-000000000020', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000012');
insert into public.orders (id, company_id, rfq_id, cancelled_on, cancel_reason) values
  ('70000000-0000-4000-8000-000000000021', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000013', '2026-06-20', 'customer_cancelled');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select array_agg(rfq_id order by rfq_id) from public.search_closed_rfqs('rosemount')),
  array['70000000-0000-4000-8000-000000000010', '70000000-0000-4000-8000-000000000012']::uuid[],
  'an item word finds the closed and the won RFQ, never an open one or one whose only order was cancelled');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('indus belimo')),
  array['70000000-0000-4000-8000-000000000010']::uuid[], 'every word must match, each anywhere (company and item)');
select is((select count(*)::int from public.search_closed_rfqs('indus gauge')), 0, 'a word that matches nothing of that RFQ leaves it out');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('RFQ-90002')),
  array['70000000-0000-4000-8000-000000000011']::uuid[], 'the number as written on the page');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('90001')),
  array['70000000-0000-4000-8000-000000000010']::uuid[], 'the bare number');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('enq-70/1 (a)')),
  array['70000000-0000-4000-8000-000000000010']::uuid[], 'a reference with a slash and brackets is found as typed');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('100%')),
  array['70000000-0000-4000-8000-000000000015']::uuid[], 'a percent sign is a plain character, not a wildcard');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('0070 indus')),
  array['70000000-0000-4000-8000-000000000015', '70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000010']::uuid[],
  'newest received first');
select is((select total from public.search_closed_rfqs('0070 indus', 1, 0) limit 1), 3::bigint, 'the total counts every match, not the page');
select is((select array_agg(rfq_id) from public.search_closed_rfqs('0070 indus', 1, 1)),
  array['70000000-0000-4000-8000-000000000011']::uuid[], 'a page further down');
select ok((select count(*) from public.search_closed_rfqs('', 500, 0)) >= 4, 'no text lists every won and closed RFQ');

-- Only signed-in staff may call it, and it runs as the caller (row security applies; the access matrix probes every persona).
reset role;
select ok(not has_function_privilege('anon', 'public.search_closed_rfqs(text, integer, integer)', 'execute'), 'anon cannot run the search');
select ok(has_function_privilege('authenticated', 'public.search_closed_rfqs(text, integer, integer)', 'execute'), 'signed-in staff can');
select ok((select prosecdef from pg_proc where oid = 'public.search_closed_rfqs(text, integer, integer)'::regprocedure) = false,
  'the search runs as the caller (SECURITY INVOKER)');

select * from finish();
rollback;
