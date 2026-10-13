begin;
select plan(4);

-- S19 performance budget (DATA_MODEL 5c): p95 < 150 ms for supplier_item_memory on a fixture 10x today's volume
-- (about 1.5k inquiries and 1.2k quote lines). The fixture below is 10x the live volume on every table the function
-- reads: 1,760 RFQs and 3,520 items, 1,500 inquiries, 1,200 quote lines, 370 orders with about 1,100 order items,
-- 600 procurement legs, 300 purchase orders. Supplier activity is skewed on purpose (a few suppliers hold most of the
-- history, the way a real supplier list behaves), so the heavy suppliers are in the timed calls.
-- Timing is taken inside the test with clock_timestamp(), as the `authenticated` role, so row security (and its
-- current_user_role() checks) is part of what is measured. The numbers are printed in the test descriptions.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixture
insert into public.companies (id, name)
select ('c7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Perf company ' || g from generate_series(0, 40) g;
insert into public.brands (id, name, kind)
select ('c8000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Perf brand ' || g, case when g <= 6 then 'family' else 'brand' end
from generate_series(1, 30) g;

insert into public.rfqs (id, company_id, owner_id, received_on)
select ('d7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'c7000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - (g % 700)
from generate_series(1, 1760) g;

insert into public.rfq_items (id, rfq_id, position, description, brand_id, family_id, qty)
select ('d8000000-0000-4000-8000-' || lpad(to_hex(g * 2 + p), 12, '0'))::uuid,
       ('d7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       p,
       (array['Belimo', 'Hach', 'Siemens', 'Endress', 'Festo', 'Omron', 'Bently', 'Fluke'])[1 + (g + p) % 8] || ' ' ||
         (array['LF', 'NM', 'HQ', 'XK', 'PMA', 'SN', 'FT'])[1 + (g * 3 + p) % 7] || (1000 + (g * 7 + p * 13) % 400) ||
         (array['-SR', '', '-X', ' pro'])[1 + (g + p) % 4] || ' ' ||
         (array['actuator', 'transmitter', 'meter', 'valve', 'sensor', 'cable 24V', 'positioner'])[1 + (g + p * 2) % 7],
       ('c8000000-0000-4000-8000-' || lpad(to_hex(7 + (g + p) % 24), 12, '0'))::uuid,
       case when g % 3 = 0 then ('c8000000-0000-4000-8000-' || lpad(to_hex(1 + g % 6), 12, '0'))::uuid end,
       1 + (g % 5)
from generate_series(1, 1760) g, generate_series(0, 1) p;

-- Skewed supplier choice: low numbers are popular. u in [0,1) is a deterministic scramble of g.
create temp table perf_inq as
select g,
       1 + floor(40 * power(((g * 7919) % 1000) / 1000.0, 2))::int as sup
from generate_series(1, 1500) g;

insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, last_chased_on, no_offer_on)
select ('e7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('d7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('c7000000-0000-4000-8000-' || lpad(to_hex(sup), 12, '0'))::uuid,
       public.today_pkt() - (g % 700),
       case when g % 5 = 0 then public.today_pkt() - (g % 650) end,
       case when g % 11 = 0 then public.today_pkt() - (g % 650) end
from perf_inq;

insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency, lead_time, created_at)
select ('e7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('d8000000-0000-4000-8000-' || lpad(to_hex(g * 2), 12, '0'))::uuid,
       10 + g % 500,
       (array['USD', 'EUR', 'PKR', 'USD'])[1 + g % 4],
       (array['ex-stock', '2 weeks', '4-6 weeks', '3 days'])[1 + g % 4],
       now() - ((g % 690) || ' days')::interval
from generate_series(1, 1200) g;

insert into public.orders (id, company_id, owner_id, rfq_id, cancelled_on)
select ('a8000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'c7000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002',
       ('d7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       case when g % 20 = 0 then public.today_pkt() end
from generate_series(1, 370) g;

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on, received_on)
select ('a9000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('a8000000-0000-4000-8000-' || lpad(to_hex(1 + g % 370), 12, '0'))::uuid,
       ('c7000000-0000-4000-8000-' || lpad(to_hex(1 + floor(40 * power(((g * 104729) % 1000) / 1000.0, 2))::int), 12, '0'))::uuid,
       (array['USD', 'EUR', 'PKR'])[1 + g % 3],
       public.today_pkt() - (g % 600),
       public.today_pkt() - (g % 600) + 20,
       public.today_pkt() - (g % 600) + 20 + (g % 9) - 3
from generate_series(1, 600) g;

insert into public.order_items (id, order_id, position, description, brand_id, family_id, qty, unit_price_net,
                                supplier_order_id, supplier_unit_price, rfq_item_id)
select ('aa000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       so.order_id,
       g % 100,
       ri.description,
       ri.brand_id, ri.family_id, ri.qty, 100,
       so.id,
       case when g % 4 <> 0 then 5 + g % 300 end,
       ri.id
from generate_series(1, 1100) g
join public.supplier_orders so on so.id = ('a9000000-0000-4000-8000-' || lpad(to_hex(1 + g % 600), 12, '0'))::uuid
join public.rfq_items ri on ri.id = ('d8000000-0000-4000-8000-' || lpad(to_hex(2 * (1 + g % 1700) + (g % 2)), 12, '0'))::uuid;

insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines)
select ('55a00000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       so.id, 20000 + g, 0, public.today_pkt() - (g % 500), so.currency, 0,
       (select jsonb_agg(jsonb_build_object('order_item_id', oi.id, 'description', oi.description, 'qty', oi.qty,
                                            'unit', 'pcs', 'unit_price', coalesce(oi.supplier_unit_price, 9),
                                            'price_source', 'order'))
        from public.order_items oi where oi.supplier_order_id = so.id)
from generate_series(1, 300) g
join public.supplier_orders so on so.id = ('a9000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid
where exists (select 1 from public.order_items oi where oi.supplier_order_id = so.id);

insert into public.fx_rates (currency, rate_pkr, as_of, source)
select c, 100 + g, public.today_pkt() - g, 'auto' from unnest(array['USD', 'EUR']) c, generate_series(0, 400, 3) g;

analyze public.rfq_items, public.supplier_inquiries, public.supplier_quote_lines, public.orders, public.supplier_orders, public.order_items, public.purchase_orders, public.fx_rates, public.company_brands;

select ok((select count(*) from public.supplier_inquiries) >= 1500 and (select count(*) from public.supplier_quote_lines) >= 1200
          and (select count(*) from public.order_items) >= 900 and (select count(*) from public.purchase_orders) >= 200,
  format('fixture is 10x live volume: %s inquiries, %s quote lines, %s order items, %s POs',
         (select count(*) from public.supplier_inquiries), (select count(*) from public.supplier_quote_lines),
         (select count(*) from public.order_items), (select count(*) from public.purchase_orders)));

-- ------------------------------------------------------------------ timing
create temp table perf_runs (kind text, ms numeric);
grant all on perf_runs to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare
  t0 timestamptz;
  i int;
  sups uuid[];
  d text;
begin
  for i in 1 .. 80 loop
    -- A typical call: the shortlist for one item is the suppliers carrying its brand, about ten of them. Every fourth
    -- run takes the heaviest suppliers (ids 1-10); the others are spread over the whole list.
    select array_agg(('c7000000-0000-4000-8000-' || lpad(to_hex(s), 12, '0'))::uuid) into sups
    from (select case when i % 4 = 0 then k else 1 + (i * 3 + k * 4) % 40 end as s from generate_series(1, 10) k) x;
    select r.description into d from public.rfq_items r
    where r.id = ('d8000000-0000-4000-8000-' || lpad(to_hex(2 * (1 + (i * 37) % 1700)), 12, '0'))::uuid;

    t0 := clock_timestamp();
    perform * from public.supplier_item_memory(sups,
      ('c8000000-0000-4000-8000-' || lpad(to_hex(7 + i % 24), 12, '0'))::uuid, null, d);
    insert into perf_runs values ('memory', extract(epoch from clock_timestamp() - t0) * 1000);

    t0 := clock_timestamp();
    perform * from public.v_supplier_stats where supplier_id = any (sups);
    insert into perf_runs values ('stats', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;

reset role;

select ok((select percentile_cont(0.95) within group (order by ms) < 150 from perf_runs where kind = 'memory'),
  (select format('supplier_item_memory (10 suppliers) p95 %s ms, median %s ms, max %s ms over %s calls (budget 150 ms)',
                 round(percentile_cont(0.95) within group (order by ms)::numeric, 1),
                 round(percentile_cont(0.5) within group (order by ms)::numeric, 1),
                 round(max(ms), 1), count(*))
   from perf_runs where kind = 'memory'));
select ok((select percentile_cont(0.95) within group (order by ms) < 150 from perf_runs where kind = 'stats'),
  (select format('v_supplier_stats (10 suppliers) p95 %s ms, median %s ms, max %s ms over %s calls (budget 150 ms)',
                 round(percentile_cont(0.95) within group (order by ms)::numeric, 1),
                 round(percentile_cont(0.5) within group (order by ms)::numeric, 1),
                 round(max(ms), 1), count(*))
   from perf_runs where kind = 'stats'));
select ok((select count(*) from public.supplier_item_memory(
             array(select ('c7000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(1, 40) g),
             'c8000000-0000-4000-8000-000000000007', null, 'Belimo LF1100-SR actuator')) = 40,
  'the memory call returns one row per supplier on the 10x fixture');

select * from finish();
rollback;
