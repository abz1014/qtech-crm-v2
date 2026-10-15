-- 0040_customer_price_memory_order_ref (R19 parity): customer_price_memory gains sold_order_number, so the chip can read "ORD-0031" as the mockup draws it.
-- The rest is unchanged from 0037 (R19). The function is dropped and re-created because its result columns change.
-- (was 0037_customer_price_memory (R19): the two price chips of the issue-quotation dialog (BUILD_PLAN Amendment A3, R19).
--   last sold    the newest order line for the SAME company whose item matches (item_match_tier 0 = same model or
--                1 = same item), from order_items.unit_price_net; cancelled orders are ignored
--   last quoted  the newest earlier quotation line for the same company that matches (tier 0 or 1), from the
--                quotations.lines snapshot; the RFQ being quoted is excluded, so a re-issue does not echo itself
-- Matching follows 0035 and 0036: model tokens that are really brand names, and brand words in the descriptions, are stripped from the
-- target and every candidate before item_match_tier decides (one read of brands per call), exactly as supplier_item_memory does.
-- One row per item of the RFQ that has at least one of the two. Read-only, SECURITY INVOKER: the caller's row security
-- applies, and every table read is readable by all active staff (section 10). Customer prices are not cost data.
drop function public.customer_price_memory(uuid);

create function public.customer_price_memory(p_rfq_id uuid)
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

revoke all on function public.customer_price_memory(uuid) from public, anon, authenticated;
grant execute on function public.customer_price_memory(uuid) to authenticated;
