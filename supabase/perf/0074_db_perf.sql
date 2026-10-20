-- supabase/perf/0074_db_perf.sql: EXPLAIN ANALYZE timings of the heavy reads, before and after 0074/0075, on a realistic
-- synthetic dataset (about three years of a busy Q-Tech: 2,000 orders, 6,000 invoices, 20,000 expenses, 3,000 RFQs, 9,000
-- enquiries). Run by .github/workflows/db.yml (step "DB perf") with psql against the freshly reset local database; it is not a
-- pgTAP file, so `supabase test db` does not run it. Everything happens in one transaction that is rolled back.
--
--   after   the database as the migrations leave it (role check once per statement, prefiltered matching)
--   before  the same transaction with every policy and view put back to its pre-0074 text, and the pre-0074 matching
--           functions (pg_temp.ref_*, the 0041/0049 bodies word for word)
-- Each read runs as the persona the app uses for it (admin or sales), as the `authenticated` role, so row security is part of
-- what is measured. Each is run once to warm up and then twice under EXPLAIN (ANALYZE, TIMING OFF); the faster run counts.
-- Every read is also fingerprinted (md5 of all its rows) in both states; any difference stops the script with an error,
-- which fails the CI step. The numbers are printed as NOTICE lines and as a final table.

\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ helpers: put policies and views back to pre-0074
create function pg_temp.rls_unwrap(t text) returns text language sql immutable as $f$
  select regexp_replace(
           regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)\s+AS\s+current_user_role\s*\)', 'public.current_user_role()', 'gi'),
           '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', 'auth.uid()', 'gi')
$f$;
create function pg_temp.rls_has_wrapped(t text) returns boolean language sql immutable as $f$
  select coalesce(t ~* '\(\s*SELECT\s+(public\.current_user_role\(\)\s+AS\s+current_user_role|auth\.uid\(\)\s+AS\s+uid)\s*\)', false)
$f$;
create function pg_temp.unwrap_everything() returns integer language plpgsql set search_path = '' as $f$
declare
  p record;
  v record;
  s text;
  n integer := 0;
begin
  for p in
    select n2.nspname as sch, c.relname as tbl, pol.polname as pname,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n2 on n2.oid = c.relnamespace
    where n2.nspname = 'public' or (n2.nspname = 'storage' and c.relname = 'objects' and pol.polname like 'qtech\_%')
  loop
    if not (pg_temp.rls_has_wrapped(p.qual) or pg_temp.rls_has_wrapped(p.wcheck)) then
      continue;
    end if;
    s := format('alter policy %I on %I.%I', p.pname, p.sch, p.tbl);
    if p.qual is not null then s := s || format(' using (%s)', pg_temp.rls_unwrap(p.qual)); end if;
    if p.wcheck is not null then s := s || format(' with check (%s)', pg_temp.rls_unwrap(p.wcheck)); end if;
    execute s;
    n := n + 1;
  end loop;
  for v in
    select c.relname, c.reloptions, pg_catalog.pg_get_viewdef(c.oid) as def
    from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  loop
    if not pg_temp.rls_has_wrapped(v.def) then
      continue;
    end if;
    execute format('create or replace view public.%I%s as %s', v.relname,
                   case when v.reloptions is null then '' else format(' with (%s)', array_to_string(v.reloptions, ', ')) end,
                   pg_temp.rls_unwrap(regexp_replace(v.def, ';\s*$', '')));
    n := n + 1;
  end loop;
  return n;
end
$f$;

-- ------------------------------------------------------------------ the pre-0074 matching functions
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

