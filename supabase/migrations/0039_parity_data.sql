-- 0039_parity_data (A7 parity fields): the optional data the approved mockups show and the schema lacked. Every column is nullable and
-- nothing is required of anyone (FE-2): a screen shows the value when it is there and nothing when it is not.
--
--   contacts.job_title          "Procurement Manager" under a contact's name (quotation "Attention", chase signatures)
--   companies.city              the mockups show a city, not only a country
--   rfqs.due_time               an optional bid deadline time ("17:00"); due_on stays the date
--   users.phone                 printed under a signature on chase texts and quotations. Editable by the person on their own row and by an
--                               admin on any row. Column-level: nothing else on users becomes writable (users stay service-role writes).
--   clarifications.rfq_item_id  the item a question is about (the item tag in the questions panel); SET NULL when the item goes
--   issue_quotation             a new optional p_item_ids uuid[]: issue a partial quotation. Only the included items need a price and are
--                               snapshotted. Omitted (NULL) means every item, exactly as before.

alter table public.contacts add column job_title text;
alter table public.companies add column city text;
alter table public.rfqs add column due_time time;
alter table public.users add column phone text;
alter table public.clarifications
  add column rfq_item_id uuid references public.rfq_items (id) on delete set null;
create index clarifications_item_idx on public.clarifications (rfq_item_id) where rfq_item_id is not null;

comment on column public.users.phone is 'Optional. Printed in signatures. Own row or admin may change it (column grant and policy 0039).';

-- ---------------------------------------------------------------- users.phone is the only writable column
grant update (phone) on table public.users to authenticated;

create policy users_update_phone on public.users for update to authenticated
  using (public.current_user_role() = 'admin' or (public.current_user_role() is not null and id = auth.uid()))
  with check (public.current_user_role() = 'admin' or (public.current_user_role() is not null and id = auth.uid()));

-- ---------------------------------------------------------------- issue_quotation with an item subset
drop function public.issue_quotation(uuid, uuid, date, uuid, text, text, text);

create function public.issue_quotation(
  p_quotation_id   uuid,
  p_rfq_id         uuid,
  p_valid_until    date default null,
  p_contact_id     uuid default null,
  p_delivery_text  text default null,
  p_payment_terms  text default null,
  p_notes          text default null,
  p_item_ids       uuid[] default null
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

  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'RFQ % not found', p_rfq_id using errcode = 'P0002';
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

revoke all on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.issue_quotation(uuid, uuid, date, uuid, text, text, text, uuid[]) to authenticated;
