begin;
select plan(52);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

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
select columns_are('public', 'attachments',
  array['id', 'created_at', 'created_by', 'bucket', 'path', 'file_name', 'mime_type', 'size_bytes', 'rfq_id',
        'clarification_id', 'invoice_id', 'expense_id'],
  'attachments has the section 2.20 columns (A6: expense_id)');
select ok((select relrowsecurity from pg_class where oid = 'public.attachments'::regclass),
  'RLS is enabled on attachments');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'attachments'),
  array['attachments_delete_by_parent', 'attachments_insert_by_parent', 'attachments_select_by_parent',
        'attachments_update_by_parent'],
  'attachments policies');
select ok(not (has_table_privilege('anon', 'public.attachments', 'SELECT')
            or has_table_privilege('anon', 'public.attachments', 'INSERT')
            or has_table_privilege('anon', 'public.attachments', 'UPDATE')
            or has_table_privilege('anon', 'public.attachments', 'DELETE')),
  'anon has no privileges on attachments');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.attachments'::regclass and contype = 'f'
                    and confrelid = 'public.clarifications'::regclass and confdeltype = 'n'),
  'attachments.clarification_id is SET NULL');

-- buckets and storage policies
select is((select array_agg(id::text order by id) from storage.buckets where id in ('rfq-files', 'gst-receipts')),
  array['gst-receipts', 'rfq-files'], 'both buckets exist');
select is((select count(*)::int from storage.buckets
           where id in ('rfq-files', 'gst-receipts') and public = false and file_size_limit = 5242880), 2,
  'both buckets are private with a 5 MB file size limit');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'qtech\_%'),
  array['qtech_objects_delete', 'qtech_objects_insert', 'qtech_objects_select', 'qtech_objects_update'],
  'storage.objects has the four Q-Tech policies');

-- ------------------------------------------------------------------ fixtures (as owner)
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.clarifications (id, rfq_id, question) values
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Voltage?');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'INV-1', 100, 18);

-- ------------------------------------------------------------------ table constraints
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id)
                  values ('e0000000-0000-4000-8000-000000000001', 'rfq-files', 'rfq1/a.jpg', 'a.jpg', 'image/jpeg',
                          1000, 'd0000000-0000-4000-8000-000000000001')$$,
  'an RFQ attachment is accepted');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id,
                                                  clarification_id)
                  values ('e0000000-0000-4000-8000-000000000002', 'rfq-files', 'rfq1/b.jpg', 'b.jpg', 'image/jpeg',
                          5242880, 'd0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001')$$,
  'a clarification attachment of exactly 5 MB is accepted');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id)
                  values ('e0000000-0000-4000-8000-000000000003', 'gst-receipts', 'inv1/a.pdf', 'a.pdf',
                          'application/pdf', 1000, 'b1000000-0000-4000-8000-000000000001')$$,
  'an invoice attachment is accepted');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('rfq-files', 'rfq1/big.jpg', 'big.jpg', 'image/jpeg', 5242881,
                           'd0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a file over 5 MB is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes)
                   values ('rfq-files', 'none/a.jpg', 'a.jpg', 'image/jpeg', 1)$$,
  '23514', null, 'an attachment with no parent is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, invoice_id)
                   values ('rfq-files', 'both/a.jpg', 'a.jpg', 'image/jpeg', 1,
                           'd0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an attachment with two parents is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id,
                                                   clarification_id)
                   values ('gst-receipts', 'inv1/c.pdf', 'c.pdf', 'application/pdf', 1,
                           'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a clarification attachment needs an RFQ parent');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('gst-receipts', 'rfq1/c.jpg', 'c.jpg', 'image/jpeg', 1,
                           'd0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an RFQ attachment cannot live in the gst-receipts bucket');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id)
                   values ('rfq-files', 'inv1/c.pdf', 'c.pdf', 'application/pdf', 1,
                           'b1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an invoice attachment cannot live in the rfq-files bucket');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('other', 'rfq1/c.jpg', 'c.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an unknown bucket is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('rfq-files', 'rfq1/a.jpg', 'a2.jpg', 'image/jpeg', 1,
                           'd0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a (bucket, path) pair is unique');
select lives_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                  values ('rfq-files', 'rfq2/a.jpg', 'a.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000002')$$,
  'the same file name under another path is accepted');
select throws_ok($$insert into public.attachments (bucket, path, mime_type, size_bytes, rfq_id)
                   values ('rfq-files', 'rfq2/z.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000002')$$,
  '23502', null, 'file_name is required');

