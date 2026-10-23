begin;
select * from no_plan();

-- 0095: order, PO and repeat-order fixes from the RFQ -> order hunt (HW-51 to HW-63).
-- Fixture users from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.
-- Fixtures are inserted as the table owner; every RPC and update under test runs as `authenticated` (sales).
-- Ids: companies f9500000-..-0N (1 customer, 2 supplier), orders f9510000-..-NN, supplier orders f9520000-..-NN,
-- order items f9530000-..-NN, RFQs f9540000-..-NN, purchase orders f9550000-..-NN.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('f9500000-0000-4000-8000-000000000001', 'Fixes Customer'),
  ('f9500000-0000-4000-8000-000000000002', 'Fixes Supplier'),
  ('f9500000-0000-4000-8000-000000000003', 'Fixes Other Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('f9540000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');

-- the customer PO key (HW-52): 01 holds PO-95, 02 will want it
-- the RFQ (HW-58): 03 (cancelled) and 04 (live) are both from RFQ 01
-- repeat (HW-53/54/55): 05 live source, 06 cancelled source, 07 price basis unknown
insert into public.orders (id, company_id, owner_id, customer_po_number, rfq_id, legacy_flags) values
  ('f9510000-0000-4000-8000-000000000001', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'PO-95', null, '{}'),
  ('f9510000-0000-4000-8000-000000000003', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, 'f9540000-0000-4000-8000-000000000001', '{}'),
  ('f9510000-0000-4000-8000-000000000005', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null, '{}'),
  ('f9510000-0000-4000-8000-000000000006', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null, '{}'),
  ('f9510000-0000-4000-8000-000000000007', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null, array['value_basis_unknown']),
  ('f9510000-0000-4000-8000-000000000008', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null, '{}');
update public.orders set cancelled_on = public.today_pkt(), cancel_reason = 'customer_cancelled'
  where id in ('f9510000-0000-4000-8000-000000000003', 'f9510000-0000-4000-8000-000000000006');
insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('f9510000-0000-4000-8000-000000000004', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'f9540000-0000-4000-8000-000000000001');

-- supplier orders: 11 goods leg of order 05 (repeat source), 12 delivered leg, 13 and 14 for the PO revision checks
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('f9520000-0000-4000-8000-000000000011', 'f9510000-0000-4000-8000-000000000005', 'f9500000-0000-4000-8000-000000000002', 'USD'),
  ('f9520000-0000-4000-8000-000000000012', 'f9510000-0000-4000-8000-000000000008', 'f9500000-0000-4000-8000-000000000002', 'USD'),
  ('f9520000-0000-4000-8000-000000000013', 'f9510000-0000-4000-8000-000000000008', 'f9500000-0000-4000-8000-000000000002', 'EUR'),
  ('f9520000-0000-4000-8000-000000000014', 'f9510000-0000-4000-8000-000000000008', 'f9500000-0000-4000-8000-000000000002', 'GBP');
insert into public.order_items (id, order_id, position, description, qty, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('f9530000-0000-4000-8000-000000000001', 'f9510000-0000-4000-8000-000000000005', 0, 'Priced pump', 2, 100, 'f9520000-0000-4000-8000-000000000011', 10),
  ('f9530000-0000-4000-8000-000000000002', 'f9510000-0000-4000-8000-000000000005', 1, 'Zero priced valve', 3, 0, 'f9520000-0000-4000-8000-000000000011', 7),
  ('f9530000-0000-4000-8000-000000000003', 'f9510000-0000-4000-8000-000000000005', 2, 'Priced cable', 1, 50, null, null),
  ('f9530000-0000-4000-8000-000000000004', 'f9510000-0000-4000-8000-000000000006', 0, 'Cancelled order pump', 1, 100, null, null),
  ('f9530000-0000-4000-8000-000000000005', 'f9510000-0000-4000-8000-000000000007', 0, 'Imported contactor', 1, 125000, null, null),
  ('f9530000-0000-4000-8000-000000000006', 'f9510000-0000-4000-8000-000000000008', 0, 'Delivered goods', 4, 10, 'f9520000-0000-4000-8000-000000000012', 5),
  ('f9530000-0000-4000-8000-000000000007', 'f9510000-0000-4000-8000-000000000008', 1, 'Stale quantity goods', 10, 10, 'f9520000-0000-4000-8000-000000000013', 5),
  ('f9530000-0000-4000-8000-000000000008', 'f9510000-0000-4000-8000-000000000008', 2, 'Two screens goods', 2, 10, 'f9520000-0000-4000-8000-000000000014', 5);
update public.supplier_orders set delivered_on = public.today_pkt() - 3, received_on = public.today_pkt() - 3
  where id = 'f9520000-0000-4000-8000-000000000012';

-- ------------------------------------------------------------------ structure
select ok((select indexdef ilike '%cancelled_on IS NULL%' from pg_indexes where schemaname = 'public' and indexname = 'orders_company_po_key'),
  'HW-52: the customer PO key only holds live orders');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('issue_purchase_order', 'create_repeat_order')), 2,
  'one issue_purchase_order and one create_repeat_order (the old signatures are gone)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('issue_purchase_order', 'create_repeat_order')
           and not p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'
           and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
           and not has_function_privilege('qtech_engineer', p.oid, 'execute')), 2,
  'both stay SECURITY INVOKER with a fixed search_path, for authenticated only, and an engineer (no prices) cannot run them');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ HW-52: a PO already on a live order
