-- 0009_orders (S05): DATA_MODEL sections 2.12, 2.12a, 2.13, 2.14, 2.15 with Amendments A2b and A3.
-- No money columns live on orders; cost sits in order_costs, which only admin can touch.
-- Audit triggers are attached to every business table later, in S09.

-- ---------------------------------------------------------------- orders [std][upd][L]
create table public.orders (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  created_by                uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at                timestamptz not null default now(),
  number                    bigint generated always as identity unique,
  company_id                uuid not null references public.companies (id) on delete restrict,
  site_id                   uuid references public.company_sites (id) on delete set null,
  contact_id                uuid references public.contacts (id) on delete set null,
  rfq_id                    uuid references public.rfqs (id) on delete restrict,
  owner_id                  uuid default auth.uid() references public.users (id) on delete restrict,
  customer_po_number        text,
  ordered_on                date default public.today_pkt(),
  payment_terms_days        integer check (payment_terms_days >= 0),
  needs_commissioning       boolean not null default false,
  commissioning_planned_on  date,
  commissioning_done_on     date,
  cancelled_on              date,
  notes                     text,
  legacy_flags              text[] not null default '{}',
  legacy_source             jsonb,
  -- Legacy escape hatches: only imported rows may lack an owner or a date.
  constraint orders_owner_present check (owner_id is not null or 'owner_unknown' = any (legacy_flags)),
  constraint orders_ordered_on_present check (ordered_on is not null or 'undated' = any (legacy_flags))
);

comment on column public.orders.number is 'Internal "ORD-0038"; identity, never set by clients.';

-- PO numbers are the customer's own series, so they are unique per company.
-- Exempt: legacy rows flagged po_shared (PO 253074 A/B).
create unique index orders_company_po_key on public.orders (company_id, customer_po_number)
  where customer_po_number is not null and not ('po_shared' = any (legacy_flags));
create index orders_company_idx on public.orders (company_id);
create index orders_rfq_idx on public.orders (rfq_id) where rfq_id is not null;
create index orders_owner_idx on public.orders (owner_id);
create index orders_site_idx on public.orders (site_id) where site_id is not null;
create index orders_contact_idx on public.orders (contact_id) where contact_id is not null;

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- supplier_orders [std][L] (procurement leg)
create table public.supplier_orders (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users (id) on delete restrict,
  order_id       uuid not null references public.orders (id) on delete cascade,
  supplier_id    uuid not null references public.companies (id) on delete restrict,
  inquiry_id     uuid references public.supplier_inquiries (id) on delete set null,
  reference      text,
  placed_on      date,
  expected_on    date,
  received_on    date,
  delivered_on   date,
  -- Amendment A2b: the single source of truth for the leg's currency.
  currency       char(3) check (currency ~ '^[A-Z]{3}$'),
  legacy_flags   text[] not null default '{}',
  legacy_source  jsonb
);

create index supplier_orders_order_idx on public.supplier_orders (order_id);
create index supplier_orders_supplier_idx on public.supplier_orders (supplier_id);
create index supplier_orders_inquiry_idx on public.supplier_orders (inquiry_id) where inquiry_id is not null;

-- ---------------------------------------------------------------- order_items [std][L]
create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references public.users (id) on delete restrict,
  order_id            uuid not null references public.orders (id) on delete cascade,
  position            smallint not null default 0,
  description         text not null,
  brand_id            uuid references public.brands (id) on delete restrict,
  -- Must point at a kind = 'family' brand; enforced in app code (section 4).
  family_id           uuid references public.brands (id) on delete restrict,
  qty                 numeric(12,3) not null default 1 check (qty > 0),
  unit                text,
  unit_price_net      numeric(14,2) not null check (unit_price_net >= 0),
  gst_rate            numeric(5,2) not null default 18 check (gst_rate between 0 and 100),
  is_service          boolean not null default false,
  supplier_order_id   uuid references public.supplier_orders (id) on delete set null,
  rfq_item_id         uuid references public.rfq_items (id) on delete set null,
  -- Amendment A2b: working purchase price in the leg's supplier_orders.currency.
  supplier_unit_price numeric(14,4) check (supplier_unit_price >= 0),
  model_tokens        text[] not null generated always as (public.model_tokens(description)) stored,
  legacy_flags        text[] not null default '{}',
  legacy_source       jsonb
);

create index order_items_order_idx on public.order_items (order_id, position);
create index order_items_brand_idx on public.order_items (brand_id) where brand_id is not null;
create index order_items_family_idx on public.order_items (family_id) where family_id is not null;
create index order_items_leg_idx on public.order_items (supplier_order_id) where supplier_order_id is not null;
create index order_items_rfq_item_idx on public.order_items (rfq_item_id) where rfq_item_id is not null;
create index order_items_model_tokens_idx on public.order_items using gin (model_tokens);

-- ---------------------------------------------------------------- order_engineers
create table public.order_engineers (
  order_id  uuid not null references public.orders (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete restrict,
  primary key (order_id, user_id)
);

create index order_engineers_user_idx on public.order_engineers (user_id);

-- ---------------------------------------------------------------- order_costs [std + updated_at] (admin only)
-- One row per order, created the first time an admin enters a cost. No row means cost unknown.
-- Keyed by order_id (no id column), as the model specifies.
create table public.order_costs (
  order_id           uuid primary key references public.orders (id) on delete cascade,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at         timestamptz not null default now(),
  expected_cost_pkr  numeric(14,2) check (expected_cost_pkr >= 0),
  costs_complete_at  timestamptz,
  costs_complete_by  uuid references public.users (id) on delete restrict
);

create index order_costs_complete_by_idx on public.order_costs (costs_complete_by)
  where costs_complete_by is not null;

create trigger order_costs_set_updated_at before update on public.order_costs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- grants and RLS
alter table public.orders           enable row level security;
alter table public.supplier_orders  enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_engineers  enable row level security;
alter table public.order_costs      enable row level security;

revoke all on table public.orders, public.supplier_orders, public.order_items,
  public.order_engineers, public.order_costs from public, anon, authenticated;
grant select, insert, update, delete on table public.orders, public.supplier_orders,
  public.order_items, public.order_engineers, public.order_costs to authenticated;

-- orders: SIUD admin, SIU sales/engineer (deleting is also blocked by FKs once money is attached)
create policy orders_select_staff on public.orders for select to authenticated
  using (public.current_user_role() is not null);
create policy orders_insert_staff on public.orders for insert to authenticated
  with check (public.current_user_role() is not null);
create policy orders_update_staff on public.orders for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy orders_delete_admin on public.orders for delete to authenticated
  using (public.current_user_role() = 'admin');

-- supplier_orders, order_items, order_engineers: SIUD for every staff role
create policy supplier_orders_select_staff on public.supplier_orders for select to authenticated
  using (public.current_user_role() is not null);
create policy supplier_orders_insert_staff on public.supplier_orders for insert to authenticated
  with check (public.current_user_role() is not null);
create policy supplier_orders_update_staff on public.supplier_orders for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy supplier_orders_delete_staff on public.supplier_orders for delete to authenticated
  using (public.current_user_role() is not null);

create policy order_items_select_staff on public.order_items for select to authenticated
  using (public.current_user_role() is not null);
create policy order_items_insert_staff on public.order_items for insert to authenticated
  with check (public.current_user_role() is not null);
create policy order_items_update_staff on public.order_items for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy order_items_delete_staff on public.order_items for delete to authenticated
  using (public.current_user_role() is not null);

create policy order_engineers_select_staff on public.order_engineers for select to authenticated
  using (public.current_user_role() is not null);
create policy order_engineers_insert_staff on public.order_engineers for insert to authenticated
  with check (public.current_user_role() is not null);
create policy order_engineers_update_staff on public.order_engineers for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy order_engineers_delete_staff on public.order_engineers for delete to authenticated
  using (public.current_user_role() is not null);

-- order_costs: admin only, all four operations
create policy order_costs_select_admin on public.order_costs for select to authenticated
  using (public.current_user_role() = 'admin');
create policy order_costs_insert_admin on public.order_costs for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy order_costs_update_admin on public.order_costs for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy order_costs_delete_admin on public.order_costs for delete to authenticated
  using (public.current_user_role() = 'admin');
