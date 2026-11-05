-- 0137 order profit: one row per order with what was spent, what was received and what is left, both ways.
-- Owner decision (2026-11-05): headline income is INVOICED NET OF GST, with cash received beside it. The cash view includes GST.
--
-- v_order_profit   one row per order (admin only, security_invoker; it reads v_order_money, which is admin only too):
--   net_sale, actual_cost, expected_cost, margin, margin_state ... the invoiced-basis figures exactly as v_order_money has them (0127).
--                    GST is outside both sides; expenses count net of recoverable input tax.
--   received         cash received for the order: settled (payments + tax withheld by the customer + credit applied to the order)
--                    less what was paid back or put against another order out of it (refunds and credit moved out, known sources only).
--                    GST is INSIDE this figure.
--   paid_out         every expense tagged to the order, GROSS (amount_pkr, input tax included): what really left the bank.
--   cash_profit      received - paid_out. The GST owed to FBR is not taken off: the screens say "includes GST".
-- v_order_money is not changed. Expand-only: one new view.

create view public.v_order_profit with (security_invoker = true) as
select
  m.order_id,
  m.order_number,
  m.company_id,
  m.basis,
  m.net_sale,
  m.actual_cost,
  m.expected_cost,
  m.margin,
  m.margin_state,
  m.costs_state,
  m.payment_state,
  r.received,
  x.paid_out,
  r.received - x.paid_out as cash_profit
from public.v_order_money m
cross join lateral (
  select m.settled
         - coalesce((select sum(f.amount) from public.customer_refunds f where f.order_id = m.order_id), 0)
         - coalesce((select sum(a.amount) from public.credit_applications a where a.from_order_id = m.order_id), 0) as received
) r
cross join lateral (
  select coalesce(sum(e.amount_pkr), 0) as paid_out from public.expenses e where e.order_id = m.order_id
) x
where (select public.current_user_role()) = 'admin';

comment on view public.v_order_profit is
  '0137: per order, invoiced-basis margin (net of GST, as v_order_money) and the cash view: received (settled less refunds and credit moved out, GST included), paid_out (gross expenses), cash_profit (received less paid_out). Admin only.';

revoke all on public.v_order_profit from public, anon, authenticated;
grant select on public.v_order_profit to authenticated;
grant select on public.v_order_profit to qtech_engineer;   -- 0081 mirror; the view has no row for anyone but an admin
