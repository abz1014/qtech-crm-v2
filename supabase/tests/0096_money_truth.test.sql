-- 0096_money_truth (owner decision 1b of 2026-10-22; plan D3 and D6): imported records with money or goods open stay live after
-- a review; closed or settled ones are history; imported invoices are linked to their orders.
--   (a) the backfill rules (the migration's two UPDATE statements, run here on fixtures: the test database has no imported rows)
--   (b) the column check and the admin-only guard
--   (c) the PO helpers (the import's normaliser, in SQL)
--   (d) ORACLE: with legacy_review NULL, to_review or live, order_receivables, v_order_money, aging_as_of and
--       receivables_summary give exactly the figures they gave before; 'settled' zeroes the open balance
--   (e) set_legacy_review (and D6: costs complete)
--   (f) link_imported_invoices: certain and likely, ambiguous same-amount cases stay likely, a dry run changes nothing, applying
--       links only the certain ones inside a locked imported month, audited
--   (g) link_imported_invoice and unlink_imported_invoice, grants
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ machinery
create function pg_temp.u(p text, n int) returns uuid language sql immutable as
  $$ select (p || '0960000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;

-- Runs stmt as the persona (API role and claims, then 0081's pre_request as PostgREST does) and returns 'ok' or the SQLSTATE.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform qtech_private.pre_request();
    execute stmt;
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  return r;
end $f$;

-- ------------------------------------------------------------------ fixtures (as the table owner, admin claims)
insert into public.companies (id, name) values
  (pg_temp.u('c', 1), '0096 C1'), (pg_temp.u('c', 2), '0096 C2'), (pg_temp.u('c', 3), '0096 C3'), (pg_temp.u('c', 4), '0096 C4'),
  (pg_temp.u('c', 5), '0096 C5'), (pg_temp.u('c', 6), '0096 C6'), (pg_temp.u('c', 9), '0096 Supplier');

-- the linking fixtures: imported orders
insert into public.orders (id, company_id, ordered_on, customer_po_number, legacy_source) values
  (pg_temp.u('a', 1), pg_temp.u('c', 1), '2019-01-10', 'PO-9601', '{"sheet":"orders"}'),   -- O1  gross 1180
  (pg_temp.u('a', 2), pg_temp.u('c', 1), '2019-01-12', null,      '{"sheet":"orders"}'),   -- O2  gross 2360
  (pg_temp.u('a', 3), pg_temp.u('c', 2), '2019-01-15', null,      '{"sheet":"orders"}'),   -- O3  gross 590
  (pg_temp.u('a', 4), pg_temp.u('c', 2), '2019-01-16', null,      '{"sheet":"orders"}'),   -- O4  gross 590 (same amount as O3)
  (pg_temp.u('a', 5), pg_temp.u('c', 3), '2019-01-18', null,      '{"sheet":"orders"}'),   -- O5  gross 2000, 1200 already invoiced
  (pg_temp.u('a', 6), pg_temp.u('c', 1), '2019-01-20', 'PO-9602', '{"sheet":"orders"}'),   -- O6  gross 4720
  (pg_temp.u('a', 7), pg_temp.u('c', 4), '2019-01-22', 'PO-9603', '{"sheet":"orders"}'),   -- O7  gross 1180
  (pg_temp.u('a', 8), pg_temp.u('c', 4), '2019-01-23', null,      '{"sheet":"orders"}');   -- O8  gross 1180 (no PO on file)
insert into public.order_items (order_id, position, description, qty, unit, unit_price_net, gst_rate) values
  (pg_temp.u('a', 1), 0, 'item', 1, 'ea', 1000, 18), (pg_temp.u('a', 2), 0, 'item', 1, 'ea', 2000, 18),
  (pg_temp.u('a', 3), 0, 'item', 1, 'ea', 500, 18),  (pg_temp.u('a', 4), 0, 'item', 1, 'ea', 500, 18),
  (pg_temp.u('a', 5), 0, 'item', 1, 'ea', 2000, 0),  (pg_temp.u('a', 6), 0, 'item', 1, 'ea', 4000, 18),
  (pg_temp.u('a', 7), 0, 'item', 1, 'ea', 1000, 18), (pg_temp.u('a', 8), 0, 'item', 1, 'ea', 1000, 18);

-- imported invoices with no order (the ones to link), and the traps
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, notes, legacy_source) values
  (pg_temp.u('b', 1),  pg_temp.u('c', 1), 'T96-1',  '2019-02-05', 1000, 180, 'PO 9601', '{"sheet":"gst"}'),   -- I1 -> O1, PO and amount: certain
  (pg_temp.u('b', 2),  pg_temp.u('c', 1), 'T96-2',  '2019-02-10', 2000, 360, null,      '{"sheet":"gst"}'),   -- I2 -> O2, whole amount only: certain
  (pg_temp.u('b', 3),  pg_temp.u('c', 2), 'T96-3',  '2019-03-01', 500,  90,  null,      '{"sheet":"gst"}'),   -- I3 -> O3 or O4: ambiguous, likely
  (pg_temp.u('b', 5),  pg_temp.u('c', 3), 'T96-5',  '2019-03-10', 800,  0,   null,      '{"sheet":"gst"}'),   -- I5 -> O5, what is left to invoice: likely
  (pg_temp.u('b', 6),  pg_temp.u('c', 1), 'T96-6',  '2019-02-15', 4000, 720, 'PO 5555', '{"sheet":"gst"}'),   -- I6: another PO than O6, no proposal
  (pg_temp.u('b', 7),  pg_temp.u('c', 1), 'T96-7',  '2019-01-01', 1000, 180, null,      '{"sheet":"gst"}'),   -- I7: dated before O1, no proposal
  (pg_temp.u('b', 9),  pg_temp.u('c', 4), 'T96-9',  '2019-02-20', 1000, 180, 'PO 9603', '{"sheet":"gst"}'),   -- I9: O7 (PO) beats O8 (no PO): certain
  (pg_temp.u('b', 10), pg_temp.u('c', 5), 'T96-10', '2019-03-15', 250,  45,  null,      '{"sheet":"gst"}');   -- I10: no order of that amount
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover) values
  (pg_temp.u('b', 8),  pg_temp.u('c', 1), 'T96-8',  '2019-02-20', 1000, 180, '{"sheet":"gst"}', true);       -- I8: paid before the new system
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount) values
  (pg_temp.u('b', 11), pg_temp.u('c', 1), 'T96-11', '2019-02-25', 1000, 180);                                 -- NI: not imported
insert into public.invoices (id, order_id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source) values
  (pg_temp.u('b', 4),  pg_temp.u('a', 5), pg_temp.u('c', 3), 'T96-4', '2019-01-20', 1200, 0, '{"sheet":"gst"}');   -- IL: already on O5

-- the oracle fixtures (customer C5): OA and OB are the new system's, OC is imported
insert into public.orders (id, company_id, ordered_on, legacy_source) values
  (pg_temp.u('a', 11), pg_temp.u('c', 5), '2019-01-05', null),                       -- OA  invoiced 1180, paid 500
  (pg_temp.u('a', 12), pg_temp.u('c', 5), '2019-01-06', null),                       -- OB  no invoice, 590 paid in full
  (pg_temp.u('a', 13), pg_temp.u('c', 5), '2019-01-07', '{"sheet":"orders"}'),       -- OC  imported, invoiced 1180, unpaid
  (pg_temp.u('a', 14), pg_temp.u('c', 5), '2019-01-08', '{"sheet":"orders"}'),       -- OD  imported, no costs row yet
  (pg_temp.u('a', 15), pg_temp.u('c', 5), '2019-01-09', '{"sheet":"orders"}');       -- OE  imported, costs already complete
insert into public.order_items (order_id, position, description, qty, unit, unit_price_net, gst_rate) values
  (pg_temp.u('a', 11), 0, 'item', 1, 'ea', 1000, 18), (pg_temp.u('a', 12), 0, 'item', 1, 'ea', 500, 18),
  (pg_temp.u('a', 13), 0, 'item', 1, 'ea', 1000, 18), (pg_temp.u('a', 14), 0, 'item', 1, 'ea', 1000, 18),
  (pg_temp.u('a', 15), 0, 'item', 1, 'ea', 1000, 18);
insert into public.invoices (id, order_id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source) values
  (pg_temp.u('b', 21), pg_temp.u('a', 11), pg_temp.u('c', 5), 'T96-21', '2019-02-01', 1000, 180, null),                       -- IA
  (pg_temp.u('b', 22), pg_temp.u('a', 13), pg_temp.u('c', 5), 'T96-22', '2019-03-01', 1000, 180, '{"sheet":"gst"}'),         -- IC
  (pg_temp.u('b', 23), pg_temp.u('a', 14), null, 'T96-23', '2019-02-28', 1, 0, '{"sheet":"gst"}');                          -- IX: imported, no customer of its own
insert into public.payments_in (order_id, received_on, amount) values
  (pg_temp.u('a', 11), '2019-02-10', 500), (pg_temp.u('a', 12), '2019-02-11', 590);
insert into public.order_costs (order_id, costs_complete_at) values (pg_temp.u('a', 15), '2019-05-05 00:00:00+00');

-- the backfill fixtures (customer C6)
insert into public.orders (id, company_id, ordered_on, cancelled_on, legacy_source) values
  (pg_temp.u('a', 31), pg_temp.u('c', 6), '2019-01-02', null,         '{"sheet":"orders"}'),   -- BF1 paid, delivered              -> settled
  (pg_temp.u('a', 32), pg_temp.u('c', 6), '2019-01-02', null,         '{"sheet":"orders"}'),   -- BF2 unpaid                      -> to_review
  (pg_temp.u('a', 33), pg_temp.u('c', 6), '2019-01-02', null,         '{"sheet":"orders"}'),   -- BF3 paid, goods not delivered   -> to_review
  (pg_temp.u('a', 34), pg_temp.u('c', 6), '2019-01-02', '2019-01-30', '{"sheet":"orders"}'),   -- BF4 cancelled, never invoiced   -> settled
  (pg_temp.u('a', 35), pg_temp.u('c', 6), '2019-01-02', '2019-01-30', '{"sheet":"orders"}'),   -- BF5 cancelled but invoiced, unpaid -> to_review
  (pg_temp.u('a', 36), pg_temp.u('c', 6), '2019-01-02', null,         '{"sheet":"orders"}');   -- BF6 paid, services only         -> settled
insert into public.supplier_orders (id, order_id, supplier_id, currency, delivered_on) values
  (pg_temp.u('d', 31), pg_temp.u('a', 31), pg_temp.u('c', 9), 'PKR', '2019-01-20'),
  (pg_temp.u('d', 33), pg_temp.u('a', 33), pg_temp.u('c', 9), 'PKR', null);
insert into public.order_items (order_id, position, description, qty, unit, unit_price_net, gst_rate, is_service, supplier_order_id) values
  (pg_temp.u('a', 31), 0, 'goods', 1, 'ea', 1000, 18, false, pg_temp.u('d', 31)),
  (pg_temp.u('a', 32), 0, 'service', 1, 'ea', 1000, 18, true, null),
  (pg_temp.u('a', 33), 0, 'goods', 1, 'ea', 1000, 18, false, pg_temp.u('d', 33)),
  (pg_temp.u('a', 34), 0, 'goods', 1, 'ea', 1000, 18, false, null),
  (pg_temp.u('a', 35), 0, 'goods', 1, 'ea', 1000, 18, false, null),
  (pg_temp.u('a', 36), 0, 'service', 1, 'ea', 1000, 18, true, null);
insert into public.invoices (id, order_id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source) values
  (pg_temp.u('b', 33), pg_temp.u('a', 31), pg_temp.u('c', 6), 'T96-33', '2019-01-15', 1000, 180, '{"sheet":"gst"}'),    -- BI3 on a paid order
  (pg_temp.u('b', 34), pg_temp.u('a', 35), pg_temp.u('c', 6), 'T96-34', '2019-01-15', 1000, 180, '{"sheet":"gst"}');    -- BI4 on an unpaid, cancelled order
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source) values
  (pg_temp.u('b', 31), pg_temp.u('c', 6), 'T96-31', '2019-01-15', 7, 0, '{"sheet":"gst"}');                             -- BI1 no order
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover) values
  (pg_temp.u('b', 32), pg_temp.u('c', 6), 'T96-32', '2019-01-15', 8, 0, '{"sheet":"gst"}', true);                       -- BI2 paid before the new system
