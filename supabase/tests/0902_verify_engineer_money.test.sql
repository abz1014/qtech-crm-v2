begin;
select * from no_plan();

-- 0902 (verification suite, branch test/roles-verify): an engineer never reads a price, cost, margin, payment, invoice
-- amount or GST figure, through any table, view, function or embedded select.
--
-- How: every numeric or JSON column (tables AND views) and every function result column whose name looks like money is
-- listed ONCE in `money_cols` with a rule, and a coverage check fails when the catalog has one that is not listed (so a
-- new money column must be classified before CI is green). The fixtures (copied from S14) hold a non-null value in every
-- money column; each rule is then probed as the engineer:
--   hidden    the engineer must get no non-null value (zero rows, or the column NULL)            -> real assertions
--   m3        selling prices (rfq_items, quotations, order_items, the order totals). Since 0081 (owner decision 2026-10-22,
--             replacing the 2026-10-19 M-3 acceptance) the engineer gets none: real assertions, like hidden.
--   supplier  supplier prices (our cost side: supplier_quote_lines, purchase_orders, order_items.supplier_unit_price) and
--             the price RPCs. Since 0081 the engineer gets none either: real assertions.
-- Each probe runs as the API runs it: role authenticated with the persona's claims, then qtech_private.pre_request() (0081),
-- which moves an engineer onto qtech_engineer exactly as PostgREST's db-pre-request does.
--   own       the engineer's own target figures (s10 targets "S own", my_target_progress "own"): only their own row.
--   info      not money (a rate, a count, days).
-- JSON columns are searched recursively for money-named keys with a value (pg_temp.money_keys), which is how the legacy
-- import's raw rows (legacy_source) are checked. Bugs found are wrapped in todo blocks named with their BUG id.

-- ------------------------------------------------------------------ machinery (session-local)
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f0000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       else '00000000-0000-0000-0000-000000000000' end $$;

-- Runs `stmt` as the persona (API role and claims) and returns the first column of the first row as text: '<null>' for
-- NULL, '<none>' for no row, 'E:<sqlstate>' for an error. Always rolled back.
create function pg_temp.scalar_as(stmt text, persona text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  s text;
  n bigint;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''f0000000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    -- 0081: what PostgREST runs before every request: an engineer continues as qtech_engineer (no price columns)
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    raise exception 'scalar done' using errcode = 'P0999',
      detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end;
$f$;

-- Every key (at any depth) whose name looks like money and whose value is a number or a non-empty string.
create function pg_temp.money_keys(j jsonb) returns setof text language sql immutable as $$
  with recursive walk(v) as (
    select j
    union all
    select e.value
    from walk w
    cross join lateral (
      select x.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) x
      union all
      select y.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) y
    ) e
  )
  select k.key
  from walk w
  cross join lateral jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
  where k.key ~* '(price|cost|value|amount|total|gst|tax|margin|paid|balance|spread|gross|sell|sold|net_|_net)'
    and jsonb_typeof(k.value) in ('number', 'string')
    and k.value not in ('""'::jsonb, '"0"'::jsonb, '0'::jsonb)
$$;


-- ------------------------------------------------------------------ fixtures, copied from S14 (0025_access_matrix.test.sql)
-- Row ids are written in hex and appear in the probes as @NN (same two hex digits).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.f('01'), 'M Main'), (pg_temp.f('02'), 'M Leaf'), (pg_temp.f('03'), 'M Supplier'),
  (pg_temp.f('04'), 'M Supplier 2'), (pg_temp.f('05'), 'M Supplier 3');
insert into public.company_sites (id, company_id, name) values
  (pg_temp.f('10'), pg_temp.f('01'), 'Main site'), (pg_temp.f('11'), pg_temp.f('01'), 'Leaf site');
insert into public.contacts (id, company_id, name) values (pg_temp.f('12'), pg_temp.f('01'), 'Contact');
insert into public.brands (id, name) values (pg_temp.f('13'), 'M Brand'), (pg_temp.f('14'), 'M Brand leaf');
insert into public.company_brands (company_id, brand_id) values (pg_temp.f('01'), pg_temp.f('13'));
insert into public.rfqs (id, company_id, owner_id) values
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, brand_id, quoted_unit_price_net) values
  (pg_temp.f('17'), pg_temp.f('15'), 0, 'Fixture item', pg_temp.f('13'), 50),
  (pg_temp.f('18'), pg_temp.f('15'), 1, 'Leaf item', null, 50);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  (pg_temp.f('19'), pg_temp.f('15'), pg_temp.f('03'), public.today_pkt()),
  (pg_temp.f('1a'), pg_temp.f('15'), pg_temp.f('04'), public.today_pkt()),
  (pg_temp.f('1b'), pg_temp.f('15'), pg_temp.f('05'), null);
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.f('1c'), pg_temp.f('19'), pg_temp.f('17'), 10, 'PKR');
insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason) values   -- R07 (0032)
  (pg_temp.f('19'), pg_temp.f('18'), 'other');
insert into public.clarifications (id, rfq_id, question) values
  (pg_temp.f('1d'), pg_temp.f('15'), 'Main q'), (pg_temp.f('1e'), pg_temp.f('15'), 'Leaf q');
update public.clarifications set first_asked_at = now(), last_asked_at = now() where id = pg_temp.f('1e');   -- P01 (0053): one asked question, so v_report_clarification_turnaround has a row to probe
insert into public.orders (id, company_id, owner_id) values
  (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
update public.orders set customer_po_number = 'PO-M1' where id = pg_temp.f('20');   -- P02 (0054): search_all customer PO
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.f('23'), pg_temp.f('20'), pg_temp.f('03'), 'USD'),
  (pg_temp.f('24'), pg_temp.f('20'), pg_temp.f('03'), 'USD');
