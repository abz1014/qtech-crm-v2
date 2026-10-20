-- 0079_in_vs_out: cash in vs out per month (v_month_cash_flow), money out by category and detail (v_month_cash_out_detail) and
-- profit on the invoiced basis (v_month_profit). Every figure below is worked out by hand from the fixture and is repeated in
-- src/test/money-oracle/pgtapFixtures.test.ts, where the money oracle computes it independently.
--
-- Fixture (December 2019 to May 2020, months no other fixture uses). O1: one 18% line of 10,000 (gross 11,800), owned by
-- sales, invoiced once on 10 Jan 2020 (net 10,000.00, GST 1,800.00). O2: no invoice.
--   payments   P1 31 Dec 2019  5,900.00          P2  1 Jan 2020  3,000.50          P3 31 Mar 2020  1,000.00
--              P4  1 Apr 2020    700.00          PV 10 Feb 2020  2,000.00 VOIDED (left out everywhere)
--   expenses   E1 15 Dec 2019  Supplier payment 4,000.00, input tax 600.00, bank, no detail, tagged to O1
--              E2  5 Jan 2020  Fuel & travel    1,500.00, cash, "LEA-1234"
--              E3 25 Jan 2020  Fuel & travel    2,500.00, cash, "  lea-1234  " (the same detail: case and spaces ignored)
--              E4 31 Mar 2020  Utilities          500.00, cash, "Office water"
--              E5 10 Mar 2020  Owner drawings  10,000.00, bank, no detail (not in P&L, but cash out)
--              E6  1 Apr 2020  Utilities          800.00, cash, "office water"
--              E7 20 Apr 2020  Freight            300.00, bank, no detail, tagged to O2 (not invoiced: held)
-- Cash by month (gross: GST in the payments and input tax in the expenses are NOT taken out):
--   Dec 2019  in 5,900.00 (1)   out  4,000.00 (1)
--   Jan 2020  in 3,000.50 (1)   out  4,000.00 (2)
--   Feb 2020  no row: its only payment is voided and nothing was spent
--   Mar 2020  in 1,000.00 (1)   out 10,500.00 (2)
--   Apr 2020  in   700.00 (1)   out  1,100.00 (2)
-- Quarters (calendar, DECISIONS 2026-10-13; the sum of their months): Q4 2019 in 5,900.00 out 4,000.00 net 1,900.00;
--   Q1 2020 in 4,000.50 out 14,500.00 net -10,499.50; Q2 2020 (so far) in 700.00 out 1,100.00.
-- GST: P1 splits 5,000.00 net + 900.00 GST (5,900 x 10,000 / 11,800), so the cash P&L's money in for December is 5,000.00 while
-- cash in is 5,900.00; E1's cost there is 3,400.00 while cash out is 4,000.00.
-- Profit, invoiced basis (net of GST and input tax; an order's costs with its first invoice):
--   Dec 2019  sales 0, matched 0 (E1 waits for O1's January invoice), profit 0; paid: order costs 3,400.00, input tax 600.00
--   Jan 2020  sales 10,000.00 (GST 1,800.00), matched 3,400.00 (E1), overheads 4,000.00, profit 2,600.00
--   Mar 2020  overheads 500.00, profit -500.00; paid not in P&L 10,000.00
--   Apr 2020  overheads 800.00, profit -800.00; E7 300.00 paid and held (O2 has no invoice)
--   Q1 2020 profit 2,100.00. Profit - cash net = 2,100.00 - (-10,499.50) = 12,599.50
--     = (11,800.00 invoiced gross - 4,000.50 in) - 1,800.00 GST + (0 paid - 3,400.00 matched) + 10,000.00 drawings + 0 input tax
--   Q4 2019 profit 0.00. 0.00 - 1,900.00 = -1,900.00 = (0 - 5,900.00) - 0 + (3,400.00 - 0) + 0 + 600.00
--   Cancelling O2 on 15 May 2020 lets E7 go into May (the later of paid and cancelled).
-- Close: December 2019 is closed (its snapshot holds 5,900.00 / 4,000.00). A payment then forced into December past the month
-- lock (as the table owner, trigger off) moves the live books to 6,000.00 but the view keeps serving the frozen 5,900.00.
begin;
select * from no_plan();

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('v_month_cash_flow', 'v_month_cash_out_detail', 'v_month_profit')
             and coalesce(c.reloptions, '{}') @> array['security_invoker=true']), 3,
  'the three views are security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in ('public.v_month_cash_flow'::regclass, 'public.v_month_cash_out_detail'::regclass,
                                      'public.v_month_profit'::regclass)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privilege on them');
