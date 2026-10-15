begin;
select plan(77);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'rfqs',
  array['id', 'created_at', 'created_by', 'updated_at', 'number', 'company_id', 'site_id', 'contact_id',
        'customer_ref', 'received_on', 'due_on', 'owner_id', 'is_priority', 'quoted_on', 'closed_on',
        'close_reason', 'close_note', 'notes', 'legacy_flags', 'legacy_source', 'due_time'],
  'rfqs has the section 2.7 columns (due_time from A7, 0038)');
select columns_are('public', 'rfq_items',
  array['id', 'created_at', 'created_by', 'rfq_id', 'position', 'description', 'brand_id', 'family_id', 'qty',
        'unit', 'quoted_unit_price_net', 'gst_rate', 'quoted_lead_time', 'model_tokens', 'legacy_flags',
        'legacy_source'],
  'rfq_items has the section 2.8 columns (with gst_rate, quoted_lead_time, model_tokens)');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.rfqs'::regclass, 'public.rfq_items'::regclass)),
  'RLS is enabled on rfqs and rfq_items');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'rfqs'),
  array['rfqs_delete_admin', 'rfqs_insert_staff', 'rfqs_select_staff', 'rfqs_update_staff'],
  'rfqs policies');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'rfq_items'), 4,
  'rfq_items has four policies');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in (select ('public.' || t)::regclass from unnest(array['rfqs', 'rfq_items']) t)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on rfqs and rfq_items');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.rfqs'::regclass
                    and tgname = 'rfqs_set_updated_at' and not tgisinternal),
  'rfqs has the updated_at trigger');
select ok((select indexdef like '%USING gin (model_tokens)%' from pg_indexes
           where schemaname = 'public' and indexname = 'rfq_items_model_tokens_idx'),
  'rfq_items.model_tokens has a GIN index');
select ok((select provolatile = 'i' from pg_proc where oid = 'public.model_tokens(text)'::regprocedure),
  'model_tokens() is IMMUTABLE');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.rfq_items'::regclass and contype = 'f'
                    and confrelid = 'public.rfqs'::regclass and confdeltype = 'c'),
  'rfq_items cascades from rfqs');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.rfqs'::regclass and contype = 'f'
                    and confrelid = 'public.companies'::regclass and confdeltype = 'r'),
  'rfqs.company_id is RESTRICT');

-- ------------------------------------------------------------------ model_tokens() cases (section 2.8)
select is(public.model_tokens('Hach HQ1110 portable meter'), array['HQ1110'], 'model_tokens: Hach HQ1110');
select is(public.model_tokens('Position transmitter PMA-18-F0200-X'), array['PMA18F0200X'],
  'model_tokens: separators are stripped');
select is(public.model_tokens('24V actuator'), '{}'::text[], 'model_tokens: 24V is too short and a unit');
select is(public.model_tokens('supply 24VDC 4-20mA 100MM 10BAR 1000W 50HZ'), '{}'::text[],
  'model_tokens: unit and range patterns are excluded');
select is(public.model_tokens('ABC123, def456 ghi'), array['ABC123', 'DEF456'],
  'model_tokens: splits on commas and whitespace, upper-cases');
select is(public.model_tokens('ABCD EFGH 12345'), '{}'::text[],
  'model_tokens: needs both a letter and a digit');
select is(public.model_tokens('HQ1110 hq1110'), array['HQ1110'], 'model_tokens: duplicates collapse');
select is(public.model_tokens(null), '{}'::text[], 'model_tokens: NULL gives an empty array');

-- ------------------------------------------------------------------ constraints (as owner)
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'RFQ Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Other Customer');
insert into public.rfqs (id, company_id, customer_ref, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'REF-1',
   'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Hach HQ1110 portable meter');

