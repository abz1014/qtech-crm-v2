begin;
select * from no_plan();

-- S25 (Amendment A8): splitting an item across suppliers. convert_rfq_to_order (duplicate guard, rank-1 inference) and
-- split_order_item(). Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
-- Fixtures are inserted as the table owner with the admin's claims; every RPC is then called as `authenticated`.
-- Ids: companies c8000000-..-N (1 customer, 2 supplier A, 3 supplier B, 4 supplier C), RFQ d9000000-..-01, RFQ items da000000-..-N
-- (1 Pump X, 2 Valve Y, 3 Commissioning), inquiries db000000-..-N, quote lines dc000000-..-N, orders f1000000-..-N.
-- Named fixtures: (a) two-part convert, (b) same quote twice, (c) inference, (d) split happy path, (e) refusals, (f) repeat order.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values
  ('c8000000-0000-4000-8000-000000000001', 'Split Customer'),
  ('c8000000-0000-4000-8000-000000000002', 'Split Supplier A'),
  ('c8000000-0000-4000-8000-000000000003', 'Split Supplier B'),
  ('c8000000-0000-4000-8000-000000000004', 'Split Supplier C');
insert into public.rfqs (id, company_id, owner_id) values
  ('d9000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty, unit, quoted_unit_price_net, gst_rate) values
  ('da000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 0, 'Pump X', 10, 'pcs', 100, 18),
  ('da000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001', 1, 'Valve Y', 5, 'pcs', 50, 18),
  ('da000000-0000-4000-8000-000000000003', 'd9000000-0000-4000-8000-000000000001', 2, 'Commissioning', 1, null, 300, 18);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('db000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', public.today_pkt()),
  ('db000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', public.today_pkt());
-- Pump X: A at USD 10, B at USD 12 (A is the cheaper, so A ranks first). Valve Y: B only, USD 7.
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('dc000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 10, 'USD'),
  ('dc000000-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000001', 12, 'USD'),
  ('dc000000-0000-4000-8000-000000000003', 'db000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000002', 7, 'USD');
-- An order with one line of known id, for the deactivated-user check.
insert into public.orders (id, company_id, owner_id) values
  ('f1000000-0000-4000-8000-00000000000c', 'c8000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (id, order_id, position, description, qty, unit_price_net) values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000c', 0, 'Known line', 5, 10);

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('split_order_item', 'convert_rfq_to_order')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'split_order_item and convert_rfq_to_order are SECURITY INVOKER, fixed search_path, executable by authenticated only');

-- ------------------------------------------------------------------ (a) two-part convert (as sales)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.convert_rfq_to_order('f1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001',
            '[{"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":6,"quote_line_id":"dc000000-0000-4000-8000-000000000001"},
              {"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":4,"quote_line_id":"dc000000-0000-4000-8000-000000000002"}]'::jsonb),
  'f1000000-0000-4000-8000-000000000001'::uuid, '(a) an item can be converted in two parts');
select is((select count(*)::int from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000001'), 2,
  '(a) two order lines');
select ok((select array_agg(qty order by qty desc) = array[6, 4]::numeric[]
                  and array_agg(unit_price_net order by qty desc) = array[100, 100]::numeric[]
                  and array_agg(supplier_unit_price order by qty desc) = array[10, 12]::numeric[]
                  and bool_and(rfq_item_id = 'da000000-0000-4000-8000-000000000001')
           from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000001'),
  '(a) 6 and 4, the same selling price, each its supplier''s price, both tied to the RFQ item');
select is((select count(*)::int from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000001'), 2,
  '(a) and two legs');
select ok((select bool_and(so.supplier_id = case i.qty when 6 then 'c8000000-0000-4000-8000-000000000002'
                                                       else 'c8000000-0000-4000-8000-000000000003' end::uuid
                           and so.currency = 'USD')
           from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
           where i.order_id = 'f1000000-0000-4000-8000-000000000001'),
  '(a) each part sits on its own supplier''s leg');
select is((select sum(qty * unit_price_net) from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000001'),
  1000::numeric, '(a) the order net equals the unsplit total (10 x 100)');

-- ------------------------------------------------------------------ (b) the same quote twice
select throws_ok($$select public.convert_rfq_to_order('f1000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001',
                     '[{"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":6,"quote_line_id":"dc000000-0000-4000-8000-000000000001"},
                       {"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":4,"quote_line_id":"dc000000-0000-4000-8000-000000000001"}]'::jsonb)$$,
  '22023', null, '(b) the same quote line used twice for one item is refused');
select throws_ok($$select public.convert_rfq_to_order('f1000000-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000001',
                     '[{"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":6},
                       {"rfq_item_id":"da000000-0000-4000-8000-000000000001","qty":4}]'::jsonb)$$,
  '22023', null, '(b) and so are two parts that would both infer the same quote line');
select is((select count(*)::int from public.orders where id = 'f1000000-0000-4000-8000-000000000002'), 0,
  '(b) a refused conversion leaves no order');
-- 0077: one RFQ is won once. To test a further conversion of the same RFQ, its live orders are parked (detached) and put back.
reset role;
update public.orders set rfq_id = null, notes = 'parked-0077' where rfq_id = 'd9000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.convert_rfq_to_order('f1000000-0000-4000-8000-000000000008', 'd9000000-0000-4000-8000-000000000001',
                    '[{"rfq_item_id":"da000000-0000-4000-8000-000000000003","qty":1,"is_service":true},
                      {"rfq_item_id":"da000000-0000-4000-8000-000000000003","qty":1,"is_service":true}]'::jsonb)$$,
  '(b) two service entries are not a split and are not refused');
reset role;
update public.orders set rfq_id = 'd9000000-0000-4000-8000-000000000001', notes = null where notes = 'parked-0077';
set local role authenticated;

-- ------------------------------------------------------------------ (c) inference of the rank-1 quote line
-- 0077: one RFQ is won once. To test a further conversion of the same RFQ, its live orders are parked (detached) and put back.
reset role;
update public.orders set rfq_id = null, notes = 'parked-0077' where rfq_id = 'd9000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.convert_rfq_to_order('f1000000-0000-4000-8000-000000000003', 'd9000000-0000-4000-8000-000000000001',
                    '[{"rfq_item_id":"da000000-0000-4000-8000-000000000001"},{"rfq_item_id":"da000000-0000-4000-8000-000000000002"}]'::jsonb)$$,
  '(c) converting without naming quote lines');
reset role;
update public.orders set rfq_id = 'd9000000-0000-4000-8000-000000000001', notes = null where notes = 'parked-0077';
set local role authenticated;
select is((select so.supplier_id from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
           where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Pump X'),
  'c8000000-0000-4000-8000-000000000002'::uuid, '(c) Pump X, which has two quotes, goes to the rank-1 supplier (A, the cheaper)');
select is((select supplier_unit_price from public.order_items
           where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Pump X'),
  10::numeric, '(c) at that quote''s price');
select is((select so.supplier_id from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
           where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Valve Y'),
  'c8000000-0000-4000-8000-000000000003'::uuid, '(c) and Valve Y, which has one quote, goes to B');
select is((select count(*)::int from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000003'), 2,
  '(c) two legs');

-- ------------------------------------------------------------------ (d) split_order_item, happy path
-- Order 3: Pump X x10 on leg A, Valve Y x5 on leg B.
select isnt(public.split_order_item((select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Pump X'),
              4, null, 'c8000000-0000-4000-8000-000000000004', 'eur', 9.5),
  null, '(d) moving 4 of 10 to a new leg for supplier C returns the new line''s id');
select ok((select array_agg(i.qty order by i.qty desc) = array[6, 4]::numeric[]
           from public.order_items i where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Pump X'),
  '(d) the line is now 6 and 4');
select ok((select i.unit_price_net = 100 and i.gst_rate = 18 and i.unit = 'pcs' and i.supplier_unit_price = 9.5
                  and i.rfq_item_id = 'da000000-0000-4000-8000-000000000001' and not i.is_service
                  and so.supplier_id = 'c8000000-0000-4000-8000-000000000004' and so.currency = 'EUR'
           from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
           where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Pump X' and i.qty = 4),
  '(d) the new part copies the selling price, GST, unit and RFQ lineage, takes the given price, and sits on a new EUR leg for C');
select is((select count(*)::int from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000003'), 3,
  '(d) three legs now');
select is((select sum(qty * unit_price_net) from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003'),
  1250::numeric, '(d) the order net is unchanged (10 x 100 + 5 x 50)');
-- to an existing leg (the leg Valve Y is on)
select lives_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Pump X' and qty = 6),
    2, (select supplier_order_id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'))$$,
  '(d) a part can move to an existing leg of the order');
select ok((select array_agg(i.qty order by i.qty desc) = array[4, 4, 2]::numeric[]
                  and (select supplier_unit_price from public.order_items
                       where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Pump X' and qty = 2) is null
           from public.order_items i where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Pump X'),
  '(d) 4, 4 and 2; the new part has no supplier price unless one is given');
-- to a supplier that already has a leg in that currency: the leg is reused, not duplicated (the line on leg A is 4 now)
select lives_ok($$select public.split_order_item(
    (select i.id from public.order_items i join public.supplier_orders so on so.id = i.supplier_order_id
     where i.order_id = 'f1000000-0000-4000-8000-000000000003' and i.description = 'Pump X'
       and so.supplier_id = 'c8000000-0000-4000-8000-000000000002'),
    1, null, 'c8000000-0000-4000-8000-000000000003', 'USD', 12)$$,
  '(d) a split to a supplier that has a leg in that currency');
select is((select count(*)::int from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000003'), 3,
  '(d) reuses that leg instead of adding another');
-- a new leg for a supplier that was asked on the RFQ is linked to its inquiry
-- 0077: one RFQ is won once. To test a further conversion of the same RFQ, its live orders are parked (detached) and put back.
reset role;
update public.orders set rfq_id = null, notes = 'parked-0077' where rfq_id = 'd9000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.convert_rfq_to_order('f1000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-000000000001',
                    '[{"rfq_item_id":"da000000-0000-4000-8000-000000000002"}]'::jsonb)$$,
  '(d) an order with Valve Y only, on leg B');
reset role;
update public.orders set rfq_id = 'd9000000-0000-4000-8000-000000000001', notes = null where notes = 'parked-0077';
set local role authenticated;
select lives_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-00000000000a'),
    2, null, 'c8000000-0000-4000-8000-000000000002', 'USD')$$,
  '(d) 2 of the 5 move to supplier A, which was asked on the RFQ');
select is((select inquiry_id from public.supplier_orders
           where order_id = 'f1000000-0000-4000-8000-00000000000a' and supplier_id = 'c8000000-0000-4000-8000-000000000002'),
  'db000000-0000-4000-8000-000000000001'::uuid, '(d) the new leg is linked to A''s inquiry');
select ok((select array_agg(qty order by qty desc) = array[3, 2]::numeric[]
           from public.order_items where order_id = 'f1000000-0000-4000-8000-00000000000a'),
  '(d) Valve Y is 3 and 2');

-- ------------------------------------------------------------------ (e) refusals
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    5, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  '22023', null, '(e) moving the whole quantity is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    6, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  '22023', null, '(e) more than the quantity is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    0, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  '22023', null, '(e) zero is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    -1, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  '22023', null, '(e) a negative quantity is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000008' limit 1),
    1, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  '22023', null, '(e) a service line is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    1, (select id from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000003' limit 1),
    'c8000000-0000-4000-8000-000000000004')$$,
  '22023', null, '(e) naming both a leg and a supplier is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'), 1)$$,
  '22023', null, '(e) naming neither is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    1, (select id from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000001' limit 1))$$,
  '22023', null, '(e) a leg of another order is refused');
select throws_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    1, (select supplier_order_id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'))$$,
  '22023', null, '(e) the leg the line is already on is refused');
select throws_ok($$select public.split_order_item(gen_random_uuid(), 1, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  'P0002', null, '(e) an unknown line is refused');
select is((select sum(qty * unit_price_net) from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003'),
  1250::numeric, '(e) refusals leave the order as it was');

-- ------------------------------------------------------------------ (f) repeat order copies the split
select lives_ok($$select public.create_repeat_order('f1000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000003')$$,
  '(f) a repeat order of the split order');
select ok((select array_agg(i.qty order by i.qty desc) = array[4, 3, 2, 1]::numeric[]
           from public.order_items i where i.order_id = 'f1000000-0000-4000-8000-000000000009' and i.description = 'Pump X'),
  '(f) copies the parts of Pump X as parts');
select is((select count(*)::int from public.supplier_orders where order_id = 'f1000000-0000-4000-8000-000000000009'), 3,
  '(f) and the legs that carried them');
select is((select sum(qty * unit_price_net) from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000009'),
  1250::numeric, '(f) with the same net total');

-- ------------------------------------------------------------------ roles
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$select public.split_order_item(
    (select id from public.order_items where order_id = 'f1000000-0000-4000-8000-000000000003' and description = 'Valve Y'),
    1, null, 'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  'an engineer can split a line');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.split_order_item('f2000000-0000-4000-8000-000000000001', 1, null,
    'c8000000-0000-4000-8000-000000000004', 'USD')$$,
  'P0002', null, 'a deactivated user cannot see the line, so nothing is split');
reset role;
set local role anon;
select throws_ok($$select public.split_order_item(gen_random_uuid(), 1, null, gen_random_uuid())$$, '42501', null,
  'anon cannot call split_order_item');
reset role;

select * from finish();
rollback;
