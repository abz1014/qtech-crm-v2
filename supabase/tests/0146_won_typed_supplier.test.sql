begin;
select * from no_plan();

-- 0146 (quote first): Mark won names the supplier and its price itself, with no supplier reply entered.
-- Fixture users from supabase/seed.sql: admin a0..01, sales a0..02. Ids: companies c9460000-..-N, RFQs d9460000-..-N,
-- items d9461000-..-N, inquiries d9462000-..-N, quote lines d9463000-..-N, orders f9460000-..-N.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c9460000-0000-4000-8000-000000000001', 'Typed Supplier Customer'),
  ('c9460000-0000-4000-8000-000000000002', 'Typed Supplier A'),
  ('c9460000-0000-4000-8000-000000000003', 'Typed Supplier B');
insert into public.rfqs (id, company_id, owner_id) values
  ('d9460000-0000-4000-8000-000000000001', 'c9460000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),  -- no replies at all
  ('d9460000-0000-4000-8000-000000000002', 'c9460000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),  -- a reply and a typed one
  ('d9460000-0000-4000-8000-000000000003', 'c9460000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');  -- refusals
insert into public.rfq_items (id, rfq_id, position, description, qty, unit, gst_rate) values
  ('d9461000-0000-4000-8000-000000000001', 'd9460000-0000-4000-8000-000000000001', 0, 'Panel, typed USD', 2, 'pcs', 18),
  ('d9461000-0000-4000-8000-000000000002', 'd9460000-0000-4000-8000-000000000001', 1, 'Cable, same supplier USD', 5, 'pcs', 18),
  ('d9461000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000001', 2, 'Relay, other supplier no price', 1, 'pcs', 18),
  ('d9461000-0000-4000-8000-000000000011', 'd9460000-0000-4000-8000-000000000002', 0, 'From the reply', 1, 'pcs', 18),
  ('d9461000-0000-4000-8000-000000000012', 'd9460000-0000-4000-8000-000000000002', 1, 'Typed, same supplier as the reply', 1, 'pcs', 18),
  ('d9461000-0000-4000-8000-000000000021', 'd9460000-0000-4000-8000-000000000003', 0, 'Refusal item', 1, 'pcs', 18);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('d9462000-0000-4000-8000-000000000011', 'd9460000-0000-4000-8000-000000000002', 'c9460000-0000-4000-8000-000000000002', public.today_pkt()),
  ('d9462000-0000-4000-8000-000000000021', 'd9460000-0000-4000-8000-000000000003', 'c9460000-0000-4000-8000-000000000002', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('d9463000-0000-4000-8000-000000000011', 'd9462000-0000-4000-8000-000000000011', 'd9461000-0000-4000-8000-000000000011', 40, 'USD'),
  ('d9463000-0000-4000-8000-000000000021', 'd9462000-0000-4000-8000-000000000021', 'd9461000-0000-4000-8000-000000000021', 9, 'USD');

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'convert_rfq_to_order'), 1,
  'still one convert_rfq_to_order');
select ok(has_function_privilege('authenticated', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute')
      and not has_function_privilege('anon', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute')
      and not has_function_privilege('qtech_engineer', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute'),
  'authenticated may convert, anon and an engineer may not');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ no reply entered: suppliers typed at Mark won
select is(public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000001', 'd9460000-0000-4000-8000-000000000001',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000001","unit_price_net":50000,"supplier_id":"c9460000-0000-4000-8000-000000000002","supplier_unit_price":35,"currency":"usd"},
      {"rfq_item_id":"d9461000-0000-4000-8000-000000000002","unit_price_net":900,"supplier_id":"c9460000-0000-4000-8000-000000000002","supplier_unit_price":2.5,"currency":"USD"},
      {"rfq_item_id":"d9461000-0000-4000-8000-000000000003","unit_price_net":7000,"supplier_id":"c9460000-0000-4000-8000-000000000003"}]'::jsonb),
  'f9460000-0000-4000-8000-000000000001'::uuid, 'an RFQ with no supplier reply converts with typed suppliers');
select is((select count(*)::int from public.supplier_orders where order_id = 'f9460000-0000-4000-8000-000000000001'), 2,
  'one supplier order per supplier and currency');
select is((select array_agg(currency::text order by currency) from public.supplier_orders
           where order_id = 'f9460000-0000-4000-8000-000000000001' and supplier_id = 'c9460000-0000-4000-8000-000000000002'), array['USD'],
  'supplier A in USD (the currency is upper-cased)');
select is((select inquiry_id from public.supplier_orders
           where order_id = 'f9460000-0000-4000-8000-000000000001' and supplier_id = 'c9460000-0000-4000-8000-000000000002'), null::uuid,
  'with no inquiry');
select is((select currency from public.supplier_orders
           where order_id = 'f9460000-0000-4000-8000-000000000001' and supplier_id = 'c9460000-0000-4000-8000-000000000003'), null::char(3),
  'supplier B, with no price yet, has no currency yet');
select is((select array_agg(supplier_unit_price order by position) from public.order_items where order_id = 'f9460000-0000-4000-8000-000000000001'),
  array[35, 2.5, null]::numeric[], 'each line carries the supplier price typed for it');
select ok((select bool_and(i.supplier_order_id = l.id) from public.order_items i join public.supplier_orders l on l.order_id = i.order_id
           and l.supplier_id = case when i.position = 2 then 'c9460000-0000-4000-8000-000000000003'::uuid else 'c9460000-0000-4000-8000-000000000002'::uuid end
           where i.order_id = 'f9460000-0000-4000-8000-000000000001'),
  'and each line is on its supplier''s order');

-- ------------------------------------------------------------------ a reply and a typed line for the same supplier share one leg
select is(public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000002', 'd9460000-0000-4000-8000-000000000002',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000011","unit_price_net":9000,"quote_line_id":"d9463000-0000-4000-8000-000000000011"},
      {"rfq_item_id":"d9461000-0000-4000-8000-000000000012","unit_price_net":800,"supplier_id":"c9460000-0000-4000-8000-000000000002","supplier_unit_price":3,"currency":"USD"}]'::jsonb),
  'f9460000-0000-4000-8000-000000000002'::uuid, 'a reply line and a typed line convert together');
select is((select count(*)::int from public.supplier_orders where order_id = 'f9460000-0000-4000-8000-000000000002'), 1,
  'the same supplier in the same currency is one supplier order');
select is((select inquiry_id from public.supplier_orders where order_id = 'f9460000-0000-4000-8000-000000000002'),
  'd9462000-0000-4000-8000-000000000011'::uuid, 'which keeps the supplier''s inquiry');
select is((select array_agg(supplier_unit_price order by position) from public.order_items where order_id = 'f9460000-0000-4000-8000-000000000002'),
  array[40, 3]::numeric[], 'the reply price and the typed price');

-- ------------------------------------------------------------------ refusals: nothing is written
select throws_ok($$select public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"supplier_id":"c9460000-0000-4000-8000-000000000003","supplier_unit_price":5}]'::jsonb)$$,
  '22023', 'a supplier price needs its currency and cannot be below 0: Refusal item', 'a price with no currency is refused');
