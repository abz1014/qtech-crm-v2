-- 0095: order, PO and repeat-order fixes from the RFQ -> order hunt (HW-51 to HW-63; branch fix/hunt-orders).
--
--   HW-51  issue_purchase_order: a supplier order already delivered is placed on its delivered date, never after it.
--   HW-52  The customer PO key ignores cancelled orders (a customer re-sends a PO after a cancellation and the new order can have it),
--          and a refusal names the PO and the order that holds it.
--   HW-53  create_repeat_order refuses a cancelled order unless the caller confirms (p_repeat_cancelled).
--   HW-54  A repeat of an order whose price basis is unknown copies no figure: every line is "price needed", priced 0.
--   HW-55  A repeat copies a line priced 0 as "price needed" (order_items.legacy_flags has 'price_needed'), not as a normal line.
--   HW-58  Reopening a cancelled order is refused while its RFQ has another live order.
--   HW-61  issue_purchase_order refuses quantities that no longer match the order lines.
--   HW-63  issue_purchase_order takes the revision the caller expects and refuses if somebody issued first.
--
-- Both RPCs gain a trailing parameter with a default; the old signature is dropped so a call by name or position stays unambiguous.
-- issue_purchase_order keeps the 0092 bypass marker (its pgTAP test fails without it). qtech_engineer gets no grant (a price RPC).

-- ================================================================ HW-52: the customer PO key ignores cancelled orders
-- Why: a cancelled order is not owed or invoiced, but the key kept its PO, so a customer who re-sent the same PO after cancelling could
-- not be won again. The cancelled order keeps its number on record; only a live order holds a PO. A cancelled order that is reopened
-- while a live order holds the PO is refused by the trigger below with the same sentence.
drop index if exists public.orders_company_po_key;
create unique index orders_company_po_key on public.orders (company_id, customer_po_number)
  where customer_po_number is not null and cancelled_on is null and not ('po_shared' = any (legacy_flags));

-- Runs before the index, so the person is told which PO and which order instead of "A order with these details already exists".
-- The unique code (23505) is kept: the app and 0009 treat it as a duplicate. The index still decides a race between two sessions.
create function public.orders_check_po_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other public.orders;
begin
  if new.customer_po_number is null or new.cancelled_on is not null or 'po_shared' = any (new.legacy_flags) then
    return new;
  end if;
  select o.* into v_other
  from public.orders o
  where o.company_id = new.company_id and o.customer_po_number = new.customer_po_number and o.id <> new.id
    and o.cancelled_on is null and not ('po_shared' = any (o.legacy_flags))
  limit 1;
  if found then
    raise exception 'PO % is already on order ORD-%. Open that order instead of adding a second.',
      new.customer_po_number, lpad(v_other.number::text, 4, '0')
      using errcode = '23505', hint = 'po_has_order:' || v_other.id::text;
  end if;
  return new;
end;
$$;

revoke all on function public.orders_check_po_free() from public, anon, authenticated;

create trigger orders_po_free before insert or update of customer_po_number, cancelled_on, company_id, legacy_flags on public.orders
  for each row execute function public.orders_check_po_free();

-- ================================================================ HW-58: no reopening while the RFQ has another live order
create function public.orders_check_rfq_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other public.orders;
  v_rfq   bigint;
begin
  if old.cancelled_on is null or new.cancelled_on is not null or new.rfq_id is null then
    return new;
  end if;
  select o.* into v_other from public.orders o where o.rfq_id = new.rfq_id and o.id <> new.id and o.cancelled_on is null order by o.created_at limit 1;
  if found then
    select r.number into v_rfq from public.rfqs r where r.id = new.rfq_id;
    raise exception 'RFQ-% already has live order ORD-%.', lpad(v_rfq::text, 4, '0'), lpad(v_other.number::text, 4, '0')
      using errcode = 'P0001', hint = 'rfq_has_order:' || v_other.id::text;
  end if;
  return new;
end;
$$;

revoke all on function public.orders_check_rfq_free() from public, anon, authenticated;

create trigger orders_rfq_free before update of cancelled_on on public.orders
  for each row execute function public.orders_check_rfq_free();

-- ================================================================ create_repeat_order (HW-53, HW-54, HW-55)
-- Repeating copies the lines, but the CRM never works out a price: a line the old order carried at 0, and every line of an order whose price
-- basis is unknown (value_basis_unknown: the old CRM did not say if its figures include GST), is copied at 0 and marked 'price_needed' on the
-- line, for the person to type. The new order never carries value_basis_unknown (only an admin sets legacy flags). A cancelled source is
-- refused unless the caller passes p_repeat_cancelled (the dialog asks "Repeat it anyway?" and calls again).
drop function public.create_repeat_order(uuid, uuid, text, date);

