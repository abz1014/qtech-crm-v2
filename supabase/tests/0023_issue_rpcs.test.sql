begin;
select plan(63);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Fixtures are inserted as the table owner with the admin's claims; every RPC is then called as `authenticated`
-- so that the caller's own row security applies (the RPCs are SECURITY INVOKER).

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('issue_quotation', 'issue_purchase_order')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'both issue RPCs are SECURITY INVOKER with a fixed search_path, executable by authenticated only');
select is(public.item_text_norm('Hach HQ1110, 24V  actuator 100 mm (2 pcs)'), 'hach hq1110 actuator',
  'item_text_norm keeps model codes and drops standalone quantities and units');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: companies, profile, RFQs
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier'),
  ('c0000000-0000-4000-8000-000000000003', 'Other Supplier');
insert into public.contacts (id, company_id, name) values
  ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Buyer');
insert into public.brands (id, name) values
  ('c3000000-0000-4000-8000-000000000001', 'Hach'),
  ('c3000000-0000-4000-8000-000000000002', 'Other');
update public.company_profile set legal_name = 'Q-Tech', address = 'Q-Tech, Lahore', po_terms = 'Net 30',
                                 quotation_validity_days = 14;

insert into public.rfqs (id, company_id, contact_id, owner_id, quoted_on, closed_on, close_reason) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null, null),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', null, null, null),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', null, null, null),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 40, null, null),
  ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 40, public.today_pkt(), 'price'),
  ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 40, null, null),
  ('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 40, null, null),
  ('d0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', null, null, null),
  ('d0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 40, null, null),
  ('d0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', null, null, null),
  ('d0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000001', null, 'a0000000-0000-4000-8000-000000000002', null, null, null);
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net, gst_rate, quoted_lead_time) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 0, 'Pump', 2, 100, 18, '2 weeks'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 1, 'Fee', 1, 50.5, 0, null),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', 0, 'No price yet', 1, null, 18, null),
  ('d1000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', 0, 'Engineer RFQ item', 1, 10, 18, null),
  ('d1000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000b', 0, 'Valve', 1, 30, 18, null),
  ('d1000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-00000000000b', 1, 'Cable', 1, 12, 18, null);

