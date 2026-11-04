begin;
select * from no_plan();

-- 0090 record history: every record shows "was X, now Y, by whom, when" (public.record_history), and an engineer never gets a
-- money change. Fictional fixtures only. Personas run as the API runs them: role authenticated with the persona's claims, then
-- qtech_private.pre_request() (0081), which moves an engineer onto qtech_engineer.
--   (a) record_history_rows is refused when called directly
--   (b) engineer: a price change returns no event and no price key appears anywhere
--   (c) sales get no payments_in, expenses or order_costs events, admin does
--   (d) a removed child line shows in its parent's history
--   (e) a record the caller cannot see gives 42501 (an admin may read a deleted one)
--   (f) the 0081 and 0057 tests still pass: they are separate files of this suite (0081_engineer_no_prices, 0057_security_hardening)
--   (g) EXPLAIN uses the indexes

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f9000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       else '00000000-0000-0000-0000-000000000000' end $$;

-- Runs `stmt` as the persona and returns the first column of the first row as text, or 'E:<sqlstate>'. Always rolled back.
create function pg_temp.scalar_as(stmt text, persona text) returns text language plpgsql as $f$
declare
  v text;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    raise exception 'scalar done' using errcode = 'P0999', detail = coalesce(v, '<null>');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end;
$f$;

create function pg_temp.hist(persona text, tbl text, id uuid, before timestamptz default null, lim int default 200) returns jsonb
language plpgsql as $f$
declare t text;
begin
  t := pg_temp.scalar_as(format('select public.record_history(%L, %L, %L, %s)::text', tbl, id, before, lim), persona);
  if t like 'E:%' then
    return jsonb_build_object('error', t);
  end if;
  return t::jsonb;
end;
$f$;

-- every key of an event's was and now (either may be JSON null)
create function pg_temp.keys(e jsonb) returns setof text language sql as $$
  select jsonb_object_keys(e -> 'was') where jsonb_typeof(e -> 'was') = 'object'
  union all
  select jsonb_object_keys(e -> 'now') where jsonb_typeof(e -> 'now') = 'object'
$$;

-- events of a result that match a table (and an action)
create function pg_temp.n(j jsonb, tbl text, act text default null) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(j -> 'events') e
  where e ->> 'table' = tbl and (act is null or e ->> 'action' = act)
$$;

create function pg_temp.plan(q text) returns text language plpgsql as $f$
declare r text; o text := '';
begin
  for r in execute 'explain ' || q loop o := o || r || E'\n'; end loop;
  return o;
end;
$f$;

-- ------------------------------------------------------------------ fixtures (written by the admin, so changed_by is set)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values (pg_temp.f('01'), 'Hx Main Traders');
insert into public.contacts (id, company_id, name) values (pg_temp.f('02'), pg_temp.f('01'), 'Hx Contact');
insert into public.company_sites (id, company_id, name) values (pg_temp.f('03'), pg_temp.f('01'), 'Hx Site');
insert into public.rfqs (id, company_id, owner_id) values
  (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('13'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description, quoted_unit_price_net) values
  (pg_temp.f('11'), pg_temp.f('10'), 'Hx rfq item', 70),
  (pg_temp.f('12'), pg_temp.f('10'), 'Hx rfq item removed', 70);
insert into public.orders (id, company_id, owner_id) values
  (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (id, order_id, description, unit_price_net) values
  (pg_temp.f('21'), pg_temp.f('20'), 'Hx order line', 50),
  (pg_temp.f('22'), pg_temp.f('20'), 'Hx removed line', 40);
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values (pg_temp.f('23'), pg_temp.f('20'), 'HX-INV-1', 100, 18);
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('24'), pg_temp.f('20'), 5);
insert into public.expenses (id, order_id, amount_pkr, category_id) values
  (pg_temp.f('25'), pg_temp.f('20'), 7, 'ca7e0000-0000-4000-8000-000000000011');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices) values   -- untagged: 0103 defaults to true
  (pg_temp.f('26'), 'rfq-files', 'hx/1.pdf', 'order-file.pdf', 'application/pdf', 10, pg_temp.f('20'), false);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.f('27'), 'gst-receipts', 'hx/2.pdf', 'invoice-file.pdf', 'application/pdf', 10, pg_temp.f('23'));

