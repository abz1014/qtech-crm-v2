begin;
select * from no_plan();

-- 0065: the medium and low findings of docs/SECURITY_REVIEW.md, closed. Fixture users come from supabase/seed.sql:
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04. Fixtures are written as the table owner (not limited);
-- every check runs as `authenticated` with a persona's claims, as the API does.

-- ------------------------------------------------------------------ fixtures
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('65000000-0000-4000-8000-000000000001', '0065 Customer');
insert into public.rfqs (id, company_id, owner_id, legacy_flags) values
  ('65000000-0000-4000-8000-000000000010', '65000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}'),
  ('65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000001', null, '{owner_unknown}');   -- an imported RFQ with no owner
-- Orders made yesterday (not in the transaction that writes their lines).
insert into public.orders (id, company_id, owner_id, created_at, legacy_flags) values
  ('65000000-0000-4000-8000-000000000020', '65000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day', '{}'),
  ('65000000-0000-4000-8000-000000000021', '65000000-0000-4000-8000-000000000001', null, now() - interval '1 day', '{owner_unknown}'),
  ('65000000-0000-4000-8000-000000000022', '65000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day', '{value_basis_unknown}');
insert into public.order_items (id, order_id, description, qty, unit_price_net, gst_rate) values
  ('65000000-0000-4000-8000-000000000030', '65000000-0000-4000-8000-000000000020', 'Line A', 2, 100, 18),
  ('65000000-0000-4000-8000-000000000031', '65000000-0000-4000-8000-000000000022', 'Line B', 1, 118, 18);

set local role authenticated;

-- ================================================================== M-1: order lines
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);   -- engineer
select throws_ok($$update public.order_items set unit_price_net = 50 where id = '65000000-0000-4000-8000-000000000030'$$,
  '42501', null, 'M-1: an engineer cannot change a selling price');
select throws_ok($$update public.order_items set gst_rate = 0 where id = '65000000-0000-4000-8000-000000000030'$$,
  '42501', null, 'M-1: nor the GST of a line');
select throws_ok($$update public.order_items set qty = 3 where id = '65000000-0000-4000-8000-000000000030'$$,
  '42501', null, 'M-1: nor a quantity');
select throws_ok($$update public.order_items set supplier_unit_price = 1 where id = '65000000-0000-4000-8000-000000000030'$$,
  '42501', null, 'M-1: nor a supplier price');
select throws_ok($$insert into public.order_items (order_id, description, qty, unit_price_net) values ('65000000-0000-4000-8000-000000000020', 'extra', 1, 1)$$,
  '42501', null, 'M-1: nor add a line to an existing order');
select throws_ok($$delete from public.order_items where id = '65000000-0000-4000-8000-000000000030'$$,
  '42501', null, 'M-1: nor delete one');
select lives_ok($$update public.order_items set description = 'Line A (site tag 4)' where id = '65000000-0000-4000-8000-000000000030'$$,
  'an engineer still edits the words of a line');
select lives_ok($$insert into public.orders (id, company_id, owner_id) values ('65000000-0000-4000-8000-000000000023', '65000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002')$$,
  'an engineer can create an order (as convert and repeat do)');
select lives_ok($$insert into public.order_items (order_id, description, qty, unit_price_net) values ('65000000-0000-4000-8000-000000000023', 'new line', 1, 10)$$,
  'and write its lines in the same transaction');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
select lives_ok($$update public.order_items set unit_price_net = 90, gst_rate = 0 where id = '65000000-0000-4000-8000-000000000030'$$,
  'sales still edit prices and GST (the order page needs it)');
select lives_ok($$insert into public.order_items (order_id, description, qty, unit_price_net) values ('65000000-0000-4000-8000-000000000020', 'sales line', 1, 5)$$,
  'and add lines');

