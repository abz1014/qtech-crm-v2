begin;
select * from no_plan();

-- 0094 (bug hunt HW-46, HW-47, HW-60): Mark won and Create order.
--   HW-46  issue_quotation clears the price of an item a new revision leaves out.
--   HW-47  convert_rfq_to_order honours "not_sourced": true (no supplier) instead of inferring the rank-1 quote.
--   HW-60  convert_rfq_to_order refuses a stale dialog: p_expected_revision and each entry's expected_qty.
-- Fixture users from supabase/seed.sql: admin a0..01, sales a0..02. Ids: companies c9400000-..-N, RFQs d9400000-..-N,
-- items d9410000-..-N, inquiries d9420000-..-N, quote lines d9430000-..-N, quotations 51940000-..-N, orders f9400000-..-N.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c9400000-0000-4000-8000-000000000001', 'Convert Fix Customer'),
  ('c9400000-0000-4000-8000-000000000002', 'Convert Fix Supplier A'),
  ('c9400000-0000-4000-8000-000000000003', 'Convert Fix Supplier B');
insert into public.rfqs (id, company_id, owner_id) values
  ('d9400000-0000-4000-8000-000000000001', 'c9400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),  -- HW-46
  ('d9400000-0000-4000-8000-000000000002', 'c9400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),  -- HW-47 not sourced
  ('d9400000-0000-4000-8000-000000000003', 'c9400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),  -- HW-47 control
  ('d9400000-0000-4000-8000-000000000004', 'c9400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');  -- HW-60
insert into public.rfq_items (id, rfq_id, position, description, qty, unit, gst_rate) values
  ('d9410000-0000-4000-8000-000000000001', 'd9400000-0000-4000-8000-000000000001', 0, 'Kept item', 1, 'pcs', 18),
  ('d9410000-0000-4000-8000-000000000002', 'd9400000-0000-4000-8000-000000000001', 1, 'Second kept item', 2, 'pcs', 18),
  ('d9410000-0000-4000-8000-000000000003', 'd9400000-0000-4000-8000-000000000001', 2, 'Dropped item', 3, 'pcs', 18),
  ('d9410000-0000-4000-8000-000000000011', 'd9400000-0000-4000-8000-000000000002', 0, 'Two quotes, not sourced', 4, 'pcs', 18),
  ('d9410000-0000-4000-8000-000000000021', 'd9400000-0000-4000-8000-000000000003', 0, 'Two quotes, control', 4, 'pcs', 18),
  ('d9410000-0000-4000-8000-000000000031', 'd9400000-0000-4000-8000-000000000004', 0, 'Stale test item', 2, 'pcs', 18);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('d9420000-0000-4000-8000-000000000011', 'd9400000-0000-4000-8000-000000000002', 'c9400000-0000-4000-8000-000000000002', public.today_pkt()),
  ('d9420000-0000-4000-8000-000000000012', 'd9400000-0000-4000-8000-000000000002', 'c9400000-0000-4000-8000-000000000003', public.today_pkt()),
  ('d9420000-0000-4000-8000-000000000021', 'd9400000-0000-4000-8000-000000000003', 'c9400000-0000-4000-8000-000000000002', public.today_pkt()),
  ('d9420000-0000-4000-8000-000000000022', 'd9400000-0000-4000-8000-000000000003', 'c9400000-0000-4000-8000-000000000003', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('d9430000-0000-4000-8000-000000000011', 'd9420000-0000-4000-8000-000000000011', 'd9410000-0000-4000-8000-000000000011', 10, 'USD'),
  ('d9430000-0000-4000-8000-000000000012', 'd9420000-0000-4000-8000-000000000012', 'd9410000-0000-4000-8000-000000000011', 12, 'USD'),
  ('d9430000-0000-4000-8000-000000000021', 'd9420000-0000-4000-8000-000000000021', 'd9410000-0000-4000-8000-000000000021', 10, 'USD'),
  ('d9430000-0000-4000-8000-000000000022', 'd9420000-0000-4000-8000-000000000022', 'd9410000-0000-4000-8000-000000000021', 12, 'USD');

-- The refusal's hint, read back (throws_ok checks only code and message).
create function pg_temp.hint_of(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end
$f$;

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'convert_rfq_to_order'), 1,
  'one convert_rfq_to_order (the 7-argument one is replaced, not overloaded)');
select ok(has_function_privilege('authenticated', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute')
      and not has_function_privilege('anon', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute')
      and not has_function_privilege('qtech_engineer', 'public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)', 'execute'),
  'authenticated may convert; anon and an engineer may not');
select ok((select p.prosrc ilike '%from public.rfqs where id = p_rfq_id for update%' from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'convert_rfq_to_order'),
  'it still locks the RFQ row before it checks anything');
select ok((select p.prosrc like '%qtech.entered_by_bypass%' from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'issue_quotation'),
  'issue_quotation keeps the 0092 guard marker');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ HW-46: a dropped item loses its price
select lives_ok($$select public.issue_quotation('51940000-0000-4000-8000-000000000001', 'd9400000-0000-4000-8000-000000000001',
    null, null, null, null, null, null,
    '[{"id":"d9410000-0000-4000-8000-000000000001","unit_price":100,"gst_rate":18,"lead_time":"1 week","qty":1},
      {"id":"d9410000-0000-4000-8000-000000000002","unit_price":200,"gst_rate":18,"lead_time":null,"qty":2},
      {"id":"d9410000-0000-4000-8000-000000000003","unit_price":300,"gst_rate":18,"lead_time":"2 weeks","qty":3}]')$$,
  'HW-46: revision 0 quotes three items');
select is((select count(*)::int from public.rfq_items where rfq_id = 'd9400000-0000-4000-8000-000000000001' and quoted_unit_price_net is not null), 3,
  'all three carry a price');
select lives_ok($$select public.issue_quotation('51940000-0000-4000-8000-000000000002', 'd9400000-0000-4000-8000-000000000001',
    null, null, null, null, null, null,
    '[{"id":"d9410000-0000-4000-8000-000000000001","unit_price":110,"gst_rate":18,"lead_time":"1 week","qty":1},
      {"id":"d9410000-0000-4000-8000-000000000002","unit_price":210,"gst_rate":18,"lead_time":null,"qty":2}]')$$,
  'revision 1 quotes only two');
select is((select quoted_unit_price_net from public.rfq_items where id = 'd9410000-0000-4000-8000-000000000003'), null::numeric,
  'the dropped item no longer has the old price');
select is((select quoted_lead_time from public.rfq_items where id = 'd9410000-0000-4000-8000-000000000003'), null::text,
  'nor its old lead time');
select is((select array_agg(quoted_unit_price_net order by position) from public.rfq_items
           where rfq_id = 'd9400000-0000-4000-8000-000000000001' and position < 2), array[110, 210]::numeric[],
  'the two quoted items carry the new revision''s prices');
select is((select revision from public.quotations where id = '51940000-0000-4000-8000-000000000002'), 1::smallint, 'it is revision 1');
select is((select jsonb_array_length(lines) from public.quotations where id = '51940000-0000-4000-8000-000000000001'), 3,
  'revision 0 still shows its three lines (the issued snapshot is untouched)');

-- ------------------------------------------------------------------ HW-47: "Not sourced yet" is honoured
select is(public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000002', 'd9400000-0000-4000-8000-000000000002',
            '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000011","unit_price_net":500,"not_sourced":true}]'::jsonb),
  'f9400000-0000-4000-8000-000000000002'::uuid, 'HW-47: an item with two quotes converts as not sourced');
select is((select supplier_order_id from public.order_items where order_id = 'f9400000-0000-4000-8000-000000000002'), null::uuid,
  'its order line has no supplier order');
select is((select supplier_unit_price from public.order_items where order_id = 'f9400000-0000-4000-8000-000000000002'), null::numeric,
  'and no supplier price');
select is((select count(*)::int from public.supplier_orders where order_id = 'f9400000-0000-4000-8000-000000000002'), 0, 'and no supplier order exists');
select is((select is_service from public.order_items where order_id = 'f9400000-0000-4000-8000-000000000002'), false, 'it is still a goods line');

select is(public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000003', 'd9400000-0000-4000-8000-000000000003',
            '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000021","unit_price_net":500}]'::jsonb),
  'f9400000-0000-4000-8000-000000000003'::uuid, 'the control: the same item without the marker');
select is((select supplier_unit_price from public.order_items where order_id = 'f9400000-0000-4000-8000-000000000003'), 10::numeric,
  'is still given the rank-1 quote (older callers are unchanged)');

-- ------------------------------------------------------------------ HW-60: a stale dialog is refused
select lives_ok($$select public.issue_quotation('51940000-0000-4000-8000-000000000004', 'd9400000-0000-4000-8000-000000000004',
    null, null, null, null, null, null,
    '[{"id":"d9410000-0000-4000-8000-000000000031","unit_price":1000,"gst_rate":18,"lead_time":null,"qty":2}]')$$,
  'HW-60: the RFQ has revision 0');
select throws_ok($$select public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000004', 'd9400000-0000-4000-8000-000000000004',
    '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000031","unit_price_net":1000,"expected_qty":2}]'::jsonb, null, null, null, false, 1)$$,
  'P0001', 'The quotation changed since you opened this. Review again.', 'a dialog opened on another revision is refused');
select is(pg_temp.hint_of($$select public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000004', 'd9400000-0000-4000-8000-000000000004',
    '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000031","unit_price_net":1000}]'::jsonb, null, null, null, false, 1)$$),
  'convert_stale', 'with the hint convert_stale');
select throws_ok($$select public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000004', 'd9400000-0000-4000-8000-000000000004',
    '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000031","unit_price_net":1000,"expected_qty":3}]'::jsonb, null, null, null, false, 0)$$,
  'P0001', 'The quotation changed since you opened this. Review again.', 'a quantity that is no longer the one shown is refused');
select is((select count(*)::int from public.orders where rfq_id = 'd9400000-0000-4000-8000-000000000004'), 0, 'nothing was written');
select is(public.convert_rfq_to_order('f9400000-0000-4000-8000-000000000004', 'd9400000-0000-4000-8000-000000000004',
    '[{"rfq_item_id":"d9410000-0000-4000-8000-000000000031","unit_price_net":1000,"expected_qty":2}]'::jsonb, null, null, null, false, 0),
  'f9400000-0000-4000-8000-000000000004'::uuid, 'the same call with the revision and quantity the person saw makes the order');
select is((select qty from public.order_items where order_id = 'f9400000-0000-4000-8000-000000000004'), 2::numeric, 'at the quantity shown');

reset role;
select * from finish();
rollback;
