-- 0074_rls_initplan_and_scale (performance audit 2026-10-20, docs/DECISIONS.md): the database side of the speed work. Nothing
-- here changes what anyone may see or what any figure is; the pgTAP files 0074_*.test.sql prove it (same rows, same numbers).
--
--   A. Row security: every policy that calls public.current_user_role() or auth.uid() now calls it as a scalar sub-select,
--      (select public.current_user_role()), so Postgres runs it once per statement (an InitPlan) instead of once per row
--      (Supabase lint auth_rls_initplan). The policies are rewritten in place with ALTER POLICY from their own stored text:
--      same name, table, command, roles and permissive/restrictive, and the same expression apart from the wrapper. The block
--      checks that itself and stops the migration if anything else would change. Policies added by earlier migrations
--      (0069 to 0073 included) are covered because this runs after them; a later policy must use the wrapped form, and
--      0074_rls_initplan.test.sql fails if one does not.
--   B. Views: the same wrapper in the invoker views that call current_user_role() (v_order_state called it about three
--      times per order). Each view is re-created from its own stored definition with its own options (security_invoker),
--      and the same self-check.
--   C. Matching: supplier_item_memory(), supplier_item_evidence(), customer_price_memory() and po_line_prefill() score a
--      past line only when it can match at all (shared model token, same brand, or same family); the tiers and every
--      result are unchanged (0074_matching_prefilter.test.sql compares them with the 0041/0043/0049/0066 versions).
--   D. month_end_check_details(): the "fbr_pending" list leaves out GST-exempt invoices, as month_end_status() counts them
--      (0058); the list and the count now agree.
--   E. Complete results past PostgREST's 1,000-row cap and without long `in.(...)` URLs:
--        receivables_list()     order_receivables() rows with the company name and invoice numbers, filtered on the
--                               server (state, company, order), ordered by order number so `.range()` pages are stable
--        receivables_summary()  the Who-owes-us figures in one row (counts and sums), for tab counts and the summary bar
--        today_inquiry_facts()  Today's supplier-enquiry facts in one call: open RFQs only, who chased, when the answers
--                               to relay came in, and the supplier's reply stats (replaces four reads, one of them capped)
--        lookup_labels()        company names, order numbers and supplier-order (leg) positions for id lists sent in the
--                               POST body (RPC arguments never go into the URL), as one jsonb value (no row cap)
-- Every new function is SECURITY INVOKER with a fixed search_path: the caller's own row security applies.

-- ================================================================ helpers for A and B (this session only)
-- Text forms, as pg_get_expr / pg_get_viewdef print them with an empty search_path:
--   bare     public.current_user_role()            auth.uid()
--   wrapped  ( SELECT public.current_user_role() AS current_user_role)   ( SELECT auth.uid() AS uid)
-- A FROM-clause sub-select such as v_order_state's "( SELECT public.current_user_role() AS role) r" is NOT the wrapped form
-- (its alias is not the function's name): the planner flattens it and evaluates the call per row, so its call is wrapped too.
create function pg_temp.rls_unwrap(t text) returns text language sql immutable as $f$
  select regexp_replace(
           regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)\s+AS\s+current_user_role\s*\)', 'public.current_user_role()', 'gi'),
           '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', 'auth.uid()', 'gi')
$f$;

-- true when the text still calls either function outside the wrapper
create function pg_temp.rls_has_bare(t text) returns boolean language sql immutable as $f$
  select coalesce(
    regexp_replace(
      regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)\s+AS\s+current_user_role\s*\)', '', 'gi'),
      '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi')
    ~ '(public\.current_user_role\(\)|auth\.uid\(\))', false)
$f$;

create function pg_temp.rls_wrap(t text) returns text language sql immutable as $f$
  select regexp_replace(pg_temp.rls_unwrap(t), '(public\.current_user_role\(\)|auth\.uid\(\))', '(SELECT \1)', 'g')
$f$;

-- ================================================================ A. policies: the role check once per statement
do $do$
declare
  p        record;
  v_stmt   text;
  v_qual   text;
  v_check  text;
  v_n      integer := 0;
