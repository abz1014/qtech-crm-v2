begin;
select * from no_plan();

-- 0074 part C: the matching prefilter returns exactly what the functions returned before.
-- The pre-0074 bodies of supplier_item_memory (0049), supplier_item_evidence (0066), customer_price_memory (0041) and
-- po_line_prefill (0043) are re-created below, word for word, as pg_temp.ref_* functions. A catalogue built to hit every tier
-- (same model, same item, same brand, same family, none), brand names that look like model codes, guessed and imported lines,
-- PO snapshots whose description no longer matches the order line, services and cancelled orders, is then read through both
-- versions for many targets, and every result row (every column, in order) must be identical.

-- ------------------------------------------------------------------ the pre-0074 functions
create function pg_temp.ref_supplier_item_memory(
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

create function pg_temp.ref_supplier_item_evidence(
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

create function pg_temp.ref_customer_price_memory(p_rfq_id uuid)
returns table (
  rfq_item_id  uuid,
  sold_price   numeric,
  sold_on      date,
  sold_tier    smallint,
  sold_order_number bigint,
  quoted_price numeric,
  quoted_on    date,
  quoted_tier  smallint,
  quoted_revision smallint,
  quoted_number   integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  r as (select company_id from public.rfqs where id = p_rfq_id),
  bw as (select public.brand_tokens() as bt, public.brand_words() as words),
  target as (
    select i.id, public.tokens_without(i.model_tokens, bw.bt) as tok,
           public.strip_words(public.item_text_norm(i.description), bw.words) as nrm, i.brand_id, i.family_id
    from public.rfq_items i
    cross join bw
    where i.rfq_id = p_rfq_id
  ),
  sold as (
    select distinct on (t.id)
      t.id as item_id, oi.unit_price_net as price, o.ordered_on as on_date, m.tier, o.number as order_number
    from target t
    cross join r
    cross join bw
    join public.orders o on o.company_id = r.company_id and o.cancelled_on is null
                        and o.rfq_id is distinct from p_rfq_id
    join public.order_items oi on oi.order_id = o.id
    cross join lateral (
      select public.item_match_tier(t.tok, t.nrm, t.brand_id, t.family_id,
                                    public.tokens_without(oi.model_tokens, bw.bt),
                                    public.strip_words(public.item_text_norm(oi.description), bw.words),
                                    oi.brand_id, oi.family_id,
                                    'item_guessed' = any (oi.legacy_flags)) as tier
    ) m
    where m.tier <= 1
    order by t.id, o.ordered_on desc nulls last, o.created_at desc, m.tier
  ),
  quoted as (
    select distinct on (t.id)
      t.id as item_id, (l.e ->> 'unit_price_net')::numeric as price, qt.issued_on as on_date, m.tier,
      qt.revision, qt.number
    from target t
    cross join r
    cross join bw
    join public.rfqs q on q.company_id = r.company_id and q.id <> p_rfq_id
    join public.quotations qt on qt.rfq_id = q.id
    cross join lateral jsonb_array_elements(qt.lines) as l (e)
    join public.rfq_items ri on ri.id = (l.e ->> 'rfq_item_id')::uuid
    cross join lateral (
      select public.item_match_tier(t.tok, t.nrm, t.brand_id, t.family_id,
                                    public.tokens_without(ri.model_tokens, bw.bt),
                                    public.strip_words(public.item_text_norm(ri.description), bw.words),
                                    ri.brand_id, ri.family_id, false) as tier
    ) m
    where m.tier <= 1 and nullif(l.e ->> 'unit_price_net', '') is not null
    order by t.id, qt.issued_on desc, qt.revision desc, m.tier
  )
  select t.id, s.price, s.on_date, s.tier, s.order_number, q.price, q.on_date, q.tier, q.revision, q.number
  from target t
  left join sold s on s.item_id = t.id
  left join quoted q on q.item_id = t.id
  where s.item_id is not null or q.item_id is not null
$$;

create function pg_temp.ref_po_line_prefill(p_supplier_order_id uuid)
returns table (
  order_item_id   uuid,
  "position"      smallint,
  description     text,
  qty             numeric,
  unit            text,
  unit_price      numeric,
  price_source    text,
  source_number   integer,
  source_revision smallint,
  source_on       date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_leg public.supplier_orders;
  v_bt  text[] := public.brand_tokens();
  v_bw  text[] := public.brand_words();
begin
  select * into v_leg from public.supplier_orders where id = p_supplier_order_id;
  if not found then
    return;
  end if;

  return query
  select
    oi.id,
    oi.position,
    oi.description,
    oi.qty,
    oi.unit,
    p.price,
    coalesce(p.source, 'typed'),
    p.src_no,
    p.src_rev,
    p.src_on
  from public.order_items oi
  left join lateral (
    select c.price, c.source, c.src_no, c.src_rev, c.src_on
    from (
      select oi.supplier_unit_price as price, 'order'::text as source, 1 as pri,
             null::integer as src_no, null::smallint as src_rev, null::date as src_on
      where oi.supplier_unit_price is not null
      union all
      (select q.unit_price, 'quote'::text, 2, r.number::integer, null::smallint, q.created_at::date
       from public.supplier_quote_lines q
       join public.supplier_inquiries si on si.id = q.inquiry_id
       join public.rfqs r on r.id = si.rfq_id
       where oi.rfq_item_id is not null
         and q.rfq_item_id = oi.rfq_item_id
         and si.supplier_id = v_leg.supplier_id
         and q.currency = v_leg.currency
       order by q.created_at desc
       limit 1)
      union all
      (select (l.e ->> 'unit_price')::numeric, 'last_po'::text, 3, po.number, po.revision, po.issued_on
       from public.purchase_orders po
       join public.supplier_orders so on so.id = po.supplier_order_id and so.supplier_id = v_leg.supplier_id
       cross join lateral jsonb_array_elements(po.lines) as l (e)
       join public.order_items poi on poi.id = (l.e ->> 'order_item_id')::uuid
       where po.currency = v_leg.currency
         and nullif(l.e ->> 'unit_price', '') is not null
         and (
           poi.id = oi.id
           or (public.tokens_without(poi.model_tokens, v_bt) && public.tokens_without(oi.model_tokens, v_bt)
               and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id))
           or (oi.brand_id is not null and poi.brand_id = oi.brand_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), public.strip_words(public.item_text_norm(oi.description), v_bw), 0.45))
           or (oi.brand_id is null and oi.family_id is not null and poi.family_id = oi.family_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), public.strip_words(public.item_text_norm(oi.description), v_bw), 0.60))
         )
       order by (poi.id = oi.id) desc,
                (public.tokens_without(poi.model_tokens, v_bt) && public.tokens_without(oi.model_tokens, v_bt)
                 and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id)) desc,
                po.created_at desc
       limit 1)
    ) c
    order by c.pri
    limit 1
  ) p on true
  where oi.supplier_order_id = p_supplier_order_id
    and not oi.is_service
  order by oi.position, oi.id;
