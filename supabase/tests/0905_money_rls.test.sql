-- 0905_money_rls (money verification): who sees which money. With one row of every kind on file, an engineer and a deactivated
-- user get no money row from any money table, view or function; sales see only invoices, the GST register and month report
-- (without input tax) and order balances; the admin sees everything. Engineers MAY see selling prices (owner decision
-- 2026-10-19: v_order_items_total, v_order_state.gross), never what was invoiced, paid, spent, owed or earned.
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000941', 'RLS customer'),
  ('c0000000-0000-4000-8000-000000000942', 'RLS supplier');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000941', 'c0000000-0000-4000-8000-000000000941', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on) values
  ('a2000000-0000-4000-8000-000000000941', 'a1000000-0000-4000-8000-000000000941', 'c0000000-0000-4000-8000-000000000942', 'PKR', '2025-01-02', '2025-02-02');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  ('a1000000-0000-4000-8000-000000000941', 'RLS line', 1, 1000, 18, 'a2000000-0000-4000-8000-000000000941', 600);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000941', 'RLS-0001', '2025-01-10', 1000, 180);
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000941', '2025-01-20', 500);
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, order_id, supplier_order_id) values
  ('2025-01-15', 708, 108, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000941', 'a2000000-0000-4000-8000-000000000941');
insert into public.order_costs (order_id, expected_cost_pkr) values ('a1000000-0000-4000-8000-000000000941', 600);
insert into public.recurring_expenses (label, category_id, amount) values ('RLS rent', 'ca7e0000-0000-4000-8000-000000000002', 5000);
insert into public.targets (user_id, year, quarter, target_net_pkr) values ('a0000000-0000-4000-8000-000000000001', 2025, 1, 100000);

create function pg_temp.money_rows(rel text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from %s', rel) into n;
  return n;
end;
$f$;
grant execute on function pg_temp.money_rows(text) to authenticated;

-- Every money relation, read the way the app reads it (functions with a date inside the fixture's range).
create temp table money_relations (rel text) on commit drop;
grant select on money_relations to authenticated;
insert into money_relations values
  ('public.payments_in'), ('public.expenses'), ('public.invoices'), ('public.order_costs'), ('public.recurring_expenses'),
  ('public.expense_categories'), ('public.closed_months'), ('public.month_snapshots'),
  ('public.v_order_basis'), ('public.v_payment_net'), ('public.v_order_money'), ('public.v_cash_month'), ('public.v_target_progress'),
  ('public.v_month_pnl'), ('public.v_month_pnl_live'), ('public.v_month_expense_category'), ('public.v_month_team'),
  ('public.v_gst_month'), ('public.v_invoice_state'), ('public.v_gst_register'),
  ('public.v_month_cash_flow'), ('public.v_month_cash_out_detail'),   -- 0079
  ('public.aging_as_of(''2025-06-30'')'), ('public.payables_as_of(''2025-01-31'')'),
  ('public.month_end_status(''2025-02-01'')'), ('public.month_end_check_details(''2025-02-01'')');

set local role authenticated;
select lives_ok($$select public.close_month('2025-01-01')$$, 'admin closes January 2025 (so closed_months and month_snapshots have a row)');

-- ---------------------------------------------------------------- admin sees every one of them
select ok(pg_temp.money_rows(rel) > 0, 'admin: ' || rel || ' has rows') from money_relations;

-- ---------------------------------------------------------------- engineer: nothing
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(pg_temp.money_rows(rel), 0::bigint, 'engineer: ' || rel || ' returns no row') from money_relations;
select is((select count(*)::int from public.targets), 0, 'engineer: no one else''s target');
select throws_ok($$select * from public.order_receivables()$$, '42501', null, 'engineer: order balances are refused');
select throws_ok($$select * from public.next_invoice_number()$$, '42501', null, 'engineer: the invoice series is refused');
select ok(public.month_pnl_drift() is null and public.month_pnl_adjusted() is null and public.money_exceptions_input() is null,
  'engineer: the admin money helpers answer NULL');
select ok((select invoiced is null and invoicing_state is null from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000941'),
  'engineer: the order state carries no invoiced amount and no invoicing state');
select is((select gross from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000941'), 1180.00::numeric,
  'engineer: selling prices are visible by design (owner decision 2026-10-19), nothing invoiced, paid or spent');

-- ---------------------------------------------------------------- sales: invoices, the register, balances; never cash, cost or P&L
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(pg_temp.money_rows(rel), 0::bigint, 'sales: ' || rel || ' returns no row') from money_relations
where rel not in ('public.invoices', 'public.v_invoice_state', 'public.v_gst_register', 'public.v_gst_month');
select ok(pg_temp.money_rows(rel) > 0, 'sales: ' || rel || ' is readable') from money_relations
where rel in ('public.invoices', 'public.v_invoice_state', 'public.v_gst_register', 'public.v_gst_month');
select ok((select input_tax is null and gst = 180 from public.v_gst_month where month = '2025-01-01'),
  'sales: the GST month shows output GST but never the input tax');
select ok((select balance = 680 and settled = 500 from public.order_receivables('a1000000-0000-4000-8000-000000000941')),
  'sales: the order balance (1,180 - 500 = 680), with no payment row behind it');

-- ---------------------------------------------------------------- deactivated: nothing at all
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(pg_temp.money_rows(rel), 0::bigint, 'deactivated: ' || rel || ' returns no row') from money_relations;
select is((select count(*)::int from public.order_receivables()), 0, 'deactivated: no order balance');

select * from finish();
rollback;
