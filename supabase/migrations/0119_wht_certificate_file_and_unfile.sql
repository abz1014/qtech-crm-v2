-- 0119_wht_certificate_file_and_unfile (owner request 2026-10-30):
--
--   A. The withholding tax certificate FILE. 0116 kept the certificate number; the customer also sends the certificate itself.
--      payments_in.wht_certificate_path / wht_certificate_name hold one optional file per payment, stored in the existing admin-only
--      bucket expense-receipts under wht/{payment_id}/{uuid}.{ext} (payments are admin only, so the bucket that only an admin can
--      read is the right one; no new bucket, no change to the storage policies). v_wht_deducted gets certificate_path and
--      certificate_name at the end, and its "missing" flag clears when a NUMBER or a FILE exists. Attaching the file is allowed in a
--      closed month (the file is not money, like the bank tick): enforce_month_lock leaves the two columns out of its comparison.
--   B. Clearing a filing. Once an invoice has a PSID or a tax deposit date, clearing either is an admin's act: a BEFORE UPDATE trigger
--      refuses it for sales (42501, HINT admin_only_unfile) when it comes through the API. The change is audited like any invoice
--      update (audit_log keeps the old and the new value and who). Setting or changing a PSID or a date is unchanged.
--
-- Expand-only: two nullable columns, one view with two columns added at the end, one trigger.

alter table public.payments_in
  add column wht_certificate_path text check (char_length(wht_certificate_path) <= 300),
  add column wht_certificate_name text check (char_length(wht_certificate_name) <= 200),
  add constraint payments_in_wht_file_pair check ((wht_certificate_path is null) = (wht_certificate_name is null));

comment on column public.payments_in.wht_certificate_path is
  '0119: storage path (bucket expense-receipts, wht/{payment_id}/{uuid}.ext) of the WHT certificate the customer sent; optional.';

create or replace view public.v_wht_deducted with (security_invoker = true) as
select
  p.id as payment_id,
  p.order_id,
  o.number as order_number,
  o.company_id,
  c.name as company_name,
  p.received_on,
  date_trunc('month', p.received_on)::date as month,
  p.wht_amount,
  p.wht_certificate_no as certificate_no,
  (nullif(btrim(p.wht_certificate_no), '') is null and p.wht_certificate_path is null) as certificate_missing,
  p.wht_certificate_path as certificate_path,
  p.wht_certificate_name as certificate_name
from public.payments_in p
join public.orders o on o.id = p.order_id
left join public.companies c on c.id = o.company_id
where p.wht_amount > 0
  and p.voided_at is null
  and (select public.current_user_role()) = 'admin';

do $do$
declare
  def     text := pg_catalog.pg_get_functiondef('public.enforce_month_lock()'::regprocedure);
  a1      text := 'v_touched := (to_jsonb(new) - ''bank_month'') is distinct from (to_jsonb(old) - ''bank_month'');';
  patched text;
begin
  if strpos(def, a1) = 0 then
    raise exception '0119: the month lock function was not in the expected shape';
  end if;
  patched := replace(def, a1,
    'v_touched := (to_jsonb(new) - ''bank_month'' - ''wht_certificate_path'' - ''wht_certificate_name'')
        is distinct from (to_jsonb(old) - ''bank_month'' - ''wht_certificate_path'' - ''wht_certificate_name'');');
  execute patched;
end
$do$;

-- ================================================================ B. clearing a filing is the admin's
create function public.invoices_unfile_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'qtech_engineer')
     and public.current_user_role() is distinct from 'admin'
     and ((nullif(btrim(old.psid), '') is not null and nullif(btrim(new.psid), '') is null)
          or (old.tax_deposited_on is not null and new.tax_deposited_on is null)) then
    raise exception 'Only an admin can clear a PSID or a tax deposit date once it is recorded.'
      using errcode = '42501', hint = 'admin_only_unfile';
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_unfile_guard() from public, anon, authenticated;

create trigger invoices_unfile before update on public.invoices
  for each row execute function public.invoices_unfile_guard();
