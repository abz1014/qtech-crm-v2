-- 0092_fix_mistakes (owner decisions): fixing and removing mistakes.
--   guard_entered_by   sales and engineers change a protected column of, or delete, only what they entered or own (42501, HINT
--                      not_yours); workflow columns stay open to all staff; admin changes anything; the invoices guard fires
--                      after the month lock; an engineer's own RFQ item qty is editable, its price is not (column grant).
--   delete RPCs        admin only, each refusal has its HINT, deletes cascade without orphans or snoozes, return the storage
--                      files, and the audit log keeps the deleted row with changed_by.
--   deletes of records an RFQ item an order line is based on stays; a recurring template deletes even with expenses in a
--                      closed month (recurring_id goes to NULL, the expense stays).
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Fixture ids are 92000000-...-0000000000NN
-- (written @NN in the statements). Fixture rows are written as the table owner, so the guards (which limit the API roles) do not
-- apply to them; created_by is given explicitly.
begin;
select * from no_plan();

-- ------------------------------------------------------------------ machinery (session-local)
create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       else '00000000-0000-0000-0000-000000000000' end $$;

create function pg_temp.u(h text) returns uuid language sql immutable as
  $$ select ('92000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs stmt as the persona, the way the API runs it (role authenticated, claims, then the 0081 pre-request, which moves an
-- engineer onto qtech_engineer). Returns 'ok:<first column>' for a select, 'ok:<rows>' for other statements ('<none>' for no
-- row), or 'E:<sqlstate>:<hint>|<message>'. Rolled back unless keep is true.
create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare
  v text;
  d text;
  h text;
  m text;
  n bigint;
  s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''92000000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '')
              when n = 0 then '<none>'
              else 'ok:' || n end;
    if keep then
      reset role;
      return d;
    end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      get stacked diagnostics h = pg_exception_hint, m = message_text;
      return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end
$f$;

-- the outcome without the message
create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;

-- ------------------------------------------------------------------ fixtures
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.u('01'), '0092 Customer'), (pg_temp.u('02'), '0092 Supplier'), (pg_temp.u('03'), '0092 Unused'),
  (pg_temp.u('04'), '0092 Payee only');

