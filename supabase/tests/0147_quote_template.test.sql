begin;
select * from no_plan();

-- 0147 (quote template): customer quote codes and the QTS-<code>-<number> running number.
-- Fixture users from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Ids: companies c9470000-..-N, RFQs d9470000-..-N,
-- items d9471000-..-N, quotations e9470000-..-N. Every name is invented.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ the columns
select has_column('public', 'companies', 'quote_code', 'companies.quote_code exists');
select has_column('public', 'quotations', 'quote_code', 'quotations.quote_code exists');
select has_column('public', 'company_profile', 'quote_next_number', 'company_profile.quote_next_number exists');
select is((select quote_next_number from public.company_profile where id = 1), 4810, 'the running number starts at 4810');
select ok((select quotation_warranty like 'One year warranty against any manufacturing defects%' and quotation_closing like 'We hope that the above specification%'
           from public.company_profile where id = 1), 'the warranty and closing paragraphs have the template wording');
select ok((select sales_email is null and sales_phone is null from public.company_profile where id = 1), 'the sales email and cell start empty');

insert into public.companies (id, name, quote_code) values
  ('c9470000-0000-4000-8000-000000000001', 'Tasman Quarry Allied', ' tqa '),
  ('c9470000-0000-4000-8000-000000000002', 'Tasman Quarry Brothers', 'TQB'),
  ('c9470000-0000-4000-8000-000000000003', 'Codeless Customer', null);
select is((select quote_code from public.companies where id = 'c9470000-0000-4000-8000-000000000001'), 'TQA', 'a code is stored trimmed and in capitals');
select throws_ok($$insert into public.companies (name, quote_code) values ('Another Tasman', 'TQA')$$, '23505', null, 'two customers cannot share a code');
select throws_ok($$update public.companies set quote_code = 'T' where id = 'c9470000-0000-4000-8000-000000000003'$$, '23514', null, 'a code has 2 to 6 letters');
select throws_ok($$update public.companies set quote_code = 'TQ1' where id = 'c9470000-0000-4000-8000-000000000003'$$, '23514', null, 'and letters only');
select lives_ok($$update public.companies set quote_code = '' where id = 'c9470000-0000-4000-8000-000000000003'$$, 'an empty code is stored as none');
select is((select quote_code from public.companies where id = 'c9470000-0000-4000-8000-000000000003'), null, 'none');

insert into public.rfqs (id, company_id, owner_id) values
  ('d9470000-0000-4000-8000-000000000001', 'c9470000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d9470000-0000-4000-8000-000000000002', 'c9470000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002'),
  ('d9470000-0000-4000-8000-000000000003', 'c9470000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002'),
  ('d9470000-0000-4000-8000-000000000004', 'c9470000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d9470000-0000-4000-8000-000000000005', 'c9470000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty, unit, gst_rate) values
  ('d9471000-0000-4000-8000-000000000001', 'd9470000-0000-4000-8000-000000000001', 0, 'Quote template valve', 2, 'pcs', 18),
  ('d9471000-0000-4000-8000-000000000002', 'd9470000-0000-4000-8000-000000000002', 0, 'Quote template sensor', 1, 'pcs', 18),
  ('d9471000-0000-4000-8000-000000000003', 'd9470000-0000-4000-8000-000000000003', 0, 'Quote template relay', 1, 'pcs', 18),
  ('d9471000-0000-4000-8000-000000000004', 'd9470000-0000-4000-8000-000000000004', 0, 'Quote template cable', 3, 'm', 18),
  ('d9471000-0000-4000-8000-000000000005', 'd9470000-0000-4000-8000-000000000005', 0, 'Quote template gland', 4, 'pcs', 18);

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'issue_quotation'), 1, 'still one issue_quotation');
select ok(has_function_privilege('authenticated', 'public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb)', 'execute')
      and not has_function_privilege('qtech_engineer', 'public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb)', 'execute'),
  'same grants: authenticated issues, anon and an engineer do not');
select ok(has_column_privilege('qtech_engineer', 'public.quotations', 'quote_code', 'select')
      and has_column_privilege('qtech_engineer', 'public.company_profile', 'quote_next_number', 'select')
      and has_column_privilege('qtech_engineer', 'public.company_profile', 'sales_email', 'select'),
  'an engineer reads the new columns like the other non-money ones');

