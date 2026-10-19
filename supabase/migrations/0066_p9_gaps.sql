-- 0066_p9_gaps (P9): three database gaps left by earlier work. (Numbered 0066, reserved by the coordinator
-- while this was in flight.)
--
--   v_supplier_stats            gains orders_count: non-cancelled orders with a procurement leg for the supplier (a count of
--                               orders, not legs). Same definition as the order history in rank_item_quotes(). The float list's
--                               order key and the "ordered from N times" words read it. Appended as the last column.
--   supplier_item_evidence()    up to p_limit (default 3, at most 10) recent orders at the best tier per supplier, for the
--                               memory card's evidence block (g2-ranking-split.html "Memory card"). supplier_item_memory() is
--                               unchanged (its single evidence_* order is the first row here). No price, no sell, no spread:
--                               only order number, item, quantity and the placed / expected / delivered dates, so it is safe
--                               for every staff role.
--   money_exceptions_input()    Money > Exceptions: admin only, role check inside. Returns the reconciliation input already
--                               narrowed to the rows that can produce a finding (plus the orders and money rows those findings
--                               need as context), as one jsonb document shaped like ReconciliationInput (src/lib/reconciliation.ts).
--                               The checks themselves stay in TypeScript. Every filter is a superset of the TypeScript check
--                               (looser tolerances), so the client's exact check decides. Anyone else gets NULL.
-- All three are SECURITY INVOKER with a fixed search_path: the caller's own row security applies.

-- ---------------------------------------------------------------- v_supplier_stats: orders_count
create or replace view public.v_supplier_stats with (security_invoker = true) as
select
  c.id as supplier_id,
  a.asked,
  a.replied,
  a.no_offer,
  a.quoted,
  a.legacy_asked,
  a.reply_days_n,
  case when a.reply_days_n >= 3 then round(a.median::numeric, 1) end as median_reply_days,
  ch.chosen_of,
  ch.chosen,
  d.deliveries,
  d.late,
  case when d.late >= 3 then round(d.median_late::numeric, 1) end as median_days_late,
  lc.last_contact,
  coalesce(b.brand_ids, '{}'::uuid[]) as brand_ids,
  coalesce(b.brand_names, '{}'::text[]) as brand_names,
  ph.prices_hidden,
  oc.orders_count
from public.companies c
cross join lateral (
  select
    count(*)::int as asked,
    (count(*) filter (where x.replied))::int as replied,
    (count(*) filter (where x.no_offer))::int as no_offer,
    (count(*) filter (where x.quoted))::int as quoted,
    (count(*) filter (where x.is_legacy))::int as legacy_asked,
    (count(*) filter (where x.replied and not x.is_legacy))::int as reply_days_n,
    percentile_cont(0.5) within group (order by x.reply_days) filter (where x.replied and not x.is_legacy) as median
  from public.v_supplier_activity x
  where x.supplier_id = c.id
    and (x.sent_on <= public.today_pkt() - 7 or x.replied)
) a
cross join lateral (
  select
    count(*)::int as chosen_of,
    (count(*) filter (where z.ordered_here))::int as chosen
  from (
    select i.rfq_item_id,
           exists (select 1
                   from public.order_items oi
                   join public.orders o on o.id = oi.order_id and o.cancelled_on is null
                   join public.supplier_orders so on so.id = oi.supplier_order_id
                   where oi.rfq_item_id = i.rfq_item_id and so.supplier_id = c.id) as ordered_here
    from (
      select distinct q.rfq_item_id
      from public.supplier_quote_lines q
      join public.supplier_inquiries si on si.id = q.inquiry_id
      where si.supplier_id = c.id
    ) i
    where exists (select 1
                  from public.order_items oi
                  join public.orders o on o.id = oi.order_id and o.cancelled_on is null
                  where oi.rfq_item_id = i.rfq_item_id)
  ) z
) ch
cross join lateral (
  select
    count(*)::int as deliveries,
    (count(*) filter (where so.received_on > so.expected_on))::int as late,
    percentile_cont(0.5) within group (order by so.received_on - so.expected_on)
      filter (where so.received_on > so.expected_on) as median_late
  from public.supplier_orders so
  where so.supplier_id = c.id and so.expected_on is not null and so.received_on is not null
) d
cross join lateral (
  select greatest(
    (select max(greatest(si.sent_on, si.last_chased_on, public.today_pkt(si.last_relayed_at)))
     from public.supplier_inquiries si where si.supplier_id = c.id),
    (select max(po.issued_on)
     from public.purchase_orders po
     join public.supplier_orders so on so.id = po.supplier_order_id
     where so.supplier_id = c.id)
  ) as last_contact
) lc
cross join lateral (
  select array_agg(br.id order by lower(br.name), br.id) as brand_ids,
         array_agg(br.name order by lower(br.name), br.id) as brand_names
  from public.company_brands cb
  join public.brands br on br.id = cb.brand_id
  where cb.company_id = c.id
) b
cross join lateral (
  select count(*)::int as prices_hidden
  from public.supplier_quote_lines q
  join public.supplier_inquiries si on si.id = q.inquiry_id
  where si.supplier_id = c.id and 'currency_unverified' = any (q.legacy_flags)
) ph
cross join lateral (
  select count(distinct o.id)::int as orders_count
  from public.supplier_orders so
  join public.orders o on o.id = so.order_id and o.cancelled_on is null
  where so.supplier_id = c.id
) oc
where exists (select 1 from public.supplier_inquiries si where si.supplier_id = c.id)
   or exists (select 1 from public.supplier_orders so where so.supplier_id = c.id)
   or exists (select 1 from public.company_brands cb where cb.company_id = c.id);

-- (grants of 0024 are kept by create or replace)

-- ---------------------------------------------------------------- supplier_item_evidence
create function public.supplier_item_evidence(
  p_supplier_ids   uuid[],
  p_brand_id       uuid,
  p_family_id      uuid,
  p_description    text,
  p_exclude_rfq_id uuid default null,
  p_limit          integer default 3
)
returns table (
  supplier_id           uuid,
  evidence_rank         smallint,
  tier                  smallint,
  order_id              uuid,
  order_number          bigint,
  item_desc             text,
  qty                   numeric,
  placed_on             date,
  expected_on           date,
  delivered_on          date,
  delivered_after_days  integer,
  count_at_tier         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  t as (
    select public.tokens_without(public.model_tokens(p_description), b.arr) as tok,
           public.strip_words(public.item_text_norm(p_description), b.words) as nrm,
           b.arr as bt,
           b.words as bw
    from (select public.brand_tokens() as arr, public.brand_words() as words) b
  ),
  sup as (
    select u.supplier_id, min(u.ord) as ord
    from unnest(p_supplier_ids) with ordinality as u (supplier_id, ord)
    where u.supplier_id is not null
    group by u.supplier_id
  ),
  -- procurement legs
  lc as (
    select
      so.supplier_id,
      oi.id as order_item_id,
      so.id as leg_id,
      o.id as order_id,
      o.number as order_number,
      oi.description as item_desc,
      so.placed_on as leg_placed_on,
      so.expected_on as leg_expected_on,
      coalesce(so.delivered_on, so.received_on) as leg_delivered_on,
      oi.qty,
      oi.unit,
      oi.supplier_unit_price as price,
      so.currency,
      coalesce(so.placed_on, o.ordered_on, public.today_pkt(so.created_at)) as on_date,
      so.created_at,
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(oi.model_tokens, t.bt), public.strip_words(public.item_text_norm(oi.description), t.bw), oi.brand_id, oi.family_id,
                             false) as tier
    from sup
    join public.supplier_orders so on so.supplier_id = sup.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null
    join public.order_items oi on oi.supplier_order_id = so.id and not oi.is_service
    cross join t
    where p_exclude_rfq_id is null or o.rfq_id is distinct from p_exclude_rfq_id
  ),
  -- one row per leg: the item of that leg that matches best
  legs as (
    select distinct on (lc.supplier_id, lc.leg_id) lc.*
    from lc
    where lc.tier is not null
    order by lc.supplier_id, lc.leg_id, lc.tier, lc.on_date desc, lc.created_at desc, lc.order_item_id
  ),
  bt as (
    select l.supplier_id, min(l.tier) as best_tier from legs l group by l.supplier_id
  ),
  ranked as (
    select l.*,
           row_number() over (partition by l.supplier_id
                              order by l.on_date desc, l.created_at desc, l.order_item_id) as rn,
           count(*) over (partition by l.supplier_id) as n
    from legs l
    join bt on bt.supplier_id = l.supplier_id and bt.best_tier = l.tier
  )
  select
    r.supplier_id,
    r.rn::smallint,
    r.tier::smallint,
    r.order_id,
    r.order_number,
    r.item_desc,
    r.qty,
    r.leg_placed_on,
    r.leg_expected_on,
    r.leg_delivered_on,
    case when r.leg_placed_on is not null and r.leg_delivered_on is not null
         then r.leg_delivered_on - r.leg_placed_on end,
    r.n::int
  from ranked r
  join sup s on s.supplier_id = r.supplier_id
  where r.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by s.ord, r.rn
$$;

revoke all on function public.supplier_item_evidence(uuid[], uuid, uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.supplier_item_evidence(uuid[], uuid, uuid, text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------- money_exceptions_input
-- Money > Exceptions (M07) used to read every order, payment, expense, invoice, leg and PO into the browser. This returns the
-- same ReconciliationInput, but only rows that can produce a finding, plus the context rows the TypeScript checks look up:
--   orders / money   flagged orders, and the order of every other included row (label, ordered date, the GST rate of the order)
--   payments         not positive, on a cancelled order, or dated before the order
--   expenses         negative net cost, or dated before the order
--   legs / pos       a date out of sequence, or a PKR PO with supplier payments above its total (legPaid holds the paid sum, which
--                    the checks use instead of summing the expense rows that were filtered out)
--   invoices         a negative or impossible amount, GST off the order's rate, no matching order, dated before the order, TCS trail
--                    or deposit out of sequence
-- Tolerances here are looser than the TypeScript ones (0.5 for the Rs 1, 1% for the 2%), so this never drops a row the exact check
-- would flag; the TypeScript decides. NULL for anyone who is not an admin (the underlying tables are admin-only as well).
create function public.money_exceptions_input()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    return null;
  end if;
  return (
    with
    ord as (
      select o.id, o.number, o.ordered_on, o.cancelled_on,
             ('value_basis_unknown' = any (coalesce(o.legacy_flags, '{}'))) as basis_unknown
      from public.orders o
    ),
    mon as (
      select m.order_id, m.gross_target, m.settled, m.expected_cost, m.actual_cost,
             (coalesce(m.costs_state, '') = 'complete') as costs_complete,
             b.invoice_count, b.invoice_gross, b.items_net, b.items_gross
      from public.v_order_money m
      left join public.v_order_basis b on b.order_id = m.order_id
      where m.order_id is not null
    ),
    fo as (
      select o.id
      from ord o
      left join mon m on m.order_id = o.id
      where o.basis_unknown
         or (o.cancelled_on is null and m.order_id is not null and (
               coalesce(m.settled, 0) - coalesce(m.gross_target, 0) > 0.5
            or (coalesce(m.invoice_count, 0) > 0 and coalesce(m.invoice_gross, 0) - coalesce(m.items_gross, 0) > 0.5)
            or (m.expected_cost is not null and coalesce(m.actual_cost, 0) - m.expected_cost > 0.5)
            or (not m.costs_complete and coalesce(m.gross_target, 0) > 0
                and coalesce(m.settled, 0) >= coalesce(m.gross_target, 0) - 1.5)))
    ),
    fp as (
      select p.id, p.order_id, p.amount, p.received_on
      from public.payments_in p
      left join ord o on o.id = p.order_id
      where p.amount <= 0 or o.cancelled_on is not null or p.received_on < o.ordered_on
    ),
    fe as (
      select e.id, e.order_id, e.supplier_order_id, e.paid_on,
             coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0) as cost
      from public.expenses e
      left join ord o on o.id = e.order_id
      where coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0) < 0 or e.paid_on < o.ordered_on
    ),
    lp as (
      select e.supplier_order_id as leg_id, sum(coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0)) as paid
      from public.expenses e
      where e.supplier_order_id is not null
      group by e.supplier_order_id
    ),
    po as (
      select distinct on (p.supplier_order_id) p.supplier_order_id as leg_id, coalesce(p.total, 0) as total, btrim(p.currency) as currency
      from public.purchase_orders p
      order by p.supplier_order_id, p.revision desc
    ),
    fpo as (
      select po.leg_id, po.total, po.currency, coalesce(lp.paid, 0) as paid
      from po
      left join lp on lp.leg_id = po.leg_id
      where po.currency = 'PKR' and coalesce(lp.paid, 0) - po.total > 0.5
    ),
    legs as (
      select so.id, so.order_id, so.placed_on, so.expected_on, so.received_on, so.delivered_on, btrim(so.currency) as currency,
             'leg ' || chr(64 + (row_number() over (partition by so.order_id order by so.created_at, so.id))::int) as label
      from public.supplier_orders so
    ),
    fl as (
      select l.*
      from legs l
      where l.expected_on < l.placed_on or l.delivered_on < l.placed_on
         or l.id in (select f.leg_id from fpo f)
    ),
    fi as (
      select g.id, g.number, g.order_id, g.invoice_date, g.net_amount, g.gst_amount, g.copy_received_on, g.tcs_sent_on,
             g.client_received_on, g.tax_deposited_on, (cardinality(coalesce(g.legacy_flags, '{}')) > 0) as legacy
      from public.invoices g
      left join ord o on o.id = g.order_id
      left join mon m on m.order_id = g.order_id
      where g.net_amount < 0 or g.gst_amount < 0
         or g.gst_amount > g.net_amount + 0.5
         or (g.net_amount > 0 and (
               case
                 when coalesce(m.items_net, 0) > 0 then
                   (g.net_amount * (m.items_gross - m.items_net) / m.items_net > 0
                    and abs(g.gst_amount - g.net_amount * (m.items_gross - m.items_net) / m.items_net)
                        / (g.net_amount * (m.items_gross - m.items_net) / m.items_net) > 0.01)
                   or (g.net_amount * (m.items_gross - m.items_net) / m.items_net <= 0 and g.gst_amount > 0.5)
                 else abs(g.gst_amount - g.net_amount * 0.18) / (g.net_amount * 0.18) > 0.01
               end))
         or (g.order_id is not null and o.id is null)
         or g.invoice_date < o.ordered_on
         or g.copy_received_on > g.tcs_sent_on
         or g.tcs_sent_on > g.client_received_on
         or g.copy_received_on > g.client_received_on
         or g.tax_deposited_on < g.invoice_date
    ),
    need as (
      select id from fo
      union select order_id from fp
      union select order_id from fe where order_id is not null
      union select order_id from fl
      union select order_id from fi where order_id is not null
    ),
    out_orders as (select o.* from ord o where o.id in (select n.id from need n))
    select jsonb_build_object(
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', o.id, 'number', o.number, 'orderedOn', o.ordered_on, 'cancelled', o.cancelled_on is not null,
          'basisUnknown', o.basis_unknown)) from out_orders o), '[]'::jsonb),
      'money', coalesce((select jsonb_agg(jsonb_build_object(
          'orderId', m.order_id, 'grossTarget', coalesce(m.gross_target, 0), 'settled', coalesce(m.settled, 0),
          'itemsNet', coalesce(m.items_net, 0), 'itemsGross', coalesce(m.items_gross, 0),
          'invoiceCount', coalesce(m.invoice_count, 0), 'invoiceGross', coalesce(m.invoice_gross, 0),
          'expectedCost', m.expected_cost, 'actualCost', coalesce(m.actual_cost, 0), 'costsComplete', m.costs_complete))
        from mon m where m.order_id in (select oo.id from out_orders oo)), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'orderId', p.order_id, 'amount', p.amount, 'receivedOn', p.received_on)) from fp p), '[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object(
          'id', e.id, 'orderId', e.order_id, 'legId', e.supplier_order_id, 'cost', e.cost, 'paidOn', e.paid_on)) from fe e), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'number', g.number, 'orderId', g.order_id, 'invoiceDate', g.invoice_date,
          'net', g.net_amount, 'gst', g.gst_amount, 'copyReceivedOn', g.copy_received_on, 'tcsSentOn', g.tcs_sent_on,
          'clientReceivedOn', g.client_received_on, 'taxDepositedOn', g.tax_deposited_on, 'legacy', g.legacy)) from fi g), '[]'::jsonb),
      'legs', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'orderId', l.order_id, 'label', l.label, 'placedOn', l.placed_on, 'expectedOn', l.expected_on,
          'receivedOn', l.received_on, 'deliveredOn', l.delivered_on, 'currency', l.currency)) from fl l), '[]'::jsonb),
      'pos', coalesce((select jsonb_agg(jsonb_build_object(
          'legId', p.leg_id, 'total', p.total, 'currency', p.currency)) from fpo p), '[]'::jsonb),
      'legPaid', coalesce((select jsonb_agg(jsonb_build_object('legId', p.leg_id, 'paid', p.paid)) from fpo p), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.money_exceptions_input() from public, anon, authenticated;
grant execute on function public.money_exceptions_input() to authenticated;
