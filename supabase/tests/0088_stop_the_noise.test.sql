begin;
select * from no_plan();

-- 0088 (redesign phase 0 "stop the noise"): a sent quotation is never overdue (D4); no FBR exception on an imported invoice
-- (D8); money_exceptions_input() says which orders and invoices are imported (D10); an imported RFQ due before it was received
-- gets the year fixed (D5). Fixtures are written as the owner with no signed-in person, as the import writes them. Fictional
-- data only. Fixture users from supabase/seed.sql: admin a0..01, sales a0..02.

select set_config('request.jwt.claims', '', true);

create function pg_temp.d(n int) returns date language sql stable as $$ select public.today_pkt() - n $$;

insert into public.companies (id, name) values ('c8800000-0000-4000-8000-000000000001', 'Noise Test Customer');

-- ------------------------------------------------------------------ 1. v_rfq_state.is_overdue (D4)
-- 1: due 10 days ago, no quotation sent: overdue. 2: due 10 days ago, quotation sent 12 days ago: not overdue.
-- 3: due 400 days ago, quotation sent and expired: not overdue either.
insert into public.rfqs (id, company_id, owner_id, received_on, due_on, quoted_on) values
  ('d8800000-0000-4000-8000-000000000001', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', pg_temp.d(20), pg_temp.d(10), null),
  ('d8800000-0000-4000-8000-000000000002', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', pg_temp.d(20), pg_temp.d(10), pg_temp.d(12)),
  ('d8800000-0000-4000-8000-000000000003', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', pg_temp.d(420), pg_temp.d(400), pg_temp.d(410));

select ok((select is_overdue from public.v_rfq_state where rfq_id = 'd8800000-0000-4000-8000-000000000001'),
  'D4: an RFQ past its due date with no quotation sent is overdue');
select ok(not (select is_overdue from public.v_rfq_state where rfq_id = 'd8800000-0000-4000-8000-000000000002'),
  'D4: an RFQ whose quotation was sent is never overdue, though its due date has passed');
select ok(not (select is_overdue from public.v_rfq_state where rfq_id = 'd8800000-0000-4000-8000-000000000003'),
  'D4: nor is one whose quotation was sent long ago');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd8800000-0000-4000-8000-000000000002'), 'bid_sent',
  'D4: the bid state is unchanged (bid_sent)');

-- ------------------------------------------------------------------ 2. v_invoice_state.fbr_exception (D8)
insert into public.orders (id, company_id, owner_id, ordered_on) values
  ('d8810000-0000-4000-8000-000000000001', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.d(90));
-- both deposited with no receipt and no PSID: the v2 one is an FBR step out of order, the imported one is history
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, tax_deposited_on, legacy_source) values
  ('d8820000-0000-4000-8000-000000000001', 'd8810000-0000-4000-8000-000000000001', 'NOISE-V2', pg_temp.d(80), 1000, 180, pg_temp.d(70), null),
  ('d8820000-0000-4000-8000-000000000002', 'd8810000-0000-4000-8000-000000000001', 'NOISE-OLD', pg_temp.d(80), 1000, 180, pg_temp.d(70),
   '{"imported": true, "table": "invoices"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok((select fbr_exception from public.v_invoice_state where invoice_id = 'd8820000-0000-4000-8000-000000000001'),
  'D8: a v2 invoice deposited with no receipt is still an FBR step out of order');
select ok(not (select fbr_exception from public.v_invoice_state where invoice_id = 'd8820000-0000-4000-8000-000000000002'),
  'D8: the same on an imported invoice is history, not an exception');
select is((select fbr_state from public.v_invoice_state where invoice_id = 'd8820000-0000-4000-8000-000000000002'), 'deposited',
  'D8: its FBR state still reads deposited');

-- ------------------------------------------------------------------ 3. money_exceptions_input() marks imported records (D10)
reset role;
select set_config('request.jwt.claims', '', true);
-- two orders with an unresolved GST basis (always a finding, so both are in the document): one imported, one made in v2
insert into public.orders (id, company_id, owner_id, ordered_on, legacy_flags, legacy_source) values
  ('d8810000-0000-4000-8000-000000000002', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.d(700),
   array['value_basis_unknown'], '{"imported": true, "table": "orders"}'),
  ('d8810000-0000-4000-8000-000000000003', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.d(5),
   array['value_basis_unknown'], null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select (o ->> 'legacy')::boolean from jsonb_array_elements(public.money_exceptions_input() -> 'orders') o
           where o ->> 'id' = 'd8810000-0000-4000-8000-000000000002'), true,
  'D10: an imported order is marked legacy in the checks'' input');
