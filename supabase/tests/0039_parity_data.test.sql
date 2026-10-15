begin;
select plan(36);

-- A7 parity fields (0039). Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ the new columns exist, are the right type, and are optional
select has_column('public', 'contacts', 'job_title', 'contacts.job_title exists');
select col_type_is('public', 'contacts', 'job_title', 'text', 'contacts.job_title is text');
select col_is_null('public', 'contacts', 'job_title', 'contacts.job_title is optional');
select has_column('public', 'companies', 'city', 'companies.city exists');
select col_type_is('public', 'companies', 'city', 'text', 'companies.city is text');
select col_is_null('public', 'companies', 'city', 'companies.city is optional');
select has_column('public', 'rfqs', 'due_time', 'rfqs.due_time exists');
select col_type_is('public', 'rfqs', 'due_time', 'time without time zone', 'rfqs.due_time is a time');
select col_is_null('public', 'rfqs', 'due_time', 'rfqs.due_time is optional');
select has_column('public', 'users', 'phone', 'users.phone exists');
select col_type_is('public', 'users', 'phone', 'text', 'users.phone is text');
select col_is_null('public', 'users', 'phone', 'users.phone is optional');
select has_column('public', 'clarifications', 'rfq_item_id', 'clarifications.rfq_item_id exists');
select col_is_null('public', 'clarifications', 'rfq_item_id', 'clarifications.rfq_item_id is optional');
select fk_ok('public', 'clarifications', 'rfq_item_id', 'public', 'rfq_items', 'id', 'clarifications.rfq_item_id references rfq_items');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name, city) values ('c0000000-0000-4000-8000-0000000000e1', 'A7 Customer', 'Faisalabad');
insert into public.contacts (id, company_id, name, job_title) values
  ('c2000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'Mr. Tariq Mehmood', 'Procurement Manager');
insert into public.rfqs (id, company_id, due_on, due_time) values
  ('d0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', public.today_pkt() + 3, '17:00'),
  ('d0000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e1', null, null);
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net, gst_rate, quoted_lead_time) values
  ('d1000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', 0, 'Item one', 2, 100, 18, '2 weeks'),
  ('d1000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-0000000000e1', 1, 'Item two', 1, null, 18, null),
  ('d1000000-0000-4000-8000-0000000000e3', 'd0000000-0000-4000-8000-0000000000e1', 2, 'Item three', 3, 50.5, 0, null),
  ('d1000000-0000-4000-8000-0000000000e4', 'd0000000-0000-4000-8000-0000000000e2', 0, 'Other RFQ item', 1, 10, 18, null),
  ('d1000000-0000-4000-8000-0000000000e5', 'd0000000-0000-4000-8000-0000000000e2', 1, 'Item to delete', 1, 10, 18, null);
insert into public.clarifications (id, rfq_id, question, rfq_item_id) values
  ('d2000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e2', 'Which thread?', 'd1000000-0000-4000-8000-0000000000e5');

select is((select city from public.companies where id = 'c0000000-0000-4000-8000-0000000000e1'), 'Faisalabad', 'a city is stored');
select is((select job_title from public.contacts where id = 'c2000000-0000-4000-8000-0000000000e1'), 'Procurement Manager', 'a contact job title is stored');
select is((select due_time from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000e1'), '17:00'::time, 'a bid deadline time is stored');
select is((select due_time from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000e2'), null::time, 'the time is optional');

delete from public.rfq_items where id = 'd1000000-0000-4000-8000-0000000000e5';
select is((select count(*)::int from public.clarifications where id = 'd2000000-0000-4000-8000-0000000000e1'), 1,
  'deleting the item keeps the question');
select is((select rfq_item_id from public.clarifications where id = 'd2000000-0000-4000-8000-0000000000e1'), null::uuid,
  'and the question no longer points at an item (SET NULL)');

-- ------------------------------------------------------------------ users.phone: own row or admin, nothing else on users
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update public.users set phone = '+92 300 1111111' where id = 'a0000000-0000-4000-8000-000000000002';
select is((select phone from public.users where id = 'a0000000-0000-4000-8000-000000000002'), '+92 300 1111111', 'sales changes their own phone');
update public.users set phone = '+92 300 9999999' where id = 'a0000000-0000-4000-8000-000000000003';
select is((select phone from public.users where id = 'a0000000-0000-4000-8000-000000000003'), null::text, 'sales cannot change another person''s phone');
select throws_ok($$update public.users set name = 'x' where id = 'a0000000-0000-4000-8000-000000000002'$$, '42501', null,
  'no other users column became writable');
select throws_ok($$update public.users set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000002'$$, '42501', null,
  'a person cannot change their own role');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.users set phone = '+92 300 2222222' where id = 'a0000000-0000-4000-8000-000000000003';
select is((select phone from public.users where id = 'a0000000-0000-4000-8000-000000000003'), '+92 300 2222222', 'admin changes anyone''s phone');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
update public.users set phone = '+92 300 3333333' where id = 'a0000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.users where phone = '+92 300 3333333'), 0, 'a deactivated user changes nothing');

-- ------------------------------------------------------------------ issue_quotation with an item subset
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1')$$,
  '22023', 'a quoted price is needed for: Item two', 'no subset: every item needs a price, as before');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', null, null, null, null, null, '{}')$$,
  '22023', 'the RFQ has no items to quote', 'an empty subset is refused');
select throws_ok($$select public.issue_quotation('51000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', null, null, null, null, null, array['d1000000-0000-4000-8000-0000000000e4']::uuid[])$$,
  '22023', 'an item to quote does not belong to this RFQ', 'an item of another RFQ is refused');

select is(public.issue_quotation('51000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', null, null, null, null, null,
          array['d1000000-0000-4000-8000-0000000000e3', 'd1000000-0000-4000-8000-0000000000e1']::uuid[]),
  '51000000-0000-4000-8000-0000000000e1'::uuid, 'a subset without the unpriced item issues');
select is((select jsonb_array_length(lines) from public.quotations where id = '51000000-0000-4000-8000-0000000000e1'), 2,
  'only the included items are in the snapshot');
select is((select array_agg(e ->> 'description' order by e ->> 'description') from public.quotations q, jsonb_array_elements(q.lines) e
           where q.id = '51000000-0000-4000-8000-0000000000e1'), array['Item one', 'Item three'], 'the snapshot holds items one and three');
select is((select net_total from public.quotations where id = '51000000-0000-4000-8000-0000000000e1'), 351.5::numeric,
  'the totals are those of the included items (2 x 100 + 3 x 50.50)');

-- Without the argument, every item is included once all are priced (behaviour unchanged).
reset role;
update public.rfq_items set quoted_unit_price_net = 20 where id = 'd1000000-0000-4000-8000-0000000000e2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.issue_quotation('51000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-0000000000e1');
select is((select jsonb_array_length(lines) from public.quotations where id = '51000000-0000-4000-8000-0000000000e2'), 3,
  'omitting the subset snapshots every item, as before');
select is((select revision from public.quotations where id = '51000000-0000-4000-8000-0000000000e2'), 1::smallint,
  'the second issue is a re-issue (R1, same number)');

reset role;
select * from finish();
rollback;