end;
$$;

-- ------------------------------------------------------------------ catalogue (as the table owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create function pg_temp.u(prefix text, g integer) returns uuid language sql immutable as
  $$ select (prefix || '-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid $$;

-- five brands (one named like a model code, XYZ2000, so its name must be stripped from every token list) and three families
insert into public.brands (id, name, kind) values
  (pg_temp.u('bb000000', 1), 'Belimo', 'brand'),
  (pg_temp.u('bb000000', 2), 'Hach', 'brand'),
  (pg_temp.u('bb000000', 3), 'Siemens', 'brand'),
  (pg_temp.u('bb000000', 4), 'XYZ2000', 'brand'),
  (pg_temp.u('bb000000', 5), 'Endress Hauser', 'brand'),
  (pg_temp.u('bb000000', 6), 'Actuators', 'family'),
  (pg_temp.u('bb000000', 7), 'Control valves', 'family'),
  (pg_temp.u('bb000000', 8), 'Sensors', 'family');

insert into public.companies (id, name)
select pg_temp.u('cc000000', g), case when g <= 2 then 'Match customer ' || g else 'Match supplier ' || g end
from generate_series(1, 2) g union all
select pg_temp.u('cc000000', g), 'Match supplier ' || g from generate_series(11, 18) g;

insert into public.rfqs (id, company_id, owner_id, received_on)
select pg_temp.u('d0000000', g), pg_temp.u('cc000000', 1 + g % 2), 'a0000000-0000-4000-8000-000000000002', public.today_pkt() - g
from generate_series(1, 120) g;

-- three items per RFQ; a ninth have no brand, a third carry a family; about one in thirteen is a short description
insert into public.rfq_items (id, rfq_id, position, description, brand_id, family_id, qty, quoted_unit_price_net)
select pg_temp.u('d1000000', g * 4 + p), pg_temp.u('d0000000', g), p,
       case when (g * 7 + p) % 13 = 0 then (array['24V actuator', 'cable gland', 'valve'])[1 + g % 3]
            else (array['Belimo', 'Hach', 'Siemens', 'XYZ2000', 'Endress Hauser'])[1 + (g + p) % 5] || ' ' ||
                 (array['LF24-SR', 'NM24A', 'PMA1234', 'HQ5520', 'XK900', 'SN7741', 'FT2200', 'AB12', 'XYZ2000'])[1 + (g * 3 + p) % 9] || ' ' ||
                 (array['actuator', 'transmitter', 'flow meter', 'control valve', 'pressure sensor', 'cable 24V', 'positioner'])[1 + (g + p * 2) % 7] ||
                 (array['', ' spare', ' complete unit', ' with bracket'])[1 + (g + p) % 4]
       end,
       case when (g + p) % 9 = 0 then null else pg_temp.u('bb000000', 1 + (g + p) % 5) end,
       case when (g + p) % 3 = 0 then pg_temp.u('bb000000', 6 + (g + 2 * p) % 3) end,
       1 + (g + p) % 4,
       case when g % 5 = 0 then 200 + g end
from generate_series(1, 120) g, generate_series(0, 2) p;

-- each RFQ goes to three of the eight suppliers
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on)
select pg_temp.u('e1000000', g * 4 + s), pg_temp.u('d0000000', g), pg_temp.u('cc000000', 11 + (g + s * 3) % 8), public.today_pkt() - g
from generate_series(1, 120) g, generate_series(0, 2) s;

insert into public.fx_rates (currency, rate_pkr, as_of, source)
select c, 250 + d % 40, public.today_pkt() - d, 'auto' from unnest(array['USD', 'EUR']) c, generate_series(0, 200, 2) d;

-- quote lines: most items, with guessed items, unverified currencies and imported lines among them
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, legacy_flags, legacy_source, created_at)
select pg_temp.u('e2000000', g * 16 + s * 4 + p), pg_temp.u('e1000000', g * 4 + s), pg_temp.u('d1000000', g * 4 + p),
       10 + (g * 7 + p) % 300, (array['USD', 'EUR', 'PKR'])[1 + (g + s) % 3],
       (array['ex-stock', '2 weeks', '4-6 weeks', null])[1 + (g + p) % 4],
       case when (g + s + p) % 17 = 0 then '{item_guessed}'::text[] when (g + s + p) % 19 = 0 then '{currency_unverified}'::text[] else '{}'::text[] end,
       case when (g + s + p) % 23 = 0 then '{"source": "fixture"}'::jsonb end,
       now() - make_interval(days => g)
