begin;
select plan(77);

-- S19 supplier memory: v_supplier_activity, v_supplier_stats, supplier_item_memory(), item_match_tier().
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
-- Fixtures are inserted as the table owner with the admin's claims. Dates are relative to today_pkt().
-- The BUILD_PLAN fixture tests (a)-(j) and the Amendment A2b fixtures (k)-(n) are labelled in the descriptions.

-- ------------------------------------------------------------------ helpers (session-local)
create function pg_temp.sid(n int) returns uuid language sql immutable as
  $$ select ('c5000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function pg_temp.bid(n int) returns uuid language sql immutable as
  $$ select ('c6000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function pg_temp.rid(n int) returns uuid language sql immutable as
  $$ select ('d5000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
create function pg_temp.iid(n int) returns uuid language sql immutable as
  $$ select ('d6000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- noon in Karachi, n days ago
create function pg_temp.ago(n int) returns timestamptz language sql stable as
  $$ select ((public.today_pkt() - n)::timestamp + interval '12 hours') at time zone 'Asia/Karachi' $$;
create function pg_temp.inq(n_rfq int, n_sup int, sent_ago int, chased_ago int default null,
                            no_offer_ago int default null, legacy boolean default false)
returns void language sql as $$
  insert into public.supplier_inquiries (rfq_id, supplier_id, sent_on, last_chased_on, no_offer_on, legacy_source)
  values (pg_temp.rid(n_rfq), pg_temp.sid(n_sup),
          public.today_pkt() - sent_ago,
          public.today_pkt() - chased_ago,
          public.today_pkt() - no_offer_ago,
          case when legacy then '{"import":1}'::jsonb end)
$$;
create function pg_temp.quote(n_rfq int, n_sup int, price numeric, cur text, lead text default null,
                              made timestamptz default null, flags text[] default '{}', legacy boolean default false)
returns void language sql as $$
  insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency, lead_time, created_at,
                                           legacy_flags, legacy_source)
  select si.id, pg_temp.iid(n_rfq), price, cur, lead, coalesce(made, now()), flags,
         case when legacy then '{"import":1}'::jsonb end
  from public.supplier_inquiries si
  where si.rfq_id = pg_temp.rid(n_rfq) and si.supplier_id = pg_temp.sid(n_sup)
$$;
create function pg_temp.plan_text(q text) returns text language plpgsql as $f$
declare r text := ''; line text;
begin
  for line in execute 'explain ' || q loop r := r || line || E'\n'; end loop;
  return r;
end;
$f$;

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('v_supplier_activity', 'v_supplier_stats')
             and coalesce(c.reloptions, '{}') @> array['security_invoker=true']), 2,
  'both supplier views are security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in ('public.v_supplier_activity'::regclass, 'public.v_supplier_stats'::regclass)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the supplier views');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('supplier_item_memory', 'item_match_tier')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'supplier_item_memory and item_match_tier are SECURITY INVOKER, fixed search_path, executable by authenticated only');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rfq_items_description_trgm_idx'
                  and indexdef like '%gin%gin_trgm_ops%'),
  'a pg_trgm GIN index exists on rfq_items');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'order_items_description_trgm_idx'
                  and indexdef like '%gin%gin_trgm_ops%'),
  'a pg_trgm GIN index exists on order_items');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'supplier_inquiries_supplier_sent_idx'
                  and indexdef like '%(supplier_id, sent_on)%'),
  'a B-tree index exists on supplier_inquiries(supplier_id, sent_on)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'supplier_quote_lines'
                  and indexdef like '%(rfq_item_id)%'),
  'and one on supplier_quote_lines(rfq_item_id)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: companies, brands, RFQs, items
insert into public.companies (id, name)
select pg_temp.sid(g), 'Supplier ' || g from generate_series(1, 24) g;
insert into public.companies (id, name) values ('c5000000-0000-4000-8000-0000000000f0', 'Customer');
insert into public.brands (id, name, kind) values
  (pg_temp.bid(1), 'Belimo', 'brand'),
  (pg_temp.bid(2), 'Hach', 'brand'),
  (pg_temp.bid(3), 'Brand A', 'brand'),
  (pg_temp.bid(4), 'Brand B', 'brand'),
  (pg_temp.bid(5), 'Actuators', 'family'),
  (pg_temp.bid(6), 'Siemens', 'brand');
insert into public.rfqs (id, company_id, owner_id)
select pg_temp.rid(g), 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002'
from generate_series(1, 44) g;
insert into public.rfq_items (id, rfq_id, position, description, brand_id)
select pg_temp.iid(g), pg_temp.rid(g), 0, 'Generic item ' || g, null from generate_series(1, 30) g;
insert into public.rfq_items (id, rfq_id, position, description, brand_id)
select pg_temp.iid(v.n), pg_temp.rid(v.n), 0, v.d, case when v.b is null then null else pg_temp.bid(v.b) end
from (values
  (31, 'Belimo LF24-SR actuator', 1),
  (32, 'Pressure transmitter PX-100', null),
  (33, 'Flow meter FM-200', null),
  (34, 'HQ1110 pH/EC meter with probes', 2),
  (35, '24V actuator', 1),
  (36, 'XK2040', 3),
  (37, 'Sensor SN-5000 pro', 6),
  (38, 'Sensor SN-5000 pro', 6),
  (39, 'Siemens 6ES7 PLC module', 6),
  (40, 'Siemens 6ES7 PLC module', 6),
  (41, 'Belimo LF24-SR actuator', 1),
  (42, 'Belimo LF24-SR actuator', 1),
  (43, 'Valve VX-300 DN50', null),
  (44, 'Hach turbidity pump', 2)
) as v (n, d, b);
-- Exchange rates: USD 280 today (manual), 270 twelve days ago (auto).
insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('USD', 280, public.today_pkt(), 'manual'),
  ('USD', 270, public.today_pkt() - 12, 'auto');

-- ------------------------------------------------------------------ fixtures: inquiries and quote lines
-- (b) supplier 2: two inquiries, one reply
select pg_temp.inq(1, 2, 20);
select pg_temp.inq(2, 2, 20);
select pg_temp.quote(1, 2, 10, 'PKR');
-- (c) supplier 3: five asked, four replied after 1, 2, 2 and 5 days
select pg_temp.inq(g, 3, 30) from generate_series(3, 7) g;
select pg_temp.quote(3, 3, 10, 'PKR', null, pg_temp.ago(29));
select pg_temp.quote(4, 3, 10, 'PKR', null, pg_temp.ago(28));
select pg_temp.quote(5, 3, 10, 'PKR', null, pg_temp.ago(28));
select pg_temp.quote(6, 3, 10, 'PKR', null, pg_temp.ago(25));
-- (d) supplier 4: four imported inquiries with imported replies
select pg_temp.inq(g, 4, 40, null, null, true) from generate_series(8, 11) g;
select pg_temp.quote(g, 4, 10, 'PKR', null, null, '{}', true) from generate_series(8, 11) g;
-- (e) supplier 5: imported quote with an unverified currency
select pg_temp.inq(39, 5, 40, null, null, true);
select pg_temp.quote(39, 5, 99, 'USD', 'ex-stock', null, '{currency_unverified}', true);
-- (f) supplier 6: imported quote on a guessed item
select pg_temp.inq(40, 6, 40, null, null, true);
select pg_temp.quote(40, 6, 99, 'PKR', null, null, '{item_guessed}', true);
-- (g) supplier 7: Belimo LF24-SR actuator three times, with different lead times and ages
select pg_temp.inq(31, 7, 10);
select pg_temp.quote(31, 7, 500, 'PKR', '2 weeks');
select pg_temp.inq(41, 7, 50);
select pg_temp.quote(41, 7, 450, 'PKR', '6-8 weeks', pg_temp.ago(49));
select pg_temp.inq(42, 7, 100);
select pg_temp.quote(42, 7, 400, 'PKR', '10 days', pg_temp.ago(99));
-- (h) suppliers 8 (A) and 9 (B) quote the same two items; item 32 is ordered from B, item 33 from B on a cancelled order
select pg_temp.inq(32, 8, 15);
select pg_temp.inq(32, 9, 15);
select pg_temp.inq(33, 8, 15);
select pg_temp.inq(33, 9, 15);
select pg_temp.quote(32, 8, 5, 'PKR');
select pg_temp.quote(32, 9, 6, 'PKR');
select pg_temp.quote(33, 8, 7, 'PKR');
select pg_temp.quote(33, 9, 8, 'PKR');
-- (i) supplier 10: sent 3 days ago, no reply
select pg_temp.inq(12, 10, 3);
-- (k) supplier 13: "HQ1110 pH/EC meter with probes", Hach; last chased 2 days ago
select pg_temp.inq(34, 13, 8, 2);
select pg_temp.quote(34, 13, 250, 'USD', '3 weeks');
-- (l) supplier 14: "24V actuator", Belimo
select pg_temp.inq(35, 14, 8);
select pg_temp.quote(35, 14, 60, 'PKR');
-- (m) supplier 15: "XK2040", Brand A
select pg_temp.inq(36, 15, 8);
select pg_temp.quote(36, 15, 70, 'PKR');
-- (n) supplier 16: rate captured at entry; supplier 17: imported line, no rate
select pg_temp.inq(37, 16, 1);
select pg_temp.quote(37, 16, 412, 'USD');
select pg_temp.inq(38, 17, 30, null, null, true);
select pg_temp.quote(38, 17, 100, 'USD', null, null, '{}', true);
-- no-offer only: supplier 18
select pg_temp.inq(43, 18, 12, null, 10);

