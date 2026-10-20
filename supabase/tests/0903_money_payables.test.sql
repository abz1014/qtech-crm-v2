-- 0903_money_payables (money verification): "we owe" (payables_as_of, strict: D-MR4) against hand-worked legs.
-- committed = latest PO total, else sum(qty x supplier price); x the rate (PKR 1; else the latest rate on or before the date and
-- at most 30 days old, manual first on the same day), rounded once; paid = supplier payments' net cost (amount - input tax)
-- dated on or before the date; owed = committed - paid, never below 0; settled within 3% of committed.
-- Expected values are the TypeScript oracle's (src/test/money-oracle/oracle.ts payablesAsOf).
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000921', 'Payables customer'),
  ('c0000000-0000-4000-8000-000000000922', 'Payables supplier');
insert into public.orders (id, company_id, owner_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000921', 'a0000000-0000-4000-8000-000000000001', null),
  ('a1000000-0000-4000-8000-000000000922', 'c0000000-0000-4000-8000-000000000921', 'a0000000-0000-4000-8000-000000000001', '2025-03-15');

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on) values
  ('a2000000-0000-4000-8000-000000000921', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L1 PKR lines
  ('a2000000-0000-4000-8000-000000000922', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'USD', '2025-03-01', '2025-04-30'),  -- L2 USD lines
  ('a2000000-0000-4000-8000-000000000923', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'USD', '2025-03-01', '2025-04-30'),  -- L3 EUR PO
  ('a2000000-0000-4000-8000-000000000924', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L4 no price
  ('a2000000-0000-4000-8000-000000000925', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-05-01', '2025-06-30'),  -- L5 placed later
  ('a2000000-0000-4000-8000-000000000926', 'a1000000-0000-4000-8000-000000000922', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L6 order cancelled 15 Mar
  ('a2000000-0000-4000-8000-000000000927', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L7 overpaid
  ('a2000000-0000-4000-8000-000000000928', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L8 3% exactly
  ('a2000000-0000-4000-8000-000000000929', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30');  -- L9 3% + 1 paisa

insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  ('a1000000-0000-4000-8000-000000000921', 'L1 a', 2, 1500, 18, 'a2000000-0000-4000-8000-000000000921', 1000.5000),
  ('a1000000-0000-4000-8000-000000000921', 'L1 b', 3, 500, 18, 'a2000000-0000-4000-8000-000000000921', 333.3333),
  ('a1000000-0000-4000-8000-000000000921', 'L2', 1, 40000, 18, 'a2000000-0000-4000-8000-000000000922', 100.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L3 (stale item price, the PO wins)', 3, 5000, 18, 'a2000000-0000-4000-8000-000000000923', 9.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L4 no supplier price', 1, 100, 18, 'a2000000-0000-4000-8000-000000000924', null),
  ('a1000000-0000-4000-8000-000000000921', 'L5', 1, 100, 18, 'a2000000-0000-4000-8000-000000000925', 50.0000),
  ('a1000000-0000-4000-8000-000000000922', 'L6', 1, 200, 18, 'a2000000-0000-4000-8000-000000000926', 100.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L7', 1, 200, 18, 'a2000000-0000-4000-8000-000000000927', 100.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L8', 1, 2000, 18, 'a2000000-0000-4000-8000-000000000928', 1000.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L9', 1, 2000, 18, 'a2000000-0000-4000-8000-000000000929', 1000.0000);

-- L3: two PO revisions in EUR (the PO's own currency wins over the leg's). R0 2 x 10.005 = 20.01; R1 3 x 10.005 = 30.015 -> 30.02.
insert into public.purchase_orders (supplier_order_id, number, revision, issued_on, currency, lines) values
  ('a2000000-0000-4000-8000-000000000923', 990921, 0, '2025-03-01', 'EUR', '[{"qty": 2, "unit_price": 10.005}]'),
  ('a2000000-0000-4000-8000-000000000923', 990921, 1, '2025-03-02', 'EUR', '[{"qty": 3, "unit_price": 10.005}]');

insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('USD', 280.000000, '2025-02-01', 'auto'),
  ('USD', 279.500000, '2025-03-03', 'auto'),
  ('USD', 281.250000, '2025-03-03', 'manual'),
  ('EUR', 300.000000, '2025-03-01', 'manual');

-- Supplier payments (category 0011) on the legs, plus a freight bill on L1 that is not a payment to the supplier.
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, order_id, supplier_order_id) values
  ('2025-03-05', 2360.00, 360.00, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000921'),
  ('2025-04-10', 1000.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000921'),
  ('2025-03-06', 500.00, 0, 'ca7e0000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000921'),
  ('2025-03-07', 150.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000927'),
  ('2025-03-07', 970.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000928'),
  ('2025-03-07', 969.99, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000929');

set local role authenticated;

-- ---------------------------------------------------------------- L1 PKR from the lines
-- committed 2 x 1000.5 + 3 x 333.3333 = 3000.9999 -> 3001.00 PKR; paid by 31 Mar 2,360 - 360 input tax = 2,000 (freight is not
-- a payment to the supplier); owed 1,001.00 > 3% of 3,001 (90.03): owing. By 30 Apr 3,000 paid: 1.00 left, settled.
select ok((select currency = 'PKR' and fx_rate = 1 and committed_pkr = 3001.00 and paid_pkr = 2000.00 and owed_pkr = 1001.00 and state = 'owing'
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000921'),
  'L1: committed 3,001.00 from the lines, paid is net of input tax (2,000), freight is not counted, owed 1,001.00');
select ok((select paid_pkr = 3000.00 and owed_pkr = 1.00 and state = 'settled' and flag is null
           from public.payables_as_of('2025-04-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000921'),
  'L1: 1.00 left of 3,001 is within 3%: settled, and the 1.00 is still reported');

-- ---------------------------------------------------------------- L2 USD: which rate
select ok((select fx_rate = 280 and committed_pkr = 28000.00 from public.payables_as_of('2025-03-02') where supplier_order_id = 'a2000000-0000-4000-8000-000000000922'),
  'L2 on 2 Mar: the latest rate on or before the date (1 Feb, 29 days old) is used');
select ok((select fx_rate = 281.25 and committed_pkr = 28125.00 and owed_pkr = 28125.00 and state = 'owing'
           from public.payables_as_of('2025-03-03') where supplier_order_id = 'a2000000-0000-4000-8000-000000000922'),
  'L2 on 3 Mar: the manual rate beats the automatic one of the same day');
select ok((select fx_rate = 281.25 from public.payables_as_of('2025-04-02') where supplier_order_id = 'a2000000-0000-4000-8000-000000000922'),
  'L2 on 2 Apr: a rate exactly 30 days old is still used');
select ok((select state = 'no_rate' and fx_rate is null and committed_pkr is null and owed_pkr is null and committed = 100
           from public.payables_as_of('2025-04-03') where supplier_order_id = 'a2000000-0000-4000-8000-000000000922'),
  'L2 on 3 Apr: 31 days old is unusable, the leg needs a rate (D-MR4)');

-- ---------------------------------------------------------------- L3 the latest PO revision, in its own currency
select ok((select currency = 'EUR' and committed = 30.02 and fx_rate = 300 and committed_pkr = 9006.00
           from public.payables_as_of('2025-03-10') where supplier_order_id = 'a2000000-0000-4000-8000-000000000923'),
  'L3: the latest PO revision (3 x 10.005 = 30.015 -> 30.02 EUR) at 300 = 9,006.00, not the item price');

-- ---------------------------------------------------------------- what is in and out of the list
select ok((select state = 'unpriced' and committed is null and owed_pkr is null
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000924'),
  'L4: a leg with no supplier price and no PO is unpriced');
select is((select count(*)::int from public.payables_as_of('2025-04-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000925'), 0,
  'L5: a leg placed after the date is not owed yet');
select is((select count(*)::int from public.payables_as_of('2025-03-14') where supplier_order_id = 'a2000000-0000-4000-8000-000000000926'), 1,
  'L6: owed while its order is live');
select is((select count(*)::int from public.payables_as_of('2025-03-15') where supplier_order_id = 'a2000000-0000-4000-8000-000000000926'), 0,
  'L6: gone from the day its order is cancelled');

-- ---------------------------------------------------------------- over-payment and the 3% line
select ok((select owed_pkr = 0 and paid_pkr = 150 and flag = 'overpaid' and state = 'settled'
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000927'),
  'L7: paid 150 on 100 -> owed 0 (never negative), flagged overpaid');
select ok((select owed_pkr = 30.00 and state = 'settled' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000928'),
  'L8: exactly 3% left (30 of 1,000) is settled');
select ok((select owed_pkr = 30.01 and state = 'owing' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000929'),
  'L9: 3% plus one paisa left is owing');

-- ---------------------------------------------------------------- totals the We owe screen adds up
select is((select sum(owed_pkr) filter (where state = 'owing') from public.payables_as_of('2025-03-31')
           where supplier_order_id::text like 'a2000000-0000-4000-8000-00000000092%'), 1001.00 + 28125.00 + 9006.00 + 30.01,
  'we owe on 31 Mar: L1 1,001.00 + L2 28,125.00 + L3 9,006.00 + L9 30.01');

select * from finish();
rollback;