insert into public.payments_in (order_id, received_on, amount) values
  (pg_temp.u('a', 31), '2019-02-12', 1180), (pg_temp.u('a', 33), '2019-02-12', 1180), (pg_temp.u('a', 36), '2019-02-12', 1180);

-- every fixture row starts with no review state
select is((select count(*)::int from public.orders where id::text like 'a0960000%' and legacy_review is not null), 0,
  'fixture orders start with no review state (the migration ran on a database with no imported rows)');
select is((select count(*)::int from public.invoices where id::text like 'b0960000%' and legacy_review is not null), 0,
  'fixture invoices start with no review state');

-- ------------------------------------------------------------------ (a) the backfill (the migration's statements, on customer C6)
update public.orders o
set legacy_review = case
  when ((c.invoice_count > 0 or o.cancelled_on is null)
        and c.g > 0 and c.paid < c.g - 1)
    or (o.cancelled_on is null and exists (
          select 1
          from public.order_items i
          left join public.supplier_orders l on l.id = i.supplier_order_id
          where i.order_id = o.id and not i.is_service and (i.supplier_order_id is null or l.delivered_on is null)))
  then 'to_review' else 'settled' end
from (
  select x.id,
         iv.invoice_count,
         case when iv.invoice_count > 0 then iv.invoice_gross else it.items_gross end as g,
         pay.paid
  from public.orders x
  cross join lateral (
    select count(*) as invoice_count, coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross
    from public.invoices v where v.order_id = x.id
  ) iv
  cross join lateral (
    select coalesce(sum(l.line_net + l.line_gst), 0) as items_gross
    from (select round(i.qty * i.unit_price_net, 2) as line_net,
                 round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0) as line_gst
          from public.order_items i where i.order_id = x.id) l
  ) it
  cross join lateral (
    select coalesce(sum(p.amount), 0) as paid from public.payments_in p where p.order_id = x.id and p.voided_at is null
  ) pay
) c
where o.id = c.id and o.legacy_source is not null and o.legacy_review is null and o.company_id = pg_temp.u('c', 6);

