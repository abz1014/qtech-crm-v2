-- 0029_admin_users_support (A01): two helpers for the admin-users Edge Function.
--
-- 1. revoke_user_sessions: deactivate must end the person's sessions. The Auth admin API can only
--    sign out a session by its JWT (which the function does not have), so the service role calls
--    this instead. It deletes the user's auth.sessions rows; refresh tokens cascade.
-- 2. guard_last_admin: a database backstop for the "always keep one active admin" rule. The
--    function checks first (clear 409 message); this trigger holds even if two admins race, or if a
--    script writes to users directly.

create function public.revoke_user_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

create function public.guard_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.deactivated_at is null
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.deactivated_at is not null) then
    -- Lock the other active admins so two concurrent demotions cannot both pass.
    perform 1 from public.users u
    where u.role = 'admin' and u.deactivated_at is null and u.id <> old.id
    for update;
    if not found then
      raise exception 'the system must keep at least one active admin' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_last_admin() from public, anon, authenticated;

create trigger users_keep_one_admin
  before update or delete on public.users
  for each row execute function public.guard_last_admin();