delete from public.clarifications where id = 'b0000000-0000-4000-8000-000000000001';
select ok((select clarification_id is null and rfq_id is not null from public.attachments
           where id = 'e0000000-0000-4000-8000-000000000002'),
  'deleting a clarification keeps the attachment on its RFQ');
delete from public.rfqs where id = 'd0000000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.attachments where path = 'rfq2/a.jpg'), 0,
  'deleting an RFQ cascades to its attachments');

-- storage objects inserted as owner so that role checks below have something to read
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'rfq1/a.jpg'),
  ('gst-receipts', 'inv1/a.pdf');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments), 3, 'sales reads RFQ and invoice attachments');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id)
                  values ('e0000000-0000-4000-8000-0000000000a2', 'gst-receipts', 'inv1/s.pdf', 's.pdf',
                          'application/pdf', 1, 'b1000000-0000-4000-8000-000000000001')$$,
  'sales attaches a receipt to an invoice');
select is(public.t_rows($q$update public.attachments set file_name = 'renamed.pdf'
                           where id = 'e0000000-0000-4000-8000-0000000000a2'$q$), 1, 'sales updates an attachment');
select is(public.t_rows($q$delete from public.attachments where id = 'e0000000-0000-4000-8000-0000000000a2'$q$), 1,
  'sales deletes an invoice attachment');
select is((select count(*)::int from storage.objects where bucket_id = 'rfq-files' and name = 'rfq1/a.jpg'), 1,
  'sales reads rfq-files objects');
select is((select count(*)::int from storage.objects where bucket_id = 'gst-receipts' and name = 'inv1/a.pdf'), 1,
  'sales reads gst-receipts objects');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('gst-receipts', 'inv1/sales.pdf')$$,
  'sales uploads to gst-receipts');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments), 2, 'engineer reads only RFQ and clarification attachments');
select is((select count(*)::int from public.attachments where invoice_id is not null), 0,
  'engineer cannot read invoice attachments');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id)
                  values ('e0000000-0000-4000-8000-0000000000b3', 'rfq-files', 'rfq1/e.jpg', 'e.jpg', 'image/jpeg', 1,
                          'd0000000-0000-4000-8000-000000000001')$$,
  'engineer attaches a photo to an RFQ');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id)
                   values ('gst-receipts', 'inv1/e.pdf', 'e.pdf', 'application/pdf', 1,
                           'b1000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'engineer cannot attach to an invoice');
select is(public.t_rows($q$delete from public.attachments where invoice_id is not null$q$), 0,
  'engineer cannot delete invoice attachments');
select is(public.t_rows($q$delete from public.attachments where id = 'e0000000-0000-4000-8000-0000000000b3'$q$), 1,
  'engineer deletes an RFQ attachment');
select is((select count(*)::int from storage.objects where bucket_id = 'rfq-files' and name = 'rfq1/a.jpg'), 1,
  'engineer reads rfq-files objects');
select is((select count(*)::int from storage.objects where bucket_id = 'gst-receipts'), 0,
  'engineer cannot read the gst-receipts bucket');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('rfq-files', 'rfq1/eng.jpg')$$,
  'engineer uploads to rfq-files');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('gst-receipts', 'inv1/eng.pdf')$$,
  '42501', null, 'engineer cannot upload to gst-receipts');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('somewhere-else', 'x.jpg')$$,
  '42501', null, 'uploads to any other bucket are denied');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments), 0, 'deactivated user sees no attachments');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('rfq-files', 'rfq1/d.jpg', 'd.jpg', 'image/jpeg', 1,
                           'd0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'deactivated user cannot attach');
select is((select count(*)::int from storage.objects where bucket_id in ('rfq-files', 'gst-receipts')), 0,
  'deactivated user sees no storage objects');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('rfq-files', 'rfq1/d.jpg')$$,
  '42501', null, 'deactivated user cannot upload');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments), 3, 'admin reads all attachments');
select is((select count(*)::int from storage.objects where bucket_id = 'gst-receipts'), 2,
  'admin reads gst-receipts objects');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('gst-receipts', 'inv1/admin.pdf')$$,
  'admin uploads to gst-receipts');
select is(public.t_rows($q$delete from public.attachments where invoice_id is not null$q$), 1,
  'admin deletes an invoice attachment');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.attachments$$, '42501', null, 'anon cannot read attachments');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('rfq-files', 'rfq1/anon.jpg', 'a.jpg', 'image/jpeg', 1,
                           'd0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot attach');
select ok(not has_function_privilege('anon', 'public.can_access_bucket(text)', 'execute'),
  'anon cannot call can_access_bucket');
reset role;

select * from finish();
rollback;