-- ------------------------------------------------------------------ synthetic dataset (as the table owner, admin claims)
create function pg_temp.u(prefix text, g integer) returns uuid language sql immutable as
  $$ select (prefix || '-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid $$;

select clock_timestamp() as t0 \gset

insert into public.brands (id, name, kind)
select pg_temp.u('b0000000', g), case when g <= 30 then 'Perf brand ' || g else 'Perf family ' || g end,
       case when g <= 30 then 'brand' else 'family' end
from generate_series(1, 40) g;

-- 300 customers (1-300) and 150 suppliers (1001-1150)
insert into public.companies (id, name)
select pg_temp.u('c0000000', g), 'Perf customer ' || g from generate_series(1, 300) g
union all
select pg_temp.u('c0000000', g), 'Perf supplier ' || g from generate_series(1001, 1150) g;

-- 3,000 RFQs over three years; a quarter closed; owners alternate sales and admin
insert into public.rfqs (id, company_id, owner_id, received_on, due_on, closed_on, close_reason)
select pg_temp.u('d0000000', g), pg_temp.u('c0000000', 1 + g % 300),
       (case when g % 2 = 0 then 'a0000000-0000-4000-8000-000000000002' else 'a0000000-0000-4000-8000-000000000001' end)::uuid,
       public.today_pkt() - (g % 1095), public.today_pkt() - (g % 1095) + 7,
       case when g % 4 = 0 and g > 2000 then public.today_pkt() - (g % 1095) + 20 end,
       case when g % 4 = 0 and g > 2000 then 'price' end
from generate_series(1, 3000) g;

insert into public.rfq_items (id, rfq_id, position, description, brand_id, family_id, qty)
select pg_temp.u('d1000000', g * 4 + p), pg_temp.u('d0000000', g), p,
       'Perf brand ' || (1 + (g + p) % 30) || ' ' ||
       (array['LF', 'NM', 'HQ', 'XK', 'PMA', 'SN', 'FT'])[1 + (g * 3 + p) % 7] || (1000 + (g * 7 + p * 13) % 400) ||
       (array['-SR', '', '-X', ' pro'])[1 + (g + p) % 4] || ' ' ||
       (array['actuator', 'transmitter', 'meter', 'valve', 'sensor', 'cable 24V', 'positioner'])[1 + (g + p * 2) % 7],
       pg_temp.u('b0000000', 1 + (g + p) % 30),
       case when g % 3 = 0 then pg_temp.u('b0000000', 31 + g % 10) end,
       1 + (g % 5)
from generate_series(1, 3000) g, generate_series(0, 2) p;

-- 9,000 enquiries (three per RFQ, skewed to popular suppliers), chased and declined now and then
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, last_chased_on, chase_count, no_offer_on, last_relayed_at)
select pg_temp.u('e0000000', g * 4 + s), pg_temp.u('d0000000', g),
       pg_temp.u('c0000000', 1001 + ((floor(150 * power(((g * 7919 + s * 104729) % 1000) / 1000.0, 2))::int + s * 50) % 150)),
       public.today_pkt() - (g % 1095),
       case when g % 5 = 0 then public.today_pkt() - (g % 1000) end,
       case when g % 5 = 0 then 1 + g % 3 else 0 end,
       case when (g + s) % 11 = 0 then public.today_pkt() - (g % 1000) end,
       case when (g + s) % 13 = 0 then now() - make_interval(days => g % 900) end
from generate_series(1, 3000) g, generate_series(0, 2) s
on conflict (rfq_id, supplier_id) do nothing;

insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency, lead_time, created_at)
select si.id, pg_temp.u('d1000000', g * 4 + p), 10 + (g * 7 + p) % 500, (array['USD', 'EUR', 'PKR', 'CNY'])[1 + (g + s) % 4],
       (array['ex-stock', '2 weeks', '4-6 weeks', '3 days'])[1 + (g + p) % 4], now() - make_interval(days => g % 1090)
from generate_series(1, 3000) g cross join generate_series(0, 2) s cross join generate_series(0, 2) p
join public.supplier_inquiries si on si.id = pg_temp.u('e0000000', g * 4 + s)
where (g + s + p) % 3 <> 0 and si.no_offer_on is null;

insert into public.clarifications (rfq_id, raised_by_inquiry_id, question, first_asked_at, last_asked_at, ask_count, answered_at, answer)
select pg_temp.u('d0000000', g), case when g % 2 = 0 then (select si.id from public.supplier_inquiries si where si.id = pg_temp.u('e0000000', g * 4)) end, 'Question ' || g,
       now() - make_interval(days => 2 + g % 1000), now() - make_interval(days => 2 + g % 1000), 1,
       case when g % 3 <> 0 then now() - make_interval(days => 1 + g % 1000) end,
       case when g % 3 <> 0 then 'Answer ' || g end
from generate_series(1, 3000) g
where g % 3 <> 1;