-- ------------------------------------------------------------------ fixtures: orders, legs, POs
insert into public.orders (id, company_id, owner_id, cancelled_on) values
  ('a5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', null),
  ('a5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', public.today_pkt()),
  ('a5000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', null),
  ('a5000000-0000-4000-8000-000000000004', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', null),
  ('a5000000-0000-4000-8000-000000000005', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', public.today_pkt()),
  ('a5000000-0000-4000-8000-000000000006', 'c5000000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002', null);
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on, received_on) values
  -- (h) legs
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', pg_temp.sid(9), 'PKR', null, null, null),
  ('a6000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', pg_temp.sid(9), 'PKR', null, null, null),
  -- (j) supplier 11: late by 3, 9 and 12 days; supplier 12: late by 4 and 6 days, plus one on time
  ('a6000000-0000-4000-8000-0000000000b1', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(11), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 27),
  ('a6000000-0000-4000-8000-0000000000b2', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(11), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 21),
  ('a6000000-0000-4000-8000-0000000000b3', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(11), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 18),
  ('a6000000-0000-4000-8000-0000000000c1', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(12), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 26),
  ('a6000000-0000-4000-8000-0000000000c2', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(12), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 24),
  ('a6000000-0000-4000-8000-0000000000c3', 'a5000000-0000-4000-8000-000000000006', pg_temp.sid(12), 'PKR', null, public.today_pkt() - 30, public.today_pkt() - 30),
  -- ordered-price scenarios: supplier 19 has a PO, 20 an order price only, 21 a cancelled order, 22 a different item, 23 a leg without currency
  ('a6000000-0000-4000-8000-0000000000d1', 'a5000000-0000-4000-8000-000000000003', pg_temp.sid(19), 'USD', null, null, null),
  ('a6000000-0000-4000-8000-0000000000d2', 'a5000000-0000-4000-8000-000000000004', pg_temp.sid(20), 'EUR', null, null, null),
  ('a6000000-0000-4000-8000-0000000000d3', 'a5000000-0000-4000-8000-000000000005', pg_temp.sid(21), 'USD', null, null, null),
  ('a6000000-0000-4000-8000-0000000000d4', 'a5000000-0000-4000-8000-000000000004', pg_temp.sid(22), 'USD', null, null, null),
  ('a6000000-0000-4000-8000-0000000000d5', 'a5000000-0000-4000-8000-000000000004', pg_temp.sid(23), null, null, null, null);
insert into public.order_items (id, order_id, position, description, brand_id, qty, unit, unit_price_net,
                                supplier_order_id, supplier_unit_price, rfq_item_id) values
  ('a7000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 0, 'Pressure transmitter PX-100', null, 1, 'pcs', 1, 'a6000000-0000-4000-8000-000000000001', null, pg_temp.iid(32)),
  ('a7000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 0, 'Flow meter FM-200', null, 1, 'pcs', 1, 'a6000000-0000-4000-8000-000000000002', null, pg_temp.iid(33)),
  ('a7000000-0000-4000-8000-0000000000d1', 'a5000000-0000-4000-8000-000000000003', 0, 'HQ1110 pH/EC meter', pg_temp.bid(2), 2, 'pcs', 1, 'a6000000-0000-4000-8000-0000000000d1', 77, null),
  ('a7000000-0000-4000-8000-0000000000d2', 'a5000000-0000-4000-8000-000000000004', 0, 'HQ1110 pH/EC meter', pg_temp.bid(2), 3, 'pcs', 1, 'a6000000-0000-4000-8000-0000000000d2', 55, null),
  ('a7000000-0000-4000-8000-0000000000d3', 'a5000000-0000-4000-8000-000000000005', 0, 'HQ1110 pH/EC meter', pg_temp.bid(2), 1, 'pcs', 1, 'a6000000-0000-4000-8000-0000000000d3', 44, null),
  ('a7000000-0000-4000-8000-0000000000d4', 'a5000000-0000-4000-8000-000000000004', 1, 'Hach turbidity pump', pg_temp.bid(2), 1, 'pcs', 1, 'a6000000-0000-4000-8000-0000000000d4', 33, null),
  ('a7000000-0000-4000-8000-0000000000d5', 'a5000000-0000-4000-8000-000000000004', 2, 'HQ1110 pH/EC meter', pg_temp.bid(2), 1, 'pcs', 1, 'a6000000-0000-4000-8000-0000000000d5', 22, null);
insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines) values
  ('55000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000d1', 9101, 0, public.today_pkt() - 10, 'USD', 0,
   '[{"order_item_id":"a7000000-0000-4000-8000-0000000000d1","description":"HQ1110 pH/EC meter","qty":2,"unit":"pcs","unit_price":77,"price_source":"typed"}]');

-- ------------------------------------------------------------------ item_match_tier
select is(public.item_match_tier(public.model_tokens('Hach HQ1110 portable meter'), public.item_text_norm('Hach HQ1110 portable meter'),
            pg_temp.bid(2), null, public.model_tokens('HQ1110 pH/EC meter with probes'),
            public.item_text_norm('HQ1110 pH/EC meter with probes'), pg_temp.bid(2), null), 0::smallint,
  'item_match_tier: a shared model code with the same brand is tier 0');
select is(public.item_match_tier('{}', 'x', pg_temp.bid(1), null, '{}', 'x', pg_temp.bid(1), null, true), null,
  'item_match_tier: a guessed item never matches at tiers 0-2');
select is(public.item_match_tier('{}', 'x', null, pg_temp.bid(5), '{}', 'y', null, pg_temp.bid(5), true), 3::smallint,
  'item_match_tier: but a family match still counts as tier 3');
select is(public.item_match_tier('{}', 'pump housing seal', null, pg_temp.bid(5), '{}', 'pump housing seal kit', null, pg_temp.bid(5)),
  1::smallint, 'item_match_tier: no brand, same family and similarity >= 0.60 is tier 1');
select is(public.item_match_tier('{}', 'pump housing seal', null, pg_temp.bid(5), '{}', 'valve', null, pg_temp.bid(5)),
  3::smallint, 'item_match_tier: no brand, same family, low similarity is tier 3');

-- ------------------------------------------------------------------ (a) 0 inquiries -> no history
insert into public.company_brands (company_id, brand_id) values (pg_temp.sid(1), pg_temp.bid(1));
select ok((select asked = 0 and replied = 0 and no_offer = 0 and median_reply_days is null and chosen_of = 0
                  and deliveries = 0 and last_contact is null and brand_ids = array[pg_temp.bid(1)] and prices_hidden = 0
           from public.v_supplier_stats where supplier_id = pg_temp.sid(1)),
  '(a) a supplier with no inquiries has a row of zeros, no median, no contact and its brands: "no history yet"');
select is((select count(*)::int from public.v_supplier_stats where supplier_id = 'c5000000-0000-4000-8000-0000000000f0'), 0,
  'a company with no supplier side has no stats row');
select ok((select best_tier is null and not supplied_before and last_quote_on is null and last_po_on is null
                  and last_ordered_on is null and recent_lead_times is null
           from public.supplier_item_memory(array[pg_temp.sid(1)], pg_temp.bid(1), null, 'anything')),
  '(a) and its item memory is empty');

-- ------------------------------------------------------------------ (b) 2 inquiries, 1 reply
select ok((select asked = 2 and replied = 1 and reply_days_n = 1 and median_reply_days is null and quoted = 1 and no_offer = 0
           from public.v_supplier_stats where supplier_id = pg_temp.sid(2)),
  '(b) 2 asked, 1 replied: raw counts, no median (needs 3 replies)');

-- ------------------------------------------------------------------ (c) 5 asked, 4 replied [1,2,2,5]
select ok((select asked = 5 and replied = 4 and reply_days_n = 4 and median_reply_days = 2 and quoted = 4
           from public.v_supplier_stats where supplier_id = pg_temp.sid(3)),
  '(c) 5 asked, 4 replied with reply days [1,2,2,5]: replied 4 of 5, median 2');
select is((select array_agg(reply_days order by reply_days) from public.v_supplier_activity
           where supplier_id = pg_temp.sid(3) and replied), array[1, 2, 2, 5],
  '(c) v_supplier_activity gives calendar reply days from sent_on to the first quote line');
select ok((select first_reply_on is null and reply_days is null and not replied and not quoted and not no_offer and not is_legacy
           from public.v_supplier_activity where supplier_id = pg_temp.sid(3) and rfq_id = pg_temp.rid(7)),
  '(c) the silent inquiry has no reply fields');

-- ------------------------------------------------------------------ (d) legacy-only replies
select ok((select asked = 4 and replied = 4 and legacy_asked = 4 and reply_days_n = 0 and median_reply_days is null
           from public.v_supplier_stats where supplier_id = pg_temp.sid(4)),
  '(d) imported replies count towards asked and replied but give no median');
select ok((select bool_and(is_legacy) from public.v_supplier_activity where supplier_id = pg_temp.sid(4)),
  '(d) and are flagged is_legacy in the activity view');

-- ------------------------------------------------------------------ (e) currency_unverified
select ok((select replied = 1 and prices_hidden = 1 from public.v_supplier_stats where supplier_id = pg_temp.sid(5)),
  '(e) an unverified-currency quote still counts as a reply, and is counted as a hidden price');
select ok((select last_quote_price_hidden and last_quote_price is null and last_quote_currency is null
                  and last_quote_price_pkr is null and last_quote_fx_rate_pkr is null
                  and last_quote_on = public.today_pkt() - 40 and last_quote_lead_time = 'ex-stock' and last_quote_is_legacy
           from public.supplier_item_memory(array[pg_temp.sid(5)], pg_temp.bid(6), null, 'Siemens 6ES7 PLC module')),
  '(e) the memory card hides price and currency, keeps the lead time, and dates an imported line by the inquiry''s sent_on');

-- ------------------------------------------------------------------ (f) item_guessed
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(6)], pg_temp.bid(6), null, 'Siemens 6ES7 PLC module')),
  null, '(f) a guessed-item quote is absent from tier 0/1/2 matches');
