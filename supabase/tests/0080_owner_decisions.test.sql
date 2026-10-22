-- 0080_owner_decisions (owner decisions of 2026-10-22).
--
-- Decision 1: an advance on a CANCELLED order is never owed and never overdue (Who owes us, its summary, Today's reminders all
-- read order_receivables / receivables_list); it is listed apart, for the admin only, as "Advance held — refund or keep"
-- (held_advances), and the aging marks its advance row bucket 'cancelled'. The same expected values are worked out by the
-- money oracle in src/test/money-oracle/pgtapFixtures.test.ts (heldAdvances).
--   H1 cancelled 20 Mar 2025, never invoiced: paid 700.00 on 10 Mar 2025, plus 100.00 on 12 Mar 2025 VOIDED   -> held 700.00
--   H2 cancelled 20 Mar 2025 after an invoice of 1,180.00 (2 Jan 2025), paid 500.00: D-MR3 keeps its balance of 680.00
--   H3 open, never invoiced: paid 300.00 on 10 Mar 2025                                                       -> an ordinary advance
--   H4 cancelled 20 Mar 2025, never invoiced, nothing paid                                                     -> nothing to list
-- Decision 2: only the latest closed month can be reopened (January to March 2018 are closed for the test; newest first).
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000980', 'Held advance customer');

insert into public.orders (id, company_id, owner_id, payment_terms_days, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000981', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002', 30, '2025-03-20'),  -- H1
  ('a1000000-0000-4000-8000-000000000982', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002', 30, '2025-03-20'),  -- H2
  ('a1000000-0000-4000-8000-000000000983', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002', 30, null),          -- H3
  ('a1000000-0000-4000-8000-000000000984', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002', 30, '2025-03-20'),  -- H4
  ('a1000000-0000-4000-8000-000000000985', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002', 30, null);          -- money for the 2018 months

insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000981', 'cancelled line', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000982', 'invoiced then cancelled', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000983', 'open line', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000984', 'cancelled unpaid', 1, 1000, 18);

insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000982', 'HELD-H2-1', '2025-01-02', 1000, 180);

insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000981', '2025-03-10', 700),
  ('a1000000-0000-4000-8000-000000000982', '2025-01-20', 500),
  ('a1000000-0000-4000-8000-000000000983', '2025-03-10', 300),
  ('a1000000-0000-4000-8000-000000000985', '2018-01-15', 10),
  ('a1000000-0000-4000-8000-000000000985', '2018-02-15', 10),
  ('a1000000-0000-4000-8000-000000000985', '2018-03-15', 10);
insert into public.payments_in (order_id, received_on, amount, voided_at, voided_by, void_reason) values
  ('a1000000-0000-4000-8000-000000000981', '2025-03-12', 100, now(), 'a0000000-0000-4000-8000-000000000001', 'entered twice');

-- po_line_prefill: a quote's day is its Karachi day. K1 was saved at 23:30 in Karachi on 21 Oct 2026 (18:30 UTC, the same
-- date); K2 at 00:30 in Karachi on 22 Oct 2026, which is 19:30 UTC on 21 Oct: the UTC date was one day early.
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000986', 'Karachi day supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000986', 'c0000000-0000-4000-8000-000000000980', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty) values
  ('e0000000-0000-4000-8000-000000000986', 'd0000000-0000-4000-8000-000000000986', 0, 'Karachi day item one', 1),
  ('e0000000-0000-4000-8000-000000000987', 'd0000000-0000-4000-8000-000000000986', 1, 'Karachi day item two', 1);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-000000000986', 'd0000000-0000-4000-8000-000000000986', 'c0000000-0000-4000-8000-000000000986', '2026-10-20');
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, created_at) values
  ('f1000000-0000-4000-8000-000000000986', 'f0000000-0000-4000-8000-000000000986', 'e0000000-0000-4000-8000-000000000986', 10, 'PKR', '2026-10-21 23:30:00+05'),
  ('f1000000-0000-4000-8000-000000000987', 'f0000000-0000-4000-8000-000000000986', 'e0000000-0000-4000-8000-000000000987', 20, 'PKR', '2026-10-22 00:30:00+05');
insert into public.orders (id, company_id) values ('a1000000-0000-4000-8000-000000000986', 'c0000000-0000-4000-8000-000000000980');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000000986', 'a1000000-0000-4000-8000-000000000986', 'c0000000-0000-4000-8000-000000000986', 'PKR');
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, supplier_order_id, rfq_item_id, is_service) values
  ('a3000000-0000-4000-8000-000000000986', 'a1000000-0000-4000-8000-000000000986', 0, 'Karachi day item one', 1, 'ea', 100, 'a2000000-0000-4000-8000-000000000986', 'e0000000-0000-4000-8000-000000000986', false),
  ('a3000000-0000-4000-8000-000000000987', 'a1000000-0000-4000-8000-000000000986', 1, 'Karachi day item two', 1, 'ea', 100, 'a2000000-0000-4000-8000-000000000986', 'e0000000-0000-4000-8000-000000000987', false);

set local role authenticated;

-- ================================================================== structure
select ok((select not p.prosecdef and p.proconfig @> array['search_path=""']
           from pg_proc p where p.oid = 'public.held_advances()'::regprocedure),
  'held_advances is SECURITY INVOKER with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.held_advances()', 'execute')
      and not has_function_privilege('anon', 'public.held_advances()', 'execute'),
  'held_advances: signed-in clients may call it, anon may not');

-- ================================================================== decision 1: held, never owed
select is((select count(*)::int from public.held_advances() where company_id = 'c0000000-0000-4000-8000-000000000980'), 1,
  'held_advances lists exactly one order for the fixture: the cancelled, never-invoiced order that still holds money');
