begin;
select * from no_plan();

-- 0142_archive_search: search_all and search_closed_rfqs leave out archived RFQs, orders (with their items), supplier POs and invoices, for every
-- role; companies and contacts always show. Cutoff 17 Nov 2026: the 16 Nov rows are hidden, the 17 Nov rows are shown. Archiving off hides nothing.
-- An unhidden row shows. Admin, sales and engineer all call both functions without a permission error.

-- ------------------------------------------------------------------ machinery
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b9142000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona the way PostgREST does (role authenticated, claims, then the pre-request that moves an engineer onto
-- qtech_engineer) and returns the first column of the first row as text: '<none>' for no row, '<null>' for NULL, 'E:<sqlstate>' for an error.
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

-- Result id counts: how many rows of search_all(q) carry this id, as the persona
create function pg_temp.hit(persona text, q text, p_id uuid) returns text language sql as
  $$ select pg_temp.as_(persona, format('select count(*) from public.search_all(%L, 25) where id = %L', q, p_id)) $$;
create function pg_temp.closed_hit(persona text, q text, p_id uuid) returns text language sql as
  $$ select pg_temp.as_(persona, format('select count(*) from public.search_closed_rfqs(%L, 25, 0) where rfq_id = %L', q, p_id)) $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values (pg_temp.f('01'), 'Zqsearch142 Customer'), (pg_temp.f('02'), 'Zqsearch142 Supplier');
insert into public.contacts (id, company_id, name, email) values (pg_temp.f('03'), pg_temp.f('01'), 'Zqsearch142 Person', 'zq142@example.test');

-- RFQs: 11 on 16 Nov (hidden), 12 on 17 Nov (shown), 13 on 16 Nov (hidden, to be unhidden); all closed so the Closed search sees them
insert into public.rfqs (id, company_id, owner_id, received_on, closed_on, legacy_source) values
  (pg_temp.f('11'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', '2026-11-20', null),
  (pg_temp.f('12'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-17', '2026-11-20', null),
  (pg_temp.f('13'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', '2026-11-20', null);

insert into public.orders (id, company_id, owner_id, rfq_id, ordered_on, legacy_flags, legacy_source) values
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-16', '{}', null),
  (pg_temp.f('22'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-17', '{}', null);
insert into public.order_items (id, order_id, description, qty, unit_price_net) values
  (pg_temp.f('23'), pg_temp.f('21'), 'Zqsearch142 widget old', 1, 1),
  (pg_temp.f('24'), pg_temp.f('22'), 'Zqsearch142 widget new', 1, 1);
insert into public.order_engineers (order_id, user_id) values
  (pg_temp.f('21'), 'a0000000-0000-4000-8000-000000000003'), (pg_temp.f('22'), 'a0000000-0000-4000-8000-000000000003');

insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, legacy_flags, legacy_source) values
  (pg_temp.f('31'), pg_temp.f('21'), 'INV-ZQ142-OLD', '2026-11-16', 100, 18, '{}', null),
  (pg_temp.f('32'), pg_temp.f('22'), 'INV-ZQ142-NEW', '2026-11-17', 100, 18, '{}', null);

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, legacy_source) values
  (pg_temp.f('41'), pg_temp.f('21'), pg_temp.f('02'), 'PKR', '2026-11-16', null),
  (pg_temp.f('42'), pg_temp.f('22'), pg_temp.f('02'), 'PKR', '2026-11-17', null);
insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines) values
  (pg_temp.f('43'), pg_temp.f('41'), 914221, 0, '2026-11-16', 'PKR', 0, '[{"qty":1,"unit_price":1}]'),
  (pg_temp.f('44'), pg_temp.f('42'), 914222, 0, '2026-11-17', 'PKR', 0, '[{"qty":1,"unit_price":1}]');

create temp table ords as select id, number from public.orders where id in (pg_temp.f('21'), pg_temp.f('22'));

-- ------------------------------------------------------------------ archiving OFF: everything is found
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('11')), '1', 'off: the 16 Nov RFQ is found');
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('12')), '1', 'off: the 17 Nov RFQ is found');
select is(pg_temp.hit('admin', 'ORD-' || (select number from ords where id = pg_temp.f('21')), pg_temp.f('21')), '1', 'off: the 16 Nov order is found');
select is(pg_temp.hit('admin', 'Zqsearch142 widget', pg_temp.f('23')), '1', 'off: the item of the 16 Nov order is found');
select is(pg_temp.hit('admin', 'INV-ZQ142', pg_temp.f('31')), '1', 'off: the 16 Nov invoice is found');
select is(pg_temp.hit('admin', 'PO-26-914221', pg_temp.f('43')), '1', 'off: the 16 Nov supplier PO is found');
select is(pg_temp.closed_hit('admin', 'Zqsearch142', pg_temp.f('11')), '1', 'off: the Closed search finds the 16 Nov RFQ');

-- ------------------------------------------------------------------ archiving ON, cutoff 17 Nov 2026
select is((select (public.archive_set(true, date '2026-11-17')).enabled), true, 'archiving switched on');

select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('11')), '0', 'on: the 16 Nov RFQ is absent from search_all');
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('12')), '1', 'on: the 17 Nov RFQ is present');
select is(pg_temp.hit('admin', 'ORD-' || (select number from ords where id = pg_temp.f('21')), pg_temp.f('21')), '0', 'on: the 16 Nov order is absent');
select is(pg_temp.hit('admin', 'ORD-' || (select number from ords where id = pg_temp.f('22')), pg_temp.f('22')), '1', 'on: the 17 Nov order is present');
select is(pg_temp.hit('admin', 'Zqsearch142 widget', pg_temp.f('23')), '0', 'on: the item of the archived order is absent');
select is(pg_temp.hit('admin', 'Zqsearch142 widget', pg_temp.f('24')), '1', 'on: the item of the current order is present');
select is(pg_temp.hit('admin', 'INV-ZQ142', pg_temp.f('31')), '0', 'on: the 16 Nov invoice is absent');
select is(pg_temp.hit('admin', 'INV-ZQ142', pg_temp.f('32')), '1', 'on: the 17 Nov invoice is present');
select is(pg_temp.hit('admin', 'PO-26-914221', pg_temp.f('43')), '0', 'on: the 16 Nov supplier PO is absent');
select is(pg_temp.hit('admin', 'PO-26-914222', pg_temp.f('44')), '1', 'on: the 17 Nov supplier PO is present');
select is(pg_temp.hit('sales', 'Zqsearch142 Customer', pg_temp.f('11')), '0', 'on: sales does not see the archived RFQ either');
select is(pg_temp.hit('sales', 'Zqsearch142 Customer', pg_temp.f('12')), '1', 'on: sales sees the current RFQ');

