-- 0133_engineer_no_customer_po: the database refuses the customer's PO number to an engineer; admin and sales read it.
-- The data API runs an engineer as qtech_engineer (0081); these tests do the same and check what each persona gets.
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

-- Every public view the engineer role may read, read as an engineer with `select * ... limit 0`.
-- Returns "<views read>|<names of those refused for the table orders>".
create function pg_temp.sweep_views() returns text language plpgsql as $f$
declare
  r record;
  bad text[] := '{}';
  n integer := 0;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
    set local role authenticated;
    perform qtech_private.pre_request();
    for r in
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
        and has_table_privilege('qtech_engineer', c.oid, 'select')
      order by c.relname
    loop
      n := n + 1;
      begin
        execute format('select * from public.%I limit 0', r.relname);
      exception when others then
        if sqlerrm ~ 'table orders$' then bad := bad || r.relname::text; end if;
      end;
    end loop;
    raise exception 'done' using errcode = 'P0999', detail = n::text || '|' || array_to_string(bad, ',');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
  end;
end
$f$;

create function pg_temp.hist(persona text, id uuid) returns text language plpgsql as $f$
declare
  v text;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute format('select public.record_history(%L, %L, null, 200)::text', 'orders', id) into v;
    raise exception 'done' using errcode = 'P0999', detail = coalesce(v, '<null>');
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
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000013301', '0133 Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000013301', 'c0000000-0000-4000-8000-000000013301', 'a0000000-0000-4000-8000-000000000002');
update public.orders set customer_po_number = 'PO-0133-SECRET' where id = 'a1000000-0000-4000-8000-000000013301';
create temp table fx as select 'ORD-' || number::text as ord from public.orders where id = 'a1000000-0000-4000-8000-000000013301';
grant select on fx to public;

-- ------------------------------------------------------------------ structure
select ok(not has_column_privilege('qtech_engineer', 'public.orders', 'customer_po_number', 'select'), 'qtech_engineer cannot SELECT orders.customer_po_number');
select ok(not has_column_privilege('qtech_engineer', 'public.orders', 'customer_po_number', 'insert'), 'nor INSERT it');
select ok(not has_column_privilege('qtech_engineer', 'public.orders', 'customer_po_number', 'update'), 'nor UPDATE it');
select ok(not has_table_privilege('qtech_engineer', 'public.orders', 'select'), 'no table-level SELECT on orders for the engineer role');
select ok(has_column_privilege('authenticated', 'public.orders', 'customer_po_number', 'select')
      and has_column_privilege('authenticated', 'public.orders', 'customer_po_number', 'update'), 'authenticated (admin and sales) still reads and writes it');
select is((select coalesce(array_agg(a.attname::text order by a.attname), '{}') from pg_attribute a
           where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'customer_po_number'
             and not (has_column_privilege('qtech_engineer', a.attrelid, a.attnum, 'select')
                      and has_column_privilege('qtech_engineer', a.attrelid, a.attnum, 'insert')
                      and has_column_privilege('qtech_engineer', a.attrelid, a.attnum, 'update'))),
          '{}'::text[], 'qtech_engineer still reads, adds and changes every other column of orders');
select is(has_table_privilege('qtech_engineer', 'public.orders', 'delete'), has_table_privilege('authenticated', 'public.orders', 'delete'),
  'DELETE on orders is as authenticated has it');

-- ------------------------------------------------------------------ what each persona gets
select is(pg_temp.as_('engineer', 'select count(*)::text from (select * from public.orders) x'), 'E:42501', 'engineer: select * from orders is refused');
select is(pg_temp.as_('engineer', 'select customer_po_number from public.orders'), 'E:42501', 'engineer: naming the PO column is refused');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.orders where customer_po_number is not null$q$), 'E:42501', 'engineer: filtering on it is refused too');
select is(pg_temp.as_('engineer', $q$update public.orders set customer_po_number = 'PO-X' where id = 'a1000000-0000-4000-8000-000000013301'$q$), 'E:42501', 'engineer: cannot set it');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.orders where id = 'a1000000-0000-4000-8000-000000013301'$q$), '1', 'engineer: still reads the order itself');
select is(pg_temp.as_('engineer', $q$select company_id::text from public.orders where id = 'a1000000-0000-4000-8000-000000013301'$q$), 'c0000000-0000-4000-8000-000000013301', 'and its other columns');
select is(pg_temp.as_('admin', $q$select customer_po_number from public.orders where id = 'a1000000-0000-4000-8000-000000013301'$q$), 'PO-0133-SECRET', 'admin reads the PO');
select is(pg_temp.as_('sales', $q$select customer_po_number from public.orders where id = 'a1000000-0000-4000-8000-000000013301'$q$), 'PO-0133-SECRET', 'sales read the PO');
select is(pg_temp.as_('admin', $q$select count(*)::text from (select * from public.orders where id = 'a1000000-0000-4000-8000-000000013301') x$q$), '1', 'select * works for the admin');

