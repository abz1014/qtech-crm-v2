-- 0058_money_review: the database bugs the money review found (docs/MONEY_REVIEW.md, MR-6 and MR-7; each failed before 0058),
-- and the owner decisions of 2026-10-19 (D-MR2 frozen closed months, D-MR3 cancelled receivables, D-MR4 strict we owe).
begin;
select plan(34);

-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000058', 'Review customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000058', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ MR-6 the invoice series rolls past its digit width
-- lpad() truncates a longer string, so INV-9999 + 1 came out as INV-1000: an old number, refused by the unique index.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', 'INV-9999', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-10000', 'MR-6: INV-9999 is followed by INV-10000, not INV-1000');
reset role;

delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', '99', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), '100', 'MR-6: a bare 99 is followed by 100');
reset role;

delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', 'INV-0041', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-0042', 'MR-6: the zero padding is still kept');
reset role;
delete from public.invoices;

-- ------------------------------------------------------------------ MR-7 an exempt invoice has no tax to deposit
-- January 2026 (a past month): one invoice at 18%, one exempt (GST 0). Neither is deposited.
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000058', 'INV-0101', '2026-01-10', 1000, 180),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000058', 'INV-0102', '2026-01-12', 1000, 0);

set local role authenticated;
select is((select needs_fbr_attention from public.v_invoice_state where invoice_id = 'e1000000-0000-4000-8000-000000000001'), true,
  'MR-7: an 18% invoice of a past month with no deposit needs FBR attention');
select is((select needs_fbr_attention from public.v_invoice_state where invoice_id = 'e1000000-0000-4000-8000-000000000002'), false,
  'MR-7: an exempt invoice (GST 0) never needs a deposit');
select is((select needs_fbr_attention from public.v_gst_register where invoice_id = 'e1000000-0000-4000-8000-000000000002'), false,
  'MR-7: and the GST register does not flag it');
select is((select n from public.month_end_status('2026-01-01') where check_key = 'fbr_pending'), 1,
  'MR-7: the month-end checklist counts only the invoice with tax to deposit');
select is((select gst_to_deposit from public.v_gst_month where month = '2026-01-01'), 180.00::numeric,
  'MR-7: GST still to deposit is unchanged (the exempt invoice adds 0)');

-- sales read the register too: the same answer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.v_gst_register where needs_fbr_attention and invoice_month = '2026-01-01'), 1,
  'MR-7: sales see one invoice needing attention, not two');

-- ================================================================== owner decisions of 2026-10-19
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ D-MR3 cancelled orders in receivables
-- Three orders of one customer, each with one 18% line of 1,000: live; cancelled with no invoice; cancelled but invoiced.
insert into public.orders (id, company_id, owner_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000061', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000000062', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002', '2026-02-01'),
  ('a1000000-0000-4000-8000-000000000063', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002', '2026-02-01');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000061', 'live', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000062', 'cancelled, never invoiced', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000063', 'cancelled after supply', 1, 1000, 18);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000063', 'INV-C63', '2026-01-05', 1000, 180);

set local role authenticated;
select is((select count(*)::int from public.order_receivables() where order_id = 'a1000000-0000-4000-8000-000000000061'), 1,
  'D-MR3: a live order is in order_receivables');
select is((select count(*)::int from public.order_receivables() where order_id = 'a1000000-0000-4000-8000-000000000062'), 0,
  'D-MR3: a cancelled order with no invoice is not (nothing is owed on it)');
select ok((select balance = 1180.00 and is_overdue is not null from public.order_receivables()
           where order_id = 'a1000000-0000-4000-8000-000000000063'),
  'D-MR3: a cancelled order that was invoiced stays, with its real balance');
select is((select count(*)::int from public.order_receivables('a1000000-0000-4000-8000-000000000062')), 0,
  'D-MR3: asked for by id, the cancelled uninvoiced order is still left out');
reset role;

-- ------------------------------------------------------------------ D-MR4 we owe is strict
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000064', 'Review supplier');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000064', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on) values
  ('a2000000-0000-4000-8000-000000000064', 'a1000000-0000-4000-8000-000000000064', 'c0000000-0000-4000-8000-000000000064', 'USD', '2026-03-01'),
  ('a2000000-0000-4000-8000-000000000065', 'a1000000-0000-4000-8000-000000000064', 'c0000000-0000-4000-8000-000000000064', 'PKR', '2026-03-01');