from generate_series(1, 120) g, generate_series(0, 2) s, generate_series(0, 2) p
where (g + s + p) % 4 <> 0;

-- orders on the first 60 RFQs (every tenth cancelled), two supplier orders each, the RFQ's items as order lines
insert into public.orders (id, company_id, owner_id, rfq_id, ordered_on, cancelled_on)
select pg_temp.u('a1000000', g), pg_temp.u('cc000000', 1 + g % 2), 'a0000000-0000-4000-8000-000000000002', pg_temp.u('d0000000', g),
       public.today_pkt() - g, case when g % 10 = 0 then public.today_pkt() end
from generate_series(1, 60) g;
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on, delivered_on, created_at)
select pg_temp.u('a3000000', g * 2 + k), pg_temp.u('a1000000', g), pg_temp.u('cc000000', 11 + (g + k * 3) % 8),
       (array['USD', 'PKR'])[1 + k],
       case when (g + k) % 7 <> 0 then public.today_pkt() - g end,
       public.today_pkt() - g + 20,
       case when (g + k) % 3 = 0 then public.today_pkt() - g + 18 + (g % 5) end,
       now() - make_interval(days => g, secs => k)
from generate_series(1, 60) g, generate_series(0, 1) k;
insert into public.order_items (id, order_id, position, description, brand_id, family_id, qty, unit_price_net, is_service,
                                rfq_item_id, supplier_order_id, supplier_unit_price, legacy_flags)