-- the changes whose history is read below
update public.order_items set unit_price_net = 60 where id = pg_temp.f('21');                       -- a price change
update public.order_items set description = 'Hx order line renamed' where id = pg_temp.f('21');      -- a plain change
update public.orders set notes = 'Hx note' where id = pg_temp.f('20');
update public.payments_in set reference = 'HX-REF' where id = pg_temp.f('24');
update public.expenses set description = 'Hx freight' where id = pg_temp.f('25');
update public.invoices set notes = 'Hx invoice note' where id = pg_temp.f('23');
update public.companies set name = 'Hx Main Traders Ltd' where id = pg_temp.f('01');
delete from public.order_items where id = pg_temp.f('22');                                           -- a removed line
delete from public.rfq_items where id = pg_temp.f('12');
delete from public.rfqs where id = pg_temp.f('13');                                                  -- a removed record

-- one transaction stamps every row alike; spread them so paging has something to page
with n as (select a.id, row_number() over (order by a.id) as rn from public.audit_log a)
update public.audit_log a set changed_at = now() - make_interval(secs => n.rn * 10) from n where a.id = n.id;

-- ------------------------------------------------------------------ (a) the definer reader refuses a direct call
select is(pg_temp.scalar_as(format('select public.record_history_rows(%L, %L)::text', 'orders', pg_temp.f('20')), 'admin'), 'E:42501',
  '(a) record_history_rows called directly is refused (admin)');
select is(pg_temp.scalar_as(format('select public.record_history_rows(%L, %L)::text', 'orders', pg_temp.f('20')), 'sales'), 'E:42501',
  '(a) record_history_rows called directly is refused (sales)');
select is(pg_temp.scalar_as(format($q$select public.record_history_rows(%L, %L, null, case when m.s is null then 50 else 50 end)::text from (select set_config('qtech.history_for', 'orders:other', true) as s) m$q$,
                                   'orders', pg_temp.f('20')), 'admin'), 'E:42501',
  '(a) a mark for another record does not open it');
select is(pg_temp.scalar_as(format($q$select public.record_history_rows(%L, %L, null, case when m.s is null then 50 else 50 end)::text from (select set_config('qtech.history_for', %L, true) as s) m$q$,
                                   'orders', pg_temp.f('20'), 'orders:' || pg_temp.f('20')), 'deactivated'), 'E:42501',
  '(a) a person without a role is refused even with the mark');
select is(pg_temp.scalar_as(format('select public.record_history_rows(%L, %L)::text', 'orders', pg_temp.f('20')), 'engineer'), 'E:42501',
  '(a) record_history_rows called directly is refused (engineer)');

-- ------------------------------------------------------------------ the fixtures: what the admin sees
create temp table adm as select pg_temp.hist('admin', 'orders', pg_temp.f('20')) as j;
create temp table sal as select pg_temp.hist('sales', 'orders', pg_temp.f('20')) as j;
create temp table eng as select pg_temp.hist('engineer', 'orders', pg_temp.f('20')) as j;
grant all on adm, sal, eng to public;

select ok(not (select j ? 'error' from adm), 'admin reads the history of an order (got ' || (select left(j::text, 80) from adm) || ')');
select is((select jsonb_typeof(j -> 'events') || jsonb_typeof(j -> 'refs') || jsonb_typeof(j -> 'has_more') from adm), 'arrayobjectboolean',
  'the result is {events, refs, has_more}');