begin
  -- An empty search_path makes pg_get_expr print every name schema-qualified (what pg_dump does), so the text re-parses
  -- to the same objects whatever the caller's path is.
  perform pg_catalog.set_config('search_path', '', true);
  for p in
    select n.nspname as sch, c.relname as tbl, pol.polname as pname, pol.oid as poid,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
       or (n.nspname = 'storage' and c.relname = 'objects' and pol.polname like 'qtech\_%')
    order by 1, 2, 3
  loop
    if not (coalesce(pg_temp.rls_has_bare(p.qual), false) or coalesce(pg_temp.rls_has_bare(p.wcheck), false)) then
      continue;
    end if;
    -- ALTER POLICY changes only the clauses it names: the command, roles and permissive/restrictive stay as they are.
    v_stmt := format('alter policy %I on %I.%I', p.pname, p.sch, p.tbl);
    if p.qual is not null then
      v_stmt := v_stmt || format(' using (%s)', pg_temp.rls_wrap(p.qual));
    end if;
    if p.wcheck is not null then
      v_stmt := v_stmt || format(' with check (%s)', pg_temp.rls_wrap(p.wcheck));
    end if;
    execute v_stmt;

    -- Self-check: read the policy back. Apart from the wrapper it must be the very same expression, with no bare call left.
    select pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
    into v_qual, v_check
    from pg_catalog.pg_policy pol where pol.oid = p.poid;
    if pg_temp.rls_unwrap(v_qual) is distinct from pg_temp.rls_unwrap(p.qual)
       or pg_temp.rls_unwrap(v_check) is distinct from pg_temp.rls_unwrap(p.wcheck)
       or coalesce(pg_temp.rls_has_bare(v_qual), false) or coalesce(pg_temp.rls_has_bare(v_check), false) then
      raise exception '0074: policy % on %.% would change beyond the wrapper. Before: % / %. After: % / %',
        p.pname, p.sch, p.tbl, p.qual, p.wcheck, v_qual, v_check;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice '0074: % policies now run the role check once per statement', v_n;
end
$do$;

-- ================================================================ B. invoker views: the same wrapper
do $do$
declare
  v       record;
  v_after text;
  v_opts  text;
  v_n     integer := 0;
begin
  perform pg_catalog.set_config('search_path', '', true);
  for v in
    select c.oid, c.relname, c.reloptions, pg_catalog.pg_get_viewdef(c.oid) as def
    from pg_catalog.pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
    order by c.relname
  loop
    if not pg_temp.rls_has_bare(v.def) then
      continue;
    end if;
    -- CREATE OR REPLACE VIEW replaces the options too, so the view's own (security_invoker=true) is passed back. Owner,
    -- grants, comments and dependent views are kept; the columns are the same, so dependants need no change.
    v_opts := case when v.reloptions is null then '' else format(' with (%s)', array_to_string(v.reloptions, ', ')) end;
    execute format('create or replace view public.%I%s as %s', v.relname, v_opts,
                   pg_temp.rls_wrap(regexp_replace(v.def, ';\s*$', '')));

    v_after := pg_catalog.pg_get_viewdef(v.oid);
    if pg_temp.rls_unwrap(v_after) is distinct from pg_temp.rls_unwrap(v.def)
       or pg_temp.rls_has_bare(v_after)
       or (select c.reloptions from pg_catalog.pg_class c where c.oid = v.oid) is distinct from v.reloptions then
      raise exception '0074: view % would change beyond the wrapper. Before: %. After: %', v.relname, v.def, v_after;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice '0074: % views now run the role check once per statement', v_n;
end
$do$;

drop function pg_temp.rls_wrap(text);
drop function pg_temp.rls_has_bare(text);
drop function pg_temp.rls_unwrap(text);

-- ================================================================ C. matching: score only what can match
-- item_match_tier() (0024, 0036) gives a past line a tier only when it shares a model token with the target (tier 0), has the
-- target's brand (tiers 1 and 2) or the target's family (tiers 1 and 3); otherwise NULL. The functions below used to work out
-- the normalised text, the stripped tokens and the tier of EVERY past line of the supplier (or customer) before dropping the
-- NULLs: regex and non-inlinable SQL helpers per row, growing with history. Each now tests that cheap condition first
--   brand_id = target brand  or  family_id = target family  or  model_tokens && the target's stripped tokens
-- (the raw tokens overlap the stripped target exactly when the stripped tokens do, since the stripped target holds no brand
-- token), and scores only the lines that pass. A line that fails has no tier, so nothing a caller sees changes. Where a reader
-- keeps only tiered rows, the test is also a WHERE condition (fewer rows travel); the PO-line set of supplier_item_memory()
-- keeps every line (its "last ordered" asks whether any PO line exists for an order item), so there it is a CASE only.
-- customer_price_memory() keeps tiers 0 and 1 only, so its test is the tier 0/1 condition. po_line_prefill() works out the
-- order line's own tokens and text once per line instead of once per past PO line.
-- Same signatures and result columns; grants are kept by CREATE OR REPLACE.

