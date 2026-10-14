begin;
select plan(24);

-- R07: "can't quote" reasons are structured (supplier_inquiries.no_offer_reason, inquiry_item_declines).
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ shape
select has_column('public', 'supplier_inquiries', 'no_offer_reason', 'supplier_inquiries has no_offer_reason');
select col_is_null('public', 'supplier_inquiries', 'no_offer_reason', 'no_offer_reason is nullable');
select has_table('public', 'inquiry_item_declines', 'inquiry_item_declines exists');
select col_is_pk('public', 'inquiry_item_declines', array['inquiry_id', 'rfq_item_id'], 'its primary key is (inquiry_id, rfq_item_id)');
select is((select count(*)::int from pg_trigger t
           where t.tgrelid = 'public.inquiry_item_declines'::regclass and not t.tgisinternal
             and t.tgfoid = 'public.audit_row_change()'::regprocedure), 1, 'inquiry_item_declines has the audit trigger');
select is((select relrowsecurity from pg_class where oid = 'public.inquiry_item_declines'::regclass), true, 'row security is on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'inquiry_item_declines' and grantee in ('anon', 'PUBLIC')), 0,
  'anon and PUBLIC hold nothing on inquiry_item_declines');

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000b1', 'R07 Customer'),
  ('c0000000-0000-4000-8000-0000000000b2', 'R07 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description) values
  ('e0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000b1', 0, 'R07 item one'),
  ('e0000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-0000000000b1', 1, 'R07 item two');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b2', public.today_pkt());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ the reason for the whole inquiry
select lives_ok($$update public.supplier_inquiries set no_offer_on = public.today_pkt(), no_offer_reason = 'no_brand'
                  where id = 'f0000000-0000-4000-8000-0000000000b1'$$, 'a reason is saved together with no_offer_on');
select is((select no_offer_reason from public.supplier_inquiries where id = 'f0000000-0000-4000-8000-0000000000b1'), 'no_brand',
  'and reads back');
select is((select response_state from public.v_inquiry_state where inquiry_id = 'f0000000-0000-4000-8000-0000000000b1'), 'no_offer',
  'v_inquiry_state still says no_offer (its meaning is unchanged)');
select throws_ok($$update public.supplier_inquiries set no_offer_reason = 'because'
                   where id = 'f0000000-0000-4000-8000-0000000000b1'$$, '23514', null, 'a key outside the list is refused');
select lives_ok($$update public.supplier_inquiries set no_offer_on = null, no_offer_reason = null
                   where id = 'f0000000-0000-4000-8000-0000000000b1'$$, 'taking it back clears both together');
select throws_ok($$update public.supplier_inquiries set no_offer_reason = 'other'
                   where id = 'f0000000-0000-4000-8000-0000000000b1'$$, '23514', null,
  'a reason without no_offer_on is refused');
select lives_ok($$update public.supplier_inquiries set notes = 'Call Imran on Monday'
                  where id = 'f0000000-0000-4000-8000-0000000000b1'$$, 'notes stay free for people and are not touched by reasons');

-- ------------------------------------------------------------------ per-item declines
select lives_ok($$insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason)
                  values ('f0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b2', 'discontinued')$$,
  'staff can record a reason for one item');
select is((select created_by from public.inquiry_item_declines limit 1), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'created_by defaults to the caller');
select throws_ok($$insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason)
                    values ('f0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b2', 'other')$$,
  '23505', null, 'one reason per item and inquiry');
select throws_ok($$insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason)
                    values ('f0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b1', 'nope')$$,
  '23514', null, 'a key outside the list is refused here too');
select lives_ok($$update public.inquiry_item_declines set reason = 'wont_quote_quantity'$$, 'the reason can be changed');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.inquiry_item_declines), 0, 'a deactivated user sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.inquiry_item_declines), 1, 'an engineer reads it');

reset role;
-- ------------------------------------------------------------------ audit (composite key) and cascades
select is((select record_id from public.audit_log where table_name = 'inquiry_item_declines' and action = 'insert'),
  '{"inquiry_id": "f0000000-0000-4000-8000-0000000000b1", "rfq_item_id": "e0000000-0000-4000-8000-0000000000b2"}',
  'the audit row is keyed on the composite primary key');
delete from public.rfq_items where id = 'e0000000-0000-4000-8000-0000000000b2';
select is((select count(*)::int from public.inquiry_item_declines), 0, 'deleting the item deletes its declines');
insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason)
  values ('f0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b1', 'other');
delete from public.supplier_inquiries where id = 'f0000000-0000-4000-8000-0000000000b1';
select is((select count(*)::int from public.inquiry_item_declines), 0, 'deleting the inquiry deletes its declines');

select * from finish();
rollback;
