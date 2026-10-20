begin;
select * from no_plan();

-- 0074 parts D and E: complete results at scale, the same numbers.
--   receivables_list()     the very rows of order_receivables() (every column), plus company name and invoice numbers, for more
--                          than 1,000 orders; pages of 1,000 (what `.range()` asks PostgREST for) rebuild the whole list
--   receivables_summary()  equals the client's receivableTotals rules applied to the full list
--   today_inquiry_facts()  equals what the Today loader computed from v_inquiry_state, v_rfq_state, supplier_inquiries,
--                          clarifications, v_supplier_stats and companies
--   lookup_labels()        names for long id lists; row security applies
--   month_end_check_details() fbr_pending lists exactly the invoices month_end_status() counts (GST-exempt ones left out)
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

create function pg_temp.as_user(persona text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
    else 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
end
$f$;

select pg_temp.as_user('admin');

-- ------------------------------------------------------------------ fixture: 1,250 orders over three customers
insert into public.companies (id, name)
select ('c9000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Scale customer ' || g from generate_series(1, 3) g;

-- every 97th order is cancelled (it stays in the list only when it was invoiced); every 5th has no terms of its own
insert into public.orders (id, company_id, owner_id, payment_terms_days, cancelled_on)
select ('a9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('c9000000-0000-4000-8000-' || lpad(to_hex(1 + g % 3), 12, '0'))::uuid,
       (case when g % 2 = 0 then 'a0000000-0000-4000-8000-000000000002' else 'a0000000-0000-4000-8000-000000000001' end)::uuid,
       case when g % 5 = 0 then null else 15 + (g % 4) * 15 end,
       case when g % 97 = 0 then public.today_pkt() - 3 end
from generate_series(1, 1250) g;

-- every 101st order has no lines at all (gross 0); a quarter of the lines are GST-exempt
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate)
select ('a9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Scale item ' || g, 1 + g % 3, 100 + g % 50,
       case when g % 4 = 0 then 0 else 18 end
from generate_series(1, 1250) g
where g % 101 <> 0;

-- two thirds of the orders are invoiced, at dates from today back 4 months; every 7th invoiced order has a second invoice
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount)
select ('a9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'SC-' || g, public.today_pkt() - (g % 120),
       (1 + g % 3) * (100 + g % 50),
       case when g % 4 = 0 then 0 else round((1 + g % 3) * (100 + g % 50) * 0.18) end
from generate_series(1, 1250) g
where g % 3 <> 0 and g % 101 <> 0;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount)
select ('a9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'SC-' || g || '-B', public.today_pkt() - (g % 40), 10, 0
from generate_series(1, 1250) g
where g % 3 <> 0 and g % 101 <> 0 and g % 7 = 0;

-- payments: settled in full, part paid, or nothing; a few overpaid
insert into public.payments_in (order_id, amount, received_on)
select r.order_id, case when g % 4 = 1 then r.gross_target when g % 4 = 2 then 50 else r.gross_target + 25 end, public.today_pkt() - 1
from generate_series(1, 1250) g
join public.order_receivables(('a9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid) r on true
where (g % 4 in (1, 2) or g % 61 = 0) and r.gross_target > 0;

-- reminders on some invoices (recent and old), so "reminder due" has both kinds
update public.invoices set last_reminded_on = public.today_pkt() - (case when number like '%5' then 3 else 20 end), reminder_count = 1
where number like 'SC-%' and (number like '%5' or number like '%8');

analyze public.orders, public.order_items, public.invoices, public.payments_in;

-- ------------------------------------------------------------------ receivables_list: same rows, same numbers, complete
set local role authenticated;

select cmp_ok((select count(*)::int from public.receivables_list()), '>', 1000, 'the fixture gives more than 1,000 receivable rows');
select is((select count(*)::int from public.receivables_list()), (select count(*)::int from public.order_receivables()),
  'receivables_list() returns every row of order_receivables() (no cap)');
select bag_eq(
  $$select order_id, order_number, company_id, owner_id, gross_target, settled, balance, overpaid_by, due_on, is_overdue,
           payment_state, last_reminded_on, reminder_count, data_trust from public.receivables_list()$$,
  $$select order_id, order_number, company_id, owner_id, gross_target, settled, balance, overpaid_by, due_on, is_overdue,
           payment_state, last_reminded_on, reminder_count, data_trust from public.order_receivables()$$,
  'every column of every row equals order_receivables() (same numbers)');
select bag_eq(
  $$select order_id, company_name, invoice_numbers from public.receivables_list()$$,
  $$select r.order_id, c.name,
           coalesce((select array_agg(v.number order by v.invoice_date nulls last, v.number) from public.invoices v
                     where v.order_id = r.order_id and v.number is not null), '{}'::text[])
    from public.order_receivables() r join public.companies c on c.id = r.company_id$$,
  'company name and invoice numbers (oldest first) are what the client read with two in.(...) lists');
select ok((select bool_and(a.order_number < b.order_number)
           from (select order_number, row_number() over () as k from public.receivables_list()) a
           join (select order_number, row_number() over () as k from public.receivables_list()) b on b.k = a.k + 1),
  'rows come in order-number order (stable pages)');
select is((select count(distinct order_id)::int from (
             (select order_id from public.receivables_list() limit 1000 offset 0)
             union all (select order_id from public.receivables_list() limit 1000 offset 1000)
             union all (select order_id from public.receivables_list() limit 1000 offset 2000)) p),
          (select count(*)::int from public.receivables_list()),
  'pages of 1,000 (as .range() asks) rebuild the whole list with no row twice or missing');
select is((select count(*)::int from (
             (select order_id from public.receivables_list() limit 1000 offset 0)
             union all (select order_id from public.receivables_list() limit 1000 offset 1000)
             union all (select order_id from public.receivables_list() limit 1000 offset 2000)) p),
          (select count(*)::int from public.receivables_list()),
  'and the pages add up to the row count');

-- filters
select bag_eq($$select order_id from public.receivables_list('overdue')$$,
              $$select order_id from public.order_receivables() where payment_state = 'overdue'$$,
  'p_state overdue = the overdue rows (Today''s payment items)');
select cmp_ok((select count(*)::int from public.receivables_list('overdue')), '>', 50, 'the fixture has overdue orders');
select bag_eq($$select order_id from public.receivables_list('open')$$,
              $$select order_id from public.order_receivables() where payment_state <> 'settled'$$,
  'p_state open = everything not settled');
select bag_eq($$select order_id from public.receivables_list('settled', null, null, true)$$,
              $$select order_id from public.order_receivables() where payment_state = 'settled' and gross_target > 0$$,
  'p_state settled with p_with_value');
select bag_eq($$select order_id from public.receivables_list(null, 'c9000000-0000-4000-8000-000000000002')$$,
              $$select order_id from public.order_receivables() where company_id = 'c9000000-0000-4000-8000-000000000002'$$,
  'p_company_id = that company''s rows (the company page)');
select bag_eq($$select order_id from public.receivables_list(null, null, null, true)$$,
              $$select order_id from public.order_receivables() where gross_target > 0$$,
  'p_with_value leaves out the orders worth 0 (Money > Who owes us)');
select cmp_ok((select count(*)::int from public.order_receivables() where gross_target = 0), '>', 0, 'the fixture has orders worth 0');
select is((select count(*)::int from public.receivables_list(null, null, 'a9100000-0000-4000-8000-000000000005')), 1,
  'p_order_id gives the one order');
select throws_ok($$select * from public.receivables_list('due')$$, '22023', null, 'an unknown state is refused');

-- ------------------------------------------------------------------ receivables_summary: the client's totals, on the server
select results_eq(
  $$select open_count, outstanding, overdue_count, overdue, reminder_due_count, not_yet_due_count, not_yet_due,
           not_invoiced_count, not_invoiced, gross, settled, settled_count from public.receivables_summary()$$,
  $$with r as (select l.*, cardinality(l.invoice_numbers) > 0 as invoiced from public.receivables_list(null, null, null, true) l),
         o as (select * from r where payment_state <> 'settled')
    select (select count(*) from o)::int, (select coalesce(sum(balance), 0) from o),
           (select count(*) from o where payment_state = 'overdue')::int,
           (select coalesce(sum(balance), 0) from o where payment_state = 'overdue'),
           (select count(*) from o where payment_state = 'overdue'
              and (last_reminded_on is null or public.today_pkt() - last_reminded_on >= 7))::int,
           (select count(*) from o where invoiced and payment_state <> 'overdue')::int,
           (select coalesce(sum(balance), 0) from o where invoiced and payment_state <> 'overdue'),
           (select count(*) from o where not invoiced)::int,
           (select coalesce(sum(balance), 0) from o where not invoiced),
           (select coalesce(sum(gross_target), 0) from o), (select coalesce(sum(settled), 0) from o),
           (select count(*) from r where payment_state = 'settled')::int$$,
  'receivables_summary() = receivableTotals over the full list (open, overdue, reminder due, not yet due, not invoiced)');
select ok((select open_count > 500 and overdue_count > 50 and reminder_due_count > 0 and reminder_due_count < overdue_count
                  and not_invoiced_count > 0 and settled_count > 100
           from public.receivables_summary()),
  'the summary is not trivial on this fixture');
select is((select reminder_due_count from public.receivables_summary(public.today_pkt() + 30)),
          (select overdue_count from public.receivables_summary()),
  'p_today moves the 7-day reminder window');

-- access: the same as order_receivables()
select pg_temp.as_user('sales');
select is((select count(*)::int from public.receivables_list()), (select count(*)::int from public.order_receivables()),
  'sales gets the same complete list');
select is((select count(*)::int from public.receivables_summary()), 1, 'sales gets the summary row');
select pg_temp.as_user('engineer');
select throws_ok($$select * from public.receivables_list()$$, '42501', null, 'an engineer is refused, as by order_receivables()');
select throws_ok($$select * from public.receivables_summary()$$, '42501', null, 'an engineer is refused the summary');
select pg_temp.as_user('deactivated');
select is((select count(*)::int from public.receivables_list()), 0, 'a deactivated user gets no rows');
select is((select count(*)::int from public.receivables_summary()), 0, 'a deactivated user gets no summary row');
reset role;
set local role anon;
select throws_ok($$select * from public.receivables_list()$$, '42501', null, 'anon cannot execute receivables_list');
select throws_ok($$select * from public.receivables_summary()$$, '42501', null, 'anon cannot execute receivables_summary');
select throws_ok($$select public.lookup_labels()$$, '42501', null, 'anon cannot execute lookup_labels');
select throws_ok($$select * from public.today_inquiry_facts()$$, '42501', null, 'anon cannot execute today_inquiry_facts');
reset role;
select pg_temp.as_user('admin');

-- ------------------------------------------------------------------ today_inquiry_facts
-- RFQs: R1 open, R2 closed, R3 won (live order), R4 open with its order cancelled (so still open).
insert into public.companies (id, name) values
  ('c9100000-0000-4000-8000-000000000001', 'Today customer'),
  ('c9100000-0000-4000-8000-000000000011', 'Supplier One'),
  ('c9100000-0000-4000-8000-000000000012', 'Supplier Two'),
  ('c9100000-0000-4000-8000-000000000013', 'Supplier Three');
insert into public.rfqs (id, company_id, owner_id, closed_on, close_reason) values
  ('d9100000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null),
  ('d9100000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - 1, 'other'),
  ('d9100000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null),
  ('d9100000-0000-4000-8000-000000000004', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null, null);
insert into public.rfq_items (id, rfq_id, description) values
  ('d9110000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000001', 'Valve'),
  ('d9110000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000002', 'Valve'),
  ('d9110000-0000-4000-8000-000000000003', 'd9100000-0000-4000-8000-000000000003', 'Valve'),
  ('d9110000-0000-4000-8000-000000000004', 'd9100000-0000-4000-8000-000000000004', 'Valve');
insert into public.orders (id, company_id, owner_id, rfq_id, cancelled_on) values
  ('a9200000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000003', null),
  ('a9200000-0000-4000-8000-000000000004', 'c9100000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000004', public.today_pkt());
-- enquiries: awaiting (chased by sales), quoted, no offer, and one quoted with answers to relay, on each RFQ
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, no_offer_on, last_relayed_at)
select ('e9100000-0000-4000-8000-0000000000' || r || s)::uuid,
       ('d9100000-0000-4000-8000-00000000000' || r)::uuid,
       ('c9100000-0000-4000-8000-0000000000' || (10 + s))::uuid,
       public.today_pkt() - 10,
       case when s = 3 then public.today_pkt() - 2 end,
       case when s = 2 and r in (1, 4) then now() - interval '3 days' end
from generate_series(1, 4) r, generate_series(1, 3) s;
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
select ('e9100000-0000-4000-8000-0000000000' || r || '2')::uuid, ('d9110000-0000-4000-8000-00000000000' || r)::uuid, 10, 'PKR'
from generate_series(1, 4) r;
select pg_temp.as_user('sales');
update public.supplier_inquiries set last_chased_on = public.today_pkt() - 1, chase_count = 1
where id in ('e9100000-0000-4000-8000-000000000011', 'e9100000-0000-4000-8000-000000000041');
select pg_temp.as_user('admin');
-- questions raised by the quoted enquiry: answered before the last relay, after it (twice, two days), withdrawn, unanswered
insert into public.clarifications (rfq_id, raised_by_inquiry_id, question, answered_at, answer, withdrawn_at)
select ('d9100000-0000-4000-8000-00000000000' || r)::uuid, ('e9100000-0000-4000-8000-0000000000' || r || '2')::uuid, q.t,
       q.at, case when q.at is not null then 'A' end, q.wd
from generate_series(1, 4) r,
     (values ('before relay', now() - interval '5 days', null::timestamptz),
             ('after relay 1', now() - interval '2 days', null),
             ('after relay 2', now() - interval '1 day', null),
             ('withdrawn', null, now()),
             ('open', null, null)) as q (t, at, wd);

set local role authenticated;
select bag_eq(
  $$select inquiry_id, rfq_id, supplier_id, supplier_name, sent_on, last_chased_on, last_chased_by, chase_count, response_state,
           answers_to_relay, answered_on, replied, median_reply_days from public.today_inquiry_facts()$$,
  $$select s.inquiry_id, s.rfq_id, s.supplier_id, c.name, s.sent_on, s.last_chased_on, si.last_chased_by, s.chase_count::int,
           s.response_state, s.answers_to_relay::int,
           case when s.answers_to_relay > 0 then (
             select max(public.today_pkt(cl.answered_at)) from public.clarifications cl
             where cl.raised_by_inquiry_id = s.inquiry_id and cl.answered_at is not null and cl.withdrawn_at is null
               and not (si.last_relayed_at is not null and cl.answered_at <= si.last_relayed_at)) end,
           vs.replied, vs.median_reply_days
    from public.v_inquiry_state s
    join public.v_rfq_state r on r.rfq_id = s.rfq_id and r.outcome = 'open'
    join public.supplier_inquiries si on si.id = s.inquiry_id
    left join public.companies c on c.id = s.supplier_id
    left join public.v_supplier_stats vs on vs.supplier_id = s.supplier_id
    where s.response_state = 'awaiting' or s.answers_to_relay > 0$$,
  'today_inquiry_facts() = what the Today loader computed from five reads (open RFQs only)');
select is((select count(*)::int from public.today_inquiry_facts()
           where rfq_id in ('d9100000-0000-4000-8000-000000000001', 'd9100000-0000-4000-8000-000000000004')), 4,
  'two open RFQs (one whose order was cancelled) give their awaiting and relay-pending enquiries');
select is((select count(*)::int from public.today_inquiry_facts()
           where rfq_id in ('d9100000-0000-4000-8000-000000000002', 'd9100000-0000-4000-8000-000000000003')), 0,
  'a closed RFQ and a won RFQ give nothing');
select is((select last_chased_by from public.today_inquiry_facts() where inquiry_id = 'e9100000-0000-4000-8000-000000000011'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'the chaser comes with the enquiry');
select is((select answered_on from public.today_inquiry_facts() where inquiry_id = 'e9100000-0000-4000-8000-000000000012'),
  public.today_pkt(now() - interval '1 day'), 'answered_on is the latest answer after the last relay');
select is((select answered_on from public.today_inquiry_facts() where inquiry_id = 'e9100000-0000-4000-8000-000000000011'),
  null::date, 'no answers to relay, no answered_on');
select pg_temp.as_user('engineer');
select cmp_ok((select count(*)::int from public.today_inquiry_facts()), '>=', 4, 'an engineer may call it (enquiries are all-staff)');
select pg_temp.as_user('deactivated');
select is((select count(*)::int from public.today_inquiry_facts()), 0, 'a deactivated user gets nothing');
select pg_temp.as_user('admin');
reset role;

-- ------------------------------------------------------------------ lookup_labels
insert into public.supplier_orders (id, order_id, supplier_id, created_at) values
  ('a9300000-0000-4000-8000-000000000001', 'a9100000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000011', now() - interval '2 hours'),
  ('a9300000-0000-4000-8000-000000000002', 'a9100000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000012', now() - interval '1 hour'),
  ('a9300000-0000-4000-8000-000000000003', 'a9100000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000013', now());
set local role authenticated;
select is((select count(*)::int from jsonb_object_keys(public.lookup_labels(
             (select array_agg(id) from public.companies), (select array_agg(id) from public.orders), '{}') -> 'orders')),
          (select count(*)::int from public.orders),
  'lookup_labels answers 1,000+ order ids in one call (one jsonb value, no row cap)');
select is(public.lookup_labels(array['c9000000-0000-4000-8000-000000000001'::uuid], array['a9100000-0000-4000-8000-000000000003'::uuid],
                               array['a9300000-0000-4000-8000-000000000002'::uuid, 'a9300000-0000-4000-8000-000000000003'::uuid]),
  jsonb_build_object(
    'companies', jsonb_build_object('c9000000-0000-4000-8000-000000000001', 'Scale customer 1'),
    'orders', jsonb_build_object('a9100000-0000-4000-8000-000000000003', jsonb_build_object(
      'number', (select number from public.orders where id = 'a9100000-0000-4000-8000-000000000003'),
      'company_id', 'c9000000-0000-4000-8000-000000000001', 'company_name', 'Scale customer 1')),
    'legs', jsonb_build_object(
      'a9300000-0000-4000-8000-000000000002', jsonb_build_object('order_id', 'a9100000-0000-4000-8000-000000000001',
                                                                 'supplier_id', 'c9100000-0000-4000-8000-000000000012', 'position', 1),
      'a9300000-0000-4000-8000-000000000003', jsonb_build_object('order_id', 'a9100000-0000-4000-8000-000000000002',
                                                                 'supplier_id', 'c9100000-0000-4000-8000-000000000013', 'position', 0))),
  'lookup_labels: names, order number and company, and the supplier order''s place among its order''s (by creation)');
select is(public.lookup_labels(), '{"companies": {}, "orders": {}, "legs": {}}'::jsonb, 'no ids, empty maps');
select pg_temp.as_user('deactivated');
select is(public.lookup_labels(array['c9000000-0000-4000-8000-000000000001'::uuid], array['a9100000-0000-4000-8000-000000000003'::uuid]),
  '{"companies": {}, "orders": {}, "legs": {}}'::jsonb, 'row security applies: a deactivated user gets nothing');
select pg_temp.as_user('admin');
reset role;

-- ------------------------------------------------------------------ month_end_check_details: the pending list matches the count
-- June 2025: one invoice with GST not deposited, one GST-exempt invoice (nothing to deposit), one deposited.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, tax_deposited_on) values
  ('a9100000-0000-4000-8000-000000000001', 'ME-GST', '2025-06-10', 1000, 180, null),
  ('a9100000-0000-4000-8000-000000000002', 'ME-EXEMPT', '2025-06-20', 1000, 0, null),
  ('a9100000-0000-4000-8000-000000000004', 'ME-DONE', '2025-06-05', 1000, 180, '2025-06-25');
set local role authenticated;
select is((select n from public.month_end_status('2025-06-01') where check_key = 'fbr_pending'), 1,
  'month_end_status counts one invoice with GST still to deposit');
select is((select jsonb_array_length(detail -> 'invoices') from public.month_end_check_details('2025-06-01') where check_key = 'fbr_pending'),
  (select n from public.month_end_status('2025-06-01') where check_key = 'fbr_pending'),
  'month_end_check_details lists as many as it counts (the exempt invoice is no longer listed)');
select is((select detail -> 'invoices' -> 0 ->> 'number' from public.month_end_check_details('2025-06-01') where check_key = 'fbr_pending'),
  'ME-GST', 'the listed invoice is the one with GST to deposit');
select is((select (detail ->> 'amount')::numeric from public.month_end_check_details('2025-06-01') where check_key = 'fbr_pending'),
  180::numeric, 'the amount is unchanged (the exempt invoice adds 0)');
reset role;

select * from finish();
rollback;