-- ---------------------------------------------------------------- supplier_item_memory (0049)
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
      case when ri.brand_id = p_brand_id or ri.family_id = p_family_id or ri.model_tokens && t.tok then
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(ri.model_tokens, t.bt), public.strip_words(public.item_text_norm(ri.description), t.bw), ri.brand_id, ri.family_id,
                             'item_guessed' = any (q.legacy_flags)) end as tier
    from sup
    join public.supplier_inquiries si on si.supplier_id = sup.supplier_id
    join public.supplier_quote_lines q on q.inquiry_id = si.id
    join public.rfq_items ri on ri.id = q.rfq_item_id
    cross join t
    where (p_exclude_rfq_id is null or si.rfq_id <> p_exclude_rfq_id)
      -- 0074 prefilter: a line with no shared model token, brand or family has no tier, so it is never scored
      and (ri.brand_id = p_brand_id or ri.family_id = p_family_id or ri.model_tokens && t.tok)
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
      case when oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok then
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(oi.model_tokens, t.bt), public.strip_words(public.item_text_norm(oi.description), t.bw), oi.brand_id, oi.family_id,
                             false) end as tier
    from sup
    join public.supplier_orders so on so.supplier_id = sup.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null
    join public.order_items oi on oi.supplier_order_id = so.id and not oi.is_service
    cross join t
    where (p_exclude_rfq_id is null or o.rfq_id is distinct from p_exclude_rfq_id)
      -- 0074 prefilter (every reader of lc keeps only rows with a tier)
      and (oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok)
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
      -- 0074 prefilter as a CASE, not a WHERE: every PO line is kept, because "last ordered" asks whether ANY PO line
      -- exists for an order item, scored or not
      case when poi.brand_id = p_brand_id or poi.family_id = p_family_id
                or (cardinality(t.tok) > 0 and public.model_tokens(l.e ->> 'description') && t.tok) then
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(public.model_tokens(l.e ->> 'description'), t.bt),
                             public.strip_words(public.item_text_norm(l.e ->> 'description'), t.bw),
                             poi.brand_id, poi.family_id, false) end as tier
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

-- ---------------------------------------------------------------- supplier_item_evidence (0066)
create or replace function public.supplier_item_evidence(
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
      case when oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok then
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(oi.model_tokens, t.bt), public.strip_words(public.item_text_norm(oi.description), t.bw), oi.brand_id, oi.family_id,
                             false) end as tier
    from sup
    join public.supplier_orders so on so.supplier_id = sup.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null
    join public.order_items oi on oi.supplier_order_id = so.id and not oi.is_service
    cross join t
    where (p_exclude_rfq_id is null or o.rfq_id is distinct from p_exclude_rfq_id)
      -- 0074 prefilter (legs keeps only rows with a tier)
      and (oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok)
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

-- ---------------------------------------------------------------- customer_price_memory (0041)
create or replace function public.customer_price_memory(p_rfq_id uuid)
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
      -- 0074 prefilter: only a shared model token (tier 0), the same brand, or with no brand the same family (tier 1) can
      -- give tier 0 or 1; anything else is never scored (its tier would be NULL, 2 or 3, all dropped by tier <= 1)
      select case when oi.model_tokens && t.tok or oi.brand_id = t.brand_id
                       or (t.brand_id is null and oi.family_id = t.family_id) then
             public.item_match_tier(t.tok, t.nrm, t.brand_id, t.family_id,
                                    public.tokens_without(oi.model_tokens, bw.bt),
                                    public.strip_words(public.item_text_norm(oi.description), bw.words),
                                    oi.brand_id, oi.family_id,
                                    'item_guessed' = any (oi.legacy_flags)) end as tier
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
      select case when ri.model_tokens && t.tok or ri.brand_id = t.brand_id
                       or (t.brand_id is null and ri.family_id = t.family_id) then
             public.item_match_tier(t.tok, t.nrm, t.brand_id, t.family_id,
                                    public.tokens_without(ri.model_tokens, bw.bt),
                                    public.strip_words(public.item_text_norm(ri.description), bw.words),
                                    ri.brand_id, ri.family_id, false) end as tier
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