create function public.create_repeat_order(
  p_order_id            uuid,
  p_from_order_id       uuid,
  p_customer_po_number  text default null,
  p_ordered_on          date default null,
  p_repeat_cancelled    boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src      public.orders;
  v_inserted uuid;
  v_unknown  boolean;
begin
  if p_order_id is null or p_from_order_id is null then
    raise exception 'create_repeat_order needs a new order id and a source order' using errcode = '22023';
  end if;

  if exists (select 1 from public.orders where id = p_order_id) then
    return p_order_id;
  end if;

  select * into v_src from public.orders where id = p_from_order_id;
  if not found then
    raise exception 'order % not found', p_from_order_id using errcode = 'P0002';
  end if;
  if v_src.cancelled_on is not null and not coalesce(p_repeat_cancelled, false) then
    raise exception 'This order was cancelled. Repeat it anyway?' using errcode = 'P0001';
  end if;
  v_unknown := 'value_basis_unknown' = any (v_src.legacy_flags);

  insert into public.orders (id, company_id, site_id, contact_id, customer_po_number, ordered_on,
                             payment_terms_days, needs_commissioning)
  values (p_order_id, v_src.company_id, v_src.site_id, v_src.contact_id, nullif(btrim(p_customer_po_number), ''),
          coalesce(p_ordered_on, public.today_pkt()), v_src.payment_terms_days, v_src.needs_commissioning)
  on conflict (id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return p_order_id;
  end if;

  with map as (
    select l.id as old_id, gen_random_uuid() as new_id, l.supplier_id, l.currency
    from public.supplier_orders l
    where l.order_id = p_from_order_id
      and exists (select 1 from public.order_items i where i.supplier_order_id = l.id)
  ),
  new_legs as (
    insert into public.supplier_orders (id, order_id, supplier_id, currency)
    select m.new_id, p_order_id, m.supplier_id, m.currency from map m
    returning id
  )
  insert into public.order_items (order_id, position, description, brand_id, family_id, qty, unit,
                                  unit_price_net, gst_rate, is_service, supplier_order_id, supplier_unit_price, legacy_flags)
  select p_order_id, i.position, i.description, i.brand_id, i.family_id, i.qty, i.unit,
         case when v_unknown or i.unit_price_net = 0 then 0 else i.unit_price_net end,
         i.gst_rate, i.is_service, m.new_id, i.supplier_unit_price,
         case when v_unknown or i.unit_price_net = 0 then array['price_needed']::text[] else '{}'::text[] end
  from public.order_items i
  left join map m on m.old_id = i.supplier_order_id
  where i.order_id = p_from_order_id;

  return p_order_id;
end;
$$;

revoke all on function public.create_repeat_order(uuid, uuid, text, date, boolean) from public, anon, authenticated;
grant execute on function public.create_repeat_order(uuid, uuid, text, date, boolean) to authenticated;

-- ================================================================ issue_purchase_order (HW-51, HW-61, HW-63)
drop function public.issue_purchase_order(uuid, uuid, jsonb, text, text, text, text, text);

create or replace function public.issue_purchase_order(
  p_po_id             uuid,
  p_supplier_order_id uuid,
  p_lines             jsonb default null,
  p_incoterm          text default null,
  p_delivery_terms    text default null,
  p_payment_terms     text default null,
  p_ship_to           text default null,
  p_notes             text default null,
  p_expected_revision integer default null
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
  v_bw       text[] := public.brand_words();
  v_last     public.purchase_orders;
  v_by       text;
begin
  perform pg_catalog.set_config('qtech.entered_by_bypass', 'on', true);   -- 0092: workflow write, not an edit of somebody's entry
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

  -- 0095 (HW-61): the quantities the dialog showed must still be the order lines' quantities (a split in another tab moved some).
  if p_lines is not null and exists (
    select 1
    from jsonb_array_elements(p_lines) e
    join public.order_items oi on oi.id = nullif(e ->> 'order_item_id', '')::uuid
    where oi.supplier_order_id = p_supplier_order_id
      and nullif(e ->> 'qty', '') is not null
      and (e ->> 'qty')::numeric is distinct from oi.qty
  ) then
    raise exception 'The order lines changed. Review again.' using errcode = 'P0001';
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

  -- 0095 (HW-63): the revision the dialog said it would issue ("New PO, R0") must still be the next one; if somebody issued first, say who.
  if p_expected_revision is not null and p_expected_revision is distinct from v_revision::integer then
    select po.* into v_last from public.purchase_orders po where po.supplier_order_id = p_supplier_order_id order by po.revision desc limit 1;
    select u.name into v_by from public.users u where u.id = coalesce(v_last.created_by, v_last.signatory_id);
    raise exception 'PO R% was just issued by %. Revise instead?', coalesce(v_last.revision, 0), coalesce(v_by, 'someone else') using errcode = 'P0001';
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

  -- 0095 (HW-51): never later than the delivery. A supplier order already delivered when its PO is issued is placed on its delivered date.
  update public.supplier_orders set placed_on = least(v_issued, coalesce(delivered_on, v_issued)) where id = p_supplier_order_id and placed_on is null;

  return p_po_id;
end;
$$;

revoke all on function public.issue_purchase_order(uuid, uuid, jsonb, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.issue_purchase_order(uuid, uuid, jsonb, text, text, text, text, text, integer)
  to authenticated;
