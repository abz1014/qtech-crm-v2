begin;
select * from no_plan();

-- P9 (migration 0066): v_supplier_stats.orders_count, supplier_item_evidence() and money_exceptions_input().
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
-- Fixtures are inserted as the table owner with the admin's claims; the functions are then called as each role.
-- Ids are literal UUIDs in the assertions (pg_temp helpers are not callable after SET ROLE): the last group is the fixture number
-- in hex. Companies c9000000- (0 customer, 1 to 4 suppliers), orders e9000000-, legs e9800000- (a leg has its order's number),
-- the family brand b9000000-1.

create function pg_temp.u(p text, n int) returns uuid language sql immutable as
  $$ select (p || '-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- one order with one procurement leg for supplier n_sup; day offsets are from today (negative = past), NULL = not set
create function pg_temp.leg(n_order int, n_sup int, placed int, expected int, delivered int,
                            cancelled boolean default false, item text default null, fam uuid default null)
returns void language plpgsql as $$
begin
  insert into public.orders (id, company_id, owner_id, ordered_on, cancelled_on)
  values (pg_temp.u('e9000000', n_order), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000002',
          public.today_pkt() + coalesce(placed, -60), case when cancelled then public.today_pkt() end);
  insert into public.supplier_orders (id, order_id, supplier_id, placed_on, expected_on, delivered_on, received_on, currency)
  values (pg_temp.u('e9800000', n_order), pg_temp.u('e9000000', n_order), pg_temp.u('c9000000', n_sup),
          public.today_pkt() + placed, public.today_pkt() + expected, public.today_pkt() + delivered,
          public.today_pkt() + delivered, 'USD');
  if item is not null then
    insert into public.order_items (order_id, position, description, family_id, qty, unit_price_net, supplier_order_id,
                                    supplier_unit_price)
    values (pg_temp.u('e9000000', n_order), 0, item, fam, 3, 1000, pg_temp.u('e9800000', n_order), 10);
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: memory
insert into public.companies (id, name)
select pg_temp.u('c9000000', g), case when g = 0 then 'P9 Customer' else 'P9 Supplier ' || g end from generate_series(0, 4) g;
insert into public.brands (id, name, kind) values (pg_temp.u('b9000000', 1), 'P9 Pressure transmitters', 'family');
-- Supplier 1: five orders of the target item: four live (one not delivered yet) and one cancelled.
select pg_temp.leg(1, 1, -120, -106, -100, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(2, 1,  -90,  -76,  -70, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(3, 1,  -60,  -46,  -41, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(4, 1,  -10,    4, null, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(5, 1,   -2,   10, null, true,  'Cerabar PMC51 transmitter');
-- Supplier 2: family-only history (two orders).
select pg_temp.leg(6, 2, -30, -16, -11, false, 'Yokogawa EJA transmitter', pg_temp.u('b9000000', 1));
select pg_temp.leg(7, 2, -80, -66, -60, false, 'Rosemount 3051 transmitter', pg_temp.u('b9000000', 1));
-- Supplier 4: one order with two legs (counts once), plus one cancelled order (counts not at all).
select pg_temp.leg(8, 4, -20, -6, -3, false, 'Cerabar PMC51 transmitter');
insert into public.supplier_orders (order_id, supplier_id, placed_on, expected_on, currency)
values (pg_temp.u('e9000000', 8), pg_temp.u('c9000000', 4), public.today_pkt() - 20, public.today_pkt() - 6, 'USD');
select pg_temp.leg(9, 4, -15, -5, -2, true);

-- ------------------------------------------------------------------ fixtures: money exceptions
-- The PO total is computed from the lines by a trigger (qty times unit_price), so the lines carry a quantity.
-- Orders: A overpaid; B clean; C cancelled with a payment; D payment dated before the order; E price basis unknown;
-- F a PKR leg paid above its PO; G a leg expected before it was placed; H an invoice whose GST is far from 18%;
-- I an expense dated before the order.
insert into public.orders (id, company_id, owner_id, ordered_on, cancelled_on, legacy_flags) values
  (pg_temp.u('e9100000', 1), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 2), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 3), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', '2026-05-03', '{}'),
  (pg_temp.u('e9100000', 4), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 5), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, array['value_basis_unknown']),
  (pg_temp.u('e9100000', 6), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 7), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 8), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-01', null, '{}'),
  (pg_temp.u('e9100000', 9), pg_temp.u('c9000000', 0), 'a0000000-0000-4000-8000-000000000001', '2026-05-10', null, '{}');
insert into public.order_items (order_id, position, description, qty, unit_price_net, gst_rate)
select pg_temp.u('e9100000', g), 0, 'P9 money item', 1, 1000, 18 from generate_series(1, 9) g;
insert into public.payments_in (id, order_id, received_on, amount) values
  (pg_temp.u('f9000000', 1), pg_temp.u('e9100000', 1), '2026-05-15', 1500),  -- A: above the gross of 1180
  (pg_temp.u('f9000000', 2), pg_temp.u('e9100000', 2), '2026-05-15', 100),   -- B: fine
  (pg_temp.u('f9000000', 3), pg_temp.u('e9100000', 3), '2026-05-15', 100),   -- C: on a cancelled order
  (pg_temp.u('f9000000', 4), pg_temp.u('e9100000', 4), '2026-04-01', 100);   -- D: before the order
insert into public.supplier_orders (id, order_id, supplier_id, placed_on, expected_on, currency) values
  (pg_temp.u('e9900000', 1), pg_temp.u('e9100000', 6), pg_temp.u('c9000000', 3), '2026-05-02', '2026-05-20', 'PKR'),   -- F: paid 1500 of 1000
  (pg_temp.u('e9900000', 2), pg_temp.u('e9100000', 2), pg_temp.u('c9000000', 3), '2026-05-02', '2026-05-20', 'PKR'),   -- B: paid 500 of 1000
  (pg_temp.u('e9900000', 3), pg_temp.u('e9100000', 7), pg_temp.u('c9000000', 3), '2026-05-10', '2026-05-05', 'PKR');   -- G: expected before placed
insert into public.purchase_orders (supplier_order_id, number, revision, currency, lines, total) values
  (pg_temp.u('e9900000', 1), 990001, 0, 'PKR', '[{"qty": 1, "unit_price": 1000}]'::jsonb, 1000),
  (pg_temp.u('e9900000', 2), 990002, 0, 'PKR', '[{"qty": 1, "unit_price": 1000}]'::jsonb, 1000);
insert into public.expenses (id, paid_on, amount_pkr, category_id, order_id, supplier_order_id) values
  (pg_temp.u('f9100000', 1), '2026-05-20', 900, 'ca7e0000-0000-4000-8000-000000000011', pg_temp.u('e9100000', 6), pg_temp.u('e9900000', 1)),
  (pg_temp.u('f9100000', 2), '2026-05-21', 600, 'ca7e0000-0000-4000-8000-000000000011', pg_temp.u('e9100000', 6), pg_temp.u('e9900000', 1)),
  (pg_temp.u('f9100000', 3), '2026-05-20', 500, 'ca7e0000-0000-4000-8000-000000000011', pg_temp.u('e9100000', 2), pg_temp.u('e9900000', 2)),
  (pg_temp.u('f9100000', 4), '2026-05-01', 100, 'ca7e0000-0000-4000-8000-000000000011', pg_temp.u('e9100000', 9), null);   -- I: before the order
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  (pg_temp.u('f9200000', 1), pg_temp.u('e9100000', 2), 'P9-OK', '2026-05-05', 1000, 180),   -- B: exactly the order's 18%
  (pg_temp.u('f9200000', 2), pg_temp.u('e9100000', 8), 'P9-GST', '2026-05-05', 1000, 100);  -- H: 10%, far from the order's 18%

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('supplier_item_evidence', 'money_exceptions_input')
             and not p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'both new functions are SECURITY INVOKER with a fixed search_path, executable by authenticated only');
select has_column('public', 'v_supplier_stats', 'orders_count', 'v_supplier_stats has orders_count');
select is((select column_name::text from information_schema.columns
           where table_schema = 'public' and table_name = 'v_supplier_stats' order by ordinal_position desc limit 1),
  'orders_count', 'and it is the last column (every earlier column keeps its place)');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'supplier_item_memory'), 1,
  'supplier_item_memory still exists once, unchanged');