-- ------------------------------------------------------------------ issue_quotation (sales)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.issue_quotation('51000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  '51000000-0000-4000-8000-000000000001'::uuid, 'issue_quotation returns the quotation id');
select ok((select revision = 0 and issued_on = public.today_pkt() and valid_until = public.today_pkt() + 14
                  and contact_id = 'c2000000-0000-4000-8000-000000000001'
                  and signatory_id = 'a0000000-0000-4000-8000-000000000002' and number >= 1
           from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'revision 0, issued today, valid for the profile''s 14 days, addressed to the RFQ contact, signed by the caller');
select ok((select net_total = 250.50 and gst_total = 36 and jsonb_array_length(lines) = 2
           from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'totals come from the lines: net 250.50, GST 36 (the exempt line has none)');
select ok((select lines -> 0 ->> 'lead_time' = '2 weeks' and lines -> 0 ->> 'description' = 'Pump'
                  and (lines -> 0 ->> 'qty')::numeric = 2 and (lines -> 0 ->> 'unit_price_net')::numeric = 100
                  and lines -> 0 ->> 'rfq_item_id' = 'd1000000-0000-4000-8000-000000000001'
                  and lines -> 1 ->> 'lead_time' is null
           from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'the snapshot carries the line fields, including the per-line lead time');
select is((select quoted_on from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'), public.today_pkt(),
  'issuing stamps quoted_on');
select is(public.issue_quotation('51000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  '51000000-0000-4000-8000-000000000001'::uuid, 'a double submit returns the same quotation');
select is((select count(*)::int from public.quotations where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 1,
  'and leaves one row');

-- Re-issue after a price change: same number, revision + 1, the old revision is untouched.
reset role;
update public.rfq_items set quoted_unit_price_net = 120 where id = 'd1000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
                    null, null, '4-6 weeks from PO', '30 days', 'Prices ex-works')$$, 're-issue');
select ok((select q.number = p.number and q.revision = 1 and q.net_total = 290.50 and q.gst_total = 43
                  and q.delivery_text = '4-6 weeks from PO' and q.payment_terms = '30 days' and q.notes = 'Prices ex-works'
           from public.quotations q, public.quotations p
           where q.id = '51000000-0000-4000-8000-000000000002' and p.id = '51000000-0000-4000-8000-000000000001'),
  're-issue keeps the number, adds a revision, and snapshots the new prices and wording');
select ok((select net_total = 250.50 and revision = 0 and delivery_text is null
           from public.quotations where id = '51000000-0000-4000-8000-000000000001'),
  'the previous revision is not changed');
select lives_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
                    date '2031-05-05')$$, 'a third issue with an explicit validity date');
select ok((select revision = 2 and valid_until = date '2031-05-05' and delivery_text = '4-6 weeks from PO'
                  and payment_terms = '30 days' and notes = 'Prices ex-works'
           from public.quotations where id = '51000000-0000-4000-8000-000000000003'),
  'wording is carried from the previous revision when not given again; the validity date can be set');
select ok((select quotation_valid_until = date '2031-05-05' from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'),
  'v_rfq_state shows the latest quotation''s validity');

select lives_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-00000000000a')$$,
  'a different RFQ');
select isnt((select number from public.quotations where id = '51000000-0000-4000-8000-000000000004'),
  (select number from public.quotations where id = '51000000-0000-4000-8000-000000000001'), 'gets its own number');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002')$$,
  '22023', null, 'an item without a quoted price blocks the quotation');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000003')$$,
  '22023', null, 'an RFQ with no items cannot be quoted');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000005', gen_random_uuid())$$,
  'P0002', null, 'an unknown RFQ is refused');
select is((select count(*)::int from public.quotations where id = '51000000-0000-4000-8000-000000000005'), 0,
  'refused issues leave nothing behind');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-00000000000b')$$,
  'an engineer can issue a quotation');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-00000000000a')$$,
  'P0002', null, 'a deactivated user cannot see the RFQ, so cannot quote it');
reset role;

-- ------------------------------------------------------------------ v_rfq_state: quotation_expired
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.orders (id, company_id, rfq_id, owner_id) values
  ('a1000000-0000-4000-8000-0000000000e6', 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000002');
insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, lines) values
  ('51000000-0000-4000-8000-0000000000e4', 'd0000000-0000-4000-8000-000000000004', 101, 0, public.today_pkt() - 40, public.today_pkt() - 10, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  ('51000000-0000-4000-8000-0000000000e5', 'd0000000-0000-4000-8000-000000000005', 102, 0, public.today_pkt() - 40, public.today_pkt() - 10, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  ('51000000-0000-4000-8000-0000000000e6', 'd0000000-0000-4000-8000-000000000006', 103, 0, public.today_pkt() - 40, public.today_pkt() - 10, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  ('51000000-0000-4000-8000-0000000000e9', 'd0000000-0000-4000-8000-000000000009', 104, 0, public.today_pkt() - 40, public.today_pkt() - 10, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  ('51000000-0000-4000-8000-0000000000ea', 'd0000000-0000-4000-8000-000000000009', 104, 1, public.today_pkt() - 5, public.today_pkt() + 10, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000004'), 'quotation_expired',
  'an open RFQ whose latest quotation has lapsed is quotation_expired');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000005'), 'bid_sent',
  'a closed RFQ is not shown as expired');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000006'), 'bid_sent',
  'nor is a won one');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000009'), 'bid_sent',
  'the latest revision decides: a lapsed R0 followed by a valid R1 is bid_sent');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000007'), 'bid_sent',
  'quoted_on without any quotation stays bid_sent');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000008'), 'to_bid',
  'never quoted is to_bid');
