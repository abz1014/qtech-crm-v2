begin;
select * from no_plan();

-- 0901 (verification suite, branch test/roles-verify): the personas S14 does not cover, and a catalog sweep that
-- covers every table and view that exists, so a new object cannot slip past.
--
-- Personas, all as the API sees them (role `authenticated` with JWT claims, or role `anon`):
--   norole       a person who can sign in to Auth (auth.users row) but has NO public.users row (never set up, or the
--                row was removed). current_user_role() is NULL for them, as for a deactivated person.
--   ghost        a signed token whose `sub` is in neither auth.users nor public.users (a deleted account whose token
--                has not expired yet).
--   deactivated  the seed's a0..04 (also in S14; repeated here for the catalog sweep).
--   anon         no JWT.
-- DATA_MODEL section 10: "Deactivated users get nothing anywhere, because current_user_role() returns NULL for them";
-- SECURITY_REVIEW: "a deactivated user and anon get nothing". norole and ghost must be treated the same.
--
-- The fixtures and the probe statements below are copied from S14 (0025_access_matrix.test.sql) so every probe is a
-- statement that WORKS for an authorised caller (S14 proves that); here every one of them must be refused. Copying keeps
-- this file independent of S14 (pgTAP files run in their own sessions). The catalog checks at the end make sure every
-- table, view and client-callable function has a probe, so a new object fails here until it is covered.

-- ------------------------------------------------------------------ probe machinery (session-local, as S14)
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f0000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       when 'norole' then 'b9010000-0000-4000-8000-000000000001'
       when 'ghost' then 'b9010000-0000-4000-8000-000000000002'
       else '00000000-0000-0000-0000-000000000000' end $$;


-- 'Y' allowed, 'N' denied, 'E:...' unexpected error. Always rolls the statement back.
create function pg_temp.probe(stmt text, persona text) returns text language plpgsql as $f$
declare
  n bigint;
  d text;
  s text;
  other text;
