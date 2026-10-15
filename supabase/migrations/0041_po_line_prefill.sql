-- 0041_po_line_prefill (O07): what "Issue PO" would pre-fill, shown before anything is issued.
--
-- The Issue purchase order dialog (g2-order-detail.html, "Issue PO dialog") shows every line with its price and where the price came
-- from: the order, the supplier's quote, the supplier's last PO, or typed. issue_purchase_order() (0036) already decides that and
-- stamps it into the PO, but it only runs when the PO is issued. This function asks the same question without writing anything, and
-- also says WHERE each price came from, so the label can read "Their quote, RFQ-0162, 11 Oct" or "PO-26-0009, 14 Aug 2026".
--
--   price_source      order / quote / last_po / typed (typed: no price known; unit_price is null)
--   source_number     quote: the RFQ number the supplier quoted on. last_po: the PO number. Otherwise null.
--   source_revision   last_po only: the revision of that PO.
--   source_on         quote: the day the quote line was saved. last_po: the day that PO was issued.
--
-- The matching rules are issue_purchase_order's, copied line for line (same sources, same order, same currency rule, same section 5c
-- tiers 0 and 1 for "last PO"). A pgTAP test (0041_po_line_prefill.test.sql) issues a PO and checks that every line's price and source
-- equal what this function said first, so the two cannot drift apart without a test failing.
--
-- SECURITY INVOKER with a fixed search_path: the caller's own row security applies, so a leg the caller cannot read gives no rows.
-- Only goods lines (not services) of the leg are returned, in position order. Writes nothing.

create function public.po_line_prefill(p_supplier_order_id uuid)
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

revoke all on function public.po_line_prefill(uuid) from public, anon, authenticated;
grant execute on function public.po_line_prefill(uuid) to authenticated;

comment on function public.po_line_prefill(uuid) is
  'What issue_purchase_order would pre-fill for a leg, with where each price came from. Writes nothing. Keep in step with issue_purchase_order (a pgTAP test compares them).';
