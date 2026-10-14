begin;
select plan(95);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Fixtures are inserted as the table owner with the admin's claims; every RPC is then called as `authenticated`
-- so that the caller's own row security applies, which is the point of SECURITY INVOKER.

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('float_rfq', 'convert_rfq_to_order', 'create_repeat_order', 'merge_companies',
                               'merge_brands', 'resolve_value_basis')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 6,
  'the six order RPCs are SECURITY INVOKER with a fixed search_path, executable by authenticated only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier One'),
  ('c0000000-0000-4000-8000-000000000003', 'Supplier Two');
insert into public.company_sites (id, company_id, name) values
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Plant');
insert into public.contacts (id, company_id, name) values
  ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Buyer');
insert into public.brands (id, name) values ('c3000000-0000-4000-8000-000000000001', 'Belimo');

-- An earlier order whose terms the conversion should pick up.
insert into public.orders (id, company_id, owner_id, ordered_on, payment_terms_days) values
  ('a1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', '2020-01-01', 45);

-- rfqC: owned by sales, four items, two inquiries, quote lines of several shapes.
insert into public.rfqs (id, company_id, site_id, contact_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, brand_id, qty, unit, quoted_unit_price_net, gst_rate) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 0, 'Pump', 'c3000000-0000-4000-8000-000000000001', 2, 'pcs', 100, 18),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 1, 'Valve', null, 1, 'pcs', null, 18),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 2, 'Cable', null, 10, 'm', 5, 0),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 3, 'Commissioning', null, 1, null, 300, 18);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', public.today_pkt()),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 60.5, 'USD'),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 55, 'EUR'),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 20, 'USD'),
  ('e1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 3.25, 'PKR');

-- A closed RFQ cannot be converted.
insert into public.rfqs (id, company_id, owner_id, closed_on, close_reason) values
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', public.today_pkt(), 'price');
insert into public.rfq_items (id, rfq_id, description, quoted_unit_price_net) values
  ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002', 'Closed item', 1);

-- rfq3: every item priced, one sole quote line, for the "all defaults" path.
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, quoted_unit_price_net) values
  ('d1000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000003', 0, 'J1', 10),
  ('d1000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000003', 1, 'J2', 20);
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002');
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('e1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000006', 7, 'USD');

-- ------------------------------------------------------------------ float_rfq (as sales)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.float_rfq('d0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001',
            '[{"description":"Pump A","qty":2,"unit":"pcs"},{"description":"Valve B"},{"description":"Service C","gst_rate":0}]'::jsonb,
            array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003']::uuid[],
            'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'CR-1', date '2030-01-01'),
  'd0000000-0000-4000-8000-000000000011'::uuid, 'float_rfq returns the RFQ id');
select ok((select owner_id = 'a0000000-0000-4000-8000-000000000002' and received_on = public.today_pkt()
                  and customer_ref = 'CR-1' and due_on = date '2030-01-01'
                  and site_id = 'c1000000-0000-4000-8000-000000000001'
                  and contact_id = 'c2000000-0000-4000-8000-000000000001'
           from public.rfqs where id = 'd0000000-0000-4000-8000-000000000011'),
  'the caller owns the RFQ, received today, with the given reference, deadline, site and contact');
select ok((select array_agg(description order by position) = array['Pump A', 'Valve B', 'Service C']
                  and array_agg(position order by position) = array[0, 1, 2]::smallint[]
                  and array_agg(qty order by position) = array[2, 1, 1]::numeric[]
                  and array_agg(gst_rate order by position) = array[18, 18, 0]::numeric[]
           from public.rfq_items where rfq_id = 'd0000000-0000-4000-8000-000000000011'),
  'items keep their order; quantity defaults to 1 and GST to 18');
select is((select count(*)::int from public.supplier_inquiries
           where rfq_id = 'd0000000-0000-4000-8000-000000000011' and sent_on = public.today_pkt()), 2,
  'one inquiry per chosen supplier, stamped sent today');