select ok((select asked = 1 and replied = 1 from public.v_supplier_stats where supplier_id = pg_temp.sid(6)),
  '(f) but present at supplier level');

-- ------------------------------------------------------------------ (g) Belimo tiers
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(1), null, 'BELIMO LF24 SR actuator 24V')),
  1::smallint, '(g) "Belimo LF24-SR actuator" against "BELIMO LF24 SR actuator 24V" is tier 1');
select is((select best_tier_label from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(1), null, 'BELIMO LF24 SR actuator 24V')),
  'same item', '(g) labelled "same item"');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(1), null, 'Belimo damper')),
  2::smallint, '(g) against "Belimo damper" it is tier 2, "same brand"');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(2), null, 'Belimo LF24-SR actuator')),
  null, 'a model-code match under another brand is no match at all');
select ok((select last_quote_tier = 1 and last_quote_price = 500 and last_quote_currency = 'PKR' and last_quote_on = public.today_pkt()
                  and last_quote_lead_time = '2 weeks' and last_quote_qty = 1 and not last_quote_price_hidden
                  and last_quote_fx_rate_pkr = 1 and last_quote_price_pkr = 500.00
           from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(1), null, 'BELIMO LF24 SR actuator 24V')),
  'the last quote is the newest line at the best tier: price, currency, PKR at the captured rate, date, qty, lead time');
