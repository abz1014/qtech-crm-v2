-- 0019_order_rpcs (S13, part 1): float_rfq, convert_rfq_to_order, create_repeat_order, merge_companies,
-- merge_brands, resolve_value_basis. DATA_MODEL section 4 (transactional RPCs), Revision 1, Amendments A2b and A3.
--
-- Every function is SECURITY INVOKER with search_path = '': the caller's own row security applies, so a
-- multi-row write can never reach further than the caller could by hand. Admin-only functions check
-- current_user_role() themselves, because "invoker" alone does not make them admin-only (companies and brands
-- are writable by every staff role). None of these functions touches order_costs.
--
-- Entry burden (Amendment A3): parameters are the true minimum. The only required ones are the
-- client-generated id and the source record; dates default to today in Karachi, and everything that
-- can be inferred from the source record is copied instead of asked for.
--
-- Idempotency: the client generates the new record's id. A second call with an id that already exists
-- returns it unchanged and writes nothing, so a double submit yields one record.

-- ---------------------------------------------------------------- float_rfq
-- Atomic intake: the RFQ, its items and one supplier_inquiries row per chosen supplier, then sent_on is
-- stamped (today) when p_mark_sent. No supplier chosen means "save only". Undo is a plain update of sent_on to NULL.
--   p_items  [{"description": "...", "qty": 2, "unit": "pcs", "brand_id": uuid, "family_id": uuid,
--              "gst_rate": 18}] - only description is required (qty defaults to 1, gst_rate to 18).
-- A customer_ref that already exists for the company violates rfqs_company_customer_ref_key (23505) rather
-- than creating a duplicate RFQ; the client opens the existing one.
create function public.float_rfq(
  p_rfq_id        uuid,
  p_company_id    uuid,
  p_items         jsonb,
  p_supplier_ids  uuid[] default '{}',
  p_site_id       uuid default null,
  p_contact_id    uuid default null,
  p_customer_ref  text default null,
  p_due_on        date default null,
  p_mark_sent     boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted uuid;
begin
  if p_rfq_id is null or p_company_id is null then
    raise exception 'float_rfq needs an RFQ id and a company' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'float_rfq needs at least one item' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where nullif(btrim(e ->> 'description'), '') is null) then
    raise exception 'every item needs a description' using errcode = '22023';
  end if;

  if exists (select 1 from public.rfqs where id = p_rfq_id) then
    return p_rfq_id;
  end if;

  insert into public.rfqs (id, company_id, site_id, contact_id, customer_ref, due_on)
  values (p_rfq_id, p_company_id, p_site_id, p_contact_id, nullif(btrim(p_customer_ref), ''), p_due_on)
  on conflict (id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return p_rfq_id;
  end if;

  insert into public.rfq_items (rfq_id, position, description, brand_id, family_id, qty, unit, gst_rate)
  select p_rfq_id,
         (t.ord - 1)::smallint,
         btrim(t.e ->> 'description'),
         nullif(t.e ->> 'brand_id', '')::uuid,
         nullif(t.e ->> 'family_id', '')::uuid,
         coalesce(nullif(t.e ->> 'qty', '')::numeric, 1),
         nullif(btrim(t.e ->> 'unit'), ''),
         coalesce(nullif(t.e ->> 'gst_rate', '')::numeric, 18)
  from jsonb_array_elements(p_items) with ordinality as t (e, ord);

  insert into public.supplier_inquiries (rfq_id, supplier_id, sent_on)
  select p_rfq_id, s.supplier_id, case when p_mark_sent then public.today_pkt() end
  from (select distinct unnest(coalesce(p_supplier_ids, '{}'::uuid[])) as supplier_id) s
  where s.supplier_id is not null;

  return p_rfq_id;
end;
$$;

revoke all on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean)
  from public, anon, authenticated;
grant execute on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean)
  to authenticated;