select pg_temp.u('a2000000', g * 4 + p), pg_temp.u('a1000000', g), p, ri.description, ri.brand_id, ri.family_id, ri.qty,
       150 + (g * 3 + p) % 90, (g + p) % 11 = 0, ri.id,
       pg_temp.u('a3000000', g * 2 + case when p = 2 then 1 else 0 end),
       case when (g + p) % 4 <> 0 then 5 + (g * 5 + p) % 200 end,
       case when (g + p) % 13 = 0 then '{item_guessed}'::text[] else '{}'::text[] end
from generate_series(1, 60) g cross join generate_series(0, 2) p
join public.rfq_items ri on ri.id = pg_temp.u('d1000000', g * 4 + p);

-- POs on the first supplier order of two orders in three (a second revision on every sixth), with a snapshot of the lines
insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, total, lines, created_at)
select pg_temp.u('a5000000', g * 2 + r), so.id, 30000 + g, r, public.today_pkt() - g + 1 + r, so.currency, 0,
       (select jsonb_agg(jsonb_build_object('order_item_id', oi.id, 'description', oi.description, 'qty', oi.qty, 'unit', 'pcs',
                                            'unit_price', 50 + g + r, 'price_source', 'order')
                         order by oi.position)
        from public.order_items oi where oi.supplier_order_id = so.id and not oi.is_service),
       now() - make_interval(days => g, secs => r)
from generate_series(1, 60) g cross join generate_series(0, 1) r
join public.supplier_orders so on so.id = pg_temp.u('a3000000', g * 2)
where g % 3 <> 0 and (r = 0 or g % 6 = 1)
  and exists (select 1 from public.order_items oi where oi.supplier_order_id = so.id and not oi.is_service);

-- after the POs: some order lines are re-described (the snapshot no longer matches) and a few change brand
update public.order_items set description = description || ' rev B'
where id in (select pg_temp.u('a2000000', g * 4 + p) from generate_series(1, 60) g, generate_series(0, 2) p where (g + p) % 5 = 0);
update public.order_items set brand_id = pg_temp.u('bb000000', 2)
where id in (select pg_temp.u('a2000000', g * 4) from generate_series(1, 60) g where g % 8 = 0);

-- quotations to the customers on RFQs 61-120 (and on a few ordered ones), for customer_price_memory's "last quoted"
insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, lines)
select pg_temp.u('a4000000', g), pg_temp.u('d0000000', g), 40000 + g, 0, public.today_pkt() - g, public.today_pkt() + 30,
       (select jsonb_agg(jsonb_build_object('rfq_item_id', ri.id, 'description', ri.description, 'qty', ri.qty, 'unit', 'pcs',
                                            'unit_price_net', 300 + g + ri.position, 'gst_rate', 18) order by ri.position)
        from public.rfq_items ri where ri.rfq_id = pg_temp.u('d0000000', g))
