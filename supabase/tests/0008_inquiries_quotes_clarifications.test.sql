begin;
select plan(84);

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
select columns_are('public', 'supplier_inquiries',
  array['id', 'created_at', 'created_by', 'rfq_id', 'supplier_id', 'sent_on', 'last_chased_on', 'no_offer_on',
        'last_relayed_at', 'notes', 'chase_count', 'legacy_flags', 'legacy_source', 'no_offer_reason'],
  'supplier_inquiries has the section 2.9 columns (with chase_count, and no_offer_reason from 0032)');
select columns_are('public', 'supplier_quote_lines',
  array['id', 'created_at', 'created_by', 'inquiry_id', 'rfq_item_id', 'unit_price', 'currency', 'lead_time',
        'origin', 'in_stock', 'notes', 'legacy_flags', 'legacy_source',
        'fx_rate_pkr', 'fx_rate_on'],
  'supplier_quote_lines has the section 2.10 columns (FX columns from S17)');
select columns_are('public', 'clarifications',
  array['id', 'created_at', 'created_by', 'rfq_id', 'raised_by_inquiry_id', 'question', 'first_asked_at',
        'last_asked_at', 'ask_count', 'answer', 'answered_at', 'withdrawn_at'],
  'clarifications has the section 2.11 columns (with ask_count)');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.supplier_inquiries'::regclass, 'public.supplier_quote_lines'::regclass,
                         'public.clarifications'::regclass)),
  'RLS is enabled on all three tables');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'supplier_inquiries'),
  array['supplier_inquiries_delete_unsent_or_admin', 'supplier_inquiries_insert_staff',
        'supplier_inquiries_select_staff', 'supplier_inquiries_update_staff'],
  'supplier_inquiries policies');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename in ('supplier_quote_lines', 'clarifications')), 8,
  'supplier_quote_lines and clarifications have four policies each');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in (select ('public.' || t)::regclass from unnest(array['supplier_inquiries', 'supplier_quote_lines', 'clarifications']) t)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the S04 tables');
select col_hasnt_default('public', 'supplier_quote_lines', 'currency', 'currency has no default');
select col_not_null('public', 'supplier_quote_lines', 'currency', 'currency is NOT NULL');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.supplier_quote_lines'::regclass
                    and tgname = 'supplier_quote_lines_learn_brands' and not tgisinternal),
  'quote lines have the brand auto-learn trigger');
select ok(not has_function_privilege('authenticated', 'public.learn_company_brands()', 'execute')
      and not has_function_privilege('anon', 'public.learn_company_brands()', 'execute'),
  'learn_company_brands is not callable by clients');

-- ------------------------------------------------------------------ fixtures (as owner)
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier A'),
  ('c0000000-0000-4000-8000-000000000003', 'Supplier B');
insert into public.brands (id, name, kind) values
  ('c3000000-0000-4000-8000-000000000001', 'Belimo', 'brand'),
  ('c3000000-0000-4000-8000-000000000002', 'Actuators', 'family');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description, brand_id, family_id) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Item with brand',
   'c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Item without brand', null, null),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'Third item', null, null);
-- Inquiry A is shortlisted only; inquiry B has been sent.
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('e0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', null),
  ('e0000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000003', '2026-10-01');

-- ------------------------------------------------------------------ supplier_inquiries constraints
select is((select chase_count from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000a'),
  0::smallint, 'chase_count defaults to 0');
select throws_ok($$insert into public.supplier_inquiries (rfq_id, supplier_id)
                   values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'one inquiry per (rfq, supplier)');
select throws_ok($$update public.supplier_inquiries set chase_count = -1
                   where id = 'e0000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'chase_count cannot be negative');
select throws_ok($$insert into public.supplier_inquiries (rfq_id, supplier_id)
                   values ('d0000000-0000-4000-8000-000000000001', null)$$,
  '23502', null, 'supplier is required');

-- ------------------------------------------------------------------ supplier_quote_lines constraints
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 10)$$,
  '23502', null, 'a quote line without currency is rejected');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 10, 'usd')$$,
  '23514', null, 'lower-case currency is rejected');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 10, 'US')$$,
  '23514', null, 'two-letter currency is rejected');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 0, 'USD')$$,
  '23514', null, 'a zero unit price is rejected');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', -5, 'USD')$$,
  '23514', null, 'a negative unit price is rejected');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'USD')$$,
  '23502', null, 'unit price is required');

-- Brand auto-learn: no links exist yet.
select is((select count(*)::int from public.company_brands
           where company_id in ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003')), 0,
  'no company_brands links before any quote line');
select lives_ok($$insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency)
                  values ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a',
                          'd1000000-0000-4000-8000-000000000001', 1.2345, 'USD')$$,
  'a quote line with price and currency is accepted');
