begin;
select * from no_plan();

-- 0141_archive_core: the archive setting, the overrides, the rule, archived(<row>) for 13 tables and 5 list views, is_archived(), and the five
-- admin RPCs (archive_set, archive_unhide, archive_rehide, archive_preview, archive_list).
--   (a) the rule: 16 Nov 2026 hidden, 17 Nov 2026 visible, for every one of the 13 kinds of row; imported rows hidden whatever their date; a
--       row with no date falls back to created_at (never for an imported row); a setting that is off hides nothing
--   (b) the list views: archived(v_jobs) (an old RFQ with a new order is visible), v_rfq_state, v_order_state, v_invoice_state, v_inquiry_state
--   (c) unhide and rehide; unhiding a row of a CLOSED month touches no business row (no UPDATE on invoices, payments_in, expenses)
--   (d) the numbers are the same with archiving on and off (view and function results compared row for row)
--   (e) the five RPCs refuse sales, an engineer and a deactivated person (42501); the setting and the overrides cannot be written directly
--   (f) archive_preview (on or off, any cutoff) and archive_list (company, search, paging)
--   (g) an engineer reads the yes/no answers and no money
-- Dates are Karachi days: the clarification pair straddles midnight (23:30 and 00:30 +05) to prove it.

-- ------------------------------------------------------------------ machinery
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b9141000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona the way PostgREST does (role authenticated, claims, then the pre-request that moves an engineer onto
-- qtech_engineer) and returns the first column of the first row as text: '<none>' for no row, '<null>' for NULL, 'E:<sqlstate>' for an error.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

-- ------------------------------------------------------------------ fixtures (as the table owner, admin claims)
-- Archiving is OFF here (the default). Ids b9141000-...-00NN.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.f('01'), '0141 Customer'), (pg_temp.f('02'), '0141 Supplier'), (pg_temp.f('03'), '0141 Supplier two');

