-- 0059_default_payment_terms (audit Y1): a company-wide default for payment terms.
--
-- orders.payment_terms_days is nullable, and with no terms there was no due date, so "payment overdue" never fired for
-- the first order from a new customer. company_profile now carries default_payment_terms_days (30, editable by admin in
-- Settings > Company profile). It is used whenever an order has no terms of its own:
--
--   due_on = earliest invoice date + coalesce(orders.payment_terms_days, company_profile.default_payment_terms_days)
--
-- The order row is NOT rewritten: an order with null terms follows the default, so changing the default moves those orders.
-- Terms an order has (including 0) always win. order_receivables() and v_order_money() are re-created with the same columns.

alter table public.company_profile
  add column default_payment_terms_days smallint not null default 30
    check (default_payment_terms_days >= 0 and default_payment_terms_days <= 365);

comment on column public.company_profile.default_payment_terms_days is
  'Payment terms in days used for any order that has none of its own (audit Y1). Drives the due date and the payment-overdue reminder.';

-- ================================================================ order_receivables
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
    select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
  ) cp
  cross join lateral (
    select (iv.first_invoice_date + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  ) d
  where p_order_id is null or o.id = p_order_id
  order by o.number;
end;
$$;

revoke all on function public.order_receivables(uuid) from public, anon, authenticated;
grant execute on function public.order_receivables(uuid) to authenticated;

-- ================================================================ v_order_money
create or replace view public.v_order_money with (security_invoker = true) as
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
  select coalesce(sum(x.amount_pkr - x.input_tax_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
) cp
cross join lateral (
  select (min(v.invoice_date) + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  from public.invoices v
  where v.order_id = o.id

) d
where public.current_user_role() = 'admin';
