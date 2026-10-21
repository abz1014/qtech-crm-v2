begin;
select * from no_plan();

-- 0904 (verification suite, branch test/roles-verify): a closed month cannot be changed except by reopening it (admin),
-- and the audit log records who changed every money row.
--
-- Month lock (DATA_MODEL A6.1, 0027, 0058, 0065 L-6): payments (received_on), expenses (paid_on) and invoices
-- (invoice_date) dated in a closed month are frozen for EVERY role, admin included; only bank ticks, filing stamps and
-- notes stay editable; receipts can be added but not changed or removed; nothing writes closed_months or
-- month_snapshots directly; the closed month's P&L and checklist are frozen at close. Each attempt below runs as the
-- persona through the API role, inside a sub-transaction that is rolled back, and reports 'ok:<rows>' or 'E:<sqlstate>'.
-- Audit (0005, 0013): an AFTER trigger writes audit_log with changed_by = auth.uid() for every row change.

-- ------------------------------------------------------------------ machinery
create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       else '00000000-0000-0000-0000-000000000000' end $$;

create function pg_temp.try_as(stmt text, persona text) returns text language plpgsql as $f$
declare
  n bigint;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    execute stmt;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = n::text;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return 'ok:' || d;
    when others then
      return 'E:' || sqlstate;
  end;
end;
$f$;

-- ------------------------------------------------------------------ fixtures (as the owner, admin claims)
-- March 2020 is closed below; May 2020 stays open. Ids: 9904....
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('99040000-0000-4000-8000-000000000001', '0904 Customer'), ('99040000-0000-4000-8000-000000000002', '0904 Customer duplicate'),
  ('99040000-0000-4000-8000-000000000003', '0904 Supplier');
insert into public.orders (id, company_id, owner_id, created_at) values
  ('99040000-0000-4000-8000-000000000010', '99040000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '2020-02-01');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('99040000-0000-4000-8000-000000000011', '99040000-0000-4000-8000-000000000010', '99040000-0000-4000-8000-000000000003', 'PKR');
insert into public.order_items (id, order_id, description, qty, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  ('99040000-0000-4000-8000-000000000012', '99040000-0000-4000-8000-000000000010', 'Pressure transmitter', 2, 50000, 18,
   '99040000-0000-4000-8000-000000000011', 30000);
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('99040000-0000-4000-8000-000000000020', '99040000-0000-4000-8000-000000000010', 'INV-0904-1', '2020-03-10', 100000, 18000);
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount) values   -- a GST-register invoice with a company only
  ('99040000-0000-4000-8000-000000000021', '99040000-0000-4000-8000-000000000002', 'INV-0904-2', '2020-03-11', 1000, 180);
insert into public.payments_in (id, order_id, amount, received_on, paid_via) values
  ('99040000-0000-4000-8000-000000000030', '99040000-0000-4000-8000-000000000010', 59000, '2020-03-12', 'bank'),
  ('99040000-0000-4000-8000-000000000031', '99040000-0000-4000-8000-000000000010', 59000, '2020-05-05', 'bank');
insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via, supplier_order_id, order_id) values
  ('99040000-0000-4000-8000-000000000040', 60000, 'ca7e0000-0000-4000-8000-000000000011', '2020-03-15', 'bank',
   '99040000-0000-4000-8000-000000000011', '99040000-0000-4000-8000-000000000010'),
  ('99040000-0000-4000-8000-000000000041', 2000, 'ca7e0000-0000-4000-8000-000000000002', '2020-05-06', 'bank', null, null);
insert into storage.objects (bucket_id, name) values ('gst-receipts', '0904/inv.pdf'), ('expense-receipts', '0904/exp.jpg');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  ('99040000-0000-4000-8000-000000000050', 'gst-receipts', '0904/inv.pdf', 'inv.pdf', 'application/pdf', 10, '99040000-0000-4000-8000-000000000020');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values
  ('99040000-0000-4000-8000-000000000051', 'expense-receipts', '0904/exp.jpg', 'exp.jpg', 'image/jpeg', 10, '99040000-0000-4000-8000-000000000040');

