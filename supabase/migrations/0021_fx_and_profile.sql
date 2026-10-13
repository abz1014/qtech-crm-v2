-- 0021_fx_and_profile (S17): DATA_MODEL sections 2.24 (fx_rates, Amendment A2b), 2.10 (quote-line FX capture),
-- 2.27 (company_profile) and section 10. users.job_title already exists (0003).
-- The nightly fetch that writes source = 'auto' rows is task R23 (service role, bypasses RLS); nothing here calls the network.

-- ---------------------------------------------------------------- fx_rates [std]
create table public.fx_rates (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  currency    char(3) not null check (currency ~ '^[A-Z]{3}$' and currency <> 'PKR'),
  -- PKR for 1 unit of currency.
  rate_pkr    numeric(14,6) not null check (rate_pkr > 0),
  as_of       date not null default public.today_pkt(),
  source      text not null default 'manual' check (source in ('auto', 'manual')),
  -- Re-entering a manual rate on the same day updates that day's manual row.
  constraint fx_rates_currency_as_of_source_key unique (currency, as_of, source)
);

comment on table public.fx_rates is
  'Market rates, not company money: any staff member may enter a manual rate. Auto rows are written by the nightly job (R23).';

alter table public.fx_rates enable row level security;

revoke all on table public.fx_rates from public, anon, authenticated;
grant select, insert, update, delete on table public.fx_rates to authenticated;

-- Section 10: SIUD admin; SIU for sales and engineers, only where source = 'manual'.
create policy fx_rates_select_staff on public.fx_rates for select to authenticated
  using (public.current_user_role() is not null);
create policy fx_rates_insert_staff on public.fx_rates for insert to authenticated
  with check (
    public.current_user_role() = 'admin'
    or (public.current_user_role() in ('sales', 'engineer') and source = 'manual')
  );
create policy fx_rates_update_staff on public.fx_rates for update to authenticated
  using (
    public.current_user_role() = 'admin'
    or (public.current_user_role() in ('sales', 'engineer') and source = 'manual')
  )
  with check (
    public.current_user_role() = 'admin'
    or (public.current_user_role() in ('sales', 'engineer') and source = 'manual')
  );
create policy fx_rates_delete_admin on public.fx_rates for delete to authenticated
  using (public.current_user_role() = 'admin');

create trigger fx_rates_audit after insert or update or delete on public.fx_rates
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- v_fx_latest
-- One row per currency: the latest as_of (not in the future); on that day manual beats auto. A manual rate
-- therefore applies for its own day only: the next day's auto rate is newer and replaces it.
-- staleness: fresh <= 7 days, stale 8-30, unusable > 30.
create view public.v_fx_latest with (security_invoker = true) as
select distinct on (r.currency)
  r.currency,
  r.rate_pkr,
  r.as_of,
  r.source,
  (public.today_pkt() - r.as_of) as age_days,
  case
    when public.today_pkt() - r.as_of <= 7 then 'fresh'
    when public.today_pkt() - r.as_of <= 30 then 'stale'
    else 'unusable'
  end as staleness
from public.fx_rates r
where r.as_of <= public.today_pkt()
order by r.currency, r.as_of desc, (r.source = 'manual') desc;

revoke all on public.v_fx_latest from public, anon, authenticated;
grant select on public.v_fx_latest to authenticated;

-- ---------------------------------------------------------------- set_fx_rate (any staff)
-- The one-field entry behind the inline "Rate for USD?" prompt: currency and rate, today by default. Re-entering on the
-- same day updates that day's manual row. SECURITY INVOKER: the fx_rates policies decide who may write.
create function public.set_fx_rate(p_currency text, p_rate_pkr numeric, p_as_of date default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.fx_rates (currency, rate_pkr, as_of, source)
  values (upper(btrim(p_currency)), p_rate_pkr, coalesce(p_as_of, public.today_pkt()), 'manual')
  on conflict (currency, as_of, source) do update set rate_pkr = excluded.rate_pkr
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.set_fx_rate(text, numeric, date) from public, anon, authenticated;
grant execute on function public.set_fx_rate(text, numeric, date) to authenticated;

-- ---------------------------------------------------------------- quote-line FX capture (Amendment A2b)
-- The rate at entry, for history and supplier memory only ("at the time"); live comparison uses v_fx_latest.
alter table public.supplier_quote_lines
  add column fx_rate_pkr numeric(14,6) check (fx_rate_pkr > 0),
  add column fx_rate_on  date;

-- BEFORE INSERT: fills only what was left empty, so an edited rate is kept.
--   imported rows (legacy_source set) are skipped
--   PKR gives 1, dated today
--   otherwise the current v_fx_latest rate and its date, whatever its age (the date shows how old it was)
--   no rate known: both stay NULL. A missing rate never blocks the insert (Amendment A3).
-- SECURITY DEFINER only so the lookup does not depend on the inserter's rights; it reads fx_rates and writes nothing.
create function public.capture_quote_line_fx()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_on   date;
begin
  if new.legacy_source is not null then
    return new;
  end if;
  if new.fx_rate_pkr is null then
    if new.currency = 'PKR' then
      new.fx_rate_pkr := 1;
      new.fx_rate_on := public.today_pkt();
    else
      select f.rate_pkr, f.as_of into v_rate, v_on from public.v_fx_latest f where f.currency = new.currency;
      if found then
        new.fx_rate_pkr := v_rate;
        new.fx_rate_on := v_on;
      end if;
    end if;
  elsif new.fx_rate_on is null then
    new.fx_rate_on := public.today_pkt();
  end if;
  return new;
end;
$$;

revoke all on function public.capture_quote_line_fx() from public, anon, authenticated;

create trigger supplier_quote_lines_capture_fx before insert on public.supplier_quote_lines
  for each row execute function public.capture_quote_line_fx();

-- ---------------------------------------------------------------- company_profile (single row)
create table public.company_profile (
  id                       smallint primary key default 1 check (id = 1),
  legal_name               text,
  address                  text,
  phone                    text,
  email                    text,
  website                  text,
  ntn                      text,
  strn                     text,
  bank_name                text,
  bank_account_title       text,
  bank_iban                text,
  quotation_validity_days  smallint not null default 30 check (quotation_validity_days > 0),
  quotation_terms          text,
  po_terms                 text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.users (id) on delete restrict
);

comment on table public.company_profile is
  'Singleton (id = 1) created by this migration. PDF generation is blocked in the app until legal_name and address are set.';

insert into public.company_profile (id) values (1);

create function public.company_profile_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger company_profile_touch before update on public.company_profile
  for each row execute function public.company_profile_touch();

alter table public.company_profile enable row level security;

-- Section 10: S for every staff role, U for admin, no insert and no delete for anyone.
revoke all on table public.company_profile from public, anon, authenticated;
grant select, update on table public.company_profile to authenticated;

create policy company_profile_select_staff on public.company_profile for select to authenticated
  using (public.current_user_role() is not null);
create policy company_profile_update_admin on public.company_profile for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

create trigger company_profile_audit after insert or update or delete on public.company_profile
  for each row execute function public.audit_row_change();
