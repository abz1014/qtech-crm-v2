-- 0035_brand_tokens (F-7 follow-up): a brand or family name is never a model code.
--
-- model_tokens() keeps any whitespace-separated word of 4+ characters with a letter and a digit. A brand called
-- "XYZ2000" or "S7-1200" therefore put its own name in the model_tokens of EVERY item of that brand, so every item of
-- the brand matched tier 0 "same model" against every other, and "supplied this item before" pre-ticked suppliers on
-- false history (DATA_MODEL 5c; Amendment A2b: only a true tier 0 or tier 1 match on a leg pre-ticks).
--
-- Choice: filter at COMPARISON time, not in the generated column.
--   * model_tokens() must stay IMMUTABLE for the two generated columns (rfq_items, order_items). A function that reads the
--     brands table cannot be immutable, so stripping brand tokens inside the column is not allowed.
--   * A column that bakes the brand list in would go stale the moment a brand is added or renamed, and every row would
--     need rewriting. Filtering when comparing is always current and changes no stored data.
-- The generated columns, their GIN indexes and model_tokens() are unchanged.
--
--   brand_tokens()                 every token that comes from a brand or family name: model_tokens(name), and the name
--                                  squeezed to letters and digits ("E+H 2000" -> EH2000) when that is a token. STABLE,
--                                  SECURITY INVOKER (brands is readable by all active staff, section 10).
--   tokens_without(tokens, drop)   tokens minus the ones to drop. IMMUTABLE, pure.
--   supplier_item_memory()         re-created: the target's tokens and every candidate's tokens (quote lines, legs, PO
--                                  snapshot lines) pass through tokens_without(... brand_tokens()) once per call.
--   issue_purchase_order()         re-created: the "last_po" price source compares tokens the same way.
-- item_match_tier() is unchanged (it compares the arrays it is given).

create function public.brand_tokens()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.tok order by x.tok), '{}'::text[])
  from (
    select unnest(public.model_tokens(b.name)) as tok from public.brands b
    union
    select s.sq
    from (select regexp_replace(upper(b.name), '[^A-Z0-9]', '', 'g') as sq from public.brands b) s
    where length(s.sq) >= 4 and s.sq ~ '[A-Z]' and s.sq ~ '[0-9]'
  ) x
$$;

create function public.tokens_without(p_tokens text[], p_drop text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.t order by x.ord), '{}'::text[])
  from unnest(coalesce(p_tokens, '{}'::text[])) with ordinality as x (t, ord)
  where p_drop is null or x.t <> all (p_drop)
$$;

revoke all on function public.brand_tokens() from public, anon, authenticated;
grant execute on function public.brand_tokens() to authenticated;
revoke all on function public.tokens_without(text[], text[]) from public, anon, authenticated;
grant execute on function public.tokens_without(text[], text[]) to authenticated;