-- ---------------------------------------------------------------- po_line_prefill (0043)
-- issue_purchase_order() is not changed; 0043_po_line_prefill.test.sql still checks that the two agree line for line.
create or replace function public.po_line_prefill(p_supplier_order_id uuid)
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
  -- 0074: the line's own tokens (brand tokens stripped) and normalised text, worked out once per line instead of once per
  -- past PO line. tokens_without(poi, bt) && tokens_without(oi, bt) is the same test as poi && tokens_without(oi, bt),
  -- because the right-hand side already holds no brand token. OFFSET 0 keeps the planner from inlining it back.
  cross join lateral (
    select public.tokens_without(oi.model_tokens, v_bt) as tok,
           public.strip_words(public.item_text_norm(oi.description), v_bw) as nrm
    offset 0
  ) ot
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
           or (poi.model_tokens && ot.tok
               and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id))
           or (oi.brand_id is not null and poi.brand_id = oi.brand_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), ot.nrm, 0.45))
           or (oi.brand_id is null and oi.family_id is not null and poi.family_id = oi.family_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), ot.nrm, 0.60))
         )
       order by (poi.id = oi.id) desc,
                (poi.model_tokens && ot.tok
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

-- ================================================================ D. month_end_check_details (0064): list and count agree
-- month_end_status() counts fbr_pending as invoices with GST to deposit (gst_amount > 0, 0058); the detail also listed
-- GST-exempt invoices, so a month could read "1 pending" over a list naming two invoices. The detail now uses the same
-- predicate. The amount is unchanged (an exempt invoice adds 0 GST). Everything else is as in 0073 (voided payments left out).
create or replace function public.month_end_check_details(p_month date)
returns table (check_key text, detail jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month)::date + interval '1 month')::date - 1 as m_end,
           to_char(p_month, 'YYYY-MM') as period
  ),
  bank_in as (
    select p.amount, p.received_on from public.payments_in p, b
    where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end
      and p.voided_at is null
  ),
  bank_out as (
    select e.amount_pkr as amount, e.paid_on from public.expenses e, b
    where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end
  ),
  prior as (
    select bi.received_on as d from bank_in bi, b where bi.received_on < b.m_start
    union all
    select bo.paid_on from bank_out bo, b where bo.paid_on < b.m_start
  ),
  deposits as (
    select r.invoice_id, coalesce(r.tax_deposit_amount, r.gst_amount) as amount, coalesce(r.psid, r.invoice_id::text) as grp
    from public.v_gst_register r, b
    where r.tax_deposited_on <= b.m_end
      and exists (select 1 from public.invoices v where v.id = r.invoice_id and v.tax_bank_month is null)
  ),
  uncat as (
    select e.amount_pkr as amount
    from public.expenses e
    join public.expense_categories c on c.id = e.category_id, b
    where e.paid_on between b.m_start and b.m_end
      and ((c.id = 'ca7e0000-0000-4000-8000-000000000010' and nullif(btrim(e.description), '') is null)
        or (c.grp = 'order_cost' and e.order_id is null)
        or 'category_unmapped' = any (e.legacy_flags))
  ),
  rec_all as (
    select r.id, r.label from public.recurring_expenses r, b
    where r.active and (r.start_month is null or r.start_month <= b.period)
  ),
  rec_missing as (
    select ra.label from rec_all ra, b
    where not exists (select 1 from public.expenses e where e.recurring_id = ra.id and e.period = b.period)
  ),
  prov as (
    select o.number
    from public.orders o
    join public.v_order_basis ob on ob.order_id = o.id
    left join public.order_costs oc on oc.order_id = o.id, b
    where o.cancelled_on is null
      and oc.costs_complete_at is null
      and ob.g > 0
      and (select coalesce(sum(p.amount), 0) from public.payments_in p
           where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null) >= ob.g - 1
  ),
  pending as (
    select r.number, r.invoice_date, r.gst_amount
    from public.v_gst_register r, b
    where r.invoice_date <= b.m_end and r.tax_deposited_on is null and r.gst_amount > 0   -- 0074: the same predicate as month_end_status
  ),
  unres as (
    select p.payment_id, p.order_id, o.number as order_number, p.amount, pi.reference
    from public.v_payment_net p
    join public.orders o on o.id = p.order_id
    join public.payments_in pi on pi.id = p.payment_id, b
    where p.received_on between b.m_start and b.m_end
      and p.excluded_reason in ('basis_unknown', 'zero_value')
  ),
  details as (
    select 'bank_unticked'::text as check_key,
           jsonb_build_object(
             'in_n', (select count(*) from bank_in),
             'in_amount', (select coalesce(sum(amount), 0) from bank_in),
             'out_n', (select count(*) from bank_out),
             'out_amount', (select coalesce(sum(amount), 0) from bank_out),
             'prior_n', (select count(*) from prior),
             'prior_first', (select to_char(min(d), 'YYYY-MM') from prior),
             'prior_last', (select to_char(max(d), 'YYYY-MM') from prior)) as detail
    union all
    select 'fbr_deposits_unticked',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from deposits),
             'groups', (select count(distinct grp) from deposits))
    union all
    select 'uncategorised',
           jsonb_build_object('amount', (select coalesce(sum(amount), 0) from uncat))
    union all
    select 'recurring_not_recorded',
           jsonb_build_object(
             'total', (select count(*) from rec_all),
             'names', coalesce((select jsonb_agg(label) from (select label from rec_missing order by label limit 3) x), '[]'::jsonb))
    union all
    select 'provisional_margins',
           jsonb_build_object(
             'numbers', coalesce((select jsonb_agg(number) from (select number from prov order by number desc limit 3) x), '[]'::jsonb))
    union all
    select 'fbr_pending',
           jsonb_build_object(
             'amount', (select coalesce(sum(gst_amount), 0) from pending),
             'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'month', to_char(invoice_date, 'YYYY-MM')))
                                   from (select number, invoice_date from pending order by invoice_date desc, number limit 3) x), '[]'::jsonb))
    union all
    select 'unresolved_payments',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from unres),
             'orders', (select count(distinct order_id) from unres),
             'first', (select jsonb_build_object('order_id', order_id, 'order_number', order_number, 'reference', reference)
                       from unres order by amount desc, payment_id limit 1))
  )
  select d.check_key, d.detail from details d
  where public.current_user_role() = 'admin'
