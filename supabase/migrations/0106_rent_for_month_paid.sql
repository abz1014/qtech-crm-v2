-- 0106_rent_for_month_paid (owner decision, 2026-10-27). EXPAND-ONLY: one data re-file, no table, column, function, grant or policy change.
--
-- 0087's for-month rule files a monthly bill paid on day 1 to 10 under LAST month (expenses.period). Rent is the exception: the owner
-- pays it in advance, at the start of its own month (due by the 20th), so Rent is always for the month it is paid in. The app now
-- writes period = month paid for Rent (src/features/money/expenses/forMonth.ts, RENT_CATEGORY_ID); this re-files what the old rule
-- already stored: Rent expenses paid on day 1 to 10 whose period is the month BEFORE the one paid in.
--
-- Same safety conditions as 0087: only when both the month paid in and the month it was filed under are open (a closed month's
-- numbers are frozen and the lock would refuse the change anyway), and never into a month the same template already holds
-- (expenses_recurring_period_key is unique on recurring_id, period).
update public.expenses e
set period = to_char(e.paid_on, 'YYYY-MM')
where e.category_id = 'ca7e0000-0000-4000-8000-000000000002'   -- Rent
  and extract(day from e.paid_on) <= 10
  and e.period = to_char(date_trunc('month', e.paid_on) - interval '1 month', 'YYYY-MM')
  and not public.month_is_closed(e.paid_on)
  and not public.month_is_closed((e.paid_on - interval '1 month')::date)
  and (e.recurring_id is null
       or not exists (
         select 1 from public.expenses x
         where x.recurring_id = e.recurring_id
           and x.period = to_char(e.paid_on, 'YYYY-MM')));
