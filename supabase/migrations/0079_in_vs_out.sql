-- 0079_in_vs_out (owner request 2026-10-20): "a proper in vs out of every month and every quarter", and fuel per car or
-- the office water bill visible without one category per car.
--
-- Three read-only views, admin only (the same rule as every other money view: rows only when current_user_role() is admin,
-- wrapped in a sub-select as 0074 requires). Nothing is written and no table changes. The owner decision of 2026-10-20 is
-- to show both views an accountant would: the money trail (v_month_cash_flow) and profit on the invoiced basis
-- (v_month_profit, at the end of this file). v_month_pnl is NOT the invoiced basis: it counts payments received (net of GST)
-- against expenses paid, so it stays what the "Profit and loss" report shows and is not reused here.
--
-- v_month_cash_flow        one row per Karachi calendar month with money in it:
--   money_in         customer payments received in the month (received_on), GROSS: GST inside the payment included.
--                    Voided payments (0073) are left out.
--   payments_count   how many payments that is.
--   money_out        every expense paid in the month (paid_on), GROSS: input tax included, every category, so supplier
--                    payments, freight and clearing, overheads, and the not-in-P&L ones (owner drawings, loan repayment) too.
--                    Cash leaving the business is cash leaving the business.
--   expenses_count   how many expenses that is.
--   frozen           true when the month is closed and has a snapshot (0058). Its figures then come from the snapshot taken
--                    at close: money_in = net_in + gst_in + unresolved_gross (together every non-voided payment of the month,
--                    v_payment_net has exactly one row per payment), payments_count = payments.count, money_out =
--                    cash_out_total, expenses_count = via.cash_count + via.bank_count. The month lock (0027) keeps a closed
--                    month's payments and expenses from changing, so the frozen and live figures agree; the snapshot is
--                    still the one served, as v_month_pnl does.
--   No quarter view: a quarter is the sum of its three months (the app adds them in paisa).
--
-- v_month_cash_out_detail   the money out of a month by category and by the expense's detail (its description, the one
--                    optional "Detail" field: "LEA-1234", "Office water"), live. Details are matched ignoring case and extra
--                    spaces; an expense with no detail is one row with detail NULL. A closed month cannot change (month
--                    lock), so its rows add up to the frozen money_out; the app shows any difference as its own line.
--   gross_paid       sum of amount_pkr (gross, as money_out).   expense_count   how many.   last_paid_on   the latest date.
--   The app also reads it for the Detail suggestions (the details used before, most used first).
--
-- GST: neither cash view takes GST out; v_month_profit (below) does.

create view public.v_month_cash_flow with (security_invoker = true) as
with live_in as (
  select date_trunc('month', p.received_on)::date as month, sum(p.amount) as money_in, count(*)::int as payments_count
  from public.payments_in p
  where p.voided_at is null
  group by 1
),
live_out as (
  select date_trunc('month', e.paid_on)::date as month, sum(e.amount_pkr) as money_out, count(*)::int as expenses_count
  from public.expenses e
  group by 1
),
months as (
  select i.month from live_in i
  union
  select o.month from live_out o
  union
  select s.month from public.month_snapshots s
)
select
  k.month,
  case when s.month is not null
       then (s.pnl ->> 'net_in')::numeric + (s.pnl ->> 'gst_in')::numeric + (s.pnl ->> 'unresolved_gross')::numeric
       else coalesce(i.money_in, 0) end                                                         as money_in,
  case when s.month is not null then (s.payments ->> 'count')::int
       else coalesce(i.payments_count, 0) end                                                   as payments_count,
  case when s.month is not null then (s.pnl ->> 'cash_out_total')::numeric
       else coalesce(o.money_out, 0) end                                                        as money_out,
  case when s.month is not null then (s.via ->> 'cash_count')::int + (s.via ->> 'bank_count')::int
       else coalesce(o.expenses_count, 0) end                                                   as expenses_count,
  (s.month is not null)                                                                         as frozen
from months k
left join public.month_snapshots s on s.month = k.month
left join live_in i on i.month = k.month
left join live_out o on o.month = k.month
where (select public.current_user_role()) = 'admin';

comment on view public.v_month_cash_flow is
  '0079: cash in vs out per month, gross (GST and input tax included), voided payments left out, every expense category. A closed month answers from its snapshot. Admin only.';

create view public.v_month_cash_out_detail with (security_invoker = true) as
select
  date_trunc('month', e.paid_on)::date as month,
  e.category_id,
  max(d.detail)                        as detail,
  sum(e.amount_pkr)                    as gross_paid,
  count(*)::int                        as expense_count,
  max(e.paid_on)                       as last_paid_on
from public.expenses e
cross join lateral (
  select nullif(regexp_replace(btrim(coalesce(e.description, '')), '\s+', ' ', 'g'), '') as detail
) d
where (select public.current_user_role()) = 'admin'
group by 1, e.category_id, lower(d.detail);

comment on view public.v_month_cash_out_detail is
  '0079: money out per month, category and detail (the expense description, case and spacing ignored), gross. Admin only.';

revoke all on public.v_month_cash_flow, public.v_month_cash_out_detail from public, anon, authenticated;
grant select on public.v_month_cash_flow, public.v_month_cash_out_detail to authenticated;

