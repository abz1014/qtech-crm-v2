-- 0030_float_undo (R05): the intake screen's "top priority" tick and the atomic Undo of a float.
--
--  1. float_rfq gains a trailing p_is_priority (default false). The signature changes, so the old nine-argument
--     function is dropped and recreated; every existing call (named or positional) still resolves, because the new
--     argument is last and defaulted.
--  2. set_rfq_floated(p_rfq_id, p_floated): the one statement behind "Undo" and "float it now".
--       p_floated = false  undoes a float: sent_on goes back to NULL (the "shortlisted" state) on the inquiries that
--                          were stamped TODAY and have not moved on since (no chase, no relay, no no-offer, no quote
--                          line). Anything that has already happened is left alone, so an Undo can never erase
--                          history. One UPDATE, so it is all or nothing.
--       p_floated = true   stamps today on every shortlisted inquiry (sent_on NULL, no no-offer recorded), for an RFQ
--                          that was saved without floating or whose float was undone.
--     Returns the number of inquiries changed. SECURITY INVOKER like the other order RPCs: the caller's own row
--     security applies (staff may update supplier_inquiries; DATA_MODEL section 10).

drop function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean);

create function public.float_rfq(
  p_rfq_id        uuid,
  p_company_id    uuid,
  p_items         jsonb,
  p_supplier_ids  uuid[] default '{}',
  p_site_id       uuid default null,
  p_contact_id    uuid default null,
  p_customer_ref  text default null,
  p_due_on        date default null,
  p_mark_sent     boolean default true,
  p_is_priority   boolean default false
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

  insert into public.rfqs (id, company_id, site_id, contact_id, customer_ref, due_on, is_priority)
  values (p_rfq_id, p_company_id, p_site_id, p_contact_id, nullif(btrim(p_customer_ref), ''), p_due_on,
          coalesce(p_is_priority, false))
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

revoke all on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean, boolean)
  to authenticated;

create function public.set_rfq_floated(p_rfq_id uuid, p_floated boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_rfq_id is null or p_floated is null then
    raise exception 'set_rfq_floated needs an RFQ id and true or false' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rfqs where id = p_rfq_id) then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
  end if;

  if p_floated then
    update public.supplier_inquiries i
    set sent_on = public.today_pkt()
    where i.rfq_id = p_rfq_id and i.sent_on is null and i.no_offer_on is null;
  else
    update public.supplier_inquiries i
    set sent_on = null
    where i.rfq_id = p_rfq_id
      and i.sent_on = public.today_pkt()
      and i.no_offer_on is null
      and i.last_chased_on is null
      and i.chase_count = 0
      and i.last_relayed_at is null
      and not exists (select 1 from public.supplier_quote_lines q where q.inquiry_id = i.id);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.set_rfq_floated(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_rfq_floated(uuid, boolean) to authenticated;
