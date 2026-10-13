-- 0010_money (S06): DATA_MODEL sections 2.16-2.19 with Amendments A2 and A3, and Revision 1 section 2.17.
-- Money is admin-only, except invoices, which sales may also read and write (section 10).
-- Amendment A3: invoices.tax_deposit_bank is dropped; invoice_date, received_on and paid_on
-- default to today in Karachi. Audit triggers are attached later, in S09.

-- ---------------------------------------------------------------- recurring_expenses [std]
create table public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.users (id) on delete restrict,
  label         text not null,
  category      text not null,
  amount        numeric(14,2) not null check (amount > 0),
  day_of_month  smallint check (day_of_month between 1 and 28),
  active        boolean not null default true,
  start_month   char(7) check (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  notes         text
);

-- ---------------------------------------------------------------- invoices [std][upd][L]
create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at          timestamptz not null default now(),
  -- Required for new rows by app code; NULL only for unlinked legacy register rows.
  order_id            uuid references public.orders (id) on delete restrict,
  company_id          uuid references public.companies (id) on delete restrict,
  number              text,
  invoice_date        date default public.today_pkt(),
  net_amount          numeric(14,2) not null,
  gst_amount          numeric(14,2) not null check (gst_amount >= 0),
  copy_received_on    date,
  tcs_sent_on         date,
  tcs_number          text,
  client_received_on  date,
  psid                text,
  wasif_receipt_on    date,
  tax_deposited_on    date,
  tax_deposit_amount  numeric(14,2),
  notes               text,
  last_reminded_on    date,
  reminder_count      smallint not null default 0 check (reminder_count >= 0),
  legacy_flags        text[] not null default '{}',
  legacy_source       jsonb,
  constraint invoices_gst_within_net check (gst_amount <= net_amount),
  constraint invoices_order_or_company check (order_id is not null or company_id is not null),
  -- Legacy escape hatches: number and date may be missing only on rows carrying a legacy flag.
  constraint invoices_number_present check (number is not null or cardinality(legacy_flags) > 0),
  constraint invoices_date_present check (invoice_date is not null or cardinality(legacy_flags) > 0)
);

comment on column public.invoices.copy_received_on is
  'Amendment A3-3: verify against live data at the I06 import; drop if unused or identical to tcs_sent_on.';
comment on column public.invoices.client_received_on is
  'Amendment A3-3: optional, not in the entry flow; no Today rule reads it.';

-- Q-Tech's own series, globally unique.
create unique index invoices_number_key on public.invoices (number) where number is not null;
create index invoices_order_idx on public.invoices (order_id) where order_id is not null;
create index invoices_company_idx on public.invoices (company_id) where company_id is not null;
create index invoices_date_idx on public.invoices (invoice_date);

create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- payments_in [std][L]
create table public.payments_in (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references public.users (id) on delete restrict,
  order_id          uuid not null references public.orders (id) on delete restrict,
  received_on       date not null default public.today_pkt(),
  -- Gross: the money actually received, GST included.
  amount            numeric(14,2) not null check (amount > 0),
  -- Whose target this payment counts towards. Filled from orders.owner_id by the trigger below.
  credited_user_id  uuid references public.users (id) on delete restrict,
  reference         text,
  legacy_flags      text[] not null default '{}',
  legacy_source     jsonb
);

create index payments_in_order_idx on public.payments_in (order_id);
create index payments_in_credited_idx on public.payments_in (credited_user_id, received_on)
  where credited_user_id is not null;
create index payments_in_received_idx on public.payments_in (received_on);

-- Copies the order owner once, so reassigning an order later does not rewrite past quarters.
-- Imported rows (legacy_source set) are left alone: NULL there means deliberately unattributed.
create function public.set_payment_credited_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.credited_user_id is null and new.legacy_source is null then
    select o.owner_id into new.credited_user_id from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_payment_credited_user() from public, anon, authenticated;

create trigger payments_in_set_credited_user before insert on public.payments_in
  for each row execute function public.set_payment_credited_user();

-- ---------------------------------------------------------------- expenses [std][L]
create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references public.users (id) on delete restrict,
  paid_on            date not null default public.today_pkt(),
  amount_pkr         numeric(14,2) not null check (amount_pkr > 0),
  category           text not null,
  description        text,
  order_id           uuid references public.orders (id) on delete restrict,
  -- That it belongs to the same order is checked in app code (section 4).
  supplier_order_id  uuid references public.supplier_orders (id) on delete restrict,
  payee_id           uuid references public.companies (id) on delete restrict,
  reference          text,
  recurring_id       uuid references public.recurring_expenses (id) on delete set null,
  period             char(7) check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  legacy_flags       text[] not null default '{}',
  legacy_source      jsonb,
  constraint expenses_recurring_period_key unique (recurring_id, period)
);

create index expenses_order_idx on public.expenses (order_id) where order_id is not null;
create index expenses_leg_idx on public.expenses (supplier_order_id) where supplier_order_id is not null;
create index expenses_payee_idx on public.expenses (payee_id) where payee_id is not null;
create index expenses_paid_idx on public.expenses (paid_on);

-- ---------------------------------------------------------------- grants and RLS
alter table public.recurring_expenses  enable row level security;
alter table public.invoices            enable row level security;
alter table public.payments_in         enable row level security;
alter table public.expenses            enable row level security;

revoke all on table public.recurring_expenses, public.invoices, public.payments_in, public.expenses
  from public, anon, authenticated;
grant select, insert, update, delete on table public.recurring_expenses, public.invoices,
  public.payments_in, public.expenses to authenticated;

-- invoices: SIUD admin, SIU sales, nothing for engineers (the update also covers the reminder stamp)
create policy invoices_select_admin_sales on public.invoices for select to authenticated
  using (public.current_user_role() in ('admin', 'sales'));
create policy invoices_insert_admin_sales on public.invoices for insert to authenticated
  with check (public.current_user_role() in ('admin', 'sales'));
create policy invoices_update_admin_sales on public.invoices for update to authenticated
  using (public.current_user_role() in ('admin', 'sales'))
  with check (public.current_user_role() in ('admin', 'sales'));
create policy invoices_delete_admin on public.invoices for delete to authenticated
  using (public.current_user_role() = 'admin');

-- payments_in, expenses, recurring_expenses: admin only, all four operations
create policy payments_in_select_admin on public.payments_in for select to authenticated
  using (public.current_user_role() = 'admin');
create policy payments_in_insert_admin on public.payments_in for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy payments_in_update_admin on public.payments_in for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy payments_in_delete_admin on public.payments_in for delete to authenticated
  using (public.current_user_role() = 'admin');

create policy expenses_select_admin on public.expenses for select to authenticated
  using (public.current_user_role() = 'admin');
create policy expenses_insert_admin on public.expenses for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy expenses_update_admin on public.expenses for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy expenses_delete_admin on public.expenses for delete to authenticated
  using (public.current_user_role() = 'admin');

create policy recurring_expenses_select_admin on public.recurring_expenses for select to authenticated
  using (public.current_user_role() = 'admin');
create policy recurring_expenses_insert_admin on public.recurring_expenses for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy recurring_expenses_update_admin on public.recurring_expenses for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy recurring_expenses_delete_admin on public.recurring_expenses for delete to authenticated
  using (public.current_user_role() = 'admin');