select is((select j ->> 'has_more' from adm), 'false', 'one page holds this small history');
select ok((select pg_temp.n(j, 'orders', 'insert') = 1 and pg_temp.n(j, 'orders', 'update') >= 1 from adm), 'admin: the order''s own insert and update');
select ok((select pg_temp.n(j, 'order_items', 'update') = 2 from adm), 'admin: both order-line updates, the price change and the rename');
select ok((select exists (select 1 from jsonb_array_elements(j -> 'events') e
                          where e ->> 'table' = 'order_items' and e ->> 'action' = 'update'
                            and (e -> 'was' ->> 'unit_price_net')::numeric = 50 and (e -> 'now' ->> 'unit_price_net')::numeric = 60) from adm),
  'admin sees the price change: was 50, now 60');
select ok((select bool_and(e ->> 'by' = 'a0000000-0000-4000-8000-000000000001' and e ->> 'by_name' is not null and e ->> 'at' is not null)
           from adm, jsonb_array_elements(adm.j -> 'events') e where e ->> 'table' = 'order_items'),
  'every event says by whom (id and name) and when');
select is((select count(*)::int from adm, jsonb_array_elements(adm.j -> 'events') e,
                 lateral pg_temp.keys(e) k
           where k in ('updated_at', 'model_tokens', 'legacy_source')), 0, 'updated_at, model_tokens and legacy_source are never returned');
select ok((select pg_temp.n(j, 'invoices') >= 2 and pg_temp.n(j, 'payments_in') >= 2 and pg_temp.n(j, 'expenses') >= 2 and pg_temp.n(j, 'attachments', 'insert') = 1 from adm),
  'admin: invoice, payment, expense and order-file events are there');
select ok((select (j -> 'refs') ? pg_temp.f('01')::text and (j -> 'refs') ->> pg_temp.f('01')::text = 'Hx Main Traders Ltd' from adm),
  'refs name the company found in the values');

-- ------------------------------------------------------------------ (c) sales: no money children
select ok(not (select j ? 'error' from sal), 'sales reads the history of an order');
select is((select pg_temp.n(j, 'payments_in') + pg_temp.n(j, 'expenses') + pg_temp.n(j, 'order_costs') from sal), 0,
  '(c) sales get no payments_in, expenses or order_costs events');
select ok((select pg_temp.n(j, 'invoices') >= 2 and pg_temp.n(j, 'order_items') >= 3 from sal), 'sales still get invoice and order-line events');
select ok((select pg_temp.n(j, 'payments_in') >= 2 and pg_temp.n(j, 'expenses') >= 2 from adm), '(c) admin does get them');
select is((select pg_temp.n(j, 'attachments', 'insert') from sal), 1, 'sales get the order file');

-- ------------------------------------------------------------------ (b) engineer: no money
select ok(not (select j ? 'error' from eng), 'the engineer reads the history of an order');
select is((select pg_temp.n(j, 'order_items', 'update') from eng), 1,
  '(b) the engineer''s order line has only the rename: the price change returns no event');
select is((select count(*)::int from eng, jsonb_array_elements(eng.j -> 'events') e,
                 lateral pg_temp.keys(e) k
           where k in ('unit_price_net', 'supplier_unit_price', 'quoted_unit_price_net', 'unit_price', 'fx_rate_pkr', 'rate_pkr',
                       'net_total', 'gst_total', 'lines', 'total')), 0,
  '(b) no PRICE key appears in any event');
select is((select count(*)::int from eng, jsonb_array_elements(eng.j -> 'events') e,
                 lateral pg_temp.keys(e) k
           where not has_column_privilege('qtech_engineer', 'public.' || (e ->> 'table'), k, 'SELECT')), 0,
  '(b) every key of every event is a column qtech_engineer may SELECT');
select is((select position('unit_price_net' in j::text) from eng), 0, '(b) the price column name is not in the result at all');
select ok((select exists (select 1 from jsonb_array_elements(j -> 'events') e
                          where e ->> 'table' = 'order_items' and e ->> 'action' = 'insert' and (e -> 'now') ? 'description') from eng),
  '(b) the order-line insert still shows (its non-price columns)');