select is((select bid_state from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000001'), 'bid_sent',
  'a current quotation is bid_sent');
select ok((select quotation_valid_until is null from public.v_rfq_state where rfq_id = 'd0000000-0000-4000-8000-000000000008'),
  'quotation_valid_until is empty without a quotation');

-- ------------------------------------------------------------------ fixtures: purchase orders
insert into public.rfq_items (id, rfq_id, position, description) values
  ('d1000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-00000000000b', 5, 'Valve link'),
  ('d1000000-0000-4000-8000-0000000000f2', 'd0000000-0000-4000-8000-00000000000b', 6, 'Cable link');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000003');
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values
  ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000f1', 20, 'USD'),
  ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000f2', 8, 'EUR'),
  ('e0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-00000000000a', 99, 'USD');

insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000002', 'USD'),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'USD'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', null),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'USD'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'USD'),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'USD');
-- An earlier PO to the same supplier: the source of last_po prices and of the default terms.
insert into public.order_items (id, order_id, position, description, brand_id, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('a3000000-0000-4000-8000-000000000f00', 'a1000000-0000-4000-8000-000000000000', 0, 'HQ1110 pH/EC meter with probes',
   'c3000000-0000-4000-8000-000000000001', 1, 'a2000000-0000-4000-8000-000000000000', 77);
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, lines, total, incoterm, delivery_terms, payment_terms) values
  ('52000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000000', 500, 0, 'USD',
   '[{"order_item_id":"a3000000-0000-4000-8000-000000000f00","qty":1,"unit_price":77,"price_source":"typed"}]', 0,
   'FOB', 'Ex works Shenzhen', '50% advance');
-- Leg L1: five goods lines (order price, quote, EUR-only quote, same model, nothing) and a service line.
insert into public.order_items (id, order_id, position, description, brand_id, qty, unit_price_net, supplier_order_id,
                                supplier_unit_price, rfq_item_id, is_service) values
  ('a3000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 0, 'Pump', null, 2, 1, 'a2000000-0000-4000-8000-000000000001', 55, null, false),
  ('a3000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-000000000001', 1, 'Valve', null, 1, 1, 'a2000000-0000-4000-8000-000000000001', null, 'd1000000-0000-4000-8000-0000000000f1', false),
  ('a3000000-0000-4000-8000-0000000000a3', 'a1000000-0000-4000-8000-000000000001', 2, 'Cable', null, 1, 1, 'a2000000-0000-4000-8000-000000000001', null, 'd1000000-0000-4000-8000-0000000000f2', false),
  ('a3000000-0000-4000-8000-0000000000a4', 'a1000000-0000-4000-8000-000000000001', 3, 'Hach HQ1110 portable meter', 'c3000000-0000-4000-8000-000000000001', 1, 1, 'a2000000-0000-4000-8000-000000000001', null, null, false),
  ('a3000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-000000000001', 4, 'Mystery', null, 1, 1, 'a2000000-0000-4000-8000-000000000001', null, null, false),
  ('a3000000-0000-4000-8000-0000000000a6', 'a1000000-0000-4000-8000-000000000001', 5, 'Commissioning', null, 1, 1, null, null, null, true),
  -- L2 has no currency; L3 belongs to the other supplier; L5 tests the brand rule.
  ('a3000000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-000000000001', 0, 'Orphan', null, 1, 1, 'a2000000-0000-4000-8000-000000000002', 5, null, false),
  ('a3000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-000000000001', 0, 'Gizmo', null, 1, 1, 'a2000000-0000-4000-8000-000000000003', 5, null, false),
  ('a3000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-000000000001', 0, 'HQ1110 sensor', 'c3000000-0000-4000-8000-000000000002', 1, 1, 'a2000000-0000-4000-8000-000000000005', null, null, false),
  ('a3000000-0000-4000-8000-0000000000d2', 'a1000000-0000-4000-8000-000000000001', 1, 'Hach HQ1110 portable', 'c3000000-0000-4000-8000-000000000001', 1, 1, 'a2000000-0000-4000-8000-000000000005', null, null, false);

-- ------------------------------------------------------------------ issue_purchase_order (sales)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b1', 'a2000000-0000-4000-8000-000000000002')$$,
  '22023', null, 'a leg with no currency is refused');