update public.invoices v
set legacy_review = case
  when v.settled_before_cutover then 'settled'
  when v.order_id is null then 'to_review'
  when coalesce((select sum(p.amount) from public.payments_in p where p.order_id = v.order_id and p.voided_at is null), 0)
       >= (select sum(x.net_amount + x.gst_amount) from public.invoices x where x.order_id = v.order_id) - 1
    then 'settled'
  else 'to_review' end
where v.legacy_source is not null and v.legacy_review is null and v.company_id = pg_temp.u('c', 6);

select is((select array_agg(legacy_review order by id) from public.orders where company_id = pg_temp.u('c', 6)),
  array['settled', 'to_review', 'to_review', 'settled', 'to_review', 'settled'],
  'backfill: paid and delivered = settled; unpaid, or goods not delivered = to_review; cancelled and never invoiced = settled; cancelled but invoiced and unpaid = to_review; paid services only = settled');
select is((select array_agg(legacy_review order by id) from public.invoices where company_id = pg_temp.u('c', 6)),
  array['to_review', 'settled', 'settled', 'to_review'],
  'backfill: an invoice with no order = to_review; paid before cutover = settled; on a paid order = settled; on an unpaid order = to_review');
select is((select count(*)::int from public.orders where company_id = pg_temp.u('c', 5) and legacy_review is not null), 0,
  'backfill: a row the statement did not reach keeps NULL');