select is(public.float_rfq('d0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001',
            '[{"description":"Something else"}]'::jsonb, array['c0000000-0000-4000-8000-000000000002']::uuid[]),
  'd0000000-0000-4000-8000-000000000011'::uuid, 'a second call with the same id returns the same RFQ');
select ok((select (select count(*) from public.rfq_items where rfq_id = 'd0000000-0000-4000-8000-000000000011') = 3
                  and (select count(*) from public.supplier_inquiries where rfq_id = 'd0000000-0000-4000-8000-000000000011') = 2
                  and (select count(*) from public.rfqs where id = 'd0000000-0000-4000-8000-000000000011') = 1),
  'and writes nothing more');
select lives_ok($$select public.float_rfq('d0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001',
                    '[{"description":"Save only"}]'::jsonb)$$, 'no supplier ticked is a save-only call');
select is((select count(*)::int from public.supplier_inquiries where rfq_id = 'd0000000-0000-4000-8000-000000000012'), 0,
  'and creates no inquiries');
select lives_ok($$select public.float_rfq('d0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001',
                    '[{"description":"Shortlist"}]'::jsonb, array['c0000000-0000-4000-8000-000000000002']::uuid[],
                    null, null, null, null, false)$$, 'p_mark_sent = false shortlists only');
select is((select sent_on from public.supplier_inquiries where rfq_id = 'd0000000-0000-4000-8000-000000000013'),
  null, 'and leaves sent_on empty');
select throws_ok($$select public.float_rfq('d0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000001',
                     '[{"description":"Dup ref"}]'::jsonb, '{}', null, null, 'CR-1')$$,
  '23505', null, 'a customer reference already used by the company is not duplicated');
select is((select count(*)::int from public.rfqs where id = 'd0000000-0000-4000-8000-000000000014'), 0,
  'and nothing of that call is left behind');
select throws_ok($$select public.float_rfq('d0000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000001',
                     '[]'::jsonb)$$, '22023', null, 'an RFQ with no items is refused');
select throws_ok($$select public.float_rfq('d0000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000001',
                     '[{"description":"  "}]'::jsonb)$$, '22023', null, 'an item with a blank description is refused');
select is((select count(*)::int from public.rfqs where id = 'd0000000-0000-4000-8000-000000000015'), 0,
  'a refused float leaves no RFQ');

-- ------------------------------------------------------------------ convert_rfq_to_order (as engineer)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is(public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
            '[{"rfq_item_id":"d1000000-0000-4000-8000-000000000001","quote_line_id":"e1000000-0000-4000-8000-000000000002"},
              {"rfq_item_id":"d1000000-0000-4000-8000-000000000002","unit_price_net":150},
              {"rfq_item_id":"d1000000-0000-4000-8000-000000000003"},
              {"rfq_item_id":"d1000000-0000-4000-8000-000000000004","is_service":true}]'::jsonb),
  'a1000000-0000-4000-8000-000000000001'::uuid, 'an engineer can convert an RFQ; the order id is returned');