-- RFQs. 10: the sales person's (owner), entered by the admin. 12: the admin's. 13: the engineer's own. 17: imported (nobody's).
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('12'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('13'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003');
insert into public.rfqs (id, company_id, owner_id, created_by, legacy_flags) values
  (pg_temp.u('17'), pg_temp.u('01'), null, null, '{owner_unknown}');
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net, created_by) values
  (pg_temp.u('11'), pg_temp.u('10'), 0, 'S item', 1, 10, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('14'), pg_temp.u('12'), 0, 'Admin item', 1, 10, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('15'), pg_temp.u('13'), 0, 'Eng item', 2, 100, 'a0000000-0000-4000-8000-000000000003'),
  (pg_temp.u('16'), pg_temp.u('12'), 1, 'Linked item', 1, 10, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('18'), pg_temp.u('17'), 0, 'Imported item', 1, 10, null);

-- Orders. 20: the sales person's. 21: the admin's. 60, 61, 62, 94: one blocker each for delete_order.
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('20'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('21'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('60'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('61'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('62'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('94'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, rfq_item_id, created_by) values
  (pg_temp.u('22'), pg_temp.u('20'), 0, 'Line of 20', 100, null, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('23'), pg_temp.u('21'), 0, 'Line of 21', 100, null, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('24'), pg_temp.u('21'), 1, 'Line based on an RFQ item', 100, pg_temp.u('16'), 'a0000000-0000-4000-8000-000000000001');

-- invoices (open month): 30 the admin's, 31 the sales person's, 33 ticked against the bank, 34 deletable with a receipt;
-- 32 in January 2019 (closed below)
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('30'), pg_temp.u('21'), 'T92-1', public.today_pkt(), 100, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('31'), pg_temp.u('20'), 'T92-2', public.today_pkt(), 100, 18, 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.u('32'), pg_temp.u('21'), 'T92-3', '2019-01-10', 100, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('34'), pg_temp.u('20'), 'T92-5', public.today_pkt(), 100, 18, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, tax_bank_month, created_by) values
  (pg_temp.u('33'), pg_temp.u('21'), 'T92-4', public.today_pkt(), 100, 18, date_trunc('month', public.today_pkt())::date,
   'a0000000-0000-4000-8000-000000000001');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.u('35'), 'gst-receipts', 'm92/r.pdf', 'r.pdf', 'application/pdf', 10, pg_temp.u('34'));

-- payments: 40 plain, 41 bank-ticked, 44 corrected by 43, 45 in January 2019, 46 plain (deleted below);
-- 47 the only payment of order 61, 48 the only payment of order 62 (voided)
insert into public.payments_in (id, order_id, amount, received_on, created_by) values
  (pg_temp.u('40'), pg_temp.u('21'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('44'), pg_temp.u('21'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('45'), pg_temp.u('21'), 10, '2019-01-12', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('46'), pg_temp.u('21'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('47'), pg_temp.u('61'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('48'), pg_temp.u('62'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, amount, received_on, paid_via, bank_month, created_by) values
  (pg_temp.u('41'), pg_temp.u('21'), 10, public.today_pkt(), 'bank', date_trunc('month', public.today_pkt())::date,
   'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, amount, received_on, corrects_payment_id, created_by) values
  (pg_temp.u('43'), pg_temp.u('21'), 10, public.today_pkt(), pg_temp.u('44'), 'a0000000-0000-4000-8000-000000000001');
update public.payments_in set voided_at = now(), voided_by = 'a0000000-0000-4000-8000-000000000001', void_reason = '0092 fixture'
where id = pg_temp.u('48');

-- expenses: 50 on order 60, 51 pays company 04; recurring templates 97 and 9b with expenses in a month that closes below
insert into public.expenses (id, amount_pkr, category_id, order_id) values
  (pg_temp.u('50'), 5, 'ca7e0000-0000-4000-8000-000000000010', pg_temp.u('60'));
insert into public.expenses (id, amount_pkr, category_id, payee_id) values
  (pg_temp.u('51'), 5, 'ca7e0000-0000-4000-8000-000000000010', pg_temp.u('04'));
insert into public.recurring_expenses (id, label, category_id, amount) values
  (pg_temp.u('97'), '0092 rent', 'ca7e0000-0000-4000-8000-000000000002', 5),
  (pg_temp.u('9b'), '0092 internet', 'ca7e0000-0000-4000-8000-000000000002', 5);
insert into public.expenses (id, amount_pkr, category_id, paid_on, recurring_id, period) values
  (pg_temp.u('98'), 5, 'ca7e0000-0000-4000-8000-000000000002', '2019-01-15', pg_temp.u('97'), '2019-01'),
  (pg_temp.u('9c'), 5, 'ca7e0000-0000-4000-8000-000000000002', '2019-01-20', pg_temp.u('9b'), '2019-01'),
  (pg_temp.u('99'), 5, 'ca7e0000-0000-4000-8000-000000000002', public.today_pkt(), pg_temp.u('97'), to_char(public.today_pkt(), 'YYYY-MM'));

-- documents: RFQ 90 has two quotation revisions, order 94 has two PO revisions
insert into public.rfqs (id, company_id, owner_id, created_by, quoted_on) values
  (pg_temp.u('90'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '2026-02-10');
insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, lines, pdf_path) values
  (pg_temp.u('91'), pg_temp.u('90'), 9201, 0, '2026-01-10', '2026-12-31', '[{"qty":1,"unit_price_net":1,"gst_rate":0}]', 'm92/q0.pdf'),
  (pg_temp.u('92'), pg_temp.u('90'), 9201, 1, '2026-02-10', '2026-12-31', '[{"qty":1,"unit_price_net":1,"gst_rate":0}]', null);
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.u('93'), pg_temp.u('94'), pg_temp.u('02'), 'USD');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines, pdf_path) values
  (pg_temp.u('95'), pg_temp.u('93'), 9301, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]', 'm92/p0.pdf'),
  (pg_temp.u('96'), pg_temp.u('93'), 9301, 1, 'USD', 0, '[{"qty":1,"unit_price":1}]', null);

-- an RFQ with everything hanging off it (deleted below)
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('80'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.rfq_items (id, rfq_id, position, description) values
  (pg_temp.u('81'), pg_temp.u('80'), 0, '0092 item A'), (pg_temp.u('8a'), pg_temp.u('80'), 1, '0092 item B');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  (pg_temp.u('82'), pg_temp.u('80'), pg_temp.u('02'), public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.u('83'), pg_temp.u('82'), pg_temp.u('81'), 3, 'PKR');
insert into public.clarifications (id, rfq_id, question) values (pg_temp.u('84'), pg_temp.u('80'), '0092 question');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values
  (pg_temp.u('85'), 'rfq-files', 'm92/a.pdf', 'a.pdf', 'application/pdf', 10, pg_temp.u('80'));
insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, lines, pdf_path) values
  (pg_temp.u('86'), pg_temp.u('80'), 9202, 0, public.today_pkt(), '2026-12-31', '[{"qty":1,"unit_price_net":1,"gst_rate":0}]', 'm92/q.pdf');

-- an order with everything hanging off it, made from RFQ 73 (deleted below)
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('73'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id, created_by, rfq_id) values
  (pg_temp.u('70'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.u('73'));
insert into public.supplier_orders (id, order_id, supplier_id, currency) values (pg_temp.u('71'), pg_temp.u('70'), pg_temp.u('02'), 'PKR');
insert into public.order_items (id, order_id, position, description, unit_price_net, supplier_order_id) values
  (pg_temp.u('74'), pg_temp.u('70'), 0, '0092 order line', 100, pg_temp.u('71'));
insert into public.order_costs (order_id, expected_cost_pkr) values (pg_temp.u('70'), 5);
insert into public.order_engineers (order_id, user_id) values (pg_temp.u('70'), 'a0000000-0000-4000-8000-000000000003');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id) values
  (pg_temp.u('75'), 'rfq-files', 'm92/o.jpg', 'o.jpg', 'image/jpeg', 10, pg_temp.u('70'));
insert into public.expense_claims (id, created_by, amount_pkr, order_id) values
  (pg_temp.u('72'), 'a0000000-0000-4000-8000-000000000003', 5, pg_temp.u('70'));

-- snoozes keyed to the RFQ, its inquiry, the order and its leg; and one that belongs to nothing deleted
insert into public.snoozes (user_id, rule, subject_id, until_on) values
  ('a0000000-0000-4000-8000-000000000002', 'r', pg_temp.u('80'), public.today_pkt() + 3),
  ('a0000000-0000-4000-8000-000000000003', 'r', pg_temp.u('82'), public.today_pkt() + 3),
  ('a0000000-0000-4000-8000-000000000002', 'r', pg_temp.u('70'), public.today_pkt() + 3),
  ('a0000000-0000-4000-8000-000000000003', 'r', pg_temp.u('71'), public.today_pkt() + 3),
  ('a0000000-0000-4000-8000-000000000002', 'r', pg_temp.u('ff'), public.today_pkt() + 3);

-- January 2019 is closed (the invoice 32, payment 45 and expenses 98 and 9c are in it)
insert into public.closed_months (month, closed_by) values ('2019-01-01', 'a0000000-0000-4000-8000-000000000001');

-- ================================================================== structure
select ok(not has_function_privilege('authenticated', 'public.guard_entered_by()', 'execute')
      and not has_function_privilege('anon', 'public.guard_entered_by()', 'execute')
      and not has_function_privilege('authenticated', 'public.guard_rfq_item_linked()', 'execute')
      and not has_function_privilege('authenticated', 'public.purge_snoozes()', 'execute'),
  'the trigger functions have no client grant');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('delete_rfq', 'delete_order', 'delete_invoice', 'delete_payment', 'delete_quotation_revision',
                               'delete_po_revision', 'delete_company')
             and not p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'
             and has_function_privilege('authenticated', p.oid, 'execute')
             and has_function_privilege('qtech_engineer', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')),
  7, 'the seven delete RPCs are SECURITY INVOKER with a fixed search_path, for authenticated and qtech_engineer, not anon');
select ok((select array_position(x.names, 'invoices_month_lock') < array_position(x.names, 'invoices_zguard_entered_by')
           from (select array_agg(t.tgname::text order by t.tgname::text collate "C") as names from pg_trigger t
                 where t.tgrelid = 'public.invoices'::regclass and not t.tgisinternal
                   and t.tgtype & 2 = 2 and t.tgtype & 16 = 16) x),
  'BEFORE UPDATE triggers fire in name order: the month lock before the invoices guard');
select is((select array_agg(t.tgrelid::regclass::text order by t.tgrelid::regclass::text collate "C") from pg_trigger t
           where t.tgname like '%guard_entered_by' and not t.tgisinternal),
  array['invoices', 'order_items', 'orders', 'rfq_items', 'rfqs'], 'the guard sits on rfqs, rfq_items, orders, order_items and invoices');

-- ================================================================== guard_entered_by: RFQs
select is(pg_temp.code_('sales', 'update public.rfqs set company_id = @03 where id = @12 returning 1'), 'E:42501:not_yours',
  'sales cannot change the customer of an RFQ the admin entered');
select is(pg_temp.code_('sales', $q$update public.rfqs set customer_ref = 'X-1' where id = @12 returning 1$q$), 'E:42501:not_yours',
  'nor its customer reference');
select is(pg_temp.try_('sales', 'update public.rfqs set company_id = @03 where id = @12 returning 1'),
  'E:42501:not_yours|Only the person who entered this, or an admin, can change it.', 'the refusal is the owner''s sentence');
select is(pg_temp.code_('sales', $q$update public.rfqs set due_on = current_date + 3, notes = 'chased', is_priority = true where id = @12 returning 1$q$),
  'ok:1', 'sales can still change due date, notes and priority of it');
select is(pg_temp.code_('sales', 'update public.rfqs set company_id = @03 where id = @10 returning 1'), 'ok:1',
  'sales can change the customer of an RFQ they own (owner_id counts as theirs)');
select is(pg_temp.code_('sales', 'update public.rfqs set company_id = @03 where id = @17 returning 1'), 'E:42501:not_yours',
  'an imported RFQ (no creator, no owner) is an admin''s');
select is(pg_temp.code_('engineer', 'update public.rfqs set company_id = @03 where id = @12 returning 1'), 'E:42501:not_yours',
  'an engineer cannot change someone else''s RFQ customer either');
select is(pg_temp.code_('engineer', 'update public.rfqs set company_id = @03 where id = @13 returning 1'), 'ok:1',
  'an engineer can change the customer of the RFQ they entered');
select is(pg_temp.code_('admin', 'update public.rfqs set company_id = @03 where id = @17 returning 1'), 'ok:1',
  'an admin changes anything, an imported RFQ included');
select is(pg_temp.code_('sales', 'delete from public.rfqs where id = @10 returning 1'), '<none>',
  'a direct delete of an RFQ stays admin only (row security: no row)');

-- RFQ items
select is(pg_temp.code_('sales', $q$update public.rfq_items set description = 'x' where id = @14 returning 1$q$), 'E:42501:not_yours',
  'sales cannot change the description of an item on the admin''s RFQ');
select is(pg_temp.code_('sales', 'update public.rfq_items set qty = 5 where id = @14 returning 1'), 'E:42501:not_yours', 'nor its quantity');
select is(pg_temp.code_('sales', 'delete from public.rfq_items where id = @14 returning 1'), 'E:42501:not_yours', 'nor remove it');
select is(pg_temp.code_('sales', 'update public.rfq_items set qty = 5 where id = @11 returning 1'), 'ok:1',
  'sales change an item of an RFQ they own (the parent''s owner counts)');
select is(pg_temp.code_('sales', 'delete from public.rfq_items where id = @11 returning 1'), 'ok:1', 'and remove it');
select is(pg_temp.code_('engineer', 'update public.rfq_items set qty = 9 where id = @15 returning 1'), 'ok:1',
  'an engineer can edit the quantity of an RFQ item they entered');
select is(pg_temp.code_('engineer', 'update public.rfq_items set quoted_unit_price_net = 1 where id = @15 returning 1'), 'E:42501:',
  'but not its price (no grant on the column: an engineer never sets a price)');
select is(pg_temp.code_('engineer', $q$update public.rfq_items set description = 'x' where id = @14 returning 1$q$), 'E:42501:not_yours',
  'an engineer cannot change an item on someone else''s RFQ');
select is(pg_temp.code_('engineer', 'update public.rfq_items set position = 3 where id = @14 returning 1'), 'ok:1',
  'position is a workflow column, open to all staff');
select is(pg_temp.code_('admin', 'delete from public.rfq_items where id = @14 returning 1'), 'ok:1', 'an admin removes any item');
select is(pg_temp.code_('sales', $q$update public.rfq_items set description = 'x' where id = @18 returning 1$q$), 'E:42501:not_yours',
  'an imported item (no creator) on an imported RFQ is an admin''s');

-- ================================================================== guard_entered_by: orders and order lines
select is(pg_temp.code_('sales', $q$update public.orders set customer_po_number = 'PO-X' where id = @21 returning 1$q$), 'E:42501:not_yours',
  'sales cannot change the customer PO of the admin''s order');
select is(pg_temp.code_('sales', 'update public.orders set ordered_on = current_date - 2 where id = @21 returning 1'), 'E:42501:not_yours',
  'nor its order date');
select is(pg_temp.code_('sales', $q$update public.orders set notes = 'n', commissioning_planned_on = current_date + 9 where id = @21 returning 1$q$),
  'ok:1', 'but notes and the commissioning date stay open to all staff');
select is(pg_temp.code_('sales', $q$update public.orders set customer_po_number = 'PO-X' where id = @20 returning 1$q$), 'ok:1',
  'sales change the customer PO of the order they own');
select is(pg_temp.code_('engineer', $q$update public.orders set notes = 'on site' where id = @21 returning 1$q$), 'ok:1',
  'an engineer writes notes on any order');
select is(pg_temp.code_('engineer', $q$update public.orders set customer_po_number = 'PO-Y' where id = @21 returning 1$q$), 'E:42501:not_yours',
  'but not its customer PO');
select is(pg_temp.code_('sales', 'update public.order_items set unit_price_net = 1 where id = @23 returning 1'), 'E:42501:not_yours',
  'sales cannot change the price of a line on the admin''s order');
select is(pg_temp.code_('sales', 'update public.order_items set qty = 4 where id = @23 returning 1'), 'E:42501:not_yours', 'nor its quantity');
select is(pg_temp.code_('sales', 'delete from public.order_items where id = @23 returning 1'), 'E:42501:not_yours', 'nor delete it');
select is(pg_temp.code_('sales', $q$update public.order_items set description = 'renamed' where id = @23 returning 1$q$), 'ok:1',
  'a description is not a money field: open to all staff');
select is(pg_temp.code_('sales', 'update public.order_items set unit_price_net = 1 where id = @22 returning 1'), 'ok:1',
  'sales change a line of the order they own (the parent''s owner counts)');
select is(pg_temp.code_('engineer', $q$update public.order_items set description = 'bracket' where id = @23 returning 1$q$), 'ok:1',
  'an engineer renames a line (no price involved)');
select is(pg_temp.code_('admin', 'update public.order_items set unit_price_net = 1 where id = @23 returning 1'), 'ok:1', 'an admin changes any line');

-- ================================================================== guard_entered_by: invoices, and the month lock first
select is(pg_temp.code_('sales', $q$update public.invoices set number = 'T92-X' where id = @30 returning 1$q$), 'E:42501:not_yours',
  'sales cannot change the number of an invoice the admin entered');
select is(pg_temp.code_('sales', 'update public.invoices set net_amount = 200 where id = @30 returning 1'), 'E:42501:not_yours', 'nor its amount');
select is(pg_temp.code_('sales', $q$update public.invoices set notes = 'chased', last_reminded_on = current_date where id = @30 returning 1$q$),
  'ok:1', 'but notes and reminders stay open');
select is(pg_temp.code_('sales', 'update public.invoices set net_amount = 200 where id = @31 returning 1'), 'ok:1',
  'sales change an invoice they entered');
select is(pg_temp.code_('sales', 'update public.invoices set net_amount = 200 where id = @32 returning 1'), 'E:P0001:',
  'in a closed month the month lock answers first, not the guard (even for an invoice that is not theirs)');
select alike(pg_temp.try_('sales', 'update public.invoices set net_amount = 200 where id = @32 returning 1'), '%January 2019 is closed. An admin can reopen it.',
  'with its own sentence');
select is(pg_temp.code_('admin', 'update public.invoices set net_amount = 200 where id = @32 returning 1'), 'E:P0001:',
  'and an admin is refused the same: a locked month must be reopened first');
select is(pg_temp.code_('admin', 'update public.invoices set net_amount = 200 where id = @30 returning 1'), 'ok:1', 'an admin changes any invoice in an open month');

-- ================================================================== an RFQ item an order line is based on stays
select is(pg_temp.try_('admin', 'delete from public.rfq_items where id = @16 returning 1'),
  'E:P0001:linked_to_order|An order line is based on this item, so it cannot be removed. Change or remove the order line first.',
  'an RFQ item an order line is based on cannot be removed (even by an admin)');
select is(pg_temp.code_('admin', 'delete from public.rfq_items where id = @14 returning 1'), 'ok:1', 'an unlinked item can be');

-- ================================================================== the delete RPCs: not an admin
select is(pg_temp.code_(p.persona, format('select count(*)::text from public.%s(@10)', f)), 'E:42501:admin_only',
  format('%s is refused %s', p.persona, f))
from unnest(array['delete_rfq', 'delete_order', 'delete_invoice', 'delete_quotation_revision', 'delete_po_revision']) f
cross join (values ('sales'), ('engineer')) p (persona);
select is(pg_temp.code_(p.persona, format('select public.%s(@10)::text', f)), 'E:42501:admin_only', format('%s is refused %s', p.persona, f))
from unnest(array['delete_payment', 'delete_company']) f
cross join (values ('sales'), ('engineer')) p (persona);
select is(pg_temp.try_('sales', 'select count(*)::text from public.delete_rfq(@10)'),
  'E:42501:admin_only|Only an admin can delete this. Nothing was deleted.', 'the sentence is plain');
select is(pg_temp.code_('sales', 'delete from public.rfqs where id = @10 returning 1'), '<none>', 'and a direct delete finds no row');

-- ================================================================== the delete RPCs: refusals, with their hints
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_rfq(@ee)'), 'E:P0002:not_found', 'delete_rfq: an unknown RFQ is not_found');
-- RFQ 12 has an order line based on its item 16 (no order points at the RFQ itself: the link alone counts)
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_rfq(@12)'), 'E:P0001:has_order',
  'delete_rfq: an RFQ an order line is based on has_order');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_rfq(@73)'), 'E:P0001:has_order',
  'delete_rfq: an RFQ with an order has_order');

select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@ee)'), 'E:P0002:not_found', 'delete_order: not_found');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@21)'), 'E:P0001:has_invoice', 'delete_order: has_invoice');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@61)'), 'E:P0001:has_payment', 'delete_order: has_payment');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@62)'), 'E:P0001:has_payment',
  'delete_order: a voided payment counts too (has_payment)');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@60)'), 'E:P0001:has_expense', 'delete_order: has_expense');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@94)'), 'E:P0001:has_po', 'delete_order: has_po (an issued PO)');