select is(public.close_months_through(date '2020-03-01'), 1, 'fixture: March 2020 is closed (one month: the first with money rows)');

-- The figures as they were closed.
create temp table frozen as
select (select to_jsonb(p) - 'frozen_at' from public.v_month_pnl p where p.month = '2020-03-01') as pnl,
       (select jsonb_agg(to_jsonb(s) order by s.check_key) from public.month_end_status(date '2020-03-01') s) as status;
select ok((select (pnl ->> 'frozen')::boolean from frozen), 'fixture: March 2020''s P&L is frozen');

-- ------------------------------------------------------------------ locked rows: every write path, every role
create temp table lock_case (label text, stmt text, persona text, expect text);
insert into lock_case values
  -- payments (admin only table)
  ('payment amount', $q$update public.payments_in set amount = 1 where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'E:P0001'),
  ('payment reference', $q$update public.payments_in set reference = 'x' where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'E:P0001'),
  ('payment order', $q$update public.payments_in set order_id = order_id where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'ok:1'),
  ('payment moved out of March', $q$update public.payments_in set received_on = '2020-05-01' where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'E:P0001'),
  ('payment moved into March', $q$update public.payments_in set received_on = '2020-03-31' where id = '99040000-0000-4000-8000-000000000031'$q$, 'admin', 'E:P0001'),
  ('payment paid via', $q$update public.payments_in set paid_via = 'cash' where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'E:P0001'),
  ('payment deleted', $q$delete from public.payments_in where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'E:P0001'),
  ('payment added to March', $q$insert into public.payments_in (order_id, amount, received_on) values ('99040000-0000-4000-8000-000000000010', 5, '2020-03-20')$q$, 'admin', 'E:P0001'),
  ('payment bank tick (allowed)', $q$update public.payments_in set bank_month = '2020-03-01' where id = '99040000-0000-4000-8000-000000000030'$q$, 'admin', 'ok:1'),
  -- expenses (admin only table)
  ('expense amount', $q$update public.expenses set amount_pkr = 1 where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense input tax', $q$update public.expenses set input_tax_pkr = 100 where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense category', $q$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000010' where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense order tag', $q$update public.expenses set order_id = null where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense moved out of March', $q$update public.expenses set paid_on = '2020-05-01' where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense moved into March', $q$update public.expenses set paid_on = '2020-03-31' where id = '99040000-0000-4000-8000-000000000041'$q$, 'admin', 'E:P0001'),
  ('expense deleted', $q$delete from public.expenses where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'E:P0001'),
  ('expense added to March', $q$insert into public.expenses (amount_pkr, category_id, paid_on) values (5, 'ca7e0000-0000-4000-8000-000000000002', '2020-03-20')$q$, 'admin', 'E:P0001'),
  ('expense bank tick (allowed)', $q$update public.expenses set bank_month = '2020-03-01' where id = '99040000-0000-4000-8000-000000000040'$q$, 'admin', 'ok:1'),
  -- invoices (admin and sales)
  ('invoice net', $q$update public.invoices set net_amount = 1 where id = '99040000-0000-4000-8000-000000000020'$q$, 'admin', 'E:P0001'),
  ('invoice net', $q$update public.invoices set net_amount = 1 where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'E:P0001'),
  ('invoice GST', $q$update public.invoices set gst_amount = 0 where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'E:P0001'),
  ('invoice number', $q$update public.invoices set number = 'INV-X' where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'E:P0001'),
  ('invoice moved out of March', $q$update public.invoices set invoice_date = '2020-05-01' where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'E:P0001'),
  ('invoice order', $q$update public.invoices set order_id = null, company_id = '99040000-0000-4000-8000-000000000001' where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'E:P0001'),
  ('invoice company', $q$update public.invoices set company_id = '99040000-0000-4000-8000-000000000001' where id = '99040000-0000-4000-8000-000000000021'$q$, 'admin', 'E:P0001'),
  ('invoice deleted', $q$delete from public.invoices where id = '99040000-0000-4000-8000-000000000020'$q$, 'admin', 'E:P0001'),
  ('invoice deleted (sales may not delete at all, s10)', $q$delete from public.invoices where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'ok:0'),
  ('invoice added to March', $q$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values ('99040000-0000-4000-8000-000000000010', 'INV-0904-9', '2020-03-20', 1, 0)$q$, 'sales', 'E:P0001'),
  ('invoice notes (allowed)', $q$update public.invoices set notes = 'filed late' where id = '99040000-0000-4000-8000-000000000020'$q$, 'sales', 'ok:1'),
  ('invoice FBR bank tick (allowed)', $q$update public.invoices set tax_bank_month = '2020-04-01' where id = '99040000-0000-4000-8000-000000000020'$q$, 'admin', 'ok:1'),
  ('invoice TCS stamp (allowed)', $q$select public.stamp_tcs_sent(array['99040000-0000-4000-8000-000000000020'::uuid])$q$, 'sales', 'ok:1'),
  ('invoice settled before cutover', $q$update public.invoices set settled_before_cutover = true where id = '99040000-0000-4000-8000-000000000021'$q$, 'admin', 'E:42501'),
  -- receipts of a closed month (L-6): can be added, not changed or removed
  ('GST receipt removed', $q$delete from public.attachments where id = '99040000-0000-4000-8000-000000000050'$q$, 'sales', 'E:P0001'),
  ('GST receipt renamed', $q$update public.attachments set file_name = 'x.pdf' where id = '99040000-0000-4000-8000-000000000050'$q$, 'admin', 'E:P0001'),
  ('GST receipt file overwritten', $q$update storage.objects set name = name where bucket_id = 'gst-receipts' and name = '0904/inv.pdf'$q$, 'sales', 'ok:0'),
  ('expense receipt removed', $q$delete from public.attachments where id = '99040000-0000-4000-8000-000000000051'$q$, 'admin', 'E:P0001'),
  ('expense receipt file overwritten', $q$update storage.objects set name = name where bucket_id = 'expense-receipts' and name = '0904/exp.jpg'$q$, 'admin', 'ok:0'),
  ('GST receipt added (allowed)', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id) values ('gst-receipts', '0904/inv2.pdf', 'inv2.pdf', 'application/pdf', 10, '99040000-0000-4000-8000-000000000020')$q$, 'sales', 'ok:1'),
  -- the month record and its snapshot are written by the RPCs only
  ('closed_months deleted directly', $q$delete from public.closed_months where month = '2020-03-01'$q$, 'admin', 'E:42501'),
  ('closed_months note edited directly', $q$update public.closed_months set note = 'x' where month = '2020-03-01'$q$, 'admin', 'E:42501'),
  ('closed_months inserted directly', $q$insert into public.closed_months (month) values ('2020-04-01')$q$, 'admin', 'E:42501'),
  ('snapshot edited', $q$update public.month_snapshots set pnl = '{}' where month = '2020-03-01'$q$, 'admin', 'E:42501'),
  ('snapshot deleted', $q$delete from public.month_snapshots where month = '2020-03-01'$q$, 'admin', 'E:42501'),
  ('reopen by sales', $q$select public.reopen_month(date '2020-03-01')$q$, 'sales', 'E:42501'),
  ('reopen by engineer', $q$select public.reopen_month(date '2020-03-01')$q$, 'engineer', 'E:42501'),
  ('close by sales', $q$select public.close_month(date '2020-04-01')$q$, 'sales', 'E:42501'),
  -- the parents of locked rows
  ('order with a closed payment deleted', $q$delete from public.orders where id = '99040000-0000-4000-8000-000000000010'$q$, 'admin', 'E:*'),
  ('leg with a closed expense deleted', $q$delete from public.supplier_orders where id = '99040000-0000-4000-8000-000000000011'$q$, 'admin', 'E:*'),
  ('category of a closed expense deleted', $q$delete from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000011'$q$, 'admin', 'E:*');

select ok(case when c.expect = 'E:*' then r like 'E:%' else r = c.expect end,
  format('closed month, %s as %s: %s (got %s)', c.label, c.persona, c.expect, r))
from lock_case c cross join lateral (select pg_temp.try_as(c.stmt, c.persona) as r) x
order by c.label, c.persona;

-- merge_companies moves every row of the dropped company, including an invoice in a closed month: the lock wins.
select ok(pg_temp.try_as($q$select public.merge_companies('99040000-0000-4000-8000-000000000001', '99040000-0000-4000-8000-000000000002')$q$, 'admin') = 'E:P0001',
  'closed month: merging away a company whose invoice is in a closed month is refused (reopen first)');

-- ------------------------------------------------------------------ the closed month's figures do not move
-- Changes the lock allows (a selling price by sales, an expense category's group by the admin, the value basis by the
-- admin) must leave March 2020's frozen P&L and checklist as they were closed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($q$update public.order_items set unit_price_net = 10 where id = '99040000-0000-4000-8000-000000000012'$q$,
  'sales may still change a selling price on an order paid in a closed month (0065)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($q$update public.expense_categories set grp = 'non_pnl' where id = 'ca7e0000-0000-4000-8000-000000000011'$q$,
  '23514', null, '0082: a category used in a closed month cannot move to another P&L kind (its closed profit would change)');
