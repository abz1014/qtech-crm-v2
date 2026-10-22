-- 0086_session_cutoff (HW-17, HW-45): "signed out on every device" holds at once, not when the access token expires.
--
-- An access token is a signed JWT: PostgREST checks its signature and expiry, nothing else, so a session ended by Reset
-- password or Deactivate (admin-users deletes the person's auth.sessions rows; their refresh tokens cascade) kept reading
-- data on the access token it already held, for up to an hour. Deactivate already emptied every read through
-- current_user_role(), but the person's tab got empty lists, not a refusal, and stayed in the app shell.
--
-- PostgREST's pre-request hook runs this before every API request. For a signed-in person (role authenticated) whose
-- token names a session that no longer exists, or whose account is deactivated, it refuses the request with HTTP 401
-- (SQLSTATE PT401; detail session_ended or account_deactivated), which the app reads to sign out and wipe the device
-- (src/app/AuthProvider.tsx, src/lib/supabase.ts). Tokens without
-- a session_id claim, the anon key and the service role are left alone. One primary-key lookup per request.

create or replace function public.check_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  sid uuid;
  uid uuid;
begin
  if claims is null or claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  uid := nullif(claims ->> 'sub', '')::uuid;
  sid := nullif(claims ->> 'session_id', '')::uuid;
  -- deactivated first: Deactivate also ends the sessions, and the app tells a deactivated person why they were signed out
  if uid is not null and exists (select 1 from public.users u where u.id = uid and u.deactivated_at is not null) then
    raise exception 'This account has been deactivated.'
      using errcode = 'PT401', detail = 'account_deactivated', hint = 'Ask an admin to reactivate the account.';
  end if;
  if sid is not null and not exists (select 1 from auth.sessions s where s.id = sid) then
    raise exception 'Your session has ended. Sign in again.'
      using errcode = 'PT401', detail = 'session_ended', hint = 'The session was signed out, or the password was reset.';
  end if;
end;
$$;

revoke all on function public.check_session() from public;
grant execute on function public.check_session() to anon, authenticated, service_role;

comment on function public.check_session() is
  'PostgREST db-pre-request hook (HW-17/HW-45): refuses a token whose session was ended (reset password, deactivate, global sign-out) or whose account is deactivated.';

alter role authenticator set pgrst.db_pre_request = 'public.check_session';
notify pgrst, 'reload config';