select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b1', 'a2000000-0000-4000-8000-000000000006')$$,
  '22023', null, 'a leg with no goods lines is refused');
select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b1', 'a2000000-0000-4000-8000-000000000001')$$,
  '22023', null, 'lines with no price from any source are refused until a price is typed');
select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b1', 'a2000000-0000-4000-8000-000000000001',
                     '[{"order_item_id":"a3000000-0000-4000-8000-0000000000b1"}]'::jsonb)$$,
  '22023', null, 'a line from another supplier order is refused');
select is((select count(*)::int from public.purchase_orders where supplier_order_id = 'a2000000-0000-4000-8000-000000000001'), 0,
  'refusals leave no PO');

select is(public.issue_purchase_order('52000000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000001',
            '[{"order_item_id":"a3000000-0000-4000-8000-0000000000a1"},
              {"order_item_id":"a3000000-0000-4000-8000-0000000000a2"},
              {"order_item_id":"a3000000-0000-4000-8000-0000000000a3","unit_price":9.5},
              {"order_item_id":"a3000000-0000-4000-8000-0000000000a4"},
              {"order_item_id":"a3000000-0000-4000-8000-0000000000a5","unit_price":12}]'::jsonb),
  '52000000-0000-4000-8000-000000000010'::uuid, 'issue_purchase_order returns the PO id');
select ok((select number > 0 and number <> 500 and revision = 0 and currency = 'USD' and issued_on = public.today_pkt()
                  and signatory_id = 'a0000000-0000-4000-8000-000000000002'
           from public.purchase_orders where id = '52000000-0000-4000-8000-000000000010'),
  'revision 0, the leg''s currency frozen into the PO, issued today, signed by the caller');