$$;

-- ================================================================ E. receivables_list
-- order_receivables() rows (the very same function, so the same numbers) plus what the Who-owes-us list used to fetch with two
-- `in.(...)` reads that break once the URL is too long: the company name and the order's invoice numbers (oldest first, as
-- the client sorted them). Filters run on the server:
--   p_state       null every row; 'open' anything not settled; or one payment_state: 'unpaid', 'part', 'overdue', 'settled'
--   p_company_id  one customer (the company page's "Payment overdue" chip)
--   p_order_id    one order (passed straight to order_receivables)
--   p_with_value  true leaves out orders whose gross is 0 (Money > Who owes us does that)
-- Ordered by order number, so the client can page it with `.range()` past PostgREST's 1,000-row cap (fetchAll).
-- Access is order_receivables()'s: admin and sales; an engineer is refused (42501); a deactivated user gets no rows.
create function public.receivables_list(
  p_state      text    default null,
  p_company_id uuid    default null,
  p_order_id   uuid    default null,
  p_with_value boolean default false
)
returns table (
  order_id          uuid,
  order_number      bigint,
  company_id        uuid,
  company_name      text,
  owner_id          uuid,
  invoice_numbers   text[],
  gross_target      numeric,
  settled           numeric,
  balance           numeric,
  overpaid_by       numeric,
  due_on            date,
  is_overdue        boolean,
  payment_state     text,
  last_reminded_on  date,
  reminder_count    smallint,
  data_trust        text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_state is not null and p_state not in ('open', 'unpaid', 'part', 'overdue', 'settled') then
    raise exception 'receivables_list: unknown state %', p_state using errcode = '22023';
  end if;

  return query
  select
    r.order_id,
    r.order_number,
    r.company_id,
    c.name,
    r.owner_id,
    coalesce(n.numbers, '{}'::text[]),
    r.gross_target,
    r.settled,
    r.balance,
    r.overpaid_by,
    r.due_on,
    r.is_overdue,
    r.payment_state,
    r.last_reminded_on,
    r.reminder_count,
    r.data_trust
  from public.order_receivables(p_order_id) r
  left join public.companies c on c.id = r.company_id
  left join lateral (
    select array_agg(v.number order by v.invoice_date nulls last, v.number) as numbers
    from public.invoices v
    where v.order_id = r.order_id and v.number is not null
  ) n on true
  where (p_company_id is null or r.company_id = p_company_id)
    and (not coalesce(p_with_value, false) or r.gross_target > 0)
    and (p_state is null
         or (p_state = 'open' and r.payment_state <> 'settled')
         or r.payment_state = p_state)
  order by r.order_number;
end;
$$;

revoke all on function public.receivables_list(text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.receivables_list(text, uuid, uuid, boolean) to authenticated;

comment on function public.receivables_list(text, uuid, uuid, boolean) is
  'order_receivables() with company name and invoice numbers, filtered on the server, ordered by order number (page with range()). 0074.';

-- ================================================================ E. receivables_summary
-- The Who-owes-us figures in one row, over the rows the list shows (gross above 0), with the client's own rules
-- (src/features/money/payments/model.ts receivableTotals): open = not settled; invoiced = has an invoice number; a
-- reminder is due when the order is overdue and was not reminded in the last 7 days (p_today, default today in Karachi).
-- One row for admin and sales (zeros when nothing is owed), none for a deactivated user, refused for an engineer.
create function public.receivables_summary(p_today date default null)
returns table (
  open_count          integer,
  outstanding         numeric,
  overdue_count       integer,
  overdue             numeric,
  reminder_due_count  integer,
  not_yet_due_count   integer,
  not_yet_due         numeric,
  not_invoiced_count  integer,
  not_invoiced        numeric,
  gross               numeric,
  settled             numeric,
  settled_count       integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  r as (
    select l.*, cardinality(l.invoice_numbers) > 0 as invoiced
    from public.receivables_list(null, null, null, true) l
  ),
  o as (
    select * from r where r.payment_state <> 'settled'
  )
  select
    (select count(*) from o)::int,
    (select coalesce(sum(o.balance), 0) from o),
    (select count(*) from o where o.payment_state = 'overdue')::int,
    (select coalesce(sum(o.balance), 0) from o where o.payment_state = 'overdue'),
    (select count(*) from o
     where o.payment_state = 'overdue'
       and (o.last_reminded_on is null or coalesce(p_today, public.today_pkt()) - o.last_reminded_on >= 7))::int,
    (select count(*) from o where o.invoiced and o.payment_state <> 'overdue')::int,
    (select coalesce(sum(o.balance), 0) from o where o.invoiced and o.payment_state <> 'overdue'),
    (select count(*) from o where not o.invoiced)::int,
    (select coalesce(sum(o.balance), 0) from o where not o.invoiced),
    (select coalesce(sum(o.gross_target), 0) from o),
    (select coalesce(sum(o.settled), 0) from o),
    (select count(*) from r where r.payment_state = 'settled')::int
  where (select public.current_user_role()) is not null
$$;

revoke all on function public.receivables_summary(date) from public, anon, authenticated;
grant execute on function public.receivables_summary(date) to authenticated;

comment on function public.receivables_summary(date) is
  'Who-owes-us counts and sums in one row (the rules of receivableTotals in the client), over receivables_list(p_with_value => true). 0074.';

-- ================================================================ F. today_inquiry_facts
-- Today's supplier-enquiry facts in one call. The client used to read every awaiting or relay-pending enquiry on every RFQ
-- ever (closed ones included), every supplier's stats, every chaser (that read was capped at 1,000 rows), and then the
-- enquiries and answers behind the relays with two `in.(...)` lists. Here:
--   * only enquiries on OPEN RFQs (v_rfq_state's outcome 'open': not closed and no live order), and only those awaiting a
--     reply or with answers to relay, from v_inquiry_state (the same states the client filtered on);
--   * last_chased_by from the enquiry; the supplier's name, and its replied / median_reply_days from v_supplier_stats;
--   * answered_on: with answers to relay, the latest Karachi date an answer came in after the enquiry's last relay.
-- Every table read is readable by all staff, so every staff role may call it; a deactivated user gets nothing.
create function public.today_inquiry_facts()
returns table (
  inquiry_id         uuid,
  rfq_id             uuid,
  supplier_id        uuid,
  supplier_name      text,
  sent_on            date,
  last_chased_on     date,
  last_chased_by     uuid,
  chase_count        integer,
  response_state     text,
  answers_to_relay   integer,
  answered_on        date,
  replied            integer,
  median_reply_days  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  open_rfq as (
    select r.id
    from public.rfqs r
    where r.closed_on is null
      and not exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null)
  ),
  inq as (
    select s.inquiry_id, s.rfq_id, s.supplier_id, s.sent_on, s.last_chased_on, s.chase_count, s.response_state,
           s.answers_to_relay
    from public.v_inquiry_state s
    where s.rfq_id in (select open_rfq.id from open_rfq)
      and (s.response_state = 'awaiting' or s.answers_to_relay > 0)
  ),
  stats as (
    select v.supplier_id, v.replied, v.median_reply_days
    from public.v_supplier_stats v
    where v.supplier_id in (select inq.supplier_id from inq)
  )
  select
    i.inquiry_id,
    i.rfq_id,
    i.supplier_id,
    c.name,
    i.sent_on,
    i.last_chased_on,
    si.last_chased_by,
    i.chase_count::int,
    i.response_state,
    i.answers_to_relay::int,
    case when i.answers_to_relay > 0 then (
      select max(public.today_pkt(cl.answered_at))
      from public.clarifications cl
      where cl.raised_by_inquiry_id = i.inquiry_id
        and cl.answered_at is not null
        and cl.withdrawn_at is null
        and (si.last_relayed_at is null or cl.answered_at > si.last_relayed_at)
    ) end,
    st.replied,
    st.median_reply_days
  from inq i
  join public.supplier_inquiries si on si.id = i.inquiry_id
  left join public.companies c on c.id = i.supplier_id
  left join stats st on st.supplier_id = i.supplier_id
  order by i.rfq_id, i.sent_on nulls last, i.inquiry_id
$$;

revoke all on function public.today_inquiry_facts() from public, anon, authenticated;
grant execute on function public.today_inquiry_facts() to authenticated;

comment on function public.today_inquiry_facts() is
  'Today: open-RFQ enquiries that await a reply or have answers to relay, with chaser, answer date and supplier reply stats. 0074.';

-- ================================================================ G. lookup_labels
-- Names for id lists, sent in the POST body (an RPC's arguments never go into the URL, so no list is too long) and answered as
-- one jsonb value (no 1,000-row cap):
--   {"companies": {id: name},
--    "orders":    {id: {"number": n, "company_id": id, "company_name": text}},
--    "legs":      {id: {"order_id": id, "supplier_id": id, "position": k}}}   k = 0 for an order's first supplier order
--                                                                                (by created_at, then id), 1 for the next...
-- An id the caller cannot read (row security) or that does not exist is simply absent.
create function public.lookup_labels(
  p_company_ids uuid[] default '{}',
  p_order_ids   uuid[] default '{}',
  p_leg_ids     uuid[] default '{}'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'companies', coalesce((
      select jsonb_object_agg(c.id, c.name)
      from public.companies c
      where c.id = any (p_company_ids)), '{}'::jsonb),
    'orders', coalesce((
      select jsonb_object_agg(o.id, jsonb_build_object('number', o.number, 'company_id', o.company_id, 'company_name', c.name))
      from public.orders o
      left join public.companies c on c.id = o.company_id
      where o.id = any (p_order_ids)), '{}'::jsonb),
    'legs', coalesce((
      select jsonb_object_agg(l.id, jsonb_build_object('order_id', l.order_id, 'supplier_id', l.supplier_id, 'position', l.k))
      from (
        select so.id, so.order_id, so.supplier_id,
               (row_number() over (partition by so.order_id order by so.created_at, so.id) - 1)::int as k
        from public.supplier_orders so
        where so.order_id in (select x.order_id from public.supplier_orders x where x.id = any (p_leg_ids))
      ) l
      where l.id = any (p_leg_ids)), '{}'::jsonb))
$$;

revoke all on function public.lookup_labels(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.lookup_labels(uuid[], uuid[], uuid[]) to authenticated;

comment on function public.lookup_labels(uuid[], uuid[], uuid[]) is
  'Company names, order numbers and supplier-order positions for id lists sent in the request body; one jsonb value. 0074.';
