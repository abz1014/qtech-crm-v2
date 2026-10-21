begin;
select plan(18);
-- po_line_prefill dates a quote by created_at::date in the session time zone; run the session on Karachi time so "and on which day"
-- (today_pkt) holds between 19:00 and 24:00 UTC too, when the UTC date is a day behind Karachi's (it failed CI at 19:15 UTC).
set local timezone = 'Asia/Karachi';

-- O07: po_line_prefill(leg) says what issue_purchase_order will pre-fill, and where each price came from.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'po_line_prefill'
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'po_line_prefill is SECURITY INVOKER with a fixed search_path, executable by authenticated only');

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000e1', 'O07 Customer'),
  ('c0000000-0000-4000-8000-0000000000e2', 'O07 Supplier'),
  ('c0000000-0000-4000-8000-0000000000e3', 'O07 Other Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty) values
  ('e0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', 0, 'Memosens CPS11E pH sensor', 2);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e2', public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('f1000000-0000-4000-8000-0000000000e1', 'f0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000000e1', 428, 'USD');
insert into public.orders (id, company_id) values
  ('a1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1'),
  ('a1000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e1');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e2', 'USD'),
  ('a2000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e2', 'USD'),
  ('a2000000-0000-4000-8000-0000000000e3', 'a1000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e3', null);
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, supplier_order_id, supplier_unit_price, rfq_item_id, is_service) values
  ('a3000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000e1', 0, 'Cerabar PMC51 pressure transmitter', 3, 'ea', 100, 'a2000000-0000-4000-8000-0000000000e1', 612, null, false),
  ('a3000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-0000000000e1', 1, 'Memosens CPS11E pH sensor', 2, 'ea', 100, 'a2000000-0000-4000-8000-0000000000e1', null, 'e0000000-0000-4000-8000-0000000000e1', false),
  ('a3000000-0000-4000-8000-0000000000e3', 'a1000000-0000-4000-8000-0000000000e1', 2, 'Siemens SITRANS LUC500 level controller', 2, 'ea', 100, 'a2000000-0000-4000-8000-0000000000e1', null, null, false),
  ('a3000000-0000-4000-8000-0000000000e4', 'a1000000-0000-4000-8000-0000000000e1', 3, 'Commissioning and loop check', 1, 'job', 100, null, null, null, true),
  ('a3000000-0000-4000-8000-0000000000e5', 'a1000000-0000-4000-8000-0000000000e2', 0, 'Siemens SITRANS LUC500 level controller', 1, 'ea', 100, 'a2000000-0000-4000-8000-0000000000e2', null, null, false),
  ('a3000000-0000-4000-8000-0000000000e6', 'a1000000-0000-4000-8000-0000000000e2', 1, 'M12 sensor cable set, 5 m', 8, 'ea', 100, 'a2000000-0000-4000-8000-0000000000e2', null, null, false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ before any PO: order, quote and typed
select is((select count(*)::int from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1')), 3,
  'only the goods lines of the leg are listed (the service line and other legs are not)');
select is((select price_source from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e1'),
  'order', 'a line with a supplier price on the order reads "order"');
select is((select unit_price from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e1'),
  612::numeric, 'and carries that price');
select is((select price_source from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e2'),
  'quote', 'a line with no order price but the supplier''s quote reads "quote"');
select is((select unit_price from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e2'),
  428::numeric, 'and carries the quoted price in the leg''s currency');
select is((select source_number from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e2'),
  (select number::integer from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000e1'), 'a quote says which RFQ it was given on');
select is((select source_on from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e2'),
  public.today_pkt(), 'and on which day');
select is((select price_source || ':' || coalesce(unit_price::text, 'null') from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1') where order_item_id = 'a3000000-0000-4000-8000-0000000000e3'),
  'typed:null', 'a line nothing knows a price for reads "typed" with no price');

-- ------------------------------------------------------------------ the PO is issued; the same function must have said so
create temp table pre on commit drop as
  select order_item_id, price_source, unit_price from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1');
select lives_ok($$select public.issue_purchase_order('52000000-0000-4000-8000-0000000000e1', 'a2000000-0000-4000-8000-0000000000e1',
  '[{"order_item_id":"a3000000-0000-4000-8000-0000000000e1","unit_price":612},
    {"order_item_id":"a3000000-0000-4000-8000-0000000000e2","unit_price":428},
    {"order_item_id":"a3000000-0000-4000-8000-0000000000e3","unit_price":742}]'::jsonb)$$, 'the PO is issued with the pre-filled prices and one typed price');
select is((select count(*)::int
           from public.purchase_orders po
           cross join lateral jsonb_to_recordset(po.lines) as l (order_item_id uuid, unit_price numeric, price_source text)
           join pre on pre.order_item_id = l.order_item_id
           where po.id = '52000000-0000-4000-8000-0000000000e1'
             and l.price_source = case when pre.unit_price is null then 'typed' else pre.price_source end
             and l.unit_price = coalesce(pre.unit_price, 742)), 3,
  'every issued line has the price and source po_line_prefill reported (typed where it had no price)');

-- ------------------------------------------------------------------ the next PO to the same supplier: last_po
select is((select price_source from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e2') where order_item_id = 'a3000000-0000-4000-8000-0000000000e5'),
  'last_po', 'a similar line on the supplier''s last PO reads "last_po"');
select is((select unit_price from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e2') where order_item_id = 'a3000000-0000-4000-8000-0000000000e5'),
  742::numeric, 'and carries that PO''s price');
select is((select source_number from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e2') where order_item_id = 'a3000000-0000-4000-8000-0000000000e5'),
  (select number from public.purchase_orders where id = '52000000-0000-4000-8000-0000000000e1'), 'it names that PO');
select is((select source_revision from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e2') where order_item_id = 'a3000000-0000-4000-8000-0000000000e5'),
  0::smallint, 'and its revision');
select is((select price_source from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e2') where order_item_id = 'a3000000-0000-4000-8000-0000000000e6'),
  'typed', 'an unrelated line stays typed');

-- ------------------------------------------------------------------ access
select is((select count(*)::int from public.po_line_prefill('a2000000-0000-4000-8000-0000000000ff')), 0, 'an unknown leg gives no rows');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.po_line_prefill('a2000000-0000-4000-8000-0000000000e1')), 0, 'a deactivated user gets no rows');

select * from finish();
rollback;