-- 2,000 orders from RFQs 1-2000 (5% cancelled), three lines each, one or two supplier orders each
insert into public.orders (id, company_id, owner_id, rfq_id, ordered_on, payment_terms_days, needs_commissioning, commissioning_planned_on,
                           commissioning_done_on, cancelled_on)
select pg_temp.u('a0000000', g), pg_temp.u('c0000000', 1 + g % 300),
       (case when g % 2 = 0 then 'a0000000-0000-4000-8000-000000000002' else 'a0000000-0000-4000-8000-000000000001' end)::uuid,
       pg_temp.u('d0000000', g), public.today_pkt() - (g % 1095),
       case when g % 4 = 0 then null else 30 end,
       g % 6 = 0,
       case when g % 6 = 0 and g % 12 <> 0 then public.today_pkt() - (g % 1095) + 40 end,
       case when g % 12 = 6 and g % 1095 > 60 then public.today_pkt() - (g % 1095) + 45 end,
       case when g % 20 = 0 then public.today_pkt() - (g % 1095) + 10 end
from generate_series(1, 2000) g;
update public.orders set cancel_reason = 'customer_cancelled' where cancelled_on is not null and id in (select pg_temp.u('a0000000', g) from generate_series(1, 2000) g);

insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on, expected_on, delivered_on, last_chased_on, chase_count)
select pg_temp.u('a1000000', g * 2 + k), pg_temp.u('a0000000', g),
       pg_temp.u('c0000000', 1001 + (g * 7 + k * 31) % 150), (array['USD', 'PKR', 'EUR'])[1 + (g + k) % 3],
       case when g % 1095 > 5 then public.today_pkt() - (g % 1095) + 5 end,
       public.today_pkt() - (g % 1095) + 35,
       case when g % 1095 > 60 and (g + k) % 9 <> 0 then public.today_pkt() - (g % 1095) + 30 + (g % 15) end,
       case when g % 7 = 0 and g % 1095 > 40 then public.today_pkt() - (g % 1095) + 36 end,
       case when g % 7 = 0 and g % 1095 > 40 then 1 else 0 end
from generate_series(1, 2000) g, generate_series(0, 1) k
where k = 0 or g % 2 = 0;

insert into public.order_items (id, order_id, position, description, brand_id, family_id, qty, unit_price_net, gst_rate, is_service,
                                rfq_item_id, supplier_order_id, supplier_unit_price)
select pg_temp.u('a2000000', g * 4 + p), pg_temp.u('a0000000', g), p, ri.description, ri.brand_id, ri.family_id, ri.qty,
       1000 + (g * 37 + p) % 9000, case when g % 4 = 0 then 0 else 18 end, (g + p) % 17 = 0, ri.id,
       case when (g + p) % 23 = 0 then null
            else pg_temp.u('a1000000', g * 2 + case when p = 2 and g % 2 = 0 then 1 else 0 end) end,
       case when (g + p) % 5 <> 0 then 300 + (g * 11 + p) % 4000 end
from generate_series(1, 2000) g cross join generate_series(0, 2) p
join public.rfq_items ri on ri.id = pg_temp.u('d1000000', g * 4 + p);

insert into public.order_engineers (order_id, user_id)
select pg_temp.u('a0000000', g), 'a0000000-0000-4000-8000-000000000003' from generate_series(1, 2000) g where g % 2 = 1;

insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at, costs_complete_by)
select pg_temp.u('a0000000', g), 50000 + g, case when g % 2 = 0 then now() end,
       case when g % 2 = 0 then 'a0000000-0000-4000-8000-000000000001'::uuid end
from generate_series(1, 2000) g where g % 4 <> 3;

insert into public.purchase_orders (supplier_order_id, number, revision, issued_on, currency, total, lines)
select so.id, 100000 + g, 0, coalesce(so.placed_on, public.today_pkt()), so.currency, 0,
       (select jsonb_agg(jsonb_build_object('order_item_id', oi.id, 'description', oi.description, 'qty', oi.qty, 'unit', 'pcs',
                                            'unit_price', coalesce(oi.supplier_unit_price, 99), 'price_source', 'order'))
        from public.order_items oi where oi.supplier_order_id = so.id and not oi.is_service)
