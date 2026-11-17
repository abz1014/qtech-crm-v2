begin;
select * from no_plan();

-- 0143_archive_search_fast: the set-based search (no per-row is_archived call) returns EXACTLY what the 0142 logic returns. The oracle is
-- is_archived() itself: a fixture row must be found by search_all / search_closed_rfqs iff (the caller may see its kind) and is_archived(...) is false.
-- Run for admin, sales and engineer, with archiving OFF, ON at cutoff 17 Nov 2026, and ON at a far cutoff (every dated row is old).
-- The fixture mixes: dated before / on the cutoff, imported (legacy_source) rows, an undated imported order, rows unhidden by an admin, and
-- future-dated rows. An engineer must get no permission error (42501) from either function.

-- ------------------------------------------------------------------ machinery
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b9143000-0000-4000-8000-0000000000' || h)::uuid $$;

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

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values (pg_temp.f('01'), 'Zqeq143 Customer'), (pg_temp.f('02'), 'Zqeq143 Supplier');

-- RFQs (closed, so the Closed search sees them, except 17 which stays open)
insert into public.rfqs (id, company_id, owner_id, received_on, closed_on, close_reason, legacy_source) values
  (pg_temp.f('11'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', '2026-11-20', 'price', null),
  (pg_temp.f('12'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-17', '2026-11-20', 'price', null),
  (pg_temp.f('13'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2020-03-01', '2026-11-20', 'price', null),
  (pg_temp.f('14'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-12-01', '2026-12-02', 'price', '{"s":"imp143"}'),
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', '2026-11-20', 'price', null),
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2027-02-01', '2027-02-02', 'price', null),
  (pg_temp.f('17'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-11-16', null, null, null),
  (pg_temp.f('18'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2021-05-05', '2026-11-20', 'price', '{"s":"imp143"}');

insert into public.orders (id, company_id, owner_id, rfq_id, ordered_on, legacy_flags, legacy_source) values
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-16', '{}', null),
  (pg_temp.f('22'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-17', '{}', null),
  (pg_temp.f('23'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-17', '{}', '{"s":"imp143"}'),
  (pg_temp.f('24'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, null, '{undated}', '{"s":"imp143"}'),
  (pg_temp.f('25'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2026-11-16', '{}', null),
  (pg_temp.f('26'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', null, '2027-03-03', '{}', null);
insert into public.order_items (id, order_id, description, qty, unit_price_net)
select pg_temp.f('3' || n), pg_temp.f('2' || n), 'Zqeq143 item ' || n, 1, 1 from generate_series(1, 6) n;
insert into public.order_engineers (order_id, user_id)
select pg_temp.f('2' || n), 'a0000000-0000-4000-8000-000000000003' from generate_series(1, 6) n;

insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, legacy_flags, legacy_source) values
  (pg_temp.f('41'), pg_temp.f('21'), 'INV-ZQEQ143-1', '2026-11-16', 100, 18, '{}', null),
  (pg_temp.f('42'), pg_temp.f('22'), 'INV-ZQEQ143-2', '2026-11-17', 100, 18, '{}', null),
  (pg_temp.f('43'), pg_temp.f('22'), 'INV-ZQEQ143-3', '2026-11-17', 100, 18, '{}', '{"s":"imp143"}'),
  (pg_temp.f('44'), pg_temp.f('21'), 'INV-ZQEQ143-4', '2026-11-16', 100, 18, '{}', null),
  (pg_temp.f('45'), pg_temp.f('22'), 'INV-ZQEQ143-5', '2027-01-10', 100, 18, '{}', null);

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, legacy_source) values
  (pg_temp.f('51'), pg_temp.f('21'), pg_temp.f('02'), 'PKR', '2026-11-16', null),
  (pg_temp.f('52'), pg_temp.f('22'), pg_temp.f('02'), 'PKR', '2026-11-17', null),
  (pg_temp.f('53'), pg_temp.f('21'), pg_temp.f('02'), 'PKR', '2026-11-16', null);
insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines) values
  (pg_temp.f('61'), pg_temp.f('51'), 914301, 0, '2026-11-16', 'PKR', 0, '[{"qty":1,"unit_price":1}]'),
  (pg_temp.f('62'), pg_temp.f('52'), 914302, 0, '2026-11-17', 'PKR', 0, '[{"qty":1,"unit_price":1}]'),
  (pg_temp.f('63'), pg_temp.f('53'), 914303, 0, '2026-11-16', 'PKR', 0, '[{"qty":1,"unit_price":1}]');

-- what to look for, and how the oracle names each row
create temp table ev (kind text, id uuid, q text, ent text, ent_id uuid, money boolean, closed boolean);
insert into ev select 'rfq', r.id, 'RFQ-' || r.number, 'rfq', r.id, false, r.closed_on is not null from public.rfqs r where r.company_id = pg_temp.f('01');
insert into ev select 'order', o.id, 'ORD-' || o.number, 'order', o.id, false, false from public.orders o where o.company_id = pg_temp.f('01');
insert into ev select 'item', i.id, i.description, 'order', i.order_id, false, false from public.order_items i where i.order_id in (select id from public.orders where company_id = pg_temp.f('01'));
insert into ev select 'po', p.id, 'PO-26-' || p.number, 'purchase_order', p.id, true, false from public.purchase_orders p where p.number between 914301 and 914303;
insert into ev select 'invoice', v.id, v.number, 'invoice', v.id, true, false from public.invoices v where v.number like 'INV-ZQEQ143-%';
grant select on ev to authenticated, qtech_engineer;

-- search_all: mismatches / rows compared / rows expected to be found, for one persona
create function pg_temp.cmp(persona text) returns text language plpgsql as $f$
begin
  return pg_temp.as_(persona, format($q$
    select format('%%s/%%s/%%s', count(*) filter (where got <> exp), count(*), count(*) filter (where exp > 0)) from (
      select (select count(*) from public.search_all(e.q, 25) s where s.id = e.id and s.kind = e.kind) as got,
             (case when (not e.money or %L in ('admin', 'sales')) and coalesce(not public.is_archived(e.ent, e.ent_id), false) then 1 else 0 end) as exp
      from ev e) z$q$, persona));
end
$f$;
-- search_closed_rfqs: mismatches / rows compared
create function pg_temp.cmp_closed(persona text) returns text language plpgsql as $f$
begin
  return pg_temp.as_(persona, $q$
    select format('%s/%s', count(*) filter (where got <> exp), count(*)) from (
      select (e.id in (select c.rfq_id from public.search_closed_rfqs('Zqeq143', 100, 0) c))::int as got,
             (e.closed and coalesce(not public.is_archived('rfq', e.id), false))::int as exp
      from ev e where e.kind = 'rfq') z$q$);
end
$f$;

-- ------------------------------------------------------------------ archiving OFF
select matches(pg_temp.cmp('admin'), '^0/\d+/\d+$', 'off: admin, search_all equals the oracle');
select matches(pg_temp.cmp('sales'), '^0/\d+/\d+$', 'off: sales, search_all equals the oracle');
select matches(pg_temp.cmp('engineer'), '^0/\d+/\d+$', 'off: engineer, search_all equals the oracle, no permission error');
select matches(pg_temp.cmp_closed('admin'), '^0/\d+$', 'off: admin, search_closed_rfqs equals the oracle');
select matches(pg_temp.cmp_closed('engineer'), '^0/\d+$', 'off: engineer, search_closed_rfqs equals the oracle, no permission error');
select is((select count(*) from ev e where public.is_archived(e.ent, e.ent_id)), 0::bigint, 'off: nothing is archived');

-- ------------------------------------------------------------------ archiving ON, cutoff 17 Nov 2026, with four rows unhidden
select is((select (public.archive_set(true, date '2026-11-17')).enabled), true, 'archiving switched on');
select is(public.archive_unhide('rfq', pg_temp.f('15')), true, 'rfq 15 unhidden');
select is(public.archive_unhide('order', pg_temp.f('25')), true, 'order 25 unhidden');
select is(public.archive_unhide('invoice', pg_temp.f('44')), true, 'invoice 44 unhidden');
select is(public.archive_unhide('purchase_order', pg_temp.f('63')), true, 'purchase order 63 unhidden');
select ok((select count(*) filter (where public.is_archived(e.ent, e.ent_id)) > 0 and count(*) filter (where not public.is_archived(e.ent, e.ent_id)) > 0 from ev e),
  'on: the fixture has both archived and visible rows (the comparison is not vacuous)');
select matches(pg_temp.cmp('admin'), '^0/\d+/[1-9]\d*$', 'on 17 Nov: admin, search_all equals the oracle');
select matches(pg_temp.cmp('sales'), '^0/\d+/[1-9]\d*$', 'on 17 Nov: sales, search_all equals the oracle');
select matches(pg_temp.cmp('engineer'), '^0/\d+/[1-9]\d*$', 'on 17 Nov: engineer, search_all equals the oracle, no permission error');
select matches(pg_temp.cmp_closed('admin'), '^0/\d+$', 'on 17 Nov: admin, search_closed_rfqs equals the oracle');
select matches(pg_temp.cmp_closed('sales'), '^0/\d+$', 'on 17 Nov: sales, search_closed_rfqs equals the oracle');
select matches(pg_temp.cmp_closed('engineer'), '^0/\d+$', 'on 17 Nov: engineer, search_closed_rfqs equals the oracle, no permission error');

-- spot checks by name, so the oracle itself is pinned
select is(pg_temp.as_('admin', format('select count(*) from public.search_all(%L, 25) where id = %L', 'RFQ-' || (select number from public.rfqs where id = pg_temp.f('11')), pg_temp.f('11'))), '0', 'on: the 16 Nov RFQ is hidden');
select is(pg_temp.as_('admin', format('select count(*) from public.search_all(%L, 25) where id = %L', 'RFQ-' || (select number from public.rfqs where id = pg_temp.f('15')), pg_temp.f('15'))), '1', 'on: the unhidden 16 Nov RFQ shows');
select is(pg_temp.as_('admin', format('select count(*) from public.search_all(%L, 25) where id = %L', 'RFQ-' || (select number from public.rfqs where id = pg_temp.f('14')), pg_temp.f('14'))), '0', 'on: an imported RFQ dated after the cutoff is hidden');
select is(pg_temp.as_('admin', format('select count(*) from public.search_all(%L, 25) where id = %L', 'ORD-' || (select number from public.orders where id = pg_temp.f('24')), pg_temp.f('24'))), '0', 'on: the undated imported order is hidden');
select is(pg_temp.as_('engineer', format('select count(*) from public.search_all(%L, 25) where id = %L', 'Zqeq143 item 2', pg_temp.f('32'))), '1', 'on: an engineer finds the item of a current order');
select is(pg_temp.as_('engineer', format('select count(*) from public.search_all(%L, 25) where id = %L', 'Zqeq143 item 1', pg_temp.f('31'))), '0', 'on: an engineer does not find the item of an archived order');

-- ------------------------------------------------------------------ archiving ON, far cutoff: every dated row is old, only the unhidden four show
select is((select (public.archive_set(true, date '2027-06-01')).enabled), true, 'cutoff moved to 1 Jun 2027');
select matches(pg_temp.cmp('admin'), '^0/\d+/[1-9]\d*$', 'far cutoff: admin, search_all equals the oracle');
select matches(pg_temp.cmp('sales'), '^0/\d+/[1-9]\d*$', 'far cutoff: sales, search_all equals the oracle');
select matches(pg_temp.cmp('engineer'), '^0/\d+/[1-9]\d*$', 'far cutoff: engineer, search_all equals the oracle, no permission error');
select matches(pg_temp.cmp_closed('admin'), '^0/\d+$', 'far cutoff: admin, search_closed_rfqs equals the oracle');
select matches(pg_temp.cmp_closed('engineer'), '^0/\d+$', 'far cutoff: engineer, search_closed_rfqs equals the oracle, no permission error');

-- ------------------------------------------------------------------ a missing settings row hides nothing
delete from public.archive_settings;
select matches(pg_temp.cmp('admin'), '^\d+/\d+/\d+$', 'no settings row: search_all still runs for admin');
select is(pg_temp.as_('admin', format('select count(*) from public.search_all(%L, 25) where id = %L', 'RFQ-' || (select number from public.rfqs where id = pg_temp.f('11')), pg_temp.f('11'))), '1', 'no settings row: the 16 Nov RFQ is found, nothing is hidden');
select is(pg_temp.as_('admin', format('select count(*) from public.search_closed_rfqs(%L, 100, 0) where rfq_id = %L', 'Zqeq143', pg_temp.f('11'))), '1', 'no settings row: the Closed search still finds the 16 Nov RFQ');

select * from finish();
rollback;
