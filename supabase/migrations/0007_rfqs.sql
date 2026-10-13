-- 0007_rfqs (S04, part 1): DATA_MODEL sections 2.7 and 2.8 (rfqs, rfq_items) plus the
-- model_tokens() helper from Amendment A2b. Amendment A3: rfqs.owner_id defaults to auth.uid().

-- Amendment A2b: searchable model numbers pulled out of free text.
-- Upper-case, split on whitespace and commas, strip "- . /", keep tokens of 4+ characters with at
-- least one letter and one digit, then drop unit and range patterns (24VDC, 420MA, 100MM ...).
-- Duplicates collapse and the result is sorted so the same text always gives the same array.
create function public.model_tokens(t text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.tok order by x.tok), '{}'::text[])
  from (
    select regexp_replace(s, '[-./]', '', 'g') as tok
    from unnest(regexp_split_to_array(upper(coalesce(t, '')), '[[:space:],]+')) as s
  ) x
  where length(x.tok) >= 4
    and x.tok ~ '[A-Z]'
    and x.tok ~ '[0-9]'
    and x.tok !~ '^[0-9]+(V|VAC|VDC|MA|MM|CM|M|KV|KW|W|HZ|BAR|PSI|C)$'
    and x.tok !~ '^[0-9]+[0-9]+MA$'
$$;

grant execute on function public.model_tokens(text) to authenticated;

-- ---------------------------------------------------------------- rfqs [std][upd][L]
create table public.rfqs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at     timestamptz not null default now(),
  number         bigint generated always as identity unique,
  company_id     uuid not null references public.companies (id) on delete restrict,
  site_id        uuid references public.company_sites (id) on delete set null,
  contact_id     uuid references public.contacts (id) on delete set null,
  customer_ref   text,
  received_on    date not null default public.today_pkt(),
  due_on         date,
  owner_id       uuid default auth.uid() references public.users (id) on delete restrict,
  is_priority    boolean not null default false,
  quoted_on      date,
  closed_on      date,
  close_reason   text check (close_reason in ('competitor', 'price', 'no_reply_to_clarification',
                   'customer_cancelled', 'could_not_source', 'we_were_late', 'other')),
  close_note     text,
  notes          text,
  legacy_flags   text[] not null default '{}',
  legacy_source  jsonb,
  -- Legacy escape hatch: only imported rows may lack an owner.
  constraint rfqs_owner_present check (owner_id is not null or 'owner_unknown' = any (legacy_flags)),
  -- A closed RFQ carries a reason, and a reason only exists on a closed RFQ.
  constraint rfqs_close_pair check ((close_reason is null) = (closed_on is null))
);

comment on column public.rfqs.number is 'Internal "RFQ-0177"; identity, never set by clients.';

-- A re-sent RFQ (deadline extension) lands on the existing record.
create unique index rfqs_company_customer_ref_key
  on public.rfqs (company_id, customer_ref) where customer_ref is not null;
create index rfqs_company_idx on public.rfqs (company_id);
create index rfqs_owner_idx on public.rfqs (owner_id);
create index rfqs_site_idx on public.rfqs (site_id) where site_id is not null;
create index rfqs_contact_idx on public.rfqs (contact_id) where contact_id is not null;
create index rfqs_open_due_idx on public.rfqs (due_on) where closed_on is null;

create trigger rfqs_set_updated_at before update on public.rfqs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- rfq_items [std][L]
create table public.rfq_items (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  created_by            uuid default auth.uid() references public.users (id) on delete restrict,
  rfq_id                uuid not null references public.rfqs (id) on delete cascade,
  position              smallint not null default 0,
  description           text not null,
  brand_id              uuid references public.brands (id) on delete restrict,
  -- Must point at a kind = 'family' brand; enforced in app code (section 4).
  family_id             uuid references public.brands (id) on delete restrict,
  qty                   numeric(12,3) not null default 1 check (qty > 0),
  unit                  text,
  quoted_unit_price_net numeric(14,2) check (quoted_unit_price_net >= 0),
  gst_rate              numeric(5,2) not null default 18 check (gst_rate between 0 and 100),
  quoted_lead_time      text,
  model_tokens          text[] not null generated always as (public.model_tokens(description)) stored,
  legacy_flags          text[] not null default '{}',
  legacy_source         jsonb
);

create index rfq_items_rfq_idx on public.rfq_items (rfq_id, position);
create index rfq_items_brand_idx on public.rfq_items (brand_id) where brand_id is not null;
create index rfq_items_family_idx on public.rfq_items (family_id) where family_id is not null;
create index rfq_items_model_tokens_idx on public.rfq_items using gin (model_tokens);

-- ---------------------------------------------------------------- grants and RLS
alter table public.rfqs       enable row level security;
alter table public.rfq_items  enable row level security;

revoke all on table public.rfqs, public.rfq_items from public, anon, authenticated;
grant select, insert, update, delete on table public.rfqs, public.rfq_items to authenticated;

-- rfqs: SIUD admin, SIU sales/engineer
create policy rfqs_select_staff on public.rfqs for select to authenticated
  using (public.current_user_role() is not null);
create policy rfqs_insert_staff on public.rfqs for insert to authenticated
  with check (public.current_user_role() is not null);
create policy rfqs_update_staff on public.rfqs for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy rfqs_delete_admin on public.rfqs for delete to authenticated
  using (public.current_user_role() = 'admin');

-- rfq_items: SIUD for every staff role
create policy rfq_items_select_staff on public.rfq_items for select to authenticated
  using (public.current_user_role() is not null);
create policy rfq_items_insert_staff on public.rfq_items for insert to authenticated
  with check (public.current_user_role() is not null);
create policy rfq_items_update_staff on public.rfq_items for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy rfq_items_delete_staff on public.rfq_items for delete to authenticated
  using (public.current_user_role() is not null);
