begin;
select plan(10);

-- HW-17 / HW-45: qtech_guard.check_session(), run first by qtech_private.pre_request (PostgREST's db-pre-request).
-- Fixture users come from supabase/seed.sql: admin a0..01, deactivated a0..04.

select ok((select prosecdef and array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'qtech_guard.check_session()'::regprocedure),
  'check_session is SECURITY DEFINER with a fixed search_path');
select ok(exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                  where r.rolname = 'authenticator' and 'pgrst.db_pre_request=qtech_private.pre_request' = any (s.setconfig)),
  'the data API still runs qtech_private.pre_request (which calls it) before every request');
select ok(has_function_privilege('anon', 'qtech_guard.check_session()', 'execute')
      and has_function_privilege('authenticated', 'qtech_guard.check_session()', 'execute')
      and has_function_privilege('service_role', 'qtech_guard.check_session()', 'execute'),
  'every API role can run it');

-- live sessions of the admin and of the deactivated fixture
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('5e550000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now(), now());

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select lives_ok($$select qtech_private.pre_request()$$, 'a token of a live session passes the pre-request');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000999"}', true);
set local role authenticated;
select throws_ok($$select qtech_private.pre_request()$$, 'PT401', 'Your session has ended. Sign in again.',
  'a token whose session was ended (reset password, sign-out) is refused by the pre-request');
reset role;

delete from auth.sessions where id = '5e550000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select qtech_guard.check_session()$$, 'PT401', NULL, 'the same token is refused once its session row is gone');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"5e550000-0000-4000-8000-000000000004"}', true);
select throws_ok($$select qtech_guard.check_session()$$, 'PT401', 'This account has been deactivated.',
  'a deactivated person whose sessions were ended is told why');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok($$select qtech_guard.check_session()$$, 'a token without a session_id claim is left alone (current_user_role handles deactivation)');

select set_config('request.jwt.claims', '{"role":"service_role","session_id":"5e550000-0000-4000-8000-000000000999"}', true);
select lives_ok($$select qtech_guard.check_session()$$, 'the service role is left alone');

select set_config('request.jwt.claims', '', true);
set local role anon;
select lives_ok($$select qtech_private.pre_request()$$, 'anon with no claims passes');
reset role;

select * from finish();
rollback;
