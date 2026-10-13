-- 0004_current_user_role (S01, part 2): sits after 0003 because a LANGUAGE sql body is
-- validated at CREATE time and must find public.users. The audit_log policy in 0005
-- also needs this function, so audit_log comes after it.
--
-- SECURITY DEFINER so the lookup bypasses RLS on users; otherwise the users SELECT
-- policy, which calls this function, would recurse into itself.

create function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.deactivated_at is null
$$;

revoke all on function public.current_user_role() from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated;

-- Section 10: users are readable by every active staff member; deactivated or unknown callers see nothing.
create policy users_select_active_staff on public.users
  for select to authenticated
  using (public.current_user_role() is not null);