select throws_ok($$insert into public.orders (id, company_id, owner_id, customer_po_number)
                   values ('f9510000-0000-4000-8000-000000000002', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'PO-95')$$,
  '23505',
  (select format('PO PO-95 is already on order ORD-%s. Open that order instead of adding a second.', lpad(number::text, 4, '0'))
   from public.orders where id = 'f9510000-0000-4000-8000-000000000001'),
  'HW-52: a second live order with the same PO is refused, naming the PO and the order');
select lives_ok($$insert into public.orders (id, company_id, owner_id, customer_po_number)
                  values ('f9510000-0000-4000-8000-000000000009', 'f9500000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'PO-95')$$,
  'HW-52: the same PO for another customer is fine');
reset role;
update public.orders set cancelled_on = public.today_pkt(), cancel_reason = 'customer_cancelled' where id = 'f9510000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$insert into public.orders (id, company_id, owner_id, customer_po_number)
                  values ('f9510000-0000-4000-8000-000000000002', 'f9500000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'PO-95')$$,
  'HW-52: after the order holding the PO is cancelled, the customer''s re-sent PO goes on a new order');
select throws_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'f9510000-0000-4000-8000-000000000001'$$,
  '23505',
  (select format('PO PO-95 is already on order ORD-%s. Open that order instead of adding a second.', lpad(number::text, 4, '0'))
   from public.orders where id = 'f9510000-0000-4000-8000-000000000002'),
  'HW-52: and the cancelled order cannot be reopened while the new one holds the PO');

-- ------------------------------------------------------------------ HW-58: no reopening while the RFQ has another live order
select throws_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'f9510000-0000-4000-8000-000000000003'$$,
  'P0001',
  (select format('RFQ-%s already has live order ORD-%s.', lpad(r.number::text, 4, '0'), lpad(o.number::text, 4, '0'))
   from public.rfqs r, public.orders o where r.id = 'f9540000-0000-4000-8000-000000000001' and o.id = 'f9510000-0000-4000-8000-000000000004'),
  'HW-58: Reopen order is refused while the RFQ has a live order, naming both');
select is((select cancelled_on is not null from public.orders where id = 'f9510000-0000-4000-8000-000000000003'), true, 'HW-58: the order stays cancelled');
update public.orders set cancelled_on = public.today_pkt(), cancel_reason = 'customer_cancelled' where id = 'f9510000-0000-4000-8000-000000000004';
select lives_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'f9510000-0000-4000-8000-000000000003'$$,
  'HW-58: once the other order is cancelled, it can be reopened');
select throws_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'f9510000-0000-4000-8000-000000000004'$$,
  'P0001', null, 'HW-58: and now the other one cannot');

-- ------------------------------------------------------------------ HW-53/54/55: create_repeat_order
select is(public.create_repeat_order('f9510000-0000-4000-8000-0000000000a5', 'f9510000-0000-4000-8000-000000000005'),
  'f9510000-0000-4000-8000-0000000000a5'::uuid, 'a live order is repeated');
select is((select array_agg(unit_price_net order by position) from public.order_items where order_id = 'f9510000-0000-4000-8000-0000000000a5'),
  array[100, 0, 50]::numeric[], 'HW-55: the priced lines keep their price; the line priced 0 stays empty (the order page reads it as Price needed)');
