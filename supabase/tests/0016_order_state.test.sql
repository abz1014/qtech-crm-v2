begin;
select plan(43);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.

-- ------------------------------------------------------------------ structure
select ok((select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
           where oid = 'public.v_order_state'::regclass), 'v_order_state is security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid = 'public.v_order_state'::regclass and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on v_order_state');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');

insert into public.orders (id, company_id, owner_id, needs_commissioning, commissioning_planned_on,
                           commissioning_done_on, cancelled_on, legacy_flags) values
  -- goods dimension
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  -- commissioning dimension
  ('a1000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', true, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', true, public.today_pkt() + 3, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', true, public.today_pkt() - 3, public.today_pkt() - 1, null, '{}'),
  -- invoicing dimension
  ('a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  -- lifecycle
  ('a1000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, public.today_pkt() - 1, '{}'),
  ('a1000000-0000-4000-8000-000000000041', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000042', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000043', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000044', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  -- data trust and totals
  ('a1000000-0000-4000-8000-000000000051', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, array['value_basis_unknown']),
  ('a1000000-0000-4000-8000-000000000052', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, array['dates_estimated']),
  ('a1000000-0000-4000-8000-000000000053', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}'),
  ('a1000000-0000-4000-8000-000000000061', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, null, null, '{}');

-- legs
insert into public.supplier_orders (id, order_id, supplier_id, placed_on, expected_on, received_on, delivered_on, legacy_flags) values
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', null, null, null, null, '{}'),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 2, public.today_pkt() + 10, null, null, '{}'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 20, public.today_pkt() - 1, null, null, '{}'),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 20, public.today_pkt() - 5, public.today_pkt() - 1, null, '{}'),
  ('a2000000-0000-4000-8000-000000000071', 'a1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 20, public.today_pkt() - 5, public.today_pkt() - 3, public.today_pkt() - 2, '{}'),
  ('a2000000-0000-4000-8000-000000000072', 'a1000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 2, public.today_pkt() + 10, null, null, '{}'),
  ('a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 20, public.today_pkt() - 5, public.today_pkt() - 3, public.today_pkt() - 2, '{}'),
  ('a2000000-0000-4000-8000-000000000053', 'a1000000-0000-4000-8000-000000000053', 'c0000000-0000-4000-8000-000000000002', public.today_pkt() - 20, public.today_pkt() - 5, public.today_pkt() - 3, public.today_pkt() - 2, array['dates_estimated']);

-- goods lines (is_service = false) and service lines
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, is_service, supplier_order_id) values
  ('a1000000-0000-4000-8000-000000000001', 'service only', 1, 100, 18, true, null),
  ('a1000000-0000-4000-8000-000000000002', 'unsourced goods', 1, 100, 18, false, null),
  ('a1000000-0000-4000-8000-000000000003', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000004', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000004'),
  ('a1000000-0000-4000-8000-000000000005', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000006', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000006'),
  ('a1000000-0000-4000-8000-000000000007', 'goods A', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000071'),
  ('a1000000-0000-4000-8000-000000000007', 'goods B', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000072'),
  ('a1000000-0000-4000-8000-000000000008', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000008'),
  ('a1000000-0000-4000-8000-000000000053', 'goods', 1, 100, 18, false, 'a2000000-0000-4000-8000-000000000053');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, is_service)
select o, 'service ' || o, 1, 1000, 18, true
from unnest(array[
  'a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000013',
  'a1000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000023',
  'a1000000-0000-4000-8000-000000000024', 'a1000000-0000-4000-8000-000000000031', 'a1000000-0000-4000-8000-000000000041',
  'a1000000-0000-4000-8000-000000000042', 'a1000000-0000-4000-8000-000000000043', 'a1000000-0000-4000-8000-000000000044',
  'a1000000-0000-4000-8000-000000000051', 'a1000000-0000-4000-8000-000000000052']::uuid[]) as o;
-- totals: 3 x 33.33 @18 plus an exempt line
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, is_service) values
  ('a1000000-0000-4000-8000-000000000061', 'taxed', 3, 33.33, 18, true),
  ('a1000000-0000-4000-8000-000000000061', 'exempt', 1, 1000, 0, true);

-- invoices (gross of each order's 1000 + 180 service line = 1180)
insert into public.invoices (order_id, number, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000022', 'S-22', 400, 100),
  ('a1000000-0000-4000-8000-000000000023', 'S-23', 1000, 180),
  ('a1000000-0000-4000-8000-000000000024', 'S-24', 999, 180),
  ('a1000000-0000-4000-8000-000000000041', 'S-41', 1000, 180),
  ('a1000000-0000-4000-8000-000000000042', 'S-42', 1000, 180),
  ('a1000000-0000-4000-8000-000000000044', 'S-44', 1000, 180);
-- payments and costs
insert into public.payments_in (order_id, amount) values
  ('a1000000-0000-4000-8000-000000000041', 1180),
  ('a1000000-0000-4000-8000-000000000044', 1180);
insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at) values
  ('a1000000-0000-4000-8000-000000000041', 100, now()),
  ('a1000000-0000-4000-8000-000000000042', 100, now()),
  ('a1000000-0000-4000-8000-000000000043', 100, now());

-- ------------------------------------------------------------------ goods
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'n_a', 'goods: n_a when every line is a service');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000002'),
  'to_source', 'goods: to_source when a goods line has no leg');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000003'),
  'to_place', 'goods: to_place until the PO is placed');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000004'),
  'on_order', 'goods: on_order');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000005'),
  'late', 'goods: late when expected_on has passed and nothing was received');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000006'),
  'received', 'goods: received (late expected_on no longer matters)');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000007'),
  'partly_delivered', 'goods: partly_delivered across legs');
