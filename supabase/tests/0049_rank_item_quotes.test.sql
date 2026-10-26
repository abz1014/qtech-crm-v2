begin;
select * from no_plan();

-- S24 (Amendment A8): rank_item_quotes() and the evidence columns of supplier_item_memory().
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
-- Fixtures are inserted as the table owner with the admin's claims; the function is then called as each role.
-- Ids are literal UUIDs in the assertions (pg_temp helpers are not callable after SET ROLE): the last group is the fixture number
-- in hex; companies c7000000- (0 is the customer, 1 to 22 suppliers), RFQs d7000000-, RFQ items d8000000-, orders e7000000-,
-- procurement legs e8000000- (a leg has its order's number), the family brand b7000000-.
-- Named fixtures: (a) same currency, (b) mixed currencies, (c) near-tie band, (d) reliability bands, (e) history tie-break,
-- (f) spread, (g) item coverage, (h) memory evidence, (i) access and money safety.

-- ------------------------------------------------------------------ helpers (used while inserting fixtures only)
create function pg_temp.u(p text, n int) returns uuid language sql immutable as
  $$ select (p || '-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- one quote line (and the inquiry, once) for supplier n_sup on item n_item of RFQ n_rfq
create function pg_temp.q(n_rfq int, n_item int, n_sup int, price numeric, cur text) returns void language sql as $$
  insert into public.supplier_inquiries (rfq_id, supplier_id, sent_on)
  values (pg_temp.u('d7000000', n_rfq), pg_temp.u('c7000000', n_sup), public.today_pkt() - 3)
  on conflict do nothing;
  insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
  select si.id, pg_temp.u('d8000000', n_item), price, cur
  from public.supplier_inquiries si
  where si.rfq_id = pg_temp.u('d7000000', n_rfq) and si.supplier_id = pg_temp.u('c7000000', n_sup);
$$;
-- one order with one procurement leg for supplier n_sup; day offsets are from today (negative = past), NULL = not set
create function pg_temp.leg(n_order int, n_sup int, placed int, expected int, delivered int,
                            cancelled boolean default false, item text default null, fam uuid default null)
returns void language plpgsql as $$
begin
  insert into public.orders (id, company_id, owner_id, ordered_on, cancelled_on)
  values (pg_temp.u('e7000000', n_order), pg_temp.u('c7000000', 0), 'a0000000-0000-4000-8000-000000000002',
          public.today_pkt() + coalesce(placed, -60), case when cancelled then public.today_pkt() end);
  insert into public.supplier_orders (id, order_id, supplier_id, placed_on, expected_on, delivered_on, received_on, currency)
  values (pg_temp.u('e8000000', n_order), pg_temp.u('e7000000', n_order), pg_temp.u('c7000000', n_sup),
          public.today_pkt() + placed, public.today_pkt() + expected, public.today_pkt() + delivered,
          public.today_pkt() + delivered, 'USD');
  if item is not null then
    insert into public.order_items (order_id, position, description, family_id, qty, unit_price_net, supplier_order_id,
                                    supplier_unit_price)
    values (pg_temp.u('e7000000', n_order), 0, item, fam, 1, 1000, pg_temp.u('e8000000', n_order), 10);
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: companies, brands, rates
insert into public.companies (id, name)
select pg_temp.u('c7000000', g), case when g = 0 then 'Fixture Customer' else 'Fixture Supplier ' || lpad(g::text, 2, '0') end
from generate_series(0, 30) g;
-- 0093 seeds the canonical categories, 'Pressure transmitters' among them: the fixture takes the seeded family over under its own id
update public.brands set id = pg_temp.u('b7000000', 1) where name = 'Pressure transmitters' and kind = 'family';
-- Rates: USD and CNY fresh (today), EUR stale (15 days), JPY unusable (40 days), AED none.
insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('USD', 280, public.today_pkt(), 'manual'),
  ('CNY', 40, public.today_pkt(), 'manual'),
  ('EUR', 300, public.today_pkt() - 15, 'auto'),
  ('JPY', 0.5, public.today_pkt() - 40, 'auto');

-- ------------------------------------------------------------------ fixtures: RFQs and items
insert into public.rfqs (id, company_id, owner_id)
select pg_temp.u('d7000000', g), pg_temp.u('c7000000', 0), 'a0000000-0000-4000-8000-000000000002'
from generate_series(1, 10) g;
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net) values
  (pg_temp.u('d8000000', 1),  pg_temp.u('d7000000', 1),  0, 'Fixture item a', 4, null),
  (pg_temp.u('d8000000', 2),  pg_temp.u('d7000000', 2),  0, 'Fixture item b', 2, null),
  (pg_temp.u('d8000000', 3),  pg_temp.u('d7000000', 3),  0, 'Fixture item c1', 1, null),
  (pg_temp.u('d8000000', 4),  pg_temp.u('d7000000', 4),  0, 'Fixture item c2', 1, null),
  (pg_temp.u('d8000000', 5),  pg_temp.u('d7000000', 5),  0, 'Fixture item d', 1, null),
  (pg_temp.u('d8000000', 6),  pg_temp.u('d7000000', 6),  0, 'Fixture item e', 1, null),
  (pg_temp.u('d8000000', 7),  pg_temp.u('d7000000', 7),  0, 'Pressure transmitter PX-100', 3, 134000),
  (pg_temp.u('d8000000', 8),  pg_temp.u('d7000000', 8),  0, 'Pressure transmitter PX-100', 3, null),
  (pg_temp.u('d8000000', 9),  pg_temp.u('d7000000', 9),  0, 'Unrelated widget ZZ-9', 3, null),
  (pg_temp.u('d8000000', 10), pg_temp.u('d7000000', 10), 0, 'Fixture item g1', 5, null),
  (pg_temp.u('d8000000', 11), pg_temp.u('d7000000', 10), 1, 'Fixture item g2', 7, null);

-- (a) same currency: AED has no rate and none is needed
select pg_temp.q(1, 1, 1, 100, 'AED');
select pg_temp.q(1, 1, 2, 90, 'AED');
-- (b) mixed currencies
select pg_temp.q(2, 2, 3, 400, 'USD');      -- 112,000 PKR
select pg_temp.q(2, 2, 4, 2900, 'CNY');     -- 116,000 PKR
select pg_temp.q(2, 2, 5, 380, 'EUR');      -- 114,000 PKR at a stale rate
select pg_temp.q(2, 2, 6, 1000000, 'JPY');  -- unusable rate
select pg_temp.q(2, 2, 7, 500, 'AED');      -- no rate
-- (c) near-tie band: supplier 9 is proven (3 deliveries, all on time)
select pg_temp.q(3, 3, 8, 100, 'USD');
select pg_temp.q(3, 3, 9, 101.5, 'USD');
select pg_temp.q(4, 4, 8, 100, 'USD');
select pg_temp.q(4, 4, 9, 103, 'USD');
select pg_temp.leg(1, 9, -40, -20, -25);
select pg_temp.leg(2, 9, -35, -15, -18);
select pg_temp.leg(3, 9, -30, -10, -12);
-- (d) reliability bands, three quotes at one price
select pg_temp.q(5, 5, 10, 100, 'USD');
select pg_temp.q(5, 5, 11, 100, 'USD');
select pg_temp.q(5, 5, 12, 100, 'USD');
select pg_temp.leg(4, 10, -30, -10, -12);      -- supplier 10: 2 deliveries on time, and a leg without expected_on
select pg_temp.leg(5, 10, -30, -10, -10);
select pg_temp.leg(6, 10, -30, null, -5);
select pg_temp.leg(g, 11, -50, -30, -32) from generate_series(7, 11) g;    -- supplier 11: 5 on time ...
select pg_temp.leg(12, 11, -50, -30, -26);                                  -- ... and 1 late by 4 days
select pg_temp.leg(g, 12, -50, -30, -31) from generate_series(13, 14) g;    -- supplier 12: 2 on time ...
select pg_temp.leg(15, 12, -50, -30, -28);                                   -- ... late by 2, 3, 4 and 10 days
select pg_temp.leg(16, 12, -50, -30, -27);
select pg_temp.leg(17, 12, -50, -30, -26);
select pg_temp.leg(18, 12, -50, -30, -20);
-- (e) history tie-break, one price, no delivery records
select pg_temp.q(6, 6, 13, 100, 'USD');
select pg_temp.q(6, 6, 14, 100, 'USD');
select pg_temp.q(6, 6, 15, 100, 'USD');
select pg_temp.q(6, 6, 16, 100, 'USD');
select pg_temp.leg(20, 13, -50, null, null);
select pg_temp.leg(21, 13, -40, null, null);
select pg_temp.leg(22, 13, -30, null, null);
select pg_temp.leg(23, 14, -50, null, null);
select pg_temp.leg(24, 14, -10, null, null);
select pg_temp.leg(25, 15, -5, null, null, true);     -- cancelled: does not count
select pg_temp.leg(26, 15, -45, null, null);
select pg_temp.leg(27, 15, -35, null, null);
select pg_temp.leg(28, 16, -60, null, null);
select pg_temp.leg(29, 16, -55, null, null);
-- (f) spread
select pg_temp.q(7, 7, 17, 400, 'USD');
select pg_temp.q(8, 8, 17, 400, 'USD');
select pg_temp.q(9, 9, 17, 400, 'USD');
insert into public.orders (id, company_id, owner_id, ordered_on)
values (pg_temp.u('e7000000', 40), pg_temp.u('c7000000', 0), 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 100);
insert into public.order_items (order_id, position, description, qty, unit_price_net)
values (pg_temp.u('e7000000', 40), 0, 'Pressure transmitter PX-100', 1, 131000);
-- (g) item coverage: supplier 18 quotes item 1 only, supplier 19 quotes both
select pg_temp.q(10, 10, 18, 50, 'USD');
select pg_temp.q(10, 10, 19, 60, 'USD');
select pg_temp.q(10, 11, 19, 70, 'USD');
-- (h) memory evidence; target item: 'Cerabar PMC51 transmitter' in the family 'Pressure transmitters'
select pg_temp.leg(60, 20, -60, -46, -41, false, 'Rosemount 3051 transmitter', pg_temp.u('b7000000', 1));
select pg_temp.leg(61, 20, -20, -6, null, false, 'Yokogawa EJA transmitter', pg_temp.u('b7000000', 1));
select pg_temp.leg(62, 21, -90, -75, -70, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(63, 21, -30, -16, -11, false, 'Cerabar PMC51 transmitter');
select pg_temp.leg(64, 21, -5, null, null, true, 'Cerabar PMC51 transmitter');
select pg_temp.leg(65, 21, -3, null, null, false, 'Yokogawa EJA transmitter', pg_temp.u('b7000000', 1));

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'rank_item_quotes'
             and not p.prosecdef and p.provolatile = 's'
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'rank_item_quotes is SECURITY INVOKER, STABLE, fixed search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'supplier_item_memory'
             and not p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'supplier_item_memory is still SECURITY INVOKER with a fixed search_path and the same grants');

-- ------------------------------------------------------------------ as admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- (a) same currency
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000001'::uuid)),
  array['c7000000-0000-4000-8000-000000000002'::uuid, 'c7000000-0000-4000-8000-000000000001'::uuid], '(a) lines in one currency rank on the raw price, cheapest first');
