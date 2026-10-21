begin;
select * from no_plan();

-- 0083 (owner decision 2026-10-22): imported RFQs with no real activity for more than 60 days are closed as
-- no_reply_to_clarification with an automatic note; Today and the open / overdue counts stop showing them. Fixtures are
-- written as the owner with no signed-in person (as the import's service role writes them), so their audit rows carry no
-- person. Fixture users from supabase/seed.sql: admin a0..01, sales a0..02.

select set_config('request.jwt.claims', '', true);

create function pg_temp.r(n int) returns uuid language sql immutable as
  $$ select ('d8300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.d(n int) returns date language sql stable as $$ select public.today_pkt() - n $$;

insert into public.companies (id, name) values
  ('c8300000-0000-4000-8000-000000000001', 'Stale Import Customer'),
  ('c8300000-0000-4000-8000-000000000002', 'Stale Import Supplier');

-- n, received N days ago, imported?
insert into public.rfqs (id, company_id, owner_id, received_on, legacy_source)
select pg_temp.r(n), 'c8300000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', pg_temp.d(days),
       case when imported then '{"imported": true, "table": "rfqs"}'::jsonb end
from (values (1, 30, true), (2, 59, true), (3, 60, true), (4, 61, true), (5, 600, true), (6, 600, true),
             (7, 600, false), (8, 600, true), (9, 600, true), (10, 600, true), (12, 600, true), (13, 600, true))
     as f(n, days, imported);

-- 5: old due date, old quoted date, old enquiry still awaiting a reply (Today's "chase supplier" and "overdue")
update public.rfqs set due_on = pg_temp.d(590), quoted_on = pg_temp.d(595) where id = pg_temp.r(5);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, legacy_source) values
  ('d8310000-0000-4000-8000-000000000005', pg_temp.r(5), 'c8300000-0000-4000-8000-000000000002', pg_temp.d(598),
   '{"imported": true, "table": "supplier_inquiries"}');
-- 6: won (a live order)
insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('d8320000-0000-4000-8000-000000000006', 'c8300000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', pg_temp.r(6));
-- 8, 9, 10: one item and one enquiry each, then a supplier price
insert into public.rfq_items (id, rfq_id, description) select ('d8330000-0000-4000-8000-0000000000' || n)::uuid, pg_temp.r(n::int), 'Pressure transmitter'
from unnest(array['08', '09', '10']) n;
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, legacy_source)
select ('d8310000-0000-4000-8000-0000000000' || n)::uuid, pg_temp.r(n::int), 'c8300000-0000-4000-8000-000000000002', pg_temp.d(599),
       '{"imported": true, "table": "supplier_inquiries"}'::jsonb
from unnest(array['08', '09', '10']) n;
-- 8: a supplier replied in v2 today (not imported)
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency) values
  ('d8310000-0000-4000-8000-000000000008', 'd8330000-0000-4000-8000-000000000008', 1000, 'PKR');
-- 9: an imported reply the old CRM received 10 days ago (raw row moves to legacy_archive, 0078)
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, legacy_source) values
  ('d8340000-0000-4000-8000-000000000009', 'd8310000-0000-4000-8000-000000000009', 'd8330000-0000-4000-8000-000000000009', 1000, 'PKR',
   jsonb_build_object('table', 'supplier_quotes', 'row', jsonb_build_object('id', '9', 'received_at', pg_temp.d(10)::text || 'T09:00:00+05:00')));
-- 10: an imported reply received 500 days ago; its created_at is the import run (today) and must not count
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, legacy_source) values
  ('d8340000-0000-4000-8000-000000000010', 'd8310000-0000-4000-8000-000000000010', 'd8330000-0000-4000-8000-000000000010', 1000, 'PKR',
   jsonb_build_object('table', 'supplier_quotes', 'row', jsonb_build_object('id', '10', 'received_at', pg_temp.d(500)::text)));
-- 11: imported and already lost in the old CRM
insert into public.rfqs (id, company_id, owner_id, received_on, closed_on, close_reason, close_note, legacy_source) values
  (pg_temp.r(11), 'c8300000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', pg_temp.d(700),
   pg_temp.d(400), 'price', 'old loss', '{"imported": true, "table": "rfqs"}');
-- 13: imported, received long ago, but its due date was 20 days ago
update public.rfqs set due_on = pg_temp.d(20) where id = pg_temp.r(13);

-- 12: a person edited it in v2 today
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update public.rfqs set notes = 'Customer called, still interested' where id = pg_temp.r(12);
reset role;
select set_config('request.jwt.claims', '', true);

select is((select count(*)::int from legacy_archive.legacy_rows where table_name = 'supplier_quote_lines'
           and row_id in ('d8340000-0000-4000-8000-000000000009', 'd8340000-0000-4000-8000-000000000010')), 2,
  'precondition: the imported replies'' raw rows are in the archive');
