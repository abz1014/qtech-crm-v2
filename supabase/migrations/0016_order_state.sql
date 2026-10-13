-- 0016_order_state (S10, part 2): v_order_state, DATA_MODEL section 5. Built after the money views because
-- the admin's "done" needs the payment and cost dimensions from v_order_money.
--
-- Visible to every staff role; net, gst and gross come from item prices only.
--   goods_state:         n_a (all lines are services) / to_source / to_place / on_order / late / received /
--                        partly_delivered / delivered, from the legs that supply the goods lines
--   commissioning_state: n_a / to_plan / planned / done
--   invoicing_state:     not_invoiced / part / fully_invoiced (Rs 1 allowance); NULL for engineers, who cannot
--                        read invoices, so a hidden dimension never reads as "not invoiced"
--   lifecycle:           cancelled / done / active
--   is_done is role-aware: engineers need goods and commissioning terminal; sales add invoicing; admin adds
--                        invoicing, payment settled and costs complete.
--   data_trust:          basis_unknown / estimated_dates / ok
-- The payment dimension is not here: sales read it through order_receivables(), engineers never.

create view public.v_order_state with (security_invoker = true) as
select
  o.id as order_id,
  o.number,
  o.company_id,
  o.site_id,
  o.rfq_id,
  o.owner_id,
  case
    when o.cancelled_on is not null then 'cancelled'
    when dn.is_done then 'done'
    else 'active'
  end as lifecycle,
  dn.is_done,
  t.net,
  t.gst,
  t.gross,
  case when r.role in ('admin', 'sales') then iv.invoiced_gross end as invoiced,
  gs.goods_state,
  cs.commissioning_state,
  case when r.role in ('admin', 'sales') then ivs.invoicing_state end as invoicing_state,
  case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when o.legacy_flags && array['dates_estimated', 'undated'] or gs.legs_estimated then 'estimated_dates'
    else 'ok'
  end as data_trust
from public.orders o
join public.v_order_items_total t on t.order_id = o.id
cross join lateral (select public.current_user_role() as role) r
cross join lateral (
  select
    count(*) filter (where not i.is_service) as goods_items,
    count(*) filter (where not i.is_service and i.supplier_order_id is null) as unsourced
  from public.order_items i
  where i.order_id = o.id
) gi
cross join lateral (
  select
    count(*)                                                            as n_legs,
    count(*) filter (where l.placed_on is null)                         as n_unplaced,
    count(*) filter (where l.delivered_on is not null)                  as n_delivered,
    count(*) filter (where l.received_on is not null or l.delivered_on is not null) as n_received,
    count(*) filter (where l.expected_on < public.today_pkt()
                       and l.received_on is null and l.delivered_on is null)       as n_late,
    coalesce(bool_or('dates_estimated' = any (l.legacy_flags)), false)  as legs_estimated
  from public.supplier_orders l
  where l.id in (select i.supplier_order_id from public.order_items i
                 where i.order_id = o.id and not i.is_service and i.supplier_order_id is not null)
) lg
cross join lateral (
  select
    case
      when gi.goods_items = 0 then 'n_a'
      when gi.unsourced > 0 then 'to_source'
      when lg.n_unplaced > 0 then 'to_place'
      when lg.n_delivered = lg.n_legs then 'delivered'
      when lg.n_received = lg.n_legs then 'received'
      when lg.n_late > 0 then 'late'
      when lg.n_delivered > 0 then 'partly_delivered'
      else 'on_order'
    end as goods_state,
    lg.legs_estimated
) gs
cross join lateral (
  select case
    when not o.needs_commissioning then 'n_a'
    when o.commissioning_done_on is not null then 'done'
    when o.commissioning_planned_on is not null then 'planned'
    else 'to_plan'
  end as commissioning_state
) cs
cross join lateral (
  select count(*) as invoice_count,
         coalesce(sum(v.net_amount + v.gst_amount), 0) as invoiced_gross
  from public.invoices v
  where v.order_id = o.id
) iv
cross join lateral (
  select case
    when iv.invoice_count = 0 then 'not_invoiced'
    when iv.invoiced_gross >= t.gross - 1 then 'fully_invoiced'
    else 'part'
  end as invoicing_state
) ivs
left join public.v_order_money m on m.order_id = o.id
cross join lateral (
  select
    o.cancelled_on is null
    and gs.goods_state in ('n_a', 'delivered')
    and cs.commissioning_state in ('n_a', 'done')
    and case r.role
          when 'admin' then ivs.invoicing_state = 'fully_invoiced'
                            and coalesce(m.payment_state = 'settled', false)
                            and coalesce(m.costs_state = 'complete', false)
          when 'sales' then ivs.invoicing_state = 'fully_invoiced'
          else true
        end as is_done
) dn
where r.role is not null;

revoke all on public.v_order_state from public, anon, authenticated;
grant select on public.v_order_state to authenticated;