select is((select legacy_review from public.invoices where id = pg_temp.u('b', 11)), null,
  'a row that was not imported keeps NULL');

-- ------------------------------------------------------------------ (b) the column check and the guard
select throws_ok($$update public.orders set legacy_review = 'live' where id = '$$ || pg_temp.u('a', 11) || $$'$$, '23514', null,
  'a row that was not imported cannot carry a review state (check)');
select throws_ok($$update public.orders set legacy_review = 'bogus' where id = '$$ || pg_temp.u('a', 13) || $$'$$, '23514', null,
  'only to_review, live or settled are allowed (check)');
select is(pg_temp.as_('sales', format('update public.orders set legacy_review = %L where id = %L', 'live', pg_temp.u('a', 13))), '42501',
  'sales cannot change an order''s review state');
select is(pg_temp.as_('sales', format('update public.invoices set legacy_review = %L where id = %L', 'live', pg_temp.u('b', 22))), '42501',
  'sales cannot change an invoice''s review state');
select is(pg_temp.as_('admin', format('update public.orders set legacy_review = %L where id = %L', 'live', pg_temp.u('a', 13))), 'ok',
  'an admin can');
update public.orders set legacy_review = null where id = pg_temp.u('a', 13);

-- ------------------------------------------------------------------ (c) the PO helpers (import/src/transform/money.ts)
select is(qtech_private.po_tokens('PO# 253074 & 252993 & 254040'), array['252993', '253074', '254040'], 'po_tokens: three POs in one cell');
select is(qtech_private.po_tokens('PO 251809.'), array['251809'], 'po_tokens: prefix, space and trailing full stop are dropped');
select is(qtech_private.po_tokens('PO-9603'), qtech_private.po_tokens('PO 9603'), 'po_tokens: PO-9603 and PO 9603 are the same PO');
select is(qtech_private.po_tokens(null), '{}'::text[], 'po_tokens: nothing in, nothing out');
select is(qtech_private.po_from_notes('Delivered. PO# 1 & 2 (Unit A)'), '1 & 2', 'po_from_notes: reads PO# 1 & 2');
select is(qtech_private.po_from_notes('Position 4 shipped'), null, 'po_from_notes: Position is not a PO');
select is(qtech_private.po_from_notes('po no. AB-77/3 urgent'), 'AB-77/3', 'po_from_notes: lower case, no. and a mixed number');

-- ------------------------------------------------------------------ (d) the oracle
create function pg_temp.fp(p_orders uuid[]) returns jsonb language sql as $$
  select jsonb_build_object(
    'rec',   (select coalesce(jsonb_agg(to_jsonb(r) order by r.order_number), '[]') from public.order_receivables() r where r.order_id = any (p_orders)),
    'money', (select coalesce(jsonb_agg(to_jsonb(m) order by m.order_number), '[]') from public.v_order_money m where m.order_id = any (p_orders)),
    'aging', (select coalesce(jsonb_agg(to_jsonb(a) order by a.kind, a.invoice_number, a.order_number), '[]')
              from public.aging_as_of('2019-12-31') a where a.order_id = any (p_orders)))
$$;

create temp table base as select
  pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]) as j_all,
  pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12)]) as j_other,
  (select open_count from public.receivables_summary()) as open_count,
  (select overdue_count from public.receivables_summary()) as overdue_count,
  (select outstanding from public.receivables_summary()) as outstanding;