select lives_ok($q$update public.expense_categories set name = 'Supplier payments' where id = 'ca7e0000-0000-4000-8000-000000000011'$q$,
  'the admin may still rename a category used in a closed month');
reset role;
select is((select to_jsonb(p) - 'frozen_at' from public.v_month_pnl p where p.month = '2020-03-01') - array['adj_net_in', 'adj_gst_in', 'adj_unresolved_gross', 'adj_order_costs', 'adj_overheads', 'adj_non_pnl_out', 'adjust_result'],
          (select pnl from frozen) - array['adj_net_in', 'adj_gst_in', 'adj_unresolved_gross', 'adj_order_costs', 'adj_overheads', 'adj_non_pnl_out', 'adjust_result'],
  'closed month: March 2020''s P&L (net in, costs, overheads, result, cash) is exactly as closed');
select is((select jsonb_agg(to_jsonb(s) order by s.check_key) from public.month_end_status(date '2020-03-01') s),
          (select status from frozen), 'closed month: March 2020''s checklist is exactly as closed');
select is((select count(*)::int from public.payments_in where id = '99040000-0000-4000-8000-000000000030' and amount = 59000), 1,
  'closed month: the payment is still there, unchanged');

-- Reopen (admin) is the one way back, and it is audited.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($q$select public.reopen_month(date '2020-03-01', 'correct the March payment')$q$, 'the admin reopens March 2020');
select lives_ok($q$update public.payments_in set amount = 59500 where id = '99040000-0000-4000-8000-000000000030'$q$,
  'after reopening, the admin can correct the payment');