-- RFQs: r1 16 Nov (hidden), r2 17 Nov (visible), r3 imported with a new date (hidden), r4..r6 old RFQs for the jobs below
insert into public.rfqs (id, company_id, owner_id, received_on, legacy_source) values
  (pg_temp.f('11'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', null),
  (pg_temp.f('12'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-17', null),
  (pg_temp.f('13'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-12-05', '{"table":"rfqs"}'),
  (pg_temp.f('14'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-01', null),
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-02', null),
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-02', null);

-- Orders: o1 16 Nov direct, o2 17 Nov direct, o3 imported (new date), o4 an order dated 20 Nov on the old RFQ r4, o5 an old order on the old
-- RFQ r5, o6 a CANCELLED old order on r6, o7 and o8 undated (not imported): created 10 Nov (hidden) and 25 Nov (visible)
insert into public.orders (id, company_id, owner_id, rfq_id, ordered_on, cancelled_on, legacy_flags, legacy_source, created_at) values
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-16', null, '{}', null, now()),
  (pg_temp.f('22'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-17', null, '{}', null, now()),
  (pg_temp.f('23'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-12-01', null, '{}', '{"table":"orders"}', now()),
  (pg_temp.f('24'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('14'), '2026-11-20', null, '{}', null, now()),
  (pg_temp.f('25'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('15'), '2026-11-03', null, '{}', null, now()),
  (pg_temp.f('26'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('16'), '2026-11-03', '2026-11-04', '{}', null, now()),
  (pg_temp.f('27'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, null, null, '{undated}', null, '2026-11-10 12:00+05'),
  (pg_temp.f('28'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, null, null, '{undated}', null, '2026-11-25 12:00+05');

-- Invoices: i1 16 Nov, i2 17 Nov, i3 imported (new date), i4 undated created 10 Nov (hidden), i5 undated created 25 Nov (visible),
-- i6 imported AND undated, created 1 Dec (hidden: created_at is never used for an imported row)
insert into public.invoices (id, order_id, company_id, number, invoice_date, net_amount, gst_amount, legacy_flags, legacy_source, created_at) values
  (pg_temp.f('31'), pg_temp.f('21'), null, 'INV-141-1', '2026-11-16', 100, 18, '{}', null, now()),
  (pg_temp.f('32'), pg_temp.f('22'), null, 'INV-141-2', '2026-11-17', 100, 18, '{}', null, now()),
  (pg_temp.f('33'), null, pg_temp.f('01'), 'INV-141-3', '2026-12-01', 100, 0, '{}', '{"table":"invoices"}', now()),
  (pg_temp.f('34'), pg_temp.f('21'), null, 'INV-141-4', null, 50, 9, '{undated}', null, '2026-11-10 12:00+05'),
  (pg_temp.f('35'), pg_temp.f('22'), null, 'INV-141-5', null, 50, 9, '{undated}', null, '2026-11-25 12:00+05'),
  (pg_temp.f('36'), null, pg_temp.f('01'), 'INV-141-6', null, 50, 0, '{undated}', '{"table":"invoices"}', '2026-12-01 12:00+05');

insert into public.payments_in (id, order_id, amount, received_on, legacy_source) values
  (pg_temp.f('41'), pg_temp.f('21'), 50, '2026-11-16', null),
  (pg_temp.f('42'), pg_temp.f('22'), 50, '2026-11-17', null),
  (pg_temp.f('43'), pg_temp.f('22'), 10, '2026-12-01', '{"table":"payments"}');

insert into public.expenses (id, amount_pkr, category_id, paid_on, legacy_source) values
  (pg_temp.f('51'), 100, 'ca7e0000-0000-4000-8000-000000000005', '2026-11-16', null),
  (pg_temp.f('52'), 100, 'ca7e0000-0000-4000-8000-000000000005', '2026-11-17', null),
  (pg_temp.f('53'), 100, 'ca7e0000-0000-4000-8000-000000000005', '2026-12-01', '{"table":"expenses"}');

insert into public.expense_claims (id, created_by, spent_on, amount_pkr, note) values
  (pg_temp.f('61'), 'a0000000-0000-4000-8000-000000000001', '2026-11-16', 5, '0141 claim old'),
  (pg_temp.f('62'), 'a0000000-0000-4000-8000-000000000001', '2026-11-17', 7, '0141 claim new');
insert into public.cash_topups (id, drawn_on, amount_pkr) values
  (pg_temp.f('63'), '2026-11-16', 5), (pg_temp.f('64'), '2026-11-17', 5);
-- Both are opening counts: cash_counts_prepare (0087) keeps an opening's date and forces every other count to today, so only openings give fixed dates.
insert into public.cash_counts (id, counted_on, counted_pkr, is_opening) values
  (pg_temp.f('65'), '2026-11-16', 5, true), (pg_temp.f('66'), '2026-11-17', 5, true);

insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, lines) values
  (pg_temp.f('71'), pg_temp.f('11'), 914101, 0, '2026-11-16', '2027-01-01', '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  (pg_temp.f('72'), pg_temp.f('12'), 914102, 0, '2026-11-17', '2027-01-01', '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, legacy_source) values
  (pg_temp.f('81'), pg_temp.f('21'), pg_temp.f('02'), 'PKR', '2026-11-16', null),
  (pg_temp.f('82'), pg_temp.f('22'), pg_temp.f('02'), 'PKR', '2026-11-17', null),
  (pg_temp.f('83'), pg_temp.f('22'), pg_temp.f('03'), 'PKR', '2026-12-01', '{"table":"supplier_orders"}');
insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines) values
  (pg_temp.f('91'), pg_temp.f('81'), 914201, 0, '2026-11-16', 'PKR', 0, '[{"qty":1,"unit_price":1}]'),
  (pg_temp.f('92'), pg_temp.f('82'), 914202, 0, '2026-11-17', 'PKR', 0, '[{"qty":1,"unit_price":1}]');

insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, legacy_source) values
  (pg_temp.f('a1'), pg_temp.f('11'), pg_temp.f('02'), '2026-11-16', null),
  (pg_temp.f('a2'), pg_temp.f('12'), pg_temp.f('02'), '2026-11-17', null),
  (pg_temp.f('a3'), pg_temp.f('12'), pg_temp.f('03'), '2026-12-01', '{"table":"supplier_inquiries"}');

-- 23:30 and 00:30 at +05: the same UTC date (16 Nov) for both, two different Karachi days
insert into public.clarifications (id, rfq_id, question, first_asked_at, last_asked_at) values
  (pg_temp.f('b1'), pg_temp.f('11'), '0141 asked on 16 Nov', '2026-11-16 23:30+05', '2026-11-16 23:30+05'),
  (pg_temp.f('b2'), pg_temp.f('12'), '0141 asked on 17 Nov', '2026-11-17 00:30+05', '2026-11-17 00:30+05');

-- March 2020, to be closed: the rows that prove an unhide in a locked month touches nothing (as 0904)
insert into public.orders (id, company_id, owner_id, ordered_on, created_at) values
  (pg_temp.f('c0'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2020-02-01', '2020-02-01');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  (pg_temp.f('c1'), pg_temp.f('c0'), 'INV-141-M1', '2020-03-10', 100000, 18000);
insert into public.payments_in (id, order_id, amount, received_on, paid_via) values
  (pg_temp.f('c2'), pg_temp.f('c0'), 59000, '2020-03-12', 'bank');
insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via) values
  (pg_temp.f('c3'), 2000, 'ca7e0000-0000-4000-8000-000000000002', '2020-03-15', 'bank');

select is(public.close_months_through(date '2020-03-01'), 1, 'fixture: March 2020 is closed');

-- Every fixture row, the kind it is, and whether the rule (cutoff 17 Nov 2026) archives it
create temp table fx (entity text, id uuid, label text, hidden boolean);
insert into fx values
  ('rfq', pg_temp.f('11'), 'rfq 16 Nov', true), ('rfq', pg_temp.f('12'), 'rfq 17 Nov', false), ('rfq', pg_temp.f('13'), 'rfq imported, new date', true),
  ('rfq', pg_temp.f('14'), 'rfq 1 Nov', true), ('rfq', pg_temp.f('15'), 'rfq 2 Nov', true), ('rfq', pg_temp.f('16'), 'rfq 2 Nov (cancelled order)', true),
  ('order', pg_temp.f('21'), 'order 16 Nov', true), ('order', pg_temp.f('22'), 'order 17 Nov', false), ('order', pg_temp.f('23'), 'order imported, new date', true),
  ('order', pg_temp.f('24'), 'order 20 Nov on old rfq', false), ('order', pg_temp.f('25'), 'order 3 Nov on old rfq', true),
  ('order', pg_temp.f('26'), 'cancelled order 3 Nov', true),
  ('order', pg_temp.f('27'), 'order undated, created 10 Nov', true), ('order', pg_temp.f('28'), 'order undated, created 25 Nov', false),
  ('invoice', pg_temp.f('31'), 'invoice 16 Nov', true), ('invoice', pg_temp.f('32'), 'invoice 17 Nov', false),
  ('invoice', pg_temp.f('33'), 'invoice imported, new date', true),
  ('invoice', pg_temp.f('34'), 'invoice undated, created 10 Nov', true), ('invoice', pg_temp.f('35'), 'invoice undated, created 25 Nov', false),
  ('invoice', pg_temp.f('36'), 'invoice imported and undated, created 1 Dec', true),
  ('payment', pg_temp.f('41'), 'payment 16 Nov', true), ('payment', pg_temp.f('42'), 'payment 17 Nov', false), ('payment', pg_temp.f('43'), 'payment imported', true),
  ('expense', pg_temp.f('51'), 'expense 16 Nov', true), ('expense', pg_temp.f('52'), 'expense 17 Nov', false), ('expense', pg_temp.f('53'), 'expense imported', true),
  ('claim', pg_temp.f('61'), 'claim 16 Nov', true), ('claim', pg_temp.f('62'), 'claim 17 Nov', false),
  ('topup', pg_temp.f('63'), 'topup 16 Nov', true), ('topup', pg_temp.f('64'), 'topup 17 Nov', false),
  ('cash_count', pg_temp.f('65'), 'cash count 16 Nov', true), ('cash_count', pg_temp.f('66'), 'cash count 17 Nov', false),
  ('quotation', pg_temp.f('71'), 'quotation 16 Nov', true), ('quotation', pg_temp.f('72'), 'quotation 17 Nov', false),
  ('supplier_order', pg_temp.f('81'), 'supplier order 16 Nov', true), ('supplier_order', pg_temp.f('82'), 'supplier order 17 Nov', false),
  ('supplier_order', pg_temp.f('83'), 'supplier order imported', true),
  ('purchase_order', pg_temp.f('91'), 'PO 16 Nov', true), ('purchase_order', pg_temp.f('92'), 'PO 17 Nov', false),
  ('inquiry', pg_temp.f('a1'), 'inquiry 16 Nov', true), ('inquiry', pg_temp.f('a2'), 'inquiry 17 Nov', false), ('inquiry', pg_temp.f('a3'), 'inquiry imported', true),
  ('clarification', pg_temp.f('b1'), 'clarification 16 Nov 23:30 +05', true), ('clarification', pg_temp.f('b2'), 'clarification 17 Nov 00:30 +05', false),
  ('order', pg_temp.f('c0'), 'order Feb 2020', true), ('invoice', pg_temp.f('c1'), 'invoice Mar 2020', true),
  ('payment', pg_temp.f('c2'), 'payment Mar 2020', true), ('expense', pg_temp.f('c3'), 'expense Mar 2020', true);

create temp table ent_tbl (entity text, tbl text);
insert into ent_tbl values ('rfq', 'rfqs'), ('order', 'orders'), ('quotation', 'quotations'), ('purchase_order', 'purchase_orders'),
  ('supplier_order', 'supplier_orders'), ('invoice', 'invoices'), ('payment', 'payments_in'), ('expense', 'expenses'), ('claim', 'expense_claims'),
  ('topup', 'cash_topups'), ('cash_count', 'cash_counts'), ('inquiry', 'supplier_inquiries'), ('clarification', 'clarifications');

-- archived(<row>) of the table the kind lives in (the 13 computed fields), by name
create function pg_temp.row_archived(p_entity text, p_id uuid) returns boolean language plpgsql as $$
declare v boolean; t text;
begin
  select e.tbl into t from pg_temp.ent_tbl e where e.entity = p_entity;
  execute format('select public.archived(x) from public.%I x where x.id = $1', t) into v using p_id;
  return v;
end $$;

-- ------------------------------------------------------------------ (a) the default: archiving is off, nothing is hidden
select is((select enabled::text || ' ' || cutoff::text from public.archive_settings where id = 1), 'false 2026-11-17',
  'archive_settings: one row, archiving off, cutoff 17 Nov 2026');
select is((select count(*)::int from public.archive_settings), 1, 'archive_settings holds only the one row');
select is((select count(*)::int from fx where pg_temp.row_archived(entity, id) is distinct from false), 0,
  'off: archived(<row>) is false for every fixture row of the 13 kinds');
select is((select count(*)::int from fx where public.is_archived(entity, id) is distinct from false), 0,
  'off: is_archived() is false for every fixture row');
select is(public.archive_hides(date '2020-01-01', true), false, 'off: archive_hides(old, imported) is false');
select is(public.archive_hides(null, false), false, 'off: archive_hides(no date) is false');

-- ------------------------------------------------------------------ (a) switch it on
select is((select (public.archive_set(true, date '2026-11-17')).enabled), true, 'archive_set(true, 17 Nov 2026) switches archiving on');
select is((select updated_by::text from public.archive_settings where id = 1), 'a0000000-0000-4000-8000-000000000001',
  'archive_settings.updated_by is the admin who changed it');
select ok(exists (select 1 from public.audit_log where table_name = 'archive_settings' and action = 'update'), 'changing the setting is audited');

select is(public.archive_hides(date '2026-11-16', false), true, 'on: 16 Nov 2026 is hidden');
select is(public.archive_hides(date '2026-11-17', false), false, 'on: 17 Nov 2026 is visible (the cutoff day itself)');
select is(public.archive_hides(date '2026-12-31', true), true, 'on: an imported row is hidden whatever its date');
select is(public.archive_hides(null, false), true, 'on: no date at all is hidden');
select is(public.archive_hides(date '2030-01-01', false), false, 'on: a later date is visible');

select is((select coalesce(array_agg(label order by label), '{}') from fx where pg_temp.row_archived(entity, id) is distinct from hidden),
  '{}'::text[], 'on: archived(<row>) of every one of the 13 tables matches the rule (16 Nov hidden, 17 Nov visible, imported hidden, null date falls back to created_at)');
select is((select coalesce(array_agg(label order by label), '{}') from fx where public.is_archived(entity, id) is distinct from hidden),
  '{}'::text[], 'on: is_archived() agrees for every fixture row');
select is((select count(*)::int from fx where hidden), (select count(*)::int from fx where public.is_archived(entity, id)),
  'on: the number of hidden fixture rows is as expected');

select is(public.is_archived('rfq', pg_temp.f('11')), true, 'boundary: an RFQ received 16 Nov 2026 is archived');
select is(public.is_archived('rfq', pg_temp.f('12')), false, 'boundary: an RFQ received 17 Nov 2026 is visible');
select is(public.is_archived('invoice', pg_temp.f('34')), true, 'no date, not imported: created 10 Nov, so archived');
select is(public.is_archived('invoice', pg_temp.f('35')), false, 'no date, not imported: created 25 Nov, so visible');
select is(public.is_archived('invoice', pg_temp.f('36')), true, 'imported and undated: archived whatever created_at says (created 1 Dec)');
select is(public.is_archived('clarification', pg_temp.f('b1')), true, 'a clarification asked at 23:30 on 16 Nov Karachi is archived');
select is(public.is_archived('clarification', pg_temp.f('b2')), false, 'one asked at 00:30 on 17 Nov Karachi is visible (the Karachi day, not the UTC day)');
select is(public.is_archived('order', gen_random_uuid()), null, 'a row that does not exist: NULL');
select is(public.is_archived('nonsense', pg_temp.f('11')), null, 'an unknown kind: NULL');

-- ------------------------------------------------------------------ (b) the list views
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('14')), false,
  'v_jobs: an old RFQ whose live order is dated 20 Nov is visible');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('15')), true,
  'v_jobs: an old RFQ with an old order is archived');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('16')), true,
  'v_jobs: an old RFQ whose only order is cancelled is archived (the cancelled order does not keep it)');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('11')), true, 'v_jobs: an old RFQ with no order is archived');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('12')), false, 'v_jobs: a 17 Nov RFQ with no order is visible');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('13')), true, 'v_jobs: an imported RFQ is archived');
select is((select public.archived(j) from public.v_jobs j where j.kind = 'direct' and j.order_id = pg_temp.f('21')), true, 'v_jobs: a direct job follows its order (16 Nov: archived)');
select is((select public.archived(j) from public.v_jobs j where j.kind = 'direct' and j.order_id = pg_temp.f('22')), false, 'v_jobs: a direct job follows its order (17 Nov: visible)');
select is((select public.archived(s) from public.v_rfq_state s where s.rfq_id = pg_temp.f('11')), true, 'v_rfq_state: archived(16 Nov RFQ)');
select is((select public.archived(s) from public.v_rfq_state s where s.rfq_id = pg_temp.f('12')), false, 'v_rfq_state: archived(17 Nov RFQ)');
select is((select public.archived(s) from public.v_order_state s where s.order_id = pg_temp.f('21')), true, 'v_order_state: archived(16 Nov order)');
select is((select public.archived(s) from public.v_order_state s where s.order_id = pg_temp.f('22')), false, 'v_order_state: archived(17 Nov order)');
select is((select public.archived(s) from public.v_invoice_state s where s.invoice_id = pg_temp.f('31')), true, 'v_invoice_state: archived(16 Nov invoice)');
select is((select public.archived(s) from public.v_invoice_state s where s.invoice_id = pg_temp.f('32')), false, 'v_invoice_state: archived(17 Nov invoice)');
select is((select public.archived(s) from public.v_inquiry_state s where s.inquiry_id = pg_temp.f('a1')), true, 'v_inquiry_state: archived(16 Nov inquiry)');
select is((select public.archived(s) from public.v_inquiry_state s where s.inquiry_id = pg_temp.f('a2')), false, 'v_inquiry_state: archived(17 Nov inquiry)');

-- ------------------------------------------------------------------ (c) unhide and rehide
select is(public.archive_unhide('rfq', pg_temp.f('11')), true, 'unhide: the 16 Nov RFQ is brought back (true: newly unhidden)');
select is(public.is_archived('rfq', pg_temp.f('11')), false, 'unhide: it is no longer archived');
select is(pg_temp.row_archived('rfq', pg_temp.f('11')), false, 'unhide: archived(rfqs row) says so too');
select is((select public.archived(s) from public.v_rfq_state s where s.rfq_id = pg_temp.f('11')), false, 'unhide: and archived(v_rfq_state)');
select is((select public.archived(j) from public.v_jobs j where j.rfq_id = pg_temp.f('11')), false, 'unhide: and its job (v_jobs) is visible');
select is(public.archive_unhide('rfq', pg_temp.f('11')), false, 'unhide twice: false, nothing new');
select is((select count(*)::int from public.archive_unhidden where entity = 'rfq' and row_id = pg_temp.f('11')), 1, 'one override row');
select ok(exists (select 1 from public.audit_log where table_name = 'archive_unhidden' and action = 'insert' and record_id like '%' || pg_temp.f('11')::text || '%'),
  'the unhide is audited (by entity and row id)');
select is(public.is_archived('rfq', pg_temp.f('13')), true, 'an override on one row leaves the others archived');
select is(public.archive_rehide('rfq', pg_temp.f('11')), true, 'rehide: the override is removed (true)');
select is(public.is_archived('rfq', pg_temp.f('11')), true, 'rehide: archived again');
select is(public.archive_rehide('rfq', pg_temp.f('11')), false, 'rehide twice: false, nothing to remove');
select throws_ok($$select public.archive_unhide('rfq', gen_random_uuid())$$, 'P0002', null, 'unhide: a row that does not exist is refused (P0002)');
select throws_ok($$select public.archive_unhide('nonsense', gen_random_uuid())$$, '22023', null, 'unhide: an unknown kind is refused (22023)');
select throws_ok($$select public.archive_rehide('nonsense', gen_random_uuid())$$, '22023', null, 'rehide: an unknown kind is refused (22023)');

-- ... in a LOCKED month: no UPDATE of the business row
-- ctid, not xmin: the whole test is one transaction, so an UPDATE would keep the xmin but always gives the row a new ctid
create temp table lockrows as
select 'invoice'::text as entity, pg_temp.f('c1') as id, (select i.ctid::text from public.invoices i where i.id = pg_temp.f('c1')) as ctid_before
union all select 'payment', pg_temp.f('c2'), (select p.ctid::text from public.payments_in p where p.id = pg_temp.f('c2'))
union all select 'expense', pg_temp.f('c3'), (select e.ctid::text from public.expenses e where e.id = pg_temp.f('c3'));
create temp table lock_audit as
select count(*)::int as n from public.audit_log where table_name in ('invoices', 'payments_in', 'expenses')
  and record_id in (pg_temp.f('c1')::text, pg_temp.f('c2')::text, pg_temp.f('c3')::text);

select ok((select bool_and(public.is_archived(entity, id)) from lockrows), 'locked month: the March 2020 invoice, payment and expense are archived');
select ok((select bool_and(public.archive_unhide(entity, id)) from lockrows), 'locked month: unhiding all three succeeds');
select ok((select bool_and(not public.is_archived(entity, id)) from lockrows), 'locked month: and they are visible');
select is((select count(*)::int from lockrows l where l.ctid_before is distinct from
             coalesce((select i.ctid::text from public.invoices i where i.id = l.id and l.entity = 'invoice'),
                      (select p.ctid::text from public.payments_in p where p.id = l.id and l.entity = 'payment'),
                      (select e.ctid::text from public.expenses e where e.id = l.id and l.entity = 'expense'))),
  0, 'locked month: no UPDATE of an invoice, a payment or an expense (every row keeps its ctid, so no new row version was written)');
select is((select count(*)::int from public.audit_log where table_name in ('invoices', 'payments_in', 'expenses')
             and record_id in (pg_temp.f('c1')::text, pg_temp.f('c2')::text, pg_temp.f('c3')::text)),
  (select n from lock_audit), 'locked month: the audit log shows no change to those three rows');
select ok((select bool_and(public.archive_rehide(entity, id)) from lockrows), 'locked month: rehiding succeeds too');
select ok((select bool_and(public.is_archived(entity, id)) from lockrows), 'locked month: and they are archived again');

-- ------------------------------------------------------------------ (d) the numbers are the same with archiving on and off
create temp table snap (k text, step text, j jsonb);
create function pg_temp.take(p_step text) returns void language plpgsql as $$
begin
  insert into snap select 'v_order_money', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_order_money t;
  insert into snap select 'v_payment_net', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_payment_net t;
  insert into snap select 'v_month_pnl', p_step, coalesce(jsonb_agg((to_jsonb(t) - 'frozen_at') order by to_jsonb(t)::text), '[]') from public.v_month_pnl t;
  insert into snap select 'v_gst_register', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_gst_register t;
  insert into snap select 'v_cash_month', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_cash_month t;
  insert into snap select 'v_order_state', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_order_state t;
  insert into snap select 'v_jobs', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.v_jobs t;
  insert into snap select 'receivables_summary', p_step, coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.receivables_summary() t;
  insert into snap select 'order_receivables', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.order_receivables() t;
  insert into snap select 'supplier_item_memory', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]')
    from public.supplier_item_memory(array[pg_temp.f('02'), pg_temp.f('03')], null, null, 'Fixture item') t;
end $$;

select pg_temp.take('on');
select is((select (public.archive_set(false, null)).enabled), false, 'archive_set(false) switches archiving off (the cutoff is kept)');
select is((select cutoff::text from public.archive_settings where id = 1), '2026-11-17', 'the cutoff is kept when archive_set is given none');
select pg_temp.take('off');
select ok((select count(*) from snap where step = 'on') = 10 and (select count(*) from snap where step = 'off') = 10, 'snapshots: ten number sources, on and off');
select is((select coalesce(array_agg(a.k order by a.k), '{}') from snap a join snap b on b.k = a.k and b.step = 'off'
           where a.step = 'on' and a.j is distinct from b.j),
  '{}'::text[], 'numbers: v_order_money, v_payment_net, v_month_pnl, v_gst_register, v_cash_month, v_order_state, v_jobs, receivables_summary, order_receivables and supplier_item_memory are identical with archiving on and off');
select ok((select jsonb_array_length(j) > 0 from snap where k = 'v_order_money' and step = 'on'), 'numbers: v_order_money has rows (the comparison is not empty)');
select ok((select jsonb_array_length(j) > 0 from snap where k = 'v_month_pnl' and step = 'on'), 'numbers: v_month_pnl has rows');
select ok((select jsonb_array_length(j) > 0 from snap where k = 'v_gst_register' and step = 'on'), 'numbers: v_gst_register has rows');
select ok((select jsonb_array_length(j) > 0 from snap where k = 'receivables_summary' and step = 'on'), 'numbers: receivables_summary has a row');
select is((select count(*)::int from fx where pg_temp.row_archived(entity, id) is distinct from false), 0, 'off again: nothing is hidden');

-- ------------------------------------------------------------------ (f) archive_preview: works with archiving on or off
create temp table prev_off as select * from public.archive_preview(null);
select is((select count(*)::int from prev_off), 13, 'archive_preview (archiving off): one row per kind');
select is((select count(distinct entity)::int from prev_off), 13, 'archive_preview: thirteen different kinds');
select is((select coalesce(array_agg(f.entity order by f.entity), '{}') from (
             select p.entity from prev_off p
             where p.would_hide is distinct from (select count(*) from fx x where x.entity = p.entity and x.hidden)) f),
  '{}'::text[], 'archive_preview (off): would_hide is, kind by kind, the number of fixture rows the rule archives');
select is((select would_hide from prev_off where entity = 'rfq'), 5::bigint, 'archive_preview: five RFQs would be hidden (16 Nov, imported, 1 Nov, 2 Nov, 2 Nov)');
select is((select of_which_imported from prev_off where entity = 'rfq'), 1::bigint, 'archive_preview: one of them is imported');
select is((select of_which_imported from prev_off where entity = 'invoice'), 2::bigint, 'archive_preview: two invoices are imported');
select is((select of_which_open from prev_off where entity = 'rfq'), 3::bigint,
  'archive_preview: of the five RFQs, three are open (no live order, not closed): 16 Nov, imported, and the one whose only order is cancelled');
select is((select of_which_open from prev_off where entity = 'claim'), 1::bigint, 'archive_preview: one pending claim would be hidden');
select is((select open_amount_pkr from prev_off where entity = 'claim'), 5::numeric, 'archive_preview: the pending claim is Rs 5');
select ok((select open_amount_pkr from prev_off where entity = 'invoice') > 0, 'archive_preview: an archived invoice whose order still owes shows an open amount');
select is((select open_amount_pkr from prev_off where entity = 'invoice'),
  (select coalesce(sum(r.balance), 0) from public.order_receivables() r
   where r.payment_state <> 'settled' and r.balance > 0
     and r.order_id in (select i.order_id from public.invoices i where i.id in (select f.id from fx f where f.entity = 'invoice' and f.hidden) and i.voided_at is null)),
  'archive_preview: that amount is the balance of those orders, each counted once');
select is((select open_amount_pkr from prev_off where entity = 'rfq'), 0::numeric, 'archive_preview: no open amount on an RFQ');
select is((select already_unhidden from prev_off where entity = 'rfq'), 0::bigint, 'archive_preview: none unhidden yet');
select is((select would_hide from public.archive_preview(date '2026-11-18') where entity = 'rfq'), 6::bigint,
  'archive_preview with a later cutoff (18 Nov): the 17 Nov RFQ would be hidden too');
select is((select would_hide from public.archive_preview(date '2026-11-17') where entity = 'rfq'), 5::bigint, 'archive_preview with the same cutoff: unchanged');
select is((select would_hide from public.archive_preview(date '2000-01-01') where entity = 'rfq'), 1::bigint, 'archive_preview with a very old cutoff: only the imported RFQ');
select is((select would_hide from public.archive_preview(date '2026-11-17') where entity = 'order'), 6::bigint,
  'archive_preview: six orders (16 Nov, imported, 3 Nov, the cancelled 3 Nov, the undated one created 10 Nov, Feb 2020)');

select is((select (public.archive_set(true, null)).enabled), true, 'archiving on again');
create temp table prev_on as select * from public.archive_preview(null);
select is((select count(*)::int from prev_on p join prev_off o using (entity)
           where p.would_hide is distinct from o.would_hide or p.of_which_imported is distinct from o.of_which_imported
              or p.of_which_open is distinct from o.of_which_open or p.open_amount_pkr is distinct from o.open_amount_pkr
              or p.already_unhidden is distinct from o.already_unhidden), 0, 'archive_preview: the same whether archiving is on or off');
select is(public.archive_unhide('rfq', pg_temp.f('11')), true, 'unhide one RFQ');
select is((select would_hide from public.archive_preview(null) where entity = 'rfq'), 4::bigint, 'archive_preview: an unhidden RFQ is no longer counted as to be hidden');
select is((select already_unhidden from public.archive_preview(null) where entity = 'rfq'), 1::bigint, 'archive_preview: it is counted as already unhidden');

-- ------------------------------------------------------------------ (f) archive_list
select is((select array_agg(l.id order by l.id) from public.archive_list('rfq', null, null, 100, 0) l),
  (select array_agg(f.id order by f.id) from fx f where f.entity = 'rfq' and f.hidden),
  'archive_list(rfq): the archived RFQs, including the one that was brought back');
select is((select is_unhidden from public.archive_list('rfq', null, null, 100, 0) where id = pg_temp.f('11')), true, 'archive_list: the brought-back row says is_unhidden');
select is((select is_unhidden from public.archive_list('rfq', null, null, 100, 0) where id = pg_temp.f('13')), false, 'archive_list: another does not');
select is((select is_imported from public.archive_list('rfq', null, null, 100, 0) where id = pg_temp.f('13')), true, 'archive_list: the imported flag');
select is((select is_imported from public.archive_list('rfq', null, null, 100, 0) where id = pg_temp.f('14')), false, 'archive_list: a row that is not imported');
select is((select count(*)::int from public.archive_list('rfq', null, null, 100, 0) where id = pg_temp.f('12')), 0, 'archive_list: a visible row is not listed');
select is((select company_name from public.archive_list('rfq', null, null, 1, 0)), '0141 Customer', 'archive_list: the company name');
select is((select count(*)::int from public.archive_list('rfq', null, null, 2, 0)), 2, 'archive_list: the limit');
select is((select count(*)::int from public.archive_list('rfq', null, null, 100, 3)), 2, 'archive_list: the offset (5 rows, skip 3)');
select is((select count(*)::int from public.archive_list('rfq', pg_temp.f('02'), null, 100, 0)), 0, 'archive_list: filtered by another company');
select is((select count(*)::int from public.archive_list('rfq', pg_temp.f('01'), null, 100, 0)), 5, 'archive_list: filtered by the company');
select is((select ref from public.archive_list('invoice', null, 'inv-141-1', 100, 0)), 'INV-141-1', 'archive_list: search by reference (any case)');
select is((select amount from public.archive_list('invoice', null, 'INV-141-1', 100, 0)), 118::numeric, 'archive_list: an invoice''s amount is its gross');
select is((select count(*)::int from public.archive_list('invoice', null, '0141 customer', 100, 0)), 5, 'archive_list: search by company name (5 archived invoices)');
select is((select count(distinct entity)::int from public.archive_list(null, null, null, 500, 0)), 13, 'archive_list: with no kind, every kind (all thirteen have an archived fixture row)');
select throws_ok($$select * from public.archive_list('nonsense')$$, '22023', null, 'archive_list: an unknown kind is refused (22023)');

-- ------------------------------------------------------------------ (e) who may do what
select is(pg_temp.as_(p, $q$select (public.archive_set(true, null)).enabled::text$q$), 'E:42501', format('archive_set refuses %s', p))
from unnest(array['sales', 'engineer', 'deactivated']) p;
select is(pg_temp.as_(p, $q$select public.archive_unhide('rfq', 'b9141000-0000-4000-8000-000000000012')::text$q$), 'E:42501', format('archive_unhide refuses %s', p))
from unnest(array['sales', 'engineer', 'deactivated']) p;
select is(pg_temp.as_(p, $q$select public.archive_rehide('rfq', 'b9141000-0000-4000-8000-000000000011')::text$q$), 'E:42501', format('archive_rehide refuses %s', p))
from unnest(array['sales', 'engineer', 'deactivated']) p;
select is(pg_temp.as_(p, $q$select count(*)::text from public.archive_preview(null)$q$), 'E:42501', format('archive_preview refuses %s', p))
from unnest(array['sales', 'engineer', 'deactivated']) p;
select is(pg_temp.as_(p, $q$select count(*)::text from public.archive_list('rfq')$q$), 'E:42501', format('archive_list refuses %s', p))
from unnest(array['sales', 'engineer', 'deactivated']) p;
select is(pg_temp.as_('admin', $q$select public.archive_unhide('rfq', 'b9141000-0000-4000-8000-000000000012')::text$q$), 'true', 'archive_unhide works for an admin');
select is(pg_temp.as_('admin', $q$select count(*)::text from public.archive_preview(null)$q$), '13', 'archive_preview works for an admin');
select is(pg_temp.as_('admin', $q$select count(*)::text from public.archive_list('rfq')$q$), '5', 'archive_list works for an admin');
select is((select enabled::text from public.archive_settings where id = 1), 'true', 'a refused archive_set changed nothing');
select is((select count(*)::int from public.archive_unhidden), 1, 'the refused calls changed no override (one row: the unhidden RFQ)');

-- nobody writes the setting or the overrides directly
select is(pg_temp.as_('admin', $q$update public.archive_settings set enabled = false$q$), 'E:42501', 'the setting cannot be updated directly, not even by an admin');
select is(pg_temp.as_('admin', $q$insert into public.archive_settings (id) values (2)$q$), 'E:42501', 'nor inserted');
select is(pg_temp.as_('admin', $q$delete from public.archive_settings$q$), 'E:42501', 'nor deleted');
select is(pg_temp.as_('admin', $q$insert into public.archive_unhidden (entity, row_id) values ('rfq', gen_random_uuid())$q$), 'E:42501', 'overrides cannot be inserted directly');
select is(pg_temp.as_('admin', $q$delete from public.archive_unhidden$q$), 'E:42501', 'nor deleted directly');
select is(pg_temp.as_('sales', $q$update public.archive_unhidden set unhidden_at = now()$q$), 'E:42501', 'nor updated');
select is(pg_temp.as_(p, $q$select count(*)::text from public.archive_settings$q$), '1', format('%s reads the setting', p))
from unnest(array['admin', 'sales', 'engineer']) p;
select is(pg_temp.as_(p, $q$select count(*)::text from public.archive_unhidden$q$), '1', format('%s reads the overrides', p))
from unnest(array['admin', 'sales', 'engineer']) p;
select is(pg_temp.as_('deactivated', $q$select count(*)::text from public.archive_settings$q$), '0', 'a deactivated person reads no setting');
select is(pg_temp.as_('deactivated', $q$select public.archive_hides(date '2020-01-01', false)::text$q$), '<null>', 'archive_hides gives a deactivated person NULL');
select is(has_function_privilege('anon', 'public.archive_set(boolean, date)', 'execute'), false, 'anon cannot run archive_set');
select is(has_function_privilege('anon', 'public.archive_hides(date, boolean)', 'execute'), false, 'anon cannot run archive_hides');
select is(has_table_privilege('anon', 'public.archive_settings', 'select') or has_table_privilege('anon', 'public.archive_unhidden', 'select'), false,
  'anon reads neither table');

-- ------------------------------------------------------------------ (g) an engineer: the answers, and no money
select is(pg_temp.as_('engineer', $q$select current_user::text$q$), 'qtech_engineer', 'precondition: an engineer''s request runs as qtech_engineer');
select is(pg_temp.as_('engineer', $q$select public.archive_hides(date '2026-11-16', false)::text$q$), 'true', 'engineer: archive_hides');
select is(pg_temp.as_('engineer', $q$select public.is_archived('rfq', 'b9141000-0000-4000-8000-000000000013')::text$q$), 'true', 'engineer: is_archived(rfq)');
select is(pg_temp.as_('engineer', $q$select public.is_archived('order', 'b9141000-0000-4000-8000-000000000021')::text$q$), 'true', 'engineer: is_archived(order)');
select is(pg_temp.as_('engineer', $q$select public.archived(r)::text from public.rfqs r where r.id = 'b9141000-0000-4000-8000-000000000013'$q$), 'true', 'engineer: archived(rfqs row)');
select is(pg_temp.as_('engineer', $q$select public.archived(r)::text from public.rfqs r where r.id = 'b9141000-0000-4000-8000-000000000012'$q$), 'false', 'engineer: archived(rfqs row), a visible one');
select is(pg_temp.as_('engineer', $q$select public.archived(j)::text from public.v_jobs j where j.rfq_id = 'b9141000-0000-4000-8000-000000000014'$q$), 'false',
  'engineer: archived(v_jobs), the old RFQ with the new order');
select is(pg_temp.as_('engineer', $q$select public.archived(j)::text from public.v_jobs j where j.rfq_id = 'b9141000-0000-4000-8000-000000000015'$q$), 'true', 'engineer: archived(v_jobs), an old job');
select is(pg_temp.as_('engineer', $q$select public.archived(s)::text from public.v_order_state s where s.order_id = 'b9141000-0000-4000-8000-000000000021'$q$), 'true', 'engineer: archived(v_order_state)');
select is(pg_temp.as_('engineer', $q$select public.archived(s)::text from public.v_rfq_state s where s.rfq_id = 'b9141000-0000-4000-8000-000000000013'$q$), 'true', 'engineer: archived(v_rfq_state)');
select is(pg_temp.as_('engineer', $q$select public.archived(s)::text from public.v_inquiry_state s where s.inquiry_id = 'b9141000-0000-4000-8000-0000000000a1'$q$), 'true', 'engineer: archived(v_inquiry_state)');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.v_order_state s where public.archived(s) and s.gross is not null$q$), '0',
  'engineer: no order total comes back with archived(v_order_state) (the totals stay NULL for an engineer)');
