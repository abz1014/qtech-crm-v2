-- 0015_money_views (S11): DATA_MODEL section 5 money clocks, section 5a (net portion) and 5b (target progress).
-- Admin only. Every view carries an explicit current_user_role() = 'admin' filter on top of security_invoker:
-- row security alone would let a non-admin see a view built on the few rows they can read, with wrong totals.
-- A non-admin therefore gets zero rows.

-- ---------------------------------------------------------------- v_order_basis (helper)
-- The N (net) and G (gross) a payment is shared out against (section 5a):
--   at least one invoice -> N = sum(net_amount), G = sum(net_amount + gst_amount)
--   otherwise            -> N and G from the item lines (v_order_items_total)
create view public.v_order_basis with (security_invoker = true) as
select
  o.id as order_id,
  i.invoice_count,
  i.invoice_net,
  i.invoice_gross,
  t.net   as items_net,
  t.gross as items_gross,
  case when i.invoice_count > 0 then 'invoice' else 'items' end as basis,
  case when i.invoice_count > 0 then i.invoice_net   else t.net   end as n,
  case when i.invoice_count > 0 then i.invoice_gross else t.gross end as g
from public.orders o
join public.v_order_items_total t on t.order_id = o.id
cross join lateral (
  select count(*) as invoice_count,
         coalesce(sum(v.net_amount), 0) as invoice_net,
         coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross
  from public.invoices v
  where v.order_id = o.id
) i
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- v_payment_net
-- net_portion = round(amount x N / G, 2); gst_portion = amount - net_portion.
-- excluded_reason (first match wins):
--   basis_unknown  the order carries the legacy flag value_basis_unknown (no net is guessed)
--   zero_value     G = 0
--   unattributed   credited_user_id is empty: still counts in company net cash, in nobody's target
-- counts_in_cash_net: reason is empty or unattributed.  counts_in_target: reason is empty.
create view public.v_payment_net with (security_invoker = true) as
select
  p.id as payment_id,
  p.order_id,
  p.received_on,
  p.amount,
  p.credited_user_id,
  b.basis,
  b.n,
  b.g,
  x.excluded_reason,
  case when x.excluded_reason in ('basis_unknown', 'zero_value') then null
       else round(p.amount * b.n / b.g, 2) end as net_portion,
  case when x.excluded_reason in ('basis_unknown', 'zero_value') then null
       else p.amount - round(p.amount * b.n / b.g, 2) end as gst_portion,
  (x.excluded_reason is null or x.excluded_reason = 'unattributed') as counts_in_cash_net,
  (x.excluded_reason is null) as counts_in_target
from public.payments_in p
join public.orders o on o.id = p.order_id
join public.v_order_basis b on b.order_id = p.order_id
cross join lateral (
  select case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when b.g = 0 then 'zero_value'
    when p.credited_user_id is null then 'unattributed'
  end as excluded_reason
) x
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- v_order_money
-- Whole-life order view for admin.
--   net_sale        invoiced net if any invoice exists, otherwise the item net
--   gross_target    G from v_order_basis
--   settled         sum of payments (gross); settled_ok = G > 0 and settled >= G - 1 (Rs 1 rounding allowance)
--   receivable      max(G - settled, 0); overpaid_by = max(settled - G, 0) (overpayments are never capped)
--   due_on          earliest invoice date + payment_terms_days (needs both)
--   payment_state   overdue (due_on passed and not settled) / settled / part / unpaid
--   actual_cost     sum of expenses tagged to the order; expected_cost from order_costs
--   costs_state     complete (costs_complete_at set) / provisional
--   margin          net_sale - actual_cost, no adjustment; NULL while value_basis_unknown
create view public.v_order_money with (security_invoker = true) as
select
  o.id as order_id,
  o.number as order_number,
  o.company_id,
  o.owner_id,
  b.basis,
  case when b.invoice_count > 0 then b.invoice_net else b.items_net end as net_sale,
  b.g as gross_target,
  s.settled,
  (b.g > 0 and s.settled >= b.g - 1) as settled_ok,
  greatest(b.g - s.settled, 0) as receivable,
  greatest(s.settled - b.g, 0) as overpaid_by,
  d.due_on,
  case
    when d.due_on is not null and d.due_on < public.today_pkt() and not (b.g > 0 and s.settled >= b.g - 1)
      then 'overdue'
    when b.g > 0 and s.settled >= b.g - 1 then 'settled'
    when s.settled > 0 then 'part'
    else 'unpaid'
  end as payment_state,
  e.actual_cost,
  oc.expected_cost_pkr as expected_cost,
  case when oc.costs_complete_at is not null then 'complete' else 'provisional' end as costs_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then null
       else (case when b.invoice_count > 0 then b.invoice_net else b.items_net end) - e.actual_cost end as margin,
  case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when oc.costs_complete_at is null then 'provisional'
    else 'final'
  end as margin_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
       when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
       else 'ok' end as data_trust