select is((select l ->> 'price_source' from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Pump'), 'order',
  'source 1: the order item''s own supplier price is labelled order');
select ok((select (l ->> 'unit_price')::numeric = 55 and (l ->> 'qty')::numeric = 2
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Pump'),
  'with its price and quantity');
select ok((select l ->> 'price_source' = 'quote' and (l ->> 'unit_price')::numeric = 20
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Valve'),
  'source 2: the supplier''s own quote line in the leg''s currency is labelled quote');
select ok((select l ->> 'price_source' = 'typed' and (l ->> 'unit_price')::numeric = 9.5
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Cable'),
  'a quote in another currency (EUR on a USD leg) is not used; the typed price is labelled typed');
select ok((select l ->> 'price_source' = 'last_po' and (l ->> 'unit_price')::numeric = 77
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Hach HQ1110 portable meter'),
  'source 3: a same-model line on the supplier''s last PO is labelled last_po');
select ok((select l ->> 'price_source' = 'typed' and (l ->> 'unit_price')::numeric = 12
           from public.purchase_orders p, jsonb_array_elements(p.lines) l
           where p.id = '52000000-0000-4000-8000-000000000010' and l ->> 'description' = 'Mystery'),
  'source 4: nothing found, the typed price is labelled typed');
select ok((select not exists (select 1 from jsonb_array_elements(lines) l where l ->> 'description' = 'Commissioning')
                  and jsonb_array_length(lines) = 5
           from public.purchase_orders where id = '52000000-0000-4000-8000-000000000010'),
  'service lines are not on the PO');
select is((select total from public.purchase_orders where id = '52000000-0000-4000-8000-000000000010'), 228.50::numeric,
  'the total is 2 x 55 + 20 + 9.5 + 77 + 12');
select ok((select incoterm = 'FOB' and delivery_terms = 'Ex works Shenzhen' and payment_terms = '50% advance'
                  and ship_to = 'Q-Tech, Lahore'
           from public.purchase_orders where id = '52000000-0000-4000-8000-000000000010'),
  'terms default to the supplier''s last PO, and ship-to to the company address');
select ok((select (select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a1') = 55
                  and (select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a2') = 20
                  and (select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a3') = 9.5
                  and (select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a4') = 77
                  and (select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a5') = 12),
  'the issued prices are written back to the order items');
select is((select placed_on from public.supplier_orders where id = 'a2000000-0000-4000-8000-000000000001'), public.today_pkt(),
  'issuing stamps placed_on');
select is(public.issue_purchase_order('52000000-0000-4000-8000-000000000010', 'a2000000-0000-4000-8000-000000000001'),
  '52000000-0000-4000-8000-000000000010'::uuid, 'a double submit returns the same PO');
select is((select count(*)::int from public.purchase_orders where supplier_order_id = 'a2000000-0000-4000-8000-000000000001'), 1,
  'and leaves one row');

-- Re-issue: same number, revision + 1; an edited price is typed; written-back prices are now the order source.
select lives_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001',
                    '[{"order_item_id":"a3000000-0000-4000-8000-0000000000a1","unit_price":60},
                      {"order_item_id":"a3000000-0000-4000-8000-0000000000a3"}]'::jsonb, 'CIF')$$, 're-issue a subset with one edited price');
select ok((select q.number = p.number and q.revision = 1 and q.incoterm = 'CIF' and q.delivery_terms = 'Ex works Shenzhen'
           from public.purchase_orders q, public.purchase_orders p
           where q.id = '52000000-0000-4000-8000-000000000011' and p.id = '52000000-0000-4000-8000-000000000010'),
  're-issue keeps the number, adds a revision, and takes the incoterm override while inheriting the other terms');
select ok((select (select l ->> 'price_source' from jsonb_array_elements(lines) l where l ->> 'description' = 'Pump') = 'typed'
                  and (select l ->> 'price_source' from jsonb_array_elements(lines) l where l ->> 'description' = 'Cable') = 'order'
                  and total = 129.50
           from public.purchase_orders where id = '52000000-0000-4000-8000-000000000011'),
  'an edited price is typed; an unchanged one now comes from the order (written back by the first issue)');
select is((select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-0000000000a1'), 60::numeric,
  'the edited price is written back');
select ok((select total = 228.50 and revision = 0 and jsonb_array_length(lines) = 5
           from public.purchase_orders where id = '52000000-0000-4000-8000-000000000010'),
  'the earlier revision is untouched');

-- The brand rule: a shared model token is not enough across brands.
select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b2', 'a2000000-0000-4000-8000-000000000005',
                     '[{"order_item_id":"a3000000-0000-4000-8000-0000000000d1"}]'::jsonb)$$,
  '22023', null, 'a cross-brand model match is not used as a last_po price');
select lives_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000b2', 'a2000000-0000-4000-8000-000000000005',
                    '[{"order_item_id":"a3000000-0000-4000-8000-0000000000d2"}]'::jsonb)$$,
  'but the same brand and model is');

-- A supplier with no earlier PO: payment terms fall back to the company profile.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-000000000003')$$,
  'an engineer can issue a PO (all prices pre-filled)');
select ok((select incoterm is null and delivery_terms is null and payment_terms = 'Net 30' and ship_to = 'Q-Tech, Lahore'
                  and number > 0 and number <> 500
           from public.purchase_orders where id = '52000000-0000-4000-8000-0000000000c1'),
  'no earlier PO to this supplier: payment terms come from the profile''s PO terms');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000c2', 'a2000000-0000-4000-8000-000000000001')$$,
  'P0002', null, 'a deactivated user cannot see the leg, so cannot issue');
reset role;

-- ------------------------------------------------------------------ anon
set local role anon;
select throws_ok($$select public.issue_quotation(gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anon cannot issue a quotation');
select throws_ok($$select public.issue_purchase_order(gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'anon cannot issue a PO');
reset role;

select * from finish();
rollback;
