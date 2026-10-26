-- 0100_attachments_has_prices: files that show a price are closed to an engineer, in the table and in storage.
--   (a) structure: the column, its default, the two restrictive policies, the helper
--   (b) the table: an engineer gets 0 has_prices rows and cannot tag, change or remove one; admin and sales are unchanged
--   (c) storage: an engineer reaches no rfq-files object whose attachment is tagged; admin and sales reach all of them
--   (d) the helper answers by role
begin;
select * from no_plan();

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b1000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona. via_api = true is a PostgREST request (an engineer continues as qtech_engineer, 0081); false is a storage
-- request (role authenticated, no pre-request). Returns the first column of the first row as text: '<none>' for no row, '<null>' for NULL,
-- 'E:<sqlstate>' for an error. Always rolled back.
create function pg_temp.as_(persona text, stmt text, via_api boolean default true) returns text language plpgsql as $f$
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
    if via_api then
      perform qtech_private.pre_request();
    end if;
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
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Hp Customer');
insert into public.rfqs (id, company_id, owner_id) values (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, owner_id) values (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
-- a customer PO and a supplier quote on the RFQ (tagged), a site photo on the RFQ (not tagged), our quotation on the order (tagged)
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values
  (pg_temp.f('30'), 'rfq-files', 'hp/po.pdf', 'customer-po.pdf', 'application/pdf', 10, pg_temp.f('10'), true),
  (pg_temp.f('31'), 'rfq-files', 'hp/quote.pdf', 'supplier-quote.pdf', 'application/pdf', 10, pg_temp.f('10'), true),
  (pg_temp.f('32'), 'rfq-files', 'hp/site.jpg', 'site.jpg', 'image/jpeg', 10, pg_temp.f('10'), false);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices) values
  (pg_temp.f('33'), 'rfq-files', 'hp/sq.pdf', 'our-quotation.pdf', 'application/pdf', 10, pg_temp.f('20'), true),
  (pg_temp.f('34'), 'rfq-files', 'hp/engineer.jpg', 'engineer.jpg', 'image/jpeg', 10, pg_temp.f('20'), false);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values   -- explicitly untagged (0103: the default is now true; see its own test)
  (pg_temp.f('35'), 'rfq-files', 'hp/default.pdf', 'default.pdf', 'application/pdf', 10, pg_temp.f('10'), false);
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'hp/po.pdf'), ('rfq-files', 'hp/quote.pdf'), ('rfq-files', 'hp/site.jpg'), ('rfq-files', 'hp/sq.pdf'),
  ('rfq-files', 'hp/engineer.jpg'), ('rfq-files', 'hp/default.pdf'), ('rfq-files', 'hp/unlisted.pdf'),
  ('gst-receipts', 'hp/receipt.pdf');

-- ------------------------------------------------------------------ (a) structure
select is((select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'attachments' and column_name = 'has_prices'),
  'boolean|NO|true', 'attachments.has_prices is boolean, not null, default true (0103; 0100 had false)');
select is((select has_prices from public.attachments where id = pg_temp.f('35')), false, 'an attachment inserted untagged stays untagged');
select is((select p.polpermissive::text || '|' || p.polcmd::text from pg_policy p
           where p.polname = 'attachments_hide_priced_from_engineers' and p.polrelid = 'public.attachments'::regclass),
  'false|*', 'attachments_hide_priced_from_engineers is a restrictive policy for every command');
select ok((select 'authenticated'::regrole = any (p.polroles) and 'qtech_engineer'::regrole = any (p.polroles) from pg_policy p
           where p.polname = 'attachments_hide_priced_from_engineers' and p.polrelid = 'public.attachments'::regclass),
  'and it applies to authenticated and qtech_engineer');
