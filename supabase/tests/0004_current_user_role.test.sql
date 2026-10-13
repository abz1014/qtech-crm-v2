begin;
select plan(14);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

select ok((select prosecdef from pg_proc where oid = 'public.current_user_role()'::regprocedure),
  'current_user_role is SECURITY DEFINER');
select is((select provolatile from pg_proc where oid = 'public.current_user_role()'::regprocedure), 's',
  'current_user_role is STABLE');
select ok((select array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.current_user_role()'::regprocedure),
  'current_user_role has a fixed search_path');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = 'public.current_user_role()'::regprocedure and a.grantee = 0),
  'execute is not granted to PUBLIC');
select ok(not has_function_privilege('anon', 'public.current_user_role()', 'execute'), 'anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.current_user_role()', 'execute'), 'authenticated can execute');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.current_user_role(), 'admin', 'admin fixture resolves to admin');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.current_user_role(), 'sales', 'sales fixture resolves to sales');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.current_user_role(), 'engineer', 'engineer fixture resolves to engineer');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(public.current_user_role(), null::text, 'deactivated user resolves to NULL');

select set_config('request.jwt.claims', '{"sub":"deadbeef-0000-4000-8000-000000000000","role":"authenticated"}', true);
select is(public.current_user_role(), null::text, 'unknown uid resolves to NULL');

select set_config('request.jwt.claims', '', true);
select is(public.current_user_role(), null::text, 'no claims (no auth.uid()) resolves to NULL');

reset role;
set local role anon;
select throws_ok($$select public.current_user_role()$$, '42501', null, 'anon is denied');
reset role;

-- Deactivating an active user flips the result to NULL.
update public.users set deactivated_at = now() where id = 'a0000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.current_user_role(), null::text, 'sales becomes NULL once deactivated_at is set');

select * from finish();
rollback;