select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_invoice(@ee)'), 'E:P0002:not_found', 'delete_invoice: not_found');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_invoice(@33)'), 'E:P0001:bank_ticked',
  'delete_invoice: a bank-ticked tax deposit is bank_ticked');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_invoice(@32)'), 'E:P0001:',
  'delete_invoice: a closed month is refused by the month lock');
select alike(pg_temp.try_('admin', 'select count(*)::text from public.delete_invoice(@32)'), '%January 2019 is closed. An admin can reopen it.',
  'with the month lock''s sentence');

select is(pg_temp.code_('admin', 'select public.delete_payment(@ee)::text'), 'E:P0002:not_found', 'delete_payment: not_found');
select is(pg_temp.code_('admin', 'select public.delete_payment(@48)::text'), 'E:P0001:voided', 'delete_payment: a voided payment is voided');
select is(pg_temp.code_('admin', 'select public.delete_payment(@43)::text'), 'E:P0001:correction_chain',
  'delete_payment: a correction is part of a chain');
select is(pg_temp.code_('admin', 'select public.delete_payment(@44)::text'), 'E:P0001:correction_chain',
  'delete_payment: a payment another one corrects is part of a chain');
select is(pg_temp.code_('admin', 'select public.delete_payment(@41)::text'), 'E:P0001:bank_ticked', 'delete_payment: bank_ticked');
select is(pg_temp.code_('admin', 'select public.delete_payment(@45)::text'), 'E:P0001:',
  'delete_payment: a closed month is refused by the month lock');