reset role;
select is((select count(*)::int from public.month_snapshots where month = '2020-03-01'), 0, 'reopening drops the frozen snapshot');
select is((select count(*)::int from public.audit_log where table_name = 'closed_months' and record_id = '2020-03-01' and action = 'delete'
             and changed_by = 'a0000000-0000-4000-8000-000000000001' and old_value ->> 'note' like '%correct the March payment%'), 1,
  'the reopen is audited with who did it and why');

-- ------------------------------------------------------------------ audit: every money row change records who did it
select is((select coalesce(array_agg(t.tablename::text order by t.tablename), '{}') from pg_tables t
           where t.schemaname = 'public'
             and not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                             where g.tgrelid = format('public.%I', t.tablename)::regclass and p.proname = 'audit_row_change'
                               and not g.tgisinternal)),
          array['audit_log', 'fx_fetch_log', 'month_snapshots', 'users'],
  'audit: every table has the audit trigger except the log itself, the FX job journal, the snapshots (written at close, which is audited) and users (written by admin-users, which audits)');
select is((select count(*)::int from pg_trigger g join pg_proc p on p.oid = g.tgfoid
           where p.proname = 'audit_row_change' and not g.tgisinternal
             and not (g.tgtype & 1 = 1 and g.tgtype & 2 = 0 and g.tgtype & 4 = 4 and g.tgtype & 8 = 8 and g.tgtype & 16 = 16)), 0,
  'audit: every audit trigger is FOR EACH ROW, AFTER, on insert, update and delete');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'UPDATE') and not has_table_privilege('service_role', 'public.audit_log', 'DELETE')
          and not has_table_privilege('authenticated', 'public.audit_log', 'INSERT') and not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'audit: no client can write the log, and not even the service role can change or delete a line');

