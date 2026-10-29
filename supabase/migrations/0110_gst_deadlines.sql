-- 0110_gst_deadlines (owner answer to Q8, 2026-10-28): the dates to pay GST to FBR and to file the return are NOT fixed, so the admin
-- edits them. Until now the app hard-coded the 15th and the 18th. EXPAND-ONLY: two new tables, nothing existing changes.
--
--   gst_deadline_settings   one row (id = 1): "pay GST by day N of the following month" and "file the return by day N" (defaults 15
--                           and 18). Days 1 to 28, so every month has them.
--   gst_deadline_overrides  an optional one-off date for ONE month's GST (month = the first of the GST month, e.g. 2026-10-01 for
--                           October's GST, which falls due in November), for when FBR extends a deadline. Either date may be left
--                           empty to keep the usual day for it.
--
-- Who: admin reads and writes; sales reads (the GST page and the reminders show the dates); an engineer sees nothing GST. As 0087
-- and 0102 do, the grants mirror authenticated's to qtech_engineer (0081's coverage test requires it) and ROW SECURITY is what says
-- no: every policy admits admin (and, to read, sales) only, so an engineer's request reads no row and cannot write one.

create table public.gst_deadline_settings (
  id          smallint primary key default 1 check (id = 1),
  pay_day     smallint not null default 15 check (pay_day between 1 and 28),
  return_day  smallint not null default 18 check (return_day between 1 and 28),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users (id) on delete restrict
);

comment on table public.gst_deadline_settings is
  'Singleton (id = 1). Day of the FOLLOWING month by which GST is paid to FBR (pay_day) and the return is filed (return_day). Admin edits; admin and sales read; no engineer access (owner answer to Q8).';

insert into public.gst_deadline_settings (id) values (1);

create table public.gst_deadline_overrides (
  month       date primary key check (extract(day from month) = 1),
  pay_by      date,
  return_by   date,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users (id) on delete restrict,
  check (pay_by is not null or return_by is not null)
);

comment on table public.gst_deadline_overrides is
  'A one-off pay-by and/or file-by date for the GST of one month (month = its first day), when FBR moves a deadline. An empty date keeps the usual day from gst_deadline_settings.';

create function public.gst_deadlines_touch()
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

revoke all on function public.gst_deadlines_touch() from public, anon, authenticated;

create trigger gst_deadline_settings_touch before update on public.gst_deadline_settings
  for each row execute function public.gst_deadlines_touch();
create trigger gst_deadline_overrides_touch before insert or update on public.gst_deadline_overrides
  for each row execute function public.gst_deadlines_touch();

alter table public.gst_deadline_settings enable row level security;
alter table public.gst_deadline_overrides enable row level security;

revoke all on table public.gst_deadline_settings from public, anon, authenticated;
revoke all on table public.gst_deadline_overrides from public, anon, authenticated;
grant select, update on table public.gst_deadline_settings to authenticated, qtech_engineer;
grant select, insert, update, delete on table public.gst_deadline_overrides to authenticated, qtech_engineer;

create policy gst_deadline_settings_select on public.gst_deadline_settings for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'));
create policy gst_deadline_settings_update_admin on public.gst_deadline_settings for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');

create policy gst_deadline_overrides_select on public.gst_deadline_overrides for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'));
create policy gst_deadline_overrides_insert_admin on public.gst_deadline_overrides for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');
create policy gst_deadline_overrides_update_admin on public.gst_deadline_overrides for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy gst_deadline_overrides_delete_admin on public.gst_deadline_overrides for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');

create trigger gst_deadline_settings_audit after insert or update or delete on public.gst_deadline_settings
  for each row execute function public.audit_row_change();
create trigger gst_deadline_overrides_audit after insert or update or delete on public.gst_deadline_overrides
  for each row execute function public.audit_row_change('month');