select is((select recent_lead_times from public.supplier_item_memory(array[pg_temp.sid(7)], pg_temp.bid(1), null, 'BELIMO LF24 SR actuator 24V')),
  array['2 weeks', '6-8 weeks'], 'the two newest lead-time strings are returned verbatim, newest first');
select ok((select asked = 3 and replied = 3 and reply_days_n = 3 and median_reply_days = 1
           from public.v_supplier_stats where supplier_id = pg_temp.sid(7)),
  'a median is shown from exactly 3 non-legacy replies (reply days [10,1,1])');

-- ------------------------------------------------------------------ (h) chosen
select ok((select chosen_of = 1 and chosen = 1 from public.v_supplier_stats where supplier_id = pg_temp.sid(9)),
  '(h) quoted by A and B, ordered from B: B is chosen 1 of 1');
select ok((select chosen_of = 1 and chosen = 0 from public.v_supplier_stats where supplier_id = pg_temp.sid(8)),
  '(h) A is chosen 0 of 1, and the cancelled order counts for neither');

-- ------------------------------------------------------------------ (i) too young to judge
select ok((select asked = 0 and replied = 0 from public.v_supplier_stats where supplier_id = pg_temp.sid(10)),
  '(i) an inquiry sent 3 days ago with no reply is not counted in asked');
