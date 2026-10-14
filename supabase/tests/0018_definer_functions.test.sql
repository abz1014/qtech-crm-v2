begin;
select plan(49);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with a user's claims (the functions are definers, so the answer does not
-- depend on the connection role); grants and refusals switch to `authenticated` / `anon`.

-- ------------------------------------------------------------------ structure
select ok((select prosecdef from pg_proc where oid = 'public.order_receivables(uuid)'::regprocedure),
  'order_receivables is SECURITY DEFINER');
select ok((select array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.order_receivables(uuid)'::regprocedure),
  'order_receivables has a fixed search_path');
select ok((select prosecdef from pg_proc where oid = 'public.my_target_progress()'::regprocedure),
  'my_target_progress is SECURITY DEFINER');
select ok((select array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.my_target_progress()'::regprocedure),
  'my_target_progress has a fixed search_path');
select ok((select prosecdef and array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.my_target_progress_at(timestamptz)'::regprocedure),
  'the test seam is a definer with a fixed search_path');
select ok(not has_function_privilege('anon', 'public.order_receivables(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.my_target_progress()', 'execute'),
  'anon cannot execute either function');
select ok(has_function_privilege('authenticated', 'public.order_receivables(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.my_target_progress()', 'execute'),
  'authenticated can execute both');
select ok(not has_function_privilege('authenticated', 'public.my_target_progress_at(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.my_target_progress_at(timestamptz)', 'execute'),
  'clients cannot call the test seam');
select ok(not exists (select 1 from pg_proc p cross join lateral unnest(p.proargnames) n
                      where p.oid = 'public.order_receivables(uuid)'::regprocedure and n ~* 'cost|margin|expense'),
  'order_receivables exposes no cost or margin column');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixtures: receivables
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');

-- r1 invoiced twice, part paid, past due, reminded | r2 not invoiced, unpaid | r3 settled within Rs 1, old invoice
-- r4 over-paid | r5 invoiced today, not yet due | r6 value basis unknown
insert into public.orders (id, company_id, owner_id, payment_terms_days, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 30, '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 30, '{}'),
  ('a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, '{}'),
  ('a1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 30, '{}'),
  ('a1000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null,
   array['value_basis_unknown']);
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000001', 'r1', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000002', 'r2', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000003', 'r3', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000004', 'r4', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000005', 'r5', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000006', 'r6', 1, 1000, 18);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, last_reminded_on, reminder_count) values
  ('a1000000-0000-4000-8000-000000000001', 'R-1A', public.today_pkt() - 40, 600, 108, public.today_pkt() - 5, 2),
  ('a1000000-0000-4000-8000-000000000001', 'R-1B', public.today_pkt() - 35, 400, 72, public.today_pkt() - 2, 1),
  ('a1000000-0000-4000-8000-000000000003', 'R-3', public.today_pkt() - 100, 1000, 180, null, 0),
  ('a1000000-0000-4000-8000-000000000005', 'R-5', public.today_pkt(), 1000, 180, null, 0);
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000001', public.today_pkt() - 1, 500),
  ('a1000000-0000-4000-8000-000000000003', public.today_pkt() - 1, 1179),
  ('a1000000-0000-4000-8000-000000000004', public.today_pkt() - 1, 1500);
insert into public.expenses (amount_pkr, category_id, order_id) values
  (700, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001');
insert into public.order_costs (order_id, expected_cost_pkr) values ('a1000000-0000-4000-8000-000000000001', 800);

-- ------------------------------------------------------------------ order_receivables: the figures
select ok((select gross_target = 1180 and settled = 500 and balance = 680 and overpaid_by = 0
                  and due_on = public.today_pkt() - 10 and is_overdue and payment_state = 'overdue'
           from public.order_receivables('a1000000-0000-4000-8000-000000000001')),
  'invoiced order: gross from the invoices, balance, due date = first invoice + terms, overdue');
select ok((select last_reminded_on = public.today_pkt() - 2 and reminder_count = 2
           from public.order_receivables('a1000000-0000-4000-8000-000000000001')),
  'reminders: latest date across the invoices and the highest count');
select ok((select gross_target = 1180 and settled = 0 and balance = 1180 and due_on is null and not is_overdue
                  and payment_state = 'unpaid' and last_reminded_on is null and reminder_count = 0
           from public.order_receivables('a1000000-0000-4000-8000-000000000002')),
  'not invoiced: gross from the items, no due date, never overdue, never reminded');
select ok((select payment_state = 'settled' and not is_overdue and balance = 1
           from public.order_receivables('a1000000-0000-4000-8000-000000000003')),
  'paid within Rs 1 is settled and cannot be overdue (the Re 1 stays in the balance, as in v_order_money)');
select ok((select payment_state = 'settled' and balance = 0 and overpaid_by = 320
           from public.order_receivables('a1000000-0000-4000-8000-000000000004')),
  'over-paid: balance 0, the excess reported');
select ok((select payment_state = 'unpaid' and not is_overdue and due_on = public.today_pkt() + 30
           from public.order_receivables('a1000000-0000-4000-8000-000000000005')),
  'a fresh invoice is unpaid and due in the terms');
select is((select data_trust from public.order_receivables('a1000000-0000-4000-8000-000000000006')),
  'basis_unknown', 'a value_basis_unknown order says so');
select is((select count(*)::int from public.order_receivables()), 6, 'with no argument, one row per order');
select is((select count(*)::int from public.order_receivables(gen_random_uuid())), 0, 'an unknown order gives no rows');

-- ------------------------------------------------------------------ order_receivables: roles
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.payments_in), 0, 'sales cannot read payments_in directly');
select is((select count(*)::int from public.order_receivables()), 6, 'sales can read the per-order balance');
select ok((select balance = 680 and settled = 500 from public.order_receivables('a1000000-0000-4000-8000-000000000001')),
  'and sees the same figures as admin');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from public.order_receivables()$$, '42501', null, 'engineer is refused order_receivables');
select throws_ok($$select * from public.order_receivables('a1000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'engineer is refused for a single order too');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.order_receivables()), 0, 'a deactivated user gets nothing');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.order_receivables()), 6, 'admin can read the receivables');

reset role;
set local role anon;
select throws_ok($$select * from public.order_receivables()$$, '42501', null, 'anon cannot call order_receivables');
reset role;

-- ------------------------------------------------------------------ fixtures: target progress (2027, fixed dates)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- t1 sales, no invoice | t2 sales, basis unknown | t3 engineer | t4 sales, no value | t5 sales, invoiced (net 1000, gross 1100)
insert into public.orders (id, company_id, owner_id, legacy_flags) values
  ('a1000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}'),
  ('a1000000-0000-4000-8000-0000000000b2', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', array['value_basis_unknown']),
  ('a1000000-0000-4000-8000-0000000000b3', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', '{}'),
  ('a1000000-0000-4000-8000-0000000000b4', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}'),
  ('a1000000-0000-4000-8000-0000000000b5', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-0000000000b1', 't1', 1, 1000, 18),
  ('a1000000-0000-4000-8000-0000000000b2', 't2', 1, 1000, 18),
  ('a1000000-0000-4000-8000-0000000000b3', 't3', 1, 1000, 18),
  ('a1000000-0000-4000-8000-0000000000b5', 't5', 1, 1000, 18);
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-0000000000b5', 'T-5', '2027-05-01', 1000, 100);
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-0000000000b1', '2027-03-31', 590),
  ('a1000000-0000-4000-8000-0000000000b1', '2027-04-01', 590),
  ('a1000000-0000-4000-8000-0000000000b2', '2027-04-02', 100),
  ('a1000000-0000-4000-8000-0000000000b3', '2027-04-01', 118),
  ('a1000000-0000-4000-8000-0000000000b4', '2027-04-03', 50),
  ('a1000000-0000-4000-8000-0000000000b5', '2027-05-10', 550);
insert into public.targets (user_id, year, quarter, target_net_pkr) values
  ('a0000000-0000-4000-8000-000000000002', 2027, 1, 9000),
  ('a0000000-0000-4000-8000-000000000002', 2027, 2, 4000),
  ('a0000000-0000-4000-8000-000000000003', 2027, 3, 700);

-- Impersonate sales without switching role, so the test seam can be called with a chosen instant.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ my_target_progress: quarter boundaries
-- 18:59:59 UTC on 31 March is 23:59:59 PKT: still Q1 (UTC would also say Q1; this is the last second of it).
select ok((select year = 2027 and quarter = 1 and quarter_end = date '2027-03-31' and target_net = 9000
                  and achieved_net = 500 and gap = 8500 and on_pace_net = 9000 and behind_pace = 8500
                  and excluded_count = 0
           from public.my_target_progress_at('2027-03-31 18:59:59+00')),
  '23:59:59 PKT on 31 March is the last second of Q1: whole quarter elapsed, only the 31 March payment counts');
-- 19:30 UTC on 31 March is 00:30 PKT on 1 April: Q2 already (UTC would still say Q1).
select ok((select year = 2027 and quarter = 2 and quarter_end = date '2027-06-30' and target_net = 4000
                  and achieved_net = 1000 and gap = 3000 and excluded_count = 2
           from public.my_target_progress_at('2027-03-31 19:30:00+00')),
  '00:30 PKT on 1 April is Q2: the Q2 target, achieved 1000 (items and invoice bases), 2 excluded');
select ok((select on_pace_net = 43.96 and behind_pace = 0
           from public.my_target_progress_at('2027-03-31 19:30:00+00')),
  'today counts as elapsed: day 1 of 91 gives 4000 / 91');
select ok((select on_pace_net = 4000 and behind_pace = 3000 and quarter_end = date '2027-06-30'
           from public.my_target_progress_at('2027-06-30 18:59:59+00')),
  '23:59:59 PKT on 30 June is the last second of Q2: whole quarter elapsed');
select ok((select quarter = 3 and target_net is null and gap is null and on_pace_net is null and behind_pace is null
                  and achieved_net = 0 and quarter_end = date '2027-09-30'
           from public.my_target_progress_at('2027-06-30 19:00:00+00')),
  '00:00 PKT on 1 July is Q3: no target, nothing achieved, no target figures');
select ok((select year = 2027 and quarter = 1 and on_pace_net = 100 and quarter_end = date '2027-03-31'
           from public.my_target_progress_at('2026-12-31 19:00:00+00')),
  '00:00 PKT on 1 January is Q1 of the new year (UTC says 31 December): day 1 of 90');
select ok((select year = 2026 and quarter = 4 and quarter_end = date '2026-12-31' and target_net is null
           from public.my_target_progress_at('2026-12-31 18:59:59+00')),
  '23:59:59 PKT on 31 December is still Q4 of the old year');
select ok((select quarter_end = date '2028-03-31' and on_pace_net is null
           from public.my_target_progress_at('2028-02-29 10:00:00+00')),
  'a leap-year Q1 ends on 31 March');

-- ------------------------------------------------------------------ my_target_progress: only the caller's row
select is((select count(*)::int from public.my_target_progress_at('2027-04-15 10:00:00+00')), 1, 'exactly one row');
select ok((select achieved_net = 1000 from public.my_target_progress_at('2027-04-15 10:00:00+00')),
  'sales is credited with their own payments only (the engineer''s order is not counted)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select ok((select achieved_net = 100 and target_net is null and excluded_count = 0
           from public.my_target_progress_at('2027-04-15 10:00:00+00')),
  'the engineer sees their own 100 and no one else''s');
select ok((select target_net = 700 and achieved_net = 0
           from public.my_target_progress_at('2027-08-15 10:00:00+00')),
  'an engineer''s own target is returned');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok((select target_net is null and achieved_net = 0 and count(*) over () = 1
           from public.my_target_progress_at('2027-04-15 10:00:00+00')),
  'admin gets their own row too: no target, no credited payments');

-- ------------------------------------------------------------------ my_target_progress: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress_at('2027-04-15 10:00:00+00')), 0,
  'a deactivated user gets nothing');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress_at('2027-04-15 10:00:00+00')), 0,
  'no identity gets nothing');

-- ------------------------------------------------------------------ my_target_progress: through the public entry point
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress()), 1, 'sales gets one row from my_target_progress()');
select ok((select year = extract(year from public.today_pkt())::int and quarter = extract(quarter from public.today_pkt())::int
           from public.my_target_progress()),
  'the current quarter is the Karachi quarter');
select throws_ok($$select * from public.my_target_progress_at(now())$$, '42501', null,
  'authenticated cannot call the test seam');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress()), 1, 'an engineer gets one row');
select is((select count(*)::int from public.payments_in), 0, 'and still cannot read payments_in');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress()), 0, 'a deactivated user gets nothing from my_target_progress()');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.my_target_progress()), 1, 'admin gets one row');
reset role;
set local role anon;
select throws_ok($$select * from public.my_target_progress()$$, '42501', null, 'anon cannot call my_target_progress');
reset role;

select * from finish();
rollback;
