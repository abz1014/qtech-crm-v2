-- 0093_supplier_categories (owner request, task C2): "Ask more suppliers" suggests suppliers by PRODUCT CATEGORY, because the
-- same categories are asked about again and again.
--
-- A category is a row of public.brands with kind = 'family' (0006); a supplier carries it through company_brands (0006), which
-- learn_company_brands (0008) fills from quote lines. The family list is noisy because it came from the legacy import, so:
--
--   brands.curated                         true for the canonical categories only; the app suggests curated categories.
--   qtech_private.seed_curated_categories  inserts the 46 canonical categories (src/lib/categories/dictionary.ts, CATEGORY_NAMES)
--                                          when missing and marks an existing same-named family curated without renaming it.
--                                          Idempotent. Fixed ids 'ca7e0000-0000-4000-8000-<position, 12 digits>'.
--   v_supplier_category_evidence           per (supplier, category): COUNTS ONLY (asked, replied, quoted, no_offer, ordered) and
--                                          the last date asked. No money, so it is the same for every role (security_invoker).
--   supplier_category_price_wins(ids)      per (supplier, category): how often the supplier ranked first (rank_item_quotes, 0049)
--                                          on items of that category. Wins and of_ranked are NULL unless the caller is admin or sales.
--   guard_supplier_category_tagging        inserting, changing or deleting a company_brands row whose brand is a family
--                                          (= tagging a supplier with a category) is for admin and sales only.
--
-- Not changed: rfq_items.family_id. Who may set it is as before: 0007 row security plus the 0092 "whose is it" guard (the person
-- who entered or owns the RFQ, or an admin).
--
-- Money safety (0081, owner decision 2026-10-22): the engineer has no price. The view holds counts only and is granted to
-- qtech_engineer. The function reads prices through rank_item_quotes, which an engineer may not run, so it is SECURITY DEFINER
-- (public, search_path = '' as 0057 requires) and decides inside: for any role but admin and sales every count is NULL and no
-- ranking is run. A deactivated user gets no rows. Pattern: rank_item_quotes' see_sell (0049).

-- ================================================================ brands.curated
alter table public.brands add column curated boolean not null default false;

comment on column public.brands.curated is
  '0093: true for the canonical product categories (kind = family) that "Ask more suppliers" suggests. Imported families stay false.';

-- ================================================================ the seed
create function qtech_private.seed_curated_categories()
returns table (inserted integer, matched integer)
language plpgsql
set search_path = ''
as $$
declare
  canon constant text[] := array[
    'MCB', 'MCCB', 'ACB', 'RCCB/ELCB', 'Contactors', 'Isolators', 'Fuses',
    'Overload relays', 'Control relays', 'Protection/monitoring relays', 'Timers',
    'PLC', 'HMI', 'VFD/drives', 'Soft starters', 'Power supplies',
    'Pressure transmitters', 'Pressure gauges', 'Pressure switches', 'CT/PT',
    'Temperature transmitters', 'Temperature controllers', 'RTD/thermocouples',
    'Level switches', 'Level transmitters', 'Flow meters', 'Analysers',
    'Solenoid valves', 'Control valves/actuators',
    'Push buttons', 'Pilot lamps', 'Selector switches', 'Limit switches',
    'Proximity sensors', 'Photoelectric sensors', 'Encoders',
    'Cables', 'Cable glands', 'Cable lugs/thimbles', 'Terminal blocks', 'Enclosures/DBs',
    'Energy meters', 'Capacitors', 'Motors', 'UPS/batteries', 'Commissioning service'];
  n_matched integer;
  n_inserted integer;
begin
  -- an existing family with the same name (the unique index compares lower(btrim(name))): mark it, leave its name alone
  update public.brands b
  set curated = true
  where b.kind = 'family'
    and lower(btrim(b.name)) in (select lower(c) from unnest(canon) c)
    and not b.curated;
  get diagnostics n_matched = row_count;

  -- the missing ones; a name already taken by a brand-kind row, or an id already used, is skipped
  insert into public.brands (id, name, kind, curated)
  select ('ca7e0000-0000-4000-8000-' || lpad(c.ord::text, 12, '0'))::uuid, c.name, 'family', true
  from unnest(canon) with ordinality as c (name, ord)
  on conflict do nothing;
  get diagnostics n_inserted = row_count;

  return query select n_inserted, n_matched;
