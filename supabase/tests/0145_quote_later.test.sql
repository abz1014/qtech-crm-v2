begin;
select plan(16);

-- 0145: a supplier will quote an item later (inquiry_item_waits). A price or a decline for the item ends the wait.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ shape
select has_table('public', 'inquiry_item_waits', 'inquiry_item_waits exists');
select col_is_pk('public', 'inquiry_item_waits', array['inquiry_id', 'rfq_item_id'], 'its primary key is (inquiry_id, rfq_item_id)');
select is((select relrowsecurity from pg_class where oid = 'public.inquiry_item_waits'::regclass), true, 'row security is on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'inquiry_item_waits' and grantee in ('anon', 'PUBLIC')), 0,
  'anon and PUBLIC hold nothing on inquiry_item_waits');
select is((select count(*)::int from pg_trigger t
           where t.tgrelid = 'public.inquiry_item_waits'::regclass and not t.tgisinternal
             and t.tgfoid = 'public.audit_row_change()'::regprocedure), 1, 'inquiry_item_waits has the audit trigger');

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000001c1', 'Q145 Customer'),
  ('c0000000-0000-4000-8000-0000000001c2', 'Q145 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-0000000001c1', 'c0000000-0000-4000-8000-0000000001c1', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description) values
  ('e0000000-0000-4000-8000-0000000001c1', 'd0000000-0000-4000-8000-0000000001c1', 0, 'Q145 item one'),
  ('e0000000-0000-4000-8000-0000000001c2', 'd0000000-0000-4000-8000-0000000001c1', 1, 'Q145 item two'),
  ('e0000000-0000-4000-8000-0000000001c3', 'd0000000-0000-4000-8000-0000000001c1', 2, 'Q145 item three');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-0000000001c1', 'd0000000-0000-4000-8000-0000000001c1', 'c0000000-0000-4000-8000-0000000001c2', public.today_pkt());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ writing a wait
select lives_ok($$insert into public.inquiry_item_waits (inquiry_id, rfq_item_id)
                  values ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c1'),
                         ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c2'),
                         ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c3')$$,
  'staff can say a supplier will quote items later');
select is((select created_by from public.inquiry_item_waits limit 1), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'created_by defaults to the caller');
select throws_ok($$insert into public.inquiry_item_waits (inquiry_id, rfq_item_id)
                    values ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c1')$$,
  '23505', null, 'one wait per item and inquiry');

-- ------------------------------------------------------------------ a price or a decline ends it
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
  values ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c1', 120, 'USD');
select is((select count(*)::int from public.inquiry_item_waits where rfq_item_id = 'e0000000-0000-4000-8000-0000000001c1'), 0,
  'a price saved for the item ends its wait');
insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason)
  values ('f0000000-0000-4000-8000-0000000001c1', 'e0000000-0000-4000-8000-0000000001c2', 'discontinued');
select is((select count(*)::int from public.inquiry_item_waits where rfq_item_id = 'e0000000-0000-4000-8000-0000000001c2'), 0,
  'a decline saved for the item ends its wait');
select is((select count(*)::int from public.inquiry_item_waits), 1, 'the other item still waits');
select is((select count(*)::int from public.inquiry_item_declines where reason is not null and rfq_item_id = 'e0000000-0000-4000-8000-0000000001c3'), 0,
  'a wait is not a decline: the reasons the reports read are untouched');

-- ------------------------------------------------------------------ who reads it
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.inquiry_item_waits), 1, 'an engineer reads it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.inquiry_item_waits), 0, 'a deactivated user sees nothing');

reset role;
-- ------------------------------------------------------------------ cascades
delete from public.rfq_items where id = 'e0000000-0000-4000-8000-0000000001c3';
select is((select count(*)::int from public.inquiry_item_waits), 0, 'deleting the item deletes its wait');
select is((select count(*)::int from public.audit_log where table_name = 'inquiry_item_waits' and action = 'insert'), 3,
  'every wait written is in the audit log');

select * from finish();
rollback;
