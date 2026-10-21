-- 0084_issue_quotation_atomic (bug hunt HW-43, HW-3, HW-8): issuing a quotation writes its prices in the same transaction.
--
-- Before: the app updated rfq_items (price, GST rate, lead time) with one request per item, THEN called issue_quotation.
-- A refused issue (an overflowing total, a dropped connection) left prices on the RFQ that no quotation carried, and Mark
-- won then offered them (HW-43). The dialog's totals also used the quantities it had loaded, while issue_quotation
-- snapshotted the stored ones, so a quantity changed meanwhile went out at a total nobody saw (HW-3).
--
-- issue_quotation gets an optional p_lines jsonb: [{ "id", "unit_price", "gst_rate", "lead_time", "qty" }, ...]. With it:
--   * every line must be an item of this RFQ, at most once;
--   * "qty" is the quantity the person saw; when the stored quantity differs the issue is refused and NOTHING is written,
--     so the dialog can reload and show the real total;
--   * the unit price must be above zero (a free line on a customer quotation is a mistake, HW-8);
--   * the prices, rates and lead times are written and the revision is made in ONE transaction: any refusal (including
--     22003 numeric overflow of the totals) rolls the prices back.
-- p_item_ids defaults to the p_lines ids. Without p_lines it behaves exactly as 0039 (callers and tests that price items
-- first keep working).

drop function public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[]);

create function public.issue_quotation(
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

revoke all on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[], jsonb) to authenticated;