insert into public.order_items (order_id, description, qty, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('a1000000-0000-4000-8000-000000000064', 'USD part', 1, 50000, 'a2000000-0000-4000-8000-000000000064', 100),
  ('a1000000-0000-4000-8000-000000000064', 'PKR part', 1, 5000, 'a2000000-0000-4000-8000-000000000065', 2000);
insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('USD', 280, '2026-02-15', 'manual');
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, supplier_order_id, order_id) values
  ('2026-03-10', 1180, 180, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000065', 'a1000000-0000-4000-8000-000000000064');

set local role authenticated;
select ok((select state = 'no_rate' and fx_rate is null and owed_pkr is null
           from public.payables_as_of('2026-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000064'),
  'D-MR4: a USD rate 44 days old is unusable: the leg needs a rate');
select ok((select fx_rate = 280 and committed_pkr = 28000.00
           from public.payables_as_of('2026-03-10') where supplier_order_id = 'a2000000-0000-4000-8000-000000000064'),
  'D-MR4: the same rate 23 days old is used');
select ok((select paid_pkr = 1000.00 and owed_pkr = 1000.00 and state = 'owing'
           from public.payables_as_of('2026-03-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000065'),
  'D-MR4: paid is the net cost (1,180 less 180 input tax), so 1,000 of 2,000 is still owed');
reset role;

-- ------------------------------------------------------------------ D-MR2 a closed month is frozen
-- January 2026: one 18% order, paid in full by a payment of 1,180 (net 1,000 from the items), and an overhead of 100.
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000059', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (id, order_id, description, qty, unit_price_net, gst_rate) values
  ('a3000000-0000-4000-8000-000000000059', 'a1000000-0000-4000-8000-000000000059', 'freeze item', 1, 1000, 18);
insert into public.payments_in (id, order_id, received_on, amount) values
  ('a4000000-0000-4000-8000-000000000059', 'a1000000-0000-4000-8000-000000000059', '2026-01-15', 1180);
insert into public.expenses (paid_on, amount_pkr, category_id, description) values
  ('2026-01-20', 100, 'ca7e0000-0000-4000-8000-000000000010', 'review overhead');

set local role authenticated;
select is((select net_in from public.v_month_pnl where month = '2026-01-01'), 1000.00::numeric, 'D-MR2: January before the close: net in 1,000');
reset role;
create temp table jan_status_before as select check_key, n from public.month_end_status('2026-01-01');
set local role authenticated;
select lives_ok($select public.close_month('2026-01-01')$, 'D-MR2: January closes');
select ok((select frozen and frozen_at is not null and net_in = 1000.00 and overheads = 100.00 and result = 900.00
           from public.v_month_pnl where month = '2026-01-01'),
  'D-MR2: the closed month reads its snapshot: net in 1,000, result 900');

-- a later change that moves January's live figures: the order turns exempt, so the January payment is all net
reset role;
update public.order_items set gst_rate = 0 where id = 'a3000000-0000-4000-8000-000000000059';
update public.payments_in set bank_month = '2026-01-01' where id = 'a4000000-0000-4000-8000-000000000059';   -- a tick, allowed after close
set local role authenticated;
select is((select net_in from public.v_month_pnl_live where month = '2026-01-01'), 1180.00::numeric,
  'D-MR2: the live figure moved to 1,180');
select ok((select net_in = 1000.00 and result = 900.00 and adjust_result = 0 from public.v_month_pnl where month = '2026-01-01'),
  'D-MR2: the closed P&L is unchanged after the edit');
select ok((select net_in = 0 and adj_net_in = 180.00 and adj_gst_in = -180.00 and adjust_result = 180.00 and result = 180.00 and not frozen
           from public.v_month_pnl where month = '2026-02-01'),
  'D-MR2: the change shows in the first open month (February) as 180 of changes to closed months');
select is((select sum(result) from public.v_month_pnl where month in ('2026-01-01', '2026-02-01')),
          (select sum(net_in - order_costs - overheads) from public.v_month_pnl_live where month in ('2026-01-01', '2026-02-01')),
  'D-MR2: summed over the months, the result still equals the live books');
select is((select array_agg(check_key || '=' || n order by check_key) from public.month_end_status('2026-01-01')),
          (select array_agg(check_key || '=' || n order by check_key) from jan_status_before),
  'D-MR2: the closed month''s checklist counts are the ones saved at close (the later tick does not change them)');
select ok((select (s.payments ->> 'count')::int = 1 and jsonb_array_length(s.categories) = 1 from public.month_snapshots s where s.month = '2026-01-01'),
  'D-MR2: the snapshot holds the month''s payments and expense categories for the reports');

-- reopen: the snapshot is discarded and January recalculates; closing again saves the new figures
select lives_ok($select public.reopen_month('2026-01-01', 'review test')$, 'D-MR2: January reopens');
select is((select count(*)::int from public.month_snapshots where month = '2026-01-01'), 0, 'D-MR2: reopening discards the snapshot');
select ok((select net_in = 1180.00 and result = 1080.00 and not frozen from public.v_month_pnl where month = '2026-01-01'),
  'D-MR2: the reopened month recalculates: net in 1,180');
select is((select count(*)::int from public.v_month_pnl where month = '2026-02-01'), 0,
  'D-MR2: and February no longer carries an adjustment');
select lives_ok($select public.close_month('2026-01-01')$, 'D-MR2: January closes again');
select ok((select frozen and net_in = 1180.00 and adjust_result = 0 from public.v_month_pnl where month = '2026-01-01'),
  'D-MR2: closing again saves the new figures');

-- others read nothing
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.month_snapshots), 0, 'D-MR2: sales read no snapshot');
select is((select count(*)::int from public.v_month_pnl_live), 0, 'D-MR2: sales read no live P&L');
select ok(public.month_pnl_drift() is null, 'D-MR2: the drift helper answers NULL to sales');

select * from finish();
rollback;
