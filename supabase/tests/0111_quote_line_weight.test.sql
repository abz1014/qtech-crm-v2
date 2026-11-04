-- 0111_quote_line_weight: weight and unit on a supplier quote line. Admin and sales read, add and change them; an engineer neither reads
-- nor writes them (nor the price), so the comparative statement is closed to an engineer in the database itself.
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

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000b11', '0111 Customer'), ('c0000000-0000-4000-8000-000000000b12', '0111 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000b11', 'c0000000-0000-4000-8000-000000000b11', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty) values
  ('e0000000-0000-4000-8000-000000000b11', 'd0000000-0000-4000-8000-000000000b11', 0, '0111 pump', 4);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-000000000b11', 'd0000000-0000-4000-8000-000000000b11', 'c0000000-0000-4000-8000-000000000b12', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, origin, weight, weight_unit) values
  ('f1000000-0000-4000-8000-000000000b11', 'f0000000-0000-4000-8000-000000000b11', 'e0000000-0000-4000-8000-000000000b11', 120, 'USD', '3 weeks', 'Germany', 2.5, 'kg');

-- structure
select has_column('public', 'supplier_quote_lines', 'weight', 'supplier_quote_lines.weight exists');
select has_column('public', 'supplier_quote_lines', 'weight_unit', 'supplier_quote_lines.weight_unit exists');
select col_not_null('public', 'supplier_quote_lines', 'weight_unit', 'the unit is never blank');
select col_default_is('public', 'supplier_quote_lines', 'weight_unit', 'kg', 'the unit defaults to kg');
select is((select weight_unit from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'), 'kg', 'a line saved with a unit reads it back');

-- engineer: no grant on either column, to read or to write
select is((select coalesce(array_agg(c order by c), '{}') from unnest(array['weight', 'weight_unit']) c
           where has_column_privilege('qtech_engineer', 'public.supplier_quote_lines', c, 'select')
              or has_column_privilege('qtech_engineer', 'public.supplier_quote_lines', c, 'insert')
              or has_column_privilege('qtech_engineer', 'public.supplier_quote_lines', c, 'update')),
          '{}'::text[], 'qtech_engineer holds no privilege on weight or weight_unit');
select ok(not has_column_privilege('qtech_engineer', 'public.supplier_quote_lines', 'unit_price', 'select'), 'nor on the price');
select is((select coalesce(array_agg(c order by c), '{}') from unnest(array['weight', 'weight_unit']) c
           where not has_column_privilege('authenticated', 'public.supplier_quote_lines', c, 'select')),
          '{}'::text[], 'authenticated (admin and sales) reads both');

-- what each persona gets through the data API
select is(pg_temp.as_('sales', $q$select weight::text || ' ' || weight_unit || ' ' || origin from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  '2.5000 kg Germany', 'sales read weight, unit and origin');
select is(pg_temp.as_('admin', $q$select weight::text from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  '2.5000', 'admin reads the weight');
select is(pg_temp.as_('engineer', $q$select weight::text from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  'E:42501', 'an engineer is refused the weight');
select is(pg_temp.as_('engineer', $q$select weight_unit from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  'E:42501', 'and the unit');
select is(pg_temp.as_('engineer', $q$select unit_price::text from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  'E:42501', 'and the price the statement is built from');
select is(pg_temp.as_('engineer', $q$select count(*)::text from (select * from public.supplier_quote_lines) t$q$),
  'E:42501', 'select * on the table is refused: the statement cannot be read by an engineer');
select is(pg_temp.as_('engineer', $q$select lead_time || ' ' || origin from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000b11'$q$),
  '3 weeks Germany', 'an engineer still reads lead time and origin, as before');
select is(pg_temp.as_('engineer', $q$with u as (update public.supplier_quote_lines set weight = 9 where id = 'f1000000-0000-4000-8000-000000000b11' returning 1) select count(*)::text from u$q$),
  'E:42501', 'an engineer cannot change the weight');

-- sales write them
select is(pg_temp.as_('sales', $q$with u as (update public.supplier_quote_lines set weight = 400, weight_unit = 'g', origin = 'China' where id = 'f1000000-0000-4000-8000-000000000b11' returning 1) select count(*)::text from u$q$),
  '1', 'sales can change weight, unit and origin');
select is(pg_temp.as_('sales', $q$with u as (update public.supplier_quote_lines set weight = 0 where id = 'f1000000-0000-4000-8000-000000000b11' returning 1) select count(*)::text from u$q$),
  'E:23514', 'a weight of zero is refused');
select is(pg_temp.as_('sales', $q$with u as (update public.supplier_quote_lines set weight_unit = 'stone' where id = 'f1000000-0000-4000-8000-000000000b11' returning 1) select count(*)::text from u$q$),
  'E:23514', 'a unit other than kg, g or lb is refused');
select is(pg_temp.as_('sales', $q$with u as (update public.supplier_quote_lines set weight = null where id = 'f1000000-0000-4000-8000-000000000b11' returning 1) select count(*)::text from u$q$),
  '1', 'and the weight can be cleared (not stated)');

select * from finish();
rollback;
