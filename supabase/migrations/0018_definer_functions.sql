-- 0018_definer_functions (S12): order_receivables() and my_target_progress(), DATA_MODEL sections 5b and 10.
--
-- Both are SECURITY DEFINER with a fixed search_path: they read money tables the caller cannot read
-- (payments_in, and invoices for the engineer-owned case) and expose only aggregates. They cannot reuse the admin-only
-- money views, because those carry a current_user_role() = 'admin' filter and auth.uid() still names the
-- caller inside a definer function. The net-portion maths (section 5a) is therefore repeated here and must
-- stay in step with v_payment_net / v_order_basis (0015).
--
-- Grants: EXECUTE for authenticated only. Access is decided inside, from current_user_role():
--   order_receivables   admin, sales   (engineer: insufficient_privilege; deactivated or unknown: no rows)
--   my_target_progress  any active user, always the caller's own row (deactivated: no rows)

-- ---------------------------------------------------------------- order_receivables
-- One row per order (or just p_order_id when given). Gross due, settled, balance and overdue flag,
-- plus the latest reminder date and the highest reminder count across the order's invoices (a reminder
-- stamps every invoice it covers, so the maximum is the number of reminders sent for the order).
-- No cost, margin or per-payment rows. Rules as v_order_money (0015):
--   gross_target  invoiced gross if any invoice exists, otherwise gross from the item lines
--   settled_ok    gross_target > 0 and settled >= gross_target - 1 (Rs 1 rounding allowance)
--   due_on        earliest invoice date + payment_terms_days (needs both)
create function public.order_receivables(p_order_id uuid default null)
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
           min(v.invoice_date) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id
  ) iv
  cross join lateral (
    select case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
  ) b
  cross join lateral (
    select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id
  ) s
  cross join lateral (
    select (b.g > 0 and s.settled >= b.g - 1) as settled_ok
  ) ok
  cross join lateral (
    select (iv.first_invoice_date + o.payment_terms_days) as due_on
  ) d
  where p_order_id is null or o.id = p_order_id
  order by o.number;
end;
$$;

revoke all on function public.order_receivables(uuid) from public, anon, authenticated;
grant execute on function public.order_receivables(uuid) to authenticated;

-- ---------------------------------------------------------------- my_target_progress
-- The caller's row for the current Asia/Karachi calendar quarter (section 5b). The quarter comes from
-- today_pkt(), never from current_date or date_trunc on a timestamptz, which would use UTC: at 00:30 PKT on
-- 1 April it is still 31 March in UTC. Today counts as elapsed (as v_target_progress does).
--   achieved_net   sum of net_portion of the caller's credited payments received in the quarter
--   excluded_count caller's credited payments in the quarter that cannot count (basis_unknown, zero_value)
--   gap / on_pace_net / behind_pace are NULL when no target is set.
-- Exposes no payment rows, order totals or costs.
--
-- my_target_progress_at(p_at) is the seam the tests use to put "now" on a boundary. It is not granted to
-- anyone but the owner, so clients cannot ask about other instants.
create function public.my_target_progress_at(p_at timestamptz)
returns table (
  year            smallint,
  quarter         smallint,
  quarter_end     date,
  target_net      numeric,
  achieved_net    numeric,
  gap             numeric,
  on_pace_net     numeric,
  behind_pace     numeric,
  excluded_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_pkt(p_at);
  v_year    smallint := extract(year from public.today_pkt(p_at))::smallint;
  v_quarter smallint := extract(quarter from public.today_pkt(p_at))::smallint;
  v_start   date;
  v_next    date;
  v_total   integer;
  v_elapsed integer;
  v_target  numeric;
  v_ach     numeric;
  v_excl    integer;
  v_pace    numeric;
begin
  if public.current_user_role() is null then
    return;
  end if;

  v_start := make_date(v_year, (v_quarter - 1) * 3 + 1, 1);
  v_next := (v_start + interval '3 months')::date;
  v_total := v_next - v_start;
  v_elapsed := least(greatest(v_today - v_start + 1, 0), v_total);

  select t.target_net_pkr into v_target
  from public.targets t
  where t.user_id = v_uid and t.year = v_year and t.quarter = v_quarter;

  select
    coalesce(sum(x.net) filter (where x.reason is null), 0),
    count(*) filter (where x.reason is not null)
  into v_ach, v_excl
  from (
    select
      case
        when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
        when b.g = 0 then 'zero_value'
      end as reason,
      case
        when 'value_basis_unknown' = any (o.legacy_flags) or b.g = 0 then null
        else round(p.amount * b.n / b.g, 2)
      end as net
    from public.payments_in p
    join public.orders o on o.id = p.order_id
    join public.v_order_items_total t on t.order_id = o.id
    cross join lateral (
      select count(*) as invoice_count,
             coalesce(sum(v.net_amount), 0) as invoice_net,
             coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross
      from public.invoices v
      where v.order_id = o.id
    ) iv
    cross join lateral (
      select case when iv.invoice_count > 0 then iv.invoice_net else t.net end as n,
             case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
    ) b
    where p.credited_user_id = v_uid
      and p.received_on >= v_start
      and p.received_on < v_next
  ) x;

  if v_target is not null then
    v_pace := round(v_target * v_elapsed / v_total, 2);
  end if;

  return query select
    v_year,
    v_quarter,
    (v_next - 1),
    v_target,
    v_ach::numeric(14,2),
    case when v_target is not null then greatest(v_target - v_ach, 0) end,
    v_pace,
    case when v_target is not null then greatest(v_pace - v_ach, 0) end,
    v_excl;
end;
$$;

revoke all on function public.my_target_progress_at(timestamptz) from public, anon, authenticated;

create function public.my_target_progress()
returns table (
  year            smallint,
  quarter         smallint,
  quarter_end     date,
  target_net      numeric,
  achieved_net    numeric,
  gap             numeric,
  on_pace_net     numeric,
  behind_pace     numeric,
  excluded_count  integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.my_target_progress_at(now())
$$;

revoke all on function public.my_target_progress() from public, anon, authenticated;
grant execute on function public.my_target_progress() to authenticated;
