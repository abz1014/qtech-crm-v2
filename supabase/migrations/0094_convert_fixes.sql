-- 0094_convert_fixes (bug hunt HW-46, HW-47, HW-60; job flow hunt, branch hunt/jobflow): Mark won and Create order.
--
--   HW-46  issue_quotation clears rfq_items.quoted_unit_price_net (and quoted_lead_time) of every item the new revision leaves out,
--          so an item dropped from a revision does not keep the earlier revision's price. Same signature as 0083.
--   HW-47  convert_rfq_to_order honours "Not sourced yet": an entry with "not_sourced": true gets no quote line, however many
--          quotes the item has (before, the rank-1 quote was used whenever no quote_line_id was named, 0077 coalesce(..., sole.id)).
--          An entry without the marker behaves as before (the sole rank-1 quote is inferred), so older callers are unchanged.
--   HW-60  convert_rfq_to_order gets p_expected_revision (the latest quotation revision the dialog was opened on) and each entry may
--          carry "expected_qty" (the RFQ quantity the dialog showed). If the latest revision or a quantity differs, nothing is written and
--          the call is refused: P0001 "The quotation changed since you opened this. Review again." hint convert_stale. Null = no check.
--   The signature of convert_rfq_to_order grows by one defaulted parameter, so the 7-argument function is dropped first (a second
--   overload would make a named-argument call ambiguous). Grants are as before: authenticated only, so qtech_engineer (0081) still
--   cannot run it. 0093 (supplier categories) is not depended on.

drop function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean);

create function public.convert_rfq_to_order(
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
      ql.unit_price as supplier_unit_price,
      ql.currency as currency,
      ql.inquiry_id,
      si.supplier_id,
      (s.is_service = false and not s.not_sourced and s.quote_line_id is not null and ql.id is null) as bad_quote_line
    from (
      select (e ->> 'rfq_item_id')::uuid as rfq_item_id,
             nullif(e ->> 'quote_line_id', '')::uuid as quote_line_id,
             nullif(e ->> 'unit_price_net', '')::numeric as unit_price_net,
             nullif(e ->> 'qty', '')::numeric as qty,
             coalesce((e ->> 'is_service')::boolean, false) as is_service,
             coalesce((e ->> 'not_sourced')::boolean, false) as not_sourced,
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
      on ql.id = case when s.is_service or s.not_sourced then null else coalesce(s.quote_line_id, sole.id) end
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

revoke all on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.convert_rfq_to_order(uuid, uuid, jsonb, text, date, integer, boolean, integer)
  to authenticated;

create or replace function public.issue_quotation(
  p_quotation_id   uuid,
  p_rfq_id         uuid,
  p_valid_until    date default null,
  p_contact_id     uuid default null,
  p_delivery_text  text default null,
  p_payment_terms  text default null,
  p_notes          text default null,
  p_item_ids       uuid[] default null,
  p_lines          jsonb default null
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
  v_bad      record;
begin
  perform pg_catalog.set_config('qtech.entered_by_bypass', 'on', true);   -- 0092: workflow write, not an edit of somebody's entry (keep it)
  if p_quotation_id is null or p_rfq_id is null then
    raise exception 'issue_quotation needs a quotation id and an RFQ id' using errcode = '22023';
  end if;
  if exists (select 1 from public.quotations where id = p_quotation_id) then
    return p_quotation_id;
  end if;

  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
  end if;

  -- ---------------------------------------------------------------- the prices, written in this transaction
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'the RFQ has no items to quote' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) l
      where not exists (select 1 from public.rfq_items i where i.id = (l ->> 'id')::uuid and i.rfq_id = p_rfq_id)
    ) or (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct l ->> 'id') from jsonb_array_elements(p_lines) l) then
      raise exception 'an item to quote does not belong to this RFQ' using errcode = '22023';
    end if;

    -- The quantity the person saw must still be the stored one. The items are locked first, so none can change before the snapshot.
    perform 1 from public.rfq_items i where i.rfq_id = p_rfq_id order by i.id for update;
    select i.description, i.qty into v_bad
    from jsonb_array_elements(p_lines) l
    join public.rfq_items i on i.id = (l ->> 'id')::uuid
    where l ? 'qty' and l ->> 'qty' is not null and i.qty <> (l ->> 'qty')::numeric
    order by i.position, i.created_at
    limit 1;
    if found then
      raise exception 'the quantity of % changed to % since this quotation was opened', v_bad.description, trim(trailing '.' from trim(trailing '0' from v_bad.qty::text))
        using errcode = '22023';
    end if;

    select string_agg(i.description, ', ' order by i.position, i.created_at) into v_missing
    from jsonb_array_elements(p_lines) l
    join public.rfq_items i on i.id = (l ->> 'id')::uuid
    where l ->> 'unit_price' is null or (l ->> 'unit_price')::numeric <= 0;
    if v_missing is not null then
      raise exception 'a quoted price above zero is needed for: %', v_missing using errcode = '22023';
    end if;

    update public.rfq_items i
    set quoted_unit_price_net = (l ->> 'unit_price')::numeric,
        gst_rate              = coalesce((l ->> 'gst_rate')::numeric, i.gst_rate),
        quoted_lead_time      = nullif(btrim(l ->> 'lead_time'), '')
    from jsonb_array_elements(p_lines) l
    where i.id = (l ->> 'id')::uuid and i.rfq_id = p_rfq_id;

    if p_item_ids is null then
      select array_agg((l ->> 'id')::uuid) into p_item_ids from jsonb_array_elements(p_lines) l;
    end if;
  end if;

  -- A subset may only name items of this RFQ, and may not be empty.
  if p_item_ids is not null then
    if cardinality(p_item_ids) = 0 then
      raise exception 'the RFQ has no items to quote' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_item_ids) x (id)
      where not exists (select 1 from public.rfq_items i where i.id = x.id and i.rfq_id = p_rfq_id)
    ) then
      raise exception 'an item to quote does not belong to this RFQ' using errcode = '22023';
    end if;
  end if;

  -- HW-46: an item this revision leaves out is no longer quoted. Its price and lead time from an earlier revision are cleared, so
  -- Mark won, the order and the repeat-order memory do not sell it at a price the current quotation does not carry.
  if p_item_ids is not null then
    update public.rfq_items i
    set quoted_unit_price_net = null, quoted_lead_time = null
    where i.rfq_id = p_rfq_id
      and i.id <> all (p_item_ids)
      and (i.quoted_unit_price_net is not null or i.quoted_lead_time is not null);
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
  where i.rfq_id = p_rfq_id
    and (p_item_ids is null or i.id = any (p_item_ids));
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
