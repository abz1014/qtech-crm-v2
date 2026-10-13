-- 0022_documents (S18, part 1): quotations and purchase_orders (DATA_MODEL sections 2.25 and 2.26, Amendments A2 and
-- A2b), their number sequences, the lock trigger, and the private generated-docs bucket (section 10).
-- Both tables are written only by the issue_* RPCs (0023). Everything except pdf_path is frozen after insert, and the
-- totals are recomputed from lines on every insert, so a total sent by a client is ignored.

create sequence public.quotation_number_seq;
create sequence public.po_number_seq;

grant usage on sequence public.quotation_number_seq, public.po_number_seq to authenticated;

-- ---------------------------------------------------------------- quotations [std]
create table public.quotations (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users (id) on delete restrict,
  -- An issued document blocks deletion of its RFQ.
  rfq_id         uuid not null references public.rfqs (id) on delete restrict,
  -- From quotation_number_seq on the first issue for the RFQ; re-issues reuse it. Shown as QT-YY-NNNN.
  number         integer not null,
  revision       smallint not null default 0 check (revision >= 0),
  issued_on      date not null default public.today_pkt(),
  valid_until    date not null,
  contact_id     uuid references public.contacts (id) on delete set null,
  -- Snapshot: rfq_item_id, description, qty, unit, unit_price_net, gst_rate, lead_time.
  lines          jsonb not null,
  net_total      numeric(14,2) not null,
  gst_total      numeric(14,2) not null,
  delivery_text  text,
  payment_terms  text,
  notes          text,
  signatory_id   uuid not null default auth.uid() references public.users (id) on delete restrict,
  pdf_path       text,
  constraint quotations_number_revision_key unique (number, revision),
  constraint quotations_rfq_revision_key unique (rfq_id, revision),
  constraint quotations_lines_nonempty check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0)
);

comment on table public.quotations is
  'Issued customer quotations. Frozen after insert except pdf_path. Issue only through issue_quotation().';

create index quotations_contact_idx on public.quotations (contact_id) where contact_id is not null;
create index quotations_signatory_idx on public.quotations (signatory_id);

-- ---------------------------------------------------------------- purchase_orders [std]
create table public.purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references public.users (id) on delete restrict,
  supplier_order_id  uuid not null references public.supplier_orders (id) on delete restrict,
  -- From po_number_seq on the first issue for the leg. Shown as PO-YY-NNNN.
  number             integer not null,
  revision           smallint not null default 0 check (revision >= 0),
  issued_on          date not null default public.today_pkt(),
  -- A frozen copy of supplier_orders.currency at issue, not a second source of truth.
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Snapshot: order_item_id, description, qty, unit, unit_price, price_source (order / quote / last_po / typed).
  lines              jsonb not null,
  total              numeric(14,2) not null,
  incoterm           text,
  delivery_terms     text,
  payment_terms      text,
  ship_to            text,
  notes              text,
  signatory_id       uuid not null default auth.uid() references public.users (id) on delete restrict,
  pdf_path           text,
  constraint purchase_orders_number_revision_key unique (number, revision),
  constraint purchase_orders_leg_revision_key unique (supplier_order_id, revision),
  constraint purchase_orders_lines_nonempty check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0)
);

comment on table public.purchase_orders is
  'Issued supplier POs. Frozen after insert except pdf_path. Issue only through issue_purchase_order().';

create index purchase_orders_signatory_idx on public.purchase_orders (signatory_id);

-- ---------------------------------------------------------------- triggers
-- Totals are never taken from the client: recomputed from lines on insert. Line net = round(qty x price, 2); the
-- quotation's GST is rounded to whole rupees per line, as for order items (section 2.13).
create function public.quotation_set_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.lines) = 'array' then
    select coalesce(sum(round((e ->> 'qty')::numeric * (e ->> 'unit_price_net')::numeric, 2)), 0),
           coalesce(sum(round(round((e ->> 'qty')::numeric * (e ->> 'unit_price_net')::numeric, 2)
                              * (e ->> 'gst_rate')::numeric / 100, 0)), 0)
    into new.net_total, new.gst_total
    from jsonb_array_elements(new.lines) e;
  end if;
  return new;
end;
$$;

create function public.purchase_order_set_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.lines) = 'array' then
    select coalesce(sum(round((e ->> 'qty')::numeric * (e ->> 'unit_price')::numeric, 2)), 0)
    into new.total
    from jsonb_array_elements(new.lines) e;
  end if;
  return new;
end;
$$;

-- An issued document may change only its pdf_path (NULL means "generate the PDF again").
create function public.lock_issued_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'pdf_path') is distinct from (to_jsonb(old) - 'pdf_path') then
    raise exception 'an issued % cannot be changed; issue a new revision', tg_table_name
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger quotations_set_totals before insert on public.quotations
  for each row execute function public.quotation_set_totals();
create trigger purchase_orders_set_total before insert on public.purchase_orders
  for each row execute function public.purchase_order_set_total();
create trigger quotations_lock before update on public.quotations
  for each row execute function public.lock_issued_document();
create trigger purchase_orders_lock before update on public.purchase_orders
  for each row execute function public.lock_issued_document();

create trigger quotations_audit after insert or update or delete on public.quotations
  for each row execute function public.audit_row_change();
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- grants and RLS
alter table public.quotations      enable row level security;
alter table public.purchase_orders enable row level security;

revoke all on table public.quotations, public.purchase_orders from public, anon, authenticated;
grant select, insert, update, delete on table public.quotations, public.purchase_orders to authenticated;

-- Section 10: SIUD admin, SIU for sales and engineers (UPDATE is limited to pdf_path by the lock trigger).
create policy quotations_select_staff on public.quotations for select to authenticated
  using (public.current_user_role() is not null);
create policy quotations_insert_staff on public.quotations for insert to authenticated
  with check (public.current_user_role() is not null);
create policy quotations_update_staff on public.quotations for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy quotations_delete_admin on public.quotations for delete to authenticated
  using (public.current_user_role() = 'admin');

create policy purchase_orders_select_staff on public.purchase_orders for select to authenticated
  using (public.current_user_role() is not null);
create policy purchase_orders_insert_staff on public.purchase_orders for insert to authenticated
  with check (public.current_user_role() is not null);
create policy purchase_orders_update_staff on public.purchase_orders for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy purchase_orders_delete_admin on public.purchase_orders for delete to authenticated
  using (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------- generated-docs bucket
-- Private. Section 10: SIUD admin, SIU sales and engineers. So the bucket is open to every active user, and
-- deleting objects in it is admin only (the delete policy is recreated below).
insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-docs', 'generated-docs', false, 5242880)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.can_access_bucket(bucket text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case bucket
    when 'rfq-files'       then public.current_user_role() is not null
    when 'gst-receipts'    then public.current_user_role() in ('admin', 'sales')
    when 'generated-docs'  then public.current_user_role() is not null
    else false
  end
$$;

drop policy qtech_objects_delete on storage.objects;
create policy qtech_objects_delete on storage.objects for delete to authenticated
  using (
    public.can_access_bucket(bucket_id)
    and (bucket_id <> 'generated-docs' or public.current_user_role() = 'admin')
  );