select throws_ok($$select public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"supplier_id":"c9460000-0000-4000-8000-000000000003","supplier_unit_price":-1,"currency":"USD"}]'::jsonb)$$,
  '22023', 'a supplier price needs its currency and cannot be below 0: Refusal item', 'a price below 0 is refused');
select throws_ok($$select public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"supplier_id":"c9460000-0000-4000-8000-0000000000ff"}]'::jsonb)$$,
  '22023', 'the chosen supplier was not found: Refusal item', 'an unknown supplier is refused');
select throws_ok($$select public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"supplier_id":"c9460000-0000-4000-8000-000000000003","is_service":true}]'::jsonb)$$,
  '22023', 'a typed supplier cannot go with a quote line or a service: Refusal item', 'a typed supplier on a service is refused');
select throws_ok($$select public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"qty":0.5,"supplier_id":"c9460000-0000-4000-8000-000000000003"},
      {"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"qty":0.5,"supplier_id":"c9460000-0000-4000-8000-000000000003"}]'::jsonb)$$,
  '22023', 'split parts of an item must use different suppliers: Refusal item', 'the same typed supplier twice on one item is refused');
select is((select count(*)::int from public.orders where rfq_id = 'd9460000-0000-4000-8000-000000000003'), 0, 'nothing was written');

-- a typed supplier stops the rank-1 inference: the item's only reply (supplier A, 9 USD) is not used
select is(public.convert_rfq_to_order('f9460000-0000-4000-8000-000000000003', 'd9460000-0000-4000-8000-000000000003',
    '[{"rfq_item_id":"d9461000-0000-4000-8000-000000000021","unit_price_net":100,"supplier_id":"c9460000-0000-4000-8000-000000000003","supplier_unit_price":7,"currency":"CNY"}]'::jsonb),
  'f9460000-0000-4000-8000-000000000003'::uuid, 'a typed supplier on an item that has a reply from another supplier');
select is((select supplier_id from public.supplier_orders where order_id = 'f9460000-0000-4000-8000-000000000003'),
  'c9460000-0000-4000-8000-000000000003'::uuid, 'is ordered from the typed supplier, not the one who replied');
select is((select supplier_unit_price from public.order_items where order_id = 'f9460000-0000-4000-8000-000000000003'), 7::numeric,
  'at the typed price');

reset role;
select * from finish();
rollback;
