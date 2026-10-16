begin;
select * from no_plan();

-- 0056: import_reset_numbers continues every Q-Tech number series after max(highest in use, imported floor).
-- Fixture users come from supabase/seed.sql: admin a0..01.

select has_function('public', 'import_reset_numbers', array['bigint', 'bigint', 'bigint', 'bigint'], 'the four-floor function exists');
select hasnt_function('public', 'import_reset_numbers', array[]::text[], 'and the old no-argument one is gone');
select is(has_function_privilege('service_role', 'public.import_reset_numbers(bigint,bigint,bigint,bigint)', 'execute'), true, 'service_role may call it');
select is(has_function_privilege('authenticated', 'public.import_reset_numbers(bigint,bigint,bigint,bigint)', 'execute'), false, 'authenticated may not');
select is(has_function_privilege('anon', 'public.import_reset_numbers(bigint,bigint,bigint,bigint)', 'execute'), false, 'anon may not');

-- ------------------------------------------------------------------ fixtures
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-5000-8000-0000000000f1', 'Floor Co');
insert into public.rfqs (id, company_id) values ('f0000000-0000-5000-8000-0000000000f1', 'c0000000-0000-5000-8000-0000000000f1');
insert into public.orders (id, company_id) values ('d0000000-0000-5000-8000-0000000000f1', 'c0000000-0000-5000-8000-0000000000f1');
-- a v2 quotation and a v2 supplier PO already hold numbers 7101 and 7102
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines)
  values ('ee000000-0000-4000-8000-0000000000f1', 'f0000000-0000-5000-8000-0000000000f1', 7101, 0, current_date + 1, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
insert into public.supplier_orders (id, order_id, supplier_id) values ('5e000000-0000-4000-8000-0000000000f1', 'd0000000-0000-5000-8000-0000000000f1', 'c0000000-0000-5000-8000-0000000000f1');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines)
  values ('ee000000-0000-4000-8000-0000000000f2', '5e000000-0000-4000-8000-0000000000f1', 7102, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------------ the floor wins where the tables are lower
select lives_ok($$select public.import_reset_numbers(177, 40, 0, 0)$$, 'reset with floors for RFQ and order');
insert into public.rfqs (id, company_id, owner_id) values ('f0000000-0000-5000-8000-0000000000f2', 'c0000000-0000-5000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id) values ('d0000000-0000-5000-8000-0000000000f2', 'c0000000-0000-5000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001');
select is((select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000f2'), 178::bigint, 'the next RFQ is 178 after an imported RFQ-0177');
select is((select number from public.orders where id = 'd0000000-0000-5000-8000-0000000000f2'), 41::bigint, 'the next order follows the order floor');

-- ------------------------------------------------------------------ the tables win where they are higher than the floor
select lives_ok($$select public.import_reset_numbers(1, 1, 42, 7)$$, 'reset with low floors');
insert into public.rfqs (id, company_id, owner_id) values ('f0000000-0000-5000-8000-0000000000f3', 'c0000000-0000-5000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001');
select is((select number from public.rfqs where id = 'f0000000-0000-5000-8000-0000000000f3'), 179::bigint, 'a low floor never takes a number below the highest RFQ in use (178)');
select is(nextval('public.quotation_number_seq'), 7102::bigint, 'the next quotation follows the highest quotation (7101), not the floor 42');
select is(nextval('public.po_number_seq'), 7103::bigint, 'the next supplier PO follows the highest PO (7102), not the floor 7');

-- ------------------------------------------------------------------ the floor wins for quotations and POs when nothing is higher
delete from public.purchase_orders where id = 'ee000000-0000-4000-8000-0000000000f2';
delete from public.quotations where id = 'ee000000-0000-4000-8000-0000000000f1';
select lives_ok($$select public.import_reset_numbers(0, 0, 42, 7)$$, 'reset with quotation and PO floors');
select is(nextval('public.quotation_number_seq'), 43::bigint, 'the next quotation is 43 after an imported QT-0042');
select is(nextval('public.po_number_seq'), 8::bigint, 'the next supplier PO is 8 after an imported 7');
select lives_ok($$select public.import_reset_numbers()$$, 'the defaults work (no floors)');

-- ------------------------------------------------------------------ nobody but the service role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.import_reset_numbers(1, 1, 1, 1)$$, '42501', null, 'even an admin cannot call it');
reset role;

select * from finish();
rollback;