begin
  other := case when persona = 'admin' then pg_temp.uid('sales') else pg_temp.uid('admin') end;
  s := replace(replace(stmt, '{uid}', pg_temp.uid(persona)), '{other}', other);
  s := regexp_replace(s, '@([0-9a-f]{2})\M', '''f0000000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    if persona = 'anon' then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute s;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0999', detail = n::text;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return case when d::bigint > 0 then 'Y' else 'N' end;
    when insufficient_privilege then
      if sqlerrm like 'Direct deletion from storage%' then
        return 'Y';
      end if;
      return 'N';
    when sqlstate 'P0002' then
      return 'N';
    when others then
      if sqlerrm like 'Direct deletion from storage%' then
        return 'Y';   -- storage's own guard fires only on rows the policy let through
      end if;
      return 'E:' || sqlstate || ' ' || sqlerrm;
  end;
end;
$f$;

create temp table probes (obj text, variant text, op text, stmt text);

-- The persona's result for one S14 line: the ops that worked, plus any unexpected error verbatim.
create function pg_temp.actual(o text, v text, persona text) returns text language plpgsql as $$
declare r record; res text; out_ops text := ''; errs text := '';
begin
  for r in select p.op, p.stmt from probes p where p.obj = o and p.variant = v
           order by position(p.op in 'SIUDX') loop
    res := pg_temp.probe(r.stmt, persona);
    if res = 'Y' then out_ops := out_ops || r.op;
    elsif res <> 'N' then errs := errs || ' [' || r.op || ' ' || res || ']';
    end if;
  end loop;
  return out_ops || errs;
end;
$$;

-- ------------------------------------------------------------------ the norole persona exists in Auth only
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'b9010000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'norole-0901@test.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');


-- ------------------------------------------------------------------ fixtures and probes, copied from S14 (0025_access_matrix.test.sql)
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
insert into public.brands (id, name, kind) values (pg_temp.f('d7'), 'M Category', 'family');   -- 0093: a category no probe deletes
update public.rfq_items set family_id = pg_temp.f('d7') where id = pg_temp.f('18');   -- 0093: v_supplier_category_evidence needs an asked item with a category
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
insert into public.orders (id, company_id, owner_id) values   -- 0112 and 0116: an order with no payment (the void probe) and one that holds a payment with WHT
  (pg_temp.f('d5'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'), (pg_temp.f('d7'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.payments_in (id, order_id, amount, wht_amount, wht_certificate_no) values (pg_temp.f('d6'), pg_temp.f('d7'), 5, 3, null);
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  (pg_temp.f('26'), pg_temp.f('20'), 'INV-M1', 100, 18), (pg_temp.f('27'), pg_temp.f('20'), 'INV-M2', 100, 18),
  (pg_temp.f('d2'), pg_temp.f('d5'), 'INV-M3', 100, 18);
-- 0112: a numbered invoice is voided, never deleted: the one the delete probes use is an unnumbered (legacy) row
update public.invoices set number = null, legacy_flags = array['undated'] where id = pg_temp.f('27');
insert into public.credit_notes (id, number, invoice_id, net_amount, gst_amount, reason) values (pg_temp.f('d3'), 'CN-M1', pg_temp.f('26'), 10, 2, 'fixture');
insert into public.orders (id, company_id, owner_id) values (pg_temp.f('f5'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');   -- 0118: an order that still owes
insert into public.order_items (id, order_id, position, description, unit_price_net) values (pg_temp.f('f6'), pg_temp.f('f5'), 0, 'Owing line', 100);
insert into public.customer_refunds (id, company_id, amount) values (pg_temp.f('f1'), pg_temp.f('01'), 5);   -- 0117
insert into public.credit_applications (id, company_id, to_order_id, amount) values (pg_temp.f('f2'), pg_temp.f('01'), pg_temp.f('f5'), 5);   -- 0118
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('28'), pg_temp.f('20'), 118);
insert into public.expenses (id, amount_pkr, category_id) values (pg_temp.f('29'), 5, 'ca7e0000-0000-4000-8000-000000000005');
insert into public.expenses (id, amount_pkr, category_id, description) values ('e0910000-0000-4000-8000-0000000000f1', 5, 'ca7e0000-0000-4000-8000-000000000031', 'probe title');   -- 0091: a titled expense under a misc category (promote probe)
insert into public.recurring_expenses (id, label, category_id, amount) values (pg_temp.f('2a'), 'rent', 'ca7e0000-0000-4000-8000-000000000002', 5);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values   -- untagged: 0103 defaults to true
  (pg_temp.f('2b'), 'rfq-files', 'm/1.pdf', 'a.pdf', 'application/pdf', 10, pg_temp.f('15'), false);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.f('2c'), 'gst-receipts', 'm/2.pdf', 'b.pdf', 'application/pdf', 10, pg_temp.f('26'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values   -- A6
  (pg_temp.f('3c'), 'expense-receipts', 'm/3.jpg', 'c.jpg', 'image/jpeg', 10, pg_temp.f('29'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices) values   -- R22 (0042), untagged
  (pg_temp.f('3f'), 'rfq-files', 'm/4.jpg', 'd.jpg', 'image/jpeg', 10, pg_temp.f('20'), false);
insert into public.expense_categories (id, name, grp) values (pg_temp.f('3d'), 'M Category', 'overhead');   -- A6
insert into public.expense_groups (id, name, kind) values (pg_temp.f('d0'), 'M Group', 'overhead');   -- 0086
insert into public.expense_claims (id, created_by, amount_pkr) values (pg_temp.f('e0'), 'a0000000-0000-4000-8000-000000000003', 5);   -- 0087
insert into public.cash_topups (id, amount_pkr) values (pg_temp.f('e2'), 5);   -- 0087
insert into public.cash_counts (id, counted_pkr, is_opening) values (pg_temp.f('e3'), 10, true);   -- 0087
insert into public.checked_findings (finding_key, message_hash) values ('probe-key', 'probe-hash');   -- 0102
insert into public.gst_deadline_overrides (month, pay_by) values ('2019-01-01', '2019-02-20');   -- 0110
insert into public.orders (id, company_id, owner_id, legacy_source) values   -- 0096: an imported order, an unlinked imported invoice and a linked one
  (pg_temp.f('e7'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '{"sheet":"orders"}');
insert into public.invoices (id, company_id, number, net_amount, gst_amount, legacy_source) values
  (pg_temp.f('e8'), pg_temp.f('01'), 'INV-M96-A', 100, 0, '{"sheet":"gst"}');
insert into public.invoices (id, order_id, company_id, number, net_amount, gst_amount, legacy_source) values
  (pg_temp.f('e9'), pg_temp.f('e7'), pg_temp.f('01'), 'INV-M96-B', 100, 0, '{"sheet":"gst"}');
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

-- ------------------------------------------------------------------ probes: tables
-- Generated probes for the simple cases: S (select), U (touch one column to its own value), D (delete the leaf row).
create temp table spec (obj text, variant text, where_clause text, touch text, ins text);
insert into spec values
  ('users', '', $q$id = '{uid}'$q$, 'name', $q$insert into public.users (id, name, role) values (@a0, 'x', 'sales')$q$),
  ('users', 'job_title', $q$id = '{uid}'$q$, 'job_title', null),
  ('users', 'phone', $q$id = '{uid}'$q$, 'phone', null),   -- A7 (0039)
  ('users', 'phone_other', $q$id = '{other}'$q$, 'phone', null),   -- A7 (0039)
  ('companies', '', 'id = @02', 'name', $q$insert into public.companies (id, name) values (@a1, 'probe co')$q$),
  ('company_sites', '', 'id = @11', 'name', $q$insert into public.company_sites (id, company_id, name) values (@a2, @01, 'probe')$q$),
  ('contacts', '', 'id = @12', 'name', $q$insert into public.contacts (id, company_id, name) values (@a3, @01, 'probe')$q$),
  ('brands', '', 'id = @14', 'name', $q$insert into public.brands (id, name) values (@a4, 'probe brand')$q$),
  ('company_brands', '', 'company_id = @01 and brand_id = @13', 'created_at', $q$insert into public.company_brands (company_id, brand_id) values (@01, @14)$q$),
  ('rfqs', '', 'id = @16', 'notes', $q$insert into public.rfqs (id, company_id, owner_id) values (@a5, @01, 'a0000000-0000-4000-8000-000000000002')$q$),
  ('rfq_items', '', 'id = @18', 'description', $q$insert into public.rfq_items (id, rfq_id, description) values (@a6, @15, 'probe')$q$),
  ('supplier_inquiries', 'unsent', 'id = @1b', 'notes', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id) values (@a7, @16, @03)$q$),
  ('supplier_inquiries', 'sent', 'id = @1a', 'notes', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id) values (@a7, @16, @03)$q$),
  ('supplier_quote_lines', '', 'id = @1c', 'notes', $q$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values (@1a, @17, 5, 'PKR')$q$),
  ('inquiry_item_declines', '', 'inquiry_id = @19 and rfq_item_id = @18', 'reason', $q$insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason) values (@1a, @17, 'other')$q$),   -- R07 (0032)
  ('clarifications', '', 'id = @1e', 'question', $q$insert into public.clarifications (id, rfq_id, question) values (@a8, @15, 'probe')$q$),
  ('orders', '', 'id = @21', 'notes', $q$insert into public.orders (id, company_id, owner_id) values (@a9, @01, 'a0000000-0000-4000-8000-000000000002')$q$),
  ('order_items', '', 'id = @25', 'description', $q$insert into public.order_items (id, order_id, description, unit_price_net) values (@aa, @20, 'probe', 1)$q$),
  ('supplier_orders', '', 'id = @24', 'reference', $q$insert into public.supplier_orders (id, order_id, supplier_id) values (@ab, @20, @03)$q$),
  ('order_engineers', '', 'order_id = @20', 'user_id', $q$insert into public.order_engineers (order_id, user_id) values (@21, 'a0000000-0000-4000-8000-000000000003')$q$),
  ('order_costs', '', 'order_id = @20', 'expected_cost_pkr', $q$insert into public.order_costs (order_id, expected_cost_pkr) values (@21, 5)$q$),
  ('customer_refunds', '', 'id = @f1', 'bank_month', $q$insert into public.customer_refunds (id, company_id, amount) values (@f3, @01, 5)$q$),   -- 0117
  ('credit_applications', '', 'id = @f2', 'company_id', $q$insert into public.credit_applications (id, company_id, to_order_id, amount) values (@f4, @01, @f5, 5)$q$),   -- 0118
  ('credit_notes', '', 'id = @d3', 'reason', $q$insert into public.credit_notes (id, number, invoice_id, net_amount, gst_amount, reason) values (@d4, 'CN-P', @26, 10, 2, 'probe')$q$),
  ('invoices', '', 'id = @27', 'notes', $q$insert into public.invoices (id, order_id, number, net_amount, gst_amount) values (@ac, @21, 'INV-P', 100, 18)$q$),
  ('payments_in', '', 'id = @28', 'reference', $q$insert into public.payments_in (id, order_id, amount) values (@ad, @21, 5)$q$),
  ('expenses', '', 'id = @29', 'description', $q$insert into public.expenses (id, amount_pkr, category_id) values (@ae, 5, 'ca7e0000-0000-4000-8000-000000000010')$q$),
  ('recurring_expenses', '', 'id = @2a', 'label', $q$insert into public.recurring_expenses (id, label, category_id, amount) values (@af, 'l', 'ca7e0000-0000-4000-8000-000000000002', 5)$q$),
  ('expense_categories', '', 'id = @3d', 'name', $q$insert into public.expense_categories (id, name, grp) values (@b6, 'probe category', 'overhead')$q$),   -- A6
  ('expense_groups', '', 'id = @d0', 'name', $q$insert into public.expense_groups (id, name, kind) values (@d1, 'probe group', 'overhead')$q$),   -- 0086
  ('history_sources', '', $q$child_table = 'rfq_items' and parent_table = 'rfqs'$q$, 'label_col', $q$insert into public.history_sources (child_table, parent_table, parent_col, roles) values ('probe', 'probe', 'x', '{admin}')$q$),   -- 0090
  ('expense_claims', '', 'id = @e0', 'note', $q$insert into public.expense_claims (id, amount_pkr) values (@e4, 5)$q$),   -- 0087
  ('cash_topups', '', 'id = @e2', 'note', $q$insert into public.cash_topups (id, amount_pkr) values (@e5, 5)$q$),   -- 0087
  ('cash_counts', '', 'id = @e3', 'note', $q$insert into public.cash_counts (id, counted_pkr) values (@e6, 7)$q$),   -- 0087
  ('checked_findings', '', $q$finding_key = 'probe-key'$q$, 'message_hash', $q$insert into public.checked_findings (finding_key, message_hash) values ('probe-2', 'probe-hash')$q$),   -- 0102
  ('closed_months', '', $q$month = '2019-01-01'$q$, 'note', $q$insert into public.closed_months (month, closed_by) values ('2019-02-01', '{uid}')$q$),   -- A6
  ('month_snapshots', '', $q$month = '2019-01-01'$q$, 'taken_at', $q$insert into public.month_snapshots (month, pnl, adjust, status, categories, team, payments, via, aging, payables) values ('2019-01-01', '{}', '{}', '[]', '[]', '[]', '{}', '{}', '[]', '[]')$q$),   -- 0058 (D-MR2)
  ('attachments', 'expense', 'id = @3c', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values (@b7, 'expense-receipts', 'p/3.jpg', 'c.jpg', 'image/jpeg', 10, @29)$q$),   -- A6
  ('attachments', 'order', 'id = @3f', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id) values (@b8, 'rfq-files', 'p/4.jpg', 'd.jpg', 'image/jpeg', 10, @20)$q$),   -- R22 (0042)
  ('attachments', 'rfq', 'id = @2b', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values (@b0, 'rfq-files', 'p/1.pdf', 'a.pdf', 'application/pdf', 10, @15)$q$),
  ('attachments', 'invoice', 'id = @2c', 'file_name', $q$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values (@b1, 'gst-receipts', 'p/2.pdf', 'b.pdf', 'application/pdf', 10, @26)$q$),
  ('snoozes', 'own', $q$user_id = '{uid}'$q$, 'until_on', $q$insert into public.snoozes (user_id, rule, subject_id, until_on) values ('{uid}', 'r2', @b2, current_date)$q$),
  ('snoozes', 'other', $q$user_id = '{other}'$q$, 'until_on', $q$insert into public.snoozes (user_id, rule, subject_id, until_on) values ('{other}', 'r2', @b2, current_date)$q$),
  ('targets', 'own', $q$user_id = '{uid}'$q$, 'note', $q$insert into public.targets (user_id, year, quarter, target_net_pkr) values ('{uid}', 2091, 1, 10)$q$),
  ('targets', 'other', $q$user_id = '{other}'$q$, 'note', $q$insert into public.targets (user_id, year, quarter, target_net_pkr) values ('{other}', 2091, 1, 10)$q$),
  ('audit_log', '', 'true', 'table_name', $q$insert into public.audit_log (table_name, record_id, action) values ('t', @b3, 'insert')$q$),
  ('fx_rates', 'manual', 'id = @38', 'rate_pkr', $q$insert into public.fx_rates (currency, rate_pkr, source, as_of) values ('GBP', 350, 'manual', current_date - 100)$q$),
  ('fx_rates', 'auto', 'id = @39', 'rate_pkr', $q$insert into public.fx_rates (currency, rate_pkr, source, as_of) values ('GBP', 350, 'auto', current_date - 100)$q$),
  ('fx_fetch_log', '', 'id = @3e', 'detail', $q$insert into public.fx_fetch_log (kind, detail) values ('info', 'probe')$q$),   -- R23 (0038)
  ('quotations', '', 'id = @3a', 'pdf_path', $q$insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values (@b4, @16, 7101, 0, current_date + 1, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]')$q$),
  ('purchase_orders', '', 'id = @3b', 'pdf_path', $q$insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values (@b5, @24, 7102, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]')$q$),
  ('gst_deadline_settings', '', 'id = 1', 'pay_day', $q$insert into public.gst_deadline_settings (id) values (2)$q$),   -- 0110
  ('gst_deadline_overrides', '', $q$month = '2019-01-01'$q$, 'note', $q$insert into public.gst_deadline_overrides (month, pay_by) values ('2019-02-01', '2019-03-20')$q$),   -- 0110
  ('company_profile', '', 'id = 1', 'phone', $q$insert into public.company_profile (id) values (2)$q$);


insert into probes
select obj, variant, 'S', format('select 1 from public.%s where %s', obj, where_clause) from spec
where obj <> 'users' or variant = ''
union all
select obj, variant, 'U', format('update public.%s set %s = %s where %s', obj, touch, touch, where_clause) from spec
union all
select obj, variant, 'D', format('delete from public.%s where %s', obj, where_clause) from spec where obj <> 'users' or variant = ''
union all
select obj, variant, 'I', ins from spec where ins is not null;

-- column-level rows (s10 "order_items.supplier_unit_price", "supplier_orders.currency")
insert into probes values
  ('order_items', 'supplier_unit_price', 'S', 'select supplier_unit_price from public.order_items where id = @25'),
  ('order_items', 'supplier_unit_price', 'I', $q$insert into public.order_items (id, order_id, description, unit_price_net, supplier_unit_price) values (@aa, @20, 'probe', 1, 9)$q$),
  ('order_items', 'supplier_unit_price', 'U', 'update public.order_items set supplier_unit_price = supplier_unit_price where id = @25'),
  ('supplier_orders', 'currency', 'S', 'select currency from public.supplier_orders where id = @24'),
  ('supplier_orders', 'currency', 'I', $q$insert into public.supplier_orders (id, order_id, supplier_id, currency) values (@ab, @20, @03, 'EUR')$q$),
  ('supplier_orders', 'currency', 'U', 'update public.supplier_orders set currency = currency where id = @24');

-- ------------------------------------------------------------------ probes: views
insert into probes
select v, '', 'S', format('select 1 from public.%s limit 1', v)
from unnest(array['v_company_roles','v_rfq_state','v_inquiry_state','v_order_state','v_invoice_state','v_gst_register',
                  'v_order_money','v_cash_month','v_payment_net','v_target_progress','v_order_basis',
                  'v_order_items_total','v_fx_latest','v_supplier_activity','v_supplier_category_evidence','v_supplier_stats',
                  'v_month_pnl','v_month_pnl_live','v_month_expense_category','v_month_team','v_gst_month',
                  'v_month_cash_flow','v_month_cash_out_detail','v_month_profit','v_wht_deducted','v_company_credit',
                  'v_report_rfq_outcomes','v_report_float','v_report_clarification_turnaround','v_report_repeat_customers','v_jobs']) v;   -- A6, P01

-- ------------------------------------------------------------------ probes: functions (X)
-- Each call is valid for an authorised caller and rolled back. A call counts as allowed when it returns rows (or a
-- positive count); the id arguments are fixtures, so a caller who cannot see them gets P0002 or a zero count.
insert into probes values
  ('order_receivables', '', 'X', 'select * from public.order_receivables()'),
  ('my_target_progress', '', 'X', 'select * from public.my_target_progress()'),
  ('my_target_progress_at', '', 'X', 'select * from public.my_target_progress_at(now())'),
  ('float_rfq', '', 'X', $q$select public.float_rfq(@c0, @01, '[{"description":"x"}]'::jsonb)$q$),
  ('set_rfq_floated', '', 'X', 'select 1 from (select public.set_rfq_floated(@15, false) r) x where r > 0'),   -- R05: @1a is sent today, unchased, no quote line
  ('convert_rfq_to_order', '', 'X', 'select public.convert_rfq_to_order(@c1, @15)'),
  ('create_repeat_order', '', 'X', 'select public.create_repeat_order(@c2, @20)'),
  ('split_order_item', '', 'X', 'select public.split_order_item(@25, 0.5, @24)'),   -- A8 (0050): moves half of the fixture line to the order's other leg
  ('merge_companies', '', 'X', 'select public.merge_companies(@01, @02)'),
  ('merge_brands', '', 'X', 'select public.merge_brands(@13, @14)'),
  ('merge_expense_categories', '', 'X', $q$select public.merge_expense_categories(@3d, 'ca7e0000-0000-4000-8000-000000000010')$q$),   -- 0086: the fixture category into Other (both overheads)
  ('suggest_misc_categories', '', 'X', 'select 1 where (select count(*) from public.suggest_misc_categories()) >= 0'),   -- 0091: refused for everyone but an admin
  ('promote_misc_title', '', 'X', $q$select 1 from (select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'probe title', 'Probe category') r) x where r > 0$q$),   -- 0091: the fixture expense below
  ('resolve_value_basis', '', 'X', $q$select public.resolve_value_basis(@21, 'net')$q$),
  ('model_tokens', '', 'X', $q$select public.model_tokens('ABC123')$q$),
  ('item_text_norm', '', 'X', $q$select public.item_text_norm('ABC 123')$q$),
  ('lead_time_upper_days', '', 'X', $q$select public.lead_time_upper_days('2 wks')$q$),
  ('supplier_median_delivery_days', '', 'X', $q$select public.supplier_median_delivery_days(@01)$q$),
  ('item_match_tier', '', 'X', $q$select public.item_match_tier('{}', 'x', null, null, '{}', 'x', null, null)$q$),
  ('brand_tokens', '', 'X', $q$select public.brand_tokens()$q$),
  ('tokens_without', '', 'X', $q$select public.tokens_without('{AB12}', '{}')$q$),
  ('brand_words', '', 'X', $q$select public.brand_words()$q$),
  ('strip_words', '', 'X', $q$select public.strip_words('a b', '{a}')$q$),
  ('similar_enough', '', 'X', $q$select public.similar_enough('a b c', 'a b c', 0.45)$q$),
  ('supplier_item_memory', '', 'X', $q$select 1 from public.supplier_item_memory(array[@03], @13, null, 'Fixture item') where best_tier is not null$q$),
  ('supplier_item_evidence', '', 'X', 'select 1 where exists (select 1 from public.supplier_orders where id = @23) and (select count(*) from public.supplier_item_evidence(array[@03], @13, null, $$Fixture order item$$)) >= 0'),   -- P9 (0066): same shape as po_line_prefill (the leg must be visible, so a deactivated user is denied)
  ('money_exceptions_input', '', 'X', 'select 1 from public.money_exceptions_input() j where j is not null'),   -- P9 (0066): NULL unless admin
  ('customer_price_memory', '', 'X', 'select 1 where exists (select 1 from public.rfqs where id = @15) and (select count(*) from public.customer_price_memory(@15)) >= 0'),   -- R19: returns no rows for the fixture, so the probe also needs the RFQ to be visible (a deactivated user sees none)
  ('rank_item_quotes', '', 'X', 'select 1 where exists (select 1 from public.rfqs where id = @15) and (select count(*) from public.rank_item_quotes(@15)) >= 0'),   -- A8 (0049): same shape as the customer_price_memory probe (the fixture RFQ must be visible; a deactivated user sees none)
  ('supplier_category_price_wins', '', 'X', 'select 1 where exists (select 1 from public.companies where id = @03) and (select count(*) from public.supplier_category_price_wins(array[@13])) >= 0'),   -- 0093: same shape as rank_item_quotes (a deactivated user sees no company)
  ('issue_quotation', '', 'X', 'select public.issue_quotation(@c3, @15)'),
  ('issue_purchase_order', '', 'X', 'select public.issue_purchase_order(@c4, @23)'),
  ('po_line_prefill', '', 'X', 'select 1 where exists (select 1 from public.supplier_orders where id = @23) and (select count(*) from public.po_line_prefill(@23)) >= 0'),   -- O07: read-only; needs the leg to be visible, so a deactivated user is denied
  ('stamp_clarification_ask', '', 'X', 'select 1 from (select public.stamp_clarification_ask(array[@1d]) r) x where r > 0'),
  ('stamp_supplier_chase', '', 'X', 'select public.stamp_supplier_chase(@19)'),
  ('stamp_goods_chase', '', 'X', 'select public.stamp_goods_chase(@23)'),
  ('search_all', '', 'X', $q$select * from public.search_all('Contact', 5)$q$),
  ('search_all', 'invoice', 'X', $q$select 1 from public.search_all('INV-M1', 5) where kind = 'invoice'$q$),
  ('search_all', 'customer_po', 'X', $q$select 1 from public.search_all('PO-M1', 5) where kind = 'order' and meta = 'Customer PO PO-M1'$q$),
  ('search_all', 'order_item', 'X', $q$select 1 from public.search_all('Fixture order item', 5) where kind = 'item'$q$),
  ('search_all', 'supplier_po', 'X', $q$select 1 from public.search_all('PO-7002', 5) where kind = 'po'$q$),
  ('next_invoice_number', '', 'X', 'select * from public.next_invoice_number()'),
  ('stamp_payment_reminder', '', 'X', 'select 1 from (select public.stamp_payment_reminder(array[@26]) r) x where r > 0'),
  ('stamp_tcs_sent', '', 'X', 'select 1 from (select public.stamp_tcs_sent(array[@26]) r) x where r > 0'),
  ('stamp_fbr_psid', '', 'X', $q$select 1 from (select public.stamp_fbr_psid(array[@26], 'P1') r) x where r > 0$q$),
  ('stamp_tax_deposited', '', 'X', 'select 1 from (select public.stamp_tax_deposited(array[@26]) r) x where r > 0'),
  ('set_fx_rate', '', 'X', $q$select public.set_fx_rate('GBP', 350)$q$),
  ('current_user_role', '', 'X', 'select 1 where public.current_user_role() is not null'),
  ('can_access_bucket', '', 'X', $q$select 1 where public.can_access_bucket('rfq-files')$q$),
  ('today_pkt', '', 'X', 'select public.today_pkt()'),
  ('fetch_fx_rates', '', 'X', 'select public.fetch_fx_rates()'),   -- R23 (0038)
  ('ingest_fx_response', '', 'X', 'select public.ingest_fx_response()'),
  ('import_purge_audit', '', 'X', $q$select public.import_purge_audit(array['00000000-0000-5000-8000-000000000000'::uuid])$q$),   -- I01 (0055): a version 5 id, so only the grant can refuse it
  ('import_reset_numbers', '', 'X', 'select public.import_reset_numbers()'),   -- I01 (0055)
  ('apply_fx_payload', '', 'X', $q$select public.apply_fx_payload('{}'::jsonb, 'probe')$q$),
  ('fx_wanted_currencies', '', 'X', 'select public.fx_wanted_currencies()'),
  ('schedule_fx_cron', '', 'X', 'select public.schedule_fx_cron()'),
  ('close_month', '', 'X', $q$select public.close_month(date '2020-01-01')$q$),                -- A6
  ('close_months_through', '', 'X', $q$select public.close_months_through(date '2020-01-01')$q$),   -- A6
  ('reopen_month', '', 'X', $q$select public.reopen_month(date '2019-01-01')$q$),               -- A6
  ('month_is_closed', '', 'X', $q$select public.month_is_closed(date '2019-01-01')$q$),         -- A6
  ('aging_as_of', '', 'X', 'select 1 from public.aging_as_of(public.today_pkt()) limit 1'),        -- A6
  ('payables_as_of', '', 'X', 'select 1 from public.payables_as_of(public.today_pkt()) limit 1'),  -- A6
  ('held_advances', '', 'X', 'select 1 from public.held_advances() limit 1'),   -- 0080
  ('link_imported_invoices', '', 'X', 'select 1 where (select count(*) from public.link_imported_invoices()) >= 0'),   -- 0096: refused for everyone but an admin
  ('link_imported_invoice', '', 'X', 'select public.link_imported_invoice(@e8, @e7)'),   -- 0096: the unlinked imported invoice onto the imported order (same customer)
  ('unlink_imported_invoice', '', 'X', 'select public.unlink_imported_invoice(@e9)'),   -- 0096
  ('set_legacy_review', '', 'X', $q$select public.set_legacy_review('order', @e7, 'live')$q$),   -- 0096
  ('month_end_status', '', 'X', 'select 1 from public.month_end_status(public.today_pkt()) limit 1'),   -- A6
  ('month_end_check_details', '', 'X', 'select 1 from public.month_end_check_details(public.today_pkt()) limit 1'),   -- 0064
  ('month_pnl_drift', '', 'X', 'select 1 where public.month_pnl_drift() is not null'),         -- 0058 (D-MR2)
  ('month_pnl_adjusted', '', 'X', 'select 1 where public.month_pnl_adjusted() is not null'),   -- 0058 (D-MR2)
  ('revoke_user_sessions', '', 'X', $q$select public.revoke_user_sessions(gen_random_uuid())$q$);   -- A01

-- ------------------------------------------------------------------ probes: storage buckets
-- Storage refuses a direct SQL DELETE on storage.objects for every role (its protect_delete guard fires before row
-- security), so a delete cannot be probed by running it. The D probe instead runs a SELECT of the fixture object
-- filtered by the USING expression of the table's real DELETE policies, as the persona: the policy text is read
-- from pg_policies, but it is evaluated by the database for that persona, so the helper functions it calls are tested.
insert into probes
select b, '', 'S', format($q$select 1 from storage.objects where bucket_id = '%s' and name = 'fixture.txt'$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'I', format($q$insert into storage.objects (bucket_id, name) values ('%s', 'probe.txt')$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'U', format($q$update storage.objects set name = name where bucket_id = '%s' and name = 'fixture.txt'$q$, b)
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b
union all
select b, '', 'D', format($q$select 1 from storage.objects where bucket_id = '%s' and name = 'fixture.txt' and (%s)$q$, b,
  (select string_agg('(' || coalesce(pl.qual, 'false') || ')', ' or ') from pg_policies pl
   where pl.schemaname = 'storage' and pl.tablename = 'objects' and pl.cmd = 'DELETE'))
from unnest(array['rfq-files','gst-receipts','generated-docs','expense-receipts']) b;

-- 0057 (H-1): issued PDFs and attached pdf_path values.
insert into probes values
  ('generated-docs', 'issued', 'S', $q$select 1 from storage.objects where bucket_id = 'generated-docs' and name = 'm/q.pdf'$q$),
  ('generated-docs', 'issued', 'U', $q$update storage.objects set name = name where bucket_id = 'generated-docs' and name = 'm/q.pdf'$q$),
  ('quotations', 'pdf_attached', 'U', $q$update public.quotations set pdf_path = 'm/other.pdf' where id = @3a$q$),
  ('purchase_orders', 'pdf_attached', 'U', $q$update public.purchase_orders set pdf_path = 'm/other.pdf' where id = @3b$q$),
  ('orders', 'legacy_flags', 'U', $q$update public.orders set legacy_flags = '{}' where id = @21$q$),   -- 0065
  ('orders', 'owner_id', 'U', $q$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000003' where id = @21$q$),
  ('rfqs', 'owner_id', 'U', $q$update public.rfqs set owner_id = 'a0000000-0000-4000-8000-000000000003' where id = @16$q$),
  ('receipt_locked', '', 'X', $q$select 1 where public.receipt_locked('gst-receipts', 'fixture.txt') is not null$q$),
  ('job_stage', '', 'X', $q$select 1 from public.job_stage(@15, null)$q$),   -- 0099
  ('attachment_is_priced', '', 'X', $q$select 1 where public.attachment_is_priced('rfq-files', 'fixture.txt') is not null$q$),   -- 0100
  ('month_closed', '', 'X', $q$select 1 where public.month_closed(date '2019-01-01') is not null$q$);   -- 0107


-- ------------------------------------------------------------------ 0901: extra probes (privilege escalation through users)
-- A person with no users row must not be able to give themselves one; nobody may change a role or a deactivation
-- directly (DATA_MODEL s10 "users: writes only through the admin-users Edge Function").
insert into probes values
  ('users', 'self_insert', 'I', $q$insert into public.users (id, name, role) values ('{uid}', 'me', 'admin')$q$),
  ('users', 'own_role', 'U', $q$update public.users set role = 'admin' where id = '{uid}'$q$),
  ('users', 'other_role', 'U', $q$update public.users set role = 'engineer' where id = '{other}'$q$),
  ('users', 'reactivate', 'U', $q$update public.users set deactivated_at = null where id = 'a0000000-0000-4000-8000-000000000004'$q$),
  ('users', 'deactivate_other', 'U', $q$update public.users set deactivated_at = now() where id = '{other}'$q$),
  -- RPCs added on main after S14's last update (0070, 0073): must refuse everyone without a role
  ('void_payment', '', 'X', $q$select public.void_payment(@28, 'probe')$q$),
  ('correct_payment', '', 'X', $q$select public.correct_payment(@28, 1, current_date, 'bank', 'r', 'probe')$q$),
  ('restore_payment', '', 'X', $q$select public.restore_payment(@28)$q$),
  ('search_closed_rfqs', '', 'X', $q$select * from public.search_closed_rfqs('M', 5, 0)$q$),
  -- 0074 (perf/db)
  ('receivables_list', '', 'X', $q$select * from public.receivables_list(null, null, null, true)$q$),
  ('receivables_summary', '', 'X', $q$select * from public.receivables_summary() where gross > 0$q$),
  ('today_inquiry_facts', '', 'X', $q$select * from public.today_inquiry_facts()$q$),
  ('lookup_labels', '', 'X', $q$select 1 from (select public.lookup_labels(array[@01], array[@23], array[@20]) j) x where j::text ~ 'M Main|ORD-'$q$),
  ('record_history', '', 'X', $q$select 1 where public.record_history('rfqs', @15) is not null$q$),   -- 0090
  ('record_history_rows', '', 'X', $q$select 1 from (select set_config('qtech.history_for', 'rfqs:' || @15::text, true)) m where public.record_history_rows('rfqs', @15) is not null$q$),   -- 0090: with the mark record_history sets
  -- 0087
  ('approve_expense_claim', '', 'X', $q$select public.approve_expense_claim(@e0, 'ca7e0000-0000-4000-8000-000000000004', 'cash_back')$q$),
  ('cash_in_hand', '', 'X', 'select 1 from public.cash_in_hand()'),
  ('claim_object_ok', '', 'X', $q$select 1 where public.claim_object_ok(@e0::text || '/r.jpg', false)$q$),
  ('delete_rfq', '', 'X', 'select 1 where (select count(*) from public.delete_rfq(@16)) >= 0'),   -- 0092: admin only (42501 for everyone else); rolled back
  ('delete_order', '', 'X', 'select 1 where (select count(*) from public.delete_order(@21)) >= 0'),
  ('delete_invoice', '', 'X', 'select 1 where (select count(*) from public.delete_invoice(@27)) >= 0'),
  ('create_credit_note', '', 'X', $q$select 1 from public.create_credit_note(@d2, 10, 'probe')$q$),   -- 0112
  ('record_refund', '', 'X', $q$select 1 from (select public.record_refund(gen_random_uuid(), @01, null, public.today_pkt(), 1, 'bank', null, null, true) r) x$q$),   -- 0118
  ('apply_credit', '', 'X', $q$select 1 from (select public.apply_credit(gen_random_uuid(), @f5, 1) r) x$q$),   -- 0118
  ('void_invoice', '', 'X', $q$select 1 from (select public.void_invoice(@d2, 'probe') r) x$q$),   -- 0112
  ('record_payment', '', 'X', $q$select 1 from (select public.record_payment(gen_random_uuid(), @20, public.today_pkt(), 7, null, 'bank', true) r) x$q$),   -- 0114
  ('next_credit_note_number', '', 'X', 'select 1 where public.next_credit_note_number() is not null'),   -- 0112
  ('delete_payment', '', 'X', 'select 1 from (select public.delete_payment(@28) r) x'),
  ('delete_quotation_revision', '', 'X', 'select 1 where (select count(*) from public.delete_quotation_revision(@3a)) >= 0'),
  ('delete_po_revision', '', 'X', 'select 1 where (select count(*) from public.delete_po_revision(@3b)) >= 0'),
  ('delete_company', '', 'X', 'select 1 from (select public.delete_company(@02) r) x');   -- 0092

-- 0074 receivables: money, so an engineer is refused too (they run order_receivables()).
select is(pg_temp.actual(f, '', 'engineer'), '', format('engineer gets nothing from %s', f))
from unnest(array['receivables_list', 'receivables_summary']) f;
select is(pg_temp.actual(f, '', 'sales'), 'X', format('precondition: sales get %s', f))
from unnest(array['receivables_list', 'receivables_summary']) f;

-- 0092 (owner decision: delete is permanent and admin only): the seven delete RPCs refuse sales and engineers inside the function.
select is(pg_temp.actual(f, '', p.persona), '', format('%s is refused %s', p.persona, f))
from unnest(array['delete_rfq', 'delete_order', 'delete_invoice', 'delete_payment', 'delete_quotation_revision',
                  'delete_po_revision', 'delete_company']) f
cross join (values ('sales'), ('engineer'), ('deactivated')) p (persona);

-- ------------------------------------------------------------------ coverage: every object has probes
select is((select coalesce(array_agg(t.tablename::text order by t.tablename), '{}') from pg_tables t
           where t.schemaname = 'public'
             and (not exists (select 1 from probes p where p.obj = t.tablename and p.op = 'S')
                  or not exists (select 1 from probes p where p.obj = t.tablename and p.op = 'I'))),
          '{}'::text[], 'coverage: every table in public has a select and an insert probe');
select is((select coalesce(array_agg(v.viewname::text order by v.viewname), '{}') from pg_views v
           where v.schemaname = 'public' and not exists (select 1 from probes p where p.obj = v.viewname and p.op = 'S')),
          '{}'::text[], 'coverage: every view in public has a select probe');
select is((select coalesce(array_agg(distinct p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not exists (select 1 from probes x where x.obj = p.proname and x.op = 'X')),
          '{}'::text[], 'coverage: every function a signed-in client can execute has a call probe');

-- ------------------------------------------------------------------ the S14 probes, as norole and ghost: nothing works
-- Pure helpers that read no table (model_tokens and the like) answer anyone who holds the `authenticated` grant; S14
-- records the same for deactivated users (its item 3). They are listed here and checked in the todo block below.
create temp table pure_helpers (obj text primary key);
insert into pure_helpers values ('model_tokens'), ('item_text_norm'), ('lead_time_upper_days'), ('supplier_median_delivery_days'),
  ('item_match_tier'), ('brand_tokens'), ('tokens_without'), ('brand_words'), ('strip_words'), ('similar_enough'), ('today_pkt');

select is(pg_temp.actual(x.obj, x.variant, p.persona), '',
  format('%s %s%s: nothing works', p.persona, x.obj, case when x.variant = '' then '' else ' [' || x.variant || ']' end))
from (select distinct obj, variant from probes) x
cross join (values ('norole'), ('ghost')) p (persona)
where x.obj not in (select obj from pure_helpers)
order by x.obj, x.variant, p.persona;

-- The escalation probes, for the staff roles too (S14 covers deactivated and anon for the rest).
select is(pg_temp.actual('users', v, p.persona), '', format('%s cannot change users [%s] directly', p.persona, v))
from unnest(array['self_insert', 'own_role', 'other_role', 'reactivate', 'deactivate_other']) v
cross join (values ('admin'), ('sales'), ('engineer'), ('deactivated'), ('anon')) p (persona)
order by v, p.persona;

select todo_start('s10 is silent on pure helpers for people without a role (as S14 item 3); they read no table');
select is(pg_temp.actual(h.obj, '', p.persona), '', format('KNOWN %s as %s', h.obj, p.persona))
from pure_helpers h cross join (values ('norole'), ('ghost')) p (persona) order by h.obj, p.persona;
select todo_end();

-- ------------------------------------------------------------------ catalog sweep: every table and view, every no-access persona
-- Generated from the catalog at run time, so a table or view added later is swept without editing this file.
create temp table sweep_obj as
  select 'table'::text as kind, t.tablename::text as obj from pg_tables t where t.schemaname = 'public'
  union all
  select 'view', v.viewname::text from pg_views v where v.schemaname = 'public';

-- The column each UPDATE probe touches (set to itself): the first one `authenticated` may update, if any.
create temp table sweep_touch as
  select s.obj, (select a.attname::text from pg_attribute a
                 where a.attrelid = format('public.%I', s.obj)::regclass and a.attnum > 0 and not a.attisdropped
                   and a.attgenerated = '' and a.attidentity = ''
                   and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
                 order by a.attnum limit 1) as col
  from sweep_obj s where s.kind = 'table';

select is((select coalesce(array_agg(s.obj order by s.obj), '{}') from sweep_obj s
           where pg_temp.probe(format('select 1 from public.%I limit 1', s.obj), 'admin') <> 'Y'),
          '{}'::text[], 'precondition: the admin sees fixture rows in every table and view, so zero rows below means refused');

select is((select coalesce(array_agg(s.obj || ' ' || r.res order by s.obj), '{}') from sweep_obj s
           cross join lateral (select pg_temp.probe(format('select 1 from public.%I limit 1', s.obj), p.persona) as res) r
           where r.res <> 'N'),
          '{}'::text[], format('sweep: %s reads no row of any table or view', p.persona))
from (values ('anon'), ('deactivated'), ('norole'), ('ghost')) p (persona);

select is((select coalesce(array_agg(t.obj || ' ' || r.res order by t.obj), '{}') from sweep_touch t
           cross join lateral (select pg_temp.probe(format('update public.%I set %I = %I', t.obj, t.col, t.col), p.persona) as res) r
           where t.col is not null and r.res <> 'N'),
          '{}'::text[], format('sweep: %s updates no row of any table', p.persona))
from (values ('anon'), ('deactivated'), ('norole'), ('ghost')) p (persona);

select is((select coalesce(array_agg(s.obj || ' ' || r.res order by s.obj), '{}') from sweep_obj s
           cross join lateral (select pg_temp.probe(format('delete from public.%I', s.obj), p.persona) as res) r
           where s.kind = 'table' and r.res <> 'N'),
          '{}'::text[], format('sweep: %s deletes no row of any table', p.persona))
from (values ('anon'), ('deactivated'), ('norole'), ('ghost')) p (persona);

select is((select coalesce(array_agg(b.id || ' ' || r.res order by b.id), '{}') from storage.buckets b
           cross join lateral (select pg_temp.probe(format($q$select 1 from storage.objects where bucket_id = '%s'$q$, b.id), p.persona) as res) r
           where r.res <> 'N'),
          '{}'::text[], format('sweep: %s lists no stored file in any bucket', p.persona))
from (values ('anon'), ('deactivated'), ('norole'), ('ghost')) p (persona);

-- ------------------------------------------------------------------ SECURITY DEFINER functions check their caller
-- A definer function runs with its owner's rights, so row security does not protect its data: it must check the caller
-- itself. The ones a client may call are reviewed by name; each calls current_user_role() (or delegates to a function
-- that does), and none is callable by anon.
select is((select array_agg(p.proname::text order by p.proname::text) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
             and has_function_privilege('authenticated', p.oid, 'execute')),
          array['attachment_is_priced', 'close_month', 'close_months_through', 'current_user_role', 'job_stage', 'month_closed', 'my_target_progress',
                'order_receivables', 'receipt_locked', 'record_history_rows', 'reopen_month', 'supplier_category_price_wins'],   -- 0093: role check inside, NULL counts for all but admin and sales
  'the client-callable SECURITY DEFINER functions are exactly the reviewed twelve (0090: record_history_rows, refused unless record_history marked the transaction; 0093: supplier_category_price_wins; 0099: job_stage, words and a date only; 0100: attachment_is_priced, a yes/no for the storage policy; 0107: month_closed, a yes/no for the Invoice screen)');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
             and has_function_privilege('authenticated', p.oid, 'execute')
             and p.proname <> 'current_user_role'
             and p.prosrc !~ 'current_user_role\(\)|can_access_bucket\(|my_target_progress_at\('),
          '{}'::text[], 'each of them checks the caller (current_user_role, can_access_bucket, or my_target_progress_at which does)');
select ok((select prosrc from pg_proc where oid = 'public.my_target_progress_at(timestamptz)'::regprocedure) ~ 'current_user_role\(\) is null',
  'my_target_progress_at (behind my_target_progress) returns nothing to a caller without a role');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
          '{}'::text[], 'no function in public is executable by anon');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
          '{}'::text[], 'every SECURITY DEFINER function pins its search_path');
select is((select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
          '{}'::text[], 'every view is security_invoker (row security of its tables applies to the caller)');
select is((select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
          '{}'::text[], 'row security is on for every table');

-- Behaviour of the definer functions for a caller without a role (the X probes above cover norole and ghost; these
-- name the result each one must give).
select is(pg_temp.probe('select * from public.order_receivables()', p.persona), 'N',
  format('order_receivables gives %s no row', p.persona))
from (values ('deactivated'), ('norole'), ('ghost')) p (persona);
select is(pg_temp.probe('select 1 from public.my_target_progress()', p.persona), 'N',
  format('my_target_progress gives %s no row', p.persona))
from (values ('deactivated'), ('norole'), ('ghost')) p (persona);
select is(pg_temp.probe($q$select public.close_month(date '2020-01-01')$q$, p.persona), 'N',
  format('close_month refuses %s', p.persona))
from (values ('sales'), ('engineer'), ('deactivated'), ('norole'), ('ghost')) p (persona);
select is(pg_temp.probe($q$select public.reopen_month(date '2019-01-01')$q$, p.persona), 'N',
  format('reopen_month refuses %s', p.persona))
from (values ('sales'), ('engineer'), ('deactivated'), ('norole'), ('ghost')) p (persona);
select is(pg_temp.probe('select * from public.order_receivables()', 'engineer'), 'N',
  'order_receivables refuses an engineer (balances are money)');

select * from finish();
rollback;