grant all on base to public;

-- hand-computed figures with no review state anywhere
select is((select balance from public.order_receivables(pg_temp.u('a', 11))), 680::numeric, 'OA: 1180 invoiced, 500 paid: 680 open');
select is((select payment_state from public.order_receivables(pg_temp.u('a', 11))), 'overdue', 'OA is overdue (invoiced 1 Feb 2019, 30 days)');
select is((select payment_state from public.order_receivables(pg_temp.u('a', 12))), 'settled', 'OB: 590 paid of 590: settled');
select is((select balance from public.order_receivables(pg_temp.u('a', 12))), 0::numeric, 'OB: nothing open');
select is((select balance from public.order_receivables(pg_temp.u('a', 13))), 1180::numeric, 'OC (imported, no review state): 1180 open');
select is((select payment_state from public.v_order_money where order_id = pg_temp.u('a', 13)), 'overdue', 'v_order_money: OC is overdue');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('a', 13)), 1180::numeric, 'v_order_money: OC receivable 1180');
select is((select remaining from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 21)), 680::numeric, 'aging: IA 680 remains');
select is((select remaining from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 22)), 1180::numeric, 'aging: IC 1180 remains');
select is((select advance_held from public.aging_as_of('2019-12-31') where kind = 'advance' and order_id = pg_temp.u('a', 12)), 590::numeric, 'aging: OB holds an advance of 590');
select is((select remaining from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 10)), 295::numeric, 'aging: the unlinked invoice I10 (295) is open');

-- to_review and live change nothing, on the order and on the invoice
update public.orders set legacy_review = 'to_review' where id = pg_temp.u('a', 13);
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: order reviewed to_review: every figure is unchanged');
update public.orders set legacy_review = 'live' where id = pg_temp.u('a', 13);
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: order reviewed live: every figure is unchanged');
update public.orders set legacy_review = null where id = pg_temp.u('a', 13);
update public.invoices set legacy_review = 'to_review' where id = pg_temp.u('b', 22);
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: invoice reviewed to_review: every figure is unchanged');
update public.invoices set legacy_review = 'live' where id = pg_temp.u('b', 22);
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: invoice reviewed live: every figure is unchanged');
update public.invoices set legacy_review = null where id = pg_temp.u('b', 22);
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: back to NULL: every figure is as at the start');

-- settled: the order
update public.orders set legacy_review = 'settled' where id = pg_temp.u('a', 13);
select is((select balance from public.order_receivables(pg_temp.u('a', 13))), 0::numeric, 'settled order: open balance 0');
select is((select is_overdue from public.order_receivables(pg_temp.u('a', 13))), false, 'settled order: not overdue');
select is((select payment_state from public.order_receivables(pg_temp.u('a', 13))), 'settled', 'settled order: state settled');
select is((select gross_target from public.order_receivables(pg_temp.u('a', 13))), 1180::numeric, 'settled order: the gross is as it was');
select is((select settled from public.order_receivables(pg_temp.u('a', 13))), 0::numeric, 'settled order: the money actually received (0) is as it was');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('a', 13)), 0::numeric, 'settled order: v_order_money receivable 0');
select is((select settled_ok from public.v_order_money where order_id = pg_temp.u('a', 13)), true, 'settled order: v_order_money settled_ok');
select is((select payment_state from public.v_order_money where order_id = pg_temp.u('a', 13)), 'settled', 'settled order: v_order_money state settled');
select is((select count(*)::int from public.aging_as_of('2019-12-31') where order_id = pg_temp.u('a', 13)), 0, 'settled order: no aging row');
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12)]), (select j_other from base), 'settled order: the other orders'' figures are unchanged');
select is((select open_count from public.receivables_summary()), (select open_count - 1 from base), 'receivables_summary: one fewer open order');
select is((select overdue_count from public.receivables_summary()), (select overdue_count - 1 from base), 'receivables_summary: one fewer overdue order');
select is((select outstanding from public.receivables_summary()), (select outstanding - 1180 from base), 'receivables_summary: 1180 less outstanding');
update public.orders set legacy_review = null where id = pg_temp.u('a', 13);

-- settled: the invoice (the order's only one)
update public.invoices set legacy_review = 'settled' where id = pg_temp.u('b', 22);
select is((select balance from public.order_receivables(pg_temp.u('a', 13))), 0::numeric, 'settled invoice (its order''s only one): balance 0');
select is((select payment_state from public.order_receivables(pg_temp.u('a', 13))), 'settled', 'settled invoice (its order''s only one): state settled');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('a', 13)), 0::numeric, 'settled invoice: v_order_money receivable 0');
select is((select count(*)::int from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 22)), 0, 'settled invoice: no aging row');
update public.invoices set legacy_review = null where id = pg_temp.u('b', 22);

