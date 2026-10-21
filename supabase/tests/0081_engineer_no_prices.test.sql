-- 0081_engineer_no_prices (owner decision 2026-10-22): the database refuses prices to an engineer, through the data API.
-- PostgREST runs qtech_private.pre_request() before each request; for an engineer it switches to qtech_engineer. These tests
-- do the same (claims, role authenticated, pre_request) and check what each persona can read. 0902 sweeps every money column.
begin;
select * from no_plan();

-- ------------------------------------------------------------------ machinery
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
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
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

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000a81', '0081 Customer'), ('c0000000-0000-4000-8000-000000000a82', '0081 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000a81', 'c0000000-0000-4000-8000-000000000a81', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net) values
  ('e0000000-0000-4000-8000-000000000a81', 'd0000000-0000-4000-8000-000000000a81', 0, '0081 transmitter', 2, 5000);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-000000000a81', 'd0000000-0000-4000-8000-000000000a81', 'c0000000-0000-4000-8000-000000000a82', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, lead_time) values
  ('f1000000-0000-4000-8000-000000000a81', 'f0000000-0000-4000-8000-000000000a81', 'e0000000-0000-4000-8000-000000000a81', 3000, 'PKR', '2 weeks');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000a81', 'c0000000-0000-4000-8000-000000000a81', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000000a81', 'a1000000-0000-4000-8000-000000000a81', 'c0000000-0000-4000-8000-000000000a82', 'PKR');
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  ('a3000000-0000-4000-8000-000000000a81', 'a1000000-0000-4000-8000-000000000a81', 0, '0081 transmitter', 2, 'ea', 5000, 18,
   'a2000000-0000-4000-8000-000000000a81', 3000);
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values
  ('a4000000-0000-4000-8000-000000000a81', 'd0000000-0000-4000-8000-000000000a81', 8101, 0, public.today_pkt() + 5,
   '[{"qty":2,"unit_price_net":5000,"gst_rate":18}]');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  ('a5000000-0000-4000-8000-000000000a81', 'a2000000-0000-4000-8000-000000000a81', 8102, 0, 'PKR', 6000, '[{"qty":2,"unit_price":3000}]');
insert into public.snoozes (user_id, rule, subject_id, until_on) values
  ('a0000000-0000-4000-8000-000000000003', 'r', 'e0000000-0000-4000-8000-000000000a81', public.today_pkt() + 3);

-- ------------------------------------------------------------------ structure
select ok(exists (select 1 from pg_roles where rolname = 'qtech_engineer' and not rolcanlogin), 'qtech_engineer exists and cannot log in');
select ok(pg_has_role('authenticator', 'qtech_engineer', 'member'), 'PostgREST''s authenticator may switch to qtech_engineer');
select ok(not pg_has_role('authenticated', 'qtech_engineer', 'member') and not pg_has_role('qtech_engineer', 'authenticated', 'member'),
  'authenticated and qtech_engineer are not members of each other (no privilege leaks either way)');
select ok(exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                  where r.rolname = 'authenticator' and 'pgrst.db_pre_request=qtech_private.pre_request' = any (s.setconfig)),
  'the data API runs qtech_private.pre_request before every request');
select ok(has_function_privilege('anon', 'qtech_private.pre_request()', 'execute')
      and has_function_privilege('authenticated', 'qtech_private.pre_request()', 'execute')
      and has_function_privilege('service_role', 'qtech_private.pre_request()', 'execute')
      and has_schema_privilege('anon', 'qtech_private', 'usage') and has_schema_privilege('service_role', 'qtech_private', 'usage'),
  'every API role (anon, authenticated, service_role) can run the pre-request');
set local role anon;
select lives_ok($$select qtech_private.pre_request()$$, 'the pre-request does nothing for anon (and does not fail)');
select is(current_user::text, 'anon', 'anon stays anon');
reset role;
set local role service_role;
select lives_ok($$select qtech_private.pre_request()$$, 'nor for the service role');
select is(current_user::text, 'service_role', 'the service role stays itself');
reset role;
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'qtech_private'::regnamespace and p.prosecdef),
  'nothing in qtech_private is SECURITY DEFINER');

-- the price columns, by name
create temp table price (obj text, col text);
insert into price values
  ('rfq_items', 'quoted_unit_price_net'), ('supplier_quote_lines', 'unit_price'), ('supplier_quote_lines', 'fx_rate_pkr'),
  ('quotations', 'lines'), ('quotations', 'net_total'), ('quotations', 'gst_total'),
  ('order_items', 'unit_price_net'), ('order_items', 'supplier_unit_price'),
  ('purchase_orders', 'total'), ('purchase_orders', 'lines'), ('fx_rates', 'rate_pkr');