select is(pg_temp.as_('engineer', $q$select public.archived(i)::text from public.invoices i limit 1$q$), '<none>', 'engineer: archived(invoices row) gets no row (row security shows an engineer no invoice): no information');
select is(pg_temp.as_('engineer', $q$select public.is_archived('invoice', 'b9141000-0000-4000-8000-000000000031')::text$q$), '<null>', 'engineer: is_archived(invoice) gets NULL: no information');
select is(pg_temp.as_('engineer', $q$select public.is_archived('payment', 'b9141000-0000-4000-8000-000000000041')::text$q$), '<null>', 'engineer: is_archived(payment) gets NULL: no information');
select is(pg_temp.as_('engineer', $q$select public.is_archived('expense', 'b9141000-0000-4000-8000-000000000051')::text$q$), '<null>', 'engineer: is_archived(expense) gets NULL: no information');
select is(pg_temp.as_('engineer', $q$select public.archived(o)::text from public.orders o limit 1$q$), 'E:42501', 'engineer: archived(orders row) is refused (column grants); the lists use archived(v_order_state)');
select is(pg_temp.as_('engineer', $q$select public.archived(q)::text from public.quotations q limit 1$q$), 'E:42501', 'engineer: archived(quotations row) is refused (column grants)');
select is(pg_temp.as_('engineer', $q$select public.archived(po)::text from public.purchase_orders po limit 1$q$), 'E:42501', 'engineer: archived(purchase_orders row) is refused (column grants)');
select ok(has_table_privilege('qtech_engineer', 'public.archive_settings', 'select') and has_table_privilege('qtech_engineer', 'public.archive_unhidden', 'select'),
  'qtech_engineer reads both tables');
select ok(not has_table_privilege('qtech_engineer', 'public.archive_settings', 'update') and not has_table_privilege('qtech_engineer', 'public.archive_settings', 'insert')
          and not has_table_privilege('qtech_engineer', 'public.archive_unhidden', 'insert') and not has_table_privilege('qtech_engineer', 'public.archive_unhidden', 'delete'),
  'qtech_engineer writes neither table');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('archived', 'is_archived', 'archive_hides', 'archive_set', 'archive_unhide', 'archive_rehide',
                                                                          'archive_preview', 'archive_list')
             and (has_function_privilege('authenticated', p.oid, 'execute') <> has_function_privilege('qtech_engineer', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute'))), 0,
  'every archive function is granted to authenticated and qtech_engineer alike, and not to anon');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'archived'), 18,
  'archived() exists for 13 tables and 5 list views (18 overloads)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('archive_set', 'archive_unhide', 'archive_rehide', 'archive_preview', 'archive_list')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 5, 'the five RPCs are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('archive_set', 'archive_unhide', 'archive_rehide', 'archive_preview', 'archive_list')
             and p.prosrc like '%current_user_role()%42501%'), 5, 'and each raises 42501 for anyone who is not an admin');

select * from finish();
rollback;
