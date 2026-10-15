begin;
select * from no_plan();

-- 0035_brand_tokens: a brand or family name is never a model code. model_tokens() keeps any word of 4+ characters with a
-- letter and a digit, so a brand such as "XYZ2000" used to put its own name in the tokens of EVERY item of the brand and make
-- every pair of its items "same model" (tier 0), pre-ticking suppliers on false history. Fixture users come from seed.sql.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.brands (id, name, kind) values
  ('b3500000-0000-4000-8000-000000000001', 'XYZ2000', 'brand'),     -- a brand whose name is a model-shaped word
  ('b3500000-0000-4000-8000-000000000002', 'Plainco', 'brand'),     -- a brand with no digits
  ('b3500000-0000-4000-8000-000000000003', 'E+H 2000', 'brand'),    -- spaced, written EH2000 or E+H2000 in descriptions
  ('b3500000-0000-4000-8000-000000000004', 'S7-1200 Series', 'family');
insert into public.companies (id, name) values
  ('c3500000-0000-4000-8000-000000000001', 'Supplier One'),
  ('c3500000-0000-4000-8000-000000000002', 'Supplier Two'),
  ('c3500000-0000-4000-8000-000000000003', 'Supplier Three'),
  ('c3500000-0000-4000-8000-000000000004', 'Supplier Four'),
  ('c3500000-0000-4000-8000-0000000000f0', 'Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a3500000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a3600000-0000-4000-8000-000000000001', 'a3500000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000001', 'PKR'),
  ('a3600000-0000-4000-8000-000000000002', 'a3500000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000002', 'PKR'),
  ('a3600000-0000-4000-8000-000000000003', 'a3500000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000003', 'PKR'),
  ('a3600000-0000-4000-8000-000000000004', 'a3500000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000004', 'PKR');
-- What each supplier supplied before (a procurement leg line): the only history that pre-ticks.
insert into public.order_items (order_id, description, brand_id, unit_price_net, supplier_order_id, supplier_unit_price) values
  -- Supplier One: another model of the digit brand
  ('a3500000-0000-4000-8000-000000000001', 'XYZ2000 ultrasonic open channel level transmitter', 'b3500000-0000-4000-8000-000000000001', 100,
   'a3600000-0000-4000-8000-000000000001', 50),
  -- Supplier Two: the same REAL model code under the digit brand
  ('a3500000-0000-4000-8000-000000000001', 'XYZ2000 QX9100 flow meter', 'b3500000-0000-4000-8000-000000000001', 100,
   'a3600000-0000-4000-8000-000000000002', 50),
  -- Supplier Three: the digit-free brand, same model code as the target
  ('a3500000-0000-4000-8000-000000000001', 'Plainco HQ1110 meter', 'b3500000-0000-4000-8000-000000000002', 100,
   'a3600000-0000-4000-8000-000000000003', 50),
  -- Supplier Four: another model of the spaced digit brand, written as one word
  ('a3500000-0000-4000-8000-000000000001', 'EH2000 pressure switch with long cable and flange', 'b3500000-0000-4000-8000-000000000003', 100,
   'a3600000-0000-4000-8000-000000000004', 50);

-- ------------------------------------------------------------------ the helpers
select ok(public.brand_tokens() @> array['XYZ2000', 'EH2000', 'S71200'],
  'brand_tokens: a brand name that is model-shaped is a brand token, spaced names are squeezed, hyphens are dropped');
select ok(not public.brand_tokens() @> array['HQ1110'] and not public.brand_tokens() @> array['PLAINCO'],
  'brand_tokens: a real model code and a digit-free brand are not brand tokens');
select is(public.tokens_without(array['ABC123', 'XYZ2000', 'QX9100'], array['XYZ2000']), array['ABC123', 'QX9100'],
  'tokens_without removes only the tokens to drop, in order');
select is(public.tokens_without(null, array['X']), '{}'::text[], 'tokens_without of nothing is nothing');
select is(public.tokens_without(array['ABC123'], null), array['ABC123'], 'tokens_without with nothing to drop keeps everything');
select is(public.tokens_without(array['ABC123'], '{}'), array['ABC123'], 'and an empty drop list keeps everything');
select ok(exists (select 1 from public.order_items where description = 'XYZ2000 QX9100 flow meter' and model_tokens = array['QX9100', 'XYZ2000']),
  'the generated model_tokens column is unchanged: it still holds the brand token (the filter is at comparison time)');

-- ------------------------------------------------------------------ the bug: two different models of a digit brand
select is((select best_tier from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000001'::uuid],
             'b3500000-0000-4000-8000-000000000001', null, 'XYZ2000 conductivity electrode cable assembly')),
  2::smallint, 'a digit brand with two different models is tier 2 (same brand), not tier 0');
select ok(not (select supplied_before from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000001'::uuid],
             'b3500000-0000-4000-8000-000000000001', null, 'XYZ2000 conductivity electrode cable assembly')),
  'and it is NOT "supplied this item before": no false pre-tick');
select is((select best_tier from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000004'::uuid],
             'b3500000-0000-4000-8000-000000000003', null, 'EH2000 conductivity electrode cable assembly')),
  2::smallint, 'a spaced brand name (E+H 2000, written EH2000 in descriptions) does not make two of its items the same model either');

-- ------------------------------------------------------------------ the same real model under that brand is still tier 0
select is((select best_tier from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000002'::uuid],
             'b3500000-0000-4000-8000-000000000001', null, 'XYZ2000 QX9100 pump kit')),
  0::smallint, 'the same real model code under the digit brand is still tier 0');
select ok((select supplied_before from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000002'::uuid],
             'b3500000-0000-4000-8000-000000000001', null, 'XYZ2000 QX9100 pump kit')),
  'and it is supplied before: a true match still pre-ticks');
select is((select best_tier_label from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000002'::uuid],
             'b3500000-0000-4000-8000-000000000001', null, 'XYZ2000 QX9100 pump kit')),
  'same model', 'labelled "same model"');

-- ------------------------------------------------------------------ a brand without digits is unchanged
select is((select best_tier from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000003'::uuid],
             'b3500000-0000-4000-8000-000000000002', null, 'Plainco HQ1110 probe set')),
  0::smallint, 'a digit-free brand: a shared model code is tier 0 as before');
select is((select best_tier from public.supplier_item_memory(array['c3500000-0000-4000-8000-000000000003'::uuid],
             'b3500000-0000-4000-8000-000000000002', null, 'Plainco turbidity pump head')),
  2::smallint, 'a digit-free brand: different items are tier 2 as before');

-- ------------------------------------------------------------------ one call, one read of the brand names: the order of suppliers is kept
select is((select array_agg(supplier_id) from public.supplier_item_memory(
             array['c3500000-0000-4000-8000-000000000003'::uuid, 'c3500000-0000-4000-8000-000000000001'::uuid],
             'b3500000-0000-4000-8000-000000000002', null, 'Plainco HQ1110 probe set')),
  array['c3500000-0000-4000-8000-000000000003'::uuid, 'c3500000-0000-4000-8000-000000000001'::uuid],
  'supplier_item_memory still returns suppliers in the caller''s order');

-- ------------------------------------------------------------------ access: all active staff, nobody else
select ok((select count(*) = 2 from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('brand_tokens', 'tokens_without')
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')),
  'brand_tokens and tokens_without have a fixed search_path, no anon execute, authenticated execute');

select * from finish();
rollback;
