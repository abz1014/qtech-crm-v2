-- 0103_attachments_priced_by_default: a file whose tag is forgotten is hidden from engineers; an engineer's own uploads stay theirs.
begin;
select * from no_plan();

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b3000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona (PostgREST path). '<none>' for no row, 'E:<sqlstate>' for an error. Always rolled back.
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
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
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

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Default Customer');
insert into public.rfqs (id, company_id, owner_id) values (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');

select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'attachments' and column_name = 'has_prices'),
  'true', 'the has_prices default is true');
select ok(exists (select 1 from pg_trigger where tgname = 'attachments_engineer_untagged' and tgrelid = 'public.attachments'::regclass and not tgisinternal),
  'the engineer-untagged trigger exists');

-- the service role / table owner and sales insert without saying: the row is tagged
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values
  (pg_temp.f('30'), 'rfq-files', 'df/owner.pdf', 'owner.pdf', 'application/pdf', 10, pg_temp.f('10'));
select is((select has_prices from public.attachments where id = pg_temp.f('30')), true, 'an insert that does not say is tagged');
select is(pg_temp.as_('sales', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id) values ('rfq-files', 'df/sales.pdf', 'sales.pdf', 'application/pdf', 10, 'b3000000-0000-4000-8000-000000000010') returning has_prices::text$q$),
  'true', 'sales inserting without a tag gets true');
select is(pg_temp.as_('sales', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values ('rfq-files', 'df/photo.jpg', 'photo.jpg', 'image/jpeg', 10, 'b3000000-0000-4000-8000-000000000010', false) returning has_prices::text$q$),
  'false', 'sales may still write false');

-- an engineer's own upload is stored untagged, whether or not they say, and they can read it back
select is(pg_temp.as_('engineer', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id) values ('rfq-files', 'df/eng.jpg', 'eng.jpg', 'image/jpeg', 10, 'b3000000-0000-4000-8000-000000000010') returning has_prices::text$q$),
  'false', 'an engineer inserting without a tag is stored untagged');
select is(pg_temp.as_('engineer', $q$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values ('rfq-files', 'df/eng2.jpg', 'eng2.jpg', 'image/jpeg', 10, 'b3000000-0000-4000-8000-000000000010', true) returning has_prices::text$q$),
  'false', 'and an engineer writing true is stored untagged too (they cannot tag)');

-- and the engineer cannot see what was not tagged by the app
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.attachments where path in ('df/owner.pdf', 'df/sales.pdf')$q$), '0',
  'an engineer reads neither the untagged-by-the-app owner insert nor the sales insert');

select * from finish();
rollback;
