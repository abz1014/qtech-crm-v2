-- 0028_month_reports (S23): Amendment A6.3. The monthly views and functions.
-- Everything is admin only, with the explicit current_user_role() = 'admin' filter on top of security_invoker
-- (row security alone would show a non-admin wrong totals), except v_gst_month, which admin and sales both read.
-- A non-admin gets zero rows. The functions are SECURITY INVOKER: the caller's row security applies as well.
--
-- Cost is always the net cost, amount_pkr - input_tax_pkr (0025). The "Supplier payment" and "Other" categories are
-- named by their fixed seed ids (0025): ca7e...0011 and ca7e...0010.

-- ---------------------------------------------------------------- v_month_pnl
-- Cash P&L per Karachi calendar month (a month that has any payment or expense appears).
--   money in : net_in (net portion of payments received, from v_payment_net), gst_in (shown, not revenue),
--              unresolved_gross (payments with no net split: basis_unknown, zero_value)
--   money out: order_costs, overheads, non_pnl_out (net cost, by the category's group)
--   result = net_in - order_costs - overheads;  after_drawings = result - non_pnl_out
--   cash lines: cash_out_total (sum of amount_pkr, every group), input_tax (sum of input_tax_pkr)
create view public.v_month_pnl with (security_invoker = true) as
with money_in as (
  select
    date_trunc('month', p.received_on)::date as month,
    coalesce(sum(p.net_portion) filter (where p.counts_in_cash_net), 0)                          as net_in,
    coalesce(sum(p.gst_portion) filter (where p.counts_in_cash_net), 0)                          as gst_in,
    coalesce(sum(p.amount) filter (where p.excluded_reason in ('basis_unknown', 'zero_value')), 0) as unresolved_gross
  from public.v_payment_net p
  group by 1
),
money_out as (
  select
    date_trunc('month', e.paid_on)::date as month,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'order_cost'), 0) as order_costs,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'overhead'), 0)   as overheads,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'non_pnl'), 0)    as non_pnl_out,
    coalesce(sum(e.amount_pkr), 0)                                                       as cash_out_total,
    coalesce(sum(e.input_tax_pkr), 0)                                                    as input_tax
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  group by 1
),
m as (
  select
    coalesce(i.month, o.month) as month,
    coalesce(i.net_in, 0)            as net_in,
    coalesce(i.gst_in, 0)            as gst_in,
    coalesce(i.unresolved_gross, 0)  as unresolved_gross,
    coalesce(o.order_costs, 0)       as order_costs,
    coalesce(o.overheads, 0)         as overheads,
    coalesce(o.non_pnl_out, 0)       as non_pnl_out,
    coalesce(o.cash_out_total, 0)    as cash_out_total,
    coalesce(o.input_tax, 0)         as input_tax
  from money_in i
  full join money_out o on o.month = i.month
)
select
  m.month,
  m.net_in,
  m.gst_in,
  m.unresolved_gross,
  m.order_costs,
  m.overheads,
  m.net_in - m.order_costs - m.overheads as result,
  m.non_pnl_out,
  m.net_in - m.order_costs - m.overheads - m.non_pnl_out as after_drawings,
  m.cash_out_total,
  m.input_tax
from m
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- v_month_expense_category
-- "Water, snacks, salaries, fuel": per month and category, the net cost, the gross paid and the count.
create view public.v_month_expense_category with (security_invoker = true) as
select
  date_trunc('month', e.paid_on)::date as month,
  c.grp,
  c.id as category_id,
  c.name as category,
  c.sort as category_sort,
  sum(e.amount_pkr - e.input_tax_pkr) as net_cost,
  sum(e.amount_pkr)                   as gross_paid,
  count(*)::int                       as expense_count
from public.expenses e
join public.expense_categories c on c.id = e.category_id
where public.current_user_role() = 'admin'
group by 1, c.grp, c.id, c.name, c.sort;