end;
$$;

revoke all on function qtech_private.seed_curated_categories() from public, anon, authenticated;

do $$
declare
  r record;
begin
  select * into r from qtech_private.seed_curated_categories();
  raise notice '0093: % canonical categories added, % existing families marked curated', r.inserted, r.matched;
end
$$;

-- ================================================================ the seeded categories must not change item matching
-- brand_words() (0036) lists the words of EVERY brands row, brand and family alike (the 0036 header: "brand and family words are
-- removed from both descriptions before similarity is measured"); the imported families have always been part of it. Seeding the
-- 46 categories would add words such as "pressure", "cables" or "relays" and so change the "same item" (tier 1) similarity of
-- existing quotes. So the rows seeded here (fixed ids 'ca7e0000-...') are left out. Nothing else changes: a legacy family that
-- only got curated = true (a same-named match) stays in, exactly as before, which is why the rule is the seed id range and not
-- the curated flag. Same query as 0036 otherwise; create or replace keeps the grants.
create or replace function public.brand_words()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.w order by x.w), '{}'::text[])
  from (select unnest(string_to_array(public.item_text_norm(b.name), ' ')) as w
        from public.brands b
        where b.id::text not like 'ca7e0000-%') x
  where x.w <> ''
$$;

-- ================================================================ v_supplier_category_evidence
-- One row per (supplier, category) that was asked or ordered. Counts only.
--   asked          sent inquiries (sent_on set) with at least one item of the category: one per inquiry, not per item
--   replied        of those, inquiries that quoted an item of the category or declared no offer
--   quoted         of those, inquiries with a quote line on an item of the category
--   no_offer       of those, no-offer declared and nothing quoted for the category
--   ordered        supplier orders (legs) on a non-cancelled order with a goods line of the category
--   last_asked_on  the latest sent_on among the asked inquiries
-- The category is rfq_items.family_id (asked, replied, quoted, no_offer) and order_items.family_id (ordered). All time.
create view public.v_supplier_category_evidence with (security_invoker = true) as
with ask as (
  select
    si.supplier_id,
    ri.family_id,
    si.id as inquiry_id,
    si.sent_on,
    si.no_offer_on,
    bool_or(q.id is not null) as has_quote
  from public.supplier_inquiries si
  join public.rfq_items ri on ri.rfq_id = si.rfq_id and ri.family_id is not null
  left join public.supplier_quote_lines q on q.inquiry_id = si.id and q.rfq_item_id = ri.id
  where si.sent_on is not null
  group by si.supplier_id, ri.family_id, si.id, si.sent_on, si.no_offer_on
),
a as (
  select
    k.supplier_id,
    k.family_id,
    count(*)::int as asked,
    (count(*) filter (where k.has_quote or k.no_offer_on is not null))::int as replied,
    (count(*) filter (where k.has_quote))::int as quoted,
    (count(*) filter (where k.no_offer_on is not null and not k.has_quote))::int as no_offer,
    max(k.sent_on) as last_asked_on
  from ask k
  group by k.supplier_id, k.family_id
),
o as (
  select
    so.supplier_id,
    oi.family_id,
    count(distinct so.id)::int as ordered
  from public.supplier_orders so
  join public.orders od on od.id = so.order_id and od.cancelled_on is null
  join public.order_items oi on oi.supplier_order_id = so.id and oi.family_id is not null and not oi.is_service
  group by so.supplier_id, oi.family_id
)
select
  coalesce(a.supplier_id, o.supplier_id) as supplier_id,
  coalesce(a.family_id, o.family_id) as family_id,
  coalesce(a.asked, 0) as asked,
  coalesce(a.replied, 0) as replied,
  coalesce(a.quoted, 0) as quoted,
  coalesce(a.no_offer, 0) as no_offer,
  coalesce(o.ordered, 0) as ordered,
  a.last_asked_on
from a
full join o on o.supplier_id = a.supplier_id and o.family_id = a.family_id;

revoke all on public.v_supplier_category_evidence from public, anon, authenticated;
grant select on public.v_supplier_category_evidence to authenticated, qtech_engineer;