select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_quotation_revision(@ee)'), 'E:P0002:not_found', 'delete_quotation_revision: not_found');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_quotation_revision(@91)'), 'E:P0001:not_latest',
  'delete_quotation_revision: only the latest revision (not_latest)');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_po_revision(@95)'), 'E:P0001:not_latest', 'delete_po_revision: not_latest');

select is(pg_temp.code_('admin', 'select public.delete_company(@ee)::text'), 'E:P0002:not_found', 'delete_company: not_found');
select is(pg_temp.code_('admin', 'select public.delete_company(@01)::text'), 'E:P0001:in_use', 'delete_company: a company with RFQs and orders is in_use');
select is(pg_temp.code_('admin', 'select public.delete_company(@04)::text'), 'E:P0001:in_use', 'delete_company: a payee of an expense is in_use');
select is(pg_temp.code_('admin', 'select public.delete_company(@02)::text'), 'E:P0001:in_use', 'delete_company: a supplier with orders and inquiries is in_use');

-- nothing was deleted by any refusal
select is((select count(*)::int from public.rfqs where id in (pg_temp.u('12'), pg_temp.u('73')))
        + (select count(*)::int from public.orders where id in (pg_temp.u('21'), pg_temp.u('61'), pg_temp.u('62'), pg_temp.u('60'), pg_temp.u('94')))
        + (select count(*)::int from public.invoices where id in (pg_temp.u('33'), pg_temp.u('32')))
        + (select count(*)::int from public.payments_in where id in (pg_temp.u('48'), pg_temp.u('43'), pg_temp.u('44'), pg_temp.u('41'), pg_temp.u('45')))
        + (select count(*)::int from public.quotations where id = pg_temp.u('91'))
        + (select count(*)::int from public.purchase_orders where id = pg_temp.u('95'))
        + (select count(*)::int from public.companies where id in (pg_temp.u('01'), pg_temp.u('02'), pg_temp.u('04'))),
  2 + 5 + 2 + 5 + 1 + 1 + 3, 'no refusal deleted anything');