select pg_temp.inq(13, 10, 3);
select pg_temp.quote(13, 10, 5, 'PKR');
select ok((select asked = 1 and replied = 1 from public.v_supplier_stats where supplier_id = pg_temp.sid(10)),
  '(i) but a young inquiry that has already replied is counted');

-- ------------------------------------------------------------------ (j) late deliveries
select ok((select deliveries = 3 and late = 3 and median_days_late = 9 from public.v_supplier_stats where supplier_id = pg_temp.sid(11)),
  '(j) legs late [3, 9, 12] days: late 3 of 3, median 9 days');
select ok((select deliveries = 3 and late = 2 and median_days_late is null from public.v_supplier_stats where supplier_id = pg_temp.sid(12)),
  '(j) two late legs out of three: counted, but no median below 3 late legs');

-- ------------------------------------------------------------------ (k) same model
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(13)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  0::smallint, '(k) "Hach HQ1110 portable meter" against "HQ1110 pH/EC meter with probes", both Hach, is tier 0');
select is((select best_tier_label from public.supplier_item_memory(array[pg_temp.sid(13)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'same model', '(k) labelled "same model"');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(13)], null, null, 'HQ1110 portable meter')),
  0::smallint, '(k) a target without a brand still matches on the model code');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(13)], pg_temp.bid(6), null, 'HQ1110 portable meter')),
  null, '(k) while another brand does not');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(13)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter',
                                                            pg_temp.rid(34))),
  null, 'excluding the RFQ being worked on removes its own quotes from memory');
select is((select last_contact from public.v_supplier_stats where supplier_id = pg_temp.sid(13)), public.today_pkt() - 2,
  'last_contact is the latest of sent, chased and relayed dates');

-- ------------------------------------------------------------------ (l) no tokens, no tier 0
select is(public.model_tokens('24V actuator'), '{}'::text[], '(l) "24V actuator" yields no model tokens');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(14)], pg_temp.bid(1), null, '24V actuator')),
  1::smallint, '(l) so it matches by brand and text (tier 1), never tier 0');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(14)], null, null, '24V actuator')),
  null, '(l) and with no brand or family there is no match at all');

