-- 0901_money_orders (money verification): line rounding, the order basis, the payment split, balances, due dates, the Rs 1
-- allowance, over-payment, cancelled orders, margin and target progress. Every expected value was worked out by hand from the
-- rules (DATA_MODEL 2.13, 5, 5a, 5b; DECISIONS 2026-10-19) and is the same number the TypeScript oracle computes
-- (src/test/money-oracle/pgtapFixtures.test.ts). A known bug is kept as a TODO test with its BUG id, so CI stays green.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Fixtures are written as the table
-- owner with the admin's claims (as the other money tests do); every read is made as `authenticated`.
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000901', 'Oracle customer A'),
  ('c0000000-0000-4000-8000-000000000902', 'Oracle customer B');

-- ================================================================== 1. line rounding (v_order_items_total)
-- O1: five lines, each on a rounding edge.
--   0.1 x 0.35 = 0.035 -> net 0.04, GST 0.0072 -> 0          25 x 1 = 25.00, GST 4.50 -> 5 (half away from zero)
--   3 x 75.00 = 225.00, GST 40.50 -> 41                     2.5 x 100.10 = 250.25, exempt -> 0
--   0.1 x 21.95 = 2.195 -> 2.20, GST 0.396 -> 0
--   net 502.49, GST 46, gross 548.49 (a rate applied to the sum would give 90.45 -> 90: wrong by 44)
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000901', 'c0000000-0000-4000-8000-000000000901', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (order_id, position, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000901', 1, 'half paisa', 0.1, 0.35, 18),
  ('a1000000-0000-4000-8000-000000000901', 2, 'half rupee GST', 1, 25.00, 18),
  ('a1000000-0000-4000-8000-000000000901', 3, 'half rupee GST x3', 3, 75.00, 18),
  ('a1000000-0000-4000-8000-000000000901', 4, 'exempt service', 2.5, 100.10, 0),
  ('a1000000-0000-4000-8000-000000000901', 5, 'half paisa 2', 0.1, 21.95, 18);

