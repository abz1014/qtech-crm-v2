begin;
select * from no_plan();

-- 0903 (verification suite, branch test/roles-verify): legacy-only columns cannot be set by app users.
--
-- legacy_source (the old CRM's raw row) and invoices.settled_before_cutover are written by the legacy import only
-- (service role; docs/IMPORT.md, migration 0068). legacy_flags on orders is admin only and value_basis_unknown moves only
-- through resolve_value_basis (0065, SECURITY_REVIEW M-1). The brief: "legacy-only columns (legacy_source,
-- settled_before_cutover) cannot be set by app users".
--
-- Each probe runs an INSERT or UPDATE as a persona that may write the table at all (s10), then checks AS THE OWNER
-- whether the value actually landed (a trigger may silently ignore a column, as force_created_by does):
--   'set'            the app user wrote the legacy value                      -> a finding
--   'not set'        the statement ran but the value did not land
--   'refused:<code>' the statement was refused (nothing written)
-- The same statement run as the service role (the import's path) must give 'set', which proves each probe is valid.
-- The table list is checked against the catalog, so a new legacy column fails here until it has probes.

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

create function pg_temp.expand(stmt text, persona text) returns text language sql immutable as $$
  select regexp_replace(replace(stmt, '{uid}', pg_temp.uid(persona)),
                        '@([0-9a-f]{2})\M', '''f0000000-0000-4000-8000-0000000000\1''::uuid', 'g')
$$;

create function pg_temp.sets(stmt text, chk text, persona text) returns text language plpgsql as $f$
declare
  landed boolean;
  d text;
begin
  begin
    if persona = 'service' then
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      set local role service_role;
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute pg_temp.expand(stmt, persona);
    reset role;
    execute pg_temp.expand(chk, persona) into landed;
    raise exception 'sets done' using errcode = 'P0999', detail = case when landed then 'set' else 'not set' end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'refused:' || sqlstate;
  end;
end;
$f$;


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
insert into public.expenses (id, amount_pkr, category_id) values (pg_temp.f('29'), 5, 'ca7e0000-0000-4000-8000-000000000010');
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


-- ------------------------------------------------------------------ 0903 fixtures
-- An imported GST-register invoice with no order (the only kind that may be settled before cutover, 0068).
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source)
values (pg_temp.f('e1'), pg_temp.f('01'), 'LEG-0903', public.today_pkt() - 3, 100, 18, '{"table":"gst_invoices","row":{"id":"old-1"}}');

-- ------------------------------------------------------------------ the probes (one INSERT and one UPDATE per table and column)
-- writers: the personas that may write the table at all (DATA_MODEL s10); the others are refused by S14 already.
create temp table legacy_probe (obj text, col text, op text, stmt text, chk text, writers text[]);
create function pg_temp.add_legacy(o text, ins_cols text, ins_vals text, new_id text, old_where text, writers text[], upd_writers text[] default null)
returns void language sql as $$
  insert into legacy_probe values
    (o, 'legacy_source', 'I',
     format('insert into public.%I (%s, legacy_source) values (%s, %L::jsonb)', o, ins_cols, ins_vals, '{"forged":true}'),
     format($c$select exists (select 1 from public.%I where %s and legacy_source is not null)$c$, o, new_id), writers),
    (o, 'legacy_source', 'U',
     format('update public.%I set legacy_source = %L::jsonb where %s', o, '{"forged":true}', old_where),
     format($c$select (select legacy_source from public.%I where %s) is not null$c$, o, old_where), coalesce(upd_writers, writers)),
    (o, 'legacy_flags', 'I',
     format('insert into public.%I (%s, legacy_flags) values (%s, %L::text[])', o, ins_cols, ins_vals, '{forged}'),
     format($c$select exists (select 1 from public.%I where %s and 'forged' = any (legacy_flags))$c$, o, new_id), writers),
    (o, 'legacy_flags', 'U',
     format('update public.%I set legacy_flags = %L::text[] where %s', o, '{forged}', old_where),
     format($c$select coalesce((select 'forged' = any (t.legacy_flags) from public.%I t where %s), false)$c$, o, old_where), coalesce(upd_writers, writers))
$$;

select pg_temp.add_legacy('companies', 'id, name', $v$@a1, 'probe co'$v$, 'id = @a1', 'id = @02', '{admin,sales,engineer}');
select pg_temp.add_legacy('rfqs', 'id, company_id, owner_id', $v$@a5, @01, 'a0000000-0000-4000-8000-000000000002'$v$, 'id = @a5', 'id = @16', '{admin,sales,engineer}');
select pg_temp.add_legacy('rfq_items', 'id, rfq_id, description', $v$@a6, @15, 'probe'$v$, 'id = @a6', 'id = @18', '{admin,sales,engineer}');
select pg_temp.add_legacy('supplier_inquiries', 'id, rfq_id, supplier_id', '@a7, @16, @03', 'id = @a7', 'id = @1b', '{admin,sales,engineer}');
select pg_temp.add_legacy('supplier_quote_lines', 'inquiry_id, rfq_item_id, unit_price, currency', $v$@1a, @17, 5, 'PKR'$v$, 'inquiry_id = @1a and rfq_item_id = @17', 'id = @1c', '{admin,sales,engineer}');
select pg_temp.add_legacy('orders', 'id, company_id, owner_id', $v$@a9, @01, 'a0000000-0000-4000-8000-000000000002'$v$, 'id = @a9', 'id = @21', '{admin,sales,engineer}');
select pg_temp.add_legacy('order_items', 'id, order_id, description, unit_price_net', $v$@aa, @20, 'probe', 1$v$, 'id = @aa', 'id = @25', '{admin,sales}', '{admin,sales,engineer}');
select pg_temp.add_legacy('supplier_orders', 'id, order_id, supplier_id', '@ab, @20, @03', 'id = @ab', 'id = @24', '{admin,sales,engineer}');
select pg_temp.add_legacy('invoices', 'id, order_id, number, net_amount, gst_amount', $v$@ac, @21, 'INV-P', 100, 18$v$, 'id = @ac', 'id = @27', '{admin,sales}');
select pg_temp.add_legacy('payments_in', 'id, order_id, amount', '@ad, @21, 5', 'id = @ad', 'id = @28', '{admin}');
select pg_temp.add_legacy('expenses', 'id, amount_pkr, category_id', $v$@ae, 5, 'ca7e0000-0000-4000-8000-000000000010'$v$, 'id = @ae', 'id = @29', '{admin}');

-- settled_before_cutover: only on an imported invoice with no order (the CHECK), so the probes use one.
insert into legacy_probe values
  ('invoices', 'settled_before_cutover', 'I',
   $q$insert into public.invoices (id, company_id, number, net_amount, gst_amount, legacy_source, settled_before_cutover) values (@e2, @01, 'LEG-P', 100, 18, '{"table":"gst_invoices"}', true)$q$,
   $q$select exists (select 1 from public.invoices where id = @e2 and settled_before_cutover)$q$, '{admin,sales}'),
  ('invoices', 'settled_before_cutover', 'U',
   $q$update public.invoices set settled_before_cutover = true where id = @e1$q$,
   $q$select (select settled_before_cutover from public.invoices where id = @e1)$q$, '{admin,sales}');

-- ------------------------------------------------------------------ coverage
select is((select coalesce(array_agg(x order by x), '{}') from (
             select c.table_name || '.' || c.column_name as x from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
             where c.table_schema = 'public' and (c.column_name like 'legacy\_%' or c.column_name = 'settled_before_cutover')
             except
             select obj || '.' || col from legacy_probe) u),
          '{}'::text[], 'coverage: every legacy column of every table has probes');

-- ------------------------------------------------------------------ validity: the import (service role) sets each one
select is(pg_temp.sets(p.stmt, p.chk, 'service'), 'set', format('valid probe: the import sets %s.%s on %s', p.obj, p.col, p.op))
from legacy_probe p order by p.obj, p.col, p.op;

-- 0078 (BUG-RV-01): what the import sends as legacy_source is kept in legacy_archive.legacy_rows; the column keeps a marker.
select is((select legacy_source from public.invoices where id = pg_temp.f('e1')), '{"imported": true, "table": "gst_invoices"}'::jsonb,
  'legacy_source keeps only the marker of an imported row');
select is((select data from legacy_archive.legacy_rows where table_name = 'invoices' and row_id = pg_temp.f('e1')),
  '{"table":"gst_invoices","row":{"id":"old-1"}}'::jsonb, 'the raw old row is in legacy_archive.legacy_rows');

-- ------------------------------------------------------------------ settled_before_cutover: no app user (real assertions, 0068)
select ok(pg_temp.sets(p.stmt, p.chk, w) <> 'set',
  format('%s cannot set invoices.settled_before_cutover on %s (got %s)', w, p.op, pg_temp.sets(p.stmt, p.chk, w)))
from legacy_probe p cross join unnest(p.writers) w
where p.col = 'settled_before_cutover' order by p.op, w;

-- ------------------------------------------------------------------ orders.legacy_flags: admin only (real assertions, 0065 M-1)
select ok(pg_temp.sets(p.stmt, p.chk, w) <> 'set',
  format('%s cannot set orders.legacy_flags on %s (got %s)', w, p.op, pg_temp.sets(p.stmt, p.chk, w)))
from legacy_probe p cross join unnest(p.writers) w
where p.obj = 'orders' and p.col = 'legacy_flags' and w <> 'admin' order by p.op, w;

-- ------------------------------------------------------------------ BUG-RV-02: legacy_source is writable by every app user
-- Nothing guards legacy_source (no trigger, no column grant). Effects: an app user can mark a row as imported, which
-- turns off the payment's target credit (set_payment_credited_user skips rows with legacy_source), skips the FX capture
-- of a supplier quote line (capture_quote_line_fx), shows the row as "legacy" in supplier memory, and is the
-- precondition of settled_before_cutover. It can also overwrite or erase the import's audit trail of a row.
select ok(pg_temp.sets(p.stmt, p.chk, w) <> 'set',
  format('BUG-RV-02 %s cannot set %s.legacy_source on %s (got %s)', w, p.obj, p.op, pg_temp.sets(p.stmt, p.chk, w)))
from legacy_probe p cross join unnest(p.writers) w
where p.col = 'legacy_source' order by p.obj, p.op, w;

-- ------------------------------------------------------------------ BUG-RV-03: legacy_flags writable by non-admins outside orders
-- 0065 made orders.legacy_flags admin only because flags change what the database requires and computes. The other
-- tables were left open: e.g. any flag on an invoice lifts the NOT NULL rules on its number and date
-- (invoices_number_present, invoices_date_present), so sales can create an undated invoice that no month (and so no
-- month lock or GST month) ever contains; 'owner_unknown' lifts the owner rule on an RFQ.
select ok(pg_temp.sets(p.stmt, p.chk, w) <> 'set',
  format('BUG-RV-03 %s cannot set %s.legacy_flags on %s (got %s)', w, p.obj, p.op, pg_temp.sets(p.stmt, p.chk, w)))
from legacy_probe p cross join unnest(p.writers) w
where p.col = 'legacy_flags' and p.obj <> 'orders' and w <> 'admin' order by p.obj, p.op, w;

-- The concrete effect of BUG-RV-03 on invoices: sales create an invoice with neither a number nor a date.
select is(pg_temp.sets(
  $q$insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, legacy_flags) values (@e3, @21, null, null, 100, 18, '{forged}')$q$,
  $q$select exists (select 1 from public.invoices where id = @e3 and invoice_date is null)$q$, 'service'), 'set',
  'valid probe: an undated, unnumbered invoice needs a legacy flag (the import may)');
select isnt(pg_temp.sets(
  $q$insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, legacy_flags) values (@e3, @21, null, null, 100, 18, '{forged}')$q$,
  $q$select exists (select 1 from public.invoices where id = @e3 and invoice_date is null)$q$, 'sales'), 'set',
  'BUG-RV-03 sales cannot create an invoice with no number and no date');

select * from finish();
rollback;
