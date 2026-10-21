begin;
select plan(8);

-- HW-17 / HW-45: public.check_session(), PostgREST's pre-request hook.
-- Fixture users come from supabase/seed.sql: admin a0..01, deactivated a0..04.

select ok((select prosecdef and array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.check_session()'::regprocedure),
  'check_session is SECURITY DEFINER with a fixed search_path');
select ok((select array_to_string(rolconfig, ',') like '%pgrst.db_pre_request=public.check_session%' from pg_roles where rolname = 'authenticator'),
  'PostgREST runs it before every request');

-- a live session of the admin
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('5e550000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.check_session()$$, 'a token of a live session passes');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000999"}', true);
select throws_ok($$select public.check_session()$$, 'PT401', 'Your session has ended. Sign in again.',
  'a token whose session was ended (reset password, deactivate, sign-out) is refused');

delete from auth.sessions where id = '5e550000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.check_session()$$, 'PT401', NULL, 'the same token is refused once its session row is gone');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.check_session()$$, 'PT401', 'This account has been deactivated.', 'a deactivated person is refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select public.check_session()$$, 'a token without a session_id claim is left alone');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$select public.check_session()$$, 'the service role is left alone');

select * from finish();
rollback;