select ok((select company_id = 'c0000000-0000-4000-8000-000000000001' and rfq_id = 'd0000000-0000-4000-8000-000000000001'
                  and site_id = 'c1000000-0000-4000-8000-000000000001'
                  and contact_id = 'c2000000-0000-4000-8000-000000000001'
                  and ordered_on = public.today_pkt() and not needs_commissioning and customer_po_number is null
           from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  'company, site, contact and RFQ are copied; the order is dated today');
select is((select owner_id from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'the RFQ owner (sales) is carried across, not the engineer who converted');
select is((select created_by from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000003'::uuid, 'created_by is the person who converted');
select is((select payment_terms_days from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  45, 'payment terms default to the company''s last order');
select is((select count(*)::int from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000001'), 4,
  'four order items');
select ok((select array_agg(position order by position) = array[0, 1, 2, 3]::smallint[]
                  and array_agg(description order by position) = array['Pump', 'Valve', 'Cable', 'Commissioning']
                  and array_agg(qty order by position) = array[2, 1, 10, 1]::numeric[]
                  and array_agg(unit_price_net order by position) = array[100, 150, 5, 300]::numeric[]
                  and array_agg(gst_rate order by position) = array[18, 18, 0, 18]::numeric[]
                  and array_agg(is_service order by position) = array[false, false, false, true]
           from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'items copy description, qty, the RFQ price (or the typed override) and the per-line GST rate');
select ok((select array_agg(supplier_unit_price order by position) is not distinct from array[55, 20, 3.25, null]::numeric[]
           from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'supplier price comes from the chosen quote line (the sole line when none is named); services have none');
select ok((select array_agg(rfq_item_id order by position) = array['d1000000-0000-4000-8000-000000000001',
            'd1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003',
            'd1000000-0000-4000-8000-000000000004']::uuid[]
           from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'each item keeps its RFQ item lineage');
select is((select count(*)::int from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000001'), 3,
  'three legs: one per supplier and currency');
select ok((select bool_and(so.supplier_id = case i.description
                                              when 'Pump'  then 'c0000000-0000-4000-8000-000000000003'
                                              when 'Valve' then 'c0000000-0000-4000-8000-000000000002'
                                              when 'Cable' then 'c0000000-0000-4000-8000-000000000003' end::uuid
                           and so.currency = case i.description when 'Pump' then 'EUR' when 'Valve' then 'USD'
                                              when 'Cable' then 'PKR' end
                           and so.inquiry_id = case i.description
                                              when 'Pump'  then 'e0000000-0000-4000-8000-000000000002'
                                              when 'Valve' then 'e0000000-0000-4000-8000-000000000001'
                                              when 'Cable' then 'e0000000-0000-4000-8000-000000000002' end::uuid)
           from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
           where i.order_id = 'a1000000-0000-4000-8000-000000000001'),
  'each item sits on the leg of its quote''s supplier, with that quote''s currency and inquiry');
select is((select supplier_order_id from public.order_items
           where order_id = 'a1000000-0000-4000-8000-000000000001' and description = 'Commissioning'),
  null, 'a service line has no leg');
select ok((select bool_and(placed_on is null and received_on is null and delivered_on is null and expected_on is null)
           from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'legs start with no dates');

select is(public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000001'::uuid, 'a second call with the same order id returns the same order');
select ok((select (select count(*) from public.orders where rfq_id = 'd0000000-0000-4000-8000-000000000001') = 1
                  and (select count(*) from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000001') = 4
                  and (select count(*) from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000001') = 3),
  'a double submit leaves one order, four items and three legs');

select throws_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
                     '[{"rfq_item_id":"d1000000-0000-4000-8000-000000000002"}]'::jsonb)$$,
  '22023', null, 'an item with no price anywhere is refused');
select throws_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
                     '[{"rfq_item_id":"d1000000-0000-4000-8000-000000000001","quote_line_id":"e1000000-0000-4000-8000-000000000003"}]'::jsonb)$$,
  '22023', null, 'a quote line that belongs to another item is refused');
select throws_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
                     '[{"rfq_item_id":"d1000000-0000-4000-8000-000000000005"}]'::jsonb)$$,
  '22023', null, 'an item from another RFQ is refused');
select lives_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000002')$$,
  'a closed RFQ can still be converted');
select ok((select closed_on is null and close_reason is null and close_note is null
           from public.rfqs where id = 'd0000000-0000-4000-8000-000000000002')
      and (select count(*) = 1 from public.orders where rfq_id = 'd0000000-0000-4000-8000-000000000002'),
  'converting reopened the RFQ (closed_on, close_reason, close_note cleared) and created the order');
select throws_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000002', gen_random_uuid())$$,
  'P0002', null, 'an unknown RFQ is refused');
select is((select count(*)::int from public.orders where id = 'a1000000-0000-4000-8000-000000000002'), 0,
  'refused conversions leave no order');

-- One RFQ may produce several orders: a subset, with its own terms, PO number and date.
select lives_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
                    '[{"rfq_item_id":"d1000000-0000-4000-8000-000000000003","qty":4}]'::jsonb, ' PO-77 ', date '2027-01-05', 10, true)$$,
  'a second order from the same RFQ, for a subset of its items');
select ok((select customer_po_number = 'PO-77' and ordered_on = date '2027-01-05' and payment_terms_days = 10
                  and needs_commissioning
           from public.orders where id = 'a1000000-0000-4000-8000-000000000003'),
  'PO number (trimmed), date, terms and the commissioning flag are taken from the call');
select ok((select count(*) = 1 and min(qty) = 4 from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000003'),
  'only the chosen item, with the chosen quantity');
select is((select count(*)::int from public.orders where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 2,
  'the RFQ now has two orders');

-- Everything defaulted: all items, the sole quote line, the RFQ prices.
select lives_ok($$select public.convert_rfq_to_order('a1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000003')$$,
  'converting with only the ids');
select ok((select count(*) = 2 and bool_or(supplier_unit_price = 7 and unit_price_net = 10 and supplier_order_id is not null)
                  and bool_or(supplier_unit_price is null and unit_price_net = 20 and supplier_order_id is null)
           from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000005'),
  'all items come across; the item with one quote is sourced, the item with none is left unsourced');
select is((select currency from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000005'),
  'USD', 'and the leg takes the quote''s currency');

-- ------------------------------------------------------------------ create_repeat_order (as sales)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.create_repeat_order('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000004'::uuid, 'create_repeat_order returns the new order id');
select ok((select company_id = 'c0000000-0000-4000-8000-000000000001' and site_id = 'c1000000-0000-4000-8000-000000000001'
                  and contact_id = 'c2000000-0000-4000-8000-000000000001' and rfq_id is null
                  and payment_terms_days = 45 and ordered_on = public.today_pkt() and customer_po_number is null
                  and owner_id = 'a0000000-0000-4000-8000-000000000002'
           from public.orders where id = 'a1000000-0000-4000-8000-000000000004'),
  'company, site, contact and terms are copied; no RFQ; dated today; the caller owns it');
select ok((select array_agg(description order by position) = array['Pump', 'Valve', 'Cable', 'Commissioning']
                  and array_agg(unit_price_net order by position) = array[100, 150, 5, 300]::numeric[]
                  and array_agg(qty order by position) = array[2, 1, 10, 1]::numeric[]
                  and array_agg(gst_rate order by position) = array[18, 18, 0, 18]::numeric[]
                  and array_agg(is_service order by position) = array[false, false, false, true]
                  and array_agg(supplier_unit_price order by position) is not distinct from array[55, 20, 3.25, null]::numeric[]
                  and bool_and(rfq_item_id is null)
           from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000004'),
  'items, last selling prices, last supplier prices and GST rates are copied; there is no RFQ lineage');
select is((select count(*)::int from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000004'), 3,
  'the same three legs');
select ok((select bool_and(so.supplier_id = src.supplier_id and so.currency = src.currency
                           and so.inquiry_id is null and so.reference is null and so.placed_on is null
                           and so.received_on is null and so.delivered_on is null and so.id <> src.id)
           from public.order_items i
           join public.supplier_orders so on so.id = i.supplier_order_id
           join public.order_items si on si.order_id = 'a1000000-0000-4000-8000-000000000001' and si.position = i.position
           join public.supplier_orders src on src.id = si.supplier_order_id
           where i.order_id = 'a1000000-0000-4000-8000-000000000004'),
  'each copied item sits on a new leg with the source leg''s supplier and currency, and no dates');
select is(public.create_repeat_order('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000004'::uuid, 'a second call with the same id returns the same order');
select ok((select (select count(*) from public.order_items where order_id = 'a1000000-0000-4000-8000-000000000004') = 4
                  and (select count(*) from public.supplier_orders where order_id = 'a1000000-0000-4000-8000-000000000004') = 3),
  'and copies nothing twice');
select lives_ok($$select public.create_repeat_order('a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001',
                    'PO-9', date '2027-02-01')$$, 'a repeat order can carry a PO number and a date');
select ok((select customer_po_number = 'PO-9' and ordered_on = date '2027-02-01'
           from public.orders where id = 'a1000000-0000-4000-8000-000000000006'), 'and takes them');
select throws_ok($$select public.create_repeat_order('a1000000-0000-4000-8000-000000000007', gen_random_uuid())$$,
  'P0002', null, 'an unknown source order is refused');

-- Neither conversion nor repeat touches order_costs (checked as admin).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.order_costs), 0, 'no order_costs row was written by the RPCs');

-- ------------------------------------------------------------------ merge_companies
reset role;
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000a1', 'Keep Co'),
  ('c0000000-0000-4000-8000-0000000000a2', 'Drop Co'),
  ('c0000000-0000-4000-8000-0000000000b1', 'Conflict One'),
  ('c0000000-0000-4000-8000-0000000000b2', 'Conflict Two');
insert into public.company_sites (id, company_id, name) values
  ('c1000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Main Plant'),
  ('c1000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000a2', ' main plant'),
  ('c1000000-0000-4000-8000-0000000000a3', 'c0000000-0000-4000-8000-0000000000a2', 'Annexe');
insert into public.contacts (id, company_id, site_id, name) values
  ('c2000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-0000000000a2', 'On merged site'),
  ('c2000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-0000000000a3', 'On annexe');
insert into public.brands (id, name) values
  ('c3000000-0000-4000-8000-0000000000a1', 'Brand A'),
  ('c3000000-0000-4000-8000-0000000000a2', 'Brand B');
insert into public.company_brands (company_id, brand_id) values
  ('c0000000-0000-4000-8000-0000000000a1', 'c3000000-0000-4000-8000-0000000000a1'),
  ('c0000000-0000-4000-8000-0000000000a2', 'c3000000-0000-4000-8000-0000000000a1'),
  ('c0000000-0000-4000-8000-0000000000a2', 'c3000000-0000-4000-8000-0000000000a2');
insert into public.rfqs (id, company_id, site_id, customer_ref, owner_id) values
  ('d0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-0000000000a2',
   'DROP-REF', 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, site_id, customer_po_number, owner_id) values
  ('a1000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-0000000000a3',
   'DROP-PO', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a2');
insert into public.supplier_orders (id, order_id, supplier_id) values
  ('a2000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a2');
insert into public.invoices (id, company_id, number, net_amount, gst_amount) values
  ('b1000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2', 'LEGACY-1', 100, 18);
insert into public.expenses (id, amount_pkr, category_id, payee_id) values
  ('b4000000-0000-4000-8000-0000000000a1', 5, 'ca7e0000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-0000000000a2');
-- Conflicts: the same customer reference, the same PO, the same RFQ sent to both suppliers.
insert into public.rfqs (id, company_id, customer_ref, owner_id) values
  ('d0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b1', 'SAME', 'a0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-0000000000b2', 'c0000000-0000-4000-8000-0000000000b2', 'SAME', 'a0000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2')$$,
  '42501', null, 'sales cannot merge companies');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2')$$,
  '42501', null, 'an engineer cannot merge companies');
select is((select count(*)::int from public.companies where id = 'c0000000-0000-4000-8000-0000000000a2'), 1,
  'and nothing was merged');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1')$$,
  '22023', null, 'a company cannot be merged into itself');
select throws_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000a1', gen_random_uuid())$$,
  'P0002', null, 'an unknown company is refused');
select throws_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b2')$$,
  '23505', null, 'two RFQs with the same customer reference block the merge, with a message');

select lives_ok($$select public.merge_companies('c0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a2')$$,
  'an admin merges two companies');
select is((select count(*)::int from public.companies where id = 'c0000000-0000-4000-8000-0000000000a2'), 0,
  'the dropped company is gone');
select ok((select array_agg(name order by name) = array['Annexe', 'Main Plant']
           from public.company_sites where company_id = 'c0000000-0000-4000-8000-0000000000a1'),
  'sites with the same name merged into one; the other site moved over');
select ok((select bool_and(case c.name when 'On merged site' then c.site_id = 'c1000000-0000-4000-8000-0000000000a1'
                                       else c.site_id = 'c1000000-0000-4000-8000-0000000000a3' end)
                  and bool_and(c.company_id = 'c0000000-0000-4000-8000-0000000000a1')
           from public.contacts c where c.id in ('c2000000-0000-4000-8000-0000000000a1', 'c2000000-0000-4000-8000-0000000000a2')),
  'contacts follow, and those on the merged site point at the surviving site');
select ok((select r.company_id = 'c0000000-0000-4000-8000-0000000000a1' and r.site_id = 'c1000000-0000-4000-8000-0000000000a1'
           from public.rfqs r where r.id = 'd0000000-0000-4000-8000-0000000000a1'),
  'RFQs move, with their site repointed');
select ok((select o.company_id = 'c0000000-0000-4000-8000-0000000000a1' from public.orders o
           where o.id = 'a1000000-0000-4000-8000-0000000000a1'), 'orders move');
select ok((select (select supplier_id from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000a1')
                    = 'c0000000-0000-4000-8000-0000000000a1'
                  and (select supplier_id from public.supplier_orders where id = 'a2000000-0000-4000-8000-0000000000a1')
                    = 'c0000000-0000-4000-8000-0000000000a1'),
  'supplier inquiries and legs move');
select ok((select (select company_id from public.invoices where id = 'b1000000-0000-4000-8000-0000000000a1')
                    = 'c0000000-0000-4000-8000-0000000000a1'
                  and (select payee_id from public.expenses where id = 'b4000000-0000-4000-8000-0000000000a1')
                    = 'c0000000-0000-4000-8000-0000000000a1'),
  'invoices and expense payees move');
select ok((select array_agg(brand_id order by brand_id) = array['c3000000-0000-4000-8000-0000000000a1',
            'c3000000-0000-4000-8000-0000000000a2']::uuid[]
           from public.company_brands where company_id = 'c0000000-0000-4000-8000-0000000000a1'),
  'company_brands merge without duplicates');
select ok((select count(*) = 0 from pg_constraint c
           where c.contype = 'f' and c.confrelid = 'public.companies'::regclass and cardinality(c.conkey) <> 1),
  'every foreign key to companies is single-column, so the catalog sweep covers all of them');

-- ------------------------------------------------------------------ merge_brands
reset role;
insert into public.brands (id, name, kind) values
  ('c3000000-0000-4000-8000-0000000000c1', 'Keep Brand', 'brand'),
  ('c3000000-0000-4000-8000-0000000000c2', 'Drop Brand', 'brand'),
  ('c3000000-0000-4000-8000-0000000000c3', 'Keep Family', 'family'),
  ('c3000000-0000-4000-8000-0000000000c4', 'Drop Family', 'family');
insert into public.rfq_items (id, rfq_id, description, brand_id, family_id) values
  ('d1000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000003', 'Branded item',
   'c3000000-0000-4000-8000-0000000000c2', 'c3000000-0000-4000-8000-0000000000c4');
insert into public.order_items (id, order_id, description, unit_price_net, brand_id, family_id) values
  ('a3000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-000000000001', 'Branded order item', 1,
   'c3000000-0000-4000-8000-0000000000c2', 'c3000000-0000-4000-8000-0000000000c4');
insert into public.company_brands (company_id, brand_id) values
  ('c0000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-0000000000c1'),
  ('c0000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-0000000000c2'),
  ('c0000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-0000000000c2');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.merge_brands('c3000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c2')$$,
  '42501', null, 'sales cannot merge brands');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.merge_brands('c3000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c3')$$,
  '22023', null, 'a brand and a family cannot be merged');
select lives_ok($$select public.merge_brands('c3000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c2')$$,
  'an admin merges two brands');
select lives_ok($$select public.merge_brands('c3000000-0000-4000-8000-0000000000c3', 'c3000000-0000-4000-8000-0000000000c4')$$,
  'and two families');
select is((select count(*)::int from public.brands where id in ('c3000000-0000-4000-8000-0000000000c2',
                                                              'c3000000-0000-4000-8000-0000000000c4')), 0,
  'the dropped brand and family are gone');
select ok((select brand_id = 'c3000000-0000-4000-8000-0000000000c1' and family_id = 'c3000000-0000-4000-8000-0000000000c3'
           from public.rfq_items where id = 'd1000000-0000-4000-8000-0000000000c1'),
  'RFQ items are repointed (brand and family)');
select ok((select brand_id = 'c3000000-0000-4000-8000-0000000000c1' and family_id = 'c3000000-0000-4000-8000-0000000000c3'
           from public.order_items where id = 'a3000000-0000-4000-8000-0000000000c1'),
  'order items are repointed (brand and family)');
select ok((select count(*) = 2 and bool_and(brand_id = 'c3000000-0000-4000-8000-0000000000c1')
           from public.company_brands where brand_id in ('c3000000-0000-4000-8000-0000000000c1',
                                                         'c3000000-0000-4000-8000-0000000000c2')),
  'supplier links collapse to one per supplier on the surviving brand');
select throws_ok($$select public.merge_brands('c3000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c1')$$,
  '22023', null, 'a brand cannot be merged into itself');

-- ------------------------------------------------------------------ resolve_value_basis
reset role;
insert into public.orders (id, company_id, owner_id, legacy_flags) values
  ('a1000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   array['value_basis_unknown', 'dates_estimated']),
  ('a1000000-0000-4000-8000-0000000000d2', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   array['value_basis_unknown']),
  ('a1000000-0000-4000-8000-0000000000d3', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-0000000000d1', 'taxed', 1, 1180, 18),
  ('a1000000-0000-4000-8000-0000000000d1', 'exempt', 1, 590, 0),
  ('a1000000-0000-4000-8000-0000000000d2', 'taxed', 1, 1180, 18);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d1', 'gross')$$,
  '42501', null, 'sales cannot resolve a value basis');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d1', 'wrong')$$,
  '22023', null, 'the basis must be net or gross');
select lives_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d1', 'gross')$$,
  'an admin resolves an order to gross');
select ok((select array_agg(unit_price_net order by description) = array[590.00, 1000.00]::numeric[]
           from public.order_items where order_id = 'a1000000-0000-4000-8000-0000000000d1'),
  'gross prices are divided by 1 + rate (1180 at 18% gives 1000; the exempt line is unchanged)');
select ok((select legacy_flags = array['dates_estimated'] from public.orders where id = 'a1000000-0000-4000-8000-0000000000d1'),
  'the flag is cleared and other flags are kept');
select throws_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d1', 'gross')$$,
  '22023', null, 'resolving twice is refused, so prices are never divided twice');
select lives_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d2', 'net')$$,
  'resolving to net');
select ok((select unit_price_net = 1180 from public.order_items where order_id = 'a1000000-0000-4000-8000-0000000000d2')
      and (select legacy_flags = '{}' from public.orders where id = 'a1000000-0000-4000-8000-0000000000d2'),
  'leaves the prices alone and clears the flag');
select throws_ok($$select public.resolve_value_basis('a1000000-0000-4000-8000-0000000000d3', 'net')$$,
  '22023', null, 'an order that was never flagged is refused');
select throws_ok($$select public.resolve_value_basis(gen_random_uuid(), 'net')$$, 'P0002', null, 'an unknown order is refused');

-- ------------------------------------------------------------------ anon and deactivated
reset role;
set local role anon;
select throws_ok($$select public.float_rfq(gen_random_uuid(), gen_random_uuid(), '[{"description":"x"}]'::jsonb)$$,
  '42501', null, 'anon cannot float an RFQ');
select throws_ok($$select public.convert_rfq_to_order(gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'anon cannot convert an RFQ');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.float_rfq(gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', '[{"description":"x"}]'::jsonb)$$,
  '42501', null, 'a deactivated user cannot float an RFQ (row security stops the insert)');
select throws_ok($$select public.create_repeat_order(gen_random_uuid(), 'a1000000-0000-4000-8000-000000000001')$$,
  'P0002', null, 'a deactivated user cannot even see the source order');
reset role;

select * from finish();
rollback;