-- companies and contacts always show
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('01')), '1', 'on: the company is still found');
select is(pg_temp.hit('admin', 'Zqsearch142 Person', pg_temp.f('03')), '1', 'on: the contact is still found');
select is(pg_temp.hit('engineer', 'Zqsearch142 Customer', pg_temp.f('01')), '1', 'on: an engineer still finds the company');

-- the Closed search
select is(pg_temp.closed_hit('admin', 'Zqsearch142', pg_temp.f('11')), '0', 'on: the Closed search hides the archived closed RFQ');
select is(pg_temp.closed_hit('admin', 'Zqsearch142', pg_temp.f('12')), '1', 'on: the Closed search shows the current closed RFQ');

-- engineer and sales: no permission error, and the same hiding
select is(pg_temp.hit('engineer', 'Zqsearch142 widget', pg_temp.f('23')), '0', 'engineer: the archived order''s item is absent, no error');
select is(pg_temp.hit('engineer', 'Zqsearch142 widget', pg_temp.f('24')), '1', 'engineer: the current order''s item is present, no error');
select is(pg_temp.hit('engineer', 'Zqsearch142 Customer', pg_temp.f('11')), '0', 'engineer: the archived RFQ is absent, no error');
select is(pg_temp.hit('engineer', 'ORD-' || (select number from ords where id = pg_temp.f('21')), pg_temp.f('21')), '0', 'engineer: the archived order is absent, no error');
select is(pg_temp.closed_hit('engineer', 'Zqsearch142', pg_temp.f('11')), '0', 'engineer: Closed search runs without an error');
select is(pg_temp.closed_hit('sales', 'Zqsearch142', pg_temp.f('12')), '1', 'sales: Closed search runs and shows the current RFQ');

-- an unhidden row is present
select is(public.archive_unhide('rfq', pg_temp.f('13')), true, 'the 16 Nov RFQ 13 is unhidden');
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('13')), '1', 'unhidden: the RFQ is present in search_all');
select is(pg_temp.closed_hit('admin', 'Zqsearch142', pg_temp.f('13')), '1', 'unhidden: the RFQ is present in the Closed search');
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('11')), '0', 'unhidden: a different archived RFQ stays absent');

-- ------------------------------------------------------------------ archiving OFF again
select is((select (public.archive_set(false, date '2026-11-17')).enabled), false, 'archiving switched off');
select is(pg_temp.hit('admin', 'Zqsearch142 Customer', pg_temp.f('11')), '1', 'off again: the 16 Nov RFQ is back');
select is(pg_temp.hit('admin', 'INV-ZQ142', pg_temp.f('31')), '1', 'off again: the 16 Nov invoice is back');
select is(pg_temp.hit('admin', 'Zqsearch142 widget', pg_temp.f('23')), '1', 'off again: the archived order''s item is back');
select is(pg_temp.closed_hit('admin', 'Zqsearch142', pg_temp.f('11')), '1', 'off again: the Closed search finds the 16 Nov RFQ');

select * from finish();
rollback;
