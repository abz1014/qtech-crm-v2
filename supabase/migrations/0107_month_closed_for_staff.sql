-- 0107_month_closed_for_staff (EXPAND-ONLY: one new read-only function, no table, column, policy or grant change on anything that exists).
--
-- closed_months is readable by admins only (0027), so the Invoice screen could not tell a salesperson that an invoice sits in a
-- closed month: sales were offered an edit the month lock then refused. This answers just that one yes/no for any signed-in staff.
-- It reveals nothing beyond what the lock's own refusal message already says ("September 2026 is closed").
create function public.month_closed(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then false else public.month_is_closed(d) end
$$;

revoke all on function public.month_closed(date) from public, anon;
grant execute on function public.month_closed(date) to authenticated;

comment on function public.month_closed(date) is
  '0107: true when the month of d is closed. For the Invoice screen, where sales cannot read closed_months. Signed-in staff only.';
