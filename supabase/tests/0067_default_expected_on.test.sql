begin;
select * from no_plan();

-- 0067: a leg that becomes placed gets an expected date in the database: the quoted lead time, else the supplier's median days to
-- deliver, else 30 days. Fixtures are written as the table owner; the person is the fixture admin (supabase/seed.sql).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ---------------------------------------------------------------- the lead time reading
select is(public.lead_time_upper_days('2 wks'), 14, '(a) 2 wks is 14 days');
select is(public.lead_time_upper_days('4-6 weeks'), 42, '(a) a range takes its upper end');
select is(public.lead_time_upper_days('10 to 14 days'), 14, '(a) 10 to 14 days is 14');
select is(public.lead_time_upper_days('1 month'), 30, '(a) a month is 30 days');
select is(public.lead_time_upper_days('ex-stock'), 0, '(a) ex-stock is 0 days');
select is(public.lead_time_upper_days('ex-works, TBC'), null, '(a) text with no number and no stock word gives nothing');
select is(public.lead_time_upper_days('  '), null, '(a) blank gives nothing');

-- ---------------------------------------------------------------- fixtures
insert into public.companies (id, name) values
  ('67000000-0000-4000-8000-000000000001', '0067 Customer'),
  ('67000000-0000-4000-8000-000000000002', '0067 Supplier quoted'),
  ('67000000-0000-4000-8000-000000000003', '0067 Supplier with history'),
  ('67000000-0000-4000-8000-000000000004', '0067 Supplier unknown');
insert into public.rfqs (id, company_id) values ('67000000-0000-4000-8000-000000000010', '67000000-0000-4000-8000-000000000001');
insert into public.rfq_items (id, rfq_id, description) values ('67000000-0000-4000-8000-000000000011', '67000000-0000-4000-8000-000000000010', 'Item');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('67000000-0000-4000-8000-000000000012', '67000000-0000-4000-8000-000000000010', '67000000-0000-4000-8000-000000000002', '2026-01-01');
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency, lead_time) values
  ('67000000-0000-4000-8000-000000000012', '67000000-0000-4000-8000-000000000011', 10, 'USD', '3 weeks');
insert into public.orders (id, company_id) values
  ('67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, legacy_source) values
  ('67000000-0000-4000-8000-000000000021', '67000000-0000-4000-8000-000000000001', '{"from":"old crm"}');
-- two finished legs of the supplier with history: 10 and 20 days, so the median is 15
insert into public.supplier_orders (order_id, supplier_id, currency, placed_on, expected_on, delivered_on, received_on) values
  ('67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000003', 'USD', '2026-01-01', '2026-01-20', '2026-01-11', '2026-01-11'),
  ('67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000003', 'USD', '2026-02-01', '2026-02-20', '2026-02-21', '2026-02-21');
-- legs that are not placed yet
insert into public.supplier_orders (id, order_id, supplier_id, inquiry_id, currency) values
  ('67000000-0000-4000-8000-000000000030', '67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000012', 'USD'),
  ('67000000-0000-4000-8000-000000000031', '67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000003', null, 'USD'),
  ('67000000-0000-4000-8000-000000000032', '67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000004', null, 'USD'),
  ('67000000-0000-4000-8000-000000000033', '67000000-0000-4000-8000-000000000021', '67000000-0000-4000-8000-000000000004', null, 'USD');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, supplier_order_id, rfq_item_id) values
  ('67000000-0000-4000-8000-000000000020', 'Quoted line', 1, 100, 18, '67000000-0000-4000-8000-000000000030', '67000000-0000-4000-8000-000000000011');

select is(public.supplier_median_delivery_days('67000000-0000-4000-8000-000000000003'), 15, '(b) the median of 10 and 20 days is 15');
select is(public.supplier_median_delivery_days('67000000-0000-4000-8000-000000000004'), null, '(b) a supplier with no finished legs has no median');

-- ---------------------------------------------------------------- the trigger
update public.supplier_orders set placed_on = '2026-03-01' where id = '67000000-0000-4000-8000-000000000030';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000030'), '2026-03-22'::date,
  '(c) placed with a quoted lead time of 3 weeks: expected is 21 days later');

update public.supplier_orders set placed_on = '2026-03-01' where id = '67000000-0000-4000-8000-000000000031';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000031'), '2026-03-16'::date,
  '(d) no lead time, a supplier history: expected is the median 15 days later');

update public.supplier_orders set placed_on = '2026-03-01' where id = '67000000-0000-4000-8000-000000000032';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000032'), '2026-03-31'::date,
  '(e) nothing to go on: 30 days');

update public.supplier_orders set placed_on = '2026-03-01' where id = '67000000-0000-4000-8000-000000000033';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000033'), null,
  '(f) a leg of an imported order is left alone');

-- a date typed by a person is kept; clearing it afterwards stays cleared; an insert that is already placed gets the default
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on) values
  ('67000000-0000-4000-8000-000000000034', '67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000004', 'USD', '2026-03-01', '2026-03-05');
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000034'), '2026-03-05'::date, '(g) an expected date that is already there is kept');
update public.supplier_orders set expected_on = null where id = '67000000-0000-4000-8000-000000000034';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000034'), null, '(g) clearing it on a placed leg is respected');
update public.supplier_orders set placed_on = '2026-03-02' where id = '67000000-0000-4000-8000-000000000034';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000034'), null, '(g) changing the placed date of a placed leg does not refill it');
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on) values
  ('67000000-0000-4000-8000-000000000035', '67000000-0000-4000-8000-000000000020', '67000000-0000-4000-8000-000000000004', 'USD', '2026-03-01');
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000035'), '2026-03-31'::date, '(h) a leg inserted already placed gets the default too');

-- unplacing and delivered legs are not touched
update public.supplier_orders set placed_on = null, expected_on = null where id = '67000000-0000-4000-8000-000000000035';
select is((select expected_on from public.supplier_orders where id = '67000000-0000-4000-8000-000000000035'), null, '(i) unplacing leaves no date');

select ok(not has_function_privilege('anon', 'public.lead_time_upper_days(text)', 'execute'), 'anon cannot execute the lead time reader');

select * from finish();
rollback;