select ok(has_table_privilege('authenticated', 'public.v_month_cash_flow', 'select')
      and has_table_privilege('authenticated', 'public.v_month_cash_out_detail', 'select')
      and has_table_privilege('authenticated', 'public.v_month_profit', 'select')
      and not has_table_privilege('authenticated', 'public.v_month_cash_flow', 'insert'),
  'authenticated may select them, nothing else');
create function pg_temp.has_bare(t text) returns boolean language sql immutable as $f$
  select coalesce(
    regexp_replace(t, '\(\s*SELECT\s+(public\.)?current_user_role\(\)(\s+AS\s+current_user_role)?\s*\)', '', 'gi')
    ~ 'current_user_role\(\)', false)
$f$;
select is((select count(*)::int from unnest(array['public.v_month_cash_flow', 'public.v_month_cash_out_detail', 'public.v_month_profit']) v
           where pg_catalog.pg_get_viewdef(v::regclass) ~* 'current_user_role\(\)'
             and not pg_temp.has_bare(pg_catalog.pg_get_viewdef(v::regclass))), 3,
  'each checks the role, and only in the once-per-statement wrapped form (0074)');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000791', 'In vs out customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000791', 'c0000000-0000-4000-8000-000000000791', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000792', 'c0000000-0000-4000-8000-000000000791', 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000791', 'in vs out line', 1, 10000, 18),
  ('a1000000-0000-4000-8000-000000000792', 'held cost line', 1, 1000, 18);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000791', 'IVO-0791', '2020-01-10', 10000.00, 1800.00);

insert into public.payments_in (id, order_id, received_on, amount) values
  ('b7900000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000791', '2019-12-31', 5900.00),
  ('b7900000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000791', '2020-01-01', 3000.50),
  ('b7900000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000791', '2020-03-31', 1000.00),
  ('b7900000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000791', '2020-04-01', 700.00);
-- voided as the table owner (the guard limits the role authenticated only); the RPC path is covered by 0073
insert into public.payments_in (id, order_id, received_on, amount, voided_at, voided_by, void_reason) values
  ('b7900000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000791', '2020-02-10', 2000.00,
   now(), 'a0000000-0000-4000-8000-000000000001', 'typed twice');

insert into public.expenses (id, paid_on, amount_pkr, input_tax_pkr, category_id, paid_via, description, order_id) values
  ('e7900000-0000-4000-8000-000000000001', '2019-12-15', 4000.00, 600.00, 'ca7e0000-0000-4000-8000-000000000011', 'bank', null, 'a1000000-0000-4000-8000-000000000791'),
  ('e7900000-0000-4000-8000-000000000002', '2020-01-05', 1500.00, 0, 'ca7e0000-0000-4000-8000-000000000004', 'cash', 'LEA-1234', null),
  ('e7900000-0000-4000-8000-000000000003', '2020-01-25', 2500.00, 0, 'ca7e0000-0000-4000-8000-000000000004', 'cash', '  lea-1234  ', null),
  ('e7900000-0000-4000-8000-000000000004', '2020-03-31', 500.00, 0, 'ca7e0000-0000-4000-8000-000000000003', 'cash', 'Office water', null),
  ('e7900000-0000-4000-8000-000000000005', '2020-03-10', 10000.00, 0, 'ca7e0000-0000-4000-8000-000000000016', 'bank', null, null),
  ('e7900000-0000-4000-8000-000000000006', '2020-04-01', 800.00, 0, 'ca7e0000-0000-4000-8000-000000000003', 'cash', 'office water', null),
  ('e7900000-0000-4000-8000-000000000007', '2020-04-20', 300.00, 0, 'ca7e0000-0000-4000-8000-000000000012', 'bank', null, 'a1000000-0000-4000-8000-000000000792');

