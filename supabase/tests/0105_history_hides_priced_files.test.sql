begin;
select * from no_plan();

-- 0105: an engineer's record_history answer names no has_prices file (the attachment's audit event is dropped for them);
-- admin and sales still see it, and an untagged file (a site photo) stays for everyone. Fictional fixtures only.

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f5000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.hist(persona text, tbl text, id uuid) returns text language plpgsql as $f$
declare
  v text;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute format('select public.record_history(%L, %L, null, 200)::text', tbl, id) into v;
    raise exception 'done' using errcode = 'P0999', detail = coalesce(v, '<null>');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'error ' || sqlstate;
  end;
end;
$f$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Pf Traders');
insert into public.rfqs (id, company_id, owner_id) values (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values
  (pg_temp.f('30'), 'rfq-files', 'pf/customer-po.pdf', 'Pf customer PO.pdf', 'application/pdf', 10, pg_temp.f('10'), true),
  (pg_temp.f('31'), 'rfq-files', 'pf/nameplate.jpg', 'Pf nameplate.jpg', 'image/jpeg', 10, pg_temp.f('10'), false);

create temp table h_adm as select pg_temp.hist('admin', 'rfqs', pg_temp.f('10')) as t;
create temp table h_sal as select pg_temp.hist('sales', 'rfqs', pg_temp.f('10')) as t;
create temp table h_eng as select pg_temp.hist('engineer', 'rfqs', pg_temp.f('10')) as t;
grant all on h_adm, h_sal, h_eng to public;

select ok((select t not like 'error%' from h_eng), 'the engineer still reads the history of an RFQ');
select ok((select t like '%Pf customer PO.pdf%' from h_adm), 'admin sees the priced file in the history');
select ok((select t like '%Pf customer PO.pdf%' from h_sal), 'sales see it too');
select ok((select t not like '%Pf customer PO.pdf%' from h_eng), 'the engineer does NOT: the priced file is not named in their history');
select ok((select t like '%Pf nameplate.jpg%' from h_eng), 'but an untagged site photo stays in their history');

select * from finish();
rollback;
