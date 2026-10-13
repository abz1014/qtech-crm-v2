-- 0005_audit_log (S01, part 3): DATA_MODEL section 2.22. Append-only; written only by triggers.
-- Attaching the trigger to business tables is task S09, not here.

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  old_value   jsonb,
  new_value   jsonb
);

create index audit_log_record_idx on public.audit_log (table_name, record_id, changed_at);

alter table public.audit_log enable row level security;

-- Section 10: admin read only. No client may write. service_role keeps SELECT/INSERT but not
-- UPDATE/DELETE/TRUNCATE, so the log really is append-only.
revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to authenticated;
grant select, insert on table public.audit_log to service_role;

create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.current_user_role() = 'admin');

-- Generic row-change recorder. Rows are identified by their id column.
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, (to_jsonb(old) ->> 'id')::uuid, 'delete', auth.uid(), to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, (to_jsonb(new) ->> 'id')::uuid, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, (to_jsonb(new) ->> 'id')::uuid, 'insert', auth.uid(), null, to_jsonb(new));
    return new;
  end if;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;
