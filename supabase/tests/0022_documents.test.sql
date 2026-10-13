begin;
select plan(46);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'quotations',
  array['id', 'created_at', 'created_by', 'rfq_id', 'number', 'revision', 'issued_on', 'valid_until', 'contact_id',
        'lines', 'net_total', 'gst_total', 'delivery_text', 'payment_terms', 'notes', 'signatory_id', 'pdf_path'],
  'quotations has the section 2.25 columns');
select columns_are('public', 'purchase_orders',
  array['id', 'created_at', 'created_by', 'supplier_order_id', 'number', 'revision', 'issued_on', 'currency', 'lines',
        'total', 'incoterm', 'delivery_terms', 'payment_terms', 'ship_to', 'notes', 'signatory_id', 'pdf_path'],
  'purchase_orders has the section 2.26 columns');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.quotations'::regclass, 'public.purchase_orders'::regclass)), 'RLS is enabled on both');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'quotations'),
  array['quotations_delete_admin', 'quotations_insert_staff', 'quotations_select_staff', 'quotations_update_staff'],
  'quotations policies');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'purchase_orders'),
  array['purchase_orders_delete_admin', 'purchase_orders_insert_staff', 'purchase_orders_select_staff',
        'purchase_orders_update_staff'],
  'purchase_orders policies');
select ok(not (has_table_privilege('anon', 'public.quotations', 'SELECT')
            or has_table_privilege('anon', 'public.purchase_orders', 'SELECT')),
  'anon has no privileges on either table');
select is((select count(*)::int from pg_trigger t
           where t.tgfoid = 'public.audit_row_change()'::regprocedure and not t.tgisinternal
             and t.tgrelid in ('public.quotations'::regclass, 'public.purchase_orders'::regclass)), 2,
  'both tables carry the audit trigger');
select is((select count(*)::int from pg_class where relkind = 'S' and relnamespace = 'public'::regnamespace
           and relname in ('quotation_number_seq', 'po_number_seq')), 2, 'both number sequences exist');
select is((select count(*)::int from storage.buckets
           where id = 'generated-docs' and public = false and file_size_limit = 5242880), 1,
  'generated-docs is a private bucket with a 5 MB limit');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'qtech\_%'),
  array['qtech_objects_delete', 'qtech_objects_insert', 'qtech_objects_select', 'qtech_objects_update'],
  'storage.objects still has the four Q-Tech policies');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'USD');

-- ------------------------------------------------------------------ quotations: totals, constraints
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines, net_total, gst_total) values
  ('51000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1, 0, '2030-01-01',
   '[{"description":"A","qty":2,"unit_price_net":100,"gst_rate":18},
     {"description":"B","qty":3,"unit_price_net":33.33,"gst_rate":18}]'::jsonb, 1, 1);
select ok((select net_total = 299.99 and gst_total = 54 from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'totals are calculated from the lines; the 1 and 1 sent by the client are ignored');
select ok((select issued_on = public.today_pkt() and signatory_id = 'a0000000-0000-4000-8000-000000000001' and revision = 0
           from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'issued_on defaults to today and the signatory to the caller');
select throws_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                   values ('d0000000-0000-4000-8000-000000000001', 2, 0, '2030-01-01', '[]'::jsonb)$$,
  '23514', null, 'an empty lines array is rejected');
select throws_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                   values ('d0000000-0000-4000-8000-000000000001', 2, 0, '2030-01-01', '{"a":1}'::jsonb)$$,
  '23514', null, 'lines must be an array');
select throws_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                   values ('d0000000-0000-4000-8000-000000000001', 1, 0, '2030-01-01',
                           '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb)$$,
  '23505', null, 'UNIQUE(number, revision)');
select throws_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                   values ('d0000000-0000-4000-8000-000000000001', 9, 0, '2030-01-01',
                           '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb)$$,
  '23505', null, 'UNIQUE(rfq_id, revision)');
select throws_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                   values ('d0000000-0000-4000-8000-000000000001', 9, -1, '2030-01-01',
                           '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb)$$,
  '23514', null, 'revision cannot be negative');

