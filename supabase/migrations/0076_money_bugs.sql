-- 0076_money_bugs (money verification: BUG-M2, M3, M4, M9, M11; docs/DECISIONS.md 2026-10-20 "money bugs"). Same columns and
-- signatures everywhere, so nothing that reads these changes shape. Each object starts from its 0073 definition (payment
-- correction) and keeps its `voided_at is null` filter.
--
--   v_order_money            M2: D-MR3, as order_receivables: a cancelled order that was never invoiced owes nothing (gross 0,
--                            receivable 0; money paid on it shows as overpaid, a refund may be due). The admin order page,
--                            the Orders list balance and the Company page read this view.
--   order_receivables,       M9: the due basis of an invoice with no date (legacy import, flag 'undated') is the order date,
--   v_order_money,           else the day it was imported (created_at, Karachi). An undated invoice now has a due date, ages
--   aging_as_of              and becomes overdue like any other. A dated invoice is unchanged.
--   aging_as_of              M3: the Rs 1 allowance of order_receivables. An order paid to within Rs 1 of what it is invoiced
--                            (as of the date) is settled and has no aging row. Frozen month snapshots are corrected below.
--   month_end_check_details  M4: the FBR-pending list uses the count's predicate (gst_amount > 0, MR-7).
--                            M11: a closed month returns the details frozen at close (month_snapshots.details, new); a month
--                            closed before this migration returns the live details marked "live": true.