-- Writes as each role, in the open current month; then the log is read as the owner.
create temp table audit_case (label text, persona text, stmt text, tbl text, rec text, act text, field text);
insert into audit_case values
  ('admin records a payment', 'admin', $q$insert into public.payments_in (id, order_id, amount) values ('99040000-0000-4000-8000-0000000000a1', '99040000-0000-4000-8000-000000000010', 1234)$q$, 'payments_in', '99040000-0000-4000-8000-0000000000a1', 'insert', 'amount'),
  ('admin corrects the payment', 'admin', $q$update public.payments_in set amount = 1235 where id = '99040000-0000-4000-8000-0000000000a1'$q$, 'payments_in', '99040000-0000-4000-8000-0000000000a1', 'update', 'amount'),
  ('admin deletes the payment', 'admin', $q$delete from public.payments_in where id = '99040000-0000-4000-8000-0000000000a1'$q$, 'payments_in', '99040000-0000-4000-8000-0000000000a1', 'delete', 'amount'),
  ('admin records an expense', 'admin', $q$insert into public.expenses (id, amount_pkr, category_id) values ('99040000-0000-4000-8000-0000000000a2', 777, 'ca7e0000-0000-4000-8000-000000000002')$q$, 'expenses', '99040000-0000-4000-8000-0000000000a2', 'insert', 'amount_pkr'),
  ('admin changes the expense', 'admin', $q$update public.expenses set amount_pkr = 778 where id = '99040000-0000-4000-8000-0000000000a2'$q$, 'expenses', '99040000-0000-4000-8000-0000000000a2', 'update', 'amount_pkr'),
  ('sales issues an invoice', 'sales', $q$insert into public.invoices (id, order_id, number, net_amount, gst_amount) values ('99040000-0000-4000-8000-0000000000a3', '99040000-0000-4000-8000-000000000010', 'INV-0904-A', 500, 90)$q$, 'invoices', '99040000-0000-4000-8000-0000000000a3', 'insert', 'net_amount'),
  ('sales changes the invoice', 'sales', $q$update public.invoices set gst_amount = 0 where id = '99040000-0000-4000-8000-0000000000a3'$q$, 'invoices', '99040000-0000-4000-8000-0000000000a3', 'update', 'gst_amount'),
  ('sales stamps the invoice sent (RPC)', 'sales', $q$select public.stamp_tcs_sent(array['99040000-0000-4000-8000-0000000000a3'::uuid])$q$, 'invoices', '99040000-0000-4000-8000-0000000000a3', 'update', 'tcs_sent_on'),
  ('sales changes a selling price', 'sales', $q$update public.order_items set unit_price_net = 49000 where id = '99040000-0000-4000-8000-000000000012'$q$, 'order_items', '99040000-0000-4000-8000-000000000012', 'update', 'unit_price_net'),
  ('admin sets the expected cost', 'admin', $q$insert into public.order_costs (order_id, expected_cost_pkr) values ('99040000-0000-4000-8000-000000000010', 61000)$q$, 'order_costs', '99040000-0000-4000-8000-000000000010', 'insert', 'expected_cost_pkr'),
  ('admin adds a recurring expense', 'admin', $q$insert into public.recurring_expenses (id, label, category_id, amount) values ('99040000-0000-4000-8000-0000000000a4', 'Rent 0904', 'ca7e0000-0000-4000-8000-000000000002', 90000)$q$, 'recurring_expenses', '99040000-0000-4000-8000-0000000000a4', 'insert', 'amount'),
  ('admin sets a target', 'admin', $q$insert into public.targets (id, user_id, year, quarter, target_net_pkr) values ('99040000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000002', 2091, 2, 5000000)$q$, 'targets', '99040000-0000-4000-8000-0000000000a5', 'insert', 'target_net_pkr'),
  ('engineer records a supplier price', 'engineer', $q$insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) select '99040000-0000-4000-8000-0000000000a6', si.id, ri.id, 4321, 'PKR' from public.supplier_inquiries si, public.rfq_items ri where si.id = '99040000-0000-4000-8000-0000000000b1' and ri.id = '99040000-0000-4000-8000-0000000000b2'$q$, 'supplier_quote_lines', '99040000-0000-4000-8000-0000000000a6', 'insert', 'unit_price'),
  ('engineer sets a manual FX rate', 'engineer', $q$insert into public.fx_rates (id, currency, rate_pkr, source, as_of) values ('99040000-0000-4000-8000-0000000000a7', 'CHF', 333, 'manual', public.today_pkt() - 400)$q$, 'fx_rates', '99040000-0000-4000-8000-0000000000a7', 'insert', 'rate_pkr'),
  ('admin closes months (RPC)', 'admin', $q$select public.close_months_through(date '2020-04-01')$q$, 'closed_months', '2020-04-01', 'insert', 'closed_by');

