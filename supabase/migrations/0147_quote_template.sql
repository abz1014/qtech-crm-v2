-- 0147_quote_template (owner, 25 Nov 2026): the quotation PDF follows the owner's own Excel template, and new quotations are
-- numbered the way the owner numbers them by hand: QTS-<customer code>-<running number>, for example QTS-IFL-4810.
--
--   companies.quote_code          The customer's short code (2 to 6 capital letters, unique). Typed in lower case or with spaces it
--                                 is stored trimmed and upper-cased. Set and changed by admin and sales only (an engineer's change
--                                 is refused, 42501). The app suggests one from the name's initials.
--   quotations.quote_code         The customer code frozen on the quotation at its first issue, and carried by every revision. NULL
--                                 on every quotation issued before this migration: those keep their QT-YY-NNNN numbers.
--   company_profile               quote_next_number (default 4810: the owner's last hand-made quote was QTS-IFL-4809), the floor of
--                                 the running number, set by an admin in Settings, Company. sales_email and sales_phone (the
--                                 signature block's email and cell number), quotation_warranty and quotation_closing (the two
--                                 standard paragraphs under the terms, with the template's wording as their defaults).
--   issue_quotation               A first issue for a customer WITH a quote code takes the running number: the larger of
--                                 quote_next_number and one above the highest number any QTS quotation holds, under an advisory
--                                 lock so two issues at once cannot take the same number. The number is one sequence across all
--                                 customers. A customer with no code yet keeps the old numbering (the app asks for the code before
--                                 issuing, so this is only the fallback for other callers). A revision keeps the number and code of
--                                 the quotation it revises. Same signature and grants as 0094 (CREATE OR REPLACE).
--   uniqueness                    (number, revision) is unique within the old numbers and within the QTS numbers apart: an imported
--                                 old number may already be 4810 or more, and the two never meet on a document.
--   qtech_engineer (0081, 0108)   gets the new non-money columns like every other column, so the coverage checks hold.

-- ---------------------------------------------------------------- companies.quote_code
alter table public.companies add column quote_code text
  constraint companies_quote_code_check check (quote_code ~ '^[A-Z]{2,6}$');

create unique index companies_quote_code_key on public.companies (quote_code) where quote_code is not null;

comment on column public.companies.quote_code is
  'Customer code in quotation numbers (QTS-<code>-4810): 2 to 6 capital letters, unique. Set by admin and sales.';

create function public.companies_quote_code_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.quote_code := nullif(upper(btrim(new.quote_code)), '');
  if tg_op = 'INSERT' then
    if new.quote_code is null then
      return new;
    end if;
  elsif new.quote_code is not distinct from old.quote_code then
    return new;
  end if;
  -- No role (the service role, a migration, an import) is not a person: only an engineer's change is refused.
  if public.current_user_role() is not null and public.current_user_role() not in ('admin', 'sales') then
    raise exception 'a quote code is set by admin and sales only' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- a trigger function has no client grant (0025 item 2); the trigger still fires
revoke all on function public.companies_quote_code_guard() from public, anon, authenticated;

create trigger companies_quote_code_guard before insert or update on public.companies
  for each row execute function public.companies_quote_code_guard();

-- ---------------------------------------------------------------- quotations.quote_code
alter table public.quotations add column quote_code text
  constraint quotations_quote_code_check check (quote_code ~ '^[A-Z]{2,6}$');

comment on column public.quotations.quote_code is
  'The customer code at the first issue (QTS-<code>-<number>). NULL: an older quotation, shown as QT-YY-NNNN.';

alter table public.quotations drop constraint quotations_number_revision_key;
create unique index quotations_number_revision_key on public.quotations (number, revision) where quote_code is null;
create unique index quotations_qts_number_revision_key on public.quotations (number, revision) where quote_code is not null;

-- ---------------------------------------------------------------- company_profile
alter table public.company_profile
  add column quote_next_number integer not null default 4810
    constraint company_profile_quote_next_number_check check (quote_next_number between 1 and 999999999),
  add column sales_email text,
  add column sales_phone text,
  add column quotation_warranty text default
    'One year warranty against any manufacturing defects from the date of supply; in this case we will rectify the issue and may '
    'provide you free of cost replacement where applicable. Our liability excludes due to natural wear & tear, defects arising '
    'after transfer of risk owning etc., contrary to manuals and instructions, mishandling or negligence on part of the customer.',
  add column quotation_closing text default
    'We hope that the above specification meets your requirement and we would be given opportunity to work with your esteemed '
    'organization to get order for these items.';

comment on column public.company_profile.quote_next_number is
  'The lowest running number the next new QTS quotation may take. issue_quotation takes this or one above the highest used, whichever is larger.';

-- ---------------------------------------------------------------- qtech_engineer: the new columns like every other non-money column
do $$
declare
  p text;
begin
  foreach p in array array['select', 'insert', 'update'] loop
    if has_table_privilege('authenticated', 'public.quotations', p) then
      execute format('grant %s (quote_code) on table public.quotations to qtech_engineer', p);
    end if;
    if has_table_privilege('authenticated', 'public.company_profile', p) then
      execute format('grant %s (quote_next_number, sales_email, sales_phone, quotation_warranty, quotation_closing) on table public.company_profile to qtech_engineer', p);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------- issue_quotation
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
  v_code     text;
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
    -- 0147: a revision keeps the number AND the code (an old QT-YY-NNNN quotation stays old, a QTS one stays QTS)
    v_number := v_prev.number;
    v_revision := v_prev.revision + 1;
    v_code := v_prev.quote_code;
  else
    v_revision := 0;
    select c.quote_code into v_code from public.companies c where c.id = v_rfq.company_id;
    if v_code is null then
      -- 0147: no customer code yet, so the old numbering (the app asks for the code before it issues)
      v_number := nextval('public.quotation_number_seq');
    else
      -- 0147: the running number, one sequence across every customer. The lock makes two first issues at once wait for each other.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('qtech.quote_ref_number'));
      select greatest(coalesce((select p.quote_next_number from public.company_profile p where p.id = 1), 4810),
                      coalesce((select max(q.number) + 1 from public.quotations q where q.quote_code is not null), 0))
      into v_number;
    end if;
  end if;

  select p.quotation_validity_days into v_days from public.company_profile p where p.id = 1;

  insert into public.quotations (id, rfq_id, number, revision, quote_code, issued_on, valid_until, contact_id, lines,
                                 net_total, gst_total, delivery_text, payment_terms, notes)
  values (p_quotation_id, p_rfq_id, v_number, v_revision, v_code, v_issued,
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