select ok((select order_id = 'a1000000-0000-4000-8000-000000000981' and held = 700.00 and cancelled_on = '2025-03-20'
                  and company_name = 'Held advance customer' and order_number is not null
           from public.held_advances() where company_id = 'c0000000-0000-4000-8000-000000000980'),
  'H1: held 700.00 (the voided 100.00 is left out), with the cancel date and the customer');
select is((select count(*)::int from public.held_advances() where order_id in ('a1000000-0000-4000-8000-000000000982',
                                                                               'a1000000-0000-4000-8000-000000000983',
                                                                               'a1000000-0000-4000-8000-000000000984')), 0,
  'not listed: an invoiced cancelled order (H2), an open order (H3), a cancelled order with nothing paid (H4)');

select is((select count(*)::int from public.order_receivables('a1000000-0000-4000-8000-000000000981')), 0,
  'H1 is not owed: order_receivables leaves it out (Who owes us, the company page, Today)');
select is((select count(*)::int from public.receivables_list(null, 'c0000000-0000-4000-8000-000000000980', null, false)
           where order_id = 'a1000000-0000-4000-8000-000000000981'), 0,
  'H1 is not on the Who owes us list');
select is((select count(*)::int from public.receivables_list('overdue', null, null, true)
           where order_id = 'a1000000-0000-4000-8000-000000000981'), 0,
  'H1 is never overdue, so Today never reminds anyone about it');
select ok((select balance = 680.00 and payment_state = 'overdue'
           from public.order_receivables('a1000000-0000-4000-8000-000000000982')),
  'H2 keeps D-MR3: a cancelled order with an invoice owes its real balance (1,180.00 - 500.00)');

select ok((select kind = 'advance' and bucket = 'cancelled' and advance_held = 700.00 and remaining is null
           from public.aging_as_of('2025-03-31') where order_id = 'a1000000-0000-4000-8000-000000000981'),
  'aging after the cancel: H1 is an advance row marked cancelled (refund or keep), never negative aging');
select ok((select kind = 'advance' and bucket is null and advance_held = 700.00
           from public.aging_as_of('2025-03-15') where order_id = 'a1000000-0000-4000-8000-000000000981'),
  'aging before the cancel date: H1 is an ordinary advance');
select ok((select kind = 'advance' and bucket is null and advance_held = 300.00
           from public.aging_as_of('2025-03-31') where order_id = 'a1000000-0000-4000-8000-000000000983'),
  'an open order''s advance stays "not invoiced yet" (bucket null)');

-- admin only
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.held_advances()), 0, 'sales gets no held advances (admin only)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.held_advances()), 0, 'an engineer gets no held advances');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.held_advances()), 0, 'a deactivated user gets no held advances');

-- ================================================================== po_line_prefill dates a quote by its Karachi day
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local timezone = 'UTC';
select is((select price_source || ' ' || source_on::text from public.po_line_prefill('a2000000-0000-4000-8000-000000000986')
           where order_item_id = 'a3000000-0000-4000-8000-000000000986'), 'quote 2026-10-21',
  'a quote saved at 23:30 Karachi time is dated that Karachi day (session in UTC)');
select is((select price_source || ' ' || source_on::text from public.po_line_prefill('a2000000-0000-4000-8000-000000000986')
           where order_item_id = 'a3000000-0000-4000-8000-000000000987'), 'quote 2026-10-22',
  'a quote saved at 00:30 Karachi time (19:30 UTC the day before) is dated the Karachi day, not the UTC one');
reset timezone;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== decision 2: reopen newest first
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create function pg_temp.hint_of(stmt text) returns text language plpgsql as $f$
declare
  h text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end
$f$;

select lives_ok($$select public.close_month('2018-01-01')$$, 'January 2018 closes');
select lives_ok($$select public.close_month('2018-02-01')$$, 'February 2018 closes');
select lives_ok($$select public.close_month('2018-03-01')$$, 'March 2018 closes');

select throws_ok($$select public.reopen_month('2018-01-01')$$, 'P0001',
  'January 2018 cannot be reopened while March 2018 is closed. Reopen March 2018 first.',
  'an earlier month cannot be reopened while a later one is closed');
select throws_ok($$select public.reopen_month('2018-02-15', 'a note')$$, 'P0001',
  'February 2018 cannot be reopened while March 2018 is closed. Reopen March 2018 first.',
  'any day of the month names it; the note does not get round the rule');
select is(pg_temp.hint_of($$select public.reopen_month('2018-01-01')$$),
  'Months reopen newest first: reopen the latest closed month, then the one before it.',
  'the refusal carries the hint');
select is((select count(*)::int from public.closed_months where month between '2018-01-01' and '2018-03-01'), 3,
  'the refusals reopened nothing');
select is((select note from public.closed_months where month = '2018-02-01'), null,
  'the refused reopen left no note behind');

-- sales and engineer are refused for their role first, even on the latest month
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.reopen_month('2018-03-01')$$, '42501', null, 'sales still cannot reopen a month');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$select public.reopen_month('2018-03-01', 'newest first')$$, 'the latest closed month (March) reopens');
select throws_ok($$select public.reopen_month('2018-01-01')$$, 'P0001',
  'January 2018 cannot be reopened while February 2018 is closed. Reopen February 2018 first.',
  'after March, January still waits for February');
select lives_ok($$select public.reopen_month('2018-02-01')$$, 'February, now the latest, reopens');
select lives_ok($$select public.reopen_month('2018-01-01')$$, 'then January');
select is((select count(*)::int from public.closed_months where month between '2018-01-01' and '2018-03-01'), 0,
  'all three are open again, newest first');
select lives_ok($$select public.reopen_month('2018-06-01')$$, 'reopening a month that is not closed still does nothing');

select * from finish();
rollback;