-- ------------------------------------------------------------------ as sales: orders_count and the evidence rows
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select orders_count from public.v_supplier_stats where supplier_id = 'c9000000-0000-4000-8000-000000000001'::uuid), 4,
  'orders_count: four live orders (the cancelled one is out)');
select is((select orders_count from public.v_supplier_stats where supplier_id = 'c9000000-0000-4000-8000-000000000004'::uuid), 1,
  'orders_count: one order with two legs counts once, a cancelled order not at all');
select is((select orders_count from public.v_supplier_stats where supplier_id = 'c9000000-0000-4000-8000-000000000003'::uuid), 3,
  'orders_count: the PO legs of three different orders');
select is((select orders_count from public.v_supplier_stats where supplier_id = 'c9000000-0000-4000-8000-000000000001'::uuid), 4,
  'orders_count: supplier 1 again, by literal id');

select is((select array_agg(order_id order by evidence_rank)
           from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  array['e9000000-0000-4000-8000-000000000004'::uuid, 'e9000000-0000-4000-8000-000000000003'::uuid, 'e9000000-0000-4000-8000-000000000002'::uuid],
  'evidence: the three newest live orders at the best tier, newest first (the oldest and the cancelled one are out)');
select is((select array_agg(evidence_rank order by evidence_rank) from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  array[1, 2, 3]::smallint[], 'evidence: ranks 1 to 3');
select is((select array_agg(count_at_tier order by evidence_rank) from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  array[4, 4, 4], 'evidence: every row carries the number of orders at that tier (4)');
select is((select array_agg(tier order by evidence_rank) from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  array[0, 0, 0]::smallint[], 'evidence: tier 0 (same model)');
select is((select array_agg(delivered_after_days order by evidence_rank) from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  array[null, 19, 20]::int[], 'evidence: days from placed to delivered per order, NULL for the one not delivered yet');
select is((select array[placed_on, expected_on] from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter') where evidence_rank = 1),
  array[public.today_pkt() - 10, public.today_pkt() + 4], 'evidence: the placed and expected dates of the newest order');
select is((select delivered_on from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter') where evidence_rank = 1), null,
  'evidence: and it has no delivered date');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter', null, 2)), 2,
  'evidence: p_limit 2 returns two');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter', null, 99)), 4,
  'evidence: p_limit is capped at ten, so a big limit returns all four');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter', null, 0)), 1,
  'evidence: p_limit below 1 still returns one');
select is((select order_id from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter') where evidence_rank = 1),
  (select evidence_order_id from public.supplier_item_memory(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  'evidence: rank 1 is the order supplier_item_memory() cites');
select is((select evidence_count_at_tier from public.supplier_item_memory(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')),
  4, 'supplier_item_memory is unchanged: its count at the tier is still 4');
select is((select array[tier::int, count_at_tier] from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000002'::uuid], null::uuid, 'b9000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter') where evidence_rank = 1),
  array[3, 2], 'evidence: a family-only match gives tier 3 and the two orders in the family');
select is((select order_id from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000002'::uuid], null::uuid, 'b9000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter') where evidence_rank = 1),
  'e9000000-0000-4000-8000-000000000006'::uuid, 'evidence: the newer of the two is first');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000003'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')), 0,
  'evidence: a supplier with no orders at any tier has no rows');
select is((select array_agg(distinct supplier_id order by supplier_id) from public.supplier_item_evidence(
             array['c9000000-0000-4000-8000-000000000002'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, 'b9000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  array['c9000000-0000-4000-8000-000000000001'::uuid, 'c9000000-0000-4000-8000-000000000002'::uuid], 'evidence: several suppliers at once');
select is((select supplier_id from public.supplier_item_evidence(
             array['c9000000-0000-4000-8000-000000000002'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, 'b9000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter') limit 1),
  'c9000000-0000-4000-8000-000000000002'::uuid, 'evidence: rows follow the caller''s supplier order');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name = 'v_supplier_stats' and column_name ~ '(price|sell|spread|money)'), 1,
  'v_supplier_stats still has only the one price-like column it had (prices_hidden, a count)');
select ok(not exists (select 1 from pg_proc p, unnest(p.proargnames) n
                      where p.pronamespace = 'public'::regnamespace and p.proname = 'supplier_item_evidence'
                        and n ~ '(price|sell|spread|cost)'),
  'money safety: supplier_item_evidence has no price, selling price, spread or cost column');

select is(public.money_exceptions_input(), null, 'money: sales gets NULL');

-- ------------------------------------------------------------------ as engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.money_exceptions_input(), null, 'money: an engineer gets NULL');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')), 3,
  'evidence: an engineer reads the same three orders');
select is((select orders_count from public.v_supplier_stats where supplier_id = 'c9000000-0000-4000-8000-000000000001'::uuid), 4,
  'orders_count: and the same count');

-- ------------------------------------------------------------------ as admin: money_exceptions_input
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(public.money_exceptions_input() is not null, 'money: admin gets a document');
select is((select array_agg(k order by k) from jsonb_object_keys(public.money_exceptions_input()) k),
  array['expenses', 'invoices', 'legPaid', 'legs', 'money', 'orders', 'payments', 'pos'], 'money: the keys of the ReconciliationInput, plus legPaid');
select is((select array_agg(o ->> 'id' order by o ->> 'id') from jsonb_array_elements(public.money_exceptions_input() -> 'orders') o),
  (select array_agg(('e9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0')) order by ('e9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))) from generate_series(1, 9) g where g <> 2),
  'money: only the orders that matter come back (A, C, D, E, F, G, H, I), not the clean order B');
select is((select array_agg(o ->> 'orderId' order by o ->> 'orderId') from jsonb_array_elements(public.money_exceptions_input() -> 'money') o),
  (select array_agg(('e9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0')) order by ('e9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))) from generate_series(1, 9) g where g <> 2),
  'money: with their money rows');
select is((select array_agg(o ->> 'id' order by o ->> 'id') from jsonb_array_elements(public.money_exceptions_input() -> 'payments') o),
  array['f9000000-0000-4000-8000-000000000003'::uuid::text, 'f9000000-0000-4000-8000-000000000004'::uuid::text], 'money: only the payment on the cancelled order and the one dated before its order');
select is((select array_agg(o ->> 'id') from jsonb_array_elements(public.money_exceptions_input() -> 'expenses') o),
  array['f9100000-0000-4000-8000-000000000004'::uuid::text], 'money: only the expense dated before its order (the leg payments are summed in legPaid)');
select is((select array_agg(o ->> 'number') from jsonb_array_elements(public.money_exceptions_input() -> 'invoices') o),
  array['P9-GST'], 'money: only the invoice whose GST is off the order''s rate');
select is((select array_agg(o ->> 'id' order by o ->> 'id') from jsonb_array_elements(public.money_exceptions_input() -> 'legs') o),
  array['e9900000-0000-4000-8000-000000000001'::uuid::text, 'e9900000-0000-4000-8000-000000000003'::uuid::text], 'money: the overpaid leg and the leg with dates out of sequence');
select is((select o ->> 'label' from jsonb_array_elements(public.money_exceptions_input() -> 'legs') o where o ->> 'id' = 'e9900000-0000-4000-8000-000000000001'::uuid::text),
  'leg A', 'money: a leg keeps its letter within its order');
select is((select array[(o ->> 'legId'), (o ->> 'paid')] from jsonb_array_elements(public.money_exceptions_input() -> 'legPaid') o),
  array['e9900000-0000-4000-8000-000000000001'::uuid::text, '1500.00'], 'money: legPaid holds the sum of the leg''s payments (900 + 600)');
select is((select array[(o ->> 'legId'), (o ->> 'total')] from jsonb_array_elements(public.money_exceptions_input() -> 'pos') o),
  array['e9900000-0000-4000-8000-000000000001'::uuid::text, '1000.00'], 'money: and the PO it is compared with');
select is((select (o -> 'cancelled')::text from jsonb_array_elements(public.money_exceptions_input() -> 'orders') o where o ->> 'id' = 'e9100000-0000-4000-8000-000000000003'::uuid::text),
  'true', 'money: the cancelled order says so');
select is((select (o -> 'basisUnknown')::text from jsonb_array_elements(public.money_exceptions_input() -> 'orders') o where o ->> 'id' = 'e9100000-0000-4000-8000-000000000005'::uuid::text),
  'true', 'money: the unknown-basis order says so');
select is((select (o ->> 'grossTarget')::numeric from jsonb_array_elements(public.money_exceptions_input() -> 'money') o where o ->> 'orderId' = 'e9100000-0000-4000-8000-000000000001'::uuid::text),
  1180::numeric, 'money: an order''s gross target comes from the money views (1000 plus 18%)');

-- ------------------------------------------------------------------ deactivated and anon
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(public.money_exceptions_input(), null, 'money: a deactivated user gets NULL');
select is((select count(*)::int from public.supplier_item_evidence(array['c9000000-0000-4000-8000-000000000001'::uuid], null::uuid, null::uuid, 'Cerabar PMC51 transmitter')), 0,
  'evidence: a deactivated user gets no rows');
reset role;

set local role anon;
select throws_ok($$select public.money_exceptions_input()$$, '42501', null, 'money: anon cannot call money_exceptions_input');
select throws_ok($$select * from public.supplier_item_evidence(array[gen_random_uuid()], null, null, 'x')$$, '42501', null, 'evidence: anon cannot call supplier_item_evidence');
reset role;

select * from finish();
rollback;