select is((select p.polpermissive::text || '|' || p.polcmd::text from pg_policy p
           where p.polname = 'qtech_objects_hide_priced_from_engineers' and p.polrelid = 'storage.objects'::regclass),
  'false|*', 'qtech_objects_hide_priced_from_engineers is a restrictive policy on storage.objects');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.attachment_is_priced(text, text)'::regprocedure),
  'attachment_is_priced is SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.attachment_is_priced(text, text)', 'execute')
      and has_function_privilege('qtech_engineer', 'public.attachment_is_priced(text, text)', 'execute')
      and not has_function_privilege('anon', 'public.attachment_is_priced(text, text)', 'execute'),
  'attachment_is_priced runs for authenticated and qtech_engineer, never for anon');

-- ------------------------------------------------------------------ (b) the table
select is(pg_temp.as_('engineer', 'select count(*)::text from public.attachments where has_prices'), '0', 'an engineer gets 0 has_prices rows');
select is(pg_temp.as_('engineer', 'select count(*)::text from public.attachments where has_prices', false), '0',
  'and 0 when asked as plain authenticated (the role check is the person''s, not the API role)');
select is(pg_temp.as_('engineer', $q$select string_agg(file_name, ',' order by file_name) from public.attachments where path like 'hp/%'$q$),
  'default.pdf,engineer.jpg,site.jpg', 'an engineer reads the untagged files (site photos, their own, the default)');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.attachments where id in ('b1000000-0000-4000-8000-000000000030', 'b1000000-0000-4000-8000-000000000033')$q$),
  '0', 'an engineer cannot fetch the customer PO or our quotation by id');
select is(pg_temp.as_('engineer', $q$select count(*)::text from (select * from public.attachments where path like 'hp/%') x where x.has_prices$q$), '0',
  'select * hides the tagged rows too');
select is(pg_temp.as_('admin', $q$select count(*)::text from public.attachments where path like 'hp/%' and has_prices$q$), '3', 'the admin still reads every tagged row');
select is(pg_temp.as_('sales', $q$select count(*)::text from public.attachments where path like 'hp/%' and has_prices$q$), '3', 'so does sales');
select is(pg_temp.as_('sales', $q$select count(*)::text from public.attachments where path like 'hp/%'$q$), '6', 'sales reads all six files');
select is(pg_temp.as_('engineer', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id) values ('rfq-files', 'hp/new.jpg', 'new.jpg', 'image/jpeg', 10, 'b1000000-0000-4000-8000-000000000010') returning id::text$q$) not like 'E:%',
  true, 'an engineer can still attach a photo (untagged by default)');
select is(pg_temp.as_('engineer', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values ('rfq-files', 'hp/tagged.jpg', 'tagged.jpg', 'image/jpeg', 10, 'b1000000-0000-4000-8000-000000000010', true) returning has_prices::text$q$),
  'false', 'an engineer cannot tag an attachment (0103: the row is stored untagged)');
select is(pg_temp.as_('engineer', $q$update public.attachments set has_prices = true where id = 'b1000000-0000-4000-8000-000000000032' returning id::text$q$),
  'E:42501', 'nor tag an existing one');
select is(pg_temp.as_('engineer', $q$update public.attachments set file_name = 'x.pdf' where id = 'b1000000-0000-4000-8000-000000000030' returning id::text$q$),
  '<none>', 'nor change a tagged one (it is not there for them)');
select is(pg_temp.as_('engineer', $q$delete from public.attachments where id = 'b1000000-0000-4000-8000-000000000030' returning id::text$q$),
  '<none>', 'nor remove it');
select is(pg_temp.as_('sales', $q$update public.attachments set has_prices = false where id = 'b1000000-0000-4000-8000-000000000030' returning id::text$q$),
  'b1000000-0000-4000-8000-000000000030', 'sales may untag a file');
select is(pg_temp.as_('admin', $q$update public.attachments set has_prices = true where id = 'b1000000-0000-4000-8000-000000000032' returning id::text$q$),
  'b1000000-0000-4000-8000-000000000032', 'the admin may tag a file');