-- settled: an invoice with no order
update public.invoices set legacy_review = 'settled' where id = pg_temp.u('b', 10);
select is((select count(*)::int from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 10)), 0, 'settled invoice with no order: no aging row');
update public.invoices set legacy_review = null where id = pg_temp.u('b', 10);
select is((select remaining from public.aging_as_of('2019-12-31') where invoice_id = pg_temp.u('b', 10)), 295::numeric, 'and it is open again when the state is cleared');
select is(pg_temp.fp(array[pg_temp.u('a', 11), pg_temp.u('a', 12), pg_temp.u('a', 13)]), (select j_all from base), 'ORACLE: everything cleared: every figure is as at the start');

-- ------------------------------------------------------------------ (e) set_legacy_review (and D6)
select is(pg_temp.as_('admin', format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'live')), 'ok', 'admin sets an order live');
select is((select legacy_review from public.orders where id = pg_temp.u('a', 14)), 'live', 'the order is live');
select is((select count(*)::int from public.order_costs where order_id = pg_temp.u('a', 14)), 0, 'live does not touch the costs');
select lives_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'settled'), 'admin settles an order');
select ok((select costs_complete_at is not null from public.order_costs where order_id = pg_temp.u('a', 14)), 'D6: settling an order marks its costs complete');
select is((select margin_state from public.v_order_money where order_id = pg_temp.u('a', 14)), 'final', 'D6: its margin is final, not provisional');
select lives_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 15), 'settled'), 'an order whose costs are already complete can be settled');
select is((select costs_complete_at from public.order_costs where order_id = pg_temp.u('a', 15)), '2019-05-05 00:00:00+00'::timestamptz, 'D6: an existing completion date is kept');
select lives_ok(format('select public.set_legacy_review(%L, %L, %L)', 'invoice', pg_temp.u('b', 10), 'live'), 'admin sets an invoice live');
select is((select legacy_review from public.invoices where id = pg_temp.u('b', 10)), 'live', 'the invoice is live');
select lives_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'to_review'), 'an order can go back to to_review');
select ok((select costs_complete_at is not null from public.order_costs where order_id = pg_temp.u('a', 14)), 'going back leaves the costs as they are');
update public.invoices set legacy_review = null where id = pg_temp.u('b', 10);

select throws_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 11), 'settled'), '23514',
  'This record was not imported, so it has no review state.', 'a record that was not imported has no review state');
select throws_ok(format('select public.set_legacy_review(%L, %L, %L)', 'invoice', pg_temp.u('b', 11), 'settled'), '23514',
  'This record was not imported, so it has no review state.', 'nor has an invoice that was not imported');
select throws_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 99), 'settled'), 'P0002', 'Imported record not found',
  'an unknown record is not found');
select throws_ok(format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'bogus'), '22023',
  'set_legacy_review needs kind order or invoice, and state to_review, live or settled', 'an unknown state is refused');
select throws_ok(format('select public.set_legacy_review(%L, %L, %L)', 'company', pg_temp.u('a', 14), 'live'), '22023',
  'set_legacy_review needs kind order or invoice, and state to_review, live or settled', 'an unknown kind is refused');
select is(pg_temp.as_('sales', format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'live')), '42501', 'sales are refused');
select is(pg_temp.as_('engineer', format('select public.set_legacy_review(%L, %L, %L)', 'order', pg_temp.u('a', 14), 'live')), '42501', 'an engineer is refused');
select throws_ok($$select public.set_legacy_review('order', null, 'live')$$, 'P0002', 'Imported record not found', 'a missing id is not found');

-- ------------------------------------------------------------------ (f) link_imported_invoices
select is(pg_temp.as_('sales', 'select * from public.link_imported_invoices()'), '42501', 'link_imported_invoices: sales are refused');
select is(pg_temp.as_('engineer', 'select * from public.link_imported_invoices()'), '42501', 'link_imported_invoices: an engineer is refused');
select is(pg_temp.as_('admin', 'select * from public.link_imported_invoices()'), 'ok', 'link_imported_invoices: an admin may call it (a dry run by default)');

create temp table dry as select * from public.link_imported_invoices() where invoice_id::text like 'b0960000%';
grant all on dry to public;

select is((select count(*)::int from dry), 6, 'dry run: six proposals (three certain, three likely)');
select is((select array_agg(invoice_id || ' ' || order_id order by invoice_id) from dry where confidence = 'certain'),
  array[pg_temp.u('b', 1) || ' ' || pg_temp.u('a', 1), pg_temp.u('b', 2) || ' ' || pg_temp.u('a', 2), pg_temp.u('b', 9) || ' ' || pg_temp.u('a', 7)],
  'certain: I1 to O1 (PO and amount), I2 to O2 (the whole amount, no PO), I9 to O7 (the PO decides between two orders of one amount)');