set local role authenticated;

-- ------------------------------------------------------------------ cash by month (live)
select results_eq(
  $$select to_char(month, 'YYYY-MM'), money_in, payments_count, money_out, expenses_count, frozen
    from public.v_month_cash_flow where month between '2019-12-01' and '2020-05-01' order by month$$,
  $$values ('2019-12', 5900.00::numeric, 1, 4000.00::numeric, 1, false),
           ('2020-01', 3000.50::numeric, 1, 4000.00::numeric, 2, false),
           ('2020-03', 1000.00::numeric, 1, 10500.00::numeric, 2, false),
           ('2020-04', 700.00::numeric, 1, 1100.00::numeric, 2, false)$$,
  'every month by its own dates, gross; February has no row (its only payment is voided)');

-- ------------------------------------------------------------------ quarters: the sum of their months, boundaries exact
select results_eq(
  $$select sum(money_in), sum(money_out), sum(money_in) - sum(money_out) from public.v_month_cash_flow
    where month between '2019-10-01' and '2019-12-01'$$,
  $$values (5900.00::numeric, 4000.00::numeric, 1900.00::numeric)$$,
  'Q4 2019: 31 December is in it (5,900.00 in, 4,000.00 out, net 1,900.00)');
select results_eq(
  $$select sum(money_in), sum(money_out), sum(money_in) - sum(money_out) from public.v_month_cash_flow
    where month between '2020-01-01' and '2020-03-01'$$,
  $$values (4000.50::numeric, 14500.00::numeric, -10499.50::numeric)$$,
  'Q1 2020: 1 January and 31 March are in it, 1 April is not; the voided 2,000.00 is not (in 4,000.50, out 14,500.00, net -10,499.50)');
select results_eq(
  $$select sum(money_in), sum(money_out) from public.v_month_cash_flow where month between '2020-04-01' and '2020-06-01'$$,
  $$values (700.00::numeric, 1100.00::numeric)$$,
  'Q2 2020 so far: 1 April');

-- ------------------------------------------------------------------ GST and input tax: gross here, taken out in the P&L
select results_eq(
  $$select f.money_in, p.net_in, p.gst_in, f.money_out, p.order_costs
    from public.v_month_cash_flow f join public.v_month_pnl p on p.month = f.month where f.month = '2019-12-01'$$,
  $$values (5900.00::numeric, 5000.00::numeric, 900.00::numeric, 4000.00::numeric, 3400.00::numeric)$$,
  'cash in keeps the 900.00 GST inside the payment and cash out the 600.00 input tax; the cash P&L takes both out');
select is((select money_out from public.v_month_cash_flow where month = '2020-03-01'), 10500.00::numeric,
  'owner drawings (not in the P&L) are still cash out');