select ok((select bool_and(comparable and fx_state = 'same_currency' and pkr_unit_price is null) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000001'::uuid)),
  '(a) and need no rate: comparable, fx_state same_currency, no PKR figure');
select is((select within_band from public.rank_item_quotes('d7000000-0000-4000-8000-000000000001'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000001'::uuid), false,
  '(a) a line 11% above the best is outside the band');

-- (b) mixed currencies
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where rank is not null),
  array['c7000000-0000-4000-8000-000000000003'::uuid, 'c7000000-0000-4000-8000-000000000005'::uuid, 'c7000000-0000-4000-8000-000000000004'::uuid], '(b) USD, EUR (stale) and CNY rank on PKR at today''s rates');
select is((select array[pkr_unit_price, fx_rate_pkr] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000003'::uuid),
  array[112000.00, 280]::numeric[], '(b) USD 400 at 280 is PKR 112,000');
select is((select fx_state from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000003'::uuid), 'fresh', '(b) a rate from today is fresh');
select is((select fx_state from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000005'::uuid), 'stale', '(b) a 15-day-old rate is stale');
select is((select array[pkr_unit_price, fx_age_days::numeric] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000005'::uuid),
  array[114000.00, 15]::numeric[], '(b) a stale rate still ranks, and its age is returned');
select is((select pct_above_best from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000005'::uuid), 1.79::numeric,
  '(b) EUR is 1.79% above the best');
select ok((select bool_and(not comparable and rank is null and pkr_unit_price is null)
           from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id in ('c7000000-0000-4000-8000-000000000006'::uuid, 'c7000000-0000-4000-8000-000000000007'::uuid)),
  '(b) a line with an unusable or missing rate is not comparable, has no rank and no PKR figure');
select is((select array_agg(fx_state order by supplier_id) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) where supplier_id in ('c7000000-0000-4000-8000-000000000006'::uuid, 'c7000000-0000-4000-8000-000000000007'::uuid)),
  array['unusable', 'none'], '(b) and says why: unusable (over 30 days) or none');
select is((select supplier_id from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid) offset 4 limit 1), 'c7000000-0000-4000-8000-000000000007'::uuid,
  '(b) not-ranked lines are listed after the ranked ones');

-- (c) near-tie band
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000003'::uuid)),
  array['c7000000-0000-4000-8000-000000000009'::uuid, 'c7000000-0000-4000-8000-000000000008'::uuid], '(c) 1.5% apart: the proven supplier ranks first although it is dearer');
select ok((select bool_and(within_band) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000003'::uuid)), '(c) both lines are inside the band');
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000004'::uuid)),
  array['c7000000-0000-4000-8000-000000000008'::uuid, 'c7000000-0000-4000-8000-000000000009'::uuid], '(c) 3% apart: the cheaper supplier ranks first');
select is((select within_band from public.rank_item_quotes('d7000000-0000-4000-8000-000000000004'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000009'::uuid), false,
  '(c) and the dearer one is outside the band');

-- (d) reliability bands
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid)),
  array['c7000000-0000-4000-8000-00000000000b'::uuid, 'c7000000-0000-4000-8000-00000000000a'::uuid, 'c7000000-0000-4000-8000-00000000000c'::uuid], '(d) at one price: proven, then unproven, then often late');
select is((select array[reliability_band, deliveries, on_time, late]::int[] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000a'::uuid),
  array[2, 2, 2, 0], '(d) 2 of 2 on time is band 2 (unproven), and a leg without expected_on is not a delivery');
select is((select array[reliability_band, deliveries, on_time, late]::int[] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000b'::uuid),
  array[1, 6, 5, 1], '(d) 5 of 6 on time is band 1 (proven)');
select is((select array[reliability_band, deliveries, on_time, late]::int[] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000c'::uuid),
  array[3, 6, 2, 4], '(d) 2 of 6 on time is band 3 (often late)');
select is((select median_days_late from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000c'::uuid), 3.5::numeric,
  '(d) the median days late is shown with 3 or more late deliveries');
select is((select median_days_late from public.rank_item_quotes('d7000000-0000-4000-8000-000000000005'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000b'::uuid), null,
  '(d) and not with fewer');

-- (e) history tie-break
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000006'::uuid)),
  array['c7000000-0000-4000-8000-00000000000d'::uuid, 'c7000000-0000-4000-8000-00000000000e'::uuid, 'c7000000-0000-4000-8000-00000000000f'::uuid, 'c7000000-0000-4000-8000-000000000010'::uuid], '(e) equal price and band: more orders first, then the more recent order');
select is((select orders_count from public.rank_item_quotes('d7000000-0000-4000-8000-000000000006'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000f'::uuid), 2,
  '(e) a cancelled order does not count');
select is((select last_order_on from public.rank_item_quotes('d7000000-0000-4000-8000-000000000006'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000f'::uuid), public.today_pkt() - 35,
  '(e) and is not the last order');
select is((select last_order_number from public.rank_item_quotes('d7000000-0000-4000-8000-000000000006'::uuid) where supplier_id = 'c7000000-0000-4000-8000-00000000000e'::uuid),
  (select number from public.orders where id = 'e7000000-0000-4000-8000-000000000018'::uuid), '(e) the last order is named by its number');

-- (f) spread
select is((select array[sell_unit_net, pkr_unit_price, spread_unit, spread_total] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)),
  array[134000, 112000, 22000, 66000]::numeric[], '(f) the quoted price is used: spread 22,000 each, 66,000 for 3');
select is((select sell_source from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)), 'quoted', '(f) and it says so');
select is((select array[sell_unit_net, spread_unit, spread_total] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000008'::uuid)),
  array[131000, 19000, 57000]::numeric[], '(f) without a quoted price, the last price sold to this company is used');
select is((select sell_source from public.rank_item_quotes('d7000000-0000-4000-8000-000000000008'::uuid)), 'last_sold', '(f) and says so');
select is((select sell_order_number from public.rank_item_quotes('d7000000-0000-4000-8000-000000000008'::uuid)), (select number from public.orders where id = 'e7000000-0000-4000-8000-000000000028'::uuid),
  '(f) naming that order');
select is((select sell_on from public.rank_item_quotes('d7000000-0000-4000-8000-000000000008'::uuid)), public.today_pkt() - 100, '(f) and its date');
select ok((select sell_unit_net is null and spread_unit is null and spread_total is null and sell_source = 'none'
           from public.rank_item_quotes('d7000000-0000-4000-8000-000000000009'::uuid)),
  '(f) with neither, there is no spread and sell_source is none');

-- (g) item coverage
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-00000000000a'::uuid) where rfq_item_id = 'd8000000-0000-4000-8000-00000000000a'::uuid),
  array['c7000000-0000-4000-8000-000000000012'::uuid, 'c7000000-0000-4000-8000-000000000013'::uuid], '(g) item 1 ranks both quoting suppliers');
select is((select array_agg(supplier_id) from public.rank_item_quotes('d7000000-0000-4000-8000-00000000000a'::uuid) where rfq_item_id = 'd8000000-0000-4000-8000-00000000000b'::uuid),
  array['c7000000-0000-4000-8000-000000000013'::uuid], '(g) item 2 ranks only the supplier that quoted it');
select is((select rank from public.rank_item_quotes('d7000000-0000-4000-8000-00000000000a'::uuid) where rfq_item_id = 'd8000000-0000-4000-8000-00000000000b'::uuid), 1, '(g) as rank 1');
select is((select count(*)::int from public.rank_item_quotes('d7000000-0000-4000-8000-00000000000a'::uuid) where supplier_id = 'c7000000-0000-4000-8000-000000000012'::uuid), 1,
  '(g) a partial quote has no row for the items it did not cover');

-- (h) memory evidence
select is((select array[evidence_tier::int, evidence_delivered_after_days, evidence_count_at_tier]
           from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  array[0, 19, 2], '(h) newest order at the best tier: tier 0, delivered after 19 days, 2 legs at that tier (the cancelled one is out)');
select is((select evidence_order_id from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  'e7000000-0000-4000-8000-00000000003f'::uuid, '(h) and it is the newer of the two orders');
select is((select array[evidence_placed_on, evidence_expected_on, evidence_delivered_on]
           from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  array[public.today_pkt() - 30, public.today_pkt() - 16, public.today_pkt() - 11], '(h) with the leg''s placed, expected and delivered dates');
select is((select evidence_order_number from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  (select number from public.orders where id = 'e7000000-0000-4000-8000-00000000003f'::uuid), '(h) and the order number');
select is((select evidence_item_desc from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  'Cerabar PMC51 transmitter', '(h) and the ordered line');
select is((select evidence_tier::int from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000014'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  3, '(h) a family-only match gives evidence_tier 3');
select ok((select evidence_order_id = 'e7000000-0000-4000-8000-00000000003d'::uuid and evidence_delivered_on is null and evidence_delivered_after_days is null
                  and evidence_expected_on = public.today_pkt() - 6 and evidence_count_at_tier = 2
           from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000014'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  '(h) an order not delivered yet gives NULL days (and no delivered date)');
select ok((select evidence_tier is null and evidence_order_id is null and evidence_count_at_tier is null
           from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000016'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  '(h) a supplier with no orders has no evidence');

-- (i) access: admin can execute; the per-role runs are below
select lives_ok($$select * from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007')$$, '(i) admin can call rank_item_quotes');
select is((select count(*)::int from public.rank_item_quotes('00000000-0000-4000-8000-00000000dead')), 0,
  '(i) an unknown RFQ gives no rows');
select ok((select bool_and(sell_unit_net is not null and spread_unit is not null) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)),
  '(i) money safety: admin gets the selling price and the spread');

-- ------------------------------------------------------------------ as sales
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select array[sell_unit_net, spread_unit, spread_total] from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)),
  array[134000, 22000, 66000]::numeric[], '(i) money safety: sales gets the selling price and the spread');
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000003'::uuid)),
  array['c7000000-0000-4000-8000-000000000009'::uuid, 'c7000000-0000-4000-8000-000000000008'::uuid], '(i) and the same ranking');

-- ------------------------------------------------------------------ as engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select array_agg(supplier_id order by rank) from public.rank_item_quotes('d7000000-0000-4000-8000-000000000003'::uuid)),
  array['c7000000-0000-4000-8000-000000000009'::uuid, 'c7000000-0000-4000-8000-000000000008'::uuid], '(i) an engineer gets the same ranking');
select is((select count(*)::int from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)
           where sell_unit_net is not null or sell_source is not null or sell_order_number is not null or sell_on is not null
              or spread_unit is not null or spread_total is not null), 0,
  '(i) money safety: an engineer gets no selling price and no spread, though the RFQ item has a quoted price');
select is((select count(*)::int from public.rank_item_quotes('d7000000-0000-4000-8000-000000000008'::uuid)
           where sell_unit_net is not null or sell_source is not null or sell_order_number is not null or sell_on is not null
              or spread_unit is not null or spread_total is not null), 0,
  '(i) money safety: nor from the last price sold to the customer');
select ok((select bool_and(pkr_unit_price is not null and reliability_band is not null and orders_count is not null)
           from public.rank_item_quotes('d7000000-0000-4000-8000-000000000007'::uuid)),
  '(i) an engineer still sees the supplier prices and the reliability and history facts');
select is((select sell_unit_net from public.rank_item_quotes('d7000000-0000-4000-8000-000000000009'::uuid)), null, '(i) and no selling price on an item without one either');
select is((select evidence_delivered_after_days from public.supplier_item_memory(array['c7000000-0000-4000-8000-000000000015'::uuid], null::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'Cerabar PMC51 transmitter')),
  19, '(i) an engineer reads the memory evidence');

-- ------------------------------------------------------------------ deactivated
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.rank_item_quotes('d7000000-0000-4000-8000-000000000002'::uuid)), 0, '(i) a deactivated user gets no rows');
reset role;

-- ------------------------------------------------------------------ anon
set local role anon;
select throws_ok($$select * from public.rank_item_quotes(gen_random_uuid())$$, '42501', null,
  '(i) anon cannot call rank_item_quotes');
reset role;

select * from finish();
rollback;