select is((select (o ->> 'legacy')::boolean from jsonb_array_elements(public.money_exceptions_input() -> 'orders') o
           where o ->> 'id' = 'd8810000-0000-4000-8000-000000000003'), false,
  'D10: a v2 order is not');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.money_exceptions_input(), null, 'D10: still admin only (sales gets nothing)');
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------------ 4. imported due dates a year early (D5)
insert into public.rfqs (id, company_id, owner_id, received_on, due_on, legacy_source) values
  -- received 27 Jan 2025, due "31 Jan 2024": the year was mistyped, so 31 Jan 2025
  ('d8800000-0000-4000-8000-000000000011', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2025-01-27', '2024-01-31',
   '{"imported": true, "table": "rfqs"}'),
  -- received 30 Dec 2025, due "5 Jan 2024": the received year is still too early, so the next one, 5 Jan 2026
  ('d8800000-0000-4000-8000-000000000012', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2025-12-30', '2024-01-05',
   '{"imported": true, "table": "rfqs"}'),
  -- imported, due after it was received: untouched
  ('d8800000-0000-4000-8000-000000000013', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2025-03-01', '2025-03-10',
   '{"imported": true, "table": "rfqs"}');
-- made in v2 with a due date before its received date: never changed by the clean-up
insert into public.rfqs (id, company_id, owner_id, received_on, due_on) values
  ('d8800000-0000-4000-8000-000000000014', 'c8800000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2025-03-01', '2025-02-01');

select is(legacy_archive.fix_imported_due_years(), 2, 'D5: two imported RFQs had a due date before the day they were received');
select is((select due_on from public.rfqs where id = 'd8800000-0000-4000-8000-000000000011'), '2025-01-31'::date,
  'D5: the due date takes the received year');
select is((select due_on from public.rfqs where id = 'd8800000-0000-4000-8000-000000000012'), '2026-01-05'::date,
  'D5: or the next year when the received year is still too early');
select ok((select 'due_year_fixed' = any (legacy_flags) from public.rfqs where id = 'd8800000-0000-4000-8000-000000000011'),
  'D5: and is flagged due_year_fixed');
select is((select due_on from public.rfqs where id = 'd8800000-0000-4000-8000-000000000013'), '2025-03-10'::date,
  'D5: an imported RFQ already due after it was received is untouched');
select is((select due_on from public.rfqs where id = 'd8800000-0000-4000-8000-000000000014'), '2025-02-01'::date,
  'D5: a v2 RFQ is never changed');
select is((select count(*)::int from public.rfqs where legacy_source is not null and due_on < received_on), 0,
  'D5: no imported RFQ is left due before it was received');
select is(legacy_archive.fix_imported_due_years(), 0, 'D5: a second run fixes nothing (idempotent)');
select ok(not has_function_privilege('authenticated', 'legacy_archive.fix_imported_due_years()', 'execute')
      and not has_function_privilege('anon', 'legacy_archive.fix_imported_due_years()', 'execute')
      and not has_function_privilege('service_role', 'legacy_archive.fix_imported_due_years()', 'execute'),
  'D5: no client role may execute the clean-up');

select * from finish();
rollback;