select is(pg_temp.as_('sales', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values ('rfq-files', 'hp/sales.pdf', 'sales.pdf', 'application/pdf', 10, 'b1000000-0000-4000-8000-000000000010', true) returning id::text$q$) not like 'E:%',
  true, 'sales may attach a tagged file');
select is(pg_temp.as_('deactivated', 'select count(*)::text from public.attachments'), '0', 'a deactivated person reads no attachment');

-- ------------------------------------------------------------------ (c) storage
select is(pg_temp.as_('engineer', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name like 'hp/%'$q$, false), '4',
  'an engineer lists four rfq-files objects: the untagged ones and a file with no attachment row');
select is(pg_temp.as_('engineer', $q$select string_agg(name, ',' order by name) from storage.objects where bucket_id = 'rfq-files' and name like 'hp/%'$q$, false),
  'hp/default.pdf,hp/engineer.jpg,hp/site.jpg,hp/unlisted.pdf', 'the tagged customer PO, supplier quote and our quotation are not among them');
select is(pg_temp.as_('engineer', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name = 'hp/po.pdf'$q$, false), '0',
  'the customer PO object is refused to an engineer');
select is(pg_temp.as_('engineer', $q$update storage.objects set name = name where bucket_id = 'rfq-files' and name = 'hp/quote.pdf' returning id::text$q$, false), '<none>',
  'an engineer cannot touch a tagged object (update finds none)');
select is(pg_temp.as_('engineer', $q$update storage.objects set name = name where bucket_id = 'rfq-files' and name = 'hp/site.jpg' returning name$q$, false), 'hp/site.jpg',
  'an engineer still reaches a site photo');
select is(pg_temp.as_('engineer', $q$insert into storage.objects (bucket_id, name) values ('rfq-files', 'hp/new-photo.jpg') returning name$q$, false), 'hp/new-photo.jpg',
  'an engineer can still upload a file to rfq-files');
select is(pg_temp.as_('admin', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name like 'hp/%'$q$, false), '7',
  'the admin lists all seven rfq-files objects');
select is(pg_temp.as_('sales', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name like 'hp/%'$q$, false), '7', 'so does sales');
select is(pg_temp.as_('sales', $q$select name from storage.objects where bucket_id = 'rfq-files' and name = 'hp/po.pdf'$q$, false), 'hp/po.pdf',
  'sales reaches the customer PO');
select is(pg_temp.as_('sales', $q$select name from storage.objects where bucket_id = 'gst-receipts' and name = 'hp/receipt.pdf'$q$, false), 'hp/receipt.pdf',
  'sales still reaches a GST receipt (other buckets unchanged)');
select is(pg_temp.as_('engineer', $q$select name from storage.objects where bucket_id = 'gst-receipts' and name = 'hp/receipt.pdf'$q$, false), '<none>',
  'an engineer still does not (0012)');

-- ------------------------------------------------------------------ (d) the helper
select is(pg_temp.as_('admin', $q$select public.attachment_is_priced('rfq-files', 'hp/po.pdf')::text$q$), 'true', 'a tagged path is priced');
select is(pg_temp.as_('admin', $q$select public.attachment_is_priced('rfq-files', 'hp/site.jpg')::text$q$), 'false', 'an untagged path is not');
select is(pg_temp.as_('admin', $q$select public.attachment_is_priced('rfq-files', 'hp/unlisted.pdf')::text$q$), 'false', 'a path with no attachment row is not');
select is(pg_temp.as_('engineer', $q$select public.attachment_is_priced('rfq-files', 'hp/po.pdf')::text$q$), 'true',
  'it answers an engineer even though they cannot read the row (definer)');
select is(pg_temp.as_('deactivated', $q$select public.attachment_is_priced('rfq-files', 'hp/po.pdf')::text$q$), '<null>', 'and answers a person without a role NULL');
select is(pg_temp.as_('deactivated', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files'$q$, false), '0', 'a deactivated person lists no file');

select * from finish();
rollback;