-- ================================================================== M-1: the value basis flag
select throws_ok($$update public.orders set legacy_flags = '{value_basis_unknown}' where id = '65000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'M-1: sales cannot set the value basis flag');
select throws_ok($$update public.orders set legacy_flags = '{po_shared}' where id = '65000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'M-1: nor any other legacy flag');
select throws_ok($$insert into public.orders (company_id, legacy_flags) values ('65000000-0000-4000-8000-000000000001', '{value_basis_unknown}')$$,
  '42501', null, 'M-1: nor insert an order that carries flags');
select throws_ok($$select public.resolve_value_basis('65000000-0000-4000-8000-000000000022', 'net')$$,
  '42501', null, 'resolve_value_basis stays admin only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);   -- admin
select throws_ok($$update public.orders set legacy_flags = '{}' where id = '65000000-0000-4000-8000-000000000022'$$,
  '42501', null, 'M-1: even an admin changes the value basis only through resolve_value_basis');
select throws_ok($$update public.orders set legacy_flags = '{value_basis_unknown}' where id = '65000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'M-1: and cannot set it by hand either');
select lives_ok($$update public.orders set legacy_flags = '{po_shared}' where id = '65000000-0000-4000-8000-000000000020'$$,
  'an admin can change the other legacy flags');
select lives_ok($$select public.resolve_value_basis('65000000-0000-4000-8000-000000000022', 'gross')$$,
  'resolve_value_basis clears the flag');
select is((select legacy_flags from public.orders where id = '65000000-0000-4000-8000-000000000022'), '{}'::text[],
  'the flag is gone');
select is((select unit_price_net from public.order_items where id = '65000000-0000-4000-8000-000000000031'), 100.00::numeric,
  'and the gross price became net, as before');
select is(coalesce(current_setting('qtech.resolving_value_basis', true), ''), '', 'the transaction mark is cleared again');

-- ================================================================== M-2: owners
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
select throws_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'M-2: sales cannot give an order away');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);   -- engineer
select throws_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000003' where id = '65000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'M-2: an engineer cannot take an order (and the credit of its payments)');
select throws_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000003' where id = '65000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'M-2: not even an unowned one');
select throws_ok($$update public.rfqs set owner_id = 'a0000000-0000-4000-8000-000000000003' where id = '65000000-0000-4000-8000-000000000010'$$,
  '42501', null, 'M-2: nor an RFQ (convert copies its owner into the order)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
select lives_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000002' where id = '65000000-0000-4000-8000-000000000021'$$,
  'M-2: sales may take an order that has no owner');
select throws_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'but not hand it on afterwards');
select lives_ok($$update public.rfqs set owner_id = 'a0000000-0000-4000-8000-000000000002' where id = '65000000-0000-4000-8000-000000000011'$$,
  'M-2: and an RFQ that has no owner');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);   -- admin
select lives_ok($$update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000020'$$,
  'M-2: an admin reassigns an order');
select lives_ok($$update public.rfqs set owner_id = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000010'$$,
  'M-2: and an RFQ');

-- ================================================================== L-1: actor columns
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
insert into public.companies (id, name, created_by) values ('65000000-0000-4000-8000-000000000002', '0065 Spoof Co', 'a0000000-0000-4000-8000-000000000001');
select is((select created_by from public.companies where id = '65000000-0000-4000-8000-000000000002'), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'L-1: created_by is the caller, whatever the insert names');
update public.companies set created_by = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000002';
select is((select created_by from public.companies where id = '65000000-0000-4000-8000-000000000002'), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'L-1: and it cannot be rewritten');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where t.tgname = c.relname || '_force_created_by' and c.relnamespace = 'public'::regnamespace),
          (select count(*)::int from information_schema.columns k join information_schema.tables b
             on b.table_schema = k.table_schema and b.table_name = k.table_name
           where k.table_schema = 'public' and k.column_name = 'created_by' and b.table_type = 'BASE TABLE'),
  'L-1: every table with created_by has the trigger');

insert into public.clarifications (id, rfq_id, question, first_asked_at, last_asked_at, ask_count, last_asked_by) values
  ('65000000-0000-4000-8000-000000000040', '65000000-0000-4000-8000-000000000010', 'Q?', now() - interval '3 days', now() - interval '3 days', 1, 'a0000000-0000-4000-8000-000000000001');
select is((select last_asked_by from public.clarifications where id = '65000000-0000-4000-8000-000000000040'), null::uuid,
  'L-1: an insert cannot name someone else as the asker');
update public.clarifications set last_asked_by = 'a0000000-0000-4000-8000-000000000001' where id = '65000000-0000-4000-8000-000000000040';
select is((select last_asked_by from public.clarifications where id = '65000000-0000-4000-8000-000000000040'), null::uuid,
  'L-1: nor can an update that changes nothing else');