set local role authenticated;
select is((select net from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000901'), 502.49::numeric,
  'lines: net is the sum of round(qty x price, 2) per line (0.04 + 25.00 + 225.00 + 250.25 + 2.20)');
select is((select gst from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000901'), 46.00::numeric,
  'lines: GST is whole rupees per line, half away from zero (0 + 5 + 41 + 0 + 0), exempt adds nothing');
select is((select gross from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000901'), 548.49::numeric,
  'lines: gross = net + GST');

-- ================================================================== 2. basis and the payment split (v_order_basis, v_payment_net)
reset role;
insert into public.payments_in (id, order_id, received_on, amount) values
  ('a4000000-0000-4000-8000-000000000901', 'a1000000-0000-4000-8000-000000000901', '2025-03-10', 300.00);
set local role authenticated;
select ok((select basis = 'items' and n = 502.49 and g = 548.49 from public.v_order_basis where order_id = 'a1000000-0000-4000-8000-000000000901'),
  'basis: no invoice, so N and G come from the lines');
select ok((select net_portion = 274.84 and gst_portion = 25.16 and excluded_reason is null and counts_in_target
           from public.v_payment_net where payment_id = 'a4000000-0000-4000-8000-000000000901'),
  'split: 300 x 502.49 / 548.49 = 274.840... -> net 274.84, GST 25.16 (the remainder)');

reset role;
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000901', 'a1000000-0000-4000-8000-000000000901', 'ORC-0901', '2025-03-15', 400.00, 72.00);
set local role authenticated;
select ok((select basis = 'invoice' and n = 400.00 and g = 472.00 from public.v_order_basis where order_id = 'a1000000-0000-4000-8000-000000000901'),
  'basis: once an invoice exists N and G are the invoiced amounts (a part invoice of 400 + 72)');
select ok((select net_portion = 254.24 and gst_portion = 45.76 from public.v_payment_net where payment_id = 'a4000000-0000-4000-8000-000000000901'),
  'split: the same payment re-splits on the invoice basis: 300 x 400 / 472 = 254.237... -> 254.24 + 45.76');
select ok((select gross_target = 472.00 and settled = 300.00 and receivable = 172.00 and net_sale = 400.00
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000901'),
  'balance after a part invoice is the invoiced gross less paid (472 - 300 = 172); the uninvoiced 76.49 is not yet receivable');

-- ================================================================== 3. balances, the Rs 1 allowance, due dates, cancelled orders
-- Each order has one 18% line of 1,000 (gross 1,180) unless stated.
--   O2 (sales owner) invoiced 10 Jan 2025, no terms (default 30): due 9 Feb 2025; paid 1,179: settled within Rs 1, balance 1.00
--   O3 terms 0, invoiced 10 Jan 2025, paid 500: due 10 Jan, overdue, balance 680
--   O4 not invoiced, paid 2,000: settled, overpaid 820, balance 0, no due date
--   O5 cancelled, never invoiced: no receivable (D-MR3)          O6 cancelled after an invoice: keeps its 1,180 (D-MR3)
--   O7 terms 20, invoiced 9 Feb 2024 and 1 Mar 2024, the first paid in full: due 21 Mar 2024 (0123: the OLDEST UNPAID invoice + terms)
--   O8 the same two invoices, nothing paid: due 29 Feb 2024 (leap day; the oldest unpaid is the first)
--   O9 the same two invoices, 590 received TIED to the second: the first is still the oldest unpaid, due 29 Feb 2024
--   O10 the same two invoices, 590 received for neither: placed oldest first, so the second is the oldest unpaid: due 21 Mar 2024
insert into public.orders (id, company_id, owner_id, payment_terms_days, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000902', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000002', null, null),
  ('a1000000-0000-4000-8000-000000000903', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', 0, null),
  ('a1000000-0000-4000-8000-000000000904', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', null, null),
  ('a1000000-0000-4000-8000-000000000905', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', null, '2025-02-01'),
  ('a1000000-0000-4000-8000-000000000906', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', null, '2025-02-01'),
  ('a1000000-0000-4000-8000-000000000907', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', 20, null),
  ('a1000000-0000-4000-8000-000000000908', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', 20, null),
  ('a1000000-0000-4000-8000-000000000909', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', 20, null),
  ('a1000000-0000-4000-8000-000000000910', 'c0000000-0000-4000-8000-000000000902', 'a0000000-0000-4000-8000-000000000001', 20, null);
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate)
select o, 'standard line', 1, 1000, 18
from unnest(array['a1000000-0000-4000-8000-000000000902', 'a1000000-0000-4000-8000-000000000903', 'a1000000-0000-4000-8000-000000000904',
                  'a1000000-0000-4000-8000-000000000905', 'a1000000-0000-4000-8000-000000000906', 'a1000000-0000-4000-8000-000000000907',
                  'a1000000-0000-4000-8000-000000000908', 'a1000000-0000-4000-8000-000000000909', 'a1000000-0000-4000-8000-000000000910']::uuid[]) o;
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000902', 'a1000000-0000-4000-8000-000000000902', 'ORC-0902', '2025-01-10', 1000, 180),
  ('e1000000-0000-4000-8000-000000000903', 'a1000000-0000-4000-8000-000000000903', 'ORC-0903', '2025-01-10', 1000, 180),
  ('e1000000-0000-4000-8000-000000000906', 'a1000000-0000-4000-8000-000000000906', 'ORC-0906', '2025-01-10', 1000, 180),
  ('e1000000-0000-4000-8000-000000000907', 'a1000000-0000-4000-8000-000000000907', 'ORC-0907A', '2024-02-09', 500, 90),
  ('e1000000-0000-4000-8000-000000000908', 'a1000000-0000-4000-8000-000000000907', 'ORC-0907B', '2024-03-01', 500, 90),
  ('e1000000-0000-4000-8000-000000000909', 'a1000000-0000-4000-8000-000000000908', 'ORC-0908A', '2024-02-09', 500, 90),
  ('e1000000-0000-4000-8000-000000000910', 'a1000000-0000-4000-8000-000000000908', 'ORC-0908B', '2024-03-01', 500, 90),
  ('e1000000-0000-4000-8000-000000000911', 'a1000000-0000-4000-8000-000000000909', 'ORC-0909A', '2024-02-09', 500, 90),
  ('e1000000-0000-4000-8000-000000000912', 'a1000000-0000-4000-8000-000000000909', 'ORC-0909B', '2024-03-01', 500, 90),
  ('e1000000-0000-4000-8000-000000000913', 'a1000000-0000-4000-8000-000000000910', 'ORC-0910A', '2024-02-09', 500, 90),
  ('e1000000-0000-4000-8000-000000000914', 'a1000000-0000-4000-8000-000000000910', 'ORC-0910B', '2024-03-01', 500, 90);
insert into public.payments_in (id, order_id, received_on, amount) values
  ('a4000000-0000-4000-8000-000000000902', 'a1000000-0000-4000-8000-000000000902', '2025-02-01', 1179.00),
  ('a4000000-0000-4000-8000-000000000903', 'a1000000-0000-4000-8000-000000000903', '2025-02-01', 500.00),
  ('a4000000-0000-4000-8000-000000000904', 'a1000000-0000-4000-8000-000000000904', '2025-02-01', 2000.00),
  ('a4000000-0000-4000-8000-000000000907', 'a1000000-0000-4000-8000-000000000907', '2024-02-20', 590.00),
  ('a4000000-0000-4000-8000-000000000910', 'a1000000-0000-4000-8000-000000000910', '2024-02-20', 590.00);
insert into public.payments_in (id, order_id, received_on, amount, invoice_id) values
  ('a4000000-0000-4000-8000-000000000909', 'a1000000-0000-4000-8000-000000000909', '2024-02-20', 590.00, 'e1000000-0000-4000-8000-000000000912');

set local role authenticated;
select ok((select gross_target = 1180 and settled = 1179 and balance = 1.00 and overpaid_by = 0 and payment_state = 'settled'
                  and due_on = '2025-02-09' and not is_overdue
           from public.order_receivables('a1000000-0000-4000-8000-000000000902')),
  'O2: Rs 1 short is settled (allowance), balance 1.00 still shown; no terms -> company default 30 days: due 9 Feb 2025');
select ok((select balance = 680 and payment_state = 'overdue' and is_overdue and due_on = '2025-01-10'
           from public.order_receivables('a1000000-0000-4000-8000-000000000903')),
  'O3: terms 0 -> due on the invoice date; part paid and past due -> overdue, balance 680');
select ok((select balance = 0 and overpaid_by = 820 and payment_state = 'settled' and due_on is null
           from public.order_receivables('a1000000-0000-4000-8000-000000000904')),
  'O4: paid 2,000 on 1,180 -> settled, overpaid 820 shown separately, never netted into a balance');
select is((select count(*)::int from public.order_receivables('a1000000-0000-4000-8000-000000000905')), 0,
  'O5 (D-MR3): a cancelled order that was never invoiced owes nothing and is not listed');
select is((select balance from public.order_receivables('a1000000-0000-4000-8000-000000000906')), 1180.00::numeric,
  'O6 (D-MR3): a cancelled order that was invoiced keeps its real balance');
select is((select due_on from public.order_receivables('a1000000-0000-4000-8000-000000000907')), '2024-03-21'::date,
  'O7 (0123): the first invoice is paid, so the order follows the OLDEST UNPAID invoice: 1 Mar 2024 + 20 = 21 Mar 2024');
select is((select due_on from public.order_receivables('a1000000-0000-4000-8000-000000000908')), '2024-02-29'::date,
  'O8: nothing paid: the oldest unpaid is the first invoice, 9 Feb 2024 + 20 = 29 Feb 2024 (a leap day)');
select is((select due_on from public.order_receivables('a1000000-0000-4000-8000-000000000909')), '2024-02-29'::date,
  'O9 (0123): a payment tied to the second invoice leaves the first the oldest unpaid');
select is((select due_on from public.order_receivables('a1000000-0000-4000-8000-000000000910')), '2024-03-21'::date,
  'O10 (0123): an untied payment is placed oldest first, so the second invoice is the oldest unpaid');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where order_id = 'a1000000-0000-4000-8000-000000000909' and invoice_id = 'e1000000-0000-4000-8000-000000000911' and remaining = 590), 1,
  'aging (0123): the tied payment settled the second invoice; the first still ages in full');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where order_id = 'a1000000-0000-4000-8000-000000000909' and invoice_id = 'e1000000-0000-4000-8000-000000000912'), 0,
  'aging (0123): the invoice a payment was tied to is not aged');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where order_id = 'a1000000-0000-4000-8000-000000000910' and invoice_id = 'e1000000-0000-4000-8000-000000000913'), 0,
  'aging (0123): an untied payment settles the oldest invoice first');

-- The same figures through v_order_money (admin: order page, orders list, company page) for every order receivables lists.
select is((select count(*)::int
           from public.order_receivables() r
           join public.v_order_money m on m.order_id = r.order_id
           where r.order_id::text like 'a1000000-0000-4000-8000-0000000009%'
             and (r.gross_target, r.settled, r.balance, r.overpaid_by, r.due_on, r.payment_state)
                 is distinct from (m.gross_target, m.settled, m.receivable, m.overpaid_by, m.due_on, m.payment_state)), 0,
  'cross-check: order_receivables and v_order_money agree on gross, paid, balance, overpaid, due date and state for every listed order');

-- BUG-M2 (fixed in 0076): v_order_money had no D-MR3 filter, so the admin's order page, the admin's Orders list "balance" column
-- and the company page showed the full item gross of a cancelled, never-invoiced order as owed.
select is((select receivable from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000905'), 0.00::numeric,
  'BUG-M2: v_order_money.receivable of a cancelled, never-invoiced order is 0');

-- ================================================================== 4. margin: net sale less net cost (input tax is never a cost)
reset role;
insert into public.order_costs (order_id, expected_cost_pkr) values ('a1000000-0000-4000-8000-000000000902', 600);
insert into public.expenses (id, paid_on, amount_pkr, input_tax_pkr, category_id, order_id) values
  ('a5000000-0000-4000-8000-000000000901', '2025-01-05', 590, 90, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000902'),
  ('a5000000-0000-4000-8000-000000000902', '2025-01-06', 100, 0, 'ca7e0000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000902');
set local role authenticated;
select ok((select net_sale = 1000 and actual_cost = 600 and margin = 400 and margin_state = 'provisional' and expected_cost = 600
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000902'),
  'margin: 1,000 net sale - (590 - 90 input tax + 100 freight) = 400, provisional until costs are complete');
reset role;
update public.order_costs set costs_complete_at = now(), costs_complete_by = 'a0000000-0000-4000-8000-000000000001'
where order_id = 'a1000000-0000-4000-8000-000000000902';
set local role authenticated;
select is((select margin_state from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000902'), 'final',
  'margin: final once costs are marked complete');

-- ================================================================== 5. target progress (v_target_progress, my_target_progress_at)
-- O2 is owned by sales, so its payment of 1,179 on 1 Feb 2025 is credited to sales: net round(1179 x 1000 / 1180, 2) = 999.15.
-- Target Q1 2025 = 10,000. The quarter is over: on pace 10,000, behind 9,000.85. On 15 Feb 2025 (day 46 of 90): on pace
-- round(10,000 x 46 / 90, 2) = 5,111.11, behind 4,111.96.
reset role;
insert into public.targets (user_id, year, quarter, target_net_pkr) values ('a0000000-0000-4000-8000-000000000002', 2025, 1, 10000);
set local role authenticated;
select ok((select achieved_net = 999.15 and gap = 9000.85 and on_pace_net = 10000.00 and behind_pace = 9000.85 and excluded_count = 0
           from public.v_target_progress where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2025 and quarter = 1),
  'target: achieved is the net portion of credited payments (999.15); a past quarter is fully elapsed');
select is((select net_credited from public.v_month_team where user_id = 'a0000000-0000-4000-8000-000000000002' and month = '2025-02-01'),
  999.15::numeric, 'team: the month''s net credited to sales is the same 999.15');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok((select achieved_net = 999.15 and on_pace_net = 5111.11 and behind_pace = 4111.96 and quarter_end = '2025-03-31'
           from public.my_target_progress_at('2025-02-15 12:00:00+05')),
  'my target (sales, 15 Feb 2025, day 46 of 90): achieved 999.15, on pace 5,111.11, behind 4,111.96');
select ok((select year = 2025 and quarter = 2 from public.my_target_progress_at('2025-03-31 19:30:00+00')),
  'my target: 00:30 PKT on 1 April is already Q2 (it is still 31 March in UTC)');

-- ================================================================== 6. no refunds, no negative money
reset role;
select throws_ok($$insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000902', '2025-02-02', -10)$$,
  '23514', null, 'a payment cannot be negative or zero (refunds are not modelled)');
select throws_ok($$insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id) values ('2025-02-02', 100, 101, 'ca7e0000-0000-4000-8000-000000000011')$$,
  '23514', null, 'input tax can never exceed the amount paid');
select throws_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values ('a1000000-0000-4000-8000-000000000902', 'ORC-NEG', '2025-02-02', 100, 101)$$,
  '23514', null, 'an invoice''s GST can never exceed its net (no credit notes, no negative invoices)');

select * from finish();
rollback;