from generate_series(1, 2000) g
join public.supplier_orders so on so.id = pg_temp.u('a1000000', g * 2)
where g % 4 <> 0 and exists (select 1 from public.order_items oi where oi.supplier_order_id = so.id and not oi.is_service);

insert into public.quotations (rfq_id, number, revision, issued_on, valid_until, lines)
select pg_temp.u('d0000000', g), 200000 + g, 0, public.today_pkt() - (g % 1095) + 2, public.today_pkt() - (g % 1095) + 32,
       (select jsonb_agg(jsonb_build_object('rfq_item_id', ri.id, 'description', ri.description, 'qty', ri.qty, 'unit', 'pcs',
                                            'unit_price_net', 1500 + g % 700, 'gst_rate', 18, 'lead_time', '4-6 weeks'))
        from public.rfq_items ri where ri.rfq_id = pg_temp.u('d0000000', g))
from generate_series(1, 3000) g where g % 6 <> 5;

-- 6,000 invoices: three per order on average, a quarter GST-exempt; older ones stamped, deposited and ticked
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, tcs_sent_on, psid, tax_deposited_on, tax_bank_month)
select pg_temp.u('a0000000', 1 + (g * 7) % 2000), 'PF-' || g, d.inv_on, 1000 + g % 20000,
       case when g % 4 = 0 then 0 else round((1000 + g % 20000) * 0.18) end,
       case when d.age > 20 then d.inv_on + 5 end,
       case when d.age > 40 and g % 4 <> 0 then 'PSID' || g end,
       case when d.age > 45 and g % 4 <> 0 then d.inv_on + 30 end,
       case when d.age > 75 and g % 4 <> 0 then date_trunc('month', d.inv_on + 30)::date end
from generate_series(1, 6000) g
cross join lateral (select public.today_pkt() - ((g * 5) % 1080) as inv_on, (g * 5) % 1080 as age) d;

-- 5,000 payments; older ones ticked against a bank month
insert into public.payments_in (order_id, received_on, amount, paid_via, bank_month)
select pg_temp.u('a0000000', 1 + (g * 3) % 2000), public.today_pkt() - ((g * 7) % 1080), 5000 + g % 30000,
       case when g % 9 = 0 then 'cash' else 'bank' end,
       case when g % 9 <> 0 and (g * 7) % 1080 > 40 then date_trunc('month', public.today_pkt() - ((g * 7) % 1080))::date end
from generate_series(1, 5000) g;

insert into public.recurring_expenses (id, label, category_id, amount, active)
select pg_temp.u('f0000000', g), 'Perf recurring ' || g, 'ca7e0000-0000-4000-8000-00000000000' || (1 + g % 3), 10000 * g, true
from generate_series(1, 9) g;

-- 20,000 expenses over three years: overheads, supplier payments and freight on orders and legs, drawings
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, description, order_id, supplier_order_id, payee_id, paid_via, bank_month)
select e.paid_on, 500 + g % 90000, case when e.cat in (11, 12) then (500 + g % 90000) * 0.1 else 0 end,
       ('ca7e0000-0000-4000-8000-0000000000' || lpad(e.cat::text, 2, '0'))::uuid,
       case when g % 13 = 0 then null else 'Perf expense ' || g end,
       case when e.cat in (11, 12, 13) then pg_temp.u('a0000000', 1 + g % 2000) end,
       case when e.cat = 11 and g % 3 = 0 then pg_temp.u('a1000000', (1 + g % 2000) * 2) end,
       case when e.cat = 11 then pg_temp.u('c0000000', 1001 + g % 150) end,
       e.via,
       case when e.via = 'bank' and (g * 3) % 1090 > 40 then date_trunc('month', e.paid_on)::date end
from generate_series(1, 20000) g
cross join lateral (
  select public.today_pkt() - ((g * 3) % 1090) as paid_on,
         (array[1, 2, 3, 4, 5, 6, 8, 10, 11, 11, 11, 12, 12, 13, 16])[1 + g % 15] as cat,
         case when g % 5 = 0 then 'cash' else 'bank' end as via
) e;

insert into public.fx_rates (currency, rate_pkr, as_of, source)
select c, 250 + d % 50, public.today_pkt() - d, 'auto' from unnest(array['USD', 'EUR', 'CNY']) c, generate_series(0, 1095, 3) d;