insert into public.order_items (id, order_id, position, description, unit_price_net, supplier_order_id, supplier_unit_price) values
  (pg_temp.f('25'), pg_temp.f('20'), 0, 'Fixture order item', 100, pg_temp.f('23'), 10);
insert into public.order_costs (order_id, expected_cost_pkr) values (pg_temp.f('20'), 5);
insert into public.order_engineers (order_id, user_id) values (pg_temp.f('20'), 'a0000000-0000-4000-8000-000000000003');
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  (pg_temp.f('26'), pg_temp.f('20'), 'INV-M1', 100, 18), (pg_temp.f('27'), pg_temp.f('20'), 'INV-M2', 100, 18);
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('28'), pg_temp.f('20'), 118);
insert into public.expenses (id, amount_pkr, category_id) values (pg_temp.f('29'), 5, 'ca7e0000-0000-4000-8000-000000000005');
insert into public.recurring_expenses (id, label, category_id, amount) values (pg_temp.f('2a'), 'rent', 'ca7e0000-0000-4000-8000-000000000002', 5);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values
  (pg_temp.f('2b'), 'rfq-files', 'm/1.pdf', 'a.pdf', 'application/pdf', 10, pg_temp.f('15'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.f('2c'), 'gst-receipts', 'm/2.pdf', 'b.pdf', 'application/pdf', 10, pg_temp.f('26'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values   -- A6
  (pg_temp.f('3c'), 'expense-receipts', 'm/3.jpg', 'c.jpg', 'image/jpeg', 10, pg_temp.f('29'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id) values   -- R22 (0042)
  (pg_temp.f('3f'), 'rfq-files', 'm/4.jpg', 'd.jpg', 'image/jpeg', 10, pg_temp.f('20'));
insert into public.expense_categories (id, name, grp) values (pg_temp.f('3d'), 'M Category', 'overhead');   -- A6
update public.expenses set fx_currency = 'USD', fx_amount = 1 where id = pg_temp.f('29');   -- 0087
insert into public.expense_claims (id, created_by, amount_pkr) values   -- 0087: one claim of the engineer's, one of the admin's
  (pg_temp.f('e0'), 'a0000000-0000-4000-8000-000000000003', 5), (pg_temp.f('e1'), 'a0000000-0000-4000-8000-000000000001', 7);
insert into public.cash_topups (id, amount_pkr) values (pg_temp.f('e2'), 5);   -- 0087
insert into public.cash_counts (id, counted_pkr, is_opening) values (pg_temp.f('e3'), 10, true);   -- 0087
insert into public.cash_counts (id, counted_pkr) values (pg_temp.f('e5'), 9);   -- 0087: a count, so expected and difference hold money
insert into public.closed_months (month, closed_by) values ('2019-01-01', 'a0000000-0000-4000-8000-000000000001');   -- A6
update public.supplier_orders set placed_on = public.today_pkt() where id = pg_temp.f('23');   -- A6: payables_as_of needs a placed leg
insert into public.snoozes (user_id, rule, subject_id, until_on)
select u, 'r', pg_temp.f('2d'), public.today_pkt() + 3
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.targets (user_id, year, quarter, target_net_pkr)
select u, 2090, 1, 100
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.fx_rates (id, currency, rate_pkr, as_of, source) values
  (pg_temp.f('38'), 'USD', 280, public.today_pkt() - 5, 'manual'),
  (pg_temp.f('39'), 'EUR', 300, public.today_pkt() - 5, 'auto');
insert into public.fx_fetch_log (id, kind, detail) values (pg_temp.f('3e'), 'info', 'fixture');
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values
  (pg_temp.f('3a'), pg_temp.f('15'), 7001, 0, public.today_pkt() + 5, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  (pg_temp.f('3b'), pg_temp.f('23'), 7002, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
-- order @21 is the target of resolve_value_basis
update public.orders set legacy_flags = '{value_basis_unknown}' where id = pg_temp.f('21');
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'fixture.txt'), ('gst-receipts', 'fixture.txt'), ('generated-docs', 'fixture.txt'),
  ('expense-receipts', 'fixture.txt');
-- 0057 (H-1): quotation @3a and PO @3b are issued with their PDF attached.
insert into storage.objects (bucket_id, name) values ('generated-docs', 'm/q.pdf'), ('generated-docs', 'm/p.pdf');
update public.quotations set pdf_path = 'm/q.pdf' where id = pg_temp.f('3a');
update public.purchase_orders set pdf_path = 'm/p.pdf' where id = pg_temp.f('3b');
-- 0065 (M-1): the fixture orders were created earlier, not in the transaction that writes their lines.
update public.orders set created_at = now() - interval '1 day' where id in (pg_temp.f('20'), pg_temp.f('21'));


-- ------------------------------------------------------------------ 0902 fixtures: imported rows, as the legacy import writes them
-- The import (import/src/transform/orders.ts, rfqs.ts, money.ts) keeps the old CRM's raw row in legacy_source. For an
-- order, its items and its supplier legs that row is the old `orders` row: order_value, cost_value, order_gst_amount,
-- invoice_number. These shapes copy the import's.
update public.orders set legacy_source =
  '{"table":"orders","row":{"id":"9d1","order_value":250000,"cost_value":180000,"order_gst_amount":45000,"invoice_number":"OLD-INV-1","payment_due_date":"2024-03-01"}}'
  where id = pg_temp.f('20');
update public.order_items set legacy_source = '{"table":"orders","row":{"id":"9d1","order_value":250000,"cost_value":180000}}'
  where id = pg_temp.f('25');
update public.supplier_orders set legacy_source = '{"table":"orders","rows":[{"id":"9d1","order_value":250000,"cost_value":180000}]}'
  where id = pg_temp.f('23');
update public.rfqs set legacy_source = '{"table":"rfqs","row":{"id":"7c1","estimated_value":300000,"quoted_price":275000}}'
  where id = pg_temp.f('15');
update public.rfq_items set legacy_source = '{"table":"rfq_line_items","row":{"id":"7c2","target_price":1200}}'
  where id = pg_temp.f('17');
update public.supplier_quote_lines set legacy_source = '{"table":"supplier_quotes","row":{"id":"7c3","unit_price":10,"currency":"PKR"}}'
  where id = pg_temp.f('1c');
update public.supplier_inquiries set legacy_source = '{"table":"supplier_inquiries","rows":[{"id":"7c4","status":"sent","email_draft":"Dear supplier"}]}'
  where id = pg_temp.f('19');
update public.companies set legacy_source = '{"rows":[{"table":"clients","row":{"company_name":"M Main","industry":"Textile"}}]}'
  where id = pg_temp.f('01');
update public.invoices set legacy_source = '{"table":"gst_invoices","row":{"amount":100,"gst_amount":18}}' where id = pg_temp.f('26');
update public.payments_in set legacy_source = '{"table":"order_payments","row":{"amount":118}}' where id = pg_temp.f('28');
update public.expenses set legacy_source = '{"table":"expenses","row":{"amount":5}}' where id = pg_temp.f('29');

-- ------------------------------------------------------------------ the classification (one line per money-looking column)
create temp table money_cols (obj text, col text, rule text check (rule in ('hidden', 'm3', 'supplier', 'own', 'info')), bug text,
                              primary key (obj, col));
insert into money_cols (obj, col, rule, bug) values
  -- tables
  ('audit_log', 'old_value', 'hidden', null), ('audit_log', 'new_value', 'hidden', null),
  ('companies', 'legacy_source', 'hidden', null),
  ('expense_categories', 'monthly_budget_pkr', 'hidden', null),   -- 0086
  ('expenses', 'amount_pkr', 'hidden', null), ('expenses', 'input_tax_pkr', 'hidden', null), ('expenses', 'legacy_source', 'hidden', null),
  ('expenses', 'fx_amount', 'hidden', null),   -- 0087: a supplier payment in the supplier's currency
  ('expense_claims', 'amount_pkr', 'own', null),   -- 0087: an engineer reads the amounts of their own "I paid" claims only (probed below)
  ('cash_topups', 'amount_pkr', 'hidden', null),   -- 0087
  ('cash_counts', 'counted_pkr', 'hidden', null), ('cash_counts', 'expected_pkr', 'hidden', null), ('cash_counts', 'difference_pkr', 'hidden', null),   -- 0087
  ('fx_rates', 'rate_pkr', 'supplier', null),
  ('invoices', 'net_amount', 'hidden', null), ('invoices', 'gst_amount', 'hidden', null), ('invoices', 'tax_deposit_amount', 'hidden', null),
  ('invoices', 'legacy_source', 'hidden', null),
  ('month_snapshots', 'pnl', 'hidden', null), ('month_snapshots', 'adjust', 'hidden', null), ('month_snapshots', 'status', 'hidden', null),
  ('month_snapshots', 'categories', 'hidden', null), ('month_snapshots', 'team', 'hidden', null), ('month_snapshots', 'payments', 'hidden', null),
  ('month_snapshots', 'via', 'hidden', null), ('month_snapshots', 'aging', 'hidden', null), ('month_snapshots', 'payables', 'hidden', null),
  ('month_snapshots', 'gst', 'hidden', null), ('month_snapshots', 'details', 'hidden', null),
  ('v_month_cash_flow', 'money_in', 'hidden', null), ('v_month_cash_flow', 'money_out', 'hidden', null),   -- 0079
  ('v_month_cash_out_detail', 'gross_paid', 'hidden', null),   -- 0079
  ('v_month_profit', 'sales_net', 'hidden', null), ('v_month_profit', 'sales_gst', 'hidden', null), ('v_month_profit', 'order_costs_matched', 'hidden', null),   -- 0079
  ('v_month_profit', 'overheads', 'hidden', null), ('v_month_profit', 'profit', 'hidden', null), ('v_month_profit', 'order_costs_paid', 'hidden', null),
  ('v_month_profit', 'non_pnl_paid', 'hidden', null), ('v_month_profit', 'input_tax_paid', 'hidden', null),
  ('order_costs', 'expected_cost_pkr', 'hidden', null),
  ('order_items', 'unit_price_net', 'm3', null), ('order_items', 'supplier_unit_price', 'supplier', null), ('order_items', 'gst_rate', 'info', null),
  ('order_items', 'legacy_source', 'hidden', null),
  ('orders', 'legacy_source', 'hidden', null),
  ('payments_in', 'amount', 'hidden', null), ('payments_in', 'legacy_source', 'hidden', null),
  ('purchase_orders', 'total', 'supplier', null), ('purchase_orders', 'lines', 'supplier', null),
  ('quotations', 'net_total', 'm3', null), ('quotations', 'gst_total', 'm3', null), ('quotations', 'lines', 'm3', null),
  ('recurring_expenses', 'amount', 'hidden', null),
  ('rfq_items', 'quoted_unit_price_net', 'm3', null), ('rfq_items', 'gst_rate', 'info', null), ('rfq_items', 'legacy_source', 'hidden', null),
  ('rfqs', 'legacy_source', 'hidden', null),
  ('supplier_inquiries', 'legacy_source', 'hidden', null),
  ('supplier_orders', 'legacy_source', 'hidden', null),
  ('supplier_quote_lines', 'unit_price', 'supplier', null), ('supplier_quote_lines', 'fx_rate_pkr', 'supplier', null),
  ('supplier_quote_lines', 'legacy_source', 'supplier', null),
  ('targets', 'target_net_pkr', 'own', null),
  -- views
  ('v_cash_month', 'gross_received', 'hidden', null), ('v_cash_month', 'gst_received', 'hidden', null), ('v_cash_month', 'money_out', 'hidden', null),
  ('v_cash_month', 'net_received', 'hidden', null), ('v_cash_month', 'unresolved_gross', 'hidden', null),
  ('v_fx_latest', 'rate_pkr', 'supplier', null),
  ('v_gst_month', 'net', 'hidden', null), ('v_gst_month', 'gst', 'hidden', null), ('v_gst_month', 'deposited_amount', 'hidden', null),
  ('v_gst_month', 'gst_to_deposit', 'hidden', null), ('v_gst_month', 'input_tax', 'hidden', null), ('v_gst_month', 'deposited_count', 'info', null),
  ('v_gst_register', 'net_amount', 'hidden', null), ('v_gst_register', 'gst_amount', 'hidden', null), ('v_gst_register', 'gross_amount', 'hidden', null),
  ('v_gst_register', 'tax_deposit_amount', 'hidden', null),
  ('v_inquiry_state', 'items_quoted', 'info', null), ('v_inquiry_state', 'items_total', 'info', null),
  ('v_invoice_state', 'net_amount', 'hidden', null), ('v_invoice_state', 'gst_amount', 'hidden', null), ('v_invoice_state', 'gross_amount', 'hidden', null),
  ('v_month_expense_category', 'net_cost', 'hidden', null), ('v_month_expense_category', 'gross_paid', 'hidden', null),
  ('v_month_pnl', 'net_in', 'hidden', null), ('v_month_pnl', 'gst_in', 'hidden', null), ('v_month_pnl', 'unresolved_gross', 'hidden', null),
  ('v_month_pnl', 'order_costs', 'hidden', null), ('v_month_pnl', 'overheads', 'hidden', null), ('v_month_pnl', 'result', 'hidden', null),
  ('v_month_pnl', 'non_pnl_out', 'hidden', null), ('v_month_pnl', 'after_drawings', 'hidden', null), ('v_month_pnl', 'cash_out_total', 'hidden', null),
  ('v_month_pnl', 'input_tax', 'hidden', null), ('v_month_pnl', 'adj_net_in', 'hidden', null), ('v_month_pnl', 'adj_gst_in', 'hidden', null),
  ('v_month_pnl', 'adj_unresolved_gross', 'hidden', null), ('v_month_pnl', 'adj_order_costs', 'hidden', null),
  ('v_month_pnl', 'adj_overheads', 'hidden', null), ('v_month_pnl', 'adj_non_pnl_out', 'hidden', null), ('v_month_pnl', 'adjust_result', 'hidden', null),
  ('v_month_pnl_live', 'net_in', 'hidden', null), ('v_month_pnl_live', 'gst_in', 'hidden', null), ('v_month_pnl_live', 'unresolved_gross', 'hidden', null),
  ('v_month_pnl_live', 'order_costs', 'hidden', null), ('v_month_pnl_live', 'overheads', 'hidden', null), ('v_month_pnl_live', 'non_pnl_out', 'hidden', null),
  ('v_month_pnl_live', 'cash_out_total', 'hidden', null), ('v_month_pnl_live', 'input_tax', 'hidden', null),
  ('v_month_team', 'net_credited', 'hidden', null), ('v_month_team', 'quarter_achieved_net', 'hidden', null),
  ('v_month_team', 'quarter_target_net', 'hidden', null),
  ('v_order_basis', 'items_net', 'hidden', null), ('v_order_basis', 'items_gross', 'hidden', null), ('v_order_basis', 'invoice_net', 'hidden', null),
  ('v_order_basis', 'invoice_gross', 'hidden', null),
  ('v_order_items_total', 'net', 'm3', null), ('v_order_items_total', 'gst', 'm3', null), ('v_order_items_total', 'gross', 'm3', null),
  ('v_order_money', 'net_sale', 'hidden', null), ('v_order_money', 'expected_cost', 'hidden', null), ('v_order_money', 'actual_cost', 'hidden', null),
  ('v_order_money', 'margin', 'hidden', null), ('v_order_money', 'gross_target', 'hidden', null), ('v_order_money', 'settled', 'hidden', null),
  ('v_order_money', 'overpaid_by', 'hidden', null),
  ('v_order_state', 'net', 'm3', null), ('v_order_state', 'gst', 'm3', null), ('v_order_state', 'gross', 'm3', null),
  ('v_payment_net', 'amount', 'hidden', null), ('v_payment_net', 'net_portion', 'hidden', null), ('v_payment_net', 'gst_portion', 'hidden', null),
  ('v_report_clarification_turnaround', 'total_days', 'info', null),
  ('v_report_float', 'items_quoted', 'info', null), ('v_report_float', 'items_total', 'info', null),
  ('v_rfq_state', 'items_quoted', 'info', null), ('v_rfq_state', 'items_total', 'info', null),
  ('v_supplier_stats', 'quoted', 'info', null), ('v_supplier_stats', 'prices_hidden', 'info', null),
  ('v_jobs', 'cancelled_orders', 'info', null),   -- 0099: a count; v_jobs has no price, amount or rate column (its stage is a word, from job_stage)
  ('v_supplier_category_evidence', 'quoted', 'info', null),   -- 0093: a count of inquiries, not a price
  ('v_target_progress', 'target_net', 'hidden', null), ('v_target_progress', 'achieved_net', 'hidden', null),
  ('v_target_progress', 'on_pace_net', 'hidden', null);

-- Function results: (function, result column or '<return>' for a scalar JSON result).
create temp table money_fns (obj text, col text, rule text check (rule in ('hidden', 'm3', 'supplier', 'own', 'info')), primary key (obj, col));
insert into money_fns values
  ('aging_as_of', 'gross', 'hidden'), ('aging_as_of', 'applied', 'hidden'), ('aging_as_of', 'remaining', 'hidden'), ('aging_as_of', 'advance_held', 'hidden'),
  ('payables_as_of', 'committed', 'hidden'), ('payables_as_of', 'committed_pkr', 'hidden'), ('payables_as_of', 'fx_rate', 'hidden'),
  ('payables_as_of', 'paid_pkr', 'hidden'), ('payables_as_of', 'owed_pkr', 'hidden'),
  ('held_advances', 'held', 'hidden'),   -- 0080: advances held on cancelled orders, admin only
  ('customer_statement', 'debit', 'hidden'), ('customer_statement', 'credit', 'hidden'),   -- 0125: a customer's statement of account, admin only
  ('cash_in_hand', 'base_pkr', 'hidden'), ('cash_in_hand', 'topups_pkr', 'hidden'), ('cash_in_hand', 'cash_out_pkr', 'hidden'),   -- 0087
  ('cash_in_hand', 'expected_pkr', 'hidden'), ('cash_in_hand', 'last_difference_pkr', 'hidden'), ('cash_in_hand', 'cash_out_count', 'info'),
  ('order_receivables', 'gross_target', 'hidden'), ('order_receivables', 'settled', 'hidden'), ('order_receivables', 'balance', 'hidden'),
  ('order_receivables', 'overpaid_by', 'hidden'),
  ('month_end_check_details', 'detail', 'hidden'),
  ('money_exceptions_input', '<return>', 'hidden'), ('month_pnl_drift', '<return>', 'hidden'), ('month_pnl_adjusted', '<return>', 'hidden'),
  ('apply_fx_payload', '<return>', 'hidden'),
  ('my_target_progress_at', 'target_net', 'hidden'), ('my_target_progress_at', 'achieved_net', 'hidden'), ('my_target_progress_at', 'on_pace_net', 'hidden'),
  ('my_target_progress', 'target_net', 'own'), ('my_target_progress', 'achieved_net', 'own'), ('my_target_progress', 'on_pace_net', 'own'),
  ('rank_item_quotes', 'sell_unit_net', 'hidden'), ('rank_item_quotes', 'sell_order_number', 'hidden'),
  ('rank_item_quotes', 'spread_unit', 'hidden'), ('rank_item_quotes', 'spread_total', 'hidden'),
  ('rank_item_quotes', 'price', 'supplier'), ('rank_item_quotes', 'pkr_unit_price', 'supplier'), ('rank_item_quotes', 'fx_rate_pkr', 'supplier'),
  ('rank_item_quotes', 'orders_value_pkr', 'supplier'),
  ('customer_price_memory', 'quoted_price', 'm3'), ('customer_price_memory', 'sold_price', 'm3'),
  ('customer_price_memory', 'quoted_number', 'info'), ('customer_price_memory', 'quoted_revision', 'info'), ('customer_price_memory', 'quoted_tier', 'info'),
  ('customer_price_memory', 'sold_order_number', 'info'), ('customer_price_memory', 'sold_tier', 'info'),
  ('po_line_prefill', 'unit_price', 'supplier'),
  ('search_closed_rfqs', 'total', 'info'),
  ('record_history', '<return>', 'info'), ('record_history_rows', '<return>', 'info'),   -- 0090: redacted with the engineer's column privileges (0090_record_history.test.sql proves no price comes back)
  ('receivables_list', 'gross_target', 'hidden'), ('receivables_list', 'settled', 'hidden'), ('receivables_list', 'balance', 'hidden'),
  ('receivables_list', 'overpaid_by', 'hidden'),
  ('receivables_summary', 'gross', 'hidden'), ('receivables_summary', 'settled', 'hidden'), ('receivables_summary', 'outstanding', 'hidden'),
  ('receivables_summary', 'overdue', 'hidden'), ('receivables_summary', 'not_yet_due', 'hidden'), ('receivables_summary', 'not_invoiced', 'hidden'),
  ('receivables_summary', 'settled_count', 'info'),
  ('lookup_labels', '<return>', 'info'),
  ('float_rfq', '<return>', 'info'),   -- 0070: returns the floated RFQ as JSON (ids and numbers, no price)
  ('supplier_item_memory', 'last_quote_price', 'supplier'), ('supplier_item_memory', 'last_quote_price_pkr', 'supplier'),
  ('supplier_item_memory', 'last_quote_fx_rate_pkr', 'supplier'), ('supplier_item_memory', 'last_po_price', 'supplier'),
  ('supplier_item_memory', 'last_po_price_pkr', 'supplier'), ('supplier_item_memory', 'last_po_fx_rate_pkr', 'supplier'),
  ('supplier_item_memory', 'last_ordered_price', 'supplier'), ('supplier_item_memory', 'last_ordered_price_pkr', 'supplier'),
  ('supplier_item_memory', 'last_ordered_fx_rate_pkr', 'supplier');

-- ------------------------------------------------------------------ coverage: the catalog has nothing unclassified
-- The name pattern is wide on purpose; a false match is classified 'info'.
create function pg_temp.moneyish(name text) returns boolean language sql immutable as $$
  select name ~ '(price|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|settled|achieved|target|payable|owed|committed|advance|applied|remaining|result|drawings|cash|money|_in$|_out$|rate|credit|sale|sold|quoted|sell|overhead|deposit|value|fee|profit)'
$$;

select is((select coalesce(array_agg(x order by x), '{}') from (
             select c.table_name || '.' || c.column_name as x
             from information_schema.columns c
             where c.table_schema = 'public'
               and (c.data_type in ('jsonb', 'json')
                    or (c.data_type in ('numeric', 'integer', 'bigint', 'smallint', 'real', 'double precision') and pg_temp.moneyish(c.column_name)))
             except
             select obj || '.' || col from money_cols) u),
          '{}'::text[], 'coverage: every money-looking or JSON column of every table and view is classified in money_cols');
select is((select coalesce(array_agg(x order by x), '{}') from (
             select obj || '.' || col as x from money_cols
             except
             select c.table_name || '.' || c.column_name from information_schema.columns c where c.table_schema = 'public') u),
          '{}'::text[], 'money_cols names only columns that exist');

select is((select coalesce(array_agg(x order by x), '{}') from (
             select p.proname || '.' || a.name as x
             from pg_proc p
             cross join lateral unnest(p.proargnames, p.proargmodes::text[], p.proallargtypes) as a (name, mode, typ)
             where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
               and a.mode in ('o', 't', 'b')
               and (a.typ in ('jsonb'::regtype, 'json'::regtype)
                    or (a.typ in ('numeric'::regtype, 'integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'real'::regtype, 'double precision'::regtype)
                        and pg_temp.moneyish(a.name)))
             union
             select p.proname || '.<return>' from pg_proc p
             where p.pronamespace = 'public'::regnamespace and p.prorettype in ('jsonb'::regtype, 'json'::regtype) and p.proallargtypes is null
             except
             select obj || '.' || col from money_fns) u),
          '{}'::text[], 'coverage: every money-looking or JSON result of every function is classified in money_fns');

-- ------------------------------------------------------------------ preconditions: the fixtures hold money everywhere
select is((select coalesce(array_agg(distinct m.obj order by m.obj), '{}') from money_cols m
           where m.rule <> 'info' and pg_temp.scalar_as(format('select count(*) from public.%I', m.obj), 'admin') in ('0', '<none>')),
          '{}'::text[], 'precondition: the admin sees rows in every table and view that holds money');
-- 0078 (BUG-RV-01): the raw rows the fixtures wrote into legacy_source were moved to legacy_archive.legacy_rows by the
-- database; the column keeps a marker. The money is still there (as the owner reads it), just not in a readable column.
select is((select coalesce(array_agg(m.obj || '.' || m.col order by m.obj, m.col), '{}') from money_cols m
           where m.col = 'legacy_source' and m.obj not in ('companies', 'supplier_inquiries')
             and not exists (select 1 from legacy_archive.legacy_rows r
                             where r.table_name = m.obj and exists (select 1 from pg_temp.money_keys(r.data)))),
          '{}'::text[], 'precondition: the imported raw rows carry money (in legacy_archive.legacy_rows, 0078)');
select is((select count(*)::int from public.orders where legacy_source is not null and not legacy_archive.is_marker(legacy_source))
          + (select count(*)::int from public.order_items where legacy_source is not null and not legacy_archive.is_marker(legacy_source))
          + (select count(*)::int from public.supplier_orders where legacy_source is not null and not legacy_archive.is_marker(legacy_source))
          + (select count(*)::int from public.rfqs where legacy_source is not null and not legacy_archive.is_marker(legacy_source))
          + (select count(*)::int from public.rfq_items where legacy_source is not null and not legacy_archive.is_marker(legacy_source)),
          0, 'every legacy_source left in public is the money-free marker (0078)');
select is(pg_temp.scalar_as('select count(*) from legacy_archive.legacy_rows', p), 'E:42501', format('%s cannot read legacy_archive.legacy_rows', p))
from unnest(array['admin', 'sales', 'engineer', 'deactivated']) p;

-- ------------------------------------------------------------------ hidden: the engineer gets nothing (real assertions)
-- A numeric column: no row with a value. A JSON column: no row with a money-named key that has a value.
create function pg_temp.engineer_sees(o text, c text) returns text language sql as $$
  select pg_temp.scalar_as(
    case when (select data_type from information_schema.columns where table_schema = 'public' and table_name = o and column_name = c)
              in ('jsonb', 'json')
         then format('select count(*) from public.%I t where exists (select 1 from pg_temp.money_keys(t.%I::jsonb))', o, c)
         else format('select count(*) from public.%I where %I is not null', o, c) end,
    'engineer')
$$;

select ok(pg_temp.engineer_sees(m.obj, m.col) in ('0', 'E:42501'),
  format('engineer reads no %s.%s (got %s)', m.obj, m.col, pg_temp.engineer_sees(m.obj, m.col)))
from money_cols m where m.rule = 'hidden' and m.bug is null order by m.obj, m.col;

-- BUG-RV-01: the legacy import's raw rows (orders, order items, supplier legs, RFQs, RFQ items) carry the old order value,
-- COST value and GST amount, and the RFQ's estimated value and quoted price. Those tables are readable by every staff
-- role (s10), so an engineer reads costs and margins (order_value - cost_value) of all imported history. The company
-- (supplier) page even downloads supplier_orders.legacy_source into every role's browser
-- (src/features/companies/api.ts: supplier_orders select ... legacy_source).
-- BUG-RV-01 (fixed in 0078): the raw rows are in legacy_archive; legacy_source keeps a marker with no money.
select is(pg_temp.engineer_sees(m.obj, m.col), '0', format('BUG-RV-01 engineer reads no money in %s.%s', m.obj, m.col))
from money_cols m where m.col = 'legacy_source' order by m.obj, m.col;

-- 0081 (owner decision 2026-10-22): selling and supplier prices and exchange rates are now refused at the database too.
select ok(pg_temp.engineer_sees(m.obj, m.col) in ('0', 'E:42501'),
  format('0081 engineer reads no selling price in %s.%s (got %s)', m.obj, m.col, pg_temp.engineer_sees(m.obj, m.col)))
from money_cols m where m.rule = 'm3' order by m.obj, m.col;
select ok(pg_temp.engineer_sees(m.obj, m.col) in ('0', 'E:42501'),
  format('0081 engineer reads no supplier price or rate in %s.%s (got %s)', m.obj, m.col, pg_temp.engineer_sees(m.obj, m.col)))
from money_cols m where m.rule = 'supplier' order by m.obj, m.col;
-- and the admin and sales still read them (nothing changed for them)
select ok(pg_temp.scalar_as(format('select count(*) from public.%I where %I is not null', m.obj, m.col), p) not in ('0', '<none>')
          and pg_temp.scalar_as(format('select count(*) from public.%I where %I is not null', m.obj, m.col), p) not like 'E:%',
  format('0081 %s still reads %s.%s', p, m.obj, m.col))
from money_cols m cross join unnest(array['admin', 'sales']) p
where m.rule in ('m3', 'supplier') and m.col not in ('legacy_source', 'fx_rate_pkr')
  and (select data_type from information_schema.columns where table_schema = 'public' and table_name = m.obj and column_name = m.col) not in ('jsonb', 'json')
order by m.obj, m.col, p;

-- own: only the engineer's own target.
select is(pg_temp.scalar_as('select count(*) from public.targets where user_id <> auth.uid()', 'engineer'), '0',
  'engineer reads no one else''s target');
select is(pg_temp.scalar_as('select count(*) from public.targets where user_id = auth.uid()', 'engineer'), '1',
  'engineer reads their own target (s10 targets: S own)');
-- 0087: an engineer's own "I paid" claims, with the amount they typed, and nobody else's; sales read none.
select is(pg_temp.scalar_as('select count(*) from public.expense_claims where created_by <> auth.uid()', 'engineer'), '0',
  '0087 engineer reads no one else''s claim');
select is(pg_temp.scalar_as('select sum(amount_pkr)::int from public.expense_claims', 'engineer'), '5',
  '0087 engineer reads the amount of their own claim (5), not the admin''s (7)');
select is(pg_temp.scalar_as('select count(*) from public.expense_claims', 'sales'), '0', '0087 sales read no claim');

-- ------------------------------------------------------------------ functions, as the engineer
select ok(pg_temp.scalar_as(s, 'engineer') in ('0', '<null>', '<none>', 'E:42501'),
  format('engineer gets no money from %s (got %s)', label, pg_temp.scalar_as(s, 'engineer')))
from (values
  ('aging_as_of', 'select count(*) from public.aging_as_of(public.today_pkt())'),
  ('payables_as_of', 'select count(*) from public.payables_as_of(public.today_pkt())'),
  ('held_advances (0080)', 'select count(*) from public.held_advances()'),
  ('customer_statement (0125)', 'select count(*) from public.customer_statement(gen_random_uuid())'),
  ('link_imported_invoices (0096)', 'select count(*) from public.link_imported_invoices()'),
  ('link_imported_invoice (0096)', 'select public.link_imported_invoice(gen_random_uuid(), gen_random_uuid())::text'),
  ('unlink_imported_invoice (0096)', 'select public.unlink_imported_invoice(gen_random_uuid())::text'),
  ('set_legacy_review (0096)', $q$select public.set_legacy_review('order', gen_random_uuid(), 'settled')::text$q$),
  ('cash_in_hand (0087)', 'select count(*) from public.cash_in_hand()'),
  ('order_receivables', 'select count(*) from public.order_receivables()'),
  ('order_receivables(order)', 'select count(*) from public.order_receivables(@20)'),
  ('receivables_list (0074)', 'select count(*) from public.receivables_list(null, null, null, true)'),
  ('receivables_summary (0074)', 'select count(*) from public.receivables_summary() where gross <> 0 or settled <> 0'),
  ('month_end_check_details', 'select count(*) from public.month_end_check_details(public.today_pkt())'),
  ('month_end_status', 'select count(*) from public.month_end_status(public.today_pkt())'),
  ('money_exceptions_input', 'select public.money_exceptions_input()::text'),
  ('month_pnl_drift', 'select public.month_pnl_drift()::text'),
  ('month_pnl_adjusted', 'select public.month_pnl_adjusted()::text'),
  ('apply_fx_payload', $q$select public.apply_fx_payload('{}'::jsonb, 'probe')::text$q$),
  ('my_target_progress_at', 'select count(*) from public.my_target_progress_at(now())'),
  ('rank_item_quotes (selling price and spread)', 'select count(*) from public.rank_item_quotes(@15) where sell_unit_net is not null or sell_order_number is not null or spread_unit is not null or spread_total is not null'),
  ('search_all (money text in a label or meta)', $q$select count(*) from public.search_all('M', 25) where coalesce(label, '') || ' ' || coalesce(meta, '') ~* '(rs\.?|pkr)\s*[0-9]|INV-'$q$),
  ('search_all (invoice rows)', $q$select count(*) from public.search_all('INV', 25) where kind = 'invoice'$q$)
) t (label, s)
order by label;

select ok(pg_temp.scalar_as('select count(*) from public.month_end_status(public.today_pkt())', 'admin') not in ('0', '<none>'),
  'precondition: the admin gets the month-end checklist (so the engineer''s zero above means refused)');
select ok(pg_temp.scalar_as($q$select count(*) from public.search_all('INV', 25) where kind = 'invoice'$q$, 'sales') not in ('0', '<none>'),
  'precondition: sales find an invoice by number (so the engineer''s zero above means hidden)');
select is(pg_temp.scalar_as('select count(*) from public.my_target_progress()', 'engineer'), '1',
  'my_target_progress answers the engineer about themselves only (no parameter)');

-- 0081: the price RPCs are refused to the engineer (no execute).
select is(pg_temp.scalar_as('select count(*) from public.customer_price_memory(@15) where quoted_price is not null or sold_price is not null', 'engineer'),
  'E:42501', '0081 customer_price_memory is refused to the engineer');
select is(pg_temp.scalar_as('select count(*) from public.po_line_prefill(@23) where unit_price is not null', 'engineer'),
  'E:42501', '0081 po_line_prefill is refused to the engineer');
select is(pg_temp.scalar_as('select count(*) from public.rank_item_quotes(@15) where price is not null or pkr_unit_price is not null', 'engineer'),
  'E:42501', '0081 rank_item_quotes is refused to the engineer');
select is(pg_temp.scalar_as($q$select count(*) from public.supplier_item_memory(array[@03], @13, null, 'Fixture order item') where last_quote_price is not null or last_po_price is not null or last_ordered_price is not null$q$, 'engineer'),
  'E:42501', '0081 supplier_item_memory is refused to the engineer');
select ok(pg_temp.scalar_as('select count(*) from public.rank_item_quotes(@15) where price is not null', 'sales') not in ('0', '<none>')
          and pg_temp.scalar_as('select count(*) from public.rank_item_quotes(@15) where price is not null', 'sales') not like 'E:%',
  '0081 sales still get the ranked supplier prices');

-- ------------------------------------------------------------------ embedded selects (what PostgREST builds for ?select=*,invoices(*)...)
-- PostgREST embeds a related table as a correlated sub-select run as the caller, so row security of each embedded
-- table applies. The order @20 has two invoices, a payment, a cost row and a margin row.
select is(pg_temp.scalar_as($q$select concat_ws('|',
            (select count(*) from public.invoices i where i.order_id = o.id),
            (select count(*) from public.payments_in p where p.order_id = o.id),
            (select count(*) from public.order_costs c where c.order_id = o.id),
            (select count(*) from public.v_order_money m where m.order_id = o.id),
            (select count(*) from public.v_payment_net n where n.order_id = o.id),
            (select count(*) from public.attachments a join public.invoices i on i.id = a.invoice_id where i.order_id = o.id))
          from public.orders o where o.id = @20$q$, 'engineer'),
  '0|0|0|0|0|0', 'engineer: an order with its invoices, payments, costs, margin, payment split and GST receipts embedded gives none of them');
select is(pg_temp.scalar_as($q$select concat_ws('|',
            (select count(*) from public.invoices i where i.order_id = o.id),
            (select count(*) from public.payments_in p where p.order_id = o.id),
            (select count(*) from public.order_costs c where c.order_id = o.id),
            (select count(*) from public.v_order_money m where m.order_id = o.id),
            (select count(*) from public.v_payment_net n where n.order_id = o.id),
            (select count(*) from public.attachments a join public.invoices i on i.id = a.invoice_id where i.order_id = o.id))
          from public.orders o where o.id = @20$q$, 'admin'),
  '2|1|1|1|1|1', 'precondition: the admin gets all of them for the same order');
select is(pg_temp.scalar_as($q$select concat_ws('|',
            (select count(*) from public.payments_in p where p.order_id = o.id),
            (select count(*) from public.order_costs c where c.order_id = o.id),
            (select count(*) from public.v_order_money m where m.order_id = o.id))
          from public.orders o where o.id = @20$q$, 'sales'),
  '0|0|0', 'sales: payments, costs and margin stay admin only when embedded too');

-- Every foreign key INTO a hidden money table, followed from a table the engineer can read, gives nothing.
select is((select coalesce(array_agg(x order by x), '{}') from (
             select format('%s -> %s', src.relname, dst.relname) as x
             from pg_constraint k
             join pg_class src on src.oid = k.conrelid
             join pg_class dst on dst.oid = k.confrelid
             where k.contype = 'f' and src.relnamespace = 'public'::regnamespace and dst.relnamespace = 'public'::regnamespace
               and dst.relname in ('invoices', 'payments_in', 'expenses', 'order_costs', 'recurring_expenses', 'expense_categories',
                                   'closed_months', 'month_snapshots', 'audit_log')
               and pg_temp.scalar_as(format('select count(*) from public.%I', dst.relname), 'engineer') not in ('0', 'E:42501')) u),
          '{}'::text[], 'engineer: every money table that another table links to stays empty for them (embedding cannot reach it)');

select * from finish();
rollback;
