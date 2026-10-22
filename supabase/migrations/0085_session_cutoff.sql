-- 0085_session_cutoff (HW-17, HW-45): "signed out on every device" holds at once, not when the access token expires.
--
-- An access token is a signed JWT: PostgREST checks its signature and expiry, nothing else, so a session ended by Reset
-- password or Deactivate (admin-users deletes the person's auth.sessions rows; their refresh tokens cascade) kept reading
-- data on the access token it already held, for up to an hour. Deactivate already emptied every read through
-- current_user_role(), but the person's tab got empty lists, not a refusal, and stayed in the app shell.
--
-- PostgREST's db-pre-request (qtech_private.pre_request, 0081) now first runs qtech_guard.check_session(): a signed-in
-- request (role authenticated) whose token names a session that no longer exists is refused with HTTP 401 (SQLSTATE PT401;
-- detail account_deactivated when the account is deactivated, else session_ended). The app reads it to sign out and wipe
-- the device (src/app/AuthProvider.tsx, src/lib/supabase.ts). Tokens without a session_id claim, live sessions, the anon key
-- and the service role are untouched. One primary-key lookup per request.
--
-- check_session must read auth.sessions, so it is SECURITY DEFINER; it lives in its own schema (not exposed by the API,
-- not public, and not qtech_private, which holds no definer by rule: 0081's test) and takes no input but the caller's claims.

create schema if not exists qtech_guard;
revoke all on schema qtech_guard from public;
grant usage on schema qtech_guard to anon, authenticated, service_role, qtech_engineer;

create function qtech_guard.check_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  sid uuid;
begin
  if claims is null or claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  sid := nullif(claims ->> 'session_id', '')::uuid;
  if sid is null or exists (select 1 from auth.sessions s where s.id = sid) then
    return;
  end if;
  -- The session is gone. Say why when it is a deactivation: the app tells the person their account was deactivated.
  if exists (select 1 from public.users u where u.id = nullif(claims ->> 'sub', '')::uuid and u.deactivated_at is not null) then
    raise exception 'This account has been deactivated.'
      using errcode = 'PT401', detail = 'account_deactivated', hint = 'Ask an admin to reactivate the account.';
  end if;
  raise exception 'Your session has ended. Sign in again.'
    using errcode = 'PT401', detail = 'session_ended', hint = 'The session was signed out, or the password was reset.';
end;
$$;

revoke all on function qtech_guard.check_session() from public;
grant execute on function qtech_guard.check_session() to anon, authenticated, service_role, qtech_engineer;
comment on function qtech_guard.check_session() is
  'HW-17/HW-45 (0085): run by qtech_private.pre_request. Refuses a token whose session was ended (reset password, deactivate, sign-out).';

-- 0081's pre-request, with the session check first. Same name, so the authenticator setting is unchanged.
create or replace function qtech_private.pre_request()
returns void
language plpgsql
security invoker
as $$
begin
  perform qtech_guard.check_session();
  -- Nested, not AND: only authenticated may run current_user_role() (anon and service_role have no execute on it).
  if current_user = 'authenticated' then
    if (select public.current_user_role()) = 'engineer' then
      perform pg_catalog.set_config('role', 'qtech_engineer', true);
    end if;
  end if;
end;
$$;
comment on function qtech_private.pre_request() is
  '0081 + 0085: PostgREST db-pre-request. A token of an ended session is refused (qtech_guard.check_session); an engineer''s request runs as qtech_engineer (no prices); everyone else is untouched.';

notify pgrst, 'reload config';
