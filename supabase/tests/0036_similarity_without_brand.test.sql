begin;
select * from no_plan();

-- 0036_similarity_without_brand: the brand name never makes two different products "the same item" (tier 1), and the
-- issue_purchase_order "last_po" price source follows the same rule with a digit-containing brand (0035 and 0036).
-- Fixture users come from supabase/seed.sql (a0..01 admin, a0..02 sales).

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.company_profile set legal_name = 'Q-Tech', address = 'Q-Tech, Lahore', po_terms = 'Net 30' where id = 1;

-- ------------------------------------------------------------------ fixtures
insert into public.brands (id, name, kind) values
  ('b3600000-0000-4000-8000-000000000001', 'Zorbex', 'brand'),
  ('b3600000-0000-4000-8000-000000000002', 'XYZ2000', 'brand');   -- a digit brand, for the PO price source
insert into public.companies (id, name) values
  ('c3600000-0000-4000-8000-000000000001', 'Supplier A'),
  ('c3600000-0000-4000-8000-000000000002', 'Supplier B'),
  ('c3600000-0000-4000-8000-000000000003', 'Supplier C'),
  ('c3600000-0000-4000-8000-000000000004', 'Supplier D'),
  ('c3600000-0000-4000-8000-000000000005', 'PO Supplier'),
  ('c3600000-0000-4000-8000-0000000000f0', 'Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002'),
  ('a3700000-0000-4000-8000-000000000002', 'c3600000-0000-4000-8000-0000000000f0', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a3800000-0000-4000-8000-000000000001', 'a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-000000000001', 'PKR'),
  ('a3800000-0000-4000-8000-000000000002', 'a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-000000000002', 'PKR'),
  ('a3800000-0000-4000-8000-000000000003', 'a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-000000000003', 'PKR'),
  ('a3800000-0000-4000-8000-000000000004', 'a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-000000000004', 'PKR'),
  -- the PO supplier: an earlier leg (with a PO) and the leg being issued
  ('a3800000-0000-4000-8000-0000000000e1', 'a3700000-0000-4000-8000-000000000001', 'c3600000-0000-4000-8000-000000000005', 'USD'),
  ('a3800000-0000-4000-8000-0000000000e2', 'a3700000-0000-4000-8000-000000000002', 'c3600000-0000-4000-8000-000000000005', 'USD');
-- What each supplier supplied before (a procurement leg line), all under the digit-free brand Zorbex.
insert into public.order_items (order_id, description, brand_id, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('a3700000-0000-4000-8000-000000000001', 'Zorbex cable assembly', 'b3600000-0000-4000-8000-000000000001', 100, 'a3800000-0000-4000-8000-000000000001', 50),
  ('a3700000-0000-4000-8000-000000000001', 'Zorbex pump', 'b3600000-0000-4000-8000-000000000001', 100, 'a3800000-0000-4000-8000-000000000002', 50),
  ('a3700000-0000-4000-8000-000000000001', 'Ultrasonic open channel level transmitter', 'b3600000-0000-4000-8000-000000000001', 100, 'a3800000-0000-4000-8000-000000000003', 50),
  ('a3700000-0000-4000-8000-000000000001', 'Zorbex actuator', 'b3600000-0000-4000-8000-000000000001', 100, 'a3800000-0000-4000-8000-000000000004', 50);

-- ------------------------------------------------------------------ the helpers
select is(public.strip_words('zorbex cable assembly', array['zorbex']), 'cable assembly', 'strip_words removes the brand word');
select is(public.strip_words('zorbex', array['zorbex']), '', 'and leaves nothing when nothing else is left');
select is(public.strip_words('endress hauser promag', array['endress', 'hauser']), 'promag', 'every word of a multi-word brand goes');
select ok(public.brand_words() @> array['zorbex', 'xyz2000'], 'brand_words lists the words of every brand and family name, normalised');
select ok(public.similar_enough('ultrasonic open channel level transmitter', 'open channel ultrasonic level transmitter', 0.45),
  'similar_enough: the same words in another order are the same item');
select ok(not public.similar_enough('cable assembly', 'cable gland', 0.45),
  'similar_enough: with under 3 words, different text is not the same item whatever the trigrams say');
select ok(public.similar_enough('actuator', 'actuator', 0.45), 'but identical short text still is');
select ok(not public.similar_enough('', '', 0.45) and not public.similar_enough(null, 'x y z', 0.45), 'and nothing is never the same as nothing');
select ok(public.item_match_tier('{}', 'cable assembly', 'b3600000-0000-4000-8000-000000000001', null, '{}', 'cable gland',
            'b3600000-0000-4000-8000-000000000001', null) = 2,
  'item_match_tier: two short descriptions of one brand are tier 2, not tier 1');

-- ------------------------------------------------------------------ two short descriptions sharing only the brand name are not tier 1
select is((select best_tier from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000001'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'Zorbex cable gland')),
  2::smallint, 'Zorbex cable assembly against Zorbex cable gland: tier 2 (same brand), not tier 1');
select ok(not (select supplied_before from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000001'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'Zorbex cable gland')),
  'so it does not pre-tick "supplied this item before"');
select is((select best_tier from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000002'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'Zorbex valve')),
  2::smallint, 'Zorbex pump against Zorbex valve: tier 2');

-- ------------------------------------------------------------------ genuinely the same item, worded differently, is still tier 1
select is((select best_tier from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000003'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'Zorbex open channel ultrasonic level transmitter')),
  1::smallint, 'the same words in another order, with the brand name in front, is tier 1');
select ok((select supplied_before from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000003'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'Zorbex open channel ultrasonic level transmitter')),
  'and it is supplied before');
select is((select best_tier from public.supplier_item_memory(array['c3600000-0000-4000-8000-000000000004'::uuid],
             'b3600000-0000-4000-8000-000000000001', null, 'ZORBEX Actuator, 2 pcs')),
  1::smallint, 'an identical short description (quantity and case aside) is still tier 1');

-- ------------------------------------------------------------------ issue_purchase_order: last_po with a digit-containing brand
insert into public.order_items (id, order_id, position, description, brand_id, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('a3900000-0000-4000-8000-0000000000a0', 'a3700000-0000-4000-8000-000000000001', 0, 'XYZ2000 QX9100 flow meter', 'b3600000-0000-4000-8000-000000000002', 1,
   'a3800000-0000-4000-8000-0000000000e1', 77);
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, lines, total) values
  ('53000000-0000-4000-8000-000000000001', 'a3800000-0000-4000-8000-0000000000e1', 3600, 0, 'USD',
   '[{"order_item_id":"a3900000-0000-4000-8000-0000000000a0","qty":1,"unit_price":77,"price_source":"typed"}]', 77);
insert into public.order_items (id, order_id, position, description, brand_id, qty, unit_price_net, supplier_order_id, supplier_unit_price) values
  -- another model of the digit brand: the brand name alone is not a model match, and the text is too thin to be "same item"
  ('a3900000-0000-4000-8000-0000000000b1', 'a3700000-0000-4000-8000-000000000002', 0, 'XYZ2000 cable gland', 'b3600000-0000-4000-8000-000000000002', 1, 1,
   'a3800000-0000-4000-8000-0000000000e2', null),
  -- the same real model code
  ('a3900000-0000-4000-8000-0000000000b2', 'a3700000-0000-4000-8000-000000000002', 1, 'XYZ2000 QX9100 pump kit', 'b3600000-0000-4000-8000-000000000002', 1, 1,
   'a3800000-0000-4000-8000-0000000000e2', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.issue_purchase_order('53000000-0000-4000-8000-000000000010', 'a3800000-0000-4000-8000-0000000000e2',
            '[{"order_item_id":"a3900000-0000-4000-8000-0000000000b1","unit_price":9},
              {"order_item_id":"a3900000-0000-4000-8000-0000000000b2"}]'::jsonb),
  '53000000-0000-4000-8000-000000000010'::uuid, 'issue_purchase_order issues the leg');
select ok((select l ->> 'price_source' = 'typed' and (l ->> 'unit_price')::numeric = 9
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '53000000-0000-4000-8000-000000000010' and l ->> 'description' = 'XYZ2000 cable gland'),
  'last_po: another model of a digit brand does NOT take the last PO price (the brand name is not a model code)');
select ok((select l ->> 'price_source' = 'last_po' and (l ->> 'unit_price')::numeric = 77
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '53000000-0000-4000-8000-000000000010' and l ->> 'description' = 'XYZ2000 QX9100 pump kit'),
  'last_po: the same real model code under the digit brand still does');

select * from finish();
rollback;