-- ---------------------------------------------------------------- supplier_item_memory (0024, tokens filtered)
create or replace function public.supplier_item_memory(
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
  -- Tokens that are really a brand or family name ("S7", "XYZ2000") are not model codes: they are stripped from the
  -- target and from every candidate before the tiers are decided (migration 0035). One read of brands per call.
  t as (
    select public.tokens_without(public.model_tokens(p_description), b.arr) as tok,
           public.item_text_norm(p_description) as nrm,
           b.arr as bt
    from (select public.brand_tokens() as arr) b
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
                             public.tokens_without(ri.model_tokens, t.bt), public.item_text_norm(ri.description), ri.brand_id, ri.family_id,
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
                             public.tokens_without(oi.model_tokens, t.bt), public.item_text_norm(oi.description), oi.brand_id, oi.family_id,
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


-- ---------------------------------------------------------------- issue_purchase_order (0023, tokens filtered)
create or replace function public.issue_purchase_order(
  p_po_id             uuid,
  p_supplier_order_id uuid,
  p_lines             jsonb default null,
  p_incoterm          text default null,
  p_delivery_terms    text default null,
  p_payment_terms     text default null,
  p_ship_to           text default null,
  p_notes             text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_leg      public.supplier_orders;
  v_lines    jsonb;
  v_missing  text;
  v_number   integer;
  v_revision smallint;
  v_issued   date := public.today_pkt();
  v_inc      text;
  v_del      text;
  v_pay      text;
  v_po_terms text;
  v_address  text;
  v_bt       text[] := public.brand_tokens();
begin
  if p_po_id is null or p_supplier_order_id is null then
    raise exception 'issue_purchase_order needs a PO id and a supplier order' using errcode = '22023';
  end if;
  if exists (select 1 from public.purchase_orders where id = p_po_id) then
    return p_po_id;
  end if;

  select * into v_leg from public.supplier_orders where id = p_supplier_order_id for update;
  if not found then
    raise exception 'supplier order % not found', p_supplier_order_id using errcode = 'P0002';
  end if;
  if v_leg.currency is null then
    raise exception 'set the currency of this supplier order before issuing a PO' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.order_item_id), '[]'::jsonb),
         string_agg(x.description, ', ') filter (where x.unit_price is null)
  into v_lines, v_missing
  from (
    select
      oi.id as order_item_id,
      oi.position,
      oi.description,
      coalesce(s.qty, oi.qty) as qty,
      oi.unit,
      coalesce(s.unit_price, p.price) as unit_price,
      case when s.unit_price is not null and p.price is distinct from s.unit_price then 'typed'
           else coalesce(p.source, 'typed') end as price_source
    from public.order_items oi
    left join (
      select (e ->> 'order_item_id')::uuid as order_item_id,
             nullif(e ->> 'unit_price', '')::numeric as unit_price,
             nullif(e ->> 'qty', '')::numeric as qty
      from jsonb_array_elements(p_lines) e
    ) s on s.order_item_id = oi.id
    left join lateral (
      select c.price, c.source
      from (
        select oi.supplier_unit_price as price, 'order'::text as source, 1 as pri
        where oi.supplier_unit_price is not null
        union all
        (select q.unit_price, 'quote'::text, 2
         from public.supplier_quote_lines q
         join public.supplier_inquiries si on si.id = q.inquiry_id
         where oi.rfq_item_id is not null
           and q.rfq_item_id = oi.rfq_item_id
           and si.supplier_id = v_leg.supplier_id
           and q.currency = v_leg.currency
         order by q.created_at desc
         limit 1)
        union all
        (select (l.e ->> 'unit_price')::numeric, 'last_po'::text, 3
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
                 and extensions.similarity(public.item_text_norm(poi.description),
                                           public.item_text_norm(oi.description)) >= 0.45)
             or (oi.brand_id is null and oi.family_id is not null and poi.family_id = oi.family_id
                 and extensions.similarity(public.item_text_norm(poi.description),
                                           public.item_text_norm(oi.description)) >= 0.60)
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
      and (p_lines is null or s.order_item_id is not null)
  ) x;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'the supplier order has no goods lines to issue' using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_array_length(p_lines) <> jsonb_array_length(v_lines) then
    raise exception 'a line does not belong to this supplier order' using errcode = '22023';
  end if;
  if v_missing is not null then
    raise exception 'a price is needed for: %', v_missing using errcode = '22023';
  end if;

  select po.number, po.revision + 1 into v_number, v_revision
  from public.purchase_orders po
  where po.supplier_order_id = p_supplier_order_id
  order by po.revision desc
  limit 1;
  if v_number is null then
    v_number := nextval('public.po_number_seq');
    v_revision := 0;
  end if;

  select po.incoterm, po.delivery_terms, po.payment_terms into v_inc, v_del, v_pay
  from public.purchase_orders po
  join public.supplier_orders so on so.id = po.supplier_order_id
  where so.supplier_id = v_leg.supplier_id
  order by po.created_at desc
  limit 1;

  select p.po_terms, p.address into v_po_terms, v_address from public.company_profile p where p.id = 1;

  insert into public.purchase_orders (id, supplier_order_id, number, revision, issued_on, currency, lines, total,
                                      incoterm, delivery_terms, payment_terms, ship_to, notes)
  values (p_po_id, p_supplier_order_id, v_number, v_revision, v_issued, v_leg.currency, v_lines, 0,
          coalesce(p_incoterm, v_inc),
          coalesce(p_delivery_terms, v_del),
          coalesce(p_payment_terms, v_pay, v_po_terms),
          coalesce(p_ship_to, v_address),
          p_notes);

  update public.order_items oi
  set supplier_unit_price = r.unit_price
  from jsonb_to_recordset(v_lines) as r (order_item_id uuid, unit_price numeric)
  where oi.id = r.order_item_id;

  update public.supplier_orders set placed_on = v_issued where id = p_supplier_order_id and placed_on is null;

  return p_po_id;
end;
$$;
