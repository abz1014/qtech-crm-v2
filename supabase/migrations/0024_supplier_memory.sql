-- 0024_supplier_memory (S19, feature F-7): DATA_MODEL section 5c (Amendments A2 and A2b) and decision N.
-- Supplier memory is derived from existing records only: no input, no score, facts stored as counts. Everything is
-- plain SQL (no materialized views) and runs with the caller's rights (security invoker), so every underlying table's
-- row security applies. Every underlying table is readable by all active staff, so the views and the function are
-- too (section 10); anon and deactivated users get nothing.
--
-- Contents:
--   indexes              pg_trgm GIN on the normalised item text, B-tree (supplier_id, sent_on)
--   item_match_tier()    the tier rules of section 5c as one immutable helper (0 same model ... 3 same family)
--   v_supplier_activity  one row per sent inquiry of the last 24 months
--   v_supplier_stats     one row per supplier
--   supplier_item_memory()  per supplier: best tier, "supplied before", last quote / PO / ordered price
--
-- Indexes already present from earlier migrations and therefore not repeated here:
--   supplier_quote_lines(rfq_item_id)   supplier_quote_lines_item_idx (0008)
--   GIN(model_tokens) on rfq_items and order_items (0007, 0009)

-- ---------------------------------------------------------------- indexes
-- The trigram indexes are on item_text_norm(description), the text actually compared (section 5c norm()), so the
-- `%` operator and similarity() on the normalised text can use them. If item_text_norm() ever changes, rebuild both.
create index rfq_items_description_trgm_idx on public.rfq_items
  using gin (public.item_text_norm(description) extensions.gin_trgm_ops);
create index order_items_description_trgm_idx on public.order_items
  using gin (public.item_text_norm(description) extensions.gin_trgm_ops);
create index supplier_inquiries_supplier_sent_idx on public.supplier_inquiries (supplier_id, sent_on);

-- ---------------------------------------------------------------- item_match_tier (helper)
-- How a past item (c_*) relates to the target item (t_*). NULL means "no item match": the supplier is then described
-- by its overall stats only. First rule that fits wins:
--   0 same model   shares a model_tokens element with the target, and the brands are equal when both are set
--                  (a cross-brand token match never counts: short codes collide across makers)
--   1 same item    brand equal to the target's AND similarity(norm, norm) >= 0.45;
--                  or, when the target has no brand, family equal AND similarity >= 0.60
--   2 same brand   brand equal to the target's
--   3 same family  family equal to the target's
-- c_guessed is the legacy flag item_guessed: the item behind an imported quote line was a guess, so it is excluded from
-- the item-level tiers 0-2 (section 5c names tiers 1 and 2; tier 0 is the stronger version of tier 1, so it follows).
-- Tier 3 stays as written. The caller passes norm() text, so the normalisation runs once per row, not per comparison.
create function public.item_match_tier(
  t_tokens text[], t_norm text, t_brand uuid, t_family uuid,
  c_tokens text[], c_norm text, c_brand uuid, c_family uuid,
  c_guessed boolean default false
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case
    when not c_guessed and t_tokens && c_tokens
         and (t_brand is null or c_brand is null or t_brand = c_brand) then 0
    when not c_guessed and t_brand is not null and c_brand = t_brand
         and extensions.similarity(t_norm, c_norm) >= 0.45 then 1
    when not c_guessed and t_brand is null and t_family is not null and c_family = t_family
         and extensions.similarity(t_norm, c_norm) >= 0.60 then 1
    when not c_guessed and t_brand is not null and c_brand = t_brand then 2
    when t_family is not null and c_family = t_family then 3
  end)::smallint
$$;