select is((select coalesce(array_agg(obj || '.' || col order by obj, col), '{}') from price
           where has_column_privilege('qtech_engineer', format('public.%I', obj), col, 'select')),
          '{}'::text[], 'qtech_engineer holds SELECT on none of the price, total and rate columns');
select is((select coalesce(array_agg(obj || '.' || col order by obj, col), '{}') from price
           where not has_column_privilege('authenticated', format('public.%I', obj), col, 'select')),
          '{}'::text[], 'authenticated (admin and sales) still holds SELECT on all of them');
select ok(not has_table_privilege('qtech_engineer', 'public.v_fx_latest', 'select'), 'qtech_engineer cannot read v_fx_latest (exchange rates)');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('rank_item_quotes', 'customer_price_memory', 'supplier_item_memory', 'po_line_prefill', 'issue_quotation',
                               'issue_purchase_order', 'convert_rfq_to_order', 'create_repeat_order', 'split_order_item', 'set_fx_rate')
             and has_function_privilege('qtech_engineer', p.oid, 'execute')),
          '{}'::text[], 'qtech_engineer cannot run the price RPCs nor the pricing actions');

-- coverage: whatever authenticated may do in public, qtech_engineer may do too, except the prices above (a new object fails here)
select is((select coalesce(array_agg(x order by x), '{}') from (
             select format('%s %s', c.relname, p.priv) as x
             from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p (priv)
             where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
               and has_table_privilege('authenticated', c.oid, p.priv)
               and not has_table_privilege('qtech_engineer', c.oid, p.priv)
               and not (p.priv = 'SELECT' and (c.relname in (select obj from price) or c.relname = 'v_fx_latest'))) u),
          '{}'::text[], 'coverage: qtech_engineer holds every table privilege authenticated holds (prices excepted)');
select is((select coalesce(array_agg(format('%s.%s', c.relname, a.attname) order by c.relname, a.attname), '{}')
           from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           where c.relname in (select obj from price) and c.relnamespace = 'public'::regnamespace
             and not exists (select 1 from price p where p.obj = c.relname and p.col = a.attname)
             and not has_column_privilege('qtech_engineer', c.oid, a.attnum, 'select')),
          '{}'::text[], 'coverage: qtech_engineer reads every other column of the price tables');
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('qtech_engineer', p.oid, 'execute')
             and p.proname not in ('rank_item_quotes', 'customer_price_memory', 'supplier_item_memory', 'po_line_prefill', 'issue_quotation',
                                   'issue_purchase_order', 'convert_rfq_to_order', 'create_repeat_order', 'split_order_item', 'set_fx_rate')),
          '{}'::text[], 'coverage: qtech_engineer runs every function authenticated runs (the price ones excepted)');
select is((select coalesce(array_agg(format('%s on %s', pol.polname, c.relname) order by 1), '{}')
           from pg_policy pol join pg_class c on c.oid = pol.polrelid
           where c.relnamespace = 'public'::regnamespace
             and 'authenticated'::regrole = any (pol.polroles)
             and not ('qtech_engineer'::regrole = any (pol.polroles))),
          '{}'::text[], 'coverage: every row-security policy for authenticated applies to qtech_engineer too');

-- ------------------------------------------------------------------ the switch
select is(pg_temp.as_('engineer', 'select current_user::text'), 'qtech_engineer', 'an engineer''s request runs as qtech_engineer');
select is(pg_temp.as_('admin', 'select current_user::text'), 'authenticated', 'an admin''s request is untouched');
select is(pg_temp.as_('sales', 'select current_user::text'), 'authenticated', 'a sales request is untouched');
select is(pg_temp.as_('deactivated', 'select current_user::text'), 'authenticated', 'a deactivated person stays authenticated (row security gives nothing)');
select is(pg_temp.as_('engineer', 'select auth.uid()::text'), 'a0000000-0000-4000-8000-000000000003', 'the engineer is still themselves (auth.uid)');
select is(pg_temp.as_('engineer', 'select public.current_user_role()'), 'engineer', 'and current_user_role() still says engineer');

-- ------------------------------------------------------------------ what the engineer reads
select is(pg_temp.as_('engineer', $q$select string_agg(description || ' x' || qty::text, ',') from public.rfq_items where id = 'e0000000-0000-4000-8000-000000000a81'$q$),
  '0081 transmitter x2.000', 'engineer reads the RFQ item: description and quantity');
