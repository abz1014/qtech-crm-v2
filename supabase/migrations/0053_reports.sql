-- 0053_reports (P01): four read-only report views over data the team already records. Nothing new is typed by anyone.
-- None of them carries a money figure. They are visible to admin and sales (the Reports nav item is admin and sales);
-- security_invoker plus the explicit current_user_role() filter means an engineer, a deactivated user and anon get
-- zero rows (the filter is the same pattern as 0028). All counts are all-time; the screen can only show what exists.

-- ---------------------------------------------------------------- v_report_rfq_outcomes
-- One row per outcome and, for closed RFQs, per close reason: open / won / closed:<reason>.
create view public.v_report_rfq_outcomes with (security_invoker = true) as
select
  s.outcome,
  case when s.outcome = 'closed' then s.close_reason end as close_reason,
  count(*)::int as rfqs
from public.v_rfq_state s
where public.current_user_role() in ('admin', 'sales')
group by s.outcome, case when s.outcome = 'closed' then s.close_reason end;

-- ---------------------------------------------------------------- v_report_float
-- One row per sourcing state (not_floated, floated_awaiting, partly_covered, covered, no_offer_anywhere):
-- how many RFQs, how many items they have and how many of those items got a supplier price, and what became of them.
create view public.v_report_float with (security_invoker = true) as
select
  s.sourcing_state,
  count(*)::int                                   as rfqs,
  coalesce(sum(s.items_total), 0)::int            as items_total,
  coalesce(sum(s.items_quoted), 0)::int           as items_quoted,
  (count(*) filter (where s.outcome = 'won'))::int    as won,
  (count(*) filter (where s.outcome = 'closed'))::int as closed,
  (count(*) filter (where s.outcome = 'open'))::int   as still_open
from public.v_rfq_state s
where public.current_user_role() in ('admin', 'sales')
group by s.sourcing_state;

-- ---------------------------------------------------------------- v_report_clarification_turnaround
-- Per Karachi month of the first time a question was asked of the customer: how many were asked, how many were
-- answered, withdrawn or are still open, and the days from first asked to answered (calendar days, Karachi dates).
create view public.v_report_clarification_turnaround with (security_invoker = true) as
select
  date_trunc('month', public.today_pkt(c.first_asked_at))::date as month,
  count(*)::int                                                                          as asked,
  (count(*) filter (where c.answered_at is not null and c.withdrawn_at is null))::int    as answered,
  (count(*) filter (where c.withdrawn_at is not null))::int                              as withdrawn,
  (count(*) filter (where c.answered_at is null and c.withdrawn_at is null))::int        as still_open,
  round(avg(public.today_pkt(c.answered_at) - public.today_pkt(c.first_asked_at))
        filter (where c.answered_at is not null and c.withdrawn_at is null), 1)          as avg_days,
  max(public.today_pkt(c.answered_at) - public.today_pkt(c.first_asked_at))
        filter (where c.answered_at is not null and c.withdrawn_at is null)              as slowest_days,
  (sum(public.today_pkt(c.answered_at) - public.today_pkt(c.first_asked_at))
        filter (where c.answered_at is not null and c.withdrawn_at is null))::int        as total_days
from public.clarifications c
where c.first_asked_at is not null
  and public.current_user_role() in ('admin', 'sales')
group by 1;

-- ---------------------------------------------------------------- v_report_repeat_customers
-- Every company with at least one order that was not cancelled: its orders, first and last order date, its RFQs.
-- A repeat customer is one with two or more such orders.
create view public.v_report_repeat_customers with (security_invoker = true) as
select
  co.id                         as company_id,
  co.name,
  o.orders,
  o.first_order_on,
  o.last_order_on,
  (select count(*)::int from public.rfqs r where r.company_id = co.id) as rfqs,
  (o.orders >= 2)               as is_repeat
from public.companies co
cross join lateral (
  select count(*)::int as orders, min(x.ordered_on) as first_order_on, max(x.ordered_on) as last_order_on
  from public.orders x
  where x.company_id = co.id and x.cancelled_on is null
) o
where o.orders > 0
  and public.current_user_role() in ('admin', 'sales');

-- ---------------------------------------------------------------- grants
revoke all on public.v_report_rfq_outcomes, public.v_report_float, public.v_report_clarification_turnaround,
  public.v_report_repeat_customers from public, anon, authenticated;
grant select on public.v_report_rfq_outcomes, public.v_report_float, public.v_report_clarification_turnaround,
  public.v_report_repeat_customers to authenticated;