-- ------------------------------------------------------------------ by category and detail
select results_eq(
  $$select to_char(month, 'YYYY-MM'), category_id::text, lower(detail), gross_paid, expense_count, last_paid_on
    from public.v_month_cash_out_detail where month between '2019-12-01' and '2020-05-01'
    order by month, category_id, lower(detail) nulls first$$,
  $$values ('2019-12', 'ca7e0000-0000-4000-8000-000000000011', null::text, 4000.00::numeric, 1, '2019-12-15'::date),
           ('2020-01', 'ca7e0000-0000-4000-8000-000000000004', 'lea-1234', 4000.00::numeric, 2, '2020-01-25'::date),
           ('2020-03', 'ca7e0000-0000-4000-8000-000000000003', 'office water', 500.00::numeric, 1, '2020-03-31'::date),
           ('2020-03', 'ca7e0000-0000-4000-8000-000000000016', null::text, 10000.00::numeric, 1, '2020-03-10'::date),
           ('2020-04', 'ca7e0000-0000-4000-8000-000000000003', 'office water', 800.00::numeric, 1, '2020-04-01'::date),
           ('2020-04', 'ca7e0000-0000-4000-8000-000000000012', null::text, 300.00::numeric, 1, '2020-04-20'::date)$$,
  'one row per month, category and detail; "LEA-1234" and "  lea-1234  " are one detail; no detail is one row');
select is((select detail from public.v_month_cash_out_detail where month = '2020-01-01'), 'LEA-1234',
  'the detail is shown trimmed (no outer spaces)');
select is((select count(*)::int from public.v_month_cash_flow f
           where f.month between '2019-12-01' and '2020-05-01'
             and f.money_out <> (select coalesce(sum(d.gross_paid), 0) from public.v_month_cash_out_detail d where d.month = f.month)), 0,
  'the detail rows of every month add up to its money out');

-- ------------------------------------------------------------------ profit, invoiced basis
select results_eq(
  $$select to_char(month, 'YYYY-MM'), sales_net, sales_gst, invoice_count, order_costs_matched, overheads, profit,
           order_costs_paid, non_pnl_paid, input_tax_paid
    from public.v_month_profit where month between '2019-12-01' and '2020-05-01' order by month$$,
  $$values ('2019-12', 0::numeric, 0::numeric, 0, 0::numeric, 0::numeric, 0::numeric, 3400.00::numeric, 0::numeric, 600.00::numeric),
           ('2020-01', 10000.00::numeric, 1800.00::numeric, 1, 3400.00::numeric, 4000.00::numeric, 2600.00::numeric, 0::numeric, 0::numeric, 0::numeric),
           ('2020-03', 0::numeric, 0::numeric, 0, 0::numeric, 500.00::numeric, -500.00::numeric, 0::numeric, 10000.00::numeric, 0::numeric),
           ('2020-04', 0::numeric, 0::numeric, 0, 0::numeric, 800.00::numeric, -800.00::numeric, 300.00::numeric, 0::numeric, 0::numeric)$$,
  'sales by invoice date net of GST; E1 (paid in December) is matched with O1''s January invoice; E7 is held (O2 has no invoice)');
select is((select sum(profit) from public.v_month_profit where month between '2020-01-01' and '2020-03-01'), 2100.00::numeric,
  'Q1 2020 profit, invoiced basis: 2,100.00');
-- The explanation the report prints, checked as an identity for both quarters.
select results_eq(
  $$with q(a, b) as (values ('2019-10-01'::date, '2019-12-01'::date), ('2020-01-01', '2020-03-01')),
    x as (
      select q.a,
             (select coalesce(sum(profit), 0) from public.v_month_profit where month between q.a and q.b) as profit,
             (select coalesce(sum(money_in - money_out), 0) from public.v_month_cash_flow where month between q.a and q.b) as cash_net,
             (select coalesce(sum(sales_net + sales_gst), 0) from public.v_month_profit where month between q.a and q.b)
               - (select coalesce(sum(money_in), 0) from public.v_month_cash_flow where month between q.a and q.b) as owed_more,
             (select coalesce(sum(sales_gst), 0) from public.v_month_profit where month between q.a and q.b) as gst,
             (select coalesce(sum(order_costs_paid - order_costs_matched), 0) from public.v_month_profit where month between q.a and q.b) as ahead,
             (select coalesce(sum(non_pnl_paid + input_tax_paid), 0) from public.v_month_profit where month between q.a and q.b) as other
      from q)
    select to_char(a, 'YYYY-MM'), profit - cash_net, owed_more, gst, ahead, other, profit - cash_net - (owed_more - gst + ahead + other)
    from x order by a$$,
  $$values ('2019-10', -1900.00::numeric, -5900.00::numeric, 0::numeric, 3400.00::numeric, 600.00::numeric, 0::numeric),
           ('2020-01', 12599.50::numeric, 7799.50::numeric, 1800.00::numeric, -3400.00::numeric, 10000.00::numeric, 0::numeric)$$,
  'profit - cash net = owed more - GST + costs paid ahead + drawings and input tax, nothing left over');