select is((select unit_price from public.supplier_quote_lines where id = 'f0000000-0000-4000-8000-000000000001'),
  1.2345::numeric, 'unit prices keep four decimals');
select is((select array_agg(brand_id::text order by brand_id) from public.company_brands
           where company_id = 'c0000000-0000-4000-8000-000000000002'),
  array['c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002'],
  'the trigger upserts the supplier with the item brand and family');
select is((select count(*)::int from public.company_brands
           where company_id = 'c0000000-0000-4000-8000-000000000002' and created_by is not null), 0,
  'auto-learnt links have created_by NULL');
select lives_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                  values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 5, 'EUR')$$,
  'a line for an item without brand or family is accepted');
select is((select count(*)::int from public.company_brands where company_id = 'c0000000-0000-4000-8000-000000000002'), 2,
  'an item with no brand or family adds no link');
select throws_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                   values ('e0000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 9, 'USD')$$,
  '23505', null, 'one quote line per (inquiry, item)');
select is((select count(*)::int from public.company_brands where company_id = 'c0000000-0000-4000-8000-000000000002'), 2,
  'the rejected duplicate line left the links unchanged');
-- A second supplier quoting the same item learns independently; a manual link is kept as it was.
insert into public.company_brands (company_id, brand_id, created_by)
  values ('c0000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency)
                  values ('e0000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000001', 7, 'CNY')$$,
  'a second supplier can quote the same item');
select is((select count(*)::int from public.company_brands where company_id = 'c0000000-0000-4000-8000-000000000003'), 2,
  'supplier B gains the family link; the existing brand link is not duplicated');
select is((select created_by from public.company_brands
           where company_id = 'c0000000-0000-4000-8000-000000000003'
             and brand_id = 'c3000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'an existing manual link is left untouched');

-- ------------------------------------------------------------------ clarifications constraints
insert into public.clarifications (id, rfq_id, question, raised_by_inquiry_id) values
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Voltage?',
   'e0000000-0000-4000-8000-00000000000a');

select is((select ask_count from public.clarifications where id = 'b0000000-0000-4000-8000-000000000001'),
  0::smallint, 'ask_count defaults to 0');
select ok((select answer is null and answered_at is null and withdrawn_at is null
                  and first_asked_at is null and last_asked_at is null
           from public.clarifications where id = 'b0000000-0000-4000-8000-000000000001'),
  'a clarification needs only a question');
select throws_ok($$insert into public.clarifications (rfq_id) values ('d0000000-0000-4000-8000-000000000001')$$,
  '23502', null, 'question is required');
select throws_ok($$update public.clarifications set answer = 'Use 24V'
                   where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an answer without answered_at is rejected');
select lives_ok($$update public.clarifications set answered_at = now()
                  where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'answered_at without answer text is accepted (answered by phone)');
select lives_ok($$update public.clarifications set answer = 'Use 24V'
                  where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'an answer with answered_at is accepted');
select throws_ok($$update public.clarifications set withdrawn_at = now()
                   where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an answered clarification cannot also be withdrawn');
select throws_ok($$update public.clarifications set answer = null, answered_at = null,
                          first_asked_at = '2026-10-10', last_asked_at = '2026-10-09'
                   where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'last_asked_at cannot precede first_asked_at');
select lives_ok($$update public.clarifications set answer = null, answered_at = null,
                         first_asked_at = '2026-10-09', last_asked_at = '2026-10-10', ask_count = 2,
                         withdrawn_at = now()
                  where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'an unanswered clarification can be asked, chased and withdrawn');
select throws_ok($$update public.clarifications set ask_count = -1
                   where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'ask_count cannot be negative');

-- Deleting an unsent inquiry detaches the clarification it raised.
delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000a';
select is((select raised_by_inquiry_id from public.clarifications where id = 'b0000000-0000-4000-8000-000000000001'),
  null, 'deleting the inquiry clears clarifications.raised_by_inquiry_id');
select is((select count(*)::int from public.supplier_quote_lines
           where id = 'f0000000-0000-4000-8000-000000000001'), 0,
  'deleting the inquiry cascades to its quote lines');
-- Rebuild inquiry A for the role tests.
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('e0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', null);

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.supplier_inquiries), 2, 'sales reads inquiries');
select is((select count(*)::int from public.supplier_quote_lines), 1, 'sales reads quote lines');
select is((select count(*)::int from public.clarifications), 1, 'sales reads clarifications');
select lives_ok($$insert into public.supplier_inquiries (id, rfq_id, supplier_id)
                  values ('e0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000001',
                          'c0000000-0000-4000-8000-000000000001')$$,
  'sales inserts an inquiry with only an RFQ and a supplier');
select is((select created_by from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000c1'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'created_by defaults to the caller');
select is(public.t_rows($q$update public.supplier_inquiries set notes = 'n' where id = 'e0000000-0000-4000-8000-00000000000b'$q$), 1,
  'sales updates a sent inquiry');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000b'$q$), 0,
  'sales cannot delete a sent inquiry');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000c1'$q$), 1,
  'sales deletes an unsent inquiry');
select is(public.t_rows($q$update public.supplier_inquiries set sent_on = '2026-10-02' where id = 'e0000000-0000-4000-8000-00000000000a'$q$), 1,
  'sales stamps an inquiry as sent');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000a'$q$), 0,
  'once stamped sent, sales cannot delete the inquiry');