-- ================================================================== delete_quotation_revision: quoted_on follows the latest revision
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_quotation_revision(@92)', true), 'ok:0',
  'the latest revision is deleted (it has no PDF: nothing to remove from storage)');
select is((select quoted_on from public.rfqs where id = pg_temp.u('90')), '2026-01-10'::date,
  'rfqs.quoted_on goes back to the previous revision''s issued_on (issue_quotation sets it to the revision it creates)');
select is(pg_temp.try_('admin', $q$select storage_bucket || '/' || storage_path from public.delete_quotation_revision(@91)$q$, true),
  'ok:generated-docs/m92/q0.pdf', 'deleting the first revision returns its PDF for storage.remove()');
select is((select quoted_on from public.rfqs where id = pg_temp.u('90')), null::date, 'with no revision left quoted_on is NULL (the RFQ is to be quoted again)');
select is((select count(*)::int from public.quotations where rfq_id = pg_temp.u('90')), 0, 'no quotation is left');
select is((select count(*)::int from public.audit_log where table_name = 'quotations' and action = 'delete'
           and record_id in (pg_temp.u('91')::text, pg_temp.u('92')::text) and changed_by = 'a0000000-0000-4000-8000-000000000001'), 2,
  'the audit log holds both deleted revisions, with who deleted them');

