-- 0146_won_typed_supplier (quote first, owner 24 Nov 2026: "we just select the supplier we are going with and the price which the
-- supplier quoted"). Mark won no longer needs a supplier reply entered in the CRM.
--
--   convert_rfq_to_order: an entry may name the supplier itself, with no quote line: "supplier_id", and optionally
--   "supplier_unit_price" with its "currency" (3 capital letters, needed with a price). The order line then carries that supplier
--   price, and the supplier order (leg) is made for that supplier with no inquiry. An entry with a quote line works as before.
--   A typed supplier with a quote line or as a service is refused, as is an unknown supplier and a price with no currency.
--   One item cannot name the same supplier twice (the split rule, for typed suppliers too).
--   Legs are now one per (supplier, currency), keeping the supplier's inquiry when it has one. Before, they were one per
--   (inquiry, currency), which is the same thing whenever the supplier was asked once.
--   Same signature and grants as 0094 (authenticated only, so qtech_engineer still cannot run it).

create or replace function public.convert_rfq_to_order(
  p_order_id            uuid,
  p_rfq_id              uuid,
  p_items               jsonb default null,
  p_customer_po_number  text default null,
  p_ordered_on          date default null,
  p_payment_terms_days  integer default null,
  p_needs_commissioning boolean default false,
  p_expected_revision   integer default null
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
  v_live     public.orders;
  v_latest   integer;
begin
  if p_order_id is null or p_rfq_id is null then
    raise exception 'convert_rfq_to_order needs an order id and an RFQ id' using errcode = '22023';
  end if;

  if exists (select 1 from public.orders where id = p_order_id) then
    return p_order_id;
  end if;

  -- Locked: a second conversion of the same RFQ waits here until the first commits, then sees its order below.
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
  end if;
  -- A retry that waited on the lock behind its own first attempt finds that order now.
  if exists (select 1 from public.orders where id = p_order_id) then
    return p_order_id;
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

  -- HW-60: what the person saw must still be true. The latest quotation revision they opened the dialog on, and (per entry, as
  -- issue_quotation does with "qty") the RFQ quantity they saw. Read under the RFQ lock, which issue_quotation also takes.
  if p_expected_revision is not null then
    select max(q.revision) into v_latest from public.quotations q where q.rfq_id = p_rfq_id;
    if v_latest is distinct from p_expected_revision then
      raise exception 'The quotation changed since you opened this. Review again.' using errcode = 'P0001', hint = 'convert_stale';
    end if;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_sel) e
    join public.rfq_items i on i.id = (e ->> 'rfq_item_id')::uuid and i.rfq_id = p_rfq_id
    where nullif(e ->> 'expected_qty', '') is not null and i.qty <> (e ->> 'expected_qty')::numeric
  ) then
    raise exception 'The quotation changed since you opened this. Review again.' using errcode = 'P0001', hint = 'convert_stale';
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
      -- A quote line names the supplier, its price and currency. Without one, the supplier typed at Mark won (quote first).
      case when ql.id is not null then ql.unit_price else s.supplier_unit_price end as supplier_unit_price,
      case when ql.id is not null then ql.currency else s.currency end as currency,
      ql.inquiry_id,
      coalesce(si.supplier_id, s.supplier_id) as supplier_id,
      (ql.id is null and s.supplier_id is not null) as typed,
      (s.is_service = false and not s.not_sourced and s.quote_line_id is not null and ql.id is null) as bad_quote_line,
      (s.supplier_id is not null and (s.is_service or s.quote_line_id is not null)) as bad_typed,
      (s.supplier_id is not null and not exists (select 1 from public.companies c where c.id = s.supplier_id)) as bad_supplier,
      (s.supplier_unit_price is not null and (s.currency is null or s.currency !~ '^[A-Z]{3}$' or s.supplier_unit_price < 0)) as bad_price
    from (
      select (e ->> 'rfq_item_id')::uuid as rfq_item_id,
             nullif(e ->> 'quote_line_id', '')::uuid as quote_line_id,
             nullif(e ->> 'unit_price_net', '')::numeric as unit_price_net,
             nullif(e ->> 'qty', '')::numeric as qty,
             coalesce((e ->> 'is_service')::boolean, false) as is_service,
             coalesce((e ->> 'not_sourced')::boolean, false) as not_sourced,
             nullif(e ->> 'supplier_id', '')::uuid as supplier_id,
             upper(nullif(btrim(e ->> 'currency'), '')) as currency,
             nullif(e ->> 'supplier_unit_price', '')::numeric as supplier_unit_price,
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
      on ql.id = case when s.is_service or s.not_sourced or s.supplier_id is not null then null else coalesce(s.quote_line_id, sole.id) end
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
  from jsonb_to_recordset(v_rows) as r (description text, bad_typed boolean)
  where r.bad_typed;
  if v_bad is not null then
    raise exception 'a typed supplier cannot go with a quote line or a service: %', v_bad using errcode = '22023';
  end if;
  select string_agg(r.description, ', ') into v_bad
  from jsonb_to_recordset(v_rows) as r (description text, bad_supplier boolean)
  where r.bad_supplier;
  if v_bad is not null then
    raise exception 'the chosen supplier was not found: %', v_bad using errcode = '22023';
  end if;
  select string_agg(r.description, ', ') into v_bad
  from jsonb_to_recordset(v_rows) as r (description text, bad_price boolean)
  where r.bad_price;
  if v_bad is not null then
    raise exception 'a supplier price needs its currency and cannot be below 0: %', v_bad using errcode = '22023';
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
  if v_bad is null then
    -- The same for a supplier typed at Mark won: one item, one supplier, once.
    select string_agg(d.description, ', ') into v_bad
    from (
      select min(r.description) as description
      from jsonb_to_recordset(v_rows) as r (description text, rfq_item_id uuid, supplier_id uuid, is_service boolean)
      where r.supplier_id is not null and not r.is_service
      group by r.rfq_item_id, r.supplier_id
      having count(*) > 1
    ) d;
  end if;
  if v_bad is not null then
    raise exception 'split parts of an item must use different suppliers: %', v_bad using errcode = '22023';
  end if;

  -- One RFQ is won once (checked after the payload checks, so a bad payload still gets its own message). Read under the lock.
  select * into v_live from public.orders o
  where o.rfq_id = p_rfq_id and o.cancelled_on is null
  order by o.created_at
  limit 1;
  if found then
    raise exception 'This RFQ is already order ORD-%.', lpad(v_live.number::text, 4, '0')
      using errcode = 'P0001', hint = 'rfq_has_order:' || v_live.id::text;
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

  -- Legs and items in one statement: one leg per (supplier, currency), with the supplier's inquiry when it was asked here; the items
  -- join to it by supplier and currency. A typed supplier with no price has no currency yet: its leg's currency stays empty.
  with src as (
    select * from jsonb_to_recordset(v_rows) as r (
      ord bigint, rfq_item_id uuid, description text, brand_id uuid, family_id uuid, qty numeric, unit text,
      unit_price_net numeric, gst_rate numeric, is_service boolean, supplier_unit_price numeric,
      currency char(3), inquiry_id uuid, supplier_id uuid)
  ),
  legs as (
    insert into public.supplier_orders (order_id, supplier_id, inquiry_id, currency)
    select p_order_id, s.supplier_id, (array_agg(s.inquiry_id order by s.ord) filter (where s.inquiry_id is not null))[1], s.currency
    from src s
    where s.supplier_id is not null and not s.is_service
    group by s.supplier_id, s.currency
    returning id, supplier_id, currency
  )
  insert into public.order_items (order_id, position, description, brand_id, family_id, qty, unit,
                                  unit_price_net, gst_rate, is_service, supplier_order_id, rfq_item_id,
                                  supplier_unit_price)
  select p_order_id, (s.ord - 1)::smallint, s.description, s.brand_id, s.family_id, s.qty, s.unit,
         s.unit_price_net, s.gst_rate, s.is_service, g.id, s.rfq_item_id, s.supplier_unit_price
  from src s
  left join legs g on not s.is_service and g.supplier_id = s.supplier_id and g.currency is not distinct from s.currency;

  return p_order_id;
end;
$$;

revoke all on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)
  to authenticated;
