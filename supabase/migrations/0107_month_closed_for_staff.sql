-- 0107_month_closed_for_staff (EXPAND-ONLY: one new read-only function, no table, column, policy or grant change on anything that exists).
--
-- closed_months is readable by admins only (0027), so the Invoice screen could not tell a salesperson that an invoice sits in a
-- closed month: sales were offered an edit the month lock then refused. This answers just that one yes/no for any signed-in staff.
-- It reveals nothing beyond what the lock's own refusal message already says ("September 2026 is closed").
create function public.month_closed(d date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() is null then
    raise exception 'Your session has ended. Sign in again.' using errcode = '42501';
  end if;
  return public.month_is_closed(d);
end
$$;

revoke all on function public.month_closed(date) from public, anon;
grant execute on function public.month_closed(date) to authenticated, qtech_engineer;

comment on function public.month_closed(date) is
  '0107: true when the month of d is closed. For the Invoice screen, where sales cannot read closed_months. Signed-in staff only.';