-- ---------------------------------------------------------------- v_month_profit (invoiced basis, matching)
-- Profit on the invoiced basis, per Karachi calendar month, all amounts net of GST and of input tax:
--   sales_net, sales_gst, invoice_count   invoices by invoice_date (an undated legacy invoice has no month and is left out)
--   order_costs_matched   the cost of an order is counted with its sales (matching): an order-cost expense tagged to an
--                         order counts in the later of the month it was paid and the month of the order's FIRST invoice. Until
--                         the order has an invoice the cost is held (it is in no month's profit yet); a cancelled order that
--                         was never invoiced lets its held costs go in the later of the paid month and the cancel month.
--                         An order-cost expense tagged to no order cannot be matched: it counts when paid.
--   overheads             overhead expenses, when paid (period costs).
--   profit                sales_net - order_costs_matched - overheads. Owner drawings and loan repayments (not in P&L) are not
--                         costs.
--   order_costs_paid, non_pnl_paid, input_tax_paid   what was paid in the month (net, net, the input tax of every expense),
--                         so the app can explain profit against cash net exactly:
--   profit - cash net = (invoiced gross - cash in)            what customers now owe us more (+) or paid down (-)
--                     - sales_gst                            GST in the invoices: collected for FBR, not ours
--                     + (order_costs_paid - matched)         supplier costs paid ahead of their sale (+), or matched now (-)
--                     + non_pnl_paid + input_tax_paid        drawings and loan repayments, and reclaimable input tax
-- Supplier bills are not booked in this system (a cost is known when it is paid), so a supplier cost not yet paid is in no
-- month's profit: "what we owe suppliers" (the We owe suppliers report) is shown beside, not inside, the profit.
-- A closed month: its invoices and expenses are locked (0027) and an order's first invoice cannot move into or out of it, so its
-- profit stays as closed. The one exception is a cancel date typed later into a closed month for an order never invoiced; that
-- is rare and visible in the order's history.
create view public.v_month_profit with (security_invoker = true) as
with
inv as (
  select date_trunc('month', v.invoice_date)::date as month,
         sum(v.net_amount) as sales_net, sum(v.gst_amount) as sales_gst, count(*)::int as invoice_count
  from public.invoices v
  where v.invoice_date is not null
  group by 1
),
first_inv as (
  select v.order_id, date_trunc('month', min(v.invoice_date))::date as month
  from public.invoices v
  where v.order_id is not null and v.invoice_date is not null
  group by 1
),
ex as (
  select
    date_trunc('month', e.paid_on)::date                                                   as paid_month,
    c.grp,
    e.amount_pkr - e.input_tax_pkr                                                         as net,
    e.input_tax_pkr                                                                        as tax,
    case
      when c.grp = 'overhead' then date_trunc('month', e.paid_on)::date
      when c.grp <> 'order_cost' then null
      when e.order_id is null then date_trunc('month', e.paid_on)::date
      when f.month is not null then greatest(f.month, date_trunc('month', e.paid_on)::date)
      when o.cancelled_on is not null then greatest(date_trunc('month', o.cancelled_on)::date, date_trunc('month', e.paid_on)::date)
    end                                                                                    as cost_month
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  left join first_inv f on f.order_id = e.order_id
  left join public.orders o on o.id = e.order_id
),
matched as (
  select x.cost_month as month,
         sum(x.net) filter (where x.grp = 'order_cost') as order_costs_matched,
         sum(x.net) filter (where x.grp = 'overhead')   as overheads
  from ex x where x.cost_month is not null
  group by 1
),
paid as (
  select x.paid_month as month,
         sum(x.net) filter (where x.grp = 'order_cost') as order_costs_paid,
         sum(x.net) filter (where x.grp = 'non_pnl')    as non_pnl_paid,
         sum(x.tax)                                     as input_tax_paid
  from ex x
  group by 1
),
months as (
  select i.month from inv i union select m.month from matched m union select p.month from paid p
)
select
  k.month,
  coalesce(i.sales_net, 0)                                                                    as sales_net,
  coalesce(i.sales_gst, 0)                                                                    as sales_gst,
  coalesce(i.invoice_count, 0)                                                                as invoice_count,
  coalesce(m.order_costs_matched, 0)                                                          as order_costs_matched,
  coalesce(m.overheads, 0)                                                                    as overheads,
  coalesce(i.sales_net, 0) - coalesce(m.order_costs_matched, 0) - coalesce(m.overheads, 0)    as profit,
  coalesce(p.order_costs_paid, 0)                                                             as order_costs_paid,
  coalesce(p.non_pnl_paid, 0)                                                                 as non_pnl_paid,
  coalesce(p.input_tax_paid, 0)                                                               as input_tax_paid
from months k
left join inv i on i.month = k.month
left join matched m on m.month = k.month
left join paid p on p.month = k.month
where (select public.current_user_role()) = 'admin';

comment on view public.v_month_profit is
  '0079 (owner decision 2026-10-20): profit on the invoiced basis per month. Sales by invoice date, net of GST; an order''s costs counted with its first invoice (held until then); overheads when paid. Admin only.';

revoke all on public.v_month_profit from public, anon, authenticated;
grant select on public.v_month_profit to authenticated;