select is((select pg_temp.n(j, 'invoices') + pg_temp.n(j, 'payments_in') + pg_temp.n(j, 'expenses') + pg_temp.n(j, 'order_costs') from eng), 0,
  '(b) the engineer gets no invoice, payment, expense or cost events');
select is(pg_temp.hist('engineer', 'rfqs', pg_temp.f('10')) -> 'events' @> '[]'::jsonb, true, 'the engineer reads an RFQ history');
select is((select count(*)::int from jsonb_array_elements(pg_temp.hist('engineer', 'rfqs', pg_temp.f('10')) -> 'events') e,
                 lateral pg_temp.keys(e) k
           where k = 'quoted_unit_price_net'), 0, '(b) no RFQ-line price for the engineer');
select ok((select count(*) >= 1 from jsonb_array_elements(pg_temp.hist('sales', 'rfqs', pg_temp.f('10')) -> 'events') e,
                 lateral pg_temp.keys(e) k
           where k = 'quoted_unit_price_net'), 'sales do see the RFQ-line price (the filter is the engineer''s only)');

-- ------------------------------------------------------------------ (d) removed lines still show
select is((select count(*)::int from sal, jsonb_array_elements(sal.j -> 'events') e
           where e ->> 'table' = 'order_items' and e ->> 'action' = 'delete' and e ->> 'record_id' = pg_temp.f('22')::text
             and e ->> 'child_label' = 'Hx removed line' and e -> 'was' ->> 'description' = 'Hx removed line'), 1,
  '(d) the removed order line is in the order''s history, named, with its last values');
select is((select count(*)::int from eng, jsonb_array_elements(eng.j -> 'events') e
           where e ->> 'table' = 'order_items' and e ->> 'action' = 'delete' and e ->> 'record_id' = pg_temp.f('22')::text), 1,
  '(d) the engineer sees the removed line too (without its price)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.hist('sales', 'rfqs', pg_temp.f('10')) -> 'events') e
           where e ->> 'table' = 'rfq_items' and e ->> 'action' = 'delete' and e ->> 'child_label' = 'Hx rfq item removed'), 1,
  '(d) a removed RFQ line shows in the RFQ''s history');
select ok((select (pg_temp.hist('sales', 'companies', pg_temp.f('01'))) is not null
                  and pg_temp.n(pg_temp.hist('sales', 'companies', pg_temp.f('01')), 'contacts', 'insert') = 1
                  and pg_temp.n(pg_temp.hist('sales', 'companies', pg_temp.f('01')), 'company_sites', 'insert') = 1),
  'a company''s history carries its contacts and sites');

-- ------------------------------------------------------------------ (e) what the caller cannot see
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'payments_in', pg_temp.f('24')), 'sales'), 'E:42501',
  '(e) sales cannot read the history of a payment');
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'invoices', pg_temp.f('23')), 'engineer'), 'E:42501',
  '(e) an engineer cannot read the history of an invoice');
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'orders', pg_temp.f('20')), 'deactivated'), 'E:42501',
  '(e) a deactivated person gets nothing');
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'rfqs', pg_temp.f('13')), 'sales'), 'E:42501',
  '(e) sales cannot read the history of a deleted record');
select is(pg_temp.n(pg_temp.hist('admin', 'rfqs', pg_temp.f('13')), 'rfqs', 'delete'), 1, '(e) the admin can: the deleted RFQ''s history ends with its delete');
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'users', pg_temp.uid('admin')::uuid), 'admin'), 'E:22023',
  'a table that has no history page is refused');
select is(pg_temp.scalar_as(format('select public.record_history(%L, %L)::text', 'payments_in', pg_temp.f('24')), 'admin') like 'E:%', false,
  'the admin reads a payment history');