select is((select received_on from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'),
  public.today_pkt(), 'received_on defaults to today in Karachi');
select is((select is_priority from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'), false,
  'is_priority defaults to false');
select ok((select number is not null from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'),
  'number is generated');
select throws_ok($$insert into public.rfqs (company_id, owner_id, number)
                   values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 1)$$,
  '428C9', null, 'number cannot be set by an insert');
select throws_ok($$insert into public.rfqs (company_id) values (null)$$,
  '23502', null, 'rfqs.company_id is required');
select throws_ok($$insert into public.rfqs (company_id) values ('c0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'owner_id may be NULL only with the owner_unknown legacy flag');
select lives_ok($$insert into public.rfqs (company_id, legacy_flags)
                  values ('c0000000-0000-4000-8000-000000000001', array['owner_unknown'])$$,
  'a legacy row flagged owner_unknown may have no owner');
select throws_ok($$insert into public.rfqs (company_id, owner_id, customer_ref)
                   values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'REF-1')$$,
  '23505', null, 'same customer_ref for the same company is rejected');
select lives_ok($$insert into public.rfqs (company_id, owner_id, customer_ref)
                  values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'REF-1')$$,
  'same customer_ref for another company is accepted');
select lives_ok($$insert into public.rfqs (company_id, owner_id)
                  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
                         ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002')$$,
  'RFQs without a customer_ref never collide');
select throws_ok($$update public.rfqs set closed_on = '2026-01-01'
                   where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'closing an RFQ needs a reason');
select throws_ok($$update public.rfqs set close_reason = 'price'
                   where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a close reason needs closed_on');
select throws_ok($$update public.rfqs set closed_on = '2026-01-01', close_reason = 'because'
                   where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'close_reason CHECK rejects unknown values');
select lives_ok($$update public.rfqs set closed_on = '2026-01-01', close_reason = 'price'
                  where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'closed_on and a valid reason together are accepted');
select lives_ok($$update public.rfqs set closed_on = null, close_reason = null
                  where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'reopening clears both');

update public.rfqs set updated_at = '2020-01-01 00:00:00+00' where id = 'd0000000-0000-4000-8000-000000000001';
update public.rfqs set is_priority = true where id = 'd0000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.rfqs
           where id = 'd0000000-0000-4000-8000-000000000001'),
  'rfqs.updated_at is bumped by the trigger');

select is((select qty from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000001'), 1::numeric,
  'qty defaults to 1');
select is((select gst_rate from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000001'), 18::numeric,
  'gst_rate defaults to 18');
select is((select position from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000001'), 0::smallint,
  'position defaults to 0');
select is((select model_tokens from public.rfq_items where id = 'd1000000-0000-4000-8000-000000000001'),
  array['HQ1110'], 'model_tokens is generated from the description');
select is((select count(*)::int from public.rfq_items where model_tokens @> array['HQ1110']), 1,
  'items are findable by model token');
select throws_ok($$insert into public.rfq_items (rfq_id, description, model_tokens)
                   values ('d0000000-0000-4000-8000-000000000001', 'x', '{A1B2}')$$,
  '428C9', null, 'model_tokens cannot be written');
select throws_ok($$insert into public.rfq_items (rfq_id) values ('d0000000-0000-4000-8000-000000000001')$$,
  '23502', null, 'description is required');
select throws_ok($$insert into public.rfq_items (rfq_id, description, qty)
                   values ('d0000000-0000-4000-8000-000000000001', 'x', 0)$$,
  '23514', null, 'qty must be positive');
select throws_ok($$insert into public.rfq_items (rfq_id, description, gst_rate)
                   values ('d0000000-0000-4000-8000-000000000001', 'x', 101)$$,
  '23514', null, 'gst_rate above 100 is rejected');
select throws_ok($$insert into public.rfq_items (rfq_id, description, gst_rate)
                   values ('d0000000-0000-4000-8000-000000000001', 'x', -1)$$,
  '23514', null, 'negative gst_rate is rejected');
select throws_ok($$insert into public.rfq_items (rfq_id, description, quoted_unit_price_net)
                   values ('d0000000-0000-4000-8000-000000000001', 'x', -0.01)$$,
  '23514', null, 'negative quoted price is rejected');
select lives_ok($$insert into public.rfq_items (rfq_id, description, quoted_unit_price_net, gst_rate, qty, unit)
                  values ('d0000000-0000-4000-8000-000000000001', 'Cable', 0, 0, 12.5, 'm')$$,
  'a zero price, zero GST and fractional metres are accepted');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'), 1,
  'sales reads rfqs');
select lives_ok($$insert into public.rfqs (id, company_id, notes)
                  values ('d0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-000000000001', 'by sales')$$,
  'sales inserts an RFQ with only a company');
select is((select owner_id from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'owner_id defaults to the caller');
select is((select created_by from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a2'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'created_by defaults to the caller');
select is(public.t_rows($q$update public.rfqs set is_priority = true where id = 'd0000000-0000-4000-8000-0000000000a2'$q$), 1,
  'sales updates an RFQ');
select is(public.t_rows($q$delete from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a2'$q$), 0,
  'sales cannot delete an RFQ');
select lives_ok($$insert into public.rfq_items (id, rfq_id, description)
                  values ('d1000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a2', 'Sales item')$$,
  'sales inserts an item');
select is(public.t_rows($q$update public.rfq_items set unit = 'pcs' where id = 'd1000000-0000-4000-8000-0000000000a2'$q$), 1,
  'sales updates an item');
select is(public.t_rows($q$delete from public.rfq_items where id = 'd1000000-0000-4000-8000-0000000000a2'$q$), 1,
  'sales deletes an item');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001'), 1,
  'engineer reads rfqs');
select lives_ok($$insert into public.rfqs (id, company_id)
                  values ('d0000000-0000-4000-8000-0000000000a3', 'c0000000-0000-4000-8000-000000000001')$$,
  'engineer inserts an RFQ');
select is(public.t_rows($q$update public.rfqs set due_on = '2026-12-01' where id = 'd0000000-0000-4000-8000-0000000000a3'$q$), 1,
  'engineer updates an RFQ');
select is(public.t_rows($q$delete from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a3'$q$), 0,
  'engineer cannot delete an RFQ');
select lives_ok($$insert into public.rfq_items (id, rfq_id, description)
                  values ('d1000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000a3', 'Eng item')$$,
  'engineer inserts an item');
select is(public.t_rows($q$delete from public.rfq_items where id = 'd1000000-0000-4000-8000-0000000000a3'$q$), 1,
  'engineer deletes an item');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.rfqs), 0, 'deactivated user sees no RFQs');
select is((select count(*)::int from public.rfq_items), 0, 'deactivated user sees no items');
select throws_ok($$insert into public.rfqs (company_id) values ('c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'deactivated user cannot insert an RFQ');
select throws_ok($$insert into public.rfq_items (rfq_id, description)
                   values ('d0000000-0000-4000-8000-000000000001', 'x')$$,
  '42501', null, 'deactivated user cannot insert an item');
select is(public.t_rows($q$update public.rfqs set notes = 'x'$q$), 0, 'deactivated user cannot update RFQs');
select is(public.t_rows($q$delete from public.rfq_items$q$), 0, 'deactivated user cannot delete items');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok((select count(*)::int from public.rfqs) >= 3, 'admin reads all RFQs');
select lives_ok($$insert into public.rfqs (id, company_id)
                  values ('d0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000001')$$,
  'admin inserts an RFQ');
select lives_ok($$insert into public.rfq_items (rfq_id, description)
                  values ('d0000000-0000-4000-8000-0000000000a1', 'Admin item')$$, 'admin inserts an item');
select is(public.t_rows($q$delete from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes an RFQ');
select is(public.t_rows($q$delete from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a3'$q$), 1,
  'admin deletes an RFQ created by another user');
select is((select count(*)::int from public.rfq_items where rfq_id = 'd0000000-0000-4000-8000-0000000000a1'), 0,
  'deleting an RFQ cascades to its items');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.rfqs$$, '42501', null, 'anon cannot read rfqs');
select throws_ok($$select * from public.rfq_items$$, '42501', null, 'anon cannot read rfq_items');
select throws_ok($$insert into public.rfqs (company_id) values ('c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot insert an RFQ');
reset role;

select * from finish();
rollback;