-- ================================================================== delete_po_revision
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_po_revision(@96)', true), 'ok:0', 'the latest PO revision is deleted');
select is(pg_temp.try_('admin', $q$select storage_bucket || '/' || storage_path from public.delete_po_revision(@95)$q$, true),
  'ok:generated-docs/m92/p0.pdf', 'then the first, with its PDF returned');
select is((select count(*)::int from public.audit_log where table_name = 'purchase_orders' and action = 'delete'
           and record_id in (pg_temp.u('95')::text, pg_temp.u('96')::text) and changed_by = 'a0000000-0000-4000-8000-000000000001'), 2,
  'both are in the audit log');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_order(@94)'), 'ok:0',
  'and with its POs gone the order (the only thing it had was a PO) can be deleted');

-- ================================================================== delete_company
select is(pg_temp.code_('admin', 'select public.delete_company(@03)::text', true), 'ok:', 'an unused company is deleted');
select is((select count(*)::int from public.companies where id = pg_temp.u('03')), 0, 'it is gone');
select is((select count(*)::int from public.audit_log where table_name = 'companies' and action = 'delete'
           and record_id = pg_temp.u('03')::text and changed_by = 'a0000000-0000-4000-8000-000000000001'), 1, 'and kept in the audit log');
select is(pg_temp.code_('admin', 'select public.delete_company(@03)::text'), 'E:P0002:not_found', 'a second time it is not_found');

