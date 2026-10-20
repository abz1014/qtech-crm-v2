-- 0070_rfq_screens (UX overhaul of the RFQ screens, review of ux/rfqs): two things the screens need from the database.
--
--  1. float_rfq says whether it created the RFQ. It was idempotent by id and returned the id either way, so a New RFQ draft that
--     had already been saved (in another tab, or by a save whose reply was lost) "saved" again silently: nothing new was written
--     and the screen claimed it had. It now returns {"id": <uuid>, "created": true|false}. A second call with the same id still
--     writes nothing (the double tap and the retry stay safe); the screen reads created = false and says "Already saved as RFQ-…".
--     The return type changes, so the function is dropped and recreated with the same arguments and grants.
--
--  2. search_closed_rfqs(p_text, p_limit, p_offset): the RFQ list's Closed search, over EVERY won and closed RFQ (the list showed
--     25 at a time and its filter only saw that page). Each word of the text must appear somewhere: the company name, the
--     customer's reference, the number ("RFQ-0177" or "177") or an item description. Won and closed are picked BEFORE paging, so a
--     busy customer's open RFQs cannot push old closed ones out. The text is a bound parameter matched with position(), so % _ , ( )
--     and quotes are plain characters. Newest received first, then the higher number; one page at a time with the total.
--     "Won" and "closed" read exactly as v_rfq_state's outcome does (a live order, else closed_on), from the base tables, so the
--     search does not compute the whole state view. SECURITY INVOKER: the caller's row security applies (a deactivated person
--     gets nothing), like search_all.

drop function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean, boolean);

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
returns jsonb
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
    return jsonb_build_object('id', p_rfq_id, 'created', false);
  end if;

  insert into public.rfqs (id, company_id, site_id, contact_id, customer_ref, due_on, is_priority)
  values (p_rfq_id, p_company_id, p_site_id, p_contact_id, nullif(btrim(p_customer_ref), ''), p_due_on,
          coalesce(p_is_priority, false))
  on conflict (id) do nothing
  returning id into v_inserted;
  if v_inserted is null then
    return jsonb_build_object('id', p_rfq_id, 'created', false);
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

  return jsonb_build_object('id', p_rfq_id, 'created', true);
end;
$$;

revoke all on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.float_rfq(uuid, uuid, jsonb, uuid[], uuid, uuid, text, date, boolean, boolean)
  to authenticated;

create function public.search_closed_rfqs(p_text text, p_limit integer default 25, p_offset integer default 0)
returns table (rfq_id uuid, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with words as (
    select distinct w
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_text, ''))), '\s+')) as w
    where w <> ''
  ),
  closed as (
    select r.id, r.received_on, r.number,
           lower(concat_ws(' ', c.name, r.customer_ref, 'rfq-' || case when length(r.number::text) >= 4 then r.number::text else lpad(r.number::text, 4, '0') end, r.number::text)) as hay
    from public.rfqs r
    join public.companies c on c.id = r.company_id
    where r.closed_on is not null
       or exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null)
  ),
  hits as (
    select k.id, k.received_on, k.number
    from closed k
    where not exists (
      select 1 from words
      where position(words.w in k.hay) = 0
        and not exists (select 1 from public.rfq_items i where i.rfq_id = k.id and position(words.w in lower(i.description)) > 0)
    )
  )
  select h.id, count(*) over ()
  from hits h
  order by h.received_on desc, h.number desc
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.search_closed_rfqs(text, integer, integer) is
  'The RFQ list''s Closed search: won and closed RFQs whose company, customer reference, number or item text holds every word, newest first, one page with the total (0070).';

revoke all on function public.search_closed_rfqs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_closed_rfqs(text, integer, integer) to authenticated;