-- ------------------------------------------------------------------ issuing, as sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.issue_quotation('e9470000-0000-4000-8000-000000000001', 'd9470000-0000-4000-8000-000000000001',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000001","unit_price":1000}]'::jsonb),
  'e9470000-0000-4000-8000-000000000001'::uuid, 'a first issue for a customer with a code');
select is((select quote_code || '-' || number || ' R' || revision from public.quotations where id = 'e9470000-0000-4000-8000-000000000001'),
  'TQA-4810 R0', 'takes the code and the first running number, 4810');

select lives_ok($$select public.issue_quotation('e9470000-0000-4000-8000-000000000002', 'd9470000-0000-4000-8000-000000000002',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000002","unit_price":500}]'::jsonb)$$, 'another customer');
select is((select quote_code || '-' || number from public.quotations where id = 'e9470000-0000-4000-8000-000000000002'),
  'TQB-4811', 'one running number across customers: 4811');

select lives_ok($$select public.issue_quotation('e9470000-0000-4000-8000-000000000003', 'd9470000-0000-4000-8000-000000000001',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000001","unit_price":900}]'::jsonb)$$, 'a revision');
select is((select quote_code || '-' || number || ' R' || revision from public.quotations where id = 'e9470000-0000-4000-8000-000000000003'),
  'TQA-4810 R1', 'a revision keeps the code and the number');

select lives_ok($$select public.issue_quotation('e9470000-0000-4000-8000-000000000004', 'd9470000-0000-4000-8000-000000000003',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000003","unit_price":700}]'::jsonb)$$, 'a customer with no code still issues');
select is((select quote_code from public.quotations where id = 'e9470000-0000-4000-8000-000000000004'), null,
  'with the old numbering and no code');

-- the admin sets the next number in the company profile
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.company_profile set quote_next_number = 5000 where id = 1;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.issue_quotation('e9470000-0000-4000-8000-000000000005', 'd9470000-0000-4000-8000-000000000004',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000004","unit_price":300}]'::jsonb)$$, 'after the admin moved the next number on');
select is((select number from public.quotations where id = 'e9470000-0000-4000-8000-000000000005'), 5000, 'the next quotation takes it');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.company_profile set quote_next_number = 4800 where id = 1;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.issue_quotation('e9470000-0000-4000-8000-000000000006', 'd9470000-0000-4000-8000-000000000005',
            p_lines => '[{"id":"d9471000-0000-4000-8000-000000000005","unit_price":200}]'::jsonb)$$, 'after the next number was set below a used one');
select is((select number from public.quotations where id = 'e9470000-0000-4000-8000-000000000006'), 5001, 'a used number is never taken again');

-- a sales person may set a code, the sales person cannot change the profile (admin only, as before)
select lives_ok($$update public.companies set quote_code = 'CCX' where id = 'c9470000-0000-4000-8000-000000000003'$$, 'sales sets a code');
select is((select quote_code from public.companies where id = 'c9470000-0000-4000-8000-000000000003'), 'CCX', 'it is saved');

-- ------------------------------------------------------------------ an engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$update public.companies set quote_code = 'ENG' where id = 'c9470000-0000-4000-8000-000000000003'$$, '42501',
  'a quote code is set by admin and sales only', 'an engineer cannot set or change a code');
select lives_ok($$update public.companies set notes = 'engineer note' where id = 'c9470000-0000-4000-8000-000000000003'$$, 'but still edits the rest of the company');
reset role;

-- ------------------------------------------------------------------ old and new numbers never collide
select lives_ok($$insert into public.quotations (id, rfq_id, number, revision, valid_until, lines)
                  values ('e9470000-0000-4000-8000-000000000009', 'd9470000-0000-4000-8000-000000000002', 4810, 5, current_date,
                          '[{"rfq_item_id":"d9471000-0000-4000-8000-000000000002","description":"x","qty":1,"unit":null,"unit_price_net":1,"gst_rate":18,"lead_time":null}]')$$,
  'an old-style number may equal a QTS number');
select throws_ok($$insert into public.quotations (id, rfq_id, number, revision, quote_code, valid_until, lines)
                  values ('e9470000-0000-4000-8000-00000000000a', 'd9470000-0000-4000-8000-000000000003', 4811, 0, 'CCX', current_date,
                          '[{"rfq_item_id":"d9471000-0000-4000-8000-000000000003","description":"x","qty":1,"unit":null,"unit_price_net":1,"gst_rate":18,"lead_time":null}]')$$,
  '23505', null, 'but two QTS quotations cannot share a number and revision');

select * from finish();
rollback;
