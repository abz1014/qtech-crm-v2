begin;
select plan(21);

-- P01: the four report views, against a fixture whose answers were worked out by hand (see the comment on each
-- assertion). Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
-- The seed holds users only, so the fixture is the whole data set and the views can be compared row for row.
--
-- Fixture, in words
--   Customers A, B, C. Suppliers S1, S2.
--   r1 (A) has 2 items, floated to S1, S1 priced both            -> covered; has a live order o1            -> won
--   r2 (A) has 2 items, floated to S1, S1 priced one             -> partly covered; closed, reason price
--   r3 (B) has 1 item, never floated; closed, reason price       -> not floated
--   r4 (B) has 1 item, floated to S1, no reply; closed, competitor -> floated, awaiting
--   r5 (B) has 1 item, floated to S2 who has no offer; open      -> no offer anywhere
--   r6 (C) has no items, never floated; open                     -> not floated
--   r7 (C) has 1 item, floated to S1, priced; open; its only order o4 is cancelled -> covered, still open
--   Orders: o1 (A, from r1, 10 Jan), o2 (A, repeat, 5 Mar), o3 (B, 1 Feb), o4 (C, cancelled), o5 (A, cancelled).

create function pg_temp.u(h text) returns uuid language sql immutable as
  $$ select ('f1000000-0000-4000-8000-0000000000' || h)::uuid $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.u('01'), 'P01 A'), (pg_temp.u('02'), 'P01 B'), (pg_temp.u('03'), 'P01 C'),
  (pg_temp.u('04'), 'P01 S1'), (pg_temp.u('05'), 'P01 S2');

