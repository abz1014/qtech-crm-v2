-- 0134_customer_po_files: the customer's PO document on an order is closed to an engineer, in the table and in storage.
begin;
select * from no_plan();

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b4000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona. via_api = true is a PostgREST request (an engineer continues as qtech_engineer); false is a storage request.
-- '<none>' for no row, '<null>' for NULL, 'E:<sqlstate>' for an error. Always rolled back.
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
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
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

-- fixtures (as the table owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Po File Customer');
insert into public.rfqs (id, company_id, owner_id) values (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, owner_id) values (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices, is_customer_po) values
  (pg_temp.f('30'), 'rfq-files', 'pf/po.pdf', 'customer-po.pdf', 'application/pdf', 10, pg_temp.f('20'), true, true);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices) values
  (pg_temp.f('31'), 'rfq-files', 'pf/site.jpg', 'site.jpg', 'image/jpeg', 10, pg_temp.f('20'), false);
insert into storage.objects (bucket_id, name) values ('rfq-files', 'pf/po.pdf'), ('rfq-files', 'pf/site.jpg');

-- structure
select is((select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'attachments' and column_name = 'is_customer_po'),
  'boolean|NO|false', 'attachments.is_customer_po is boolean, not null, default false');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'attachments_customer_po_idx'
                    and indexdef like '%WHERE is_customer_po%'), 'the partial index on order_id exists');

-- the check refuses a PO file without prices, or without an order
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id, has_prices, is_customer_po)
  values ('rfq-files', 'pf/bad.pdf', 'bad.pdf', 'application/pdf', 10, 'b4000000-0000-4000-8000-000000000020', false, true)$$,
  '23514', null, 'a PO file without has_prices is refused');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices, is_customer_po)
  values ('rfq-files', 'pf/bad2.pdf', 'bad2.pdf', 'application/pdf', 10, 'b4000000-0000-4000-8000-000000000010', true, true)$$,
  '23514', null, 'a PO file on an RFQ (no order) is refused');
select throws_ok($$update public.attachments set has_prices = false where id = 'b4000000-0000-4000-8000-000000000030'$$,
  '23514', null, 'a PO file cannot be untagged');

-- sales inserts and sees it
select is(pg_temp.as_('sales', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id, has_prices, is_customer_po) values ('rfq-files', 'pf/po2.jpg', 'po2.jpg', 'image/jpeg', 10, 'b4000000-0000-4000-8000-000000000020', true, true) returning is_customer_po::text$q$),
  'true', 'sales attaches a PO file, an image included');
select is(pg_temp.as_('sales', $q$select count(*)::text from public.attachments where is_customer_po$q$), '1', 'sales reads the PO file');
select is(pg_temp.as_('admin', $q$select count(*)::text from public.attachments where is_customer_po$q$), '1', 'so does the admin');

-- an engineer cannot see the row, the object, or make one
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.attachments where is_customer_po$q$), '0', 'an engineer reads no PO file row');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.attachments where order_id = 'b4000000-0000-4000-8000-000000000020'$q$), '1',
  'on the same order the engineer reads only the site photo');
select is(pg_temp.as_('engineer', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name = 'pf/po.pdf'$q$, false), '0',
  'an engineer reaches no PO file object');
select is(pg_temp.as_('sales', $q$select count(*)::text from storage.objects where bucket_id = 'rfq-files' and name = 'pf/po.pdf'$q$, false), '1',
  'sales reaches the PO file object');
select is(pg_temp.as_('engineer', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id, has_prices, is_customer_po) values ('rfq-files', 'pf/eng.pdf', 'eng.pdf', 'application/pdf', 10, 'b4000000-0000-4000-8000-000000000020', true, true) returning id::text$q$),
  'E:23514', 'an engineer cannot make a PO file (stored untagged, so the check refuses it)');

select * from finish();
rollback;
