begin;
select plan(23);

-- 0084: issue_quotation writes the prices and makes the revision in ONE transaction (bug hunt HW-43, HW-3, HW-8).
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02.

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'issue_quotation'), 1,
  'one issue_quotation (the 8-argument one is replaced, not overloaded)');
select ok(has_function_privilege('authenticated', 'public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb)', 'execute'),
  'authenticated may issue, anon may not');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000841', 'HW43 Customer');
insert into public.rfqs (id, company_id) values
  ('d0000000-0000-4000-8000-000000000841', 'c0000000-0000-4000-8000-000000000841'),
  ('d0000000-0000-4000-8000-000000000842', 'c0000000-0000-4000-8000-000000000841');
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net, gst_rate) values
  ('d1000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841', 0, 'Item one', 2.5, 1000, 18),
  ('d1000000-0000-4000-8000-000000000842', 'd0000000-0000-4000-8000-000000000841', 1, 'Item two', 4, null, 18),
  ('d1000000-0000-4000-8000-000000000843', 'd0000000-0000-4000-8000-000000000842', 0, 'Other RFQ item', 1, 10, 18);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ HW-43: a refused issue changes no price
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":999999999999,"gst_rate":18,"lead_time":"2 weeks","qty":2.5}]')$$,
  '22003', null, 'a total that overflows quotations.net_total is refused');
select is((select quoted_unit_price_net from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), 1000.00,
  'and the item keeps its price (the price write is rolled back with the refused issue)');
select is((select quoted_lead_time from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), null::text,
  'and its lead time');
select is((select count(*)::int from public.quotations where rfq_id = 'd0000000-0000-4000-8000-000000000841'), 0, 'and no quotation was made');

-- ------------------------------------------------------------------ HW-3: the quantity the person saw must still be stored
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":1300,"gst_rate":18,"lead_time":null,"qty":2}]')$$,
  '22023', 'the quantity of Item one changed to 2.5 since this quotation was opened', 'a quantity changed meanwhile is refused, by name');
select is((select quoted_unit_price_net from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), 1000.00,
  'and no price was written');

-- ------------------------------------------------------------------ HW-8: no free line
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":0,"gst_rate":18,"lead_time":null,"qty":2.5}]')$$,
  '22023', 'a quoted price above zero is needed for: Item one', 'a unit price of 0 is refused');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":null,"qty":2.5}]')$$,
  '22023', 'a quoted price above zero is needed for: Item one', 'a missing unit price is refused');

-- ------------------------------------------------------------------ lines must be this RFQ's, once each
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000843","unit_price":5,"qty":1}]')$$,
  '22023', 'an item to quote does not belong to this RFQ', 'an item of another RFQ is refused');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":5,"qty":2.5},{"id":"d1000000-0000-4000-8000-000000000841","unit_price":6,"qty":2.5}]')$$,
  '22023', 'an item to quote does not belong to this RFQ', 'the same item twice is refused');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null, '[]')$$,
  '22023', 'the RFQ has no items to quote', 'no lines is refused');

-- ------------------------------------------------------------------ an accepted issue writes the prices and snapshots them
select is(public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":1300,"gst_rate":0,"lead_time":" 3 weeks ","qty":2.5}]'),
  '51000000-0000-4000-8000-000000000841'::uuid, 'a valid issue returns the quotation id');
select is((select quoted_unit_price_net from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), 1300.00, 'the price is written');
select is((select gst_rate from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), 0.00, 'the GST rate is written');
select is((select quoted_lead_time from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), '3 weeks', 'the lead time is written, trimmed');
select is((select net_total from public.quotations where id = '51000000-0000-4000-8000-000000000841'), 3250.00,
  'the quotation snapshots the written price at the stored quantity (2.5 x 1,300)');
select is((select jsonb_array_length(lines) from public.quotations where id = '51000000-0000-4000-8000-000000000841'), 1,
  'only the given lines are quoted (the unpriced Item two is left out)');

-- A replay of the same id changes nothing, not even the prices.
select is(public.issue_quotation('51000000-0000-4000-8000-000000000841', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000841","unit_price":7777,"gst_rate":18,"lead_time":null,"qty":2.5}]'),
  '51000000-0000-4000-8000-000000000841'::uuid, 'a replay returns the same id');
select is((select quoted_unit_price_net from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000841'), 1300.00,
  'and writes no price');

-- Without "qty" the quantity is not checked (older callers).
select lives_ok($$select public.issue_quotation('51000000-0000-4000-8000-000000000842', 'd0000000-0000-4000-8000-000000000841',
    null, null, null, null, null, null,
    '[{"id":"d1000000-0000-4000-8000-000000000842","unit_price":50,"gst_rate":18,"lead_time":null}]')$$,
  'a line without qty is issued');
select is((select revision from public.quotations where id = '51000000-0000-4000-8000-000000000842'), 1::smallint, 'as the next revision');

select * from finish();
rollback;
