begin;
select plan(24);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- Structure
select columns_are('public', 'users',
  array['id', 'name', 'role', 'deactivated_at', 'created_at', 'job_title'],
  'users has exactly the section 2.1 columns');
select ok((select relrowsecurity from pg_class where oid = 'public.users'::regclass), 'RLS is enabled on users');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'users'),
  array['users_select_active_staff'], 'users has only the SELECT policy');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.users'::regclass and contype = 'f'
                    and confrelid = 'auth.users'::regclass and confdeltype = 'r'),
  'users.id references auth.users ON DELETE RESTRICT');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'boss')$$,
  '23514', null, 'role CHECK rejects values outside admin/sales/engineer');

-- Grants
select ok(not (has_table_privilege('anon', 'public.users', 'SELECT')
            or has_table_privilege('anon', 'public.users', 'INSERT')
            or has_table_privilege('anon', 'public.users', 'UPDATE')
            or has_table_privilege('anon', 'public.users', 'DELETE')),
  'anon has no privileges on users');
select ok(has_table_privilege('authenticated', 'public.users', 'SELECT'), 'authenticated can SELECT users');
select ok(not (has_table_privilege('authenticated', 'public.users', 'INSERT')
            or has_table_privilege('authenticated', 'public.users', 'UPDATE')
            or has_table_privilege('authenticated', 'public.users', 'DELETE')
            or has_table_privilege('authenticated', 'public.users', 'TRUNCATE')),
  'authenticated has no write privileges on users');

-- Active roles: read all four fixture rows, write nothing
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.users where id::text like 'a0000000-0000-4000-8000-00000000000%'), 4,
  'admin reads the users');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'sales')$$,
  '42501', null, 'admin cannot insert');
select throws_ok($$update public.users set name = 'x' where id = 'a0000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'admin cannot update');
select throws_ok($$delete from public.users where id = 'a0000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'admin cannot delete');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.users where id::text like 'a0000000-0000-4000-8000-00000000000%'), 4,
  'sales reads the users');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'sales')$$,
  '42501', null, 'sales cannot insert');
select throws_ok($$update public.users set name = 'x' where id = 'a0000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'sales cannot update');
select throws_ok($$delete from public.users where id = 'a0000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'sales cannot delete');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.users where id::text like 'a0000000-0000-4000-8000-00000000000%'), 4,
  'engineer reads the users');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'sales')$$,
  '42501', null, 'engineer cannot insert');
select throws_ok($$update public.users set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501', null, 'engineer cannot promote themselves');
select throws_ok($$delete from public.users where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501', null, 'engineer cannot delete');

-- Deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.users), 0, 'deactivated user sees no users');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'sales')$$,
  '42501', null, 'deactivated user cannot insert');

-- Anon
reset role;
set local role anon;
select throws_ok($$select * from public.users$$, '42501', null, 'anon cannot read users');
select throws_ok($$insert into public.users (id, name, role) values (gen_random_uuid(), 'x', 'sales')$$,
  '42501', null, 'anon cannot insert');
reset role;

select * from finish();
rollback;
