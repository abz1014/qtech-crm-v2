begin;
select plan(74);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- ------------------------------------------------------------------ structure
select columns_are('public', 'companies',
  array['id', 'created_at', 'created_by', 'updated_at', 'name', 'country', 'notes', 'legacy_flags', 'legacy_source', 'city'],
  'companies has the section 2.2 columns (city from A7, 0039)');
select columns_are('public', 'company_sites',
  array['id', 'created_at', 'created_by', 'company_id', 'name', 'address'],
  'company_sites has the section 2.3 columns');
select columns_are('public', 'contacts',
  array['id', 'created_at', 'created_by', 'company_id', 'site_id', 'name', 'phone', 'email', 'notes', 'job_title'],
  'contacts has the section 2.4 columns (job_title from A7, 0039)');
select columns_are('public', 'brands',
  array['id', 'created_at', 'created_by', 'name', 'kind'],
  'brands has the section 2.5 columns');
select columns_are('public', 'company_brands',
  array['company_id', 'brand_id', 'created_at', 'created_by'],
  'company_brands has the section 2.6 columns');

select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.companies'::regclass, 'public.company_sites'::regclass, 'public.contacts'::regclass,
                         'public.brands'::regclass, 'public.company_brands'::regclass)),
  'RLS is enabled on all five tables');

select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'companies'),
  array['companies_delete_admin', 'companies_insert_staff', 'companies_select_staff', 'companies_update_staff'],
  'companies policies');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'brands'),
  array['brands_delete_admin', 'brands_insert_staff', 'brands_select_staff', 'brands_update_staff'],
  'brands policies');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename in ('company_sites', 'contacts', 'company_brands')), 12,
  'company_sites, contacts and company_brands have four policies each');

select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in (select ('public.' || t)::regclass from unnest(array['companies', 'company_sites', 'contacts', 'brands', 'company_brands']) t)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the S03 tables');

select ok(exists (select 1 from pg_trigger where tgrelid = 'public.companies'::regclass
                    and tgname = 'companies_set_updated_at' and not tgisinternal),
  'companies has the updated_at trigger');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.company_sites'::regclass and contype = 'f'
                    and confrelid = 'public.companies'::regclass and confdeltype = 'c'),
  'company_sites cascades from companies');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.contacts'::regclass and contype = 'f'
                    and confrelid = 'public.company_sites'::regclass and confdeltype = 'n'),
  'contacts.site_id is SET NULL');

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ constraints (as owner)
insert into public.companies (id, name, updated_at)
  values ('c0000000-0000-4000-8000-000000000001', 'Acme Ltd', '2020-01-01 00:00:00+00');
insert into public.company_sites (id, company_id, name)
  values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Karachi');
insert into public.contacts (id, company_id, name)
  values ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Name Only');
insert into public.brands (id, name) values ('c3000000-0000-4000-8000-000000000001', 'Belimo');
insert into public.company_brands (company_id, brand_id)
  values ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001');

select throws_ok($$insert into public.companies (name) values ('ACME LTD')$$,
  '23505', null, 'case-insensitive duplicate company name is rejected');
select throws_ok($$insert into public.companies (name) values ('  acme ltd ')$$,
  '23505', null, 'duplicate company name differing only by padding is rejected');
select lives_ok($$insert into public.companies (name) values ('Acme Ltd 2')$$,
  'a different company name is accepted');
select lives_ok($$insert into public.companies (name, country, notes) values ('Bare Co', null, null)$$,
  'only the name is required on a company');
select throws_ok($$insert into public.companies (name) values (null)$$,
  '23502', null, 'company name is required');
select is((select created_by from public.companies where name = 'Bare Co'), null,
  'created_by is NULL when there is no caller (import / owner)');
select throws_ok($$insert into public.company_sites (company_id, name)
                   values ('c0000000-0000-4000-8000-000000000001', 'KARACHI')$$,
  '23505', null, 'case-insensitive duplicate site name per company is rejected');
select lives_ok($$insert into public.company_sites (company_id, name)
                  values ('c0000000-0000-4000-8000-000000000001', 'Lahore')$$,
  'a new site name for the same company is accepted');
select lives_ok($$insert into public.company_sites (company_id, name)
                  select id, 'Karachi' from public.companies where name = 'Acme Ltd 2'$$,
  'the same site name under another company is accepted');
select throws_ok($$insert into public.brands (name) values ('BELIMO')$$,
  '23505', null, 'case-insensitive duplicate brand is rejected');
select is((select kind from public.brands where name = 'Belimo'), 'brand', 'brand kind defaults to brand');
select throws_ok($$insert into public.brands (name, kind) values ('X', 'maker')$$,
  '23514', null, 'brand kind CHECK rejects unknown values');
select lives_ok($$insert into public.brands (name, kind) values ('Flow meters', 'family')$$,
  'a family brand is accepted');
select throws_ok($$insert into public.company_brands (company_id, brand_id)
                    values ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'company_brands primary key rejects a repeat pair');
select ok((select phone is null and email is null and notes is null and site_id is null
           from public.contacts where id = 'c2000000-0000-4000-8000-000000000001'),
  'a contact needs only a name');

update public.companies set notes = 'touched' where id = 'c0000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.companies
           where id = 'c0000000-0000-4000-8000-000000000001'),
  'updated_at is bumped by the trigger');

delete from public.company_sites where id = 'c1000000-0000-4000-8000-000000000001';
insert into public.company_sites (id, company_id, name)
  values ('c1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Plant');
update public.contacts set site_id = 'c1000000-0000-4000-8000-000000000002'
  where id = 'c2000000-0000-4000-8000-000000000001';