-- ================================================================ order_receivables (M9)
create or replace function public.order_receivables(p_order_id uuid default null)
returns table (
  order_id          uuid,
  order_number      bigint,
  company_id        uuid,
  owner_id          uuid,
  gross_target      numeric,
  settled           numeric,
  balance           numeric,
  overpaid_by       numeric,
  due_on            date,
  is_overdue        boolean,
  payment_state     text,
  last_reminded_on  date,
  reminder_count    smallint,
  data_trust        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role is null then
    return;
  end if;
  if v_role not in ('admin', 'sales') then
    raise exception 'order_receivables is not available to the % role', v_role
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.number,
    o.company_id,
    o.owner_id,
    b.g,
    s.settled,
    greatest(b.g - s.settled, 0),
    greatest(s.settled - b.g, 0),
    d.due_on,
    (d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok),
    case
      when d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok then 'overdue'
      when ok.settled_ok then 'settled'
      when s.settled > 0 then 'part'
      else 'unpaid'
    end,
    iv.last_reminded_on,
    iv.reminder_count,
    case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
         when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
         else 'ok' end
  from public.orders o
  join public.v_order_items_total t on t.order_id = o.id
  cross join lateral (
    select count(*) as invoice_count,
           coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross,
           min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id
  ) iv
  cross join lateral (
    select case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
  ) b
  cross join lateral (
    select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
  ) s
  cross join lateral (
    select (b.g > 0 and s.settled >= b.g - 1) as settled_ok
  ) ok
  cross join lateral (
    select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
  ) cp
  cross join lateral (
    select (iv.first_invoice_date + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ================================================================ v_order_money (M2, M9)
create or replace view public.v_order_money with (security_invoker = true) as
select
  o.id as order_id,
  o.number as order_number,
  o.company_id,
  o.owner_id,
  b.basis,
  case when b.invoice_count > 0 then b.invoice_net else b.items_net end as net_sale,
  gm.g as gross_target,
  s.settled,
  (gm.g > 0 and s.settled >= gm.g - 1) as settled_ok,
  greatest(gm.g - s.settled, 0) as receivable,
  greatest(s.settled - gm.g, 0) as overpaid_by,
  d.due_on,
  case
    when d.due_on is not null and d.due_on < public.today_pkt() and not (gm.g > 0 and s.settled >= gm.g - 1)
      then 'overdue'
    when gm.g > 0 and s.settled >= gm.g - 1 then 'settled'
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
cross join lateral (
  -- D-MR3: a cancelled order that was never invoiced owes nothing
  select case when o.cancelled_on is not null and b.invoice_count = 0 then 0::numeric else b.g end as g
) gm
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
) s
cross join lateral (
  select coalesce(sum(x.amount_pkr - x.input_tax_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
) cp
cross join lateral (
  select (min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  from public.invoices v
  where v.order_id = o.id

) d
where public.current_user_role() = 'admin';

-- ================================================================ aging_as_of (M3, M9)
create or replace function public.aging_as_of(p_date date)
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
           v.number, coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) as invoice_date,
           v.net_amount + v.gst_amount as gross
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= p_date
      and not v.settled_before_cutover
      and public.current_user_role() = 'admin'
  ),
  paid as (
    select p.order_id as ordid, sum(p.amount) as paid
    from public.payments_in p
    where p.received_on <= p_date
      and p.voided_at is null
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
    select f.*, least(f.gross, greatest(f.paid - f.before_gross, 0)) as applied_amt,
           -- the Rs 1 allowance of order_receivables: an order paid to within Rs 1 of what it is invoiced is settled
           (f.ordid is not null
            and sum(f.gross) over (partition by f.ordid) > 0
            and f.paid >= sum(f.gross) over (partition by f.ordid) - 1) as order_settled
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
    and not a.order_settled
  union all
  select 'advance'::text, o.id, o.number, o.company_id, null::uuid, null::text, null::date, null::numeric,
         null::numeric, null::numeric, null::int, null::text, pd.paid
  from paid pd
  join public.orders o on o.id = pd.ordid
  where pd.paid > 0
    and not exists (select 1 from inv i where i.ordid = pd.ordid)
$$;

-- ================================================================ month_end_check_details (M4, M11)

-- ---------------------------------------------------------------- M11: details frozen at close
alter table public.month_snapshots add column details jsonb;
comment on column public.month_snapshots.details is
  'month_end_check_details rows at close ([{check_key, detail}]); NULL for a month closed before 0076 (the details are then live).';

create function public.take_month_snapshot_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.month_snapshots s
  set details = (select coalesce(jsonb_agg(jsonb_build_object('check_key', d.check_key, 'detail', d.detail - 'live')), '[]'::jsonb)
                 from public.month_end_check_details(new.month) d)
  where s.month = new.month;
  return null;
end;
$$;

revoke all on function public.take_month_snapshot_details() from public, anon, authenticated;

-- named to sort after closed_months_snapshot (triggers of one event fire in name order), so the snapshot row exists
create trigger closed_months_snapshot_details after insert on public.closed_months
  for each row execute function public.take_month_snapshot_details();

create or replace function public.month_end_check_details(p_month date)
returns table (check_key text, detail jsonb)
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
  bank_in as (
    select p.amount, p.received_on from public.payments_in p, b
    where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end
      and p.voided_at is null
  ),
  bank_out as (
    select e.amount_pkr as amount, e.paid_on from public.expenses e, b
    where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end
  ),
  prior as (
    select bi.received_on as d from bank_in bi, b where bi.received_on < b.m_start
    union all
    select bo.paid_on from bank_out bo, b where bo.paid_on < b.m_start
  ),
  deposits as (
    select r.invoice_id, coalesce(r.tax_deposit_amount, r.gst_amount) as amount, coalesce(r.psid, r.invoice_id::text) as grp
    from public.v_gst_register r, b
    where r.tax_deposited_on <= b.m_end
      and exists (select 1 from public.invoices v where v.id = r.invoice_id and v.tax_bank_month is null)
  ),
  uncat as (
    select e.amount_pkr as amount
    from public.expenses e
    join public.expense_categories c on c.id = e.category_id, b
    where e.paid_on between b.m_start and b.m_end
      and ((c.id = 'ca7e0000-0000-4000-8000-000000000010' and nullif(btrim(e.description), '') is null)
        or (c.grp = 'order_cost' and e.order_id is null)
        or 'category_unmapped' = any (e.legacy_flags))
  ),
  rec_all as (
    select r.id, r.label from public.recurring_expenses r, b
    where r.active and (r.start_month is null or r.start_month <= b.period)
  ),
  rec_missing as (
    select ra.label from rec_all ra, b
    where not exists (select 1 from public.expenses e where e.recurring_id = ra.id and e.period = b.period)
  ),
  prov as (
    select o.number
    from public.orders o
    join public.v_order_basis ob on ob.order_id = o.id
    left join public.order_costs oc on oc.order_id = o.id, b
    where o.cancelled_on is null
      and oc.costs_complete_at is null
      and ob.g > 0
      and (select coalesce(sum(p.amount), 0) from public.payments_in p
           where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null) >= ob.g - 1
  ),
  pending as (
    select r.number, r.invoice_date, r.gst_amount
    from public.v_gst_register r, b
    where r.invoice_date <= b.m_end and r.tax_deposited_on is null
      and r.gst_amount > 0
  ),
  unres as (
    select p.payment_id, p.order_id, o.number as order_number, p.amount, pi.reference
    from public.v_payment_net p
    join public.orders o on o.id = p.order_id
    join public.payments_in pi on pi.id = p.payment_id, b
    where p.received_on between b.m_start and b.m_end
      and p.excluded_reason in ('basis_unknown', 'zero_value')
  ),
  details as (
    select 'bank_unticked'::text as check_key,
           jsonb_build_object(
             'in_n', (select count(*) from bank_in),
             'in_amount', (select coalesce(sum(amount), 0) from bank_in),
             'out_n', (select count(*) from bank_out),
             'out_amount', (select coalesce(sum(amount), 0) from bank_out),
             'prior_n', (select count(*) from prior),
             'prior_first', (select to_char(min(d), 'YYYY-MM') from prior),
             'prior_last', (select to_char(max(d), 'YYYY-MM') from prior)) as detail
    union all
    select 'fbr_deposits_unticked',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from deposits),
             'groups', (select count(distinct grp) from deposits))
    union all
    select 'uncategorised',
           jsonb_build_object('amount', (select coalesce(sum(amount), 0) from uncat))
    union all
    select 'recurring_not_recorded',
           jsonb_build_object(
             'total', (select count(*) from rec_all),
             'names', coalesce((select jsonb_agg(label) from (select label from rec_missing order by label limit 3) x), '[]'::jsonb))
    union all
    select 'provisional_margins',
           jsonb_build_object(
             'numbers', coalesce((select jsonb_agg(number) from (select number from prov order by number desc limit 3) x), '[]'::jsonb))
    union all
    select 'fbr_pending',
           jsonb_build_object(
             'amount', (select coalesce(sum(gst_amount), 0) from pending),
             'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'month', to_char(invoice_date, 'YYYY-MM')))
                                   from (select number, invoice_date from pending order by invoice_date desc, number limit 3) x), '[]'::jsonb))
    union all
    select 'unresolved_payments',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from unres),
             'orders', (select count(distinct order_id) from unres),
             'first', (select jsonb_build_object('order_id', order_id, 'order_number', order_number, 'reference', reference)
                       from unres order by amount desc, payment_id limit 1))
  ),
  -- M11: a closed month answers with the details frozen at its close (the same moment as its counts). A month closed before
  -- 0076 has no frozen details: the live ones are returned marked "live": true so the screen can say so.
  frozen as (
    select (e ->> 'check_key')::text as check_key, e -> 'detail' as detail
    from public.month_snapshots s
    cross join b
    cross join lateral jsonb_array_elements(s.details) e
    where s.month = b.m_start and s.details is not null
  ),
  closed as (
    select exists (select 1 from public.closed_months c, b where c.month = b.m_start) as is_closed
  )
  select f.check_key, f.detail from frozen f
  where public.current_user_role() = 'admin'
  union all
  select d.check_key, case when (select is_closed from closed) then d.detail || '{"live": true}'::jsonb else d.detail end
  from details d
  where public.current_user_role() = 'admin'
    and not exists (select 1 from frozen)
$$;

-- ---------------------------------------------------------------- M3: correct the frozen aging of closed months
-- Drop the invoice rows of orders settled within Rs 1 as of the month's last day (the rule above).
update public.month_snapshots s
set aging = coalesce((
  select jsonb_agg(x.e order by x.ord)
  from jsonb_array_elements(s.aging) with ordinality as x(e, ord)
  where not (
    x.e ->> 'kind' = 'invoice'
    and x.e ->> 'order_id' is not null
    and exists (
      select 1
      from (select coalesce(sum(v.net_amount + v.gst_amount), 0) as g
            from public.invoices v
            left join public.orders o on o.id = v.order_id
            where v.order_id = (x.e ->> 'order_id')::uuid
              and not v.settled_before_cutover
              and coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= (s.month + interval '1 month')::date - 1) gi,
           (select coalesce(sum(p.amount), 0) as paid
            from public.payments_in p
            where p.order_id = (x.e ->> 'order_id')::uuid
              and p.received_on <= (s.month + interval '1 month')::date - 1
              and p.voided_at is null) pi
      where gi.g > 0 and pi.paid >= gi.g - 1)
  )), '[]'::jsonb);