select is((select array_agg(invoice_id || ' ' || order_id order by invoice_id, order_id) from dry where confidence = 'likely'),
  array[pg_temp.u('b', 3) || ' ' || pg_temp.u('a', 3), pg_temp.u('b', 3) || ' ' || pg_temp.u('a', 4), pg_temp.u('b', 5) || ' ' || pg_temp.u('a', 5)],
  'likely: I3 to O3 and to O4 (same amount, no PO: ambiguous, both listed), I5 to O5 (only what is left to invoice)');
select is((select count(*)::int from dry where invoice_id in (pg_temp.u('b', 6), pg_temp.u('b', 7), pg_temp.u('b', 8), pg_temp.u('b', 10), pg_temp.u('b', 11))), 0,
  'no proposal for: another PO, dated before the order, paid before cutover, no order of that amount, not imported');
select ok((select 'the PO number matches' = any (reasons) from dry where invoice_id = pg_temp.u('b', 1)), 'reasons: I1 says the PO number matches');
select ok((select 'the amount is the order''s whole value (within Rs 1)' = any (reasons) from dry where invoice_id = pg_temp.u('b', 2)), 'reasons: I2 says the amount is the whole order value');
select ok((select '2 orders of this customer fit this invoice' = any (reasons) from dry where invoice_id = pg_temp.u('b', 3) and order_id = pg_temp.u('a', 3)),
  'reasons: I3 says 2 orders fit');
select ok((select 'the amount is what is left to invoice on the order (within Rs 1)' = any (reasons) from dry where invoice_id = pg_temp.u('b', 5)),
  'reasons: I5 says it is what is left to invoice');
select is((select count(*)::int from public.invoices where id::text like 'b0960000%' and order_id is not null and id in (pg_temp.u('b', 1), pg_temp.u('b', 2), pg_temp.u('b', 3), pg_temp.u('b', 5), pg_temp.u('b', 9))), 0,
  'the dry run links nothing');

-- a settled invoice is not proposed
update public.invoices set legacy_review = 'settled' where id = pg_temp.u('b', 5);
select is((select count(*)::int from public.link_imported_invoices() where invoice_id = pg_temp.u('b', 5)), 0, 'an invoice reviewed settled is not proposed');
update public.invoices set legacy_review = null where id = pg_temp.u('b', 5);
select is((select count(*)::int from public.link_imported_invoices() where invoice_id = pg_temp.u('b', 5)), 1, 'and is proposed again when the state is cleared');

-- lock the imported months (January to April 2019), then apply
select ok(qtech_private.lock_imported_months('2019-04-01') >= 4, 'the imported months are locked (as 0089 does)');
select ok(exists (select 1 from public.closed_months where month = '2019-02-01' and note = 'Imported'), 'February 2019, where I1 and I2 are dated, is a locked imported month');
select throws_ok(format('update public.invoices set order_id = %L where id = %L', pg_temp.u('a', 1), pg_temp.u('b', 1)), 'P0001', 'February 2019 is closed. An admin can reopen it.',
  'a plain update of an invoice in a locked month is still refused');

select is((select payment_state from public.order_receivables(pg_temp.u('a', 1))), 'unpaid', 'before linking, O1 has no invoice and no due date: unpaid');
select lives_ok($$select * from public.link_imported_invoices(false)$$, 'p_dry_run = false applies the certain proposals inside the locked months');
select is((select array_agg(id || ' ' || coalesce(order_id::text, '-') order by id) from public.invoices
           where id in (pg_temp.u('b', 1), pg_temp.u('b', 2), pg_temp.u('b', 3), pg_temp.u('b', 5), pg_temp.u('b', 9))),
  array[pg_temp.u('b', 1) || ' ' || pg_temp.u('a', 1), pg_temp.u('b', 2) || ' ' || pg_temp.u('a', 2), pg_temp.u('b', 3) || ' -', pg_temp.u('b', 5) || ' -',
        pg_temp.u('b', 9) || ' ' || pg_temp.u('a', 7)],
  'only the certain ones are linked; the likely ones are left alone');
select is((select count(*)::int from public.audit_log where table_name = 'invoices' and record_id = pg_temp.u('b', 1)::text and action = 'update'
             and new_value ->> 'order_id' = pg_temp.u('a', 1)::text and old_value ->> 'order_id' is null
             and changed_by = 'a0000000-0000-4000-8000-000000000001'), 1,
  'the link is audited: who, and the old and new order');