-- ================================================================ supplier_category_price_wins
-- Per (supplier, category) for the given categories, the pairs that v_supplier_category_evidence lists:
--   wins        items of the category where the supplier's quote ranked first by rank_item_quotes (0049: lines within 2% of the
--               lowest price are ordered by delivery record, so "first" is the cheapest-or-near-cheapest reliable supplier)
--   of_ranked   items of the category where the supplier had a comparable quote that was ranked against at least one other
--               comparable quote (a lone quote wins nothing and is not counted)
-- Both are NULL for anyone who is not admin or sales (the ranking is not even run). No rows for a deactivated user.
create function public.supplier_category_price_wins(p_family_ids uuid[])
returns table (supplier_id uuid, family_id uuid, wins integer, of_ranked integer)
language sql
stable
security definer
set search_path = ''
as $$
  with
  who as (
    select public.current_user_role() as urole
  ),
  pairs as (
    select e.supplier_id, e.family_id
    from public.v_supplier_category_evidence e
    where e.family_id = any (p_family_ids)
      and (select w.urole from who w) is not null
  ),
  rfqs as (
    select distinct ri.rfq_id
    from public.rfq_items ri
    where ri.family_id = any (p_family_ids)
      and coalesce((select w.urole from who w) in ('admin', 'sales'), false)
      and exists (select 1 from public.supplier_quote_lines q where q.rfq_item_id = ri.id)
  ),
  ranked as (
    select
      ri.family_id,
      x.supplier_id,
      x.rank,
      count(*) over (partition by x.rfq_item_id) as n_comparable
    from rfqs r
    cross join lateral public.rank_item_quotes(r.rfq_id) x
    join public.rfq_items ri on ri.id = x.rfq_item_id and ri.family_id = any (p_family_ids)
    where x.comparable
  ),
  agg as (
    select
      k.supplier_id,
      k.family_id,
      (count(*) filter (where k.rank = 1))::int as wins,
      count(*)::int as of_ranked
    from ranked k
    where k.n_comparable >= 2
    group by k.supplier_id, k.family_id
  )
  select
    p.supplier_id,
    p.family_id,
    case when coalesce((select w.urole from who w) in ('admin', 'sales'), false) then coalesce(g.wins, 0) end,
    case when coalesce((select w.urole from who w) in ('admin', 'sales'), false) then coalesce(g.of_ranked, 0) end
  from pairs p
  left join agg g on g.supplier_id = p.supplier_id and g.family_id = p.family_id
  order by p.family_id, p.supplier_id
$$;

revoke all on function public.supplier_category_price_wins(uuid[]) from public, anon, authenticated;
grant execute on function public.supplier_category_price_wins(uuid[]) to authenticated, qtech_engineer;

-- ================================================================ tagging a supplier with a category: admin and sales
-- company_brands is writable by every staff role (0006) because brands themselves are not restricted. A row whose brand is a
-- FAMILY is a supplier's category tag: that is for admin and sales. Brand-kind rows are unchanged. The learn trigger
-- (learn_company_brands, 0008) and the merge functions are SECURITY DEFINER and run as their owner, so they are not limited:
-- the guard names the API roles only (the 0065 shape), and an engineer's request is qtech_engineer since 0081.
create function public.guard_supplier_category_tagging()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_family boolean;
begin
  if current_user not in ('authenticated', 'qtech_engineer') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if coalesce((select public.current_user_role()), '') in ('admin', 'sales') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    select exists (select 1 from public.brands b where b.id = old.brand_id and b.kind = 'family') into v_family;
  elsif tg_op = 'INSERT' then
    select exists (select 1 from public.brands b where b.id = new.brand_id and b.kind = 'family') into v_family;
  else
    select exists (select 1 from public.brands b where b.id in (old.brand_id, new.brand_id) and b.kind = 'family') into v_family;
  end if;

  if v_family then
    raise exception 'supplier categories are tagged by admin and sales only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_supplier_category_tagging() from public, anon, authenticated;

create trigger company_brands_guard_category_tagging before insert or update or delete on public.company_brands
  for each row execute function public.guard_supplier_category_tagging();
