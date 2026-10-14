begin;
select plan(20);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- ------------------------------------------------------------------ coverage
select is((select data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'audit_log' and column_name = 'record_id'),
  'text', 'audit_log.record_id is text so composite keys fit');

-- Every business table carries the trigger. users (written only by the admin-users function)
-- and audit_log itself are the only exceptions; a table added later without a trigger fails here.
select is((select coalesce(array_agg(c.relname::text order by c.relname), '{}')
           from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
             and c.relname not in ('users', 'audit_log')
             and not exists (select 1 from pg_trigger t
                             where t.tgrelid = c.oid and not t.tgisinternal
                               and t.tgfoid = 'public.audit_row_change()'::regprocedure)),
  '{}'::text[], 'every business table has an audit trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where t.tgfoid = 'public.audit_row_change()'::regprocedure and not t.tgisinternal
             and c.relnamespace = 'public'::regnamespace),
  28, 'the audit trigger is attached to 28 tables');
select ok((select bool_and(t.tgtype & 1 = 1 and t.tgtype & 2 = 0) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where t.tgfoid = 'public.audit_row_change()'::regprocedure and not t.tgisinternal
             and c.relnamespace = 'public'::regnamespace),
  'the audit triggers are AFTER ... FOR EACH ROW');

-- ------------------------------------------------------------------ behaviour as the admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Audited Co');
update public.companies set country = 'PK' where id = 'c0000000-0000-4000-8000-000000000001';
select is((select array_agg(action order by action) from public.audit_log
           where table_name = 'companies' and record_id = 'c0000000-0000-4000-8000-000000000001'),
  array['insert', 'update'], 'insert and update each write one audit row');
select is((select count(*)::int from public.audit_log
           where table_name = 'companies' and record_id = 'c0000000-0000-4000-8000-000000000001'
             and changed_by = 'a0000000-0000-4000-8000-000000000001'), 2,
  'changed_by is the caller');
select ok((select old_value ->> 'country' is null and new_value ->> 'country' = 'PK'
           from public.audit_log where table_name = 'companies' and action = 'update'),
  'update records old and new values');
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000002', 'Supplier Co');
insert into public.company_sites (id, company_id, name)
  values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'Site');
delete from public.companies where id = 'c0000000-0000-4000-8000-000000000002';
select is((select array_agg(action order by action) from public.audit_log
           where table_name = 'companies' and record_id = 'c0000000-0000-4000-8000-000000000002'),
  array['delete', 'insert'], 'delete writes one audit row');
select is((select array_agg(action order by action) from public.audit_log
           where table_name = 'company_sites' and record_id = 'c1000000-0000-4000-8000-000000000001'),
  array['delete', 'insert'], 'a cascaded delete is audited too');

-- Tables keyed by one non-id column.
insert into public.orders (id, company_id, owner_id)
  values ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000002');
insert into public.order_costs (order_id, expected_cost_pkr)
  values ('a1000000-0000-4000-8000-000000000001', 100);
update public.order_costs set expected_cost_pkr = 200 where order_id = 'a1000000-0000-4000-8000-000000000001';
delete from public.order_costs where order_id = 'a1000000-0000-4000-8000-000000000001';
select is((select array_agg(action order by action) from public.audit_log
           where table_name = 'order_costs' and record_id = 'a1000000-0000-4000-8000-000000000001'),
  array['delete', 'insert', 'update'], 'order_costs is audited by its order_id');

-- Composite keys.
insert into public.brands (id, name) values ('c3000000-0000-4000-8000-000000000001', 'Belimo');
insert into public.company_brands (company_id, brand_id)
  values ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001');
select is((select record_id from public.audit_log where table_name = 'company_brands' and action = 'insert'),
  jsonb_build_object('company_id', 'c0000000-0000-4000-8000-000000000001',
                     'brand_id', 'c3000000-0000-4000-8000-000000000001')::text,
  'company_brands record_id is a JSON object of its key columns');
delete from public.company_brands;
select is((select count(*)::int from public.audit_log
           where table_name = 'company_brands'
             and record_id = jsonb_build_object('company_id', 'c0000000-0000-4000-8000-000000000001',
                                                'brand_id', 'c3000000-0000-4000-8000-000000000001')::text), 2,
  'the same composite key text is produced for insert and delete');
insert into public.order_engineers (order_id, user_id)
  values ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
select is((select record_id from public.audit_log where table_name = 'order_engineers' and action = 'insert'),
  jsonb_build_object('order_id', 'a1000000-0000-4000-8000-000000000001',
                     'user_id', 'a0000000-0000-4000-8000-000000000003')::text,
  'order_engineers record_id is a JSON object of its key columns');

-- Brand auto-learn rows are audited as well.
insert into public.rfqs (id, company_id, owner_id)
  values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description, brand_id)
  values ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Item',
          'c3000000-0000-4000-8000-000000000001');
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000003', 'Quoting Supplier');
insert into public.supplier_inquiries (id, rfq_id, supplier_id)
  values ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000003');
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
  values ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 5, 'USD');
select is((select count(*)::int from public.audit_log
           where table_name = 'company_brands' and action = 'insert'
             and record_id = jsonb_build_object('company_id', 'c0000000-0000-4000-8000-000000000003',
                                                'brand_id', 'c3000000-0000-4000-8000-000000000001')::text), 1,
  'the auto-learnt company_brands row is audited');

-- Money and the remaining tables.
insert into public.invoices (id, order_id, number, net_amount, gst_amount)
  values ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'INV-1', 100, 18);
insert into public.payments_in (id, order_id, amount)
  values ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 50);
insert into public.expenses (id, amount_pkr, category_id)
  values ('b4000000-0000-4000-8000-000000000001', 5, 'ca7e0000-0000-4000-8000-000000000012');
insert into public.targets (id, user_id, year, quarter, target_net_pkr)
  values ('f1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 2026, 4, 1000);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id)
  values ('e1000000-0000-4000-8000-000000000001', 'rfq-files', 'r/a.jpg', 'a.jpg', 'image/jpeg', 1,
          'd0000000-0000-4000-8000-000000000001');
select is((select array_agg(table_name::text order by table_name) from public.audit_log
           where action = 'insert' and table_name in ('invoices', 'payments_in', 'expenses', 'targets', 'attachments')),
  array['attachments', 'expenses', 'invoices', 'payments_in', 'targets'],
  'money, targets and attachments inserts are audited');
select is((select record_id from public.audit_log where table_name = 'payments_in'),
  'b2000000-0000-4000-8000-000000000001', 'record_id is the id for tables that have one');

-- ------------------------------------------------------------------ a non-admin writer is audited, and cannot read the log
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-0000000000a2', 'Sales Co');
select is((select count(*)::int from public.audit_log), 0, 'sales cannot read the audit log');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-0000000000a3', 'Engineer Co');
select is((select count(*)::int from public.audit_log), 0, 'engineer cannot read the audit log');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select changed_by from public.audit_log
           where table_name = 'companies' and record_id = 'c0000000-0000-4000-8000-0000000000a2'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'a sales write is attributed to sales');
select is((select changed_by from public.audit_log
           where table_name = 'companies' and record_id = 'c0000000-0000-4000-8000-0000000000a3'),
  'a0000000-0000-4000-8000-000000000003'::uuid, 'an engineer write is attributed to the engineer');
reset role;

select * from finish();
rollback;
