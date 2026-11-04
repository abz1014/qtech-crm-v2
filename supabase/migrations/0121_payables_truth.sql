-- 0121_payables_truth (process audit 3 and 4).
--
--   3. payables_as_of() treated "3% or less left" as settled for every currency. The 3% is FX slippage, so it now applies to
--      foreign-currency legs only; a PKR leg is settled when Rs 1 or less is left (the same Rs 1 allowance as receivables).
--   4. A supplier leg of a CANCELLED customer order used to vanish from "We owe suppliers" (the money was still owed). A leg stays
--      owing once it was placed with the supplier, until the supplier agrees to cancel it: supplier_orders.cancelled_with_supplier_on
--      ("Cancelled with supplier"). A leg cancelled with the supplier that still has a payment on it stays on the list for what is
--      left (partial payment). Supplier payments may be recorded on a cancelled order (nothing in the database stopped it; the app did).
--
-- Expand-only for the data: one nullable date column. payables_as_of gains a column (cancelled_with_supplier_on), so the function
-- is dropped and created; its only caller is the app. No price reaches an engineer: the column is a date, the function admin-only.

alter table public.supplier_orders add column cancelled_with_supplier_on date;
comment on column public.supplier_orders.cancelled_with_supplier_on is
  '0121: the day the supplier agreed to cancel this supplier order ("cancelled with supplier"). NULL: still live with the supplier, so what is unpaid is still owed even if the customer order was cancelled.';

drop function if exists public.payables_as_of(date);

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
  flag               text,
  cancelled_with_supplier_on date
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
      case when l.cancelled_with_supplier_on <= p_date then l.cancelled_with_supplier_on end as cancelled_on
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
      and public.current_user_role() = 'admin'
  ),
  paid as (
    select g.*,
           coalesce(x.paid, 0) as paid,
           coalesce(x.paid_fx, 0) as paid_fx,
           coalesce(x.paid_fx_pkr, 0) as paid_fx_pkr,
           coalesce(x.n, 0) as pay_count
    from legs g
    left join lateral (
      select sum(e.amount_pkr - e.input_tax_pkr) as paid,
             sum(e.fx_amount) filter (where e.fx_currency = g.cur) as paid_fx,
             sum(e.amount_pkr - e.input_tax_pkr) filter (where e.fx_currency = g.cur) as paid_fx_pkr,
             count(*) as n
      from public.expenses e
      where e.supplier_order_id = g.leg_id
        and e.category_id = 'ca7e0000-0000-4000-8000-000000000011'
        and e.paid_on <= p_date
    ) x on true
  ),
  priced as (
    select g.*,
           case when g.cur = 'PKR' then 1::numeric
                else (select r.rate_pkr from public.fx_rates r
                      where r.currency = g.cur and r.as_of <= p_date and r.as_of >= p_date - 30
                      order by r.as_of desc, (r.source = 'manual') desc limit 1) end as rate
    from paid g
    -- 0121: cancelled with the supplier and nothing paid: nothing is owed and the leg is off the list
    where not (g.cancelled_on is not null and g.pay_count = 0)
  ),
  calc as (
    select x.*,
           round(x.committed * x.rate, 2) as committed_pkr,
           -- 0087: a payment made in the leg's own currency settles that much of it at any rate; only the rest is converted
           case when x.paid_fx > 0 and x.committed is not null and x.committed - x.paid_fx <= 0 then 0 - (x.paid - x.paid_fx_pkr)
                when x.paid_fx > 0 then round((x.committed - x.paid_fx) * x.rate, 2) - (x.paid - x.paid_fx_pkr)
                else round(x.committed * x.rate, 2) - x.paid end as raw_owed,
           (x.paid_fx > 0 and x.committed is not null and x.paid_fx >= x.committed) as paid_in_full_fx
    from priced x
  )
  select c.leg_id, c.ordid, c.order_number, c.supplier_id, c.supplier_name, c.cur, c.committed, c.rate,
         c.committed_pkr, c.paid,
         case when c.paid_in_full_fx then greatest(coalesce(c.raw_owed, 0), 0)
              when c.committed_pkr is not null then greatest(c.raw_owed, 0) end,
         case when c.committed is null then 'unpriced'
              when c.paid_in_full_fx then 'settled'
              when c.rate is null then 'no_rate'
              -- 0121: the 3% is exchange-rate slippage, so it is for foreign-currency legs only; a PKR leg is settled within Rs 1
              when c.cur <> 'PKR' and c.raw_owed <= 0.03 * c.committed_pkr then 'settled'
              when c.cur = 'PKR' and c.raw_owed <= 1 then 'settled'
              else 'owing' end,
         case when c.raw_owed < 0 then 'overpaid' end,
         c.cancelled_on
  from calc c
$$;

revoke all on function public.payables_as_of(date) from public, anon;
grant execute on function public.payables_as_of(date) to authenticated, qtech_engineer;   -- 0081 mirror; returns no row for anyone but an admin

-- Mark a supplier order cancelled with the supplier (or live again). Admin only; only a placed supplier order can be.
create function public.set_supplier_order_cancelled(p_leg uuid, p_cancelled boolean, p_on date default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_placed date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin cancels a supplier order with the supplier.' using errcode = '42501';
  end if;
  select l.placed_on into v_placed from public.supplier_orders l where l.id = p_leg;
  if not found then
    raise exception 'That supplier order was not found.' using errcode = 'P0002';
  end if;
  if p_cancelled and v_placed is null then
    raise exception 'This supplier order was never placed, so there is nothing to cancel with the supplier.' using errcode = 'P0001';
  end if;
  update public.supplier_orders
     set cancelled_with_supplier_on = case when p_cancelled then coalesce(p_on, public.today_pkt()) end
   where id = p_leg;
end;
$$;

revoke all on function public.set_supplier_order_cancelled(uuid, boolean, date) from public, anon;
grant execute on function public.set_supplier_order_cancelled(uuid, boolean, date) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin
