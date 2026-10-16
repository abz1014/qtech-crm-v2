-- 0049_rank_item_quotes (S24, Amendment A8): ranking of supplier quotes, and order evidence in supplier memory.
--
--   rank_item_quotes(rfq_id)   one row per (RFQ item, quote line): PKR price at today's rate, rank, 2% near-tie band, delivery
--                              record, order history and, for admin and sales only, the selling price and the spread.
--   supplier_item_memory()     gains evidence_* output columns (the most recent order at the best tier with a leg for the
--                              supplier: order number, placed and delivered dates, days to delivery). Same parameters and the
--                              same existing columns; the function is dropped and re-created because its result type changes.
--
-- Owner decisions applied (2026-10-15): the selling price and spread are never returned to engineers; there is no "Received"
-- step, so a leg is delivered when delivered_on is set (received_on is read only as a fallback for imported legs); evidence reads
-- "delivered after N days" = delivered_on - placed_on.
-- Both functions are SECURITY INVOKER with a fixed search_path and run with the caller's rights.

drop function public.supplier_item_memory(uuid[], uuid, uuid, text, uuid);

create function public.supplier_item_memory(
  p_supplier_ids   uuid[],
  p_brand_id       uuid,
  p_family_id      uuid,
  p_description    text,
  p_exclude_rfq_id uuid default null
)
returns table (
  supplier_id               uuid,
  best_tier                 smallint,
  best_tier_label           text,
  supplied_before           boolean,
  last_quote_tier           smallint,
  last_quote_on             date,
  last_quote_price          numeric,
  last_quote_currency       char(3),
  last_quote_price_hidden   boolean,
  last_quote_fx_rate_pkr    numeric,
  last_quote_fx_rate_on     date,
  last_quote_price_pkr      numeric,
  last_quote_qty            numeric,
  last_quote_unit           text,
  last_quote_lead_time      text,
  last_quote_is_legacy      boolean,
  recent_lead_times         text[],
  last_po_tier              smallint,
  last_po_on                date,
  last_po_price             numeric,
  last_po_currency          char(3),
  last_po_fx_rate_pkr       numeric,
  last_po_fx_rate_on        date,
  last_po_price_pkr         numeric,
  last_po_qty               numeric,
  last_po_unit              text,
  last_ordered_source       text,
  last_ordered_tier         smallint,
  last_ordered_on           date,
  last_ordered_price        numeric,
  last_ordered_currency     char(3),
  last_ordered_fx_rate_pkr  numeric,
  last_ordered_fx_rate_on   date,
  last_ordered_price_pkr    numeric,
  last_ordered_qty          numeric,
  last_ordered_unit         text,
  evidence_tier                  smallint,
  evidence_order_id              uuid,
  evidence_order_number          bigint,
  evidence_item_desc             text,
  evidence_qty                   numeric,
  evidence_placed_on             date,
  evidence_expected_on           date,
  evidence_delivered_on          date,
  evidence_delivered_after_days  integer,
  evidence_count_at_tier         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  -- Tokens that are really a brand or family name ("S7", "XYZ2000") are not model codes: they are stripped from the
  -- target and from every candidate before the tiers are decided (migration 0035). One read of brands per call.
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
  -- quote lines
  qc as (
    select
      si.supplier_id,
      ri.qty,
      ri.unit,
      q.unit_price,
      q.currency,
      q.lead_time,
      q.fx_rate_pkr,
      q.fx_rate_on,
      ('currency_unverified' = any (q.legacy_flags)) as hidden,
      (q.legacy_source is not null) as is_legacy,
      case when q.legacy_source is not null then coalesce(si.sent_on, public.today_pkt(q.created_at))
           else public.today_pkt(q.created_at) end as on_date,
      q.created_at,
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(ri.model_tokens, t.bt), public.strip_words(public.item_text_norm(ri.description), t.bw), ri.brand_id, ri.family_id,
                             'item_guessed' = any (q.legacy_flags)) as tier
    from sup
    join public.supplier_inquiries si on si.supplier_id = sup.supplier_id
    join public.supplier_quote_lines q on q.inquiry_id = si.id
    join public.rfq_items ri on ri.id = q.rfq_item_id
    cross join t
    where p_exclude_rfq_id is null or si.rfq_id <> p_exclude_rfq_id
  ),
  qm as (
    select qc.*,
           row_number() over (partition by qc.supplier_id order by qc.tier, qc.on_date desc, qc.created_at desc) as rn
    from qc
    where qc.tier is not null
  ),
  lt as (
    select d.supplier_id, (array_agg(d.lead_time order by d.last_on desc, d.lead_time))[1:2] as lead_times
    from (
      select m.supplier_id, m.lead_time, max(m.on_date) as last_on
      from qm m
      join qm b on b.supplier_id = m.supplier_id and b.rn = 1 and b.tier = m.tier
      where m.lead_time is not null and btrim(m.lead_time) <> ''
      group by m.supplier_id, m.lead_time
    ) d
    group by d.supplier_id
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
  -- PO snapshot lines
  pc as (
    select
      so.supplier_id,
      (l.e ->> 'order_item_id')::uuid as order_item_id,
      po.revision,
      po.issued_on as on_date,
      po.created_at,
      po.currency,
      nullif(l.e ->> 'unit_price', '')::numeric as price,
      nullif(l.e ->> 'qty', '')::numeric as qty,
      l.e ->> 'unit' as unit,
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(public.model_tokens(l.e ->> 'description'), t.bt),
                             public.strip_words(public.item_text_norm(l.e ->> 'description'), t.bw),
                             poi.brand_id, poi.family_id, false) as tier
    from sup
    join public.supplier_orders so on so.supplier_id = sup.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null
    join public.purchase_orders po on po.supplier_order_id = so.id
    cross join lateral jsonb_array_elements(po.lines) as l (e)
    left join public.order_items poi on poi.id = (l.e ->> 'order_item_id')::uuid
    cross join t
    where nullif(l.e ->> 'unit_price', '') is not null
      and (p_exclude_rfq_id is null or o.rfq_id is distinct from p_exclude_rfq_id)
  ),
  pm as (
    select pc.*,
           row_number() over (partition by pc.supplier_id
                              order by pc.tier, pc.on_date desc, pc.revision desc, pc.created_at desc) as rn
    from pc
    where pc.tier is not null
  ),
  -- "last ordered": PO lines, plus order prices on legs that never got a PO line for that item
  oc as (
    select pm.supplier_id, 'po'::text as source, pm.tier, pm.on_date, pm.price, pm.currency, pm.qty, pm.unit,
           pm.created_at
    from pm
    union all
    select lc.supplier_id, 'order'::text, lc.tier, lc.on_date, lc.price, lc.currency, lc.qty, lc.unit, lc.created_at
    from lc
    where lc.tier is not null
      and lc.price is not null
      and not exists (select 1 from pc where pc.order_item_id = lc.order_item_id)
  ),
  om as (
    select oc.*,
           row_number() over (partition by oc.supplier_id order by oc.tier, oc.on_date desc, oc.created_at desc) as rn
    from oc
  ),
  bt as (
    select x.supplier_id, min(x.tier) as best_tier
    from (
      select qm.supplier_id, qm.tier from qm
      union all
      select lc.supplier_id, lc.tier from lc where lc.tier is not null
      union all
      select pm.supplier_id, pm.tier from pm
    ) x
    group by x.supplier_id
  ),
  sb as (
    select distinct lc.supplier_id from lc where lc.tier <= 1
  ),
  -- evidence (A8): the most recent order at the best tier that has a leg with this supplier
  ev as (
    select x.*
    from (
      select lc.*,
             row_number() over (partition by lc.supplier_id
                                order by lc.tier, lc.on_date desc, lc.created_at desc, lc.order_item_id) as rn
      from lc
      where lc.tier is not null
    ) x
    where x.rn = 1
  ),
  evn as (
    select l2.supplier_id, count(distinct l2.leg_id)::int as n
    from lc l2
    join ev on ev.supplier_id = l2.supplier_id and l2.tier = ev.tier
    group by l2.supplier_id
  )
  select
    s.supplier_id,
    bt.best_tier::smallint,
    case bt.best_tier when 0 then 'same model' when 1 then 'same item' when 2 then 'same brand'
                      when 3 then 'same family' end,
    (sb.supplier_id is not null),
    q.tier::smallint,
    q.on_date,
    case when q.hidden then null else q.unit_price end,
    case when q.hidden then null else q.currency end,
    coalesce(q.hidden, false),
    case when q.hidden then null else q.fx_rate_pkr end,
    case when q.hidden then null else q.fx_rate_on end,
    case when q.hidden or q.fx_rate_pkr is null then null else round(q.unit_price * q.fx_rate_pkr, 2) end,
    q.qty,
    q.unit,
    q.lead_time,
    q.is_legacy,
    lt.lead_times,
    p.tier::smallint,
    p.on_date,
    p.price,
    p.currency,
    pfx.rate,
    pfx.rate_on,
    round(p.price * pfx.rate, 2),
    p.qty,
    p.unit,
    o.source,
    o.tier::smallint,
    o.on_date,
    o.price,
    o.currency,
    ofx.rate,
    ofx.rate_on,
    round(o.price * ofx.rate, 2),
    o.qty,
    o.unit,
    ev.tier::smallint,
    ev.order_id,
    ev.order_number,
    ev.item_desc,
    ev.qty,
    ev.leg_placed_on,
    ev.leg_expected_on,
    ev.leg_delivered_on,
    case when ev.leg_placed_on is not null and ev.leg_delivered_on is not null
         then ev.leg_delivered_on - ev.leg_placed_on end,
    evn.n
  from sup s
  left join bt on bt.supplier_id = s.supplier_id
  left join sb on sb.supplier_id = s.supplier_id
  left join qm q on q.supplier_id = s.supplier_id and q.rn = 1
  left join lt on lt.supplier_id = s.supplier_id
  left join pm p on p.supplier_id = s.supplier_id and p.rn = 1
  left join lateral (
    select case when p.currency = 'PKR' then 1::numeric else f.rate_pkr end as rate,
           case when p.currency = 'PKR' then p.on_date else f.as_of end as rate_on
    from (select 1) one
    left join lateral (
      select r.rate_pkr, r.as_of
      from public.fx_rates r
      where r.currency = p.currency and r.as_of <= p.on_date and r.as_of >= p.on_date - 30
      order by r.as_of desc, (r.source = 'manual') desc
      limit 1
    ) f on p.currency is not null and p.currency <> 'PKR'
  ) pfx on true
  left join om o on o.supplier_id = s.supplier_id and o.rn = 1
  left join ev on ev.supplier_id = s.supplier_id
  left join evn on evn.supplier_id = s.supplier_id
  left join lateral (
    select case when o.currency = 'PKR' then 1::numeric else f.rate_pkr end as rate,
           case when o.currency = 'PKR' then o.on_date else f.as_of end as rate_on
    from (select 1) one
    left join lateral (
      select r.rate_pkr, r.as_of
      from public.fx_rates r
      where r.currency = o.currency and r.as_of <= o.on_date and r.as_of >= o.on_date - 30
      order by r.as_of desc, (r.source = 'manual') desc
      limit 1
    ) f on o.currency is not null and o.currency <> 'PKR'
  ) ofx on true
  order by s.ord
