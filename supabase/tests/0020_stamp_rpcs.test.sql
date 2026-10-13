begin;
select plan(40);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Fixtures are inserted as the table owner; every RPC is called as `authenticated` so the caller's row security applies.

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('stamp_clarification_ask', 'stamp_supplier_chase', 'stamp_payment_reminder',
                               'stamp_tcs_sent', 'stamp_fbr_psid', 'stamp_tax_deposited')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 6,
  'the six stamp RPCs are SECURITY INVOKER with a fixed search_path, executable by authenticated only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
insert into public.clarifications (id, rfq_id, question, first_asked_at, last_asked_at, ask_count, answer, answered_at, withdrawn_at) values
  ('f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Open question', null, null, 0, null, null, null),
  ('f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Answered question', null, null, 0, 'yes', now(), null),
  ('f0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'Withdrawn question', null, null, 0, null, null, now()),
  ('f0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'Asked before',
   '2020-01-01 00:00:00+00', '2020-01-02 00:00:00+00', 1, null, null, null);
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.invoices (id, order_id, number, net_amount, gst_amount, tax_deposit_amount, tax_deposited_on) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'S-1', 1000, 100, null, null),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'S-2', 500, 50, 40, null),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'S-3', 200, 36, 10, '2026-01-01');

set local role authenticated;

-- ------------------------------------------------------------------ stamp_clarification_ask (engineer)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is(public.stamp_clarification_ask(array['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002',
                                               'f0000000-0000-4000-8000-000000000003']::uuid[]),
  1, 'only the open question in the bundle is stamped');
select ok((select ask_count = 1 and first_asked_at is not null and first_asked_at = last_asked_at
           from public.clarifications where id = 'f0000000-0000-4000-8000-000000000001'),
  'first ask: ask_count 1, first_asked_at = last_asked_at');
select ok((select bool_and(ask_count = 0 and first_asked_at is null and last_asked_at is null)
           from public.clarifications
           where id in ('f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003')),
  'answered and withdrawn questions are left alone');
select is(public.stamp_clarification_ask(array['f0000000-0000-4000-8000-000000000004']::uuid[]), 1, 'a repeat ask is stamped');
select ok((select ask_count = 2 and first_asked_at = '2020-01-01 00:00:00+00' and last_asked_at > '2020-01-02 00:00:00+00'
           from public.clarifications where id = 'f0000000-0000-4000-8000-000000000004'),
  'a repeat ask keeps first_asked_at, moves last_asked_at, adds one to ask_count');
select is(public.stamp_clarification_ask('{}'), 0, 'an empty set stamps nothing');
select is(public.stamp_clarification_ask(null), 0, 'and a null set stamps nothing');

-- ------------------------------------------------------------------ stamp_supplier_chase
select is(public.stamp_supplier_chase('e0000000-0000-4000-8000-000000000001'), 1::smallint, 'first chase returns count 1');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.stamp_supplier_chase('e0000000-0000-4000-8000-000000000001'), 2::smallint, 'second chase (by sales) returns count 2');
select ok((select last_chased_on = public.today_pkt() and chase_count = 2 from public.supplier_inquiries
           where id = 'e0000000-0000-4000-8000-000000000001'),
  'last_chased_on is today and the count is stored');
select throws_ok($$select public.stamp_supplier_chase(gen_random_uuid())$$, 'P0002', null, 'an unknown inquiry is an error');

-- ------------------------------------------------------------------ stamp_payment_reminder
select is(public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000001',
                                               'b1000000-0000-4000-8000-000000000002']::uuid[]),
  2, 'sales stamps a payment reminder on two invoices');
select ok((select bool_and(last_reminded_on = public.today_pkt() and reminder_count = 1) from public.invoices
           where id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002')),
  'last_reminded_on is today, count 1');
select ok((select last_reminded_on is null and reminder_count = 0 from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000003'), 'other invoices are untouched');
select is(public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000001']::uuid[]), 1, 'and it can be repeated');
select is((select reminder_count from public.invoices where id = 'b1000000-0000-4000-8000-000000000001'), 2::smallint,
  'the count increments');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'an engineer is refused, not silently given zero rows');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'a deactivated user is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000003']::uuid[]), 1, 'admin can stamp reminders');

-- ------------------------------------------------------------------ stamp_tcs_sent
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002']::uuid[],
                                'TCS-1'),
  2, 'sales stamps two invoices as sent by TCS');
select ok((select bool_and(tcs_sent_on = public.today_pkt() and tcs_number = 'TCS-1') from public.invoices
           where id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002')),
  'the date defaults to today and the consignment number is set on the batch');
select is(public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000001']::uuid[], 'TCS-2'), 0,
  'an invoice already stamped is not stamped again');
select is((select tcs_number from public.invoices where id = 'b1000000-0000-4000-8000-000000000001'), 'TCS-1',
  'and its consignment number is not overwritten');
select is(public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000003']::uuid[], null, date '2027-01-02'), 1,
  'a single invoice can be stamped, optionally with a date');
select ok((select tcs_sent_on = date '2027-01-02' and tcs_number is null from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000003'), 'with that date and no number');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'an engineer cannot stamp TCS');

-- ------------------------------------------------------------------ stamp_fbr_psid
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.stamp_fbr_psid(array['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
                                      'b1000000-0000-4000-8000-000000000003']::uuid[], ' PSID-9 '),
  3, 'one PSID is stamped on the whole batch');
select ok((select bool_and(psid = 'PSID-9') from public.invoices), 'trimmed, on every invoice in the set');
select throws_ok($$select public.stamp_fbr_psid(array['b1000000-0000-4000-8000-000000000001']::uuid[], '  ')$$,
  '22023', null, 'a blank PSID is refused');
select is(public.stamp_fbr_psid(array['b1000000-0000-4000-8000-000000000003']::uuid[], 'PSID-10'), 1,
  'a PSID can be corrected on one invoice');
select is((select psid from public.invoices where id = 'b1000000-0000-4000-8000-000000000003'), 'PSID-10', 'and replaces the old one');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.stamp_fbr_psid(array['b1000000-0000-4000-8000-000000000001']::uuid[], 'X')$$,
  '42501', null, 'an engineer cannot stamp a PSID');

-- ------------------------------------------------------------------ stamp_tax_deposited
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.stamp_tax_deposited(array['b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
                                           'b1000000-0000-4000-8000-000000000003']::uuid[]),
  2, 'two undeposited invoices are stamped deposited; the third already was');
select ok((select tax_deposited_on = public.today_pkt() and tax_deposit_amount = 100 from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000001'),
  'the deposit date is today and the amount defaults to the GST amount');
select ok((select tax_deposited_on = public.today_pkt() and tax_deposit_amount = 40 from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000002'),
  'an amount that was already entered is kept');
select ok((select tax_deposited_on = date '2026-01-01' and tax_deposit_amount = 10 from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000003'),
  'an invoice already deposited is untouched');
select is(public.stamp_tax_deposited(array['b1000000-0000-4000-8000-000000000001']::uuid[]), 0, 'a second deposit stamp changes nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.stamp_tax_deposited(array['b1000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'an engineer cannot stamp deposits');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select public.stamp_supplier_chase(gen_random_uuid())$$, '42501', null, 'anon cannot stamp a chase');
reset role;

select * from finish();
rollback;