select is((select net_amount + gst_amount from public.invoices where id = pg_temp.u('b', 1)), 1180::numeric, 'nothing but order_id changed (the amount is as it was)');
select is(current_setting('qtech.legacy_link', true), 'off', 'the legacy_link allowance is switched off again');
select is((select count(*)::int from public.link_imported_invoices() where invoice_id::text like 'b0960000%' and confidence = 'certain'), 0, 'afterwards nothing certain is left to link');
select is((select count(*)::int from public.link_imported_invoices() where invoice_id::text like 'b0960000%'), 3, 'the three likely proposals remain');
select lives_ok($$select * from public.link_imported_invoices(false)$$, 'applying again is harmless');
select is((select count(*)::int from public.invoices where id in (pg_temp.u('b', 3), pg_temp.u('b', 5)) and order_id is not null), 0, 'and still links no likely one');
select is((select payment_state from public.order_receivables(pg_temp.u('a', 1))), 'overdue',
  'money follows the link: O1 is now read on its invoice (dated 5 Feb 2019, 30 days) and is overdue');
select is((select gross_target from public.order_receivables(pg_temp.u('a', 1))), 1180::numeric, 'with the invoice gross as its basis');

-- ------------------------------------------------------------------ (g) link_imported_invoice / unlink_imported_invoice
create temp table before_i3 as select to_jsonb(v) - 'updated_at' as j from public.invoices v where v.id = pg_temp.u('b', 3);
grant all on before_i3 to public;

select is(pg_temp.as_('sales', format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 3), pg_temp.u('a', 3))), '42501', 'link_imported_invoice: sales are refused');
select is(pg_temp.as_('engineer', format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 3), pg_temp.u('a', 3))), '42501', 'link_imported_invoice: an engineer is refused');
select is(pg_temp.as_('sales', format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 1))), '42501', 'unlink_imported_invoice: sales are refused');
select is(pg_temp.as_('engineer', format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 1))), '42501', 'unlink_imported_invoice: an engineer is refused');

select throws_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 5), pg_temp.u('a', 1)), '23514',
  'The invoice and the order belong to different customers.', 'a manual link across customers is refused');
select throws_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 11), pg_temp.u('a', 1)), '23514',
  'This invoice was not imported, so it cannot be linked here.', 'an invoice that was not imported is refused');
select throws_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 8), pg_temp.u('a', 1)), '23514',
  'This invoice was paid before the new system started, so it has no order to link to.', 'an invoice paid before cutover is refused');
select throws_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 1), pg_temp.u('a', 1)), '23514',
  'This invoice is already linked to an order. Unlink it first.', 'an invoice that is already linked is refused');
select throws_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 3), pg_temp.u('a', 99)), 'P0002', 'Imported record not found', 'an unknown order is not found');

select lives_ok(format('select public.link_imported_invoice(%L, %L)', pg_temp.u('b', 3), pg_temp.u('a', 4)), 'a likely proposal is linked by hand (March 2019 is locked)');
select is((select order_id from public.invoices where id = pg_temp.u('b', 3)), pg_temp.u('a', 4), 'I3 is on O4');
select is((select count(*)::int from public.audit_log where table_name = 'invoices' and record_id = pg_temp.u('b', 3)::text and action = 'update'
             and new_value ->> 'order_id' = pg_temp.u('a', 4)::text), 1, 'the manual link is audited');

select throws_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 11)), '23514',
  'This invoice was not imported, so it cannot be unlinked here.', 'unlink: an invoice that was not imported is refused');
select throws_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 10)), '23514',
  'This invoice is not linked to an order.', 'unlink: an invoice with no order is refused');
select throws_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 23)), '23514',
  'This invoice has no customer of its own, so it cannot be taken off its order.', 'unlink: an invoice with no customer of its own is refused');
select throws_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 99)), 'P0002', 'Imported record not found', 'unlink: an unknown invoice is not found');

select lives_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 3)), 'unlink works inside a locked imported month');
select is((select to_jsonb(v) - 'updated_at' from public.invoices v where v.id = pg_temp.u('b', 3)), (select j from before_i3),
  'unlink restores the invoice exactly as it was before the link (no order, same customer, same amounts)');
select is((select count(*)::int from public.link_imported_invoices() where invoice_id = pg_temp.u('b', 3)), 2, 'and it is proposed again, still ambiguous');
select lives_ok(format('select public.unlink_imported_invoice(%L)', pg_temp.u('b', 1)), 'a certain link can be undone');
select is((select order_id from public.invoices where id = pg_temp.u('b', 1)), null, 'I1 is unlinked');
select is((select confidence from public.link_imported_invoices() where invoice_id = pg_temp.u('b', 1)), 'certain', 'and is certain again');

-- grants: nobody but an admin through authenticated; no engineer role, no anon
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('link_imported_invoices', 'link_imported_invoice', 'unlink_imported_invoice', 'set_legacy_review')
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('qtech_engineer', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')),
  array['link_imported_invoice', 'link_imported_invoices', 'set_legacy_review', 'unlink_imported_invoice'],
  'the four RPCs are executable by authenticated (refused inside for non-admins), not by qtech_engineer or anon');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('link_imported_invoices', 'link_imported_invoice', 'unlink_imported_invoice', 'set_legacy_review') and p.prosecdef), 0,
  'and all four are SECURITY INVOKER');

select * from finish();
rollback;