-- ================================================================== delete_payment, delete_invoice
select is(pg_temp.code_('admin', 'select public.delete_payment(@46)::text', true), 'ok:', 'a plain payment in an open month is deleted');
select is((select count(*)::int from public.payments_in where id = pg_temp.u('46')), 0, 'it is gone');
select is((select count(*)::int from public.audit_log where table_name = 'payments_in' and action = 'delete'
           and record_id = pg_temp.u('46')::text and changed_by = 'a0000000-0000-4000-8000-000000000001'
           and (old_value ->> 'amount')::numeric = 10), 1, 'the audit log keeps the whole old row, with changed_by');

select is(pg_temp.try_('admin', $q$select storage_bucket || '/' || storage_path from public.delete_invoice(@34)$q$, true),
  'ok:gst-receipts/m92/r.pdf', 'an invoice in an open month is deleted and its receipt file is returned');
select is((select count(*)::int from public.invoices where id = pg_temp.u('34')) + (select count(*)::int from public.attachments where id = pg_temp.u('35')),
  0, 'the invoice and its receipt row are gone');
select is((select count(*)::int from public.audit_log where table_name = 'invoices' and action = 'delete'
           and record_id = pg_temp.u('34')::text and changed_by = 'a0000000-0000-4000-8000-000000000001'), 1, 'the invoice is in the audit log');

-- ================================================================== recurring expenses
select is(pg_temp.code_('admin', 'delete from public.recurring_expenses where id = @97 returning 1', true), 'ok:1',
  'a recurring template is deleted by an admin (an ordinary delete), even with an expense of it in a closed month');
select is((select array_agg(e.id::text || ':' || coalesce(e.recurring_id::text, 'null') order by e.id)
           from public.expenses e where e.id in (pg_temp.u('98'), pg_temp.u('99'))),
  array[pg_temp.u('98')::text || ':null', pg_temp.u('99')::text || ':null'],
  'past expenses keep their rows and their recurring_id becomes NULL (ON DELETE SET NULL)');
-- the allowance is the link alone
select is(pg_temp.code_('admin', $q$update public.expenses set description = 'x', recurring_id = null where id = @9c returning 1$q$), 'E:P0001:',
  'the month lock still refuses any other change to an expense in a closed month, with the link cleared in the same update');
select is(pg_temp.code_('admin', $q$update public.expenses set description = 'x' where id = @9c returning 1$q$), 'E:P0001:', 'and a plain change');
select is(pg_temp.code_('admin', 'update public.expenses set recurring_id = null where id = @9c returning 1'), 'ok:1',
  'clearing the link alone is allowed (it is what ON DELETE SET NULL does)');
select is(pg_temp.code_('admin', 'update public.expenses set amount_pkr = 6 where id = @9c returning 1'), 'E:P0001:', 'an amount in a closed month stays locked');

