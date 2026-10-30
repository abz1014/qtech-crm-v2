-- 0123_invoice_due_dates (process audit 2). A due date per INVOICE (invoice date + the order's terms), not one for the whole order.
--
-- Before: the order's due date was the EARLIEST invoice date + terms (0096), so a part invoice issued after the first was paid fell
-- "overdue" the day it was issued. Now:
--   * every invoice has its own due date: its date + the order's payment terms (else the company default);
--   * payments are allocated to invoices OLDEST FIRST, unless a payment is tied to an invoice (payments_in.invoice_id): a tied payment
--     goes to its own invoice first, anything over its gross joins the untied money, which then fills the oldest unpaid invoices first;
--   * the order's overdue status, due date and reminder state follow its OLDEST UNPAID invoice (unpaid = more than Rs 1 still open,
--     the same Rs 1 allowance as the order). An order with nothing unpaid shows its earliest invoice due date, as before;
--   * aging_as_of applies tied payments first, then oldest first.
-- Expand-only: one nullable column. order_receivables, v_order_money and aging_as_of keep their columns. With no tied payment and
-- one invoice per order every figure is what it was.

alter table public.payments_in add column invoice_id uuid references public.invoices (id) on delete set null;
create index payments_in_invoice_idx on public.payments_in (invoice_id) where invoice_id is not null;
comment on column public.payments_in.invoice_id is
  '0123: the invoice this payment was received for, when the customer said so. NULL: not tied; it settles the order''s oldest unpaid invoice first.';

-- A tied payment must be for an invoice on its own order. A correction (0073) keeps the tie of the payment it replaces.
create function public.payments_in_invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.invoice_id is null and new.corrects_payment_id is not null then
    select p.invoice_id into new.invoice_id from public.payments_in p where p.id = new.corrects_payment_id;
  end if;
  if new.invoice_id is not null
     and not exists (select 1 from public.invoices v where v.id = new.invoice_id and v.order_id = new.order_id) then
    raise exception 'That invoice is not on this order.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.payments_in_invoice_guard() from public, anon, authenticated;

create trigger payments_in_invoice_guard before insert or update of invoice_id, order_id on public.payments_in
  for each row execute function public.payments_in_invoice_guard();

-- ---------------------------------------------------------------- order_receivables (0096, per-invoice due)
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
  v_role text := (select public.current_user_role());
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
    case when rv.reviewed then 0::numeric else greatest(b.g - s.settled, 0) end,
    greatest(s.settled - b.g, 0),
    d.due_on,
    (d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok),
    case
      when d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok then 'overdue'
      when ok.settled_ok then 'settled'
      when s.settled > 0 then 'part'
      else 'unpaid'
    end,
    case when al.unpaid_n > 0 then al.drv_reminded else iv.last_reminded_on end,
    case when al.unpaid_n > 0 then coalesce(al.drv_count, 0)::smallint else iv.reminder_count end,
    case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
         when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
         else 'ok' end
  from public.orders o
  join public.v_order_items_total t on t.order_id = o.id
  cross join lateral (
    select count(*) as invoice_count,
           count(*) filter (where v.legacy_review = 'settled') as reviewed_invoices,
           coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross,
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
    -- 0096: the owner reviewed it as settled (the order, or every invoice on it)
    select (coalesce(o.legacy_review = 'settled', false) or (iv.invoice_count > 0 and iv.reviewed_invoices = iv.invoice_count)) as reviewed
  ) rv
  cross join lateral (
    select (rv.reviewed or (b.g > 0 and s.settled >= b.g - 1)) as settled_ok
  ) ok
  cross join lateral (
    select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
  ) cp
  cross join lateral (
    -- 0123: each invoice with its own due date (its date + terms); payments tied to an invoice go to it first, the rest oldest first
    select min(a.due_on) filter (where a.unpaid) as due_unpaid,
           min(a.due_on) as due_any,
           count(*) filter (where a.unpaid) as unpaid_n,
           (array_agg(a.last_reminded_on order by a.inv_date, a.number, a.id) filter (where a.unpaid))[1] as drv_reminded,
           (array_agg(a.reminder_count order by a.inv_date, a.number, a.id) filter (where a.unpaid))[1] as drv_count
    from (
      select y.*,
             (not y.reviewed
              and y.r_open - least(y.r_open, greatest(y.pool - coalesce(sum(y.r_open) over (order by y.inv_date, y.number, y.id
                                                                          rows between unbounded preceding and 1 preceding), 0), 0)) > 1) as unpaid
      from (
        select v.id, v.number, v.last_reminded_on, v.reminder_count,
               coalesce(v.legacy_review = 'settled', false) as reviewed,
               coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) as inv_date,
               coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) + coalesce(o.payment_terms_days, cp.days)::int as due_on,
               (v.net_amount + v.gst_amount) - least(v.net_amount + v.gst_amount, tp.tied) as r_open,
               un.untied + coalesce(sum(greatest(tp.tied - (v.net_amount + v.gst_amount), 0)) over (), 0) as pool
        from public.invoices v
        cross join lateral (
          select coalesce(sum(p.amount), 0) as tied from public.payments_in p where p.invoice_id = v.id and p.voided_at is null
        ) tp
        cross join lateral (
          select coalesce(sum(p.amount), 0) as untied
          from public.payments_in p
          where p.order_id = o.id and p.voided_at is null
            and (p.invoice_id is null
                 or not exists (select 1 from public.invoices i2 where i2.id = p.invoice_id and i2.order_id = o.id and not i2.settled_before_cutover))
        ) un
        where v.order_id = o.id and not v.settled_before_cutover
      ) y
    ) a
  ) al
  cross join lateral (
    select coalesce(al.due_unpaid, al.due_any) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ---------------------------------------------------------------- v_order_money (0096, per-invoice due)
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
  (rv.reviewed or (gm.g > 0 and s.settled >= gm.g - 1)) as settled_ok,
  case when rv.reviewed then 0::numeric else greatest(gm.g - s.settled, 0) end as receivable,
  greatest(s.settled - gm.g, 0) as overpaid_by,
  d.due_on,
  case
    when rv.reviewed then 'settled'
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
cross join lateral (
  -- 0096: the owner reviewed it as settled (the order, or every invoice on it)
  select (coalesce(o.legacy_review = 'settled', false)
          or (b.invoice_count > 0 and not exists (select 1 from public.invoices v
                                                  where v.order_id = o.id and v.legacy_review is distinct from 'settled'))) as reviewed
) rv
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
  -- 0123: the due date of the OLDEST UNPAID invoice (its date + terms); else the earliest invoice due date
  select coalesce(min(a.due_on) filter (where a.unpaid), min(a.due_on)) as due_on
  from (
    select y.*,
           (not y.reviewed
            and y.r_open - least(y.r_open, greatest(y.pool - coalesce(sum(y.r_open) over (order by y.inv_date, y.number, y.id
                                                                        rows between unbounded preceding and 1 preceding), 0), 0)) > 1) as unpaid
    from (
      select v.id, v.number,
             coalesce(v.legacy_review = 'settled', false) as reviewed,
             coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) as inv_date,
             coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) + coalesce(o.payment_terms_days, cp.days)::int as due_on,
             (v.net_amount + v.gst_amount) - least(v.net_amount + v.gst_amount, tp.tied) as r_open,
             un.untied + coalesce(sum(greatest(tp.tied - (v.net_amount + v.gst_amount), 0)) over (), 0) as pool
      from public.invoices v
      cross join lateral (
        select coalesce(sum(p.amount), 0) as tied from public.payments_in p where p.invoice_id = v.id and p.voided_at is null
      ) tp
      cross join lateral (
        select coalesce(sum(p.amount), 0) as untied
        from public.payments_in p
        where p.order_id = o.id and p.voided_at is null
          and (p.invoice_id is null
               or not exists (select 1 from public.invoices i2 where i2.id = p.invoice_id and i2.order_id = o.id and not i2.settled_before_cutover))
      ) un
      where v.order_id = o.id and not v.settled_before_cutover
    ) y
  ) a
) d
where (select public.current_user_role()) = 'admin';