reset role;
update public.orders set cancelled_on = '2020-05-15' where id = 'a1000000-0000-4000-8000-000000000792';
set local role authenticated;
select results_eq(
  $$select to_char(month, 'YYYY-MM'), order_costs_matched, profit from public.v_month_profit where month = '2020-05-01'$$,
  $$values ('2020-05', 300.00::numeric, -300.00::numeric)$$,
  'a cancelled order never invoiced: its held cost counts in the cancel month');

-- ------------------------------------------------------------------ other roles see nothing
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.v_month_cash_flow) + (select count(*)::int from public.v_month_cash_out_detail)
          + (select count(*)::int from public.v_month_profit), 0,
  'sales: no row');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.v_month_cash_flow) + (select count(*)::int from public.v_month_cash_out_detail)
          + (select count(*)::int from public.v_month_profit), 0,
  'engineer: no row');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_month_cash_flow) + (select count(*)::int from public.v_month_cash_out_detail)
          + (select count(*)::int from public.v_month_profit), 0,
  'deactivated: no row');

-- ------------------------------------------------------------------ a closed month is served frozen
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select public.close_months_through('2019-12-01')), 1, 'December 2019 is closed (the earliest month with money)');
select results_eq(
  $$select money_in, payments_count, money_out, expenses_count, frozen from public.v_month_cash_flow where month = '2019-12-01'$$,
  $$values (5900.00::numeric, 1, 4000.00::numeric, 1, true)$$,
  'closed December: the same figures, now from its snapshot');

-- Force a payment into the closed month past the lock (only the table owner can), so live and frozen differ.
reset role;
alter table public.payments_in disable trigger payments_in_month_lock;
insert into public.payments_in (id, order_id, received_on, amount) values
  ('b7900000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000791', '2019-12-20', 100.00);
alter table public.payments_in enable trigger payments_in_month_lock;
set local role authenticated;
select is((select sum(amount) from public.payments_in where received_on between '2019-12-01' and '2019-12-31' and voided_at is null),
  6000.00::numeric, 'precondition: the live books for December now hold 6,000.00');
select results_eq(
  $$select money_in, payments_count, frozen from public.v_month_cash_flow where month = '2019-12-01'$$,
  $$values (5900.00::numeric, 1, true)$$,
  'closed December still answers 5,900.00 from 1 payment: the frozen figure, not the live one');
select is((select sum(money_in) from public.v_month_cash_flow where month between '2019-10-01' and '2019-12-01'), 5900.00::numeric,
  'and so does Q4 2019');

select results_eq(
  $$select money_in, frozen from public.v_month_cash_flow where month = '2020-01-01'$$,
  $$values (3000.50::numeric, false)$$,
  'January stays open and live');

-- Reopening throws the snapshot away: the live figure is served again.
select lives_ok($$select public.reopen_month('2019-12-01', 'test')$$, 'reopen December 2019');
select results_eq(
  $$select money_in, payments_count, frozen from public.v_month_cash_flow where month = '2019-12-01'$$,
  $$values (6000.00::numeric, 2, false)$$,
  'reopened December: live again, 6,000.00 from 2 payments');

select * from finish();
rollback;
