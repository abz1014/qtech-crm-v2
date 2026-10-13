-- 0023_issue_rpcs (S18, part 2): issue_quotation, issue_purchase_order, and v_rfq_state with quotation_expired
-- (Amendment A4). DATA_MODEL sections 2.25, 2.26, 4 and Amendments A2, A2b, A3.
--
-- Both RPCs are SECURITY INVOKER with search_path = '' and idempotent on the client-generated id: a second call with
-- an id that already exists returns it and writes nothing. Entry burden (Amendment A3): the parameters are the id and
-- the source record; dates are today in Karachi; everything else is inferred from context and overridable.

-- ---------------------------------------------------------------- item_text_norm (helper)
-- Normalised item text for fuzzy matching (section 5c norm()): lower case, standalone quantities and units dropped
-- (a number is dropped only when it is a word of its own, so model codes like HQ1110 survive), punctuation removed,
-- spaces collapsed. S19 reuses it.
create function public.item_text_norm(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(t, '')),
               '\m[0-9]+([.,][0-9]+)?\s*(mm|cm|m|kv|v|ma|a|kw|w|hz|bar|psi|pcs|nos|no|x)?\M', ' ', 'g'),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

grant execute on function public.item_text_norm(text) to authenticated;

-- ---------------------------------------------------------------- issue_quotation
-- Snapshots the RFQ's current prices into a quotation. Every item needs quoted_unit_price_net. The first issue takes
-- a number from quotation_number_seq; a re-issue keeps the number and adds one to the revision. Stamps rfqs.quoted_on.
-- Inferred when not given: valid_until (issued_on + company_profile.quotation_validity_days); contact, delivery text,
-- payment terms and notes (from the previous revision, else the RFQ's contact). Totals are calculated from the lines.
create function public.issue_quotation(
  p_quotation_id   uuid,
  p_rfq_id         uuid,
  p_valid_until    date default null,
  p_contact_id     uuid default null,
  p_delivery_text  text default null,
  p_payment_terms  text default null,
  p_notes          text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rfq      public.rfqs;
  v_prev     public.quotations;
  v_lines    jsonb;
  v_missing  text;
  v_number   integer;
  v_revision smallint;
  v_issued   date := public.today_pkt();
  v_days     smallint;
begin
  if p_quotation_id is null or p_rfq_id is null then
    raise exception 'issue_quotation needs a quotation id and an RFQ id' using errcode = '22023';
  end if;
  if exists (select 1 from public.quotations where id = p_quotation_id) then
    return p_quotation_id;
  end if;

  -- Serialises issuers for one RFQ, so two revisions never race for the same number.
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
  end if;

  select jsonb_agg(jsonb_build_object(
           'rfq_item_id', i.id,
           'description', i.description,
           'qty', i.qty,
           'unit', i.unit,
           'unit_price_net', i.quoted_unit_price_net,
           'gst_rate', i.gst_rate,
           'lead_time', i.quoted_lead_time) order by i.position, i.created_at),
         string_agg(i.description, ', ') filter (where i.quoted_unit_price_net is null)
  into v_lines, v_missing
  from public.rfq_items i
  where i.rfq_id = p_rfq_id;
  if v_lines is null then
    raise exception 'the RFQ has no items to quote' using errcode = '22023';
  end if;
  if v_missing is not null then
    raise exception 'a quoted price is needed for: %', v_missing using errcode = '22023';
  end if;

  select * into v_prev from public.quotations where rfq_id = p_rfq_id order by revision desc limit 1;
  if found then
    v_number := v_prev.number;
    v_revision := v_prev.revision + 1;
  else
    v_number := nextval('public.quotation_number_seq');
    v_revision := 0;
  end if;

  select p.quotation_validity_days into v_days from public.company_profile p where p.id = 1;

  insert into public.quotations (id, rfq_id, number, revision, issued_on, valid_until, contact_id, lines,
                                 net_total, gst_total, delivery_text, payment_terms, notes)
  values (p_quotation_id, p_rfq_id, v_number, v_revision, v_issued,
          coalesce(p_valid_until, v_issued + coalesce(v_days, 30)),
          coalesce(p_contact_id, v_prev.contact_id, v_rfq.contact_id),
          v_lines, 0, 0,
          coalesce(p_delivery_text, v_prev.delivery_text),
          coalesce(p_payment_terms, v_prev.payment_terms),
          coalesce(p_notes, v_prev.notes));

  update public.rfqs set quoted_on = v_issued where id = p_rfq_id;

  return p_quotation_id;
end;
$$;

revoke all on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- issue_purchase_order
-- Snapshots a procurement leg's goods lines into a PO in the leg's currency. Refused while supplier_orders.currency
-- is NULL; the currency is copied (frozen) into the PO. Each line's unit price is pre-filled from the first source
-- that has one, and labelled:
--   order    order_items.supplier_unit_price
--   quote    the supplier's own quote line for the linked RFQ item, in the leg's currency (latest first)
--   last_po  a line of the supplier's most recent earlier PO in the same currency for the same item: "same model"
--            (shared model token, brand equal when both are set) before "same item" (same brand and text similarity
--            >= 0.45, or no brand, same family and similarity >= 0.60), section 5c tiers 0 and 1
--   typed    blank; the caller must supply a price
-- p_lines (optional) narrows or overrides: [{"order_item_id": uuid, "unit_price": 12.5, "qty": 3}]. A price that differs
-- from the pre-fill is labelled typed. Without p_lines, every goods line on the leg is included.
-- On issue: the issued prices are written back to order_items.supplier_unit_price, and supplier_orders.placed_on is
-- stamped when empty. The first issue takes a number from po_number_seq; a re-issue keeps it and adds one to the revision.
-- Terms default to the previous PO to this supplier (incoterm, delivery, payment), payment terms falling back to
-- company_profile.po_terms; ship_to defaults to the company_profile address.
create function public.issue_purchase_order(
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
             or (poi.model_tokens && oi.model_tokens
                 and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id))
             or (oi.brand_id is not null and poi.brand_id = oi.brand_id
                 and extensions.similarity(public.item_text_norm(poi.description),
                                           public.item_text_norm(oi.description)) >= 0.45)
             or (oi.brand_id is null and oi.family_id is not null and poi.family_id = oi.family_id
                 and extensions.similarity(public.item_text_norm(poi.description),
                                           public.item_text_norm(oi.description)) >= 0.60)
           )
         order by (poi.id = oi.id) desc,
                  (poi.model_tokens && oi.model_tokens
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

revoke all on function public.issue_purchase_order(uuid, uuid, jsonb, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_purchase_order(uuid, uuid, jsonb, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------- v_rfq_state: quotation_expired (Amendment A4)
-- bid_state is now to_bid / bid_sent / quotation_expired. Expired = the latest quotation's valid_until has passed and the
-- RFQ is still open (not won, not closed). The new column quotation_valid_until is appended; the rest is as 0014.
create or replace view public.v_rfq_state with (security_invoker = true) as
select
  r.id as rfq_id,
  r.number,
  r.company_id,
  r.owner_id,
  r.received_on,
  r.due_on,
  r.is_priority,
  r.quoted_on,
  r.closed_on,
  r.close_reason,
  case when w.has_order then 'won' when r.closed_on is not null then 'closed' else 'open' end as outcome,
  (w.has_order and r.closed_on is not null) as outcome_clash,
  s.items_total,
  s.items_quoted,
  case when s.responders > 0 then s.items_total - s.items_quoted else 0 end as items_uncovered,
  s.floated,
  s.responders,
  case
    when s.floated = 0 then 'not_floated'
    when s.responders = 0 and s.no_offer = s.floated then 'no_offer_anywhere'
    when s.items_total > 0 and s.items_quoted = s.items_total then 'covered'
    when s.items_quoted > 0 then 'partly_covered'
    else 'floated_awaiting'
  end as sourcing_state,
  c.to_ask,
  c.waiting,
  case when c.waiting > 0 then public.today_pkt() - public.today_pkt(c.last_asked_at) end as waiting_days,
  c.to_relay,
  case
    when c.to_ask > 0 then 'to_ask'
    when c.waiting > 0 then 'waiting_on_customer'
    when c.to_relay > 0 then 'answers_to_relay'
    else 'none'
  end as clarification_state,
  case
    when r.quoted_on is null then 'to_bid'
    when qt.valid_until < public.today_pkt() and not w.has_order and r.closed_on is null then 'quotation_expired'
    else 'bid_sent'
  end as bid_state,
  case when r.due_on is not null then r.due_on - public.today_pkt() end as days_to_due,
  (r.due_on < public.today_pkt() and r.closed_on is null and not w.has_order) as is_overdue,
  qt.valid_until as quotation_valid_until
from public.rfqs r
left join lateral (
  select q.valid_until
  from public.quotations q
  where q.rfq_id = r.id
  order by q.revision desc
  limit 1
) qt on true
cross join lateral (
  select exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null) as has_order
) w
cross join lateral (
  select
    (select count(*) from public.rfq_items i where i.rfq_id = r.id) as items_total,
    (select count(*) from public.rfq_items i
      where i.rfq_id = r.id
        and exists (select 1 from public.supplier_quote_lines q where q.rfq_item_id = i.id)) as items_quoted,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id and (si.sent_on is not null or si.no_offer_on is not null)) as floated,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id and si.no_offer_on is not null
        and not exists (select 1 from public.supplier_quote_lines q where q.inquiry_id = si.id)) as no_offer,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id
        and exists (select 1 from public.supplier_quote_lines q where q.inquiry_id = si.id)) as responders
) s
cross join lateral (
  select
    count(*) filter (where cl.answered_at is null and cl.withdrawn_at is null and cl.first_asked_at is null) as to_ask,
    count(*) filter (where cl.answered_at is null and cl.withdrawn_at is null and cl.first_asked_at is not null) as waiting,
    max(cl.last_asked_at) filter (where cl.answered_at is null and cl.withdrawn_at is null
                                    and cl.first_asked_at is not null) as last_asked_at,
    count(*) filter (where cl.answered_at is not null and cl.withdrawn_at is null
                       and cl.raised_by_inquiry_id is not null
                       and cl.answered_at > coalesce(ri.last_relayed_at, '-infinity'::timestamptz)) as to_relay
  from public.clarifications cl
  left join public.supplier_inquiries ri on ri.id = cl.raised_by_inquiry_id
  where cl.rfq_id = r.id
) c;