from public.orders o
join public.v_order_basis b on b.order_id = o.id
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id
) s
cross join lateral (
  select coalesce(sum(x.amount_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select (min(v.invoice_date) + o.payment_terms_days) as due_on
  from public.invoices v
  where v.order_id = o.id
) d
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- v_cash_month
-- Cash clocks per Karachi calendar month, never combined with each other or with margin.
--   money in  : payments by received_on: gross, GST portion, net; payments with no net (basis_unknown,
--               zero_value) count in gross and are reported as unresolved_gross / unresolved_count.
--   money out : expenses by paid_on.
create view public.v_cash_month with (security_invoker = true) as
with money_in as (
  select
    date_trunc('month', received_on)::date as month,
    sum(amount)                                                        as gross_received,
    sum(gst_portion) filter (where counts_in_cash_net)                 as gst_received,
    sum(net_portion) filter (where counts_in_cash_net)                 as net_received,
    sum(amount) filter (where excluded_reason in ('basis_unknown', 'zero_value')) as unresolved_gross,
    count(*) filter (where excluded_reason in ('basis_unknown', 'zero_value'))    as unresolved_count
  from public.v_payment_net
  group by 1
),
money_out as (
  select date_trunc('month', paid_on)::date as month, sum(amount_pkr) as money_out
  from public.expenses
  group by 1
)
select
  coalesce(i.month, o.month) as month,
  coalesce(i.gross_received, 0)    as gross_received,
  coalesce(i.gst_received, 0)      as gst_received,
  coalesce(i.net_received, 0)      as net_received,
  coalesce(i.unresolved_gross, 0)  as unresolved_gross,
  coalesce(i.unresolved_count, 0)  as unresolved_count,
  coalesce(o.money_out, 0)         as money_out
from money_in i
full join money_out o on o.month = i.month
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- v_target_progress
-- One row per (user, year, quarter) that has a target or a credited payment, for any quarter.
--   achieved_net   sum of net_portion of the user's credited payments received in the quarter (reason empty)
--   gap            max(target - achieved, 0)
--   on_pace_net    target x days elapsed / days in quarter; today counts as elapsed (past quarter = 1, future = 0)
--   behind_pace    max(on_pace - achieved, 0)
--   excluded_count payments credited to the user in the quarter that cannot count (count only)
create view public.v_target_progress with (security_invoker = true) as
with keys as (
  select user_id, year, quarter from public.targets
  union
  select credited_user_id, extract(year from received_on)::smallint, extract(quarter from received_on)::smallint
  from public.v_payment_net
  where credited_user_id is not null
),
q as (
  select k.user_id, k.year, k.quarter,
         make_date(k.year, (k.quarter - 1) * 3 + 1, 1) as quarter_start
  from keys k
)
select
  q.user_id,
  q.year,
  q.quarter,
  q.quarter_start,
  (q.quarter_start + interval '3 months' - interval '1 day')::date as quarter_end,
  t.target_net_pkr as target_net,
  a.achieved_net,
  case when t.target_net_pkr is not null then greatest(t.target_net_pkr - a.achieved_net, 0) end as gap,
  case when t.target_net_pkr is not null
       then round(t.target_net_pkr * d.elapsed / d.total, 2) end as on_pace_net,
  case when t.target_net_pkr is not null
       then greatest(round(t.target_net_pkr * d.elapsed / d.total, 2) - a.achieved_net, 0) end as behind_pace,
  a.excluded_count
from q
left join public.targets t on t.user_id = q.user_id and t.year = q.year and t.quarter = q.quarter
cross join lateral (
  select
    (q.quarter_start + interval '3 months')::date - q.quarter_start as total,
    least(greatest(public.today_pkt() - q.quarter_start + 1, 0),
          (q.quarter_start + interval '3 months')::date - q.quarter_start) as elapsed
) d
cross join lateral (
  select
    coalesce(sum(p.net_portion) filter (where p.counts_in_target), 0)::numeric(14,2) as achieved_net,
    count(*) filter (where not p.counts_in_target)::int as excluded_count
  from public.v_payment_net p
  where p.credited_user_id = q.user_id
    and extract(year from p.received_on) = q.year
    and extract(quarter from p.received_on) = q.quarter
) a
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- grants
revoke all on public.v_order_basis, public.v_payment_net, public.v_order_money, public.v_cash_month,
  public.v_target_progress from public, anon, authenticated;
grant select on public.v_order_basis, public.v_payment_net, public.v_order_money, public.v_cash_month,
  public.v_target_progress to authenticated;