-- An RFQ, an item and an inquiry for the engineer's supplier price.
insert into public.rfqs (id, company_id, owner_id) values ('99040000-0000-4000-8000-0000000000b0', '99040000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description) values ('99040000-0000-4000-8000-0000000000b2', '99040000-0000-4000-8000-0000000000b0', 'Flow meter');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values ('99040000-0000-4000-8000-0000000000b1', '99040000-0000-4000-8000-0000000000b0', '99040000-0000-4000-8000-000000000003');

create function pg_temp.run_as(stmt text, persona text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return 'E:' || sqlstate || ' ' || sqlerrm;
end;
$f$;

-- The cases run in order (each one's effect is kept: the next may build on it).
create temp table audit_result as select 0 as n, ''::text as label, ''::text as res limit 0;
do $$
declare c record; i int := 0;
begin
  for c in select * from audit_case loop
    i := i + 1;
    insert into audit_result values (i, c.label, pg_temp.run_as(c.stmt, c.persona));
  end loop;
end;
$$;
select is(r.res, 'ok', format('audit setup: %s', r.label)) from audit_result r order by r.n;

select ok((select count(*) from public.audit_log l
           where l.table_name = c.tbl and l.record_id = c.rec and l.action = c.act and l.changed_by = pg_temp.uid(c.persona)::uuid
             and coalesce(l.new_value, l.old_value) ? c.field) >= 1,
  format('audit: "%s" is logged as %s by %s, with %s', c.label, c.act, c.persona, c.field))
from audit_case c
order by c.label;
select ok((select count(*) from public.audit_log l
           where l.table_name = c.tbl and l.record_id = c.rec and l.action = 'update' and l.changed_by = pg_temp.uid(c.persona)::uuid
             and l.old_value -> c.field is distinct from l.new_value -> c.field) >= 1,
  format('audit: "%s" keeps the old and the new %s', c.label, c.field))
from audit_case c
where c.act = 'update'
order by c.label;
select is((select array_agg(l.action order by l.action) from public.audit_log l
           where l.table_name = 'payments_in' and l.record_id = '99040000-0000-4000-8000-0000000000a1'),
          array['delete', 'insert', 'update'], 'audit: one line per change of the payment (insert, update, delete), no more');
select is((select count(*)::int from public.audit_log l
           where l.changed_by is null and l.record_id in (select rec from audit_case)),
          0, 'audit: no money change made by a signed-in person is logged without a name');

select * from finish();
rollback;