$$;

revoke all on function public.supplier_item_memory(uuid[], uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_item_memory(uuid[], uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------- rank_item_quotes
-- The ranking behind "convert", the RFQ comparison and the split editor (BUILD_PLAN Amendment A8). One row per
-- (RFQ item, supplier quote line), SQL, STABLE, SECURITY INVOKER: every table read is readable by all active staff, so the
-- function is too (section 10); anon has no execute and a deactivated user gets no rows.
--
-- Price in PKR (the rule of the client's comparePrices, which this replaces for ranking):
--   all lines of the item in ONE currency   compared as quoted; no rate needed (fx_state = 'same_currency')
--   otherwise                               each line at TODAY's rate (v_fx_latest): fresh (<= 7 days) and stale (8-30 days) are
--                                           used; unusable (> 30 days) or no rate: pkr_unit_price NULL, comparable false, no rank
--   PKR lines                               pkr_unit_price = price, fx_state 'same_currency'
-- Order (comparable lines only):
--   1. lines within 2% of the lowest price come first (the near-tie band)
--   2. inside the band: delivery reliability band (1 proven, 2 unproven, 3 often late), then order count (more first), then the
--      most recent order; outside the band the order is by price
--   3. price ascending, supplier name, quote line id (a stable order)
-- Delivery record: the supplier's legs with expected_on and a delivery date (delivered_on, or the legacy received_on), all
-- time. On time = delivered <= expected. Band 1 = at least 3 deliveries and on time at least 2/3; band 2 = fewer than 3
-- (no claim is made); band 3 = at least 3 and on time under 2/3. The median days late is shown only with 3 or more late.
-- History: non-cancelled orders with a leg for the supplier, not counting orders converted from this RFQ. The value is
-- qty x supplier price at today's rate (legs in a currency with no usable rate are left out); it is shown, never ranked on.
--
-- Money safety (owner, 2026-10-15): the selling price and the spread are for admin and sales only. For any other role every
-- sell_* and spread_* column is NULL, whatever the data holds.
--   sell_unit_net     rfq_items.quoted_unit_price_net ('quoted'), else the last price sold to this customer
--                     (customer_price_memory, 'last_sold' with that order's number and date), else NULL ('none')
--   spread_unit       sell_unit_net - pkr_unit_price, before freight and duty (not the order margin); spread_total = x item qty
create function public.rank_item_quotes(p_rfq_id uuid)
returns table (
  rfq_item_id                      uuid,
  quote_line_id                    uuid,
  supplier_id                      uuid,
  item_qty                         numeric,
  price                            numeric,
  currency                         char(3),
  pkr_unit_price                   numeric,
  fx_state                         text,
  fx_rate_pkr                      numeric,
  fx_rate_on                       date,
  fx_age_days                      integer,
  comparable                       boolean,
  rank                             integer,
  within_band                      boolean,
  pct_above_best                   numeric,
  sell_unit_net                    numeric,
  sell_source                      text,
  sell_order_number                bigint,
  sell_on                          date,
  spread_unit                      numeric,
  spread_total                     numeric,
  reliability_band                 smallint,
  deliveries                       integer,
  on_time                          integer,
  late                             integer,
  median_days_late                 numeric,
  orders_count                     integer,
  orders_value_pkr                 numeric,
  last_order_number                bigint,
  last_order_on                    date,
  last_order_delivered_after_days  integer,
  replied                          integer,
  asked                            integer,
  lead_time                        text,
  in_stock                         boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  who as (
    select coalesce(public.current_user_role() in ('admin', 'sales'), false) as see_sell
  ),
  lines as (
    select
      q.id as quote_line_id,
      ri.id as rfq_item_id,
      ri.position as item_pos,
      ri.qty as item_qty,
      ri.quoted_unit_price_net,
      si.supplier_id,
      q.unit_price as price,
      q.currency,
      q.lead_time,
      q.in_stock
    from public.rfq_items ri
    join public.supplier_quote_lines q on q.rfq_item_id = ri.id
    join public.supplier_inquiries si on si.id = q.inquiry_id
    where ri.rfq_id = p_rfq_id
  ),
  ncur as (
    select l.rfq_item_id, count(distinct l.currency)::int as n
    from lines l
    group by l.rfq_item_id
  ),
  sup as (
    select distinct l.supplier_id from lines l
  ),
  -- today's price in PKR; cmp is the figure compared (the raw price when the item has one currency)
  priced as (
    select
      l.*,
      nc.n as n_cur,
      f.rate_pkr as fx_rate,
      f.as_of as fx_on,
      f.age_days as fx_age,
      case
        when l.currency = 'PKR' or nc.n = 1 then 'same_currency'
        when f.currency is null then 'none'
        else f.staleness
      end as fx_state,
      case
        when l.currency = 'PKR' then l.price
        when f.currency is not null and f.staleness <> 'unusable' then l.price * f.rate_pkr
      end as pkr_raw
    from lines l
    join ncur nc on nc.rfq_item_id = l.rfq_item_id
    left join public.v_fx_latest f on f.currency = l.currency and l.currency <> 'PKR'
  ),
  cmpd as (
    select
      p.*,
      (p.n_cur = 1 or p.pkr_raw is not null) as comparable,
      case when p.n_cur = 1 then p.price else p.pkr_raw end as cmp
    from priced p
  ),
  best as (
    select c.rfq_item_id, min(c.cmp) as best
    from cmpd c
    where c.comparable
    group by c.rfq_item_id
  ),
  -- delivery record, all time
  dl as (
    select
      so.supplier_id,
      count(*) filter (where so.expected_on is not null and coalesce(so.delivered_on, so.received_on) is not null)::int as deliveries,
      count(*) filter (where so.expected_on is not null and coalesce(so.delivered_on, so.received_on) <= so.expected_on)::int as on_time,
      count(*) filter (where so.expected_on is not null and coalesce(so.delivered_on, so.received_on) > so.expected_on)::int as late,
      percentile_cont(0.5) within group (order by coalesce(so.delivered_on, so.received_on) - so.expected_on)
        filter (where so.expected_on is not null and coalesce(so.delivered_on, so.received_on) > so.expected_on) as median_late
    from sup s
    join public.supplier_orders so on so.supplier_id = s.supplier_id
    group by so.supplier_id
  ),
  -- order history: non-cancelled orders with a leg for the supplier, not counting this RFQ's own orders
  hl as (
    select
      so.supplier_id,
      so.id as leg_id,
      so.currency,
      so.placed_on,
      coalesce(so.delivered_on, so.received_on) as delivered_on,
      o.id as order_id,
      o.number as order_number,
      coalesce(so.placed_on, o.ordered_on) as order_on,
      o.created_at as order_created
    from sup s
    join public.supplier_orders so on so.supplier_id = s.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null and o.rfq_id is distinct from p_rfq_id
  ),
  hc as (
    select h.supplier_id, count(distinct h.order_id)::int as orders_count
    from hl h
    group by h.supplier_id
  ),
  hlast as (
    select distinct on (h.supplier_id)
      h.supplier_id,
      h.order_number,
      h.order_on,
      case when h.placed_on is not null and h.delivered_on is not null then h.delivered_on - h.placed_on end as days
    from hl h
    order by h.supplier_id, h.order_on desc nulls last, h.order_created desc, h.leg_id
  ),
  hv as (
    select
      h.supplier_id,
      round(sum(oi.qty * oi.supplier_unit_price * case when h.currency = 'PKR' then 1 else f.rate_pkr end)
            filter (where h.currency = 'PKR' or (f.rate_pkr is not null and f.staleness <> 'unusable')), 2) as value_pkr
    from hl h
    join public.order_items oi on oi.supplier_order_id = h.leg_id and not oi.is_service and oi.supplier_unit_price is not null
    left join public.v_fx_latest f on f.currency = h.currency and h.currency <> 'PKR'
    group by h.supplier_id
  ),
  vs as (
    select v.supplier_id, v.asked, v.replied
    from public.v_supplier_stats v
    where v.supplier_id in (select s.supplier_id from sup s)
  ),
  -- last price sold to this customer (admin and sales only; skipped for other roles)
  cpm as (
    select m.rfq_item_id, m.sold_price, m.sold_on, m.sold_order_number
    from public.customer_price_memory(p_rfq_id) m
    where (select w.see_sell from who w)
  ),
  attrs as (
    select
      c.*,
      co.name as supplier_name,
      (c.comparable and c.cmp <= b.best * 1.02) as in_band,
      case when c.comparable then round((c.cmp / b.best - 1) * 100, 2) end as pct,
      case
        when coalesce(d.deliveries, 0) < 3 then 2
        when d.on_time * 3 >= d.deliveries * 2 then 1
        else 3
      end::smallint as rel_band,
      coalesce(d.deliveries, 0) as n_deliveries,
      coalesce(d.on_time, 0) as n_on_time,
      coalesce(d.late, 0) as n_late,
      case when d.late >= 3 then round(d.median_late::numeric, 1) end as med_late,
      coalesce(hc.orders_count, 0) as n_orders,
      hv.value_pkr,
      hl2.order_number as last_order_number,
      hl2.order_on as last_order_on,
      hl2.days as last_order_days,
      vs.replied as n_replied,
      vs.asked as n_asked,
      w.see_sell,
      cp.sold_price,
      cp.sold_on,
      cp.sold_order_number
    from cmpd c
    left join best b on b.rfq_item_id = c.rfq_item_id
    cross join who w
    join public.companies co on co.id = c.supplier_id
    left join dl d on d.supplier_id = c.supplier_id
    left join hc on hc.supplier_id = c.supplier_id
    left join hlast hl2 on hl2.supplier_id = c.supplier_id
    left join hv on hv.supplier_id = c.supplier_id
    left join vs on vs.supplier_id = c.supplier_id
    left join cpm cp on cp.rfq_item_id = c.rfq_item_id
  ),
  ranked as (
    select
      a.*,
      case when a.comparable then
        row_number() over (
          partition by a.rfq_item_id, a.comparable
          order by (not a.in_band),
                   case when a.in_band then 0 else a.cmp end,
                   a.rel_band,
                   a.n_orders desc,
                   a.last_order_on desc nulls last,
                   a.cmp,
                   lower(a.supplier_name),
                   a.quote_line_id)
      end as rk
    from attrs a
  ),
  fin as (
    select
      r.*,
      case when r.see_sell then coalesce(r.quoted_unit_price_net, r.sold_price) end as sell_net,
      case when not r.see_sell then null
           when r.quoted_unit_price_net is not null then 'quoted'
           when r.sold_price is not null then 'last_sold'
           else 'none' end as sell_src
    from ranked r
  )
  select
    f.rfq_item_id,
    f.quote_line_id,
    f.supplier_id,
    f.item_qty,
    f.price,
    f.currency,
    case when f.pkr_raw is not null then round(f.pkr_raw, 2) end,
    f.fx_state,
    case when f.currency = 'PKR' then null else f.fx_rate end,
    case when f.currency = 'PKR' then null else f.fx_on end,
    case when f.currency = 'PKR' then null else f.fx_age end,
    f.comparable,
    f.rk::integer,
    case when f.comparable then f.in_band end,
    f.pct,
    f.sell_net,
    f.sell_src,
    case when f.sell_src = 'last_sold' then f.sold_order_number end,
    case when f.sell_src = 'last_sold' then f.sold_on end,
    case when f.sell_net is not null and f.pkr_raw is not null then round(f.sell_net - f.pkr_raw, 2) end,
    case when f.sell_net is not null and f.pkr_raw is not null then round((f.sell_net - f.pkr_raw) * f.item_qty, 2) end,
    f.rel_band,
    f.n_deliveries,
    f.n_on_time,
    f.n_late,
    f.med_late,
    f.n_orders,
    f.value_pkr,
    f.last_order_number,
    f.last_order_on,
    f.last_order_days,
    f.n_replied,
    f.n_asked,
    f.lead_time,
    f.in_stock
  from fin f
  order by f.item_pos, f.rfq_item_id, f.rk nulls last, lower(f.supplier_name), f.quote_line_id
$$;

revoke all on function public.rank_item_quotes(uuid) from public, anon, authenticated;
grant execute on function public.rank_item_quotes(uuid) to authenticated;
