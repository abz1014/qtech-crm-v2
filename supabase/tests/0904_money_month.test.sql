-- 0904_money_month (money verification): the cash P&L by month, its category, cash and team views, the GST month against the
-- GST register, the month-end checklist against its details, and month close (D-MR2: frozen at close, later changes shown once,
-- reopen recalculates, the books still add up). Expected values are hand-worked and equal the TypeScript oracle's
-- (src/test/money-oracle/pgtapFixtures.test.ts). Known bugs are TODO tests with their BUG id.
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000931', 'Month customer');
-- M1 (sales): 1 x 1,000 at 18% (gross 1,180). M2 (admin): 1 x 500 exempt. M3: legacy, value basis unknown. M4: worth 0.
insert into public.orders (id, company_id, owner_id, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000931', 'c0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000002', '{}'),
  ('a1000000-0000-4000-8000-000000000932', 'c0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000001', '{}'),
  ('a1000000-0000-4000-8000-000000000933', 'c0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000001', array['value_basis_unknown']),
  ('a1000000-0000-4000-8000-000000000934', 'c0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000001', '{}');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000931', 'M1', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000932', 'M2 exempt', 1, 500, 0),
  ('a1000000-0000-4000-8000-000000000933', 'M3 legacy', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000934', 'M4 free of charge', 1, 0, 18);
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000931', 'a1000000-0000-4000-8000-000000000931', 'MON-0001', '2025-01-31', 1000, 180),
  ('e1000000-0000-4000-8000-000000000932', 'a1000000-0000-4000-8000-000000000932', 'MON-0002', '2025-02-01', 500, 0);
-- Payments: M1 590 on the last day of January and 590 on the first of February (month boundary); M2 200, imported with no
-- person (unattributed: company cash, nobody's target); M3 300 and M4 50 cannot be split into net (unresolved).
insert into public.payments_in (id, order_id, received_on, amount, legacy_source) values
  ('a4000000-0000-4000-8000-000000000931', 'a1000000-0000-4000-8000-000000000931', '2025-01-31', 590, null),
  ('a4000000-0000-4000-8000-000000000932', 'a1000000-0000-4000-8000-000000000931', '2025-02-01', 590, null),
  ('a4000000-0000-4000-8000-000000000933', 'a1000000-0000-4000-8000-000000000932', '2025-01-15', 200, '{"test":"0904"}'),
  ('a4000000-0000-4000-8000-000000000934', 'a1000000-0000-4000-8000-000000000933', '2025-01-20', 300, null),
  ('a4000000-0000-4000-8000-000000000935', 'a1000000-0000-4000-8000-000000000934', '2025-01-21', 50, null);
-- Expenses: January salaries 10,000 and rent 5,000 (overheads), a supplier payment 1,180 with 180 input tax (order cost 1,000),
-- owner drawings 2,000 (not in P&L); February freight 300 (order cost).
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, order_id, description) values
  ('2025-01-31', 10000, 0, 'ca7e0000-0000-4000-8000-000000000001', null, 'salaries'),
  ('2025-01-31', 5000, 0, 'ca7e0000-0000-4000-8000-000000000002', null, 'rent'),
  ('2025-01-10', 1180, 180, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000931', 'supplier'),
  ('2025-01-05', 2000, 0, 'ca7e0000-0000-4000-8000-000000000016', null, 'drawings'),
  ('2025-02-01', 300, 0, 'ca7e0000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000931', 'freight');

set local role authenticated;

-- ================================================================== P&L, cash by month (Karachi calendar months)
-- January: net in 500 (M1, 590 x 1000/1180) + 200 (M2, exempt: all net) = 700; GST in 90; unresolved 300 + 50 = 350;
-- order costs 1,000; overheads 15,000; result -15,300; drawings 2,000; after drawings -17,300; cash out 18,180; input tax 180.
select ok((select net_in = 700 and gst_in = 90 and unresolved_gross = 350 and order_costs = 1000 and overheads = 15000
                  and result = -15300 and non_pnl_out = 2000 and after_drawings = -17300 and cash_out_total = 18180 and input_tax = 180
                  and not frozen and adjust_result = 0
           from public.v_month_pnl where month = '2025-01-01'),
  'P&L January 2025: net in 700, GST 90, unresolved 350, costs 1,000 + 15,000, result -15,300, after drawings -17,300');
select ok((select net_in = 500 and gst_in = 90 and unresolved_gross = 0 and order_costs = 300 and overheads = 0 and result = 200
                  and cash_out_total = 300 and input_tax = 0
           from public.v_month_pnl where month = '2025-02-01'),
  'P&L February 2025: the payment of 1 Feb and the freight of 1 Feb land in February, not January');
select ok((select gross_received = 1140 and gst_received = 90 and net_received = 700 and unresolved_gross = 350 and unresolved_count = 2
                  and money_out = 18180
           from public.v_cash_month where month = '2025-01-01'),
  'cash month January: gross 1,140 = net 700 + GST 90 + unresolved 350; money out is the full bank/cash 18,180');
select is((select count(*)::int from (
             select c.month, c.grp, sum(c.net_cost) as net from public.v_month_expense_category c
             where c.month in ('2025-01-01', '2025-02-01') group by 1, 2) x
           join public.v_month_pnl p on p.month = x.month
           where x.net is distinct from case x.grp when 'order_cost' then p.order_costs when 'overhead' then p.overheads else p.non_pnl_out end), 0,
  'cross-check: expenses by category, added up by group, equal the P&L order costs, overheads and not-in-P&L lines');
select is((select net_credited from public.v_month_team where month = '2025-01-01' and user_id = 'a0000000-0000-4000-8000-000000000002'), 500.00::numeric,
  'team January: sales are credited 500 net (M1); the unattributed 200 and the unresolved payments count for nobody');
select is((select coalesce(sum(t.net_credited), 0) from public.v_month_team t where t.month = '2025-01-01')
          + (select sum(net_portion) from public.v_payment_net where received_on between '2025-01-01' and '2025-01-31' and excluded_reason = 'unattributed'),
  (select net_in from public.v_month_pnl where month = '2025-01-01'),
  'cross-check: team net credited + unattributed net = P&L net in');

-- ================================================================== GST month vs the GST register (by invoice date)
select ok((select invoice_count = 1 and net = 1000 and gst = 180 and gst_to_deposit = 180 and input_tax = 180 and deposited_count = 0
           from public.v_gst_month where month = '2025-01-01'),
  'GST January: output GST 180 and input tax 180 shown side by side, never netted (to deposit stays 180)');
select ok((select invoice_count = 1 and net = 500 and gst = 0 and gst_to_deposit = 0 and input_tax = 0 from public.v_gst_month where month = '2025-02-01'),
  'GST February: the exempt invoice adds 0 GST');
select is((select count(*)::int from public.v_gst_month g
           left join (select invoice_month, count(*)::int as n, sum(net_amount) as net, sum(gst_amount) as gst
                      from public.v_gst_register group by 1) r on r.invoice_month = g.month
           where g.month in ('2025-01-01', '2025-02-01')
             and (r.n, r.net, r.gst) is distinct from (g.invoice_count, g.net, g.gst)), 0,
  'cross-check: the GST register''s month totals equal the GST/FBR month report');

-- ================================================================== the month-end checklist and its details
select is((select string_agg(check_key || '=' || n, ',' order by check_key) from public.month_end_status('2025-01-01')),
  'bank_unticked=8,fbr_deposits_unticked=0,fbr_pending=1,provisional_margins=0,recurring_not_recorded=0,uncategorised=0,unresolved_payments=2',
  'checklist January: 8 bank items unticked, 1 invoice with GST pending, 2 unresolved payments');
select is((select n from public.month_end_status('2025-02-01') where check_key = 'provisional_margins'), 1,
  'checklist February: M1 is paid in full (1,180) by the end of February with costs not complete');
select is((select n from public.month_end_status('2025-02-01') where check_key = 'fbr_pending'), 1,
  'checklist February: FBR pending counts only invoices with GST to deposit (MR-7): MON-0001, not the exempt MON-0002');
select is((select (detail ->> 'amount')::numeric from public.month_end_check_details('2025-02-01') where check_key = 'fbr_pending'), 180.00::numeric,
  'details February: GST not deposited 180');
-- BUG-M4 (fixed in 0074): month_end_check_details' "pending" list had no gst_amount > 0 filter, so the card named the exempt
-- invoice as unpaid tax under a count of 1. It now uses the same predicate as the count.
select is((select jsonb_array_length(detail -> 'invoices') from public.month_end_check_details('2025-02-01') where check_key = 'fbr_pending'), 1,
  'BUG-M4: the details list exactly the invoices the count counts');

-- ================================================================== month close (D-MR2)
select lives_ok($$select public.close_month('2025-01-01')$$, 'close January 2025');
select ok((select frozen and net_in = 700 and result = -15300 from public.v_month_pnl where month = '2025-01-01'),
  'closed January reads its snapshot (the same figures)');
select is((select string_agg(check_key || '=' || n, ',' order by check_key) from public.month_end_status('2025-01-01')),
  'bank_unticked=8,fbr_deposits_unticked=0,fbr_pending=1,provisional_margins=0,recurring_not_recorded=0,uncategorised=0,unresolved_payments=2',
  'closed January''s checklist is frozen with the same counts');
select is((select jsonb_array_length(aging) from public.month_snapshots where month = '2025-01-01'),
  (select count(*)::int from public.aging_as_of('2025-01-31')),
  'the snapshot holds the aging as of 31 January (one invoice, three advances)');

reset role;
select throws_ok($$insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000931', '2025-01-15', 10)$$,
  'P0001', 'January 2025 is closed. An admin can reopen it.', 'lock: no payment can be added to a closed month, by anyone');
select throws_ok($$delete from public.invoices where id = 'e1000000-0000-4000-8000-000000000931'$$,
  'P0001', 'January 2025 is closed. An admin can reopen it.', 'lock: a closed month''s invoice cannot be deleted');
select throws_ok($$update public.expenses set amount_pkr = 9999 where paid_on = '2025-01-31' and description = 'salaries'$$,
  'P0001', 'January 2025 is closed. An admin can reopen it.', 'lock: a closed month''s expense cannot be changed');
select lives_ok($$update public.payments_in set bank_month = '2025-01-01' where id = 'a4000000-0000-4000-8000-000000000931'$$,
  'lock: the bank tick is still allowed');

-- A later change that moves January's live figures: an exempt February invoice of 180 on M1 changes its basis to
-- N 1,180 / G 1,360, so January's payment of 590 is now net round(590 x 1180 / 1360, 2) = 511.91 (+11.91), GST 78.09 (-11.91).
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000931', 'MON-0003', '2025-02-10', 180, 0);
set local role authenticated;
select ok((select frozen and net_in = 700 and gst_in = 90 and result = -15300 from public.v_month_pnl where month = '2025-01-01'),
  'January stays frozen at its closed figures');
-- BUG-M11: a closed month's checklist count is frozen (D-MR2) but month_end_check_details (0064) is always live. After one bank
-- item is ticked, closed January's card reads "8 items" over "3 money in, 4 money out" (7): the two contradict on every closed month.
select is((select n from public.month_end_status('2025-01-01') where check_key = 'bank_unticked'), 8,
  'closed January: the bank-unticked count stays frozen at 8');
select is((select (detail ->> 'in_n')::int + (detail ->> 'out_n')::int from public.month_end_check_details('2025-01-01') where check_key = 'bank_unticked'), 7,
  'BUG-M11 (current, wrong): the details under it are live (7)');
select todo('BUG-M11: the details of a closed month must be the frozen ones (the same as its count)', 1);
select is((select (detail ->> 'in_n')::int + (detail ->> 'out_n')::int from public.month_end_check_details('2025-01-01') where check_key = 'bank_unticked'), 8,
  'BUG-M11: a closed month''s details match its frozen count');
select ok((select net_in = 711.91 and gst_in = 78.09 from public.v_month_pnl_live where month = '2025-01-01'),
  'the live January has moved: net in 711.91, GST 78.09');
select ok((select net_in = 511.91 and gst_in = 78.09 and adj_net_in = 11.91 and adj_gst_in = -11.91 and adjust_result = 11.91
                  and result = 223.82 and not frozen
           from public.v_month_pnl where month = '2025-02-01'),
  'the change shows once, in February (first open month): own net 511.91, + 11.91 change to January, result 223.82');
select is((select sum(result) from public.v_month_pnl where month in ('2025-01-01', '2025-02-01')),
  (select sum(net_in - order_costs - overheads) from public.v_month_pnl_live where month in ('2025-01-01', '2025-02-01')),
  'the books still add up: January + February results = the live books (-15,076.18)');
select is((select sum(result) from public.v_month_pnl where month in ('2025-01-01', '2025-02-01')), -15076.18::numeric,
  'and that total is -15,300 + 223.82 = -15,076.18');

-- Reopen January: its snapshot is thrown away and it recalculates; nothing is left to show in February.
select lives_ok($$select public.reopen_month('2025-01-01', 'money verification')$$, 'reopen January');
select ok((select not frozen and net_in = 711.91 and result = -15288.09 from public.v_month_pnl where month = '2025-01-01'),
  'reopened January shows its live figures (result -15,288.09)');
select ok((select adjust_result = 0 and result = 211.91 from public.v_month_pnl where month = '2025-02-01'),
  'February no longer carries a change to a closed month (result 211.91)');
select is((select public.close_months_through('2025-02-01')), 2, 'close through February closes January and February, oldest first');
select ok((select frozen and result = -15288.09 from public.v_month_pnl where month = '2025-01-01')
          and (select frozen and result = 211.91 and adjust_result = 0 from public.v_month_pnl where month = '2025-02-01'),
  'both months frozen at the new figures, no adjustment left over');
select is((public.month_pnl_drift() ->> 'net_in')::numeric, 0::numeric, 'nothing has drifted since the close');

select * from finish();
rollback;
