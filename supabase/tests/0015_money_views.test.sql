begin;
select plan(64);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.
-- Payments use fixed past dates (Q2 and Q3 2026, Q4 2025) so quarter arithmetic is deterministic.

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('v_order_basis', 'v_payment_net', 'v_order_money', 'v_cash_month', 'v_target_progress')
             and coalesce(c.reloptions, '{}') @> array['security_invoker=true']), 5,
  'the money views are security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in ('public.v_order_basis'::regclass, 'public.v_payment_net'::regclass,
                                      'public.v_order_money'::regclass, 'public.v_cash_month'::regclass,
                                      'public.v_target_progress'::regclass)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the money views');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');

-- o01 invoiced (invoice differs from the items) | o02 same items, no invoice yet
-- o03 partly exempt | o04 fully exempt (engineer-owned) | o05 basis unknown | o06 no value
-- o07 ownerless (unattributed) | o08 rounding | o09, o10 settled / short by Rs 2 (admin-owned)
-- o11 unpaid, not yet due | o12 costs complete | o13 over-paid
insert into public.orders (id, company_id, owner_id, payment_terms_days, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 30, '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', null, '{}'),
  ('a1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null,
   array['value_basis_unknown']),
  ('a1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null, '{}'),
  ('a1000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null, '{}'),
  ('a1000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 30, '{}'),
  ('a1000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}');
insert into public.orders (id, company_id, owner_id, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', null, array['owner_unknown']);

insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000001', 'o01', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000002', 'o02', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000003', 'o03 taxed', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000003', 'o03 exempt', 1, 1000, 0),
  ('a1000000-0000-4000-8000-000000000004', 'o04 exempt', 1, 1000, 0),
  ('a1000000-0000-4000-8000-000000000005', 'o05', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000007', 'o07', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000008', 'o08', 1, 333.33, 18),
  ('a1000000-0000-4000-8000-000000000009', 'o09', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000010', 'o10', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000011', 'o11', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000012', 'o12', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000013', 'o13', 1, 1000, 18);

-- Invoices: o01 invoice is the external truth (gst 100, not 180). o11 is dated today.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000001', 'M-1', '2026-04-01', 1000, 100),
  ('a1000000-0000-4000-8000-000000000011', 'M-11', public.today_pkt(), 1000, 180);

insert into public.payments_in (id, order_id, received_on, amount) values
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-05-15', 550),
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', '2026-05-15', 590),
  ('b2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '2026-04-10', 1090),
  ('b2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', '2026-05-15', 500),
  ('b2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', '2026-05-15', 118),
  ('b2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000006', '2026-05-15', 100),
  ('b2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000007', '2026-05-15', 236),
  ('b2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000008', '2026-04-10', 100),
  ('b2000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000009', '2026-06-10', 1179),
  ('b2000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000010', '2026-06-10', 1178),
  ('b2000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', '2026-07-05', 110),
  ('b2000000-0000-4000-8000-000000000013', 'a1000000-0000-4000-8000-000000000013', '2025-12-01', 1500);

insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at, costs_complete_by) values
  ('a1000000-0000-4000-8000-000000000012', 800, now(), 'a0000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000001', 700, null, null);
insert into public.expenses (paid_on, amount_pkr, category, order_id) values
  ('2026-05-20', 300, 'Supplier payment', 'a1000000-0000-4000-8000-000000000001'),
  ('2026-06-20', 600, 'Supplier payment', 'a1000000-0000-4000-8000-000000000012'),
  ('2026-05-20', 400, 'Supplier payment', 'a1000000-0000-4000-8000-000000000005');
insert into public.expenses (paid_on, amount_pkr, category) values
  ('2026-05-20', 50, 'Utilities'),
  ('2026-04-20', 20, 'Utilities');

insert into public.targets (user_id, year, quarter, target_net_pkr) values
  ('a0000000-0000-4000-8000-000000000002', 2026, 2, 5000),
  ('a0000000-0000-4000-8000-000000000002', 2026, 3, 3000),
  ('a0000000-0000-4000-8000-000000000003', 2026, 2, 1000),
  ('a0000000-0000-4000-8000-000000000002', 2099, 1, 4000);
insert into public.targets (user_id, year, quarter, target_net_pkr)
  select 'a0000000-0000-4000-8000-000000000002', extract(year from public.today_pkt())::int,
         extract(quarter from public.today_pkt())::int, 400
  on conflict do nothing;

-- ------------------------------------------------------------------ v_payment_net (section 5a)
select is((select basis from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000001'),
  'invoice', 'an order with an invoice uses the invoice figures');
select ok((select net_portion = 500.00 and gst_portion = 50.00 and excluded_reason is null
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000001'),
  'invoiced: 550 x 1000 / 1100 = 500.00 net, 50.00 GST (not the 466.10 the items would give)');
select ok((select basis = 'items' and net_portion = 500.00 and gst_portion = 90.00
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000002'),
  'not invoiced yet: the items give 590 x 1000 / 1180 = 500.00 net, 90.00 GST');
select ok((select net_portion = 1000.00 and gst_portion = 90.00
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000003'),
  'partly exempt: N 2000, G 2180, 1090 pays 1000.00 net and 90.00 GST');
select ok((select n = 1000 and g = 1000 and net_portion = 500.00 and gst_portion = 0.00
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000004'),
  'fully exempt: ratio 1, the whole payment is net');
select ok((select excluded_reason = 'basis_unknown' and net_portion is null and gst_portion is null
                  and not counts_in_cash_net and not counts_in_target
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000005'),
  'basis_unknown: excluded from every net total, no net guessed');
select ok((select excluded_reason = 'zero_value' and net_portion is null and not counts_in_cash_net
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000006'),
  'zero_value: G = 0 is excluded and does not divide by zero');
select ok((select excluded_reason = 'unattributed' and net_portion = 200.00 and gst_portion = 36.00
                  and counts_in_cash_net and not counts_in_target
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000007'),
  'unattributed: counts in company net cash, in nobody''s target');
select ok((select net_portion = 84.75 and gst_portion = 15.25
           from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000008'),
  'rounding: GST rounded to whole rupees per line, share rounded to 2 decimals');
select ok((select net_portion = 1271.19 from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000013'),
  'an over-payment counts at face value, with no cap');
select is((select credited_user_id from public.v_payment_net where payment_id = 'b2000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'credited user comes from the order owner');
select is((select count(*)::int from public.v_payment_net), 12, 'every payment appears exactly once');

-- ------------------------------------------------------------------ v_order_money
select ok((select basis = 'invoice' and net_sale = 1000 and gross_target = 1100 and settled = 660
                  and receivable = 440 and overpaid_by = 0
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'invoiced order: net sale and gross from the invoice, settled sums its payments');
select ok((select due_on = date '2026-05-01' and payment_state = 'overdue'
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'due date = earliest invoice date + payment terms; unsettled and past due is overdue');
select ok((select actual_cost = 300 and expected_cost = 700 and margin = 700 and costs_state = 'provisional'
                  and margin_state = 'provisional'
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'margin = net sale - tagged expenses, provisional until costs are marked complete');
select ok((select basis = 'items' and net_sale = 1000 and gross_target = 1180 and payment_state = 'part' and due_on is null
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000002'),
  'without an invoice the items give the net sale and gross; no invoice, no due date');
select is((select payment_state from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000009'),
  'settled', 'paid within Rs 1 of the gross target is settled');
select is((select payment_state from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000010'),
  'part', 'Rs 2 short is only part paid');
select is((select payment_state from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000011'),
  'unpaid', 'an invoiced order with no payments and a future due date is unpaid');
select ok((select due_on = public.today_pkt() + 30 from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000011'),
  'due date for a fresh invoice is today plus the terms');
select ok((select payment_state = 'settled' and overpaid_by = 320 and receivable = 0
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000013'),
  'over-paid: settled, receivable 0, the excess is reported');
select ok((select costs_state = 'complete' and margin = 400 and margin_state = 'final' and expected_cost = 800
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000012'),
  'costs marked complete make the margin final');
select ok((select margin is null and margin_state = 'basis_unknown' and data_trust = 'basis_unknown'
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000005'),
  'a value_basis_unknown order has no margin');
select ok((select payment_state = 'part' and receivable = 0 and gross_target = 0
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000006'),
  'an order with no value is never "settled"');
select is((select count(*)::int from public.v_order_money), 13, 'every order has one money row');

-- ------------------------------------------------------------------ v_cash_month
select ok((select gross_received = 2094 and net_received = 1700 and gst_received = 176
                  and unresolved_gross = 218 and unresolved_count = 2 and money_out = 750
           from public.v_cash_month where month = date '2026-05-01'),
  'May: gross 2094; net 1700 and GST 176 (unattributed included); 218 unresolved; money out 750');
select ok((select gross_received - unresolved_gross = net_received + gst_received
           from public.v_cash_month where month = date '2026-05-01'),
  'resolved gross = net + GST');
select ok((select gross_received = 1190 and net_received = 1084.75 and gst_received = 105.25
                  and unresolved_gross = 0 and money_out = 20
           from public.v_cash_month where month = date '2026-04-01'),
  'April: totals and rounding');
select ok((select gross_received = 2357 and net_received = 1997.46 and money_out = 600
           from public.v_cash_month where month = date '2026-06-01'),
  'June: payments and expenses share the month');
select ok((select gross_received = 110 and net_received = 100 and gst_received = 10 and money_out = 0
           from public.v_cash_month where month = date '2026-07-01'),
  'July: a month with no expenses shows money out as 0');

-- ------------------------------------------------------------------ v_target_progress
select ok((select target_net = 5000 and achieved_net = 2084.75 and gap = 2915.25 and excluded_count = 2
                  and quarter_start = date '2026-04-01' and quarter_end = date '2026-06-30'
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2026 and quarter = 2),
  'sales Q2 2026: achieved counts only resolved credited payments; 2 excluded; quarter bounds');
select ok((select on_pace_net = 5000 and behind_pace = 2915.25
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2026 and quarter = 2),
  'a finished quarter is fully elapsed');
select ok((select target_net = 3000 and achieved_net = 100 and gap = 2900 and excluded_count = 0
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2026 and quarter = 3),
  'sales Q3 2026');
select ok((select target_net = 1000 and achieved_net = 500 and gap = 500
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000003' and year = 2026 and quarter = 2),
  'an engineer has a target like anyone else');
select ok((select target_net is null and gap is null and on_pace_net is null and behind_pace is null
                  and achieved_net = 1997.46
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000001' and year = 2026 and quarter = 2),
  'credited payments without a target still appear, with no target figures');
select ok((select target_net is null and achieved_net = 1271.19
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2025 and quarter = 4),
  'an earlier quarter without a target appears too');
select ok((select on_pace_net = 0 and behind_pace = 0 and achieved_net = 0
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2099 and quarter = 1),
  'a future quarter has not started: pace 0');
select ok((select on_pace_net > 0 and on_pace_net <= 400
           from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002'
             and year = extract(year from public.today_pkt()) and quarter = extract(quarter from public.today_pkt())),
  'the current quarter is partly elapsed (today counts)');

-- ------------------------------------------------------------------ roles: a non-admin gets 0 rows, never wrong totals
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.v_payment_net), 12, 'admin reads v_payment_net');
select is((select count(*)::int from public.v_order_money), 13, 'admin reads v_order_money');
select ok((select count(*) > 0 from public.v_cash_month), 'admin reads v_cash_month');
select ok((select count(*) > 0 from public.v_target_progress), 'admin reads v_target_progress');
select ok((select count(*) > 0 from public.v_order_basis), 'admin reads v_order_basis');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
-- sales can read invoices and orders, so without the explicit filter these views would return wrong numbers
select is((select count(*)::int from public.invoices), 2, 'sales can read the invoices the money views depend on');
select is((select count(*)::int from public.v_order_basis), 0, 'sales gets 0 rows from v_order_basis');
select is((select count(*)::int from public.v_payment_net), 0, 'sales gets 0 rows from v_payment_net');
select is((select count(*)::int from public.v_order_money), 0, 'sales gets 0 rows from v_order_money');
select is((select count(*)::int from public.v_cash_month), 0, 'sales gets 0 rows from v_cash_month');
select is((select count(*)::int from public.v_target_progress), 0, 'sales gets 0 rows from v_target_progress');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.v_payment_net), 0, 'engineer gets 0 rows from v_payment_net');
select is((select count(*)::int from public.v_order_money), 0, 'engineer gets 0 rows from v_order_money');
select is((select count(*)::int from public.v_cash_month), 0, 'engineer gets 0 rows from v_cash_month');
select is((select count(*)::int from public.v_target_progress), 0,
  'engineer gets 0 rows from v_target_progress, even for their own target');
select is((select count(*)::int from public.v_order_basis), 0, 'engineer gets 0 rows from v_order_basis');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_payment_net), 0, 'deactivated user gets 0 rows from v_payment_net');
select is((select count(*)::int from public.v_order_money), 0, 'deactivated user gets 0 rows from v_order_money');
select is((select count(*)::int from public.v_cash_month), 0, 'deactivated user gets 0 rows from v_cash_month');
select is((select count(*)::int from public.v_target_progress), 0, 'deactivated user gets 0 rows from v_target_progress');

reset role;
set local role anon;
select throws_ok($$select * from public.v_payment_net$$, '42501', null, 'anon cannot read v_payment_net');
select throws_ok($$select * from public.v_order_money$$, '42501', null, 'anon cannot read v_order_money');
select throws_ok($$select * from public.v_cash_month$$, '42501', null, 'anon cannot read v_cash_month');
select throws_ok($$select * from public.v_target_progress$$, '42501', null, 'anon cannot read v_target_progress');
reset role;

select * from finish();
rollback;