revoke all on function public.item_match_tier(text[], text, uuid, uuid, text[], text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.item_match_tier(text[], text, uuid, uuid, text[], text, uuid, uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------- v_supplier_activity
-- One row per inquiry that was sent (sent_on set) within the last 24 months.
--   first_reply_on  the earlier of the first quote line's date and no_offer_on (Karachi dates)
--   replied         a quote line exists or a no-offer was declared
--   quoted          at least one quote line exists
--   no_offer        a no-offer was declared and nothing was quoted
--   reply_days      calendar days from sent_on to first_reply_on, never negative
--   is_legacy       the inquiry, or any of its quote lines, was imported
-- For imported rows created_at is the import date, so their reply_days mean nothing: the stats ignore them (is_legacy).
create view public.v_supplier_activity with (security_invoker = true) as
select
  si.supplier_id,
  si.rfq_id,
  si.id as inquiry_id,
  si.sent_on,
  fr.first_reply_on,
  (fr.first_reply_on is not null) as replied,
  q.quoted,
  (si.no_offer_on is not null and not q.quoted) as no_offer,
  case when fr.first_reply_on is not null then greatest(fr.first_reply_on - si.sent_on, 0) end as reply_days,
  (si.legacy_source is not null or q.any_legacy) as is_legacy
from public.supplier_inquiries si
cross join lateral (
  select count(*) > 0 as quoted,
         min(public.today_pkt(l.created_at)) as first_quote_on,
         coalesce(bool_or(l.legacy_source is not null), false) as any_legacy
  from public.supplier_quote_lines l
  where l.inquiry_id = si.id
) q
cross join lateral (
  select least(q.first_quote_on, si.no_offer_on) as first_reply_on
) fr
where si.sent_on is not null
  and si.sent_on >= (public.today_pkt() - interval '24 months')::date;

revoke all on public.v_supplier_activity from public, anon, authenticated;
grant select on public.v_supplier_activity to authenticated;

-- ---------------------------------------------------------------- v_supplier_stats
-- One row per supplier: a company with an inquiry, a procurement leg or a company_brands row. (A payee-only company is
-- not listed: expenses are admin-only, and the view must read the same for every role.) Rates are never stored as
-- percentages: each is a numerator and a denominator. Thresholds are encoded where section 5c states them as data
-- rules (medians need enough rows); display rules (a < 3 shows raw facts) are the UI's.
--   asked, replied, no_offer, quoted   over v_supplier_activity (24 months); asked = sent at least 7 days ago, or
--                                       already replied
--   reply_days_n                        non-legacy replied rows among asked
--   median_reply_days                   median over those rows; NULL below 3 rows
--   chosen_of, chosen                   items this supplier quoted that were later ordered (non-cancelled order, from
--                                       anyone), and how many of those were ordered on a leg with this supplier. All time.
--   deliveries, late, median_days_late  legs with expected_on and received_on; late = received after expected; the
--                                       median of the days late only with at least 3 late legs. All time.
--   last_contact                        latest of sent_on, last_chased_on, last_relayed_at (date), PO issued_on
--   brand_ids, brand_names              company_brands (brands and families), by name
--   legacy_asked, prices_hidden         provenance: imported inquiries among asked; quote lines whose currency is
--                                       unverified (their price is hidden in memory cards)
create view public.v_supplier_stats with (security_invoker = true) as
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
  ph.prices_hidden
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
where exists (select 1 from public.supplier_inquiries si where si.supplier_id = c.id)
   or exists (select 1 from public.supplier_orders so where so.supplier_id = c.id)
   or exists (select 1 from public.company_brands cb where cb.company_id = c.id);

revoke all on public.v_supplier_stats from public, anon, authenticated;
grant select on public.v_supplier_stats to authenticated;

-- ---------------------------------------------------------------- supplier_item_memory
-- For each supplier id given (in the caller's order: memory never reorders the list) and the target item
-- (brand, family, description), what do we know about that supplier and that item?
--
-- Candidate past items are the supplier's:
--   quote lines  (the quoted rfq_item)
--   legs         (order_items on a procurement leg with this supplier, non-cancelled orders only)
--   PO lines     (purchase_orders.lines snapshots on such legs)
-- p_exclude_rfq_id (optional, appended to the section 5c signature) leaves out one RFQ and the orders converted from
-- it, so the RFQ being worked on does not "remember" itself.
--
--   best_tier / best_tier_label  strongest item_match_tier over all three pools; NULL = supplier-level only
--   supplied_before              a tier 0 or tier 1 match on a leg: the only reason that pre-ticks a supplier
--   last_quote_*                 the quote line with the best tier, newest first within it; price, currency, the
--                                captured rate ("at the time") and price in PKR at that rate, date, qty, lead time.
--                                currency_unverified: price, currency and PKR are NULL and price_hidden is true.
--                                An imported line has no captured rate: the original currency only (price_pkr NULL).
--                                Imported lines are dated by the inquiry's sent_on (their created_at is the import day).
--   recent_lead_times            the two newest distinct lead-time strings among the quote lines of that best tier,
--                                verbatim (free text: no median)
--   last_po_*                    the same for PO snapshot lines. A PO carries no captured rate, so the rate is the
--                                latest fx_rates row on or before the PO date and at most 30 days older (manual
--                                preferred); last_po_fx_rate_on shows its date. NULL when none.
--   last_ordered_*               "last ordered price": the best-tier PO line; for items that never got a PO,
--                                order_items.supplier_unit_price on a leg with this supplier (last_ordered_source =
--                                'order', "agreed on order, no PO issued"). An order line already covered by a PO
--                                is represented by the PO. Rate as for POs.
-- Order lines on a leg whose currency is unset have a price but no currency and no PKR figure.
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
  last_ordered_unit         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  t as (
    select public.model_tokens(p_description) as tok, public.item_text_norm(p_description) as nrm
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
                             ri.model_tokens, public.item_text_norm(ri.description), ri.brand_id, ri.family_id,
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
      oi.qty,
      oi.unit,
      oi.supplier_unit_price as price,
      so.currency,
      coalesce(so.placed_on, o.ordered_on, public.today_pkt(so.created_at)) as on_date,
      so.created_at,
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             oi.model_tokens, public.item_text_norm(oi.description), oi.brand_id, oi.family_id,
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
                             public.model_tokens(l.e ->> 'description'),
                             public.item_text_norm(l.e ->> 'description'),
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
    o.unit
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
