begin;
select plan(13);

-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ the setting
select is((select default_payment_terms_days from public.company_profile where id = 1), 30::smallint,
  'the default is 30 days out of the box');
select throws_ok($$update public.company_profile set default_payment_terms_days = -1 where id = 1$$, '23514', null,
  'a negative default is refused');
select throws_ok($$update public.company_profile set default_payment_terms_days = 366 where id = 1$$, '23514', null,
  'more than a year is refused');

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
-- t1 no terms | t2 terms 10 | t3 terms 0 (due the day it is invoiced) | t4 no terms, not invoiced
insert into public.orders (id, company_id, owner_id, payment_terms_days) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 10),
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 0),
  ('a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null);
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000001', 't1', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000002', 't2', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000003', 't3', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000004', 't4', 1, 1000, 18);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000001', 'T-1', public.today_pkt() - 40, 1000, 180),
  ('a1000000-0000-4000-8000-000000000002', 'T-2', public.today_pkt() - 40, 1000, 180),
  ('a1000000-0000-4000-8000-000000000003', 'T-3', public.today_pkt() - 1, 1000, 180);

-- ------------------------------------------------------------------ order_receivables uses the default
select ok((select due_on = public.today_pkt() - 10 and is_overdue and payment_state = 'overdue'
           from public.order_receivables('a1000000-0000-4000-8000-000000000001')),
  'no terms on the order: due = invoice date + the 30-day default, so a 40-day-old invoice is overdue');
select ok((select due_on = public.today_pkt() - 30 and is_overdue
           from public.order_receivables('a1000000-0000-4000-8000-000000000002')),
  'terms on the order win over the default');
select ok((select due_on = public.today_pkt() - 1 and is_overdue
           from public.order_receivables('a1000000-0000-4000-8000-000000000003')),
  'terms of 0 are real terms, not "none": the default is not used');
select ok((select due_on is null and not is_overdue from public.order_receivables('a1000000-0000-4000-8000-000000000004')),
  'no invoice: still no due date, whatever the default');

-- ------------------------------------------------------------------ changing the default moves orders with no terms
update public.company_profile set default_payment_terms_days = 60 where id = 1;
select ok((select due_on = public.today_pkt() + 20 and not is_overdue
           from public.order_receivables('a1000000-0000-4000-8000-000000000001')),
  'a 60-day default: the 40-day-old invoice is no longer overdue');
select ok((select due_on = public.today_pkt() - 30 from public.order_receivables('a1000000-0000-4000-8000-000000000002')),
  'and an order with its own terms does not move');
update public.company_profile set default_payment_terms_days = 30 where id = 1;

-- ------------------------------------------------------------------ v_order_money agrees (admin)
select ok((select due_on = public.today_pkt() - 10 and payment_state = 'overdue'
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'v_order_money uses the default too');
select ok((select due_on = public.today_pkt() - 30 from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000002'),
  'v_order_money: order terms win');

-- ------------------------------------------------------------------ who may change it
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select default_payment_terms_days from public.company_profile where id = 1), 30::smallint, 'sales can read the default');
with u as (update public.company_profile set default_payment_terms_days = 5 where id = 1 returning 1)
select is((select count(*)::int from u), 0,
  'sales cannot change it (row-level security: no row updated)');

select * from finish();
rollback;