from generate_series(1, 120) g
where (g > 60 and g % 3 <> 0) or g % 4 = 0;

analyze public.rfq_items, public.supplier_inquiries, public.supplier_quote_lines, public.orders, public.supplier_orders,
        public.order_items, public.purchase_orders, public.quotations, public.brands;

-- ------------------------------------------------------------------ both versions, many targets
create temp table cmp (fn text, k text, same boolean, rows_new integer, rows_ref integer);
create temp table tiers_seen (fn text, tier smallint);
create temp table timing (fn text, version text, ms numeric);

-- targets: every fifth RFQ item, plus hand-made ones (no brand and no family; a brand name as the only "model code"; a family
-- only; a description that matches nothing)
create temp table targets as
select row_number() over (order by ri.id) as n, ri.rfq_id, ri.brand_id, ri.family_id, ri.description
from public.rfq_items ri
where ri.rfq_id in (select pg_temp.u('d0000000', g) from generate_series(1, 120) g) and (ri.position + ri.qty::int) % 5 = 0
union all select 1001, null, null, null, 'LF24-SR actuator spare part'
union all select 1002, null, pg_temp.u('bb000000', 4), null, 'XYZ2000 positioner unit new'
union all select 1003, null, null, pg_temp.u('bb000000', 6), 'rotary actuator 24V spring'
union all select 1004, null, pg_temp.u('bb000000', 1), null, 'completely different thing here'
union all select 1005, null, null, null, 'nothing matches this at all'
union all select 1006, null, pg_temp.u('bb000000', 2), null, 'Hach flow meter complete unit';

do $$
declare
  t    record;
  sups uuid[];
  a    text[];
  b    text[];
  t0   timestamptz;
  tn   numeric := 0;
  tr   numeric := 0;
begin
  select array_agg(pg_temp.u('cc000000', 11 + k) order by (k * 5) % 8) into sups from generate_series(0, 7) k;
  for t in select * from targets order by n loop
    t0 := clock_timestamp();
    select array_agg(x::text order by x.ordinality) into a
    from public.supplier_item_memory(sups, t.brand_id, t.family_id, t.description, case when t.n % 2 = 0 then t.rfq_id end)
         with ordinality as x;
    tn := tn + extract(epoch from clock_timestamp() - t0) * 1000;
    t0 := clock_timestamp();
    select array_agg(x::text order by x.ordinality) into b
    from pg_temp.ref_supplier_item_memory(sups, t.brand_id, t.family_id, t.description, case when t.n % 2 = 0 then t.rfq_id end)
         with ordinality as x;
    tr := tr + extract(epoch from clock_timestamp() - t0) * 1000;
    insert into cmp values ('supplier_item_memory', t.n::text, a is not distinct from b, cardinality(a), cardinality(b));
    insert into tiers_seen
    select 'supplier_item_memory', m.best_tier
    from public.supplier_item_memory(sups, t.brand_id, t.family_id, t.description, case when t.n % 2 = 0 then t.rfq_id end) m;

    select array_agg(x::text order by x.ordinality) into a
    from public.supplier_item_evidence(sups, t.brand_id, t.family_id, t.description, case when t.n % 3 = 0 then t.rfq_id end, 5)
         with ordinality as x;
    select array_agg(x::text order by x.ordinality) into b
    from pg_temp.ref_supplier_item_evidence(sups, t.brand_id, t.family_id, t.description, case when t.n % 3 = 0 then t.rfq_id end, 5)
         with ordinality as x;
    insert into cmp values ('supplier_item_evidence', t.n::text, a is not distinct from b, cardinality(a), cardinality(b));
  end loop;
  insert into timing values ('supplier_item_memory', 'new', tn), ('supplier_item_memory', 'ref', tr);

  tn := 0; tr := 0;
  for t in select g from generate_series(1, 120) g loop
    t0 := clock_timestamp();
    select array_agg(x::text order by x::text) into a from public.customer_price_memory(pg_temp.u('d0000000', t.g)) x;
    tn := tn + extract(epoch from clock_timestamp() - t0) * 1000;
    t0 := clock_timestamp();
    select array_agg(x::text order by x::text) into b from pg_temp.ref_customer_price_memory(pg_temp.u('d0000000', t.g)) x;
    tr := tr + extract(epoch from clock_timestamp() - t0) * 1000;
    insert into cmp values ('customer_price_memory', t.g::text, a is not distinct from b, cardinality(a), cardinality(b));
    insert into tiers_seen select 'customer_price_memory', coalesce(m.sold_tier, m.quoted_tier)
    from public.customer_price_memory(pg_temp.u('d0000000', t.g)) m;
  end loop;
  insert into timing values ('customer_price_memory', 'new', tn), ('customer_price_memory', 'ref', tr);

  for t in select so.id from public.supplier_orders so where so.id in (select pg_temp.u('a3000000', g) from generate_series(2, 121) g) loop
    select array_agg(x::text order by x.ordinality) into a from public.po_line_prefill(t.id) with ordinality as x;
    select array_agg(x::text order by x.ordinality) into b from pg_temp.ref_po_line_prefill(t.id) with ordinality as x;
    insert into cmp values ('po_line_prefill', t.id::text, a is not distinct from b, cardinality(a), cardinality(b));
  end loop;