insert into public.snoozes (user_id, rule, subject_id, until_on)
select ('a0000000-0000-4000-8000-00000000000' || (1 + g % 3))::uuid, 'chase_supplier', pg_temp.u('e0000000', g * 4), public.today_pkt() + 3
from generate_series(1, 600) g;

analyze;

select format('dataset loaded in %s s: %s orders, %s invoices, %s expenses, %s payments, %s RFQs, %s enquiries, %s quote lines, %s audit rows',
  round(extract(epoch from clock_timestamp() - :'t0'::timestamptz)::numeric, 1),
  (select count(*) from public.orders), (select count(*) from public.invoices), (select count(*) from public.expenses),
  (select count(*) from public.payments_in), (select count(*) from public.rfqs), (select count(*) from public.supplier_inquiries),
  (select count(*) from public.supplier_quote_lines), (select count(*) from public.audit_log)) as dataset;

-- ------------------------------------------------------------------ audit_log on this dataset (0075)
select pg_size_pretty(pg_total_relation_size('public.audit_log')) as audit_log_total_size,
       pg_size_pretty(pg_database_size(current_database())) as database_size,
       (select count(*) from public.audit_log) as audit_rows,
       round(pg_total_relation_size('public.audit_log')::numeric / greatest((select count(*) from public.audit_log), 1)) as bytes_per_audit_row_incl_indexes;

-- ------------------------------------------------------------------ the reads
create temp table reads (k integer, label text, persona text, q_after text, q_before text);
insert into reads values
  (1,  'v_order_money (all orders)',                   'admin', 'select * from public.v_order_money', null),
  (2,  'v_invoice_state (all invoices)',               'admin', 'select * from public.v_invoice_state', null),
  (3,  'v_gst_register (Money tab count, all years)',  'admin', 'select * from public.v_gst_register', null),
  (4,  'aging_as_of(today)',                           'admin', 'select * from public.aging_as_of(public.today_pkt())', null),
  (5,  'payables_as_of(today)',                        'admin', 'select * from public.payables_as_of(public.today_pkt())', null),
  (6,  'month_end_status(last month)',                 'admin', $$select * from public.month_end_status((date_trunc('month', public.today_pkt()) - interval '1 month')::date)$$, null),
  (7,  'month_end_check_details(last month)',          'admin', $$select * from public.month_end_check_details((date_trunc('month', public.today_pkt()) - interval '1 month')::date)$$, null),
  (8,  'v_month_pnl (all months)',                     'admin', 'select * from public.v_month_pnl', null),
  (9,  'v_month_expense_category (all months)',        'admin', 'select * from public.v_month_expense_category', null),
  (10, 'Today: v_rfq_state open',                      'sales', $$select * from public.v_rfq_state where outcome = 'open'$$, null),
  (11, 'Today: v_inquiry_state awaiting or relay',     'sales', $$select * from public.v_inquiry_state where response_state = 'awaiting' or answers_to_relay > 0$$, null),
  (12, 'Today: v_order_state live order rules',        'sales', $$select * from public.v_order_state where lifecycle = 'active' and (commissioning_state = 'to_plan' or goods_state = 'to_source' or invoicing_state in ('not_invoiced', 'part'))$$, null),
  (13, 'Today: v_supplier_stats (all)',                'sales', 'select * from public.v_supplier_stats', null),
  (14, 'Today: order_receivables()',                   'sales', 'select * from public.order_receivables()', null),
  (15, 'Today: legs not delivered',                    'sales', 'select so.*, o.number from public.supplier_orders so join public.orders o on o.id = so.order_id where o.cancelled_on is null and so.delivered_on is null', null),
  (16, 'Today (admin): v_order_money settled + provisional', 'admin', $$select * from public.v_order_money where payment_state = 'settled' and costs_state = 'provisional'$$, null),
  (17, 'Orders list: v_order_state (all, admin)',      'admin', 'select * from public.v_order_state', null),
  (18, 'Expenses: one month',                          'admin', $$select * from public.expenses where paid_on >= date_trunc('month', public.today_pkt()) - interval '1 month' and paid_on < date_trunc('month', public.today_pkt())$$, null),
  (19, 'supplier_item_memory (10 suppliers)',          'sales',
       $$select * from public.supplier_item_memory((select array_agg(pg_temp.u('c0000000', 1000 + g)) from generate_series(1, 10) g), pg_temp.u('b0000000', 5), null, 'Perf brand 5 PMA1100 actuator')$$,
       $$select * from pg_temp.ref_supplier_item_memory((select array_agg(pg_temp.u('c0000000', 1000 + g)) from generate_series(1, 10) g), pg_temp.u('b0000000', 5), null, 'Perf brand 5 PMA1100 actuator')$$),
  (20, 'customer_price_memory (an RFQ of a busy customer)', 'sales',
       $$select * from public.customer_price_memory(pg_temp.u('d0000000', 2900))$$,
       $$select * from pg_temp.ref_customer_price_memory(pg_temp.u('d0000000', 2900))$$),
  (21, 'NEW receivables_list(overdue)',                'sales', $$select * from public.receivables_list('overdue')$$, 'skip'),
  (22, 'NEW receivables_summary()',                    'sales', 'select * from public.receivables_summary()', 'skip'),
  (23, 'NEW today_inquiry_facts()',                    'sales', 'select * from public.today_inquiry_facts()', 'skip');