-- the PO view: NULL for an engineer, the PO for admin and sales; the API cannot reach the schema
select is(pg_temp.as_('engineer', $q$select coalesce(customer_po_number, '<null>') from qtech_private.order_po where order_id = 'a1000000-0000-4000-8000-000000013301'$q$), '<null>', 'qtech_private.order_po gives the engineer NULL');
select is(pg_temp.as_('admin', $q$select customer_po_number from qtech_private.order_po where order_id = 'a1000000-0000-4000-8000-000000013301'$q$), 'PO-0133-SECRET', 'and the admin the PO');
select is(pg_temp.as_('sales', $q$select customer_po_number from qtech_private.order_po where order_id = 'a1000000-0000-4000-8000-000000013301'$q$), 'PO-0133-SECRET', 'and sales the PO');

-- ------------------------------------------------------------------ the palette
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.search_all('PO-0133-SECRET', 25)$q$), '0', 'search_all for a PO string: the engineer gets no error and no hit');
select is(pg_temp.as_('sales', $q$select meta from public.search_all('PO-0133-SECRET', 25) where kind = 'order'$q$), 'Customer PO PO-0133-SECRET', 'sales find the order by its PO, and the PO is shown');
select is(pg_temp.as_('admin', $q$select count(*)::text from public.search_all('PO-0133-SECRET', 25) where kind = 'order'$q$), '1', 'and the admin');
select is(pg_temp.as_('engineer', format($q$select coalesce(meta, '<null>') from public.search_all(%L, 25) where kind = 'order' and id = 'a1000000-0000-4000-8000-000000013301'$q$, (select ord from fx))),
  '<null>', 'the engineer still finds the order by its number, with no PO in the hit');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.search_all('0133 Customer', 25)$q$), '1', 'and the palette still answers an engineer for a company name');

-- ------------------------------------------------------------------ the history
select ok(pg_temp.hist('engineer', 'a1000000-0000-4000-8000-000000013301') not like 'E:%', 'the engineer reads the order''s history');
select ok(pg_temp.hist('engineer', 'a1000000-0000-4000-8000-000000013301') not like '%customer_po_number%'
      and pg_temp.hist('engineer', 'a1000000-0000-4000-8000-000000013301') not like '%PO-0133-SECRET%', 'it has no customer_po_number key and not the PO text');
select ok(pg_temp.hist('admin', 'a1000000-0000-4000-8000-000000013301') like '%PO-0133-SECRET%', 'control: the admin''s history of the same order carries the PO');

-- ------------------------------------------------------------------ nothing else hands it over
select cmp_ok(split_part(pg_temp.sweep_views(), '|', 1)::int, '>', 20, 'the sweep reads more than twenty views as an engineer');
select is(split_part(pg_temp.sweep_views(), '|', 2), '', 'every public view the engineer may read answers select * limit 0: none is broken by the PO column');
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%customer_po_number%'
             and not p.prosecdef and has_function_privilege('qtech_engineer', p.oid, 'execute')
             and p.proname <> 'search_all'
             and p.prosrc !~ 'current_user_role())?s*(<>|!=|is distinct from)s*''admin'''),   -- merge_companies compares POs, after its admin-only check
          '{}'::text[], 'no SECURITY INVOKER function the engineer can run names the PO column, except search_all and admin-only ones');
select ok((select p.prosrc like '%qtech_private.order_po%' and p.prosrc not like '%o.customer_po_number%' from pg_proc p where p.oid = 'public.search_all(text, integer)'::regprocedure),
  'search_all reads the PO through qtech_private.order_po');

select * from finish();
rollback;
