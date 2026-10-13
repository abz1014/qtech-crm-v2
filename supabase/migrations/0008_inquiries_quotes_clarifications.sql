-- 0008_inquiries_quotes_clarifications (S04, part 2): DATA_MODEL sections 2.9-2.11 plus the brand
-- auto-learn trigger from section 2.6. Amendment A3: clarifications may carry an answer only
-- once answered_at is set, but answered_at may be set without answer text.
-- The fx_rate_pkr / fx_rate_on columns and their capture trigger belong to S17 (they need v_fx_latest).

-- ---------------------------------------------------------------- supplier_inquiries [std][L]
create table public.supplier_inquiries (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references public.users (id) on delete restrict,
  rfq_id           uuid not null references public.rfqs (id) on delete cascade,
  supplier_id      uuid not null references public.companies (id) on delete restrict,
  sent_on          date,
  last_chased_on   date,
  no_offer_on      date,
  last_relayed_at  timestamptz,
  notes            text,
  chase_count      smallint not null default 0 check (chase_count >= 0),
  legacy_flags     text[] not null default '{}',
  legacy_source    jsonb,
  constraint supplier_inquiries_rfq_supplier_key unique (rfq_id, supplier_id)
);

comment on column public.supplier_inquiries.sent_on is
  'NULL means shortlisted but not yet sent; staff may delete the row only while it is NULL.';

create index supplier_inquiries_supplier_idx on public.supplier_inquiries (supplier_id);

-- ---------------------------------------------------------------- supplier_quote_lines [std][L]
create table public.supplier_quote_lines (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users (id) on delete restrict,
  inquiry_id     uuid not null references public.supplier_inquiries (id) on delete cascade,
  rfq_item_id    uuid not null references public.rfq_items (id) on delete cascade,
  unit_price     numeric(14,4) not null check (unit_price > 0),
  -- No default on purpose: a hardcoded PKR is the bug this kills.
  currency       char(3) not null check (currency ~ '^[A-Z]{3}$'),
  lead_time      text,
  origin         text,
  in_stock       boolean,
  notes          text,
  legacy_flags   text[] not null default '{}',
  legacy_source  jsonb,
  constraint supplier_quote_lines_inquiry_item_key unique (inquiry_id, rfq_item_id)
);

create index supplier_quote_lines_item_idx on public.supplier_quote_lines (rfq_item_id);

-- ---------------------------------------------------------------- clarifications [std]
create table public.clarifications (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  created_by             uuid default auth.uid() references public.users (id) on delete restrict,
  rfq_id                 uuid not null references public.rfqs (id) on delete cascade,
  raised_by_inquiry_id   uuid references public.supplier_inquiries (id) on delete set null,
  question               text not null,
  first_asked_at         timestamptz,
  last_asked_at          timestamptz,
  ask_count              smallint not null default 0 check (ask_count >= 0),
  answer                 text,
  answered_at            timestamptz,
  withdrawn_at           timestamptz,
  -- Amendment A3: an answer needs its timestamp; the timestamp alone is fine (answered by phone).
  constraint clarifications_answer_has_time check (answer is null or answered_at is not null),
  constraint clarifications_not_answered_and_withdrawn check (answered_at is null or withdrawn_at is null),
  constraint clarifications_asked_order check (last_asked_at >= first_asked_at)
);

create index clarifications_rfq_idx on public.clarifications (rfq_id);
create index clarifications_inquiry_idx on public.clarifications (raised_by_inquiry_id)
  where raised_by_inquiry_id is not null;

-- ---------------------------------------------------------------- brand auto-learn (section 2.6)
-- After a supplier quotes an item, record that the supplier carries the item's brand and family.
-- created_by stays NULL: the row was written by the system, not by a person.
create function public.learn_company_brands()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_brands (company_id, brand_id, created_by)
  select distinct si.supplier_id, b.brand_id, null::uuid
  from public.supplier_inquiries si
  join public.rfq_items ri on ri.id = new.rfq_item_id
  cross join lateral (values (ri.brand_id), (ri.family_id)) as b (brand_id)
  where si.id = new.inquiry_id
    and b.brand_id is not null
  on conflict (company_id, brand_id) do nothing;
  return new;
end;
$$;

revoke all on function public.learn_company_brands() from public, anon, authenticated;

create trigger supplier_quote_lines_learn_brands after insert on public.supplier_quote_lines
  for each row execute function public.learn_company_brands();

-- ---------------------------------------------------------------- grants and RLS
alter table public.supplier_inquiries     enable row level security;
alter table public.supplier_quote_lines   enable row level security;
alter table public.clarifications         enable row level security;

revoke all on table public.supplier_inquiries, public.supplier_quote_lines, public.clarifications
  from public, anon, authenticated;
grant select, insert, update, delete on table public.supplier_inquiries,
  public.supplier_quote_lines, public.clarifications to authenticated;

-- supplier_inquiries: SIU for staff; delete for admin, or for staff while sent_on is empty
create policy supplier_inquiries_select_staff on public.supplier_inquiries for select to authenticated
  using (public.current_user_role() is not null);
create policy supplier_inquiries_insert_staff on public.supplier_inquiries for insert to authenticated
  with check (public.current_user_role() is not null);
create policy supplier_inquiries_update_staff on public.supplier_inquiries for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy supplier_inquiries_delete_unsent_or_admin on public.supplier_inquiries
  for delete to authenticated
  using (
    public.current_user_role() = 'admin'
    or (public.current_user_role() is not null and sent_on is null)
  );

-- supplier_quote_lines, clarifications: SIUD for every staff role
create policy supplier_quote_lines_select_staff on public.supplier_quote_lines for select to authenticated
  using (public.current_user_role() is not null);
create policy supplier_quote_lines_insert_staff on public.supplier_quote_lines for insert to authenticated
  with check (public.current_user_role() is not null);
create policy supplier_quote_lines_update_staff on public.supplier_quote_lines for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy supplier_quote_lines_delete_staff on public.supplier_quote_lines for delete to authenticated
  using (public.current_user_role() is not null);

create policy clarifications_select_staff on public.clarifications for select to authenticated
  using (public.current_user_role() is not null);
create policy clarifications_insert_staff on public.clarifications for insert to authenticated
  with check (public.current_user_role() is not null);
create policy clarifications_update_staff on public.clarifications for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy clarifications_delete_staff on public.clarifications for delete to authenticated
  using (public.current_user_role() is not null);