-- ---------------------------------------------------------------- aging_as_of
-- Receivables aging as of p_date, per invoice. Payments received on or before p_date are applied first-in, first-out
-- to the oldest invoice of the same order (invoice_date, then number). What is left of an invoice's gross is bucketed
-- by days since the invoice date: 0-30, 31-60, 61-90, 90+. Fully paid invoices are not listed.
-- Orders with payments but no invoice dated on or before p_date appear as one 'advance' row (advance_held), never as
-- negative aging. Money above the invoiced total of an invoiced order is not an advance row.
create function public.aging_as_of(p_date date)
returns table (
  kind            text,
  order_id        uuid,
  order_number    bigint,
  company_id      uuid,
  invoice_id      uuid,
  invoice_number  text,
  invoice_date    date,
  gross           numeric,
  applied         numeric,
  remaining       numeric,
  age_days        integer,
  bucket          text,
  advance_held    numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with inv as (
    select v.id, v.order_id as ordid, o.number as order_number, coalesce(v.company_id, o.company_id) as company_id,
           v.number, v.invoice_date, v.net_amount + v.gst_amount as gross
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where v.invoice_date <= p_date
      and public.current_user_role() = 'admin'
  ),
  paid as (
    select p.order_id as ordid, sum(p.amount) as paid
    from public.payments_in p
    where p.received_on <= p_date
      and public.current_user_role() = 'admin'
    group by p.order_id
  ),
  fifo as (
    select i.*,
           coalesce(pd.paid, 0) as paid,
           coalesce(sum(i.gross) over (partition by i.ordid order by i.invoice_date, i.number, i.id
                                       rows between unbounded preceding and 1 preceding), 0) as before_gross
    from inv i
    left join paid pd on pd.ordid = i.ordid
  ),
  fa as (
    select f.*, least(f.gross, greatest(f.paid - f.before_gross, 0)) as applied_amt
    from fifo f
  )
  select 'invoice'::text, a.ordid, a.order_number, a.company_id, a.id, a.number, a.invoice_date, a.gross,
         a.applied_amt, a.gross - a.applied_amt,
         (p_date - a.invoice_date)::int,
         case when p_date - a.invoice_date <= 30 then '0-30'
              when p_date - a.invoice_date <= 60 then '31-60'
              when p_date - a.invoice_date <= 90 then '61-90'
              else '90+' end,
         null::numeric
  from fa a
  where a.gross - a.applied_amt > 0
  union all
  select 'advance'::text, o.id, o.number, o.company_id, null::uuid, null::text, null::date, null::numeric,
         null::numeric, null::numeric, null::int, null::text, pd.paid
  from paid pd
  join public.orders o on o.id = pd.ordid
  where pd.paid > 0
    and not exists (select 1 from inv i where i.ordid = pd.ordid)
$$;

revoke all on function public.aging_as_of(date) from public, anon, authenticated;
grant execute on function public.aging_as_of(date) to authenticated;

-- ---------------------------------------------------------------- payables_as_of ("we owe")
-- One row per supplier leg placed on or before p_date on an order that was not cancelled by then. Approximate by design.
--   committed     the latest purchase order's total, else the sum of qty x supplier_unit_price over the leg's items,
--                 in the leg's currency (a PO's own currency when the PO is the source)
--   fx_rate       PKR per unit: 1 for PKR (or no currency), else the latest rate on or before p_date (manual beats auto)
--   committed_pkr committed x fx_rate
--   paid_pkr      sum of amount_pkr of 'Supplier payment' expenses on the leg dated on or before p_date
--   owed_pkr      committed_pkr - paid_pkr, clamped at 0 (flag 'overpaid' when it was negative)
--   state         settled (owed within 3% of committed) / owing / unpriced (nothing to commit) / no_rate
create function public.payables_as_of(p_date date)
returns table (
  supplier_order_id  uuid,
  order_id           uuid,
  order_number       bigint,
  supplier_id        uuid,
  supplier_name      text,
  currency           text,
  committed          numeric,
  fx_rate            numeric,
  committed_pkr      numeric,
  paid_pkr           numeric,
  owed_pkr           numeric,
  state              text,
  flag               text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with legs as (
    select
      l.id as leg_id, l.order_id as ordid, o.number as order_number, l.supplier_id, s.name as supplier_name,
      coalesce(case when po.total is not null then po.currency else l.currency end, 'PKR')::text as cur,
      coalesce(po.total, it.total) as committed,
      coalesce((select sum(e.amount_pkr) from public.expenses e
                where e.supplier_order_id = l.id
                  and e.category_id = 'ca7e0000-0000-4000-8000-000000000011'
                  and e.paid_on <= p_date), 0) as paid
    from public.supplier_orders l
    join public.orders o on o.id = l.order_id
    join public.companies s on s.id = l.supplier_id
    left join lateral (
      select p.total, p.currency from public.purchase_orders p
      where p.supplier_order_id = l.id order by p.revision desc limit 1
    ) po on true
    left join lateral (
      select sum(i.qty * i.supplier_unit_price) as total from public.order_items i
      where i.supplier_order_id = l.id and i.supplier_unit_price is not null
    ) it on true
    where l.placed_on <= p_date
      and (o.cancelled_on is null or o.cancelled_on > p_date)
      and public.current_user_role() = 'admin'
  ),
  priced as (
    select g.*,
           case when g.cur = 'PKR' then 1::numeric
                else (select r.rate_pkr from public.fx_rates r
                      where r.currency = g.cur and r.as_of <= p_date
                      order by r.as_of desc, (r.source = 'manual') desc limit 1) end as rate
    from legs g
  ),
  calc as (
    select x.*,
           round(x.committed * x.rate, 2) as committed_pkr,
           round(x.committed * x.rate, 2) - x.paid as raw_owed
    from priced x
  )
  select c.leg_id, c.ordid, c.order_number, c.supplier_id, c.supplier_name, c.cur, c.committed, c.rate,
         c.committed_pkr, c.paid,
         case when c.committed_pkr is not null then greatest(c.raw_owed, 0) end,
         case when c.committed is null then 'unpriced'
              when c.rate is null then 'no_rate'
              when c.raw_owed <= 0.03 * c.committed_pkr then 'settled'
              else 'owing' end,
         case when c.raw_owed < 0 then 'overpaid' end
  from calc c
$$;

revoke all on function public.payables_as_of(date) from public, anon, authenticated;
grant execute on function public.payables_as_of(date) to authenticated;

-- ---------------------------------------------------------------- v_gst_month (admin and sales)
-- Per invoice month: counts and amounts for the FBR filing. Output GST and input tax are never netted here.
--   psid_set_count     invoices with a PSID
--   deposited_count    invoices with a deposit date; deposited_amount their tax_deposit_amount
--   gst_to_deposit     GST on invoices not yet deposited
--   input_tax          input tax paid (expenses by paid_on month), admin only: NULL for sales
create view public.v_gst_month with (security_invoker = true) as
with inv as (
  select
    date_trunc('month', v.invoice_date)::date as month,
    count(*)::int                                                          as invoice_count,
    sum(v.net_amount)                                                      as net,
    sum(v.gst_amount)                                                      as gst,
    (count(*) filter (where v.psid is not null))::int                      as psid_set_count,
    (count(*) filter (where v.tax_deposited_on is not null))::int          as deposited_count,
    coalesce(sum(v.tax_deposit_amount) filter (where v.tax_deposited_on is not null), 0) as deposited_amount,
    coalesce(sum(v.gst_amount) filter (where v.tax_deposited_on is null), 0)             as gst_to_deposit
  from public.invoices v
  where v.invoice_date is not null
  group by 1
),
itx as (
  select date_trunc('month', e.paid_on)::date as month, sum(e.input_tax_pkr) as input_tax
  from public.expenses e
  group by 1
  having sum(e.input_tax_pkr) > 0
)
select
  coalesce(i.month, x.month)          as month,
  coalesce(i.invoice_count, 0)        as invoice_count,
  coalesce(i.net, 0)                  as net,
  coalesce(i.gst, 0)                  as gst,
  coalesce(i.psid_set_count, 0)       as psid_set_count,
  coalesce(i.deposited_count, 0)      as deposited_count,
  coalesce(i.deposited_amount, 0)     as deposited_amount,
  coalesce(i.gst_to_deposit, 0)       as gst_to_deposit,
  case when public.current_user_role() = 'admin' then coalesce(x.input_tax, 0) end as input_tax
from inv i
full join itx x on x.month = i.month
where public.current_user_role() in ('admin', 'sales');

-- ---------------------------------------------------------------- v_month_team
-- Per month and credited user: net cash credited (the payments that count towards a target), next to that user's
-- quarter (target, achieved and gap for the quarter the month falls in) from v_target_progress.
create view public.v_month_team with (security_invoker = true) as
select
  t.month,
  t.user_id,
  u.name as user_name,
  t.net_credited,
  t.payment_count,
  tp.target_net       as quarter_target_net,
  tp.achieved_net     as quarter_achieved_net,
  tp.gap              as quarter_gap
from (
  select date_trunc('month', p.received_on)::date as month,
         p.credited_user_id as user_id,
         sum(p.net_portion)::numeric(14,2) as net_credited,
         count(*)::int as payment_count
  from public.v_payment_net p
  where p.counts_in_target
  group by 1, 2
) t
join public.users u on u.id = t.user_id
left join public.v_target_progress tp
  on tp.user_id = t.user_id
 and tp.year = extract(year from t.month)
 and tp.quarter = extract(quarter from t.month)
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- month_end_status
-- The month-end checklist: one row per check with its count. Nothing here blocks closing; each is a warning.
--   bank_unticked          bank items (payments in, expenses) dated on or before month end with no bank_month
--   fbr_deposits_unticked  invoices deposited on or before month end with no tax_bank_month
--   uncategorised          expenses of the month: "Other" without a description, an order-cost category without an
--                          order, or the legacy flag category_unmapped
--   recurring_not_recorded active recurring templates (started by this month) with no expense for the period
--   provisional_margins    orders (not cancelled) settled on or before month end whose costs are not marked complete
--   fbr_pending            invoices dated on or before month end with no tax_deposited_on
--   unresolved_payments    payments of the month counted in gross but not split into net
create function public.month_end_status(p_month date)
returns table (check_key text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month)::date + interval '1 month')::date - 1 as m_end,
           to_char(p_month, 'YYYY-MM') as period
  ),
  checks as (
    select 'bank_unticked'::text as check_key,
           ((select count(*) from public.payments_in p, b
             where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end)
          + (select count(*) from public.expenses e, b
             where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end))::int as n
    union all
    select 'fbr_deposits_unticked',
           (select count(*) from public.invoices v, b
            where v.tax_deposited_on <= b.m_end and v.tax_bank_month is null)::int
    union all
    select 'uncategorised',
           (select count(*) from public.expenses e
            join public.expense_categories c on c.id = e.category_id, b
            where e.paid_on between b.m_start and b.m_end
              and ((c.id = 'ca7e0000-0000-4000-8000-000000000010' and nullif(btrim(e.description), '') is null)
                or (c.grp = 'order_cost' and e.order_id is null)
                or 'category_unmapped' = any (e.legacy_flags)))::int
    union all
    select 'recurring_not_recorded',
           (select count(*) from public.recurring_expenses r, b
            where r.active
              and (r.start_month is null or r.start_month <= b.period)
              and not exists (select 1 from public.expenses e where e.recurring_id = r.id and e.period = b.period))::int
    union all
    select 'provisional_margins',
           (select count(*) from public.orders o
            join public.v_order_basis ob on ob.order_id = o.id
            left join public.order_costs oc on oc.order_id = o.id, b
            where o.cancelled_on is null
              and oc.costs_complete_at is null
              and ob.g > 0
              and (select coalesce(sum(p.amount), 0) from public.payments_in p
                   where p.order_id = o.id and p.received_on <= b.m_end) >= ob.g - 1)::int
    union all
    select 'fbr_pending',
           (select count(*) from public.invoices v, b
            where v.invoice_date <= b.m_end and v.tax_deposited_on is null)::int
    union all
    select 'unresolved_payments',
           (select count(*) from public.v_payment_net p, b
            where p.received_on between b.m_start and b.m_end
              and p.excluded_reason in ('basis_unknown', 'zero_value'))::int
  )
  select c.check_key, c.n from checks c
  where public.current_user_role() = 'admin'
$$;

revoke all on function public.month_end_status(date) from public, anon, authenticated;
grant execute on function public.month_end_status(date) to authenticated;

-- ---------------------------------------------------------------- grants
revoke all on public.v_month_pnl, public.v_month_expense_category, public.v_gst_month, public.v_month_team
  from public, anon, authenticated;
grant select on public.v_month_pnl, public.v_month_expense_category, public.v_gst_month, public.v_month_team
  to authenticated;