-- ================================================================== delete_rfq: cascades, storage files, snoozes, audit
select is(pg_temp.try_('admin', $q$select string_agg(storage_bucket || '/' || storage_path, ',' order by storage_path) from public.delete_rfq(@80)$q$, true),
  'ok:rfq-files/m92/a.pdf,generated-docs/m92/q.pdf', 'delete_rfq returns the attachment and the quotation PDF to remove from storage');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('80'))
        + (select count(*)::int from public.rfq_items where rfq_id = pg_temp.u('80'))
        + (select count(*)::int from public.supplier_inquiries where rfq_id = pg_temp.u('80'))
        + (select count(*)::int from public.supplier_quote_lines where id = pg_temp.u('83'))
        + (select count(*)::int from public.clarifications where rfq_id = pg_temp.u('80'))
        + (select count(*)::int from public.attachments where rfq_id = pg_temp.u('80'))
        + (select count(*)::int from public.quotations where rfq_id = pg_temp.u('80')),
  0, 'the RFQ and every row that hung off it are gone: items, inquiries, quote lines, clarifications, attachments, quotations');
select is((select count(*)::int from public.snoozes where subject_id in (pg_temp.u('80'), pg_temp.u('82'))), 0,
  'the snoozes keyed to the RFQ and to its inquiry are removed (whoever set them)');
select is((select count(*)::int from public.snoozes where subject_id = pg_temp.u('ff')), 1, 'a snooze of something else is untouched');
select is((select count(*)::int from public.audit_log where action = 'delete' and changed_by = 'a0000000-0000-4000-8000-000000000001'
           and ((table_name = 'rfqs' and record_id = pg_temp.u('80')::text)
             or (table_name = 'rfq_items' and record_id in (pg_temp.u('81')::text, pg_temp.u('8a')::text))
             or (table_name = 'supplier_inquiries' and record_id = pg_temp.u('82')::text)
             or (table_name = 'quotations' and record_id = pg_temp.u('86')::text))),
  5, 'the audit log has a delete row, with changed_by, for the RFQ, both items, the inquiry and the quotation');
select is((select old_value ->> 'company_id' from public.audit_log where table_name = 'rfqs' and action = 'delete' and record_id = pg_temp.u('80')::text),
  pg_temp.u('01')::text, 'and the RFQ row is kept whole in old_value');

-- ================================================================== delete_order: cascades, claims, snoozes, what the RFQ shows
select is((select outcome from public.v_rfq_state where rfq_id = pg_temp.u('73')), 'won', 'before: the RFQ of the order is won');
select is(pg_temp.try_('admin', $q$select string_agg(storage_bucket || '/' || storage_path, ',') from public.delete_order(@70)$q$, true),
  'ok:rfq-files/m92/o.jpg', 'delete_order returns the order''s attachment to remove from storage');
select is((select count(*)::int from public.orders where id = pg_temp.u('70'))
        + (select count(*)::int from public.order_items where order_id = pg_temp.u('70'))
        + (select count(*)::int from public.supplier_orders where order_id = pg_temp.u('70'))
        + (select count(*)::int from public.order_costs where order_id = pg_temp.u('70'))
        + (select count(*)::int from public.order_engineers where order_id = pg_temp.u('70'))
        + (select count(*)::int from public.attachments where order_id = pg_temp.u('70')),
  0, 'the order, its lines, supplier orders, costs, engineers and attachments are gone');
select is((select count(*)::int from public.snoozes where subject_id in (pg_temp.u('70'), pg_temp.u('71'))), 0,
  'the snoozes keyed to the order and to its supplier order are removed');
select is((select array_agg(c.id::text || ':' || coalesce(c.order_id::text, 'null')) from public.expense_claims c where c.id = pg_temp.u('72')),
  array[pg_temp.u('72')::text || ':null'], 'an expense claim keeps its row and loses the link to the order');
select is((select count(*)::int from public.audit_log where action = 'delete' and changed_by = 'a0000000-0000-4000-8000-000000000001'
           and ((table_name = 'orders' and record_id = pg_temp.u('70')::text)
             or (table_name = 'order_items' and record_id = pg_temp.u('74')::text)
             or (table_name = 'supplier_orders' and record_id = pg_temp.u('71')::text))),
  3, 'the audit log has a delete row, with changed_by, for the order, its line and its supplier order');
select is((select outcome from public.v_rfq_state where rfq_id = pg_temp.u('73')), 'open',
  'after: the RFQ is open again (an order is what made it won); its quoted date and the rest are as they were');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('73')), 1, 'and the RFQ itself is not deleted');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_rfq(@73)', true), 'ok:0', 'so the now order-less RFQ can be deleted');

select * from finish();
rollback;
