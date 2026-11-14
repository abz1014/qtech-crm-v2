-- 0139_search_po_money: search_all gives a supplier PO number to admin and sales only; an engineer's search of a PO number finds nothing.
begin;
select * from no_plan();

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

-- ------------------------------------------------------------------ fixtures (synthetic)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000013901', '0139 Customer'),
  ('c0000000-0000-4000-8000-000000013902', '0139 Supplier');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000013901', 'c0000000-0000-4000-8000-000000013901', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000013901', 'a1000000-0000-4000-8000-000000013901', 'c0000000-0000-4000-8000-000000013902', 'USD');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  ('a3000000-0000-4000-8000-000000013901', 'a2000000-0000-4000-8000-000000013901', 913901, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
create temp table fx as select 'ORD-' || number::text as ord from public.orders where id = 'a1000000-0000-4000-8000-000000013901';
grant select on fx to public;

-- ------------------------------------------------------------------ a supplier PO number
select is(pg_temp.as_('admin', $q$select order_id::text from public.search_all('PO-913901', 8) where kind = 'po'$q$), 'a1000000-0000-4000-8000-000000013901', 'admin finds the supplier PO by its number');
select is(pg_temp.as_('sales', $q$select order_id::text from public.search_all('PO-913901', 8) where kind = 'po'$q$), 'a1000000-0000-4000-8000-000000013901', 'sales find it too');
select is(pg_temp.as_('sales', $q$select label from public.search_all('PO-' || to_char(public.today_pkt(), 'YY') || '-913901', 8) where kind = 'po'$q$),
  'PO-' || to_char(public.today_pkt(), 'YY') || '-913901 0139 Supplier', 'sales find it by PO-YY-NNNN, labelled with the supplier');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.search_all('PO-913901', 8) where kind = 'po'$q$), '0', 'an engineer finds no supplier PO by its number');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.search_all('PO-' || to_char(public.today_pkt(), 'YY') || '-913901', 8)$q$), '0', 'nor by PO-YY-NNNN, in any kind, and with no error');

-- ------------------------------------------------------------------ the rest of the engineer's search is as before
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.search_all('0139 Customer', 8) where kind = 'company'$q$), '1', 'the engineer still finds a company');
select is(pg_temp.as_('engineer', format($q$select count(*)::text from public.search_all(%L, 8) where kind = 'order'$q$, (select ord from fx))), '1', 'and an order by its number');
select ok((select p.prosrc like '%x.money_ok and x.ponum is not null%' from pg_proc p where p.oid = 'public.search_all(text, integer)'::regprocedure),
  'the po part of search_all is gated on money_ok');
select ok(not has_function_privilege('anon', 'public.search_all(text, integer)', 'execute') and has_function_privilege('authenticated', 'public.search_all(text, integer)', 'execute'),
  'grants are unchanged');

select * from finish();
rollback;