select is(pg_temp.as_('engineer', $q$select quoted_unit_price_net::text from public.rfq_items where id = 'e0000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'but not its quoted price');
select is(pg_temp.as_('engineer', $q$select count(*)::text from (select * from public.rfq_items) x$q$), 'E:42501',
  'select * on rfq_items (what ?select=* asks) is refused to the engineer');
select is(pg_temp.as_('engineer', $q$select lead_time || ' ' || currency from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000a81'$q$),
  '2 weeks PKR', 'engineer reads who replied, the lead time and the currency');
select is(pg_temp.as_('engineer', $q$select unit_price::text from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'but not the supplier''s price');
select is(pg_temp.as_('engineer', $q$select description || ' ' || qty::text || ' ' || unit from public.order_items where id = 'a3000000-0000-4000-8000-000000000a81'$q$),
  '0081 transmitter 2.000 ea', 'engineer reads the order line: description, quantity, unit');
select is(pg_temp.as_('engineer', $q$select unit_price_net::text from public.order_items where id = 'a3000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'but not the selling price');
select is(pg_temp.as_('engineer', $q$select supplier_unit_price::text from public.order_items where id = 'a3000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'nor the supplier price');
select is(pg_temp.as_('engineer', $q$select number::text || '/' || revision::text from public.quotations where id = 'a4000000-0000-4000-8000-000000000a81'$q$),
  '8101/0', 'engineer reads the quotation number and revision');
select is(pg_temp.as_('engineer', $q$select net_total::text from public.quotations where id = 'a4000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'but not its total');
select is(pg_temp.as_('engineer', $q$select lines::text from public.quotations where id = 'a4000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'nor its priced lines');
select is(pg_temp.as_('engineer', $q$select total::text from public.purchase_orders where id = 'a5000000-0000-4000-8000-000000000a81'$q$),
  'E:42501', 'nor a PO total');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.fx_rates where rate_pkr is not null$q$), 'E:42501',
  'nor an exchange rate');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.v_fx_latest$q$), 'E:42501', 'nor v_fx_latest');
select is(pg_temp.as_('engineer', $q$select coalesce(net::text, 'null') || '|' || coalesce(gross::text, 'null') from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000a81'$q$),
  'null|null', 'the order totals are NULL for the engineer');
select is(pg_temp.as_('engineer', $q$select lifecycle || '|' || coalesce(gross::text, 'null') from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000a81'$q$),
  'active|null', 'v_order_state (the Orders list, Today) still answers the engineer, with no total');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.snoozes where user_id = auth.uid()$q$), '1',
  'policies that use auth.uid() work for the engineer (own snoozes)');
select is(pg_temp.as_('engineer', $q$select public.can_access_bucket('generated-docs')::text$q$), 'false',
  'the quotation and PO PDFs (generated-docs) are closed to the engineer');
select is(pg_temp.as_('engineer', $q$select public.can_access_bucket('rfq-files')::text$q$), 'true',
  'the RFQ files stay open to the engineer');
select is(pg_temp.as_('engineer', $q$select 'answers' from (select count(*) from public.supplier_item_evidence(array['c0000000-0000-4000-8000-000000000a82'::uuid], null, null, '0081 transmitter')) x$q$),
  'answers', 'the supplier picker''s evidence still answers the engineer (no price in it)');

-- ------------------------------------------------------------------ what the engineer may still write
select is(pg_temp.as_('engineer', $q$with i as (insert into public.rfq_items (rfq_id, position, description, qty)
            values ('d0000000-0000-4000-8000-000000000a81', 1, '0081 added by the engineer', 1) returning description) select description from i$q$),
  '0081 added by the engineer', 'the engineer adds an item to an RFQ (Add item)');
select is(pg_temp.as_('engineer', $q$with u as (update public.rfq_items set description = '0081 renamed' where id = 'e0000000-0000-4000-8000-000000000a81' returning id) select count(*)::text from u$q$),
  '1', 'and edits an item''s description');

-- ------------------------------------------------------------------ admin and sales: unchanged
select is(pg_temp.as_('sales', $q$select quoted_unit_price_net::text from public.rfq_items where id = 'e0000000-0000-4000-8000-000000000a81'$q$),
  '5000.00', 'sales still read the quoted price');
select is(pg_temp.as_('sales', $q$select unit_price::text from public.supplier_quote_lines where id = 'f1000000-0000-4000-8000-000000000a81'$q$),
  '3000.0000', 'sales still read the supplier''s price');
select is(pg_temp.as_('admin', $q$select net::text || '|' || gst::text || '|' || gross::text from public.v_order_items_total where order_id = 'a1000000-0000-4000-8000-000000000a81'$q$),
  '10000.00|1800.00|11800.00', 'the admin''s order totals are as before');
select is(pg_temp.as_('sales', $q$select gross::text from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000a81'$q$),
  '11800.00', 'and sales'' v_order_state total');
select is(pg_temp.as_('admin', $q$select count(*)::text from (select * from public.order_items where id = 'a3000000-0000-4000-8000-000000000a81') x$q$),
  '1', 'select * on order_items works for the admin');
select is(pg_temp.as_('sales', $q$select public.can_access_bucket('generated-docs')::text$q$), 'true', 'sales keep the PDFs');
select is(pg_temp.as_('deactivated', $q$select count(*)::text from public.v_order_items_total$q$), '0', 'a deactivated person gets no order totals');

select * from finish();
rollback;