-- ---------------------------------------------------------------- convert_rfq_to_order
-- Creates the order, its legs and its items from an RFQ. One RFQ may produce several orders, so p_items may
-- name a subset of the RFQ's items; omitted means all of them.
--   p_items  [{"rfq_item_id": uuid, "quote_line_id": uuid, "unit_price_net": 123.45, "qty": 2,
--              "is_service": false}] - only rfq_item_id is required.
-- Inferred when not given:
--   quote line       the item's only supplier quote line, if it has exactly one; otherwise none (the item
--                    is left unsourced for the UI to fill; with several lines the lowest depends on FX, which
--                    the client compares). is_service lines never take a quote line.
--   unit_price_net   rfq_items.quoted_unit_price_net; an item with neither is rejected (a zero price would
--                    silently corrupt margin).
--   qty              rfq_items.qty
--   payment terms    the company's most recent order that has terms
--   ordered_on       today (Karachi)
-- Copied from the RFQ: company, site, contact, owner (carried across, Amendment A3-4), and per item: description,
-- brand, family, unit, gst_rate and the lineage rfq_item_id. From the chosen quote line: supplier_unit_price and
-- the leg currency (Amendment A2b). Legs are grouped by (inquiry, currency), so one leg is one supplier in one currency.
create function public.convert_rfq_to_order(
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
  if v_rfq.closed_on is not null then
    raise exception 'RFQ is closed; reopen it before converting it to an order' using errcode = '23514';
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
    left join lateral (
      select (array_agg(l.id))[1] as id
      from public.supplier_quote_lines l
      where l.rfq_item_id = ri.id
      having count(*) = 1
    ) sole on true
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

-- ---------------------------------------------------------------- create_repeat_order
-- "Same as last year": copies the source order's company, site, contact, terms, commissioning flag, items with
-- their last selling and purchase prices, and the legs (supplier and currency) that supplied them. The new order has
-- no RFQ, today's date and no PO number unless given; the owner is the caller (the person logging the repeat).
-- Leg dates, references and inquiry links are not copied: the goods have not been ordered yet.
create function public.create_repeat_order(
  p_order_id            uuid,
  p_from_order_id       uuid,
  p_customer_po_number  text default null,
  p_ordered_on          date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src      public.orders;
  v_inserted uuid;
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
                                  unit_price_net, gst_rate, is_service, supplier_order_id, supplier_unit_price)
  select p_order_id, i.position, i.description, i.brand_id, i.family_id, i.qty, i.unit,
         i.unit_price_net, i.gst_rate, i.is_service, m.new_id, i.supplier_unit_price
  from public.order_items i
  left join map m on m.old_id = i.supplier_order_id
  where i.order_id = p_from_order_id;

  return p_order_id;
end;
$$;

revoke all on function public.create_repeat_order(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.create_repeat_order(uuid, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------- merge_companies (admin)
-- Moves every reference to p_drop onto p_keep, then deletes p_drop. References are discovered from the
-- catalog (every single-column foreign key to companies), so a table added later is covered without editing this
-- function. Sites with the same name merge into one (their contacts, RFQs and orders follow), and duplicate
-- company_brands rows collapse. Rows that would break a unique rule (the same RFQ sent to both companies, the same
-- customer RFQ number or PO number under both) are refused with a message instead of being dropped: resolve them by hand first.
create function public.merge_companies(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  s record;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can merge companies' using errcode = '42501';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'merge needs two different companies' using errcode = '22023';
  end if;
  if (select count(*) from public.companies where id in (p_keep, p_drop)) <> 2 then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.supplier_inquiries a join public.supplier_inquiries b on b.rfq_id = a.rfq_id
             where a.supplier_id = p_keep and b.supplier_id = p_drop) then
    raise exception 'merge conflict: both companies were sent the same RFQ as supplier' using errcode = '23505';
  end if;
  if exists (select 1 from public.rfqs a join public.rfqs b on b.customer_ref = a.customer_ref
             where a.company_id = p_keep and b.company_id = p_drop) then
    raise exception 'merge conflict: both companies have an RFQ with the same customer reference'
      using errcode = '23505';
  end if;
  if exists (select 1 from public.orders a join public.orders b on b.customer_po_number = a.customer_po_number
             where a.company_id = p_keep and b.company_id = p_drop
               and not ('po_shared' = any (a.legacy_flags)) and not ('po_shared' = any (b.legacy_flags))) then
    raise exception 'merge conflict: both companies have an order with the same customer PO number'
      using errcode = '23505';
  end if;

  -- Sites with the same name become one site.
  for s in
    select d.id as drop_site, k.id as keep_site
    from public.company_sites d
    join public.company_sites k on lower(btrim(k.name)) = lower(btrim(d.name))
    where d.company_id = p_drop and k.company_id = p_keep
  loop
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'public.company_sites'::regclass and cardinality(c.conkey) = 1
    loop
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using s.keep_site, s.drop_site;
    end loop;
    delete from public.company_sites where id = s.drop_site;
  end loop;

  delete from public.company_brands d
  where d.company_id = p_drop
    and exists (select 1 from public.company_brands k where k.company_id = p_keep and k.brand_id = d.brand_id);

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.companies'::regclass and cardinality(c.conkey) = 1
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_drop;
  end loop;

  delete from public.companies where id = p_drop;
end;
$$;

revoke all on function public.merge_companies(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_companies(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- merge_brands (admin)
-- As merge_companies, for brands and families. Both must be the same kind, because family_id may only point at a family.
create function public.merge_brands(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can merge brands' using errcode = '42501';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'merge needs two different brands' using errcode = '22023';
  end if;
  if (select count(*) from public.brands where id in (p_keep, p_drop)) <> 2 then
    raise exception 'brand not found' using errcode = 'P0002';
  end if;
  if (select count(distinct kind) from public.brands where id in (p_keep, p_drop)) <> 1 then
    raise exception 'a brand and a family cannot be merged' using errcode = '22023';
  end if;

  delete from public.company_brands d
  where d.brand_id = p_drop
    and exists (select 1 from public.company_brands k where k.brand_id = p_keep and k.company_id = d.company_id);

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.brands'::regclass and cardinality(c.conkey) = 1
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_drop;
  end loop;

  delete from public.brands where id = p_drop;
end;
$$;

revoke all on function public.merge_brands(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_brands(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- resolve_value_basis (admin)
-- Legacy orders flagged value_basis_unknown get their item prices rewritten and the flag cleared (section 2.12).
--   'net'    the stored prices were already ex-GST: only the flag is cleared
--   'gross'  the stored prices include GST: each unit_price_net is divided by 1 + gst_rate / 100 (2 decimals)
-- A second call is refused (the flag is gone), so a retry cannot divide twice.
create function public.resolve_value_basis(p_order_id uuid, p_basis text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can resolve a value basis' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('net', 'gross') then
    raise exception 'basis must be net or gross' using errcode = '22023';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and 'value_basis_unknown' = any (legacy_flags)) then
    raise exception 'the order has no unresolved value basis' using errcode = '22023';
  end if;

  if p_basis = 'gross' then
    update public.order_items
    set unit_price_net = round(unit_price_net / (1 + gst_rate / 100), 2)
    where order_id = p_order_id;
  end if;

  update public.orders
  set legacy_flags = array_remove(legacy_flags, 'value_basis_unknown')
  where id = p_order_id;
end;
$$;

revoke all on function public.resolve_value_basis(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_value_basis(uuid, text) to authenticated;
