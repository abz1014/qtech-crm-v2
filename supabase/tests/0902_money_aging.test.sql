-- 0902_money_aging (money verification): aging_as_of against hand-worked FIFO, the bucket edges, advances, legacy invoices
-- settled before cutover, and the cross-check with order_receivables (Receivables page, Today, order page balance).
-- Expected values are the TypeScript oracle's (src/test/money-oracle/oracle.ts agingAsOf). Known bugs are TODO tests.
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000911', 'Aging customer');

insert into public.orders (id, company_id, owner_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000911', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', null),  -- A1 FIFO
  ('a1000000-0000-4000-8000-000000000912', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', null),  -- A2 bucket edges
  ('a1000000-0000-4000-8000-000000000913', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', null),  -- A3 advance
  ('a1000000-0000-4000-8000-000000000914', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', null),  -- A4 Rs 0.50 short
  ('a1000000-0000-4000-8000-000000000915', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', null),  -- A5 undated legacy invoice
  ('a1000000-0000-4000-8000-000000000916', 'c0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000001', '2025-03-20');  -- A6 cancelled, advance

-- A1: three invoices (1,180 / 590 / 236) and payments 1,000 (20 Jan), 500 (1 Mar), 300 (5 Apr 2025).
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000911', 'a1000000-0000-4000-8000-000000000911', 'AGE-A1-1', '2025-01-01', 1000, 180),
  ('e1000000-0000-4000-8000-000000000912', 'a1000000-0000-4000-8000-000000000911', 'AGE-A1-2', '2025-02-15', 500, 90),
  ('e1000000-0000-4000-8000-000000000913', 'a1000000-0000-4000-8000-000000000911', 'AGE-A1-3', '2025-03-20', 200, 36);
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000911', '2025-01-20', 1000),
  ('a1000000-0000-4000-8000-000000000911', '2025-03-01', 500),
  ('a1000000-0000-4000-8000-000000000911', '2025-04-05', 300);

-- A2: six unpaid invoices of 118, aged 30, 31, 60, 61, 90 and 91 days on 30 June 2025.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-030', '2025-05-31', 100, 18),
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-031', '2025-05-30', 100, 18),
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-060', '2025-05-01', 100, 18),
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-061', '2025-04-30', 100, 18),
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-090', '2025-04-01', 100, 18),
  ('a1000000-0000-4000-8000-000000000912', 'AGE-A2-091', '2025-03-31', 100, 18);

-- A3 and A6: paid before any invoice.
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000913', 'advance line', 1, 10000, 18),
  ('a1000000-0000-4000-8000-000000000916', 'cancelled line', 1, 1000, 18);
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000913', '2025-03-10', 5000),
  ('a1000000-0000-4000-8000-000000000916', '2025-03-10', 700);

-- A4: invoiced 1,180 on 5 Jan 2025, paid 1,179.50 on 20 Jan.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000914', 'AGE-A4-1', '2025-01-05', 1000, 180);
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000914', '2025-01-20', 1179.50);

-- A5: an imported invoice with no date (a legacy flag allows it), 1,180, unpaid.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, legacy_flags, legacy_source) values
  ('a1000000-0000-4000-8000-000000000915', 'AGE-A5-OLD', null, 1000, 180, array['undated'], '{"test":"0902"}');

-- Legacy invoices with no order (company only): one settled before cutover, one still open.
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover) values
  ('e1000000-0000-4000-8000-000000000918', 'c0000000-0000-4000-8000-000000000911', 'AGE-OLD-PAID', '2024-06-01', 1000, 180, '{"test":"0902"}', true),
  ('e1000000-0000-4000-8000-000000000919', 'c0000000-0000-4000-8000-000000000911', 'AGE-OLD-OPEN', '2024-06-01', 500, 90, '{"test":"0902"}', false);

set local role authenticated;

-- ================================================================== FIFO to the oldest invoice
-- On 31 Mar 2025 1,500 has been received: INV 1 (1,180) is fully applied and not listed; INV 2 takes 320 and has 270 left,
-- 44 days old (31-60); INV 3 takes nothing, 236 left, 11 days old (0-30). The 5 April payment is after the date.
select is((select count(*)::int from public.aging_as_of('2025-03-31') where invoice_id = 'e1000000-0000-4000-8000-000000000911'), 0,
  'FIFO: the oldest invoice is paid first and drops off the aging');
select ok((select applied = 320 and remaining = 270 and age_days = 44 and bucket = '31-60' and gross = 590
           from public.aging_as_of('2025-03-31') where invoice_id = 'e1000000-0000-4000-8000-000000000912'),
  'FIFO: the second invoice takes what is left of 1,500 (320) and still has 270 in 31-60');
select ok((select applied = 0 and remaining = 236 and age_days = 11 and bucket = '0-30'
           from public.aging_as_of('2025-03-31') where invoice_id = 'e1000000-0000-4000-8000-000000000913'),
  'FIFO: the newest invoice is untouched: 236 in 0-30');
select is((select sum(remaining) from public.aging_as_of('2025-03-31') where order_id = 'a1000000-0000-4000-8000-000000000911'), 506.00::numeric,
  'FIFO: the order''s aging on 31 Mar is invoiced 2,006 - received 1,500 = 506');
select is((select sum(remaining) from public.aging_as_of(public.today_pkt()) where order_id = 'a1000000-0000-4000-8000-000000000911'),
  (select balance from public.order_receivables('a1000000-0000-4000-8000-000000000911')),
  'cross-check: today''s aging of A1 (206) equals its receivables balance (2,006 - 1,800)');

-- ================================================================== bucket edges (days since the invoice date)
select is((select string_agg(invoice_number || '=' || bucket, ',' order by invoice_number)
           from public.aging_as_of('2025-06-30') where order_id = 'a1000000-0000-4000-8000-000000000912'),
  'AGE-A2-030=0-30,AGE-A2-031=31-60,AGE-A2-060=31-60,AGE-A2-061=61-90,AGE-A2-090=61-90,AGE-A2-091=90+',
  'buckets: 30 days is 0-30, 31 and 60 are 31-60, 61 and 90 are 61-90, 91 is 90+');
select is((select string_agg(age_days::text, ',' order by invoice_number)
           from public.aging_as_of('2025-06-30') where order_id = 'a1000000-0000-4000-8000-000000000912'),
  '30,31,60,61,90,91', 'ages are calendar days from the invoice date (across 30- and 31-day months)');

-- ================================================================== advances
select ok((select kind = 'advance' and advance_held = 5000 and invoice_id is null and remaining is null
           from public.aging_as_of('2025-03-31') where order_id = 'a1000000-0000-4000-8000-000000000913'),
  'advance: paid with no invoice yet is held as an advance, never negative aging');
select is((select count(*)::int from public.aging_as_of('2025-03-09') where order_id = 'a1000000-0000-4000-8000-000000000913'), 0,
  'advance: not there before the payment date');
-- A cancelled order's advance is still money held (a refund may be due); receivables leave the order out (D-MR3).
select is((select advance_held from public.aging_as_of('2025-03-31') where order_id = 'a1000000-0000-4000-8000-000000000916'), 700.00::numeric,
  'advance on a cancelled, never-invoiced order is listed as held (money we still hold)');
select is((select count(*)::int from public.order_receivables('a1000000-0000-4000-8000-000000000916')), 0,
  'while order_receivables leaves that order out (D-MR3): the 700 shows only on the aging');

-- ================================================================== legacy invoices (owner decision 2026-10-19, migration 0068)
select is((select count(*)::int from public.aging_as_of('2025-06-30') where invoice_id = 'e1000000-0000-4000-8000-000000000918'), 0,
  'settled before cutover: fully received, never in the aging');
select ok((select remaining = 590 and applied = 0 and order_id is null and company_id = 'c0000000-0000-4000-8000-000000000911' and bucket = '90+'
           from public.aging_as_of('2025-06-30') where invoice_id = 'e1000000-0000-4000-8000-000000000919'),
  'an open legacy invoice with no order is aged in full under its company');
select ok((select invoice_count = 2 and net = 1500 and gst = 270 from public.v_gst_month where month = '2024-06-01'),
  'settled before cutover is still a sale with output GST in the GST month');
select is((select public.stamp_payment_reminder(array['e1000000-0000-4000-8000-000000000918', 'e1000000-0000-4000-8000-000000000919']::uuid[])), 1,
  'a reminder stamps only the open legacy invoice');

-- ================================================================== the same money on two screens: aging vs receivables
-- BUG-M3: order_receivables calls A4 settled (1,179.50 >= 1,180 - 1, the Rs 1 allowance) and the Receivables page, Today and
-- the order page treat it as paid; aging_as_of has no allowance, so the 0.50 sits in the month-end aging (and every month's
-- frozen snapshot) as an unpaid invoice that only grows older (90+). Every order settled within the allowance does this.
select ok((select payment_state = 'settled' and balance = 0.50 from public.order_receivables('a1000000-0000-4000-8000-000000000914')),
  'A4: receivables say settled (within Rs 1)');
-- (fixed in 0076: aging_as_of applies the same allowance)
select is((select count(*)::int from public.aging_as_of('2025-06-30') where order_id = 'a1000000-0000-4000-8000-000000000914'), 0,
  'BUG-M3: an order receivables call settled has no aging row');

-- BUG-M9: an imported invoice with no date counts in order_receivables (balance 1,180, but never a due date, so never overdue
-- and never on Today) and is left out of the aging entirely (invoice_date <= p_date is not true for NULL).
-- (fixed in 0076: the due basis of an undated invoice is the order date, else the import date)
select ok((select balance = 1180 and due_on = o.ordered_on + 30 and not is_overdue and payment_state = 'unpaid'
           from public.order_receivables('a1000000-0000-4000-8000-000000000915')
           cross join (select ordered_on from public.orders where id = 'a1000000-0000-4000-8000-000000000915') o),
  'A5: the undated legacy invoice is owed in receivables, due order date + 30 days');
select is((select due_on from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000915'),
  (select due_on from public.order_receivables('a1000000-0000-4000-8000-000000000915')),
  'A5: v_order_money has the same due date');
select is((select coalesce(sum(remaining), 0) from public.aging_as_of(public.today_pkt()) where order_id = 'a1000000-0000-4000-8000-000000000915'),
  1180.00::numeric, 'BUG-M9: the undated invoice is aged');
reset role;
update public.orders set ordered_on = '2025-01-01' where id = 'a1000000-0000-4000-8000-000000000915';
set local role authenticated;
select ok((select is_overdue and payment_state = 'overdue' and due_on = '2025-01-31'
           from public.order_receivables('a1000000-0000-4000-8000-000000000915')),
  'BUG-M9: an undated invoice on an order of 1 Jan 2025 falls due 31 Jan 2025 and is overdue');
select ok((select bucket = '90+' and invoice_date = '2025-01-01' from public.aging_as_of(public.today_pkt())
           where order_id = 'a1000000-0000-4000-8000-000000000915'),
  'BUG-M9: and ages from the order date (90+)');

select * from finish();
rollback;
