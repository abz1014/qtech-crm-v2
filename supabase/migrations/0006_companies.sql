-- 0006_companies (S03): DATA_MODEL sections 2.2-2.6 and the section 10 rows for these tables.
-- Each table enables RLS and creates its policies in this same file.
-- Audit triggers are attached to every business table later, in S09.

-- ---------------------------------------------------------------- companies [std][upd][L]
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at    timestamptz not null default now(),
  name          text not null,
  country       text,
  notes         text,
  legacy_flags  text[] not null default '{}',
  legacy_source jsonb
);

comment on table public.companies is
  'One table for customers and suppliers; the role is derived (v_company_roles).';

-- Prevents duplicate companies, ignoring case and surrounding spaces.
create unique index companies_name_key on public.companies (lower(btrim(name)));

create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- company_sites [std]
create table public.company_sites (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  address     text
);

create unique index company_sites_company_name_key
  on public.company_sites (company_id, lower(btrim(name)));

-- ---------------------------------------------------------------- contacts [std]
-- Every contact field except name is optional: vendor contact data is empty in the legacy seed.
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  company_id  uuid not null references public.companies (id) on delete cascade,
  site_id     uuid references public.company_sites (id) on delete set null,
  name        text not null,
  phone       text,
  email       text,
  notes       text
);

create index contacts_company_idx on public.contacts (company_id);
create index contacts_site_idx on public.contacts (site_id) where site_id is not null;

-- ---------------------------------------------------------------- brands [std]
create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  name        text not null,
  kind        text not null default 'brand' check (kind in ('brand', 'family'))
);

create unique index brands_name_key on public.brands (lower(btrim(name)));

-- ---------------------------------------------------------------- company_brands
-- created_by is NULL when written by the auto-learn trigger (0008) or the import.
create table public.company_brands (
  company_id  uuid not null references public.companies (id) on delete cascade,
  brand_id    uuid not null references public.brands (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  primary key (company_id, brand_id)
);

create index company_brands_brand_idx on public.company_brands (brand_id);

-- ---------------------------------------------------------------- grants and RLS
alter table public.companies       enable row level security;
alter table public.company_sites   enable row level security;
alter table public.contacts        enable row level security;
alter table public.brands          enable row level security;
alter table public.company_brands  enable row level security;

revoke all on table public.companies, public.company_sites, public.contacts,
  public.brands, public.company_brands from public, anon, authenticated;
grant select, insert, update, delete on table public.companies, public.company_sites,
  public.contacts, public.brands, public.company_brands to authenticated;

-- Section 10. "Staff" = any active user; current_user_role() is NULL for deactivated or unknown callers.

-- companies: SIUD admin, SIU sales/engineer (delete is admin-only, via merge_companies)
create policy companies_select_staff on public.companies for select to authenticated
  using (public.current_user_role() is not null);
create policy companies_insert_staff on public.companies for insert to authenticated
  with check (public.current_user_role() is not null);
create policy companies_update_staff on public.companies for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy companies_delete_admin on public.companies for delete to authenticated
  using (public.current_user_role() = 'admin');

-- brands: same shape as companies (delete admin-only, via merge_brands)
create policy brands_select_staff on public.brands for select to authenticated
  using (public.current_user_role() is not null);
create policy brands_insert_staff on public.brands for insert to authenticated
  with check (public.current_user_role() is not null);
create policy brands_update_staff on public.brands for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy brands_delete_admin on public.brands for delete to authenticated
  using (public.current_user_role() = 'admin');

-- company_sites, contacts, company_brands: SIUD for every staff role
create policy company_sites_select_staff on public.company_sites for select to authenticated
  using (public.current_user_role() is not null);
create policy company_sites_insert_staff on public.company_sites for insert to authenticated
  with check (public.current_user_role() is not null);
create policy company_sites_update_staff on public.company_sites for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy company_sites_delete_staff on public.company_sites for delete to authenticated
  using (public.current_user_role() is not null);

create policy contacts_select_staff on public.contacts for select to authenticated
  using (public.current_user_role() is not null);
create policy contacts_insert_staff on public.contacts for insert to authenticated
  with check (public.current_user_role() is not null);
create policy contacts_update_staff on public.contacts for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy contacts_delete_staff on public.contacts for delete to authenticated
  using (public.current_user_role() is not null);

create policy company_brands_select_staff on public.company_brands for select to authenticated
  using (public.current_user_role() is not null);
create policy company_brands_insert_staff on public.company_brands for insert to authenticated
  with check (public.current_user_role() is not null);
create policy company_brands_update_staff on public.company_brands for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy company_brands_delete_staff on public.company_brands for delete to authenticated
  using (public.current_user_role() is not null);