-- ------------------------------------------------------------------ paging
create temp table pg1 as select pg_temp.hist('admin', 'orders', pg_temp.f('20'), null, 3) as j;
grant all on pg1 to public;
select is((select jsonb_array_length(j -> 'events') from pg1), 3, 'page 1 holds 3 events');
select is((select j ->> 'has_more' from pg1), 'true', 'page 1: has_more');
create temp table pg2 as
  select pg_temp.hist('admin', 'orders', pg_temp.f('20'),
           (select (j -> 'events' -> 2 ->> 'at')::timestamptz from pg1), 200) as j;
grant all on pg2 to public;
select is((select jsonb_array_length(j -> 'events') from pg2) + 3, (select jsonb_array_length(j -> 'events') from adm),
  'page 1 and page 2 together are the whole history, nothing twice, nothing lost');
select is((select j ->> 'has_more' from pg2), 'false', 'page 2 is the last');
select is((select count(*)::int from (
             select e ->> 'id' from pg1, jsonb_array_elements(pg1.j -> 'events') e
             intersect select e ->> 'id' from pg2, jsonb_array_elements(pg2.j -> 'events') e) x), 0, 'the two pages do not overlap');

-- ------------------------------------------------------------------ the source table
select is((select count(*)::int from public.history_sources where parent_table = 'rfqs'), 5, 'history_sources: five children under rfqs');
select is((select count(*)::int from public.history_sources where parent_table = 'orders'), 8, 'history_sources: eight children under orders');
select is((select count(*)::int from public.history_sources where parent_table = 'companies'), 4, 'history_sources: four children under companies (0126: refunds and applied credit)');
select is((select roles from public.history_sources where child_table = 'payments_in'), '{admin}'::text[], 'payments_in: admin only');
select is((select roles from public.history_sources where child_table = 'invoices' and parent_table = 'orders'), '{admin,sales}'::text[], 'invoices: admin and sales');
select is((select roles from public.history_sources where child_table = 'attachments' and parent_table = 'expenses'), '{admin}'::text[], 'expense receipts: admin only');
select is(pg_temp.scalar_as('select count(*)::text from public.history_sources', 'engineer')::int, 19, 'every staff role reads history_sources');
select is(pg_temp.scalar_as('select count(*)::text from public.history_sources', 'deactivated'), '0', 'a deactivated person reads none of it');
select is(pg_temp.scalar_as($q$insert into public.history_sources (child_table, parent_table, parent_col, roles) values ('x', 'y', 'z', '{admin}') returning 1$q$, 'admin'), 'E:42501',
  'nobody writes history_sources through the API');

-- ------------------------------------------------------------------ (g) the indexes are used
set local enable_seqscan = off;
select ok(pg_temp.plan($q$select a.record_id from public.audit_log a where a.action in ('insert', 'delete')
                          and coalesce(a.new_value, a.old_value) ->> 'order_id' = 'x'$q$) like '%audit_log_parent_order_idx%',
  '(g) children of an order are found by audit_log_parent_order_idx');
select ok(pg_temp.plan($q$select a.record_id from public.audit_log a where a.action in ('insert', 'delete')
                          and coalesce(a.new_value, a.old_value) ->> 'rfq_id' = 'x'$q$) like '%audit_log_parent_rfq_idx%',
  '(g) children of an RFQ are found by audit_log_parent_rfq_idx');
select ok(pg_temp.plan($q$select a.record_id from public.audit_log a where a.action in ('insert', 'delete')
                          and coalesce(a.new_value, a.old_value) ->> 'company_id' = 'x'$q$) like '%audit_log_parent_company_idx%',
  '(g) children of a company are found by audit_log_parent_company_idx');
select ok(pg_temp.plan($q$select a.id from public.audit_log a where a.table_name = 'orders' and a.record_id = 'x'
                          and a.changed_at < now()$q$) like '%audit_log_record_idx%',
  '(g) a record''s own rows and a child''s rows use audit_log_record_idx');
reset enable_seqscan;

select * from finish();
rollback;