-- ---------------------------------------------------------------- aging_as_of (0096, tied payments first)
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
           v.net_amount + v.gst_amount as gross,
           (v.legacy_review = 'settled' or o.legacy_review = 'settled') as reviewed_settled
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= p_date
      and not v.settled_before_cutover
      and (select public.current_user_role()) = 'admin'
  ),
  paid as (
    select p.order_id as ordid, sum(p.amount) as paid
    from public.payments_in p
    where p.received_on <= p_date
      and p.voided_at is null
      and (select public.current_user_role()) = 'admin'
    group by p.order_id
  ),
  tied as (
    -- 0123: money the customer said was for one invoice
    select p.invoice_id, sum(p.amount) as tied
    from public.payments_in p
    where p.invoice_id is not null
      and p.received_on <= p_date
      and p.voided_at is null
      and (select public.current_user_role()) = 'admin'
    group by p.invoice_id
  ),
  fifo as (
    select i.*,
           coalesce(pd.paid, 0) as paid,
           least(i.gross, coalesce(t.tied, 0)) as tied_applied,
           -- the money left to place oldest first: all received, less what went to the invoice it was tied to
           coalesce(pd.paid, 0) - coalesce(sum(least(i.gross, coalesce(t.tied, 0))) over (partition by i.ordid), 0) as pool,
           coalesce(sum(i.gross - least(i.gross, coalesce(t.tied, 0))) over (partition by i.ordid order by i.invoice_date, i.number, i.id
                                                                             rows between unbounded preceding and 1 preceding), 0) as before_open
    from inv i
    left join paid pd on pd.ordid = i.ordid
    left join tied t on t.invoice_id = i.id
  ),
  fa as (
    select f.*,
           f.tied_applied + least(f.gross - f.tied_applied, greatest(f.pool - f.before_open, 0)) as applied_amt,
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
    and not coalesce(a.reviewed_settled, false)
  union all
  select 'advance'::text, o.id, o.number, o.company_id, null::uuid, null::text, null::date, null::numeric,
         null::numeric, null::numeric, null::int,
         -- decision 1: an advance on an order cancelled by the date is held for a refund or kept, not waiting for an invoice
         case when o.cancelled_on is not null and o.cancelled_on <= p_date then 'cancelled' end,
         pd.paid
  from paid pd
  join public.orders o on o.id = pd.ordid
  where pd.paid > 0
    and not exists (select 1 from inv i where i.ordid = pd.ordid)
    and o.legacy_review is distinct from 'settled'
$$;