select lives_ok($$insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency)
                  values ('f0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-00000000000a',
                          'd1000000-0000-4000-8000-000000000003', 3, 'GBP')$$,
  'sales inserts a quote line');
select is(public.t_rows($q$update public.supplier_quote_lines set in_stock = true where id = 'f0000000-0000-4000-8000-0000000000c1'$q$), 1,
  'sales updates a quote line');
select is(public.t_rows($q$delete from public.supplier_quote_lines where id = 'f0000000-0000-4000-8000-0000000000c1'$q$), 1,
  'sales deletes a quote line');
select lives_ok($$insert into public.clarifications (id, rfq_id, question)
                  values ('b0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-000000000001', 'Sales Q')$$,
  'sales inserts a clarification');
select is(public.t_rows($q$delete from public.clarifications where id = 'b0000000-0000-4000-8000-0000000000c1'$q$), 1,
  'sales deletes a clarification');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.supplier_quote_lines), 1, 'engineer reads supplier prices');
select lives_ok($$insert into public.supplier_inquiries (id, rfq_id, supplier_id)
                  values ('e0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001',
                          'c0000000-0000-4000-8000-000000000001')$$,
  'engineer inserts an inquiry');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000b'$q$), 0,
  'engineer cannot delete a sent inquiry');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000d1'$q$), 1,
  'engineer deletes an unsent inquiry');
select lives_ok($$insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency)
                  values ('f0000000-0000-4000-8000-0000000000d1', 'e0000000-0000-4000-8000-00000000000a',
                          'd1000000-0000-4000-8000-000000000003', 4, 'EUR')$$,
  'engineer inserts a quote line');
select is(public.t_rows($q$delete from public.supplier_quote_lines where id = 'f0000000-0000-4000-8000-0000000000d1'$q$), 1,
  'engineer deletes a quote line');
select lives_ok($$insert into public.clarifications (id, rfq_id, question)
                  values ('b0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001', 'Eng Q')$$,
  'engineer inserts a clarification');
select is(public.t_rows($q$update public.clarifications set question = 'Eng Q2' where id = 'b0000000-0000-4000-8000-0000000000d1'$q$), 1,
  'engineer updates a clarification');
select is(public.t_rows($q$delete from public.clarifications where id = 'b0000000-0000-4000-8000-0000000000d1'$q$), 1,
  'engineer deletes a clarification');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.supplier_inquiries), 0, 'deactivated user sees no inquiries');
select is((select count(*)::int from public.supplier_quote_lines), 0, 'deactivated user sees no quote lines');
select is((select count(*)::int from public.clarifications), 0, 'deactivated user sees no clarifications');
select throws_ok($$insert into public.supplier_inquiries (rfq_id, supplier_id)
                   values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'deactivated user cannot insert an inquiry');
select throws_ok($$insert into public.clarifications (rfq_id, question)
                   values ('d0000000-0000-4000-8000-000000000001', 'Ghost')$$,
  '42501', null, 'deactivated user cannot insert a clarification');
select is(public.t_rows($q$delete from public.supplier_inquiries$q$), 0, 'deactivated user cannot delete inquiries');
select is(public.t_rows($q$delete from public.supplier_quote_lines$q$), 0, 'deactivated user cannot delete quote lines');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.supplier_inquiries), 2, 'admin reads inquiries');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000b'$q$), 1,
  'admin deletes a sent inquiry');
select is(public.t_rows($q$delete from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-00000000000a'$q$), 1,
  'admin deletes an inquiry that was stamped sent by someone else');
select is((select count(*)::int from public.clarifications), 1, 'admin reads clarifications');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.supplier_inquiries$$, '42501', null, 'anon cannot read inquiries');
select throws_ok($$select * from public.supplier_quote_lines$$, '42501', null, 'anon cannot read quote lines');
select throws_ok($$select * from public.clarifications$$, '42501', null, 'anon cannot read clarifications');
select throws_ok($$insert into public.supplier_inquiries (rfq_id, supplier_id)
                   values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot insert an inquiry');
reset role;

select * from finish();
rollback;
