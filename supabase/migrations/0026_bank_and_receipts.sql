-- 0026_bank_and_receipts (S21): Amendment A6.1. Bank ticks (paid_via, bank_month, tax_bank_month) and receipt photos on
-- expenses (attachments.expense_id and the admin-only expense-receipts bucket).

-- ================================================================ bank ticks
-- paid_via on expenses came with 0025 (defaulted from the category). Payments in default to 'bank'.
alter table public.payments_in add column paid_via text not null default 'bank';
alter table public.payments_in add constraint payments_in_paid_via_check check (paid_via in ('bank', 'cash'));

-- bank_month: the statement month an item was ticked against (first day of the month). NULL = not ticked.
-- Only bank items can be ticked. Who ticked and when is in audit_log.
alter table public.payments_in add column bank_month date;
alter table public.payments_in add constraint payments_in_bank_month_first_day
  check (bank_month is null or extract(day from bank_month) = 1);
alter table public.payments_in add constraint payments_in_bank_month_needs_bank
  check (bank_month is null or paid_via = 'bank');

alter table public.expenses add column bank_month date;
alter table public.expenses add constraint expenses_bank_month_first_day
  check (bank_month is null or extract(day from bank_month) = 1);
alter table public.expenses add constraint expenses_bank_month_needs_bank
  check (bank_month is null or paid_via = 'bank');

-- The tick for the FBR deposit (the UI ticks a whole PSID group at once).
alter table public.invoices add column tax_bank_month date;
alter table public.invoices add constraint invoices_tax_bank_month_first_day
  check (tax_bank_month is null or extract(day from tax_bank_month) = 1);

-- ================================================================ receipt photos on expenses
alter table public.attachments add column expense_id uuid references public.expenses (id) on delete cascade;
create index attachments_expense_idx on public.attachments (expense_id) where expense_id is not null;

alter table public.attachments drop constraint attachments_bucket_check;
alter table public.attachments add constraint attachments_bucket_check
  check (bucket in ('rfq-files', 'gst-receipts', 'expense-receipts'));

-- Exactly one parent: an RFQ (optionally narrowed to a clarification), an invoice or an expense.
alter table public.attachments drop constraint attachments_one_parent;
alter table public.attachments add constraint attachments_one_parent
  check ((rfq_id is not null)::int + (invoice_id is not null)::int + (expense_id is not null)::int = 1);

-- The bucket matches the parent.
alter table public.attachments drop constraint attachments_bucket_matches_parent;
alter table public.attachments add constraint attachments_bucket_matches_parent check (
  (rfq_id is not null and bucket = 'rfq-files')
  or (invoice_id is not null and bucket = 'gst-receipts')
  or (expense_id is not null and bucket = 'expense-receipts')
);

comment on table public.attachments is
  'Three attach points only: an RFQ (or one of its clarifications), an invoice, or an expense (A6, admin only). Storage objects are removed by the app after a cascade.';

-- Section 10 (A6): attachments with an expense parent are admin only; the other two parents keep their rules.
drop policy attachments_select_by_parent on public.attachments;
drop policy attachments_insert_by_parent on public.attachments;
drop policy attachments_update_by_parent on public.attachments;
drop policy attachments_delete_by_parent on public.attachments;

create policy attachments_select_by_parent on public.attachments for select to authenticated
  using (
    case
      when expense_id is not null then public.current_user_role() = 'admin'
      when invoice_id is not null then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_insert_by_parent on public.attachments for insert to authenticated
  with check (
    case
      when expense_id is not null then public.current_user_role() = 'admin'
      when invoice_id is not null then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_update_by_parent on public.attachments for update to authenticated
  using (
    case
      when expense_id is not null then public.current_user_role() = 'admin'
      when invoice_id is not null then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  )
  with check (
    case
      when expense_id is not null then public.current_user_role() = 'admin'
      when invoice_id is not null then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_delete_by_parent on public.attachments for delete to authenticated
  using (
    case
      when expense_id is not null then public.current_user_role() = 'admin'
      when invoice_id is not null then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );

-- ================================================================ storage bucket
insert into storage.buckets (id, name, public, file_size_limit)
values ('expense-receipts', 'expense-receipts', false, 5242880)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

-- Same helper as 0012 with the new bucket: admin only. Unknown buckets stay denied.
create or replace function public.can_access_bucket(bucket text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case bucket
    when 'rfq-files'         then public.current_user_role() is not null
    when 'gst-receipts'      then public.current_user_role() in ('admin', 'sales')
    when 'generated-docs'    then public.current_user_role() is not null
    when 'expense-receipts'  then public.current_user_role() = 'admin'
    else false
  end
$$;
