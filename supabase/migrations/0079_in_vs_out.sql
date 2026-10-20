-- 0079_in_vs_out (owner request 2026-10-20): "a proper in vs out of every month and every quarter", and fuel per car or
-- the office water bill visible without one category per car.
--
-- Two read-only views, admin only (the same rule as every other money view: rows only when current_user_role() is admin,
-- wrapped in a sub-select as 0074 requires). Nothing is written and no table changes.
--
-- v_month_cash_flow        one row per Karachi calendar month with money in it:
--   money_in         customer payments received in the month (received_on), GROSS: GST inside the payment included.
--                    Voided payments (0073) are left out.
--   payments_count   how many payments that is.
--   money_out        every expense paid in the month (paid_on), GROSS: input tax included, every category, so supplier
--                    payments, freight and clearing, overheads, and the not-in-P&L ones (owner drawings, loan repayment) too.
--                    Cash leaving the business is cash leaving the business.
--   expenses_count   how many expenses that is.
--   frozen           true when the month is closed and has a snapshot (0058). Its figures then come from the snapshot taken
--                    at close: money_in = net_in + gst_in + unresolved_gross (together every non-voided payment of the month,
--                    v_payment_net has exactly one row per payment), payments_count = payments.count, money_out =
--                    cash_out_total, expenses_count = via.cash_count + via.bank_count. The month lock (0027) keeps a closed
--                    month's payments and expenses from changing, so the frozen and live figures agree; the snapshot is
--                    still the one served, as v_month_pnl does.
--   No quarter view: a quarter is the sum of its three months (the app adds them in paisa).
--
-- v_month_cash_out_detail   the money out of a month by category and by the expense's detail (its description, the one
--                    optional "Detail" field: "LEA-1234", "Office water"), live. Details are matched ignoring case and extra
--                    spaces; an expense with no detail is one row with detail NULL. A closed month cannot change (month
--                    lock), so its rows add up to the frozen money_out; the app shows any difference as its own line.
--   gross_paid       sum of amount_pkr (gross, as money_out).   expense_count   how many.   last_paid_on   the latest date.
--   The app also reads it for the Detail suggestions (the details used before, most used first).
--
-- GST: neither view takes GST out. Profit with GST taken out of both sides stays v_month_pnl ("Profit and loss").

create view public.v_month_cash_flow with (security_invoker = true) as
with live_in as (
  select date_trunc('month', p.received_on)::date as month, sum(p.amount) as money_in, count(*)::int as payments_count
  from public.payments_in p
  where p.voided_at is null
  group by 1
),
live_out as (
  select date_trunc('month', e.paid_on)::date as month, sum(e.amount_pkr) as money_out, count(*)::int as expenses_count
  from public.expenses e
  group by 1
),
months as (
  select i.month from live_in i
  union
  select o.month from live_out o
  union
  select s.month from public.month_snapshots s
)
select
  k.month,
  case when s.month is not null
       then (s.pnl ->> 'net_in')::numeric + (s.pnl ->> 'gst_in')::numeric + (s.pnl ->> 'unresolved_gross')::numeric
       else coalesce(i.money_in, 0) end                                                         as money_in,
  case when s.month is not null then (s.payments ->> 'count')::int
       else coalesce(i.payments_count, 0) end                                                   as payments_count,
  case when s.month is not null then (s.pnl ->> 'cash_out_total')::numeric
       else coalesce(o.money_out, 0) end                                                        as money_out,
  case when s.month is not null then (s.via ->> 'cash_count')::int + (s.via ->> 'bank_count')::int
       else coalesce(o.expenses_count, 0) end                                                   as expenses_count,
  (s.month is not null)                                                                         as frozen
from months k
left join public.month_snapshots s on s.month = k.month
left join live_in i on i.month = k.month
left join live_out o on o.month = k.month
where (select public.current_user_role()) = 'admin';

comment on view public.v_month_cash_flow is
  '0079: cash in vs out per month, gross (GST and input tax included), voided payments left out, every expense category. A closed month answers from its snapshot. Admin only.';

create view public.v_month_cash_out_detail with (security_invoker = true) as
select
  date_trunc('month', e.paid_on)::date as month,
  e.category_id,
  max(d.detail)                        as detail,
  sum(e.amount_pkr)                    as gross_paid,
  count(*)::int                        as expense_count,
  max(e.paid_on)                       as last_paid_on
from public.expenses e
cross join lateral (
  select nullif(regexp_replace(btrim(coalesce(e.description, '')), '\s+', ' ', 'g'), '') as detail
) d
where (select public.current_user_role()) = 'admin'
group by 1, e.category_id, lower(d.detail);

comment on view public.v_month_cash_out_detail is
  '0079: money out per month, category and detail (the expense description, case and spacing ignored), gross. Admin only.';

revoke all on public.v_month_cash_flow, public.v_month_cash_out_detail from public, anon, authenticated;
grant select on public.v_month_cash_flow, public.v_month_cash_out_detail to authenticated;
