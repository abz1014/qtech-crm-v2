-- 0903_money_payables (money verification): "we owe" (payables_as_of, strict: D-MR4) against hand-worked legs.
-- committed = latest PO total, else sum(qty x supplier price); x the rate (PKR 1; else the latest rate on or before the date and
-- at most 30 days old, manual first on the same day), rounded once; paid = supplier payments' net cost (amount - input tax)
-- dated on or before the date; owed = committed - paid, never below 0; settled within 3% of committed for a foreign-currency leg
-- (0121: exchange-rate slippage) and within Rs 1 for a PKR leg. 0121: a leg of a cancelled customer order stays owed until it is
-- cancelled with the supplier (unless a payment was made on it).
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
  ('a2000000-0000-4000-8000-000000000929', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L9 3% + 1 paisa
  ('a2000000-0000-4000-8000-000000000930', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L10 Rs 1 left
  ('a2000000-0000-4000-8000-000000000931', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L11 Rs 1.01 left
  ('a2000000-0000-4000-8000-000000000932', 'a1000000-0000-4000-8000-000000000921', 'c0000000-0000-4000-8000-000000000922', 'USD', '2025-03-01', '2025-04-30'),  -- L12 USD, 2.9% left
  ('a2000000-0000-4000-8000-000000000933', 'a1000000-0000-4000-8000-000000000922', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30'),  -- L13 cancelled order, cancelled with the supplier 20 Mar, nothing paid
  ('a2000000-0000-4000-8000-000000000934', 'a1000000-0000-4000-8000-000000000922', 'c0000000-0000-4000-8000-000000000922', 'PKR', '2025-03-01', '2025-04-30');  -- L14 cancelled order, cancelled with the supplier 20 Mar, 40 paid
update public.supplier_orders set cancelled_with_supplier_on = '2025-03-20'
 where id in ('a2000000-0000-4000-8000-000000000933', 'a2000000-0000-4000-8000-000000000934');

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
  ('a1000000-0000-4000-8000-000000000921', 'L9', 1, 2000, 18, 'a2000000-0000-4000-8000-000000000929', 1000.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L10', 1, 2000, 18, 'a2000000-0000-4000-8000-000000000930', 1000.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L11', 1, 2000, 18, 'a2000000-0000-4000-8000-000000000931', 1000.0000),
  ('a1000000-0000-4000-8000-000000000921', 'L12', 1, 40000, 18, 'a2000000-0000-4000-8000-000000000932', 100.0000),
  ('a1000000-0000-4000-8000-000000000922', 'L13', 1, 200, 18, 'a2000000-0000-4000-8000-000000000933', 100.0000),
  ('a1000000-0000-4000-8000-000000000922', 'L14', 1, 200, 18, 'a2000000-0000-4000-8000-000000000934', 100.0000);

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
  ('2025-03-07', 969.99, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000929'),
  ('2025-03-07', 999.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000930'),
  ('2025-03-07', 998.99, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000931'),
  ('2025-03-07', 27300.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000921', 'a2000000-0000-4000-8000-000000000932'),
  ('2025-03-10', 40.00, 0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000922', 'a2000000-0000-4000-8000-000000000934');

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
select ok((select owed_pkr = 100.00 and state = 'owing' and cancelled_with_supplier_on is null
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000926'),
  'L6 (0121): still owed after its customer order is cancelled on 15 Mar, because the supplier never cancelled it');
select is((select count(*)::int from public.payables_as_of('2025-03-19') where supplier_order_id = 'a2000000-0000-4000-8000-000000000933'), 1,
  'L13: owed the day before it is cancelled with the supplier');
select is((select count(*)::int from public.payables_as_of('2025-03-20') where supplier_order_id = 'a2000000-0000-4000-8000-000000000933'), 0,
  'L13 (0121): gone from the day it is cancelled with the supplier, nothing having been paid');
select ok((select owed_pkr = 60.00 and paid_pkr = 40.00 and state = 'owing' and cancelled_with_supplier_on = '2025-03-20'
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000934'),
  'L14 (0121): cancelled with the supplier but part paid: stays on the list for what is left, marked cancelled');

-- ---------------------------------------------------------------- over-payment and the 3% line
select ok((select owed_pkr = 0 and paid_pkr = 150 and flag = 'overpaid' and state = 'settled'
           from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000927'),
  'L7: paid 150 on 100 -> owed 0 (never negative), flagged overpaid');
select ok((select owed_pkr = 30.00 and state = 'owing' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000928'),
  'L8 (0121): 3% left (30 of 1,000) on a PKR leg is owing: the 3% is for foreign currency only');
select ok((select owed_pkr = 30.01 and state = 'owing' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000929'),
  'L9: 3% plus one paisa left is owing');
select ok((select owed_pkr = 1.00 and state = 'settled' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000930'),
  'L10 (0121): Rs 1 left on a PKR leg is settled');
select ok((select owed_pkr = 1.01 and state = 'owing' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000931'),
  'L11 (0121): Rs 1.01 left on a PKR leg is owing');
select ok((select committed_pkr = 28125.00 and owed_pkr = 825.00 and state = 'settled' from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000932'),
  'L12 (0121): a USD leg with 2.9% left is still settled (exchange-rate slippage)');

-- ---------------------------------------------------------------- totals the We owe screen adds up
select is((select sum(owed_pkr) filter (where state = 'owing') from public.payables_as_of('2025-03-31')
           where supplier_order_id::text like 'a2000000-0000-4000-8000-00000000092%'), 1001.00 + 28125.00 + 9006.00 + 100.00 + 30.00 + 30.01,
  'we owe on 31 Mar: L1 1,001.00 + L2 28,125.00 + L3 9,006.00 + L6 100.00 + L8 30.00 + L9 30.01');

-- ---------------------------------------------------------------- the admin marks a supplier order cancelled with the supplier
select lives_ok($$select public.set_supplier_order_cancelled('a2000000-0000-4000-8000-000000000926', true, '2025-03-25')$$, 'admin: cancel with the supplier');
select is((select count(*)::int from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000926'), 0,
  'L6 (0121): off the list once cancelled with the supplier');
select lives_ok($$select public.set_supplier_order_cancelled('a2000000-0000-4000-8000-000000000926', false)$$, 'admin: live with the supplier again');
select is((select count(*)::int from public.payables_as_of('2025-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000926'), 1,
  'L6 (0121): back on the list when un-cancelled');

select * from finish();
rollback;
