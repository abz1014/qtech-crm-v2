begin;
select * from no_plan();

-- 0072: the buyer's tax details on companies (NTN or CNIC, STRN, registered or not, address for invoices). Optional columns,
-- covered by the companies row policies and audit trigger. Fixture users come from supabase/seed.sql:
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ structure
select has_column('public', 'companies', 'ntn', 'companies.ntn exists');
select has_column('public', 'companies', 'strn', 'companies.strn exists');
select has_column('public', 'companies', 'sales_tax_registered', 'companies.sales_tax_registered exists');
select has_column('public', 'companies', 'invoice_address', 'companies.invoice_address exists');
select col_type_is('public', 'companies', 'ntn', 'text', 'ntn is text');
select col_type_is('public', 'companies', 'strn', 'text', 'strn is text');
select col_type_is('public', 'companies', 'sales_tax_registered', 'boolean', 'sales_tax_registered is boolean');
select col_type_is('public', 'companies', 'invoice_address', 'text', 'invoice_address is text');
select col_is_null('public', 'companies', 'ntn', 'ntn is optional');
select col_is_null('public', 'companies', 'strn', 'strn is optional');
select col_is_null('public', 'companies', 'sales_tax_registered', 'sales_tax_registered is optional (NULL = not known yet)');
select col_is_null('public', 'companies', 'invoice_address', 'invoice_address is optional');
select col_hasnt_default('public', 'companies', 'sales_tax_registered', 'sales_tax_registered has no default: unknown until someone says');

-- the companies policies are unchanged (the columns ride on them)
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'companies'),
  array['companies_delete_admin', 'companies_insert_staff', 'companies_select_staff', 'companies_update_staff'],
  'companies keeps exactly its four policies');

-- ------------------------------------------------------------------ fixtures (as owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('72000000-0000-4000-8000-000000000001', '0072 Registered Buyer'),
  ('72000000-0000-4000-8000-000000000002', '0072 Second Buyer');

select is((select row(ntn, strn, sales_tax_registered, invoice_address)::text from public.companies where id = '72000000-0000-4000-8000-000000000001'),
  '(,,,)', 'a new company has no tax details: nothing is required');

-- ------------------------------------------------------------------ CHECKs
select lives_ok($$update public.companies set ntn = '1234567-8', strn = '17-00-3764-001-19', sales_tax_registered = true,
                    invoice_address = 'Plot 12, SITE, Karachi' where id = '72000000-0000-4000-8000-000000000001'$$,
  'an NTN and an STRN as on the certificate are accepted');
select lives_ok($$update public.companies set ntn = '35202 1234567 1' where id = '72000000-0000-4000-8000-000000000002'$$,
  'a CNIC with spaces is accepted');
select throws_ok($$update public.companies set ntn = '' where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'an empty NTN is refused (absent means NULL)');
select throws_ok($$update public.companies set ntn = 'N/A' where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'an NTN that is not a number is refused');
select throws_ok($$update public.companies set strn = '  ' where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a blank STRN is refused');
select throws_ok($$update public.companies set strn = 'STRN 1700' where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'an STRN with words in it is refused');
select throws_ok($$update public.companies set invoice_address = '   ' where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'a blank invoice address is refused');
select throws_ok($$update public.companies set invoice_address = repeat('x', 501) where id = '72000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'an invoice address over 500 characters is refused');

-- ------------------------------------------------------------------ row security, as each role
set local role authenticated;

-- sales: reads and writes the tax details (as every active role writes a company's name)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select strn from public.companies where id = '72000000-0000-4000-8000-000000000001'), '17-00-3764-001-19', 'sales reads the STRN');
update public.companies set sales_tax_registered = false where id = '72000000-0000-4000-8000-000000000002';
select is((select sales_tax_registered from public.companies where id = '72000000-0000-4000-8000-000000000002'), false, 'sales can mark a buyer not registered');

-- engineer: the same rights as on the rest of the company row
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
update public.companies set invoice_address = 'Head office, Lahore' where id = '72000000-0000-4000-8000-000000000002';
select is((select invoice_address from public.companies where id = '72000000-0000-4000-8000-000000000002'), 'Head office, Lahore', 'an engineer can fill in the invoice address');

-- deactivated: sees nothing and changes nothing
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.companies where id::text like '72000000%'), 0, 'a deactivated user reads no company');
update public.companies set ntn = '7654321-0' where id = '72000000-0000-4000-8000-000000000002';

reset role;
select is((select ntn from public.companies where id = '72000000-0000-4000-8000-000000000002'), '35202 1234567 1', 'the deactivated user''s update changed nothing');

-- anon: no privilege on companies at all (0006), so none on the new columns
select ok(not has_column_privilege('anon', 'public.companies', 'ntn', 'select'), 'anon cannot read the NTN');
select ok(not has_column_privilege('anon', 'public.companies', 'strn', 'update'), 'anon cannot write the STRN');

-- ------------------------------------------------------------------ audit (0013 covers the whole row)
select ok((select new_value ->> 'sales_tax_registered' = 'false' and old_value ->> 'sales_tax_registered' is null
           from public.audit_log where table_name = 'companies' and record_id = '72000000-0000-4000-8000-000000000002'
             and action = 'update' and changed_by = 'a0000000-0000-4000-8000-000000000002'),
  'a change of the registered status is in the audit log with its author');

select * from finish();
rollback;