-- ------------------------------------------------------------------ quotations: the lock
select throws_ok($$update public.quotations set notes = 'x' where id = '51000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'an issued quotation cannot be edited');
select throws_ok($$update public.quotations set net_total = 5 where id = '51000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'nor can its totals');
select throws_ok($$update public.quotations set lines = '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb
                   where id = '51000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'nor its lines');
select lives_ok($$update public.quotations set pdf_path = 'q/1.pdf' where id = '51000000-0000-4000-8000-000000000001'$$,
  'pdf_path can be set');
select lives_ok($$update public.quotations set pdf_path = null where id = '51000000-0000-4000-8000-000000000001'$$,
  'and cleared, which means "generate the PDF again"');
select throws_ok($$delete from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'an issued quotation blocks deletion of its RFQ');

-- ------------------------------------------------------------------ purchase_orders: totals, constraints, lock
insert into public.order_items (id, order_id, description, unit_price_net, supplier_order_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'item', 1,
   'a2000000-0000-4000-8000-000000000001');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, lines, total) values
  ('52000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 1, 0, 'USD',
   '[{"order_item_id":"a3000000-0000-4000-8000-000000000001","qty":2,"unit_price":12.5,"price_source":"typed"},
     {"order_item_id":"a3000000-0000-4000-8000-000000000001","qty":1,"unit_price":3.3333,"price_source":"typed"}]'::jsonb,
   999);
select is((select total from public.purchase_orders where id = '52000000-0000-4000-8000-000000000001'), 28.33::numeric,
  'the PO total is calculated from the lines; the 999 sent by the client is ignored');
select throws_ok($$insert into public.purchase_orders (supplier_order_id, number, revision, currency, lines, total)
                   values ('a2000000-0000-4000-8000-000000000001', 2, 0, 'usd', '[{"qty":1,"unit_price":1}]'::jsonb, 0)$$,
  '23514', null, 'the currency must be 3 capitals');
select throws_ok($$insert into public.purchase_orders (supplier_order_id, number, revision, currency, lines, total)
                   values ('a2000000-0000-4000-8000-000000000001', 2, 0, 'USD', '[]'::jsonb, 0)$$,
  '23514', null, 'a PO with no lines is rejected');
select throws_ok($$insert into public.purchase_orders (supplier_order_id, number, revision, currency, lines, total)
                   values ('a2000000-0000-4000-8000-000000000001', 1, 0, 'USD', '[{"qty":1,"unit_price":1}]'::jsonb, 0)$$,
  '23505', null, 'UNIQUE(number, revision) on POs');
select throws_ok($$update public.purchase_orders set currency = 'EUR' where id = '52000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'the frozen currency cannot change');
select throws_ok($$update public.purchase_orders set incoterm = 'FOB' where id = '52000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'an issued PO cannot be edited');
select lives_ok($$update public.purchase_orders set pdf_path = 'p/1.pdf' where id = '52000000-0000-4000-8000-000000000001'$$,
  'but pdf_path can be set');
select throws_ok($$delete from public.supplier_orders where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'an issued PO blocks deletion of its leg');

-- ------------------------------------------------------------------ sales and engineers (SIU), deactivated, admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.quotations) + (select count(*)::int from public.purchase_orders), 2,
  'sales can read documents');
select lives_ok($$insert into public.quotations (rfq_id, number, revision, valid_until, lines)
                  values ('d0000000-0000-4000-8000-000000000001', 2, 1, '2030-01-01',
                          '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb)$$, 'sales can insert');
select is(public.t_rows($q$update public.quotations set pdf_path = 'q/2.pdf' where number = 2$q$), 1,
  'sales can attach a PDF');
select throws_ok($$update public.quotations set notes = 'x' where number = 2$$, '55000', null, 'but not change anything else');
select is(public.t_rows($q$delete from public.quotations where number = 2$q$), 0, 'sales cannot delete documents');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('generated-docs', 'q/sales.pdf')$$,
  'sales can upload to generated-docs');
select ok((select qual like '%generated-docs%' and qual like '%admin%' from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname = 'qtech_objects_delete'),
  'deleting from generated-docs is admin only (storage forbids direct deletes, so the policy text is checked)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.purchase_orders), 1, 'an engineer can read POs');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('generated-docs', 'p/eng.pdf')$$,
  'an engineer can upload to generated-docs');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.quotations), 0, 'a deactivated user sees no quotations');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('generated-docs', 'x.pdf')$$,
  '42501', null, 'and cannot upload');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.t_rows($q$delete from public.quotations where number = 2$q$), 1, 'admin can delete a quotation');
select is((select count(*)::int from storage.objects where bucket_id = 'generated-docs'), 2,
  'admin sees what staff uploaded to generated-docs');

reset role;
set local role anon;
select throws_ok($$select * from public.quotations$$, '42501', null, 'anon cannot read quotations');
select throws_ok($$select * from public.purchase_orders$$, '42501', null, 'anon cannot read purchase_orders');
reset role;

select * from finish();
rollback;