end
$$;

-- ------------------------------------------------------------------ results
select is((select coalesce(array_agg(fn || ' ' || k order by fn, k), '{}') from cmp where not same), '{}'::text[],
  'every call returns exactly the pre-0074 rows (every column, same order)');
select cmp_ok((select count(*)::int from cmp where fn = 'supplier_item_memory'), '>=', 60, 'supplier_item_memory compared on 60+ targets');
select cmp_ok((select count(*)::int from cmp where fn = 'supplier_item_evidence' and rows_new > 0), '>=', 20,
  'supplier_item_evidence compared, with evidence rows on 20+ targets');
select ok((select array_agg(distinct tier) from tiers_seen where fn = 'supplier_item_memory') @> array[0, 1, 2, 3]::smallint[],
  'the comparison covers every tier: same model, same item, same brand, same family');
select ok(exists (select 1 from tiers_seen where fn = 'supplier_item_memory' and tier is null),
  'and suppliers with no match at all');
select is((select count(*)::int from cmp where fn = 'customer_price_memory'), 120, 'customer_price_memory compared on all 120 RFQs');
select cmp_ok((select count(*)::int from cmp where fn = 'customer_price_memory' and rows_new > 0), '>=', 20,
  'with last-sold or last-quoted prices on 20+ of them');
select cmp_ok((select count(*)::int from tiers_seen where fn = 'customer_price_memory' and tier is not null), '>', 0,
  'customer_price_memory comparisons include matched items');
select cmp_ok((select count(*)::int from cmp where fn = 'po_line_prefill' and rows_new > 0), '>=', 100, 'po_line_prefill compared on 100+ supplier orders');
select ok(exists (select 1 from public.supplier_orders so cross join lateral public.po_line_prefill(so.id) p
                  where so.id in (select pg_temp.u('a3000000', g) from generate_series(2, 121) g) and p.price_source = 'last_po'),
  'po_line_prefill comparisons include a "last PO" price');
select pass(format('timing (informational): supplier_item_memory %s ms new vs %s ms before over %s targets; customer_price_memory %s ms new vs %s ms before over 120 RFQs',
  (select round(ms) from timing where fn = 'supplier_item_memory' and version = 'new'),
  (select round(ms) from timing where fn = 'supplier_item_memory' and version = 'ref'),
  (select count(*) from targets),
  (select round(ms) from timing where fn = 'customer_price_memory' and version = 'new'),
  (select round(ms) from timing where fn = 'customer_price_memory' and version = 'ref')));

select * from finish();
rollback;
