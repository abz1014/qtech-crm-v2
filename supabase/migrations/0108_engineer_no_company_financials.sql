-- 0108_engineer_no_company_financials (owner decision 2026-10-28): an engineer cannot read the company's bank details, IBAN,
-- NTN or STRN. Same mechanism as 0081 (engineers see no price): the data API runs an engineer as qtech_engineer, and this
-- migration takes SELECT and UPDATE on the five financial and tax columns of company_profile away from that role. The table
-- level grant 0081 copied from `authenticated` is replaced by a column grant over every other column, so `select=*` on
-- company_profile is refused (42501) to an engineer, while name, address, phone, email, website, the validity and payment
-- terms and the standard wording still read as before. Admin and sales (role authenticated) are untouched.
--
-- Expand-only: no data, no column, no policy changes, and no other role's privileges change.
--   FINANCIAL = ntn, strn, bank_name, bank_account_title, bank_iban
-- The app reads the narrower column list for an engineer (settings/companyProfile.ts).
-- supabase/tests/0081_engineer_no_prices.test.sql lists these columns with the price columns so its coverage checks agree.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.company_profile'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('ntn', 'strn', 'bank_name', 'bank_account_title', 'bank_iban');

  -- a column REVOKE does nothing under a table-level grant: drop the table-level ones, then grant the safe columns back
  revoke select, update on table public.company_profile from qtech_engineer;
  execute format('grant select (%s) on table public.company_profile to qtech_engineer', cols);
  execute format('grant update (%s) on table public.company_profile to qtech_engineer', cols);
end
$$;