select is(public.stamp_clarification_ask(array['65000000-0000-4000-8000-000000000040']::uuid[]), 1, 'sales asks again');
select is((select last_asked_by from public.clarifications where id = '65000000-0000-4000-8000-000000000040'), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'L-1: the chase records the caller');
update public.clarifications set last_asked_at = now() - interval '3 days', ask_count = 1, last_asked_by = 'a0000000-0000-4000-8000-000000000001'
  where id = '65000000-0000-4000-8000-000000000040';
select is((select last_asked_by from public.clarifications where id = '65000000-0000-4000-8000-000000000040'), null::uuid,
  'L-1: an Undo leaves no name rather than a named one');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);   -- admin
insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at, costs_complete_by)
values ('65000000-0000-4000-8000-000000000020', 10, now(), 'a0000000-0000-4000-8000-000000000002');
select is((select costs_complete_by from public.order_costs where order_id = '65000000-0000-4000-8000-000000000020'), 'a0000000-0000-4000-8000-000000000001'::uuid,
  'L-1: costs are marked complete by the caller');
update public.order_costs set costs_complete_at = null, costs_complete_by = 'a0000000-0000-4000-8000-000000000002' where order_id = '65000000-0000-4000-8000-000000000020';
select is((select costs_complete_by from public.order_costs where order_id = '65000000-0000-4000-8000-000000000020'), null::uuid,
  'L-1: reopening costs clears the name');

-- ================================================================== L-2: a sequence made later is closed to anon too
reset role;
create sequence public.t0065_probe_seq;
select is(has_sequence_privilege('anon', 'public.t0065_probe_seq', 'USAGE,SELECT,UPDATE'), false,
  'L-2: the default privileges no longer give anon a new sequence');
drop sequence public.t0065_probe_seq;

-- ================================================================== L-6: receipts of a closed month
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('65000000-0000-4000-8000-000000000050', '65000000-0000-4000-8000-000000000020', 'INV-0065-1', '2020-02-10', 100, 18);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  ('65000000-0000-4000-8000-000000000051', 'gst-receipts', '0065/r1.pdf', 'r1.pdf', 'application/pdf', 10, '65000000-0000-4000-8000-000000000050');
insert into storage.objects (bucket_id, name) values ('gst-receipts', '0065/r1.pdf'), ('gst-receipts', '0065/free.pdf');
select public.close_months_through('2020-02-01');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
select throws_ok($$update public.attachments set file_name = 'x.pdf' where id = '65000000-0000-4000-8000-000000000051'$$,
  'P0001', null, 'L-6: a receipt of a closed month cannot be changed');
select throws_ok($$delete from public.attachments where id = '65000000-0000-4000-8000-000000000051'$$,
  'P0001', null, 'L-6: nor removed');
select lives_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id)
                  values ('gst-receipts', '0065/late.pdf', 'late.pdf', 'application/pdf', 10, '65000000-0000-4000-8000-000000000050')$$,
  'L-6: but a receipt can still be added (October is filed in November)');
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'gst-receipts' and name = '0065/r1.pdf' returning 1)
select is((select count(*)::int from u), 0, 'L-6: its stored file cannot be overwritten');
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'gst-receipts' and name = '0065/free.pdf' returning 1)
select is((select count(*)::int from u), 1, 'a file no closed receipt points at is unaffected');
select is(public.receipt_locked('gst-receipts', '0065/r1.pdf'), true, 'receipt_locked says so to sales');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);   -- admin
with u as (update storage.objects set metadata = '{"x":2}' where bucket_id = 'gst-receipts' and name = '0065/r1.pdf' returning 1)
select is((select count(*)::int from u), 0, 'L-6: the lock binds an admin too (reopen the month first)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);   -- engineer
select is(public.receipt_locked('gst-receipts', '0065/r1.pdf'), null::boolean, 'receipt_locked tells an engineer nothing');
reset role;

-- ================================================================== L-7: content types
select ok((select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf', 'text/plain',
                                              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
           from storage.buckets where id = 'rfq-files'),
  'L-7: rfq-files takes photos (HEIC too), PDF, office documents and text');
select is((select count(*)::int from storage.buckets
           where id in ('rfq-files', 'gst-receipts', 'expense-receipts')
             and allowed_mime_types is not null
             and not (allowed_mime_types && array['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/xhtml+xml'])),
  3, 'L-7: none of the three buckets takes HTML, SVG or script');

select * from finish();
rollback;