select throws_ok($$select public.create_repeat_order('f9510000-0000-4000-8000-0000000000a6', 'f9510000-0000-4000-8000-000000000006')$$,
  'P0001', 'This order was cancelled. Repeat it anyway?', 'HW-53: a cancelled order is not repeated without a word');
select is((select count(*)::int from public.orders where id = 'f9510000-0000-4000-8000-0000000000a6'), 0, 'HW-53: and nothing was made');
select is(public.create_repeat_order('f9510000-0000-4000-8000-0000000000a6', 'f9510000-0000-4000-8000-000000000006', null, null, true),
  'f9510000-0000-4000-8000-0000000000a6'::uuid, 'HW-53: with the confirmation it is');
select is(public.create_repeat_order('f9510000-0000-4000-8000-0000000000a7', 'f9510000-0000-4000-8000-000000000007'),
  'f9510000-0000-4000-8000-0000000000a7'::uuid, 'an order whose price basis is unknown is repeated');
select is((select array_agg(unit_price_net order by position) from public.order_items where order_id = 'f9510000-0000-4000-8000-0000000000a7'),
  array[0]::numeric[], 'HW-54: its figure is not copied as a net price');
select is((select legacy_flags from public.orders where id = 'f9510000-0000-4000-8000-0000000000a7'), '{}'::text[],
  'HW-54: and the new order does not claim an unknown basis it never had');

-- ------------------------------------------------------------------ HW-51: a delivered supplier order is placed no later than delivered
select lives_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000012', 'f9520000-0000-4000-8000-000000000012')$$,
  'HW-51: a PO is issued on a supplier order that was already delivered');
select ok((select placed_on is not null and placed_on <= delivered_on from public.supplier_orders where id = 'f9520000-0000-4000-8000-000000000012'),
  'HW-51: Placed is not after Delivered');
select is((select placed_on from public.supplier_orders where id = 'f9520000-0000-4000-8000-000000000012'), public.today_pkt() - 3,
  'HW-51: it is the delivered date');

-- ------------------------------------------------------------------ HW-61: quantities that changed since the dialog opened
select throws_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000013', 'f9520000-0000-4000-8000-000000000013',
                     '[{"order_item_id":"f9530000-0000-4000-8000-000000000007","qty":6,"unit_price":5}]'::jsonb)$$,
  'P0001', 'The order lines changed. Review again.', 'HW-61: a stale quantity is refused');
select is((select count(*)::int from public.purchase_orders where supplier_order_id = 'f9520000-0000-4000-8000-000000000013'), 0, 'HW-61: and no PO was made');
select lives_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000013', 'f9520000-0000-4000-8000-000000000013',
                    '[{"order_item_id":"f9530000-0000-4000-8000-000000000007","qty":10,"unit_price":5}]'::jsonb)$$,
  'HW-61: the quantity the order still has is issued');

-- ------------------------------------------------------------------ HW-63: two people issue for one supplier order
select lives_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000014', 'f9520000-0000-4000-8000-000000000014',
                    null, null, null, null, null, null, 0)$$,
  'HW-63: the first press issues R0 as it expected');
select throws_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000015', 'f9520000-0000-4000-8000-000000000014',
                     null, null, null, null, null, null, 0)$$,
  'P0001',
  (select format('PO R0 was just issued by %s. Revise instead?', u.name) from public.users u where u.id = 'a0000000-0000-4000-8000-000000000002'),
  'HW-63: the second, which still expected R0, is refused and told who issued it');
select is((select count(*)::int from public.purchase_orders where supplier_order_id = 'f9520000-0000-4000-8000-000000000014'), 1, 'HW-63: one PO, not an identical R1');
select lives_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000015', 'f9520000-0000-4000-8000-000000000014',
                    null, null, null, null, null, null, 1)$$,
  'HW-63: a revision that expects R1 is issued');
select is((select max(revision)::int from public.purchase_orders where supplier_order_id = 'f9520000-0000-4000-8000-000000000014'), 1, 'HW-63: as R1');
select lives_ok($$select public.issue_purchase_order('f9550000-0000-4000-8000-000000000016', 'f9520000-0000-4000-8000-000000000014')$$,
  'a caller that expects nothing in particular still revises (the old behaviour)');

reset role;
select * from finish();
rollback;