delete from public.company_sites where id = 'c1000000-0000-4000-8000-000000000002';
select is((select site_id from public.contacts where id = 'c2000000-0000-4000-8000-000000000001'), null,
  'deleting a site clears contacts.site_id');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.companies where id = 'c0000000-0000-4000-8000-000000000001'), 1,
  'sales reads companies');
select is((select count(*)::int from public.brands where id = 'c3000000-0000-4000-8000-000000000001'), 1,
  'sales reads brands');
select lives_ok($$insert into public.companies (name) values ('Sales Co')$$, 'sales inserts a company');
select is((select created_by from public.companies where name = 'Sales Co'), 'a0000000-0000-4000-8000-000000000002'::uuid,
  'sales inserts a company and created_by defaults to the caller');
select is(public.t_rows($q$update public.companies set country = 'PK' where name = 'Sales Co'$q$), 1, 'sales updates a company');
select is(public.t_rows($q$delete from public.companies where name = 'Sales Co'$q$), 0, 'sales cannot delete a company');
select lives_ok($$insert into public.brands (name) values ('Sales Brand')$$, 'sales inserts a brand');
select is(public.t_rows($q$delete from public.brands where name = 'Sales Brand'$q$), 0, 'sales cannot delete a brand');
select lives_ok($$insert into public.company_sites (company_id, name)
                  values ('c0000000-0000-4000-8000-000000000001', 'Sales Site')$$, 'sales inserts a site');
select is(public.t_rows($q$delete from public.company_sites where name = 'Sales Site'$q$), 1, 'sales deletes a site');
select lives_ok($$insert into public.contacts (company_id, name)
                  values ('c0000000-0000-4000-8000-000000000001', 'Sales Contact')$$, 'sales inserts a contact');
select is(public.t_rows($q$delete from public.contacts where name = 'Sales Contact'$q$), 1, 'sales deletes a contact');
select is(public.t_rows($q$delete from public.company_brands
                      where company_id = 'c0000000-0000-4000-8000-000000000001'$q$), 1, 'sales deletes a company_brands link');
select lives_ok($$insert into public.company_brands (company_id, brand_id)
                  values ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001')$$,
  'sales inserts a company_brands link');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.companies where id = 'c0000000-0000-4000-8000-000000000001'), 1,
  'engineer reads companies');
select lives_ok($$insert into public.companies (name) values ('Engineer Co')$$, 'engineer inserts a company');
select is(public.t_rows($q$update public.companies set country = 'DE' where name = 'Engineer Co'$q$), 1, 'engineer updates a company');
select is(public.t_rows($q$delete from public.companies where name = 'Engineer Co'$q$), 0, 'engineer cannot delete a company');
select lives_ok($$insert into public.brands (name) values ('Engineer Brand')$$, 'engineer inserts a brand');
select is(public.t_rows($q$delete from public.brands where name = 'Engineer Brand'$q$), 0, 'engineer cannot delete a brand');
select lives_ok($$insert into public.company_sites (company_id, name)
                  values ('c0000000-0000-4000-8000-000000000001', 'Eng Site')$$, 'engineer inserts a site');
select lives_ok($$insert into public.contacts (company_id, name)
                  values ('c0000000-0000-4000-8000-000000000001', 'Eng Contact')$$, 'engineer inserts a contact');
select is(public.t_rows($q$delete from public.contacts where name = 'Eng Contact'$q$), 1, 'engineer deletes a contact');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.companies), 0, 'deactivated user sees no companies');
select is((select count(*)::int from public.company_sites), 0, 'deactivated user sees no sites');
select is((select count(*)::int from public.contacts), 0, 'deactivated user sees no contacts');
select is((select count(*)::int from public.brands), 0, 'deactivated user sees no brands');
select is((select count(*)::int from public.company_brands), 0, 'deactivated user sees no company_brands');
select throws_ok($$insert into public.companies (name) values ('Ghost Co')$$,
  '42501', null, 'deactivated user cannot insert a company');
select throws_ok($$insert into public.brands (name) values ('Ghost Brand')$$,
  '42501', null, 'deactivated user cannot insert a brand');
select is(public.t_rows($q$update public.companies set notes = 'x'$q$), 0,
  'deactivated user cannot update a company');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select ok((select count(*)::int from public.companies where name in ('Acme Ltd', 'Sales Co', 'Engineer Co')) >= 2,
  'admin reads everything others wrote');
select lives_ok($$insert into public.companies (name) values ('Admin Co')$$, 'admin inserts a company');
select is(public.t_rows($q$delete from public.companies where name = 'Admin Co'$q$), 1, 'admin deletes a company');
select is(public.t_rows($q$delete from public.companies where name = 'Engineer Co'$q$), 1, 'admin deletes a company created by another user');
select lives_ok($$insert into public.brands (name) values ('Admin Brand')$$, 'admin inserts a brand');
select is(public.t_rows($q$delete from public.brands where name = 'Admin Brand'$q$), 1, 'admin deletes a brand');
select is(public.t_rows($q$delete from public.company_sites where name = 'Eng Site'$q$), 1, 'admin deletes a site');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.companies$$, '42501', null, 'anon cannot read companies');
select throws_ok($$select * from public.company_sites$$, '42501', null, 'anon cannot read company_sites');
select throws_ok($$select * from public.contacts$$, '42501', null, 'anon cannot read contacts');
select throws_ok($$select * from public.brands$$, '42501', null, 'anon cannot read brands');
select throws_ok($$select * from public.company_brands$$, '42501', null, 'anon cannot read company_brands');
select throws_ok($$insert into public.companies (name) values ('Anon Co')$$,
  '42501', null, 'anon cannot insert a company');
reset role;

select * from finish();
rollback;
