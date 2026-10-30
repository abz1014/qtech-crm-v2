-- 0118_customer_credit (owner request 2026-10-30): the customer's credit balance, refunding it, and applying it to another order.
--
-- Credit balance of a customer (company) = what the orders hold above what they are worth, less what was given back, less what was
-- put against another order:
--     balance = SUM(v_order_money.overpaid_by) - SUM(customer_refunds.amount) - SUM(credit_applications.amount)
-- A credit note needs no term of its own: it lowers the order's gross (the invoice gross is net of credit notes, 0112), so a credit
-- note on an invoice that was already paid shows up as overpaid_by, and one on an unpaid invoice only lowers the receivable.
-- Counting credit notes again would count the same money twice.
--
--   v_company_credit   one row per customer that has any of the three: overpaid, refunded, applied, balance (admin only).
--   record_refund()    the one door for a refund (admin). A refund is refused when it is more than the customer's balance
--                      (HINT refund_exceeds_credit), and answers P0001 HINT duplicate_refund (the earlier date in DETAIL) when the same
--                      customer already has a refund of the same amount on the same day, or with the same reference, unless
--                      p_confirm_duplicate is true (as record_payment's duplicate_payment, 0114).
--   apply_credit()     the one door for applying credit to an order of the same customer (admin): refused above the balance
--                      (HINT credit_exceeds_balance) and above what that order still owes (HINT credit_exceeds_order). It is an
--                      allocation record: no payment row, no cash.
--   Settled            an order is settled by cash + WHT (0116) + the credit applied to it. order_receivables, v_order_money,
--                      aging_as_of (by applied_on), job_stage and the two month-end functions count it. void_invoice refuses
--                      when the applied credit already covers the invoice, delete_order refuses an order with refunds or applied credit.
--
-- The customer pool is not split by order: applying credit to order B leaves order A's overpaid_by as it was (A is still overpaid); the
-- balance takes the applied amount off. Expand-only except for the longer bodies of the functions named above and v_order_money.

-- ================================================================ the balance
create view public.v_company_credit with (security_invoker = true) as
with over as (
  select m.company_id, sum(m.overpaid_by) as overpaid
  from public.v_order_money m
  where m.overpaid_by > 0 and m.company_id is not null
  group by m.company_id
),
ref as (
  select r.company_id, sum(r.amount) as refunded
  from public.customer_refunds r
  group by r.company_id
),
app as (
  select a.company_id, sum(a.amount) as applied
  from public.credit_applications a
  group by a.company_id
),
cos as (
  select o.company_id from over o
  union
  select r.company_id from ref r
  union
  select a.company_id from app a
)
select
  c.company_id,
  coalesce(o.overpaid, 0)                                                  as overpaid,
  coalesce(r.refunded, 0)                                                  as refunded,
  coalesce(a.applied, 0)                                                   as applied,
  coalesce(o.overpaid, 0) - coalesce(r.refunded, 0) - coalesce(a.applied, 0) as balance
from cos c
left join over o on o.company_id = c.company_id
left join ref r on r.company_id = c.company_id
left join app a on a.company_id = c.company_id
where (select public.current_user_role()) = 'admin';

comment on view public.v_company_credit is
  '0118: the unapplied money a customer holds: overpayments (credit notes included, they lower the order gross) less refunds less credit applied to other orders. Admin only.';

revoke all on public.v_company_credit from public, anon, authenticated;
grant select on public.v_company_credit to authenticated;
grant select on public.v_company_credit to qtech_engineer;   -- 0081 mirror; the view has no row for anyone but an admin

-- ================================================================ record_refund
create function public.record_refund(
  p_id uuid, p_company_id uuid, p_order_id uuid, p_refunded_on date, p_amount numeric,
  p_paid_via text default 'bank', p_reference text default null, p_reason text default null,
  p_confirm_duplicate boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_dup     date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin records a refund.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount refunded.' using errcode = '22023', hint = 'amount';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'This company is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer_credit:' || p_company_id::text, 0));
  select coalesce(sum(v.balance), 0) into v_balance from public.v_company_credit v where v.company_id = p_company_id;
  if p_amount > v_balance then
    raise exception 'This customer holds Rs % of credit, so a refund of Rs % is more than they are owed. Record the overpayment or a credit note first.',
      to_char(greatest(v_balance, 0), 'FM999,999,999,990.00'), to_char(p_amount, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'refund_exceeds_credit', detail = greatest(v_balance, 0)::text;
  end if;
  if not coalesce(p_confirm_duplicate, false) then
    select r.refunded_on into v_dup
    from public.customer_refunds r
    where r.company_id = p_company_id
      and r.id <> p_id
      and ((r.amount = p_amount and r.refunded_on = coalesce(p_refunded_on, public.today_pkt()))
           or (nullif(btrim(p_reference), '') is not null and lower(btrim(r.reference)) = lower(btrim(p_reference))))
    order by (r.amount = p_amount and r.refunded_on = coalesce(p_refunded_on, public.today_pkt())) desc, r.refunded_on desc
    limit 1;
    if found then
      raise exception 'Looks like a refund already recorded on %.', to_char(v_dup, 'FMDD Mon YYYY')
        using errcode = 'P0001', hint = 'duplicate_refund', detail = v_dup::text;
    end if;
  end if;
  insert into public.customer_refunds (id, company_id, order_id, refunded_on, amount, paid_via, reference, reason)
  values (p_id, p_company_id, p_order_id, coalesce(p_refunded_on, public.today_pkt()), p_amount,
          coalesce(p_paid_via, 'bank'), nullif(btrim(p_reference), ''), nullif(btrim(p_reason), ''));
end;
$$;

revoke all on function public.record_refund(uuid, uuid, uuid, date, numeric, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, uuid, uuid, date, numeric, text, text, text, boolean) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ================================================================ apply_credit
create function public.apply_credit(
  p_id uuid, p_to_order_id uuid, p_amount numeric, p_applied_on date default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_balance numeric;
  v_owing   numeric;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin applies credit.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount to apply.' using errcode = '22023', hint = 'amount';
  end if;
  select o.company_id into v_company from public.orders o where o.id = p_to_order_id;
  if not found then
    raise exception 'This order is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer_credit:' || v_company::text, 0));
  select coalesce(sum(v.balance), 0) into v_balance from public.v_company_credit v where v.company_id = v_company;
  if p_amount > v_balance then
    raise exception 'This customer holds Rs % of credit, so Rs % cannot be applied.',
      to_char(greatest(v_balance, 0), 'FM999,999,999,990.00'), to_char(p_amount, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'credit_exceeds_balance', detail = greatest(v_balance, 0)::text;
  end if;
  select coalesce(sum(r.balance), 0) into v_owing from public.order_receivables(p_to_order_id) r;
  if p_amount > v_owing then
    raise exception 'That order only owes Rs %, so Rs % cannot be applied to it.',
      to_char(v_owing, 'FM999,999,999,990.00'), to_char(p_amount, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'credit_exceeds_order', detail = v_owing::text;
  end if;
  insert into public.credit_applications (id, company_id, to_order_id, applied_on, amount, note)
  values (p_id, v_company, p_to_order_id, coalesce(p_applied_on, public.today_pkt()), p_amount, nullif(btrim(p_note), ''));
end;
$$;

revoke all on function public.apply_credit(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.apply_credit(uuid, uuid, numeric, date, text) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ================================================================ void_invoice and delete_order know the credit
do $do$
declare
  def     text;
  patched text;
  a1      text := 'select coalesce(sum(p.amount), 0) into v_paid from public.payments_in p where p.order_id = v.order_id and p.voided_at is null;';
  a2      text := 'if exists (select 1 from public.payments_in p where p.order_id = p_order_id) then';
begin
  def := pg_catalog.pg_get_functiondef('public.void_invoice(uuid, text)'::regprocedure);
  if strpos(def, a1) = 0 then
    raise exception '0118: void_invoice was not in the expected shape';
  end if;
  patched := replace(def, a1, 'select coalesce(sum(p.amount), 0) + (select coalesce(sum(a.amount), 0) from public.credit_applications a where a.to_order_id = v.order_id)
      into v_paid from public.payments_in p where p.order_id = v.order_id and p.voided_at is null;');
  execute patched;

  def := pg_catalog.pg_get_functiondef('public.delete_order(uuid)'::regprocedure);
  if strpos(def, a2) = 0 then
    raise exception '0118: delete_order was not in the expected shape';
  end if;
  patched := replace(def, a2, 'if exists (select 1 from public.payments_in p where p.order_id = p_order_id)
     or exists (select 1 from public.credit_applications a where a.to_order_id = p_order_id)
     or exists (select 1 from public.customer_refunds f where f.order_id = p_order_id) then');
  execute patched;
end
$do$;

-- ================================================================ settled = cash + WHT + credit applied
-- ---------------------------------------------------------------- public.order_receivables
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
    iv.last_reminded_on,
    iv.reminder_count,
    case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
         when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
         else 'ok' end
  from public.orders o
  join public.v_order_items_total t on t.order_id = o.id
  cross join lateral (
    select count(*) as invoice_count,
           count(*) filter (where v.legacy_review = 'settled') as reviewed_invoices,
           coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross,
           min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id and v.voided_at is null
  ) iv
  cross join lateral (
    select case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
  ) b
  cross join lateral (
    select coalesce(sum(p.amount + p.wht_amount), 0) + (select coalesce(sum(a.amount), 0) from public.credit_applications a where a.to_order_id = o.id) as settled   -- 0118: plus the credit applied to this order
    from public.payments_in p where p.order_id = o.id and p.voided_at is null
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
    select (iv.first_invoice_date + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ---------------------------------------------------------------- public.v_order_money
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
                                                  where v.order_id = o.id and v.voided_at is null and v.legacy_review is distinct from 'settled'))) as reviewed
) rv
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount + p.wht_amount), 0) + (select coalesce(sum(a.amount), 0) from public.credit_applications a where a.to_order_id = o.id) as settled   -- 0118: plus the credit applied to this order
  from public.payments_in p where p.order_id = o.id and p.voided_at is null
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
  where v.order_id = o.id and v.voided_at is null
) d
where (select public.current_user_role()) = 'admin';

-- ---------------------------------------------------------------- public.aging_as_of
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
           v.net_amount + v.gst_amount
             - coalesce((select sum(c.net_amount + c.gst_amount) from public.credit_notes c
                         where c.invoice_id = v.id and c.issued_on <= p_date), 0) as gross,
           (v.legacy_review = 'settled' or o.legacy_review = 'settled') as reviewed_settled
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= p_date
      and not v.settled_before_cutover
      and v.voided_at is null
      and (select public.current_user_role()) = 'admin'
  ),
  paid as (
    -- 0118: cash + WHT by the day received, and the credit applied to the order by the day it was applied
    select x.ordid, sum(x.amt) as paid
    from (
      select p.order_id as ordid, p.amount + p.wht_amount as amt
      from public.payments_in p
      where p.received_on <= p_date
        and p.voided_at is null
        and (select public.current_user_role()) = 'admin'
      union all
      select a.to_order_id, a.amount
      from public.credit_applications a
      where a.applied_on <= p_date
        and (select public.current_user_role()) = 'admin'
    ) x
    group by x.ordid
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

-- ---------------------------------------------------------------- public.job_stage
create or replace function public.job_stage(p_rfq_id uuid, p_order_id uuid)
returns table (stage text, stage_detail text, is_history boolean, last_activity_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with
  r as (
    select x.id, x.received_on, x.quoted_on, x.closed_on, x.close_reason
    from public.rfqs x
    where x.id = p_rfq_id
  ),
  rf as (
    select
      (select count(*) from public.supplier_inquiries i
        where i.rfq_id = p_rfq_id and (i.sent_on is not null or i.no_offer_on is not null)) as asked,
      (select count(*) from public.supplier_inquiries i
        where i.rfq_id = p_rfq_id
          and (i.no_offer_on is not null or exists (select 1 from public.supplier_quote_lines l where l.inquiry_id = i.id))) as replied,
      (select count(*) from public.rfq_items i where i.rfq_id = p_rfq_id) as items_total,
      (select count(*) from public.rfq_items i
        where i.rfq_id = p_rfq_id
          and exists (select 1 from public.supplier_quote_lines l where l.rfq_item_id = i.id)) as items_priced,
      (select q.valid_until from public.quotations q where q.rfq_id = p_rfq_id order by q.revision desc limit 1) as valid_until
    where p_rfq_id is not null
  ),
  ord as (
    select o.id, o.cancelled_on, o.ordered_on, o.needs_commissioning, o.commissioning_planned_on, o.commissioning_done_on
    from public.orders o
    where o.id = coalesce(p_order_id,
                          (select c.id from public.orders c
                           where c.rfq_id = p_rfq_id and c.cancelled_on is not null
                           order by c.number desc limit 1))
  ),
  ob as (
    select
      o.*,
      gi.goods_items, gi.unsourced,
      lg.n_legs, lg.n_unplaced, lg.n_delivered, lg.n_received, lg.n_late, lg.last_leg_on,
      iv.invoice_count, iv.invoice_gross, iv.last_invoice_on,
      py.settled, py.last_paid_on,
      it.items_gross
    from ord o
    cross join lateral (
      select
        count(*) filter (where not i.is_service) as goods_items,
        count(*) filter (where not i.is_service and i.supplier_order_id is null) as unsourced
      from public.order_items i
      where i.order_id = o.id
    ) gi
    cross join lateral (
      select
        count(*)                                                                         as n_legs,
        count(*) filter (where l.placed_on is null)                                      as n_unplaced,
        count(*) filter (where l.delivered_on is not null)                               as n_delivered,
        count(*) filter (where l.received_on is not null or l.delivered_on is not null)  as n_received,
        count(*) filter (where l.expected_on < public.today_pkt()
                           and l.received_on is null and l.delivered_on is null)         as n_late,
        max(greatest(l.placed_on, l.received_on, l.delivered_on, l.last_chased_on))      as last_leg_on
      from public.supplier_orders l
      where l.id in (select i.supplier_order_id from public.order_items i
                     where i.order_id = o.id and not i.is_service and i.supplier_order_id is not null)
    ) lg
    cross join lateral (
      select count(*) as invoice_count,
             coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross,
             max(v.invoice_date) as last_invoice_on
      from public.invoices v
      where v.order_id = o.id and v.voided_at is null
    ) iv
    cross join lateral (
      select coalesce(sum(p.amount + p.wht_amount), 0) + (select coalesce(sum(a.amount), 0) from public.credit_applications a where a.to_order_id = o.id) as settled, max(p.received_on) as last_paid_on   -- 0118: plus applied credit
      from public.payments_in p
      where p.order_id = o.id and p.voided_at is null
    ) py
    cross join lateral (
      -- the order lines' gross, line by line as qtech_private.order_item_totals (0081) rounds it
      select coalesce(sum(round(i.qty * i.unit_price_net, 2) + round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0)), 0) as items_gross
      from public.order_items i
      where i.order_id = o.id
    ) it
  ),
  ox as (
    select
      b.*,
      case
        when b.goods_items = 0 then 'n_a'
        when b.unsourced > 0 then 'to_source'
        when b.n_unplaced > 0 then 'to_place'
        when b.n_delivered = b.n_legs then 'delivered'
        when b.n_received = b.n_legs then 'received'
        when b.n_late > 0 then 'late'
        when b.n_delivered > 0 then 'partly_delivered'
        else 'on_order'
      end as goods,
      case
        when not b.needs_commissioning then 'n_a'
        when b.commissioning_done_on is not null then 'done'
        when b.commissioning_planned_on is not null then 'planned'
        else 'to_plan'
      end as comm,
      case
        when b.invoice_count = 0 then 'not_invoiced'
        when b.invoice_gross >= b.items_gross - 1 then 'full'
        else 'part'
      end as inv,
      (case when b.invoice_count > 0 then b.invoice_gross else b.items_gross end) as g
    from ob b
  ),
  oy as (
    select x.*, (x.g > 0 and x.settled >= x.g - 1) as settled_ok from ox x
  ),
  b as (
    select
      r.id as rfq_id, r.received_on, r.quoted_on, r.closed_on, r.close_reason,
      rf.asked, rf.replied, rf.items_total, rf.items_priced, rf.valid_until,
      oy.id as order_id, oy.cancelled_on, oy.ordered_on, oy.commissioning_done_on, oy.commissioning_planned_on,
      oy.goods, oy.comm, oy.inv, oy.settled, oy.settled_ok, oy.n_legs, oy.n_delivered, oy.invoice_count, oy.invoice_gross,
      oy.last_leg_on, oy.last_invoice_on, oy.last_paid_on
    from (select 1) d
    left join r on true
    left join rf on true
    left join oy on true
  ),
  st as (
    select
      b.*,
      case
        when b.order_id is not null and b.cancelled_on is not null then 'cancelled'
        when b.order_id is not null then
          case
            when b.goods not in ('n_a', 'delivered') then
              case when b.goods in ('to_source', 'to_place') then 'ordered' else 'supplier_ordered' end
            when b.inv <> 'full' then 'delivered'
            when not b.settled_ok then 'invoiced'
            else 'paid'
          end
        when b.rfq_id is null then null
        when b.closed_on is not null then 'lost'
        when b.quoted_on is not null then 'quoted'
        when b.items_priced > 0 then 'prices_in'
        when b.asked > 0 then 'asking_suppliers'
        else 'enquiry'
      end as stage,
      -- money still open on a cancelled order: an invoice not paid, or an advance still held
      coalesce((b.invoice_count > 0 and b.settled < b.invoice_gross - 1) or (b.invoice_count = 0 and b.settled > 0), false) as money_open
    from b
  )
  select
    st.stage,
    case st.stage
      when 'cancelled' then concat_ws(', ', 'order cancelled', case when st.money_open then 'money still open' end)
      when 'lost' then case st.close_reason
        when 'price' then 'price too high'
        when 'competitor' then 'went to a competitor'
        when 'no_reply_to_clarification' then 'no reply from the customer'
        when 'customer_cancelled' then 'customer cancelled'
        when 'could_not_source' then 'could not source'
        when 'we_were_late' then 'we were late'
        else 'closed' end
      when 'quoted' then case when st.valid_until < public.today_pkt() then 'quotation expired' else 'waiting for the customer' end
      when 'prices_in' then st.items_priced::text || ' of ' || st.items_total::text || ' items priced'
      when 'asking_suppliers' then st.replied::text || ' of ' || st.asked::text || ' suppliers replied'
      when 'enquiry' then 'suppliers not asked yet'
      when 'ordered' then concat_ws(', ',
        case st.goods when 'to_source' then 'to source' else 'supplier order to place' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end)
      when 'supplier_ordered' then concat_ws(', ',
        case st.goods
          when 'on_order' then 'with the supplier'
          when 'late' then 'supplier late'
          when 'received' then 'arrived, not delivered'
          when 'partly_delivered' then st.n_delivered::text || ' of ' || st.n_legs::text || ' delivered'
        end,
        case when st.inv <> 'not_invoiced' then 'invoiced' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end)
      when 'delivered' then concat_ws(', ',
        case st.inv when 'not_invoiced' then 'not invoiced yet' else 'partly invoiced' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end,
        case st.comm when 'to_plan' then 'installation to plan'
                     when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end)
      when 'invoiced' then concat_ws(', ',
        case when st.settled > 0 then 'part paid' else 'not paid yet' end,
        case st.comm when 'to_plan' then 'installation to plan'
                     when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end)
      when 'paid' then case st.comm when 'to_plan' then 'installation to plan'
                                    when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end
    end as stage_detail,
    case
      when st.stage = 'lost' then true
      when st.stage = 'cancelled' then not st.money_open
      when st.stage = 'paid' then st.comm in ('n_a', 'done')
      else false
    end as is_history,
    greatest(
      st.received_on, st.quoted_on, st.closed_on,
      (select max(greatest(i.sent_on, i.last_chased_on, i.no_offer_on)) from public.supplier_inquiries i where i.rfq_id = st.rfq_id),
      -- a person's own entries only: an imported line carries the import run's date
      (select max((l.created_at at time zone 'Asia/Karachi')::date)
         from public.supplier_quote_lines l join public.supplier_inquiries i on i.id = l.inquiry_id
         where i.rfq_id = st.rfq_id and l.legacy_source is null),
      (select max(q.issued_on) from public.quotations q where q.rfq_id = st.rfq_id),
      (select max(greatest((c.first_asked_at at time zone 'Asia/Karachi')::date,
                           (c.last_asked_at at time zone 'Asia/Karachi')::date,
                           (c.answered_at at time zone 'Asia/Karachi')::date))
         from public.clarifications c where c.rfq_id = st.rfq_id),
      st.ordered_on, st.commissioning_done_on, st.last_leg_on, st.last_invoice_on, st.last_paid_on
    ) as last_activity_on
  from st
  where (select public.current_user_role()) is not null
$$;

-- ---------------------------------------------------------------- public.month_end_status
create or replace function public.month_end_status(p_month date)
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
  frozen as (
    select (e ->> 'check_key')::text as check_key, (e ->> 'n')::int as n
    from public.month_snapshots s
    cross join b
    cross join lateral jsonb_array_elements(s.status) e
    where s.month = b.m_start
  ),
  checks as (
    select 'bank_unticked'::text as check_key,
           ((select count(*) from public.payments_in p, b
             where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end
               and p.voided_at is null)
          + (select count(*) from public.expenses e, b
             where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end)
          + (select count(*) from public.customer_refunds r, b   -- 0117: a refund paid by bank is ticked too
             where r.paid_via = 'bank' and r.bank_month is null and r.refunded_on <= b.m_end))::int as n
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
              and (select coalesce(sum(p.amount + p.wht_amount), 0) from public.payments_in p
                   where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null)
                   + (select coalesce(sum(a.amount), 0) from public.credit_applications a   -- 0118: credit applied counts as settled
                      where a.to_order_id = o.id and a.applied_on <= b.m_end) >= ob.g - 1)::int
    union all
    select 'fbr_pending',
           (select count(*) from public.invoices v, b
            where v.invoice_date <= b.m_end and v.tax_deposited_on is null and v.gst_amount > 0)::int
    union all
    select 'unresolved_payments',
           (select count(*) from public.v_payment_net p, b
            where p.received_on between b.m_start and b.m_end
              and p.excluded_reason in ('basis_unknown', 'zero_value'))::int
  )
  select f.check_key, f.n from frozen f
  where public.current_user_role() = 'admin'
  union all
  select c.check_key, c.n from checks c
  where public.current_user_role() = 'admin'
    and not exists (select 1 from frozen)
$$;

-- ---------------------------------------------------------------- public.month_end_check_details
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
    union all
    select r.amount, r.refunded_on from public.customer_refunds r, b   -- 0117: a refund paid by bank is money out on the statement
    where r.paid_via = 'bank' and r.bank_month is null and r.refunded_on <= b.m_end
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
      and (select coalesce(sum(p.amount + p.wht_amount), 0) from public.payments_in p
           where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null)
                   + (select coalesce(sum(a.amount), 0) from public.credit_applications a   -- 0118: credit applied counts as settled
                      where a.to_order_id = o.id and a.applied_on <= b.m_end) >= ob.g - 1
  ),
  pending as (
    select r.number, r.invoice_date, r.gst_amount
    from public.v_gst_register r, b
    where r.invoice_date <= b.m_end and r.tax_deposited_on is null and r.gst_amount > 0   -- 0074: the same predicate as month_end_status
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
  where (select public.current_user_role()) = 'admin'
  union all
  select d.check_key, case when (select is_closed from closed) then d.detail || '{"live": true}'::jsonb else d.detail end
  from details d
  where (select public.current_user_role()) = 'admin'
    and not exists (select 1 from frozen)
$$;

