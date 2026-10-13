-- 0017_snoozes (created by S12; no earlier task owns it): DATA_MODEL section 2.21 and the section 10 row
-- "snoozes: own SIUD" for every role. A snooze hides one work-list item from its owner until a date.
-- subject_id is polymorphic with no FK, so orphans are harmless. Deactivated users fail closed because
-- current_user_role() is NULL for them.

create table public.snoozes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.users (id) on delete cascade,
  rule        text not null,
  subject_id  uuid not null,
  until_on    date not null,
  created_at  timestamptz not null default now(),
  constraint snoozes_user_rule_subject_key unique (user_id, rule, subject_id)
);

comment on table public.snoozes is
  'Per-user snooze of one work-list item (rule + subject) until until_on. Polymorphic subject_id, no FK.';

alter table public.snoozes enable row level security;

revoke all on table public.snoozes from public, anon, authenticated;
grant select, insert, update, delete on table public.snoozes to authenticated;

-- Own rows only, for every active role. Writes cannot name another user.
create policy snoozes_select_own on public.snoozes for select to authenticated
  using (public.current_user_role() is not null and user_id = auth.uid());
create policy snoozes_insert_own on public.snoozes for insert to authenticated
  with check (public.current_user_role() is not null and user_id = auth.uid());
create policy snoozes_update_own on public.snoozes for update to authenticated
  using (public.current_user_role() is not null and user_id = auth.uid())
  with check (public.current_user_role() is not null and user_id = auth.uid());
create policy snoozes_delete_own on public.snoozes for delete to authenticated
  using (public.current_user_role() is not null and user_id = auth.uid());

-- 0013's coverage test requires the audit trigger on every business table.
create trigger snoozes_audit after insert or update or delete on public.snoozes
  for each row execute function public.audit_row_change();
