-- 0102_checked_findings (plan D10 part 2): "Mistakes to fix" (Things to check) ticks stored per company, not per browser.
-- Until now an admin's "Mark as checked" lived in localStorage (src/features/money/exceptions/checked.ts), so it was per person
-- and per device. One row here means "the owner looked at this finding and it is fine", for everyone.
--
-- The key matches what checked.ts already uses: the finding's `key` (src/lib/reconciliation.ts ReconciliationException.key, for
-- example order-overpaid-in-<order id>) and its `message`. The browser stores the whole message in its key; here the message is
-- stored as message_hash (any stable digest of the message text, 1 to 128 characters; the app sends the lower-case hex SHA-256),
-- so a tick holds only while the message is the same: when the figures behind a finding change, its message changes, the hash no
-- longer matches and the finding comes back by itself. The database only stores the pair; it does not compute the hash.
--
-- Admin only (the money pages are), audited, never edited: un-tick = delete the row.

create table public.checked_findings (
  finding_key   text not null check (char_length(finding_key) between 1 and 300),
  message_hash  text not null check (char_length(message_hash) between 1 and 128),
  checked_by    uuid not null default auth.uid() references public.users (id) on delete restrict,
  checked_at    timestamptz not null default now(),
  primary key (finding_key, message_hash)
);

comment on table public.checked_findings is
  '0102: a "Mistakes to fix" finding the admin has checked and found fine, per company. finding_key = ReconciliationException.key; message_hash = a digest of its message, so a changed message brings the finding back. Admin only, audited.';

create index checked_findings_by_idx on public.checked_findings (checked_by);

-- who ticked it and when are the server's, never typed in
create function public.force_checked_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'qtech_engineer') then
    new.checked_by := auth.uid();
    new.checked_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.force_checked_by() from public, anon, authenticated;

create trigger checked_findings_force_checked_by before insert on public.checked_findings
  for each row execute function public.force_checked_by();
create trigger checked_findings_audit after insert or update or delete on public.checked_findings
  for each row execute function public.audit_row_change('finding_key', 'message_hash');

alter table public.checked_findings enable row level security;
revoke all on table public.checked_findings from public, anon, authenticated;
grant select, insert, delete on table public.checked_findings to authenticated, qtech_engineer;   -- 0081: mirrors authenticated; row security lets only an admin in

create policy checked_findings_select_admin on public.checked_findings for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy checked_findings_insert_admin on public.checked_findings for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');
create policy checked_findings_delete_admin on public.checked_findings for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