-- ------------------------------------------------------------------ (m) cross-brand token
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(15)], pg_temp.bid(4), null, 'XK2040')),
  null, '(m) brand A "XK2040" against brand B "XK2040" is not tier 0 (nor any tier)');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(15)], pg_temp.bid(3), null, 'XK2040')),
  0::smallint, '(m) the same brand is tier 0');

-- ------------------------------------------------------------------ (n) captured rate "at the time"
update public.fx_rates set rate_pkr = 300 where currency = 'USD' and as_of = public.today_pkt() and source = 'manual';
select ok((select last_quote_fx_rate_pkr = 280 and last_quote_fx_rate_on = public.today_pkt() and last_quote_price = 412
                  and last_quote_currency = 'USD' and last_quote_price_pkr = 115360.00
           from public.supplier_item_memory(array[pg_temp.sid(16)], pg_temp.bid(6), null, 'Sensor SN-5000 pro')),
  '(n) the card shows the rate captured at entry (280), not today''s (300): USD 412 = PKR 115,360 at the time');
select ok((select last_quote_price = 100 and last_quote_currency = 'USD' and last_quote_fx_rate_pkr is null
                  and last_quote_fx_rate_on is null and last_quote_price_pkr is null and last_quote_is_legacy
           from public.supplier_item_memory(array[pg_temp.sid(17)], pg_temp.bid(6), null, 'Sensor SN-5000 pro')),
  '(n) an imported line with no captured rate shows the original currency only');

-- ------------------------------------------------------------------ no-offer
select ok((select asked = 1 and replied = 1 and no_offer = 1 and quoted = 0 and reply_days_n = 1 and median_reply_days is null
           from public.v_supplier_stats where supplier_id = pg_temp.sid(18)),
  'a declared no-offer is a reply and is counted as no_offer, not as a quote');
select is((select reply_days from public.v_supplier_activity where supplier_id = pg_temp.sid(18)), 2,
  'its reply days run from sent_on to no_offer_on');