insert into public.rfqs (id, company_id, owner_id, closed_on, close_reason) values
  (pg_temp.u('11'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', null, null),
  (pg_temp.u('12'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', '2026-02-01', 'price'),
  (pg_temp.u('13'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', '2026-02-02', 'price'),
  (pg_temp.u('14'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', '2026-02-03', 'competitor'),
  (pg_temp.u('15'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', null, null),
  (pg_temp.u('16'), pg_temp.u('03'), 'a0000000-0000-4000-8000-000000000001', null, null),
  (pg_temp.u('17'), pg_temp.u('03'), 'a0000000-0000-4000-8000-000000000001', null, null);

insert into public.rfq_items (id, rfq_id, position, description) values
  (pg_temp.u('21'), pg_temp.u('11'), 0, 'r1 item a'), (pg_temp.u('22'), pg_temp.u('11'), 1, 'r1 item b'),
  (pg_temp.u('23'), pg_temp.u('12'), 0, 'r2 item a'), (pg_temp.u('24'), pg_temp.u('12'), 1, 'r2 item b'),
  (pg_temp.u('25'), pg_temp.u('13'), 0, 'r3 item a'),
  (pg_temp.u('26'), pg_temp.u('14'), 0, 'r4 item a'),
  (pg_temp.u('27'), pg_temp.u('15'), 0, 'r5 item a'),
  (pg_temp.u('28'), pg_temp.u('17'), 0, 'r7 item a');

insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, no_offer_on) values
  (pg_temp.u('31'), pg_temp.u('11'), pg_temp.u('04'), '2026-01-05', null),
  (pg_temp.u('32'), pg_temp.u('12'), pg_temp.u('04'), '2026-01-06', null),
  (pg_temp.u('33'), pg_temp.u('14'), pg_temp.u('04'), '2026-01-07', null),
  (pg_temp.u('34'), pg_temp.u('15'), pg_temp.u('05'), '2026-01-08', '2026-01-12'),
  (pg_temp.u('35'), pg_temp.u('17'), pg_temp.u('04'), '2026-01-09', null);

insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.u('31'), pg_temp.u('21'), 10, 'PKR'), (pg_temp.u('31'), pg_temp.u('22'), 20, 'PKR'),
  (pg_temp.u('32'), pg_temp.u('23'), 30, 'PKR'),
  (pg_temp.u('35'), pg_temp.u('28'), 40, 'PKR');

insert into public.orders (id, company_id, rfq_id, owner_id, ordered_on, cancelled_on) values
  (pg_temp.u('41'), pg_temp.u('01'), pg_temp.u('11'), 'a0000000-0000-4000-8000-000000000001', '2026-01-10', null),
  (pg_temp.u('42'), pg_temp.u('01'), null,            'a0000000-0000-4000-8000-000000000001', '2026-03-05', null),
  (pg_temp.u('43'), pg_temp.u('02'), null,            'a0000000-0000-4000-8000-000000000001', '2026-02-01', null),
  (pg_temp.u('44'), pg_temp.u('03'), pg_temp.u('17'), 'a0000000-0000-4000-8000-000000000001', '2026-02-10', '2026-02-12'),
  (pg_temp.u('45'), pg_temp.u('01'), null,            'a0000000-0000-4000-8000-000000000001', '2026-04-01', '2026-04-02');

-- Karachi is UTC+5, so +05 below is the Karachi wall clock. Days are counted on Karachi dates.
insert into public.clarifications (id, rfq_id, question, first_asked_at, last_asked_at, answered_at, withdrawn_at) values
  (pg_temp.u('51'), pg_temp.u('11'), 'c1', '2026-03-02 10:00+05', '2026-03-02 10:00+05', '2026-03-04 09:00+05', null),
  (pg_temp.u('52'), pg_temp.u('11'), 'c2', '2026-03-10 22:00+05', '2026-03-10 22:00+05', '2026-03-15 01:00+05', null),
  (pg_temp.u('53'), pg_temp.u('12'), 'c3', '2026-03-20 10:00+05', '2026-03-20 10:00+05', null, '2026-03-21 10:00+05'),
  (pg_temp.u('54'), pg_temp.u('12'), 'c4', '2026-04-01 10:00+05', '2026-04-01 10:00+05', null, null),
  (pg_temp.u('55'), pg_temp.u('12'), 'c5', '2026-04-02 10:00+05', '2026-04-02 10:00+05', '2026-04-03 10:00+05', null),
  (pg_temp.u('56'), pg_temp.u('12'), 'c6 never asked', null, null, null, null);

-- ------------------------------------------------------------------ sales reads the reports
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select columns_are('public', 'v_report_rfq_outcomes', array['outcome', 'close_reason', 'rfqs'], 'outcomes: the columns');
select columns_are('public', 'v_report_float',
  array['sourcing_state', 'rfqs', 'items_total', 'items_quoted', 'won', 'closed', 'still_open'], 'float: the columns');
select columns_are('public', 'v_report_clarification_turnaround',
  array['month', 'asked', 'answered', 'withdrawn', 'still_open', 'avg_days', 'slowest_days', 'total_days'], 'turnaround: the columns');
select columns_are('public', 'v_report_repeat_customers',
  array['company_id', 'name', 'orders', 'first_order_on', 'last_order_on', 'rfqs', 'is_repeat'], 'repeat customers: the columns');

-- Hand count: won 1 (r1); closed price 2 (r2, r3), competitor 1 (r4); open 3 (r5, r6, r7: o4 is cancelled).
select results_eq($$select outcome, close_reason, rfqs from public.v_report_rfq_outcomes order by 1, 2$$,
  $$values ('closed'::text, 'competitor'::text, 1), ('closed', 'price', 2), ('open', null, 3), ('won', null, 1)$$,
  'outcomes by close reason: won 1, closed competitor 1 and price 2, open 3');
select is((select sum(rfqs)::int from public.v_report_rfq_outcomes), 7, 'outcomes: every RFQ is counted once (7)');

-- Hand count: covered = r1 (2 of 2, won) + r7 (1 of 1, open); awaiting = r4; no offer = r5; not floated = r3 + r6; partly = r2 (1 of 2).
select results_eq($$select sourcing_state, rfqs, items_total, items_quoted, won, closed, still_open
                    from public.v_report_float order by sourcing_state$$,
  $$values ('covered'::text, 2, 3, 3, 1, 0, 1),
           ('floated_awaiting', 1, 1, 0, 0, 1, 0),
           ('no_offer_anywhere', 1, 1, 0, 0, 0, 1),
           ('not_floated', 2, 1, 0, 0, 1, 1),
           ('partly_covered', 1, 2, 1, 0, 1, 0)$$,
  'float: covered 2 RFQs (3 of 3 items, 1 won), awaiting 1, no offer 1, not floated 2, partly covered 1 (1 of 2 items)');
select is((select sum(items_quoted)::int || ' of ' || sum(items_total)::int from public.v_report_float
           where sourcing_state <> 'not_floated'), '4 of 7', 'float: 4 of the 7 floated items got a supplier price');

-- Hand count: March asked c1 c2 c3; answered c1 (2 days) and c2 (10 Mar to 15 Mar = 5 days), avg 3.5, slowest 5; c3 withdrawn.
-- April asked c4 c5; c5 answered in 1 day; c4 still open. c6 was never asked.
select results_eq($$select month, asked, answered, withdrawn, still_open, avg_days, slowest_days, total_days
                    from public.v_report_clarification_turnaround order by month$$,
  $$values ('2026-03-01'::date, 3, 2, 1, 0, 3.5::numeric, 5, 7),
           ('2026-04-01'::date, 2, 1, 0, 1, 1.0::numeric, 1, 1)$$,
  'turnaround: March asked 3, answered 2 (average 3.5, slowest 5), withdrawn 1; April asked 2, answered 1 (1 day), open 1');
select is((select sum(asked)::int from public.v_report_clarification_turnaround), 5, 'turnaround: the never-asked question is not counted');

-- Hand count: A has o1 and o2 (o5 is cancelled) and RFQs r1, r2; B has o3 and RFQs r3, r4, r5; C has only a cancelled order.
select results_eq($$select name, orders, first_order_on, last_order_on, rfqs, is_repeat
                    from public.v_report_repeat_customers order by name$$,
  $$values ('P01 A'::text, 2, '2026-01-10'::date, '2026-03-05'::date, 2, true),
           ('P01 B', 1, '2026-02-01', '2026-02-01', 3, false)$$,
  'repeat customers: A has 2 live orders and 2 RFQs, B has 1 order and 3 RFQs, C has none and is absent');
select is((select count(*)::int from public.v_report_repeat_customers where is_repeat), 1, 'repeat customers: one repeat customer');

-- ------------------------------------------------------------------ admin sees the same
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select sum(rfqs)::int from public.v_report_rfq_outcomes), 7, 'admin reads the outcomes too');
select is((select count(*)::int from public.v_report_repeat_customers), 2, 'admin reads the repeat customers too');

-- ------------------------------------------------------------------ an engineer sees nothing (no report is theirs)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.v_report_rfq_outcomes), 0, 'engineer: outcomes are empty');
select is((select count(*)::int from public.v_report_float), 0, 'engineer: float is empty');
select is((select count(*)::int from public.v_report_clarification_turnaround), 0, 'engineer: turnaround is empty');
select is((select count(*)::int from public.v_report_repeat_customers), 0, 'engineer: repeat customers is empty');

-- ------------------------------------------------------------------ deactivated and anon get nothing
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.v_report_rfq_outcomes), 0, 'deactivated user: nothing');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok($$select 1 from public.v_report_float$$, '42501', null, 'anon: permission denied');

-- ------------------------------------------------------------------ no money on any report
reset role;
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name like 'v\_report\_%'
             and column_name ~ '(price|amount|net|gross|gst|margin|cost|pkr|total)' and column_name not in ('items_total', 'total_days')), 0,
  'no report view has a money-looking column');

select * from finish();
rollback;
