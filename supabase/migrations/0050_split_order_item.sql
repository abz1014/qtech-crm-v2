-- 0050_split_order_item (S25, Amendment A8): splitting an item across suppliers.
--
-- A split is stored as several order_items rows for one RFQ item (same rfq_item_id), each with its own qty and its own
-- supplier_order_id (leg). No new table. Invoices, the money views, goods state, PO lines, supplier memory and create_repeat_order
-- already sum or copy lines and legs, so they need no change.
--
--   convert_rfq_to_order   Same signature and behaviour, plus two rules:
--                          1. when quote_line_id is left out, the item takes its rank-1 quote line from rank_item_quotes() (0049)
--                             instead of "the only line" (an item whose lines cannot be ranked stays unsourced, as before);
--                          2. two entries for one item that resolve to the same quote line are refused (22023): that would be the
--                             same supplier twice. A split is two entries with their own qty and quote_line_id.
--   split_order_item       New. Moves part of an order line onto another leg of the same order, or onto a leg for a supplier (the
--                          order's existing leg for that supplier and currency, else a new one). For orders without an RFQ and for
--                          splitting after conversion. SECURITY INVOKER: the caller's own row security applies.
-- Unchanged on purpose: it never touches order_costs, and it does not check that the parts add up to the RFQ quantity (the screen warns).

-- ---------------------------------------------------------------- convert_rfq_to_order (0019 + rank-1 inference + duplicate guard)
create or replace function public.convert_rfq_to_order(
  p_order_id            uuid,
  p_rfq_id              uuid,
  p_items               jsonb default null,
  p_customer_po_number  text default null,
  p_ordered_on          date default null,
  p_payment_terms_days  integer default null,
  p_needs_commissioning boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rfq      public.rfqs;
  v_sel      jsonb;
  v_rows     jsonb;
  v_terms    integer;
  v_inserted uuid;
  v_bad      text;
begin
  if p_order_id is null or p_rfq_id is null then
    raise exception 'convert_rfq_to_order needs an order id and an RFQ id' using errcode = '22023';
  end if;

  if exists (select 1 from public.orders where id = p_order_id) then
    return p_order_id;
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id;
  if not found then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
  end if;
  -- A customer may send the PO weeks after the RFQ was closed (e.g. "no reply"). Converting reopens it in the
  -- same transaction, so there is no separate reopen step; audit_log records the update.
  if v_rfq.closed_on is not null then
    update public.rfqs set closed_on = null, close_reason = null, close_note = null where id = p_rfq_id;
  end if;

  v_sel := coalesce(
    p_items,
    (select jsonb_agg(jsonb_build_object('rfq_item_id', i.id) order by i.position, i.created_at)
     from public.rfq_items i where i.rfq_id = p_rfq_id));
  if v_sel is null or jsonb_typeof(v_sel) <> 'array' or jsonb_array_length(v_sel) = 0 then
    raise exception 'the RFQ has no items to convert' using errcode = '22023';
  end if;

  -- One normalised row per order line, computed once and validated before anything is written.
  select coalesce(jsonb_agg(to_jsonb(b) order by b.ord), '[]'::jsonb) into v_rows
  from (
    select
      s.ord,
      ri.id as rfq_item_id,
      ri.description,
      ri.brand_id,
      ri.family_id,
      coalesce(s.qty, ri.qty) as qty,
      ri.unit,
      coalesce(s.unit_price_net, ri.quoted_unit_price_net) as unit_price_net,
      ri.gst_rate,
      s.is_service,
      ql.id as quote_line_id,
      ql.unit_price as supplier_unit_price,
      ql.currency as currency,
      ql.inquiry_id,
      si.supplier_id,
      (s.is_service = false and s.quote_line_id is not null and ql.id is null) as bad_quote_line
    from (
      select (e ->> 'rfq_item_id')::uuid as rfq_item_id,
             nullif(e ->> 'quote_line_id', '')::uuid as quote_line_id,
             nullif(e ->> 'unit_price_net', '')::numeric as unit_price_net,
             nullif(e ->> 'qty', '')::numeric as qty,
             coalesce((e ->> 'is_service')::boolean, false) as is_service,
             ord
      from jsonb_array_elements(v_sel) with ordinality as t (e, ord)
    ) s
    join public.rfq_items ri on ri.id = s.rfq_item_id and ri.rfq_id = p_rfq_id
    left join (
      select r.rfq_item_id, r.quote_line_id as id
      from public.rank_item_quotes(p_rfq_id) r
      where r.rank = 1
    ) sole on sole.rfq_item_id = ri.id
    left join public.supplier_quote_lines ql
      on ql.id = case when s.is_service then null else coalesce(s.quote_line_id, sole.id) end
     and ql.rfq_item_id = ri.id
    left join public.supplier_inquiries si on si.id = ql.inquiry_id
  ) b;

  if jsonb_array_length(v_rows) <> jsonb_array_length(v_sel) then
    raise exception 'an item does not belong to this RFQ' using errcode = '22023';
  end if;
  select string_agg(r.description, ', ') into v_bad
  from jsonb_to_recordset(v_rows) as r (description text, bad_quote_line boolean)
  where r.bad_quote_line;
  if v_bad is not null then
    raise exception 'the chosen quote line is not a quote for the item: %', v_bad using errcode = '22023';
  end if;
  select string_agg(r.description, ', ') into v_bad
  from jsonb_to_recordset(v_rows) as r (description text, unit_price_net numeric)
  where r.unit_price_net is null;
  if v_bad is not null then
    raise exception 'a selling price is needed for: %', v_bad using errcode = '22023';
  end if;
  -- A split is several entries for one item, each with its own supplier. The same quote line twice would be the same
  -- supplier twice (whether named or inferred), so it is refused.
  select string_agg(d.description, ', ') into v_bad
  from (
    select min(r.description) as description
    from jsonb_to_recordset(v_rows) as r (description text, rfq_item_id uuid, quote_line_id uuid, is_service boolean)
    where r.quote_line_id is not null and not r.is_service
    group by r.rfq_item_id, r.quote_line_id
    having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'split parts of an item must use different suppliers: %', v_bad using errcode = '22023';
  end if;

  v_terms := coalesce(
    p_payment_terms_days,
    (select o.payment_terms_days from public.orders o
     where o.company_id = v_rfq.company_id and o.payment_terms_days is not null
     order by o.ordered_on desc nulls last, o.created_at desc
     limit 1));

  insert into public.orders (id, company_id, site_id, contact_id, rfq_id, owner_id, customer_po_number,
                             ordered_on, payment_terms_days, needs_commissioning)
  values (p_order_id, v_rfq.company_id, v_rfq.site_id, v_rfq.contact_id, p_rfq_id,
          coalesce(v_rfq.owner_id, auth.uid()), nullif(btrim(p_customer_po_number), ''),
          coalesce(p_ordered_on, public.today_pkt()), v_terms, coalesce(p_needs_commissioning, false))
  on conflict (id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return p_order_id;
  end if;

  -- Legs and items in one statement: the legs CTE runs once and the items join to it by (inquiry, currency).
  with src as (
    select * from jsonb_to_recordset(v_rows) as r (
      ord bigint, rfq_item_id uuid, description text, brand_id uuid, family_id uuid, qty numeric, unit text,
      unit_price_net numeric, gst_rate numeric, is_service boolean, supplier_unit_price numeric,
      currency char(3), inquiry_id uuid, supplier_id uuid)
  ),
  legs as (
    insert into public.supplier_orders (order_id, supplier_id, inquiry_id, currency)
    select distinct p_order_id, s.supplier_id, s.inquiry_id, s.currency
    from src s
    where s.inquiry_id is not null
    returning id, inquiry_id, currency
  )
  insert into public.order_items (order_id, position, description, brand_id, family_id, qty, unit,
                                  unit_price_net, gst_rate, is_service, supplier_order_id, rfq_item_id,
                                  supplier_unit_price)
  select p_order_id, (s.ord - 1)::smallint, s.description, s.brand_id, s.family_id, s.qty, s.unit,
         s.unit_price_net, s.gst_rate, s.is_service, g.id, s.rfq_item_id, s.supplier_unit_price
  from src s
  left join legs g on g.inquiry_id = s.inquiry_id and g.currency = s.currency;

  return p_order_id;
end;
$$;

revoke all on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean)
  to authenticated;

-- ---------------------------------------------------------------- split_order_item
--   p_item_id              the order line to split
--   p_qty                  the quantity to move; 0 < p_qty < the line's qty (the source line keeps the rest)
--   p_supplier_order_id    move to this existing leg of the same order, OR
--   p_supplier_id          move to the leg for this supplier (and p_currency): the order's existing leg for that supplier and
--                          currency if there is one, else a new leg, linked to the supplier's inquiry on the order's RFQ when it has one
--   p_supplier_unit_price  the purchase price of the new line in the leg's currency; NULL when not given (the source line's price is
--                          another supplier's price and is not copied)
-- Exactly one of p_supplier_order_id and p_supplier_id is given. A service line is refused. The new line copies description, brand,
-- family, unit, selling price, GST rate and rfq_item_id, and sits at the same position. A PO already issued for the source leg is
-- not touched (O07 shows that the lines changed since). Returns the id of the new order line.
create function public.split_order_item(
  p_item_id              uuid,
  p_qty                  numeric,
  p_supplier_order_id    uuid default null,
  p_supplier_id          uuid default null,
  p_currency             text default null,
  p_supplier_unit_price  numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_leg  uuid;
  v_cur  char(3);
  v_new  uuid;
begin
  if p_item_id is null or p_qty is null then
    raise exception 'split_order_item needs an order line and a quantity' using errcode = '22023';
  end if;
  if (p_supplier_order_id is null) = (p_supplier_id is null) then
    raise exception 'name either an existing supplier order or a supplier to move the quantity to' using errcode = '22023';
  end if;

  select * into v_item from public.order_items where id = p_item_id for update;
  if not found then
    raise exception 'order line % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.is_service then
    raise exception 'a service line cannot be split' using errcode = '22023';
  end if;
  if p_qty <= 0 or p_qty >= v_item.qty then
    raise exception 'the quantity to move must be more than 0 and less than the line quantity (%)', v_item.qty
      using errcode = '22023';
  end if;

  if p_supplier_order_id is not null then
    select so.id into v_leg from public.supplier_orders so
    where so.id = p_supplier_order_id and so.order_id = v_item.order_id;
    if not found then
      raise exception 'the supplier order is not a leg of this order' using errcode = '22023';
    end if;
    if v_leg is not distinct from v_item.supplier_order_id then
      raise exception 'choose a different supplier order from the one the line is on' using errcode = '22023';
    end if;
  else
    v_cur := upper(nullif(btrim(p_currency), ''));
    select so.id into v_leg from public.supplier_orders so
    where so.order_id = v_item.order_id and so.supplier_id = p_supplier_id
      and so.currency is not distinct from v_cur
      and so.id is distinct from v_item.supplier_order_id
    order by so.created_at, so.id
    limit 1;
    if v_leg is null then
      insert into public.supplier_orders (order_id, supplier_id, inquiry_id, currency)
      values (v_item.order_id, p_supplier_id,
              (select si.id from public.supplier_inquiries si
               join public.orders o on o.rfq_id = si.rfq_id
               where o.id = v_item.order_id and si.supplier_id = p_supplier_id),
              v_cur)
      returning id into v_leg;
    end if;
  end if;

  update public.order_items set qty = qty - p_qty where id = p_item_id;

  insert into public.order_items (order_id, position, description, brand_id, family_id, qty, unit, unit_price_net, gst_rate,
                                  is_service, supplier_order_id, rfq_item_id, supplier_unit_price)
  values (v_item.order_id, v_item.position, v_item.description, v_item.brand_id, v_item.family_id, p_qty, v_item.unit,
          v_item.unit_price_net, v_item.gst_rate, false, v_leg, v_item.rfq_item_id, p_supplier_unit_price)
  returning id into v_new;

  return v_new;
end;
$$;

revoke all on function public.split_order_item(uuid, numeric, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.split_order_item(uuid, numeric, uuid, uuid, text, numeric) to authenticated;