-- ------------------------------------------------------------------ last PO price and last ordered price
select ok((select supplied_before and best_tier = 0 and last_po_tier = 0 and last_po_price = 77 and last_po_currency = 'USD'
                  and last_po_on = public.today_pkt() - 10 and last_po_qty = 2 and last_po_unit = 'pcs'
                  and last_quote_on is null
           from public.supplier_item_memory(array[pg_temp.sid(19)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'a PO line for the same model: supplied before, last PO price 77 USD, no quote');
select ok((select last_po_fx_rate_pkr = 270 and last_po_fx_rate_on = public.today_pkt() - 12 and last_po_price_pkr = 20790.00
           from public.supplier_item_memory(array[pg_temp.sid(19)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'the PO has no captured rate: the latest rate on or before the PO date is used and its date is shown');
select ok((select last_ordered_source = 'po' and last_ordered_price = 77 and last_ordered_currency = 'USD'
                  and last_ordered_price_pkr = 20790.00
           from public.supplier_item_memory(array[pg_temp.sid(19)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'last ordered price comes from the PO line, and the order line it was written back to is not counted twice');
select ok((select supplied_before and last_po_price is null and last_ordered_source = 'order' and last_ordered_price = 55
                  and last_ordered_currency = 'EUR' and last_ordered_price_pkr is null and last_ordered_qty = 3
           from public.supplier_item_memory(array[pg_temp.sid(20)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'with no PO ever issued, the last ordered price is the order item''s supplier price, labelled source = order');
select ok((select not supplied_before and best_tier is null and last_ordered_on is null
           from public.supplier_item_memory(array[pg_temp.sid(21)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'a cancelled order does not count as supplied, nor as an ordered price');
select ok((select not supplied_before and best_tier = 2 and best_tier_label = 'same brand'
           from public.supplier_item_memory(array[pg_temp.sid(22)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'a same-brand leg is tier 2: it does not count as supplied this item before (only tier 0 and 1 pre-tick)');
select ok((select supplied_before and last_ordered_price = 22 and last_ordered_currency is null and last_ordered_price_pkr is null
           from public.supplier_item_memory(array[pg_temp.sid(23)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  'a leg with no currency gives a price without a currency or a PKR figure');
select is((select last_contact from public.v_supplier_stats where supplier_id = pg_temp.sid(19)), public.today_pkt() - 10,
  'a PO date counts as contact');
select is((select best_tier from public.supplier_item_memory(array[pg_temp.sid(19)], pg_temp.bid(2), null, 'Hach HQ1110 portable meter',
                                                            'd5000000-0000-4000-8000-ffffffffffff')),
  0::smallint, 'excluding an unrelated RFQ changes nothing');

-- ------------------------------------------------------------------ memory never reorders
select is(array(select supplier_id from public.supplier_item_memory(
            array[pg_temp.sid(12), pg_temp.sid(1), pg_temp.sid(7), pg_temp.sid(13), pg_temp.sid(19)],
            pg_temp.bid(2), null, 'Hach HQ1110 portable meter')),
  array[pg_temp.sid(12), pg_temp.sid(1), pg_temp.sid(7), pg_temp.sid(13), pg_temp.sid(19)],
  'results come back in the caller''s order, whatever the match tiers');
select is((select count(*)::int from public.supplier_item_memory(array[pg_temp.sid(7), pg_temp.sid(7), null],
                                                                pg_temp.bid(1), null, 'Belimo')), 1,
  'duplicate and null ids give one row');
select is((select count(*)::int from public.supplier_item_memory(array[]::uuid[], null, null, 'x')), 0,
  'an empty list gives no rows');

-- ------------------------------------------------------------------ roles
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok((select count(*) from public.v_supplier_stats) >= 15 and (select count(*) from public.v_supplier_activity) >= 20,
  'sales can read both supplier views');
select is((select best_tier from public.supplier_item_memory(array['c5000000-0000-4000-8000-000000000007'::uuid], 'c6000000-0000-4000-8000-000000000001'::uuid, null, 'BELIMO LF24 SR actuator 24V')),
  1::smallint, 'and call supplier_item_memory');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select ok((select count(*) from public.v_supplier_stats) >= 15, 'an engineer can read the stats');
select is((select best_tier from public.supplier_item_memory(array['c5000000-0000-4000-8000-000000000007'::uuid], 'c6000000-0000-4000-8000-000000000001'::uuid, null, 'BELIMO LF24 SR actuator 24V')),
  1::smallint, 'and the memory');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_supplier_stats), 0, 'a deactivated user sees no stats');
select is((select count(*)::int from public.v_supplier_activity), 0, 'and no activity');
select ok((select best_tier is null and not supplied_before and last_quote_on is null
           from public.supplier_item_memory(array['c5000000-0000-4000-8000-000000000007'::uuid], 'c6000000-0000-4000-8000-000000000001'::uuid, null, 'BELIMO LF24 SR actuator 24V')),
  'and an empty memory row');
reset role;

-- ------------------------------------------------------------------ anon
set local role anon;
select throws_ok($$select * from public.v_supplier_stats$$, '42501', null, 'anon cannot read v_supplier_stats');
select throws_ok($$select * from public.v_supplier_activity$$, '42501', null, 'anon cannot read v_supplier_activity');
select throws_ok($$select * from public.supplier_item_memory(array[gen_random_uuid()], null, null, 'x')$$, '42501', null,
  'anon cannot call supplier_item_memory');
reset role;

-- ------------------------------------------------------------------ the trigram indexes are usable
set local enable_seqscan = off;
select matches(pg_temp.plan_text($$select 1 from public.rfq_items where public.item_text_norm(description) operator(extensions.%) 'belimo actuator'$$),
  'rfq_items_description_trgm_idx', 'the planner can use the rfq_items trigram index for the % operator');
select matches(pg_temp.plan_text($$select 1 from public.order_items where public.item_text_norm(description) operator(extensions.%) 'belimo actuator'$$),
  'order_items_description_trgm_idx', 'and the order_items one');

select * from finish();
rollback;