select is(legacy_archive.rfq_last_activity(pg_temp.r(10)), pg_temp.d(500),
  'an imported reply counts by the old row''s date, not the import run''s created_at');
select is(legacy_archive.rfq_last_activity(pg_temp.r(5)), pg_temp.d(590), 'the latest of received, due, quoted and enquiry dates');

-- ------------------------------------------------------------------ before
create temp table before_counts as
select count(*) filter (where outcome = 'open')::int as open_n, count(*) filter (where is_overdue)::int as overdue_n
from public.v_rfq_state where company_id = 'c8300000-0000-4000-8000-000000000001';
select is((select open_n from before_counts), 11, 'before: 11 open (6 is won, 11 lost)');
select is((select overdue_n from before_counts), 2, 'before: 2 overdue (5 and 13)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.today_inquiry_facts() where inquiry_id = 'd8310000-0000-4000-8000-000000000005'), 1,
  'before: Today chases the supplier on RFQ 5');
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------------ run
select is(legacy_archive.close_stale_imported_rfqs(), 3, 'closes 3: the 61-day, the 600-day, and the one whose only reply is imported and old');

select is((select array_agg(n order by n) from generate_series(1, 13) n
           join public.rfqs r on r.id = pg_temp.r(n)
           where r.closed_on = public.today_pkt() and r.close_reason = 'no_reply_to_clarification'
             and r.close_note = 'Closed automatically: imported, no activity for 60+ days (owner decision 2026-10-22)'),
  array[4, 5, 10], 'closed today, as no reply, with the owner''s note');
select is((select array_agg(n order by n) from generate_series(1, 13) n
           join public.v_rfq_state s on s.rfq_id = pg_temp.r(n) where s.outcome = 'open'),
  array[1, 2, 3, 7, 8, 9, 12, 13],
  'stay open: 30, 59, 60 days; not imported; recent v2 reply; recent imported reply; edited in v2; recent due date');
select is((select outcome from public.v_rfq_state where rfq_id = pg_temp.r(6)), 'won', 'the won one is untouched');
select is((select closed_on from public.rfqs where id = pg_temp.r(6)), null::date, 'the won one gets no closed date');
select ok((select closed_on = pg_temp.d(400) and close_reason = 'price' and close_note = 'old loss' from public.rfqs where id = pg_temp.r(11)),
  'the already-lost one keeps its date, reason and note');

select is((select count(*) filter (where outcome = 'open')::int from public.v_rfq_state
           where company_id = 'c8300000-0000-4000-8000-000000000001'), 8, 'after: 8 open (was 11)');
select is((select count(*) filter (where is_overdue)::int from public.v_rfq_state
           where company_id = 'c8300000-0000-4000-8000-000000000001'), 1, 'after: 1 overdue (was 2)');
select is((select bid_state from public.v_rfq_state where rfq_id = pg_temp.r(5)), 'bid_sent', 'no expired-quotation state either');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.today_inquiry_facts() where inquiry_id = 'd8310000-0000-4000-8000-000000000005'), 0,
  'after: Today no longer chases the supplier on RFQ 5');
reset role;
select set_config('request.jwt.claims', '', true);

select ok((select a.changed_by is null and a.new_value ->> 'close_reason' = 'no_reply_to_clarification'
                  and a.new_value ->> 'closed_on' = public.today_pkt()::text
           from public.audit_log a
           where a.table_name = 'rfqs' and a.record_id = pg_temp.r(5)::text and a.action = 'update'
             and a.new_value ? 'close_reason'),
  'audit_log records the close as a system change (no person)');

select is(legacy_archive.close_stale_imported_rfqs(), 0, 'a second run closes nothing (idempotent)');

-- ------------------------------------------------------------------ reopen and access
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$update public.rfqs set closed_on = null, close_reason = null, close_note = null
                  where id = 'd8300000-0000-4000-8000-000000000005'$$, 'sales can Reopen an auto-closed RFQ (the app''s update)');
select is((select outcome from public.v_rfq_state where rfq_id = 'd8300000-0000-4000-8000-000000000005'), 'open', 'and it is open again');
select throws_ok($$select legacy_archive.close_stale_imported_rfqs()$$, '42501', null, 'a signed-in person cannot run the clean-up');
reset role;

select ok(not has_function_privilege('authenticated', 'legacy_archive.close_stale_imported_rfqs(date, integer)', 'execute')
      and not has_function_privilege('anon', 'legacy_archive.close_stale_imported_rfqs(date, integer)', 'execute')
      and not has_function_privilege('service_role', 'legacy_archive.close_stale_imported_rfqs(date, integer)', 'execute'),
  'no client role may execute the clean-up');

select * from finish();
rollback;