select is((select goods_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000008'),
  'delivered', 'goods: delivered');

-- ------------------------------------------------------------------ commissioning
select is((select commissioning_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'n_a', 'commissioning: n_a');
select is((select commissioning_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000011'),
  'to_plan', 'commissioning: to_plan');
select is((select commissioning_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000012'),
  'planned', 'commissioning: planned');
select is((select commissioning_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000013'),
  'done', 'commissioning: done');

-- ------------------------------------------------------------------ invoicing
select is((select invoicing_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000021'),
  'not_invoiced', 'invoicing: not_invoiced');
select ok((select invoicing_state = 'part' and invoiced = 500 from public.v_order_state
           where order_id = 'a1000000-0000-4000-8000-000000000022'),
  'invoicing: part, with the invoiced gross');
select is((select invoicing_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000023'),
  'fully_invoiced', 'invoicing: fully_invoiced');
select is((select invoicing_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000024'),
  'fully_invoiced', 'invoicing: Rs 1 short still counts as fully invoiced');

-- ------------------------------------------------------------------ lifecycle (admin)
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000031'),
  'cancelled', 'lifecycle: cancelled');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000041'),
  'done', 'lifecycle: done once every dimension is terminal (admin: invoiced, paid, costs complete)');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000042'),
  'active', 'admin: not done while the payment is open');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000043'),
  'active', 'admin: not done while not invoiced');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000044'),
  'active', 'admin: not done while costs are provisional');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000008'),
  'active', 'admin: delivered goods alone are not done');

-- ------------------------------------------------------------------ data trust
select is((select data_trust from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'ok', 'data trust: ok');
select is((select data_trust from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000051'),
  'basis_unknown', 'data trust: basis_unknown');
select is((select data_trust from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000052'),
  'estimated_dates', 'data trust: estimated dates flagged on the order');
select is((select data_trust from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000053'),
  'estimated_dates', 'data trust: estimated dates flagged on a leg');

-- ------------------------------------------------------------------ totals
select ok((select net = 1099.99 and gst = 18 and gross = 1117.99 from public.v_order_state
           where order_id = 'a1000000-0000-4000-8000-000000000061'),
  'net, GST (whole rupees per line) and gross come from the items');

-- ------------------------------------------------------------------ roles
set local role authenticated;

-- sales: "done" from goods, commissioning and invoicing; no payment or cost dimension
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000042'),
  'done', 'sales: done without payment being settled (payment is not a dimension sales sees here)');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000044'),
  'done', 'sales: done even with costs provisional');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000043'),
  'active', 'sales: not done while not invoiced');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000008'),
  'active', 'sales: delivered but not invoiced is not done');
select is((select invoicing_state from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000023'),
  'fully_invoiced', 'sales sees the invoicing state');
select ok((select net = 1099.99 and gross = 1117.99 from public.v_order_state
           where order_id = 'a1000000-0000-4000-8000-000000000061'), 'sales sees the same totals');

-- engineer: goods and commissioning only; the invoicing dimension is hidden, not "not invoiced"
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000008'),
  'done', 'engineer: delivered goods with no commissioning is done');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000043'),
  'done', 'engineer: done although nothing is invoiced (a hidden dimension never blocks)');
select is((select lifecycle from public.v_order_state where order_id = 'a1000000-0000-4000-8000-000000000011'),
  'active', 'engineer: commissioning still to plan is not done');
select ok((select invoicing_state is null and invoiced is null from public.v_order_state
           where order_id = 'a1000000-0000-4000-8000-000000000023'),
  'engineer: invoicing state and invoiced amount are NULL, not wrong');
select ok((select net = 1099.99 and gross = 1117.99 from public.v_order_state
           where order_id = 'a1000000-0000-4000-8000-000000000061'),
  'engineer sees item-based net, GST and gross');
select is((select count(*)::int from public.v_order_state), 24, 'engineer reads every order');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_order_state), 0, 'deactivated user gets 0 rows');

reset role;
set local role anon;
select throws_ok($$select * from public.v_order_state$$, '42501', null, 'anon cannot read v_order_state');
reset role;

select * from finish();
rollback;