create temp table results (k integer, state text, ms numeric, rows bigint, fp text);
grant all on reads, results to authenticated;

create function pg_temp.measure(p_state text) returns void language plpgsql as $f$
declare
  r     record;
  q     text;
  j     json;
  t1    numeric;
  t2    numeric;
  n     bigint;
  f     text;
begin
  for r in select * from reads order by k loop
    q := case when p_state = 'before' then coalesce(r.q_before, r.q_after) else r.q_after end;
    continue when q = 'skip';
    perform set_config('request.jwt.claims', json_build_object('sub',
      case r.persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' else 'a0000000-0000-4000-8000-000000000002' end,
      'role', 'authenticated')::text, true);
    execute format('select count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from (%s) t', '|', '', q) into n, f;
    execute 'explain (analyze, timing off, format json) ' || q into j;
    t1 := (j -> 0 ->> 'Execution Time')::numeric;
    if t1 < 5000 then
      execute 'explain (analyze, timing off, format json) ' || q into j;
      t2 := (j -> 0 ->> 'Execution Time')::numeric;
    else
      t2 := t1;
    end if;
    insert into results values (r.k, p_state, round(least(t1, t2), 1), n, f);
    raise notice '% | % | % ms | % rows', p_state, r.label, round(least(t1, t2), 1), n;
  end loop;
end
$f$;

create function pg_temp.show_plans() returns void language plpgsql as $f$
declare
  r   record;
  ln  record;
  i   integer;
begin
  for r in select * from reads where k in (1, 2, 4, 6, 12, 19) order by k loop
    perform set_config('request.jwt.claims', json_build_object('sub',
      case r.persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' else 'a0000000-0000-4000-8000-000000000002' end,
      'role', 'authenticated')::text, true);
    raise notice '---- EXPLAIN ANALYZE (after): %', r.label;
    i := 0;
    for ln in execute 'explain (analyze, timing off, costs off) ' || r.q_after loop
      i := i + 1;
      exit when i > 30;
      raise notice '%', ln."QUERY PLAN";
    end loop;
  end loop;
end
$f$;

set local role authenticated;
select pg_temp.measure('after');
select pg_temp.show_plans();
reset role;

select pg_temp.unwrap_everything() as policies_and_views_put_back_to_pre_0074;

set local role authenticated;
select pg_temp.measure('before');
reset role;

select r.k, r.label, r.persona,
       b.ms as before_ms, a.ms as after_ms,
       case when b.ms > 0 and a.ms > 0 then round(b.ms / a.ms, 1) end as speedup,
       a.rows,
       case when b.fp is null then 'new' when a.fp = b.fp then 'same rows' else 'DIFFERENT' end as result
from reads r
join results a on a.k = r.k and a.state = 'after'
left join results b on b.k = r.k and b.state = 'before'
order by r.k;

do $$
begin
  if exists (select 1 from results a join results b on b.k = a.k and b.state = 'before'
             where a.state = 'after' and a.fp is distinct from b.fp) then
    raise exception 'db perf: a read returned different rows before and after 0074 (see the table above)';
  end if;
end
$$;

rollback;
