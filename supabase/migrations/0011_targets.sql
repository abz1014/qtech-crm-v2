-- 0011_targets (S07): Revision 1 section 2.23. Admin writes; every active user reads only their own row.
-- "Achieved" is never stored; it is derived from v_payment_net later.

create table public.targets (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references public.users (id) on delete restrict,
  updated_at      timestamptz not null default now(),
  user_id         uuid not null references public.users (id) on delete restrict,
  year            smallint not null check (year between 2020 and 2100),
  quarter         smallint not null check (quarter between 1 and 4),
  target_net_pkr  numeric(14,2) not null check (target_net_pkr > 0),
  note            text,
  constraint targets_user_year_quarter_key unique (user_id, year, quarter)
);

create trigger targets_set_updated_at before update on public.targets
  for each row execute function public.set_updated_at();

alter table public.targets enable row level security;

revoke all on table public.targets from public, anon, authenticated;
grant select, insert, update, delete on table public.targets to authenticated;

create policy targets_select_own_or_admin on public.targets for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or (public.current_user_role() is not null and user_id = auth.uid())
  );
create policy targets_insert_admin on public.targets for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy targets_update_admin on public.targets for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy targets_delete_admin on public.targets for delete to authenticated
  using (public.current_user_role() = 'admin');
