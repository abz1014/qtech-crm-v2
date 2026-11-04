-- 0120_backup_trash_usage: backup status, a 30-day trash for stored files, and an admin usage readout.
-- EXPAND-ONLY: new objects only (a new private schema qtech_ops with two tables, three triggers on existing tables that only INSERT into a new
-- table, and new functions). Nothing existing is altered or dropped.
--
--   1. qtech_ops.backup_status         one row: when the nightly backup last succeeded (written by the backup job, scripts/backup),
--                                          when the weekly restore drill last ran, when the owner last test-decrypted a backup.
--   2. qtech_ops.pending_file_deletes  every stored file whose record was deleted (attachments row, quotation PDF, PO PDF) is
--                                          listed here for 30 days BEFORE it is removed from storage. Nothing removes the file at
--                                          delete time any more (the client stopped calling storage.remove). The nightly backup job
--                                          (scripts/backup/purge-trash.sh) removes files past purge_after, after it has downloaded the
--                                          buckets, so a deleted file is always in at least one backup first. The file stays at its
--                                          own path meanwhile, so an admin can still open or re-attach it.
--   3. public.admin_health()               admin only: backup status + database size + storage bytes (storage.objects metadata) + trash.
--   4. public.confirm_backup_decrypt_test() admin only: "I opened last night's backup with my key" (the monthly key-custody check).
--
-- Why not rename the file into a trash/ prefix: Storage keeps each object at a physical key built from its name and a version id, so
-- renaming storage.objects rows in SQL breaks the file; moving it needs the Storage API and a service key, which must stay out of the app.
-- The tables live in qtech_ops (a new schema, not exposed by the API), so the client reads them only through the functions below.

-- ================================================================ 1. backup status
create schema qtech_ops;
comment on schema qtech_ops is '0120: not exposed by the API. Backup status, the 30-day file trash and their job functions (SECURITY DEFINER, owner only).';
revoke all on schema qtech_ops from public;

create table qtech_ops.backup_status (
  id                    smallint primary key default 1 check (id = 1),
  last_backup_at        timestamptz,
  last_backup_bytes     bigint,
  last_storage_bytes    bigint,
  last_storage_objects  bigint,
  last_drill_at         timestamptz,
  last_drill_ok         boolean,
  last_decrypt_test_at  timestamptz,
  -- When tracking began (this migration). A backup that never reports is measured from here, so a dead job warns after 2 days.
  tracking_since        timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
insert into qtech_ops.backup_status (id) values (1);
alter table qtech_ops.backup_status enable row level security;
revoke all on table qtech_ops.backup_status from public, anon, authenticated, qtech_engineer;
comment on table qtech_ops.backup_status is
  '0120: singleton. Written by scripts/backup (record_backup, record_drill) and confirm_backup_decrypt_test(); read by admin_health().';

create function qtech_ops.record_backup(p_bytes bigint, p_storage_bytes bigint, p_objects bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update qtech_ops.backup_status
     set last_backup_at = now(), last_backup_bytes = p_bytes, last_storage_bytes = p_storage_bytes,
         last_storage_objects = p_objects, updated_at = now()
   where id = 1;
$$;

create function qtech_ops.record_drill(p_ok boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update qtech_ops.backup_status set last_drill_at = now(), last_drill_ok = p_ok, updated_at = now() where id = 1;
$$;
revoke all on function qtech_ops.record_backup(bigint, bigint, bigint) from public, anon, authenticated, qtech_engineer;
revoke all on function qtech_ops.record_drill(boolean) from public, anon, authenticated, qtech_engineer;

-- ================================================================ 2. the 30-day trash for files
create table qtech_ops.pending_file_deletes (
  id           uuid primary key default gen_random_uuid(),
  bucket       text not null,
  path         text not null,
  source       text not null,
  trashed_at   timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '30 days',
  constraint pending_file_deletes_bucket_path_key unique (bucket, path)
);
create index pending_file_deletes_due_idx on qtech_ops.pending_file_deletes (purge_after);
alter table qtech_ops.pending_file_deletes enable row level security;
revoke all on table qtech_ops.pending_file_deletes from public, anon, authenticated, qtech_engineer;
comment on table qtech_ops.pending_file_deletes is
  '0120: stored files whose record was deleted, kept in storage until purge_after (30 days). The nightly backup job removes them afterwards.';

create function qtech_ops.trash_stored_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'attachments' then
    insert into qtech_ops.pending_file_deletes (bucket, path, source) values (old.bucket, old.path, 'attachments')
      on conflict (bucket, path) do nothing;
  elsif old.pdf_path is not null then
    insert into qtech_ops.pending_file_deletes (bucket, path, source) values ('generated-docs', old.pdf_path, tg_table_name)
      on conflict (bucket, path) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function qtech_ops.trash_stored_file() from public, anon, authenticated, qtech_engineer;

create trigger attachments_trash after delete on public.attachments
  for each row execute function qtech_ops.trash_stored_file();
create trigger quotations_trash after delete on public.quotations
  for each row execute function qtech_ops.trash_stored_file();
create trigger purchase_orders_trash after delete on public.purchase_orders
  for each row execute function qtech_ops.trash_stored_file();

-- The purge job (scripts/backup/purge-trash.sh, as the database owner) asks for what is due. A path that a live record points at again
-- (a file re-attached after its record was deleted) is released, never removed.
create function qtech_ops.trash_claim_due(p_limit integer default 1000)
returns table (id uuid, bucket text, path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from qtech_ops.pending_file_deletes d
   where d.purge_after <= now()
     and (exists (select 1 from public.attachments a where a.bucket = d.bucket and a.path = d.path)
          or (d.bucket = 'generated-docs'
              and (exists (select 1 from public.quotations q where q.pdf_path = d.path)
                   or exists (select 1 from public.purchase_orders p where p.pdf_path = d.path))));
  return query
    select d.id, d.bucket, d.path from qtech_ops.pending_file_deletes d
     where d.purge_after <= now() order by d.purge_after limit greatest(p_limit, 0);
end;
$$;

create function qtech_ops.trash_done(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with g as (delete from qtech_ops.pending_file_deletes where id = any (p_ids) returning 1) select count(*)::integer from g;
$$;
revoke all on function qtech_ops.trash_claim_due(integer) from public, anon, authenticated, qtech_engineer;
revoke all on function qtech_ops.trash_done(uuid[]) from public, anon, authenticated, qtech_engineer;

-- ================================================================ 3. admin readout
create function public.admin_health()
returns table (
  last_backup_at timestamptz, last_backup_bytes bigint, last_backup_storage_bytes bigint, last_backup_objects bigint,
  last_drill_at timestamptz, last_drill_ok boolean, last_decrypt_test_at timestamptz, tracking_since timestamptz,
  db_bytes bigint, storage_bytes bigint, storage_objects bigint,
  trash_files bigint, trash_oldest timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can see this.' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select s.last_backup_at, s.last_backup_bytes, s.last_storage_bytes, s.last_storage_objects,
           s.last_drill_at, s.last_drill_ok, s.last_decrypt_test_at, s.tracking_since,
           pg_catalog.pg_database_size(pg_catalog.current_database())::bigint,
           (select coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)::bigint from storage.objects o),
           (select count(*) from storage.objects o where o.metadata is not null),
           (select count(*) from qtech_ops.pending_file_deletes),
           (select min(t.trashed_at) from qtech_ops.pending_file_deletes t)
      from qtech_ops.backup_status s where s.id = 1;
end;
$$;

create function public.confirm_backup_decrypt_test()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can do this.' using errcode = '42501', hint = 'admin_only';
  end if;
  update qtech_ops.backup_status set last_decrypt_test_at = now(), updated_at = now() where id = 1;
end;
$$;

-- authenticated, and qtech_engineer too (the 0081 coverage test): each function refuses a non-admin inside.
revoke all on function public.admin_health() from public, anon, authenticated;
revoke all on function public.confirm_backup_decrypt_test() from public, anon, authenticated;
grant execute on function public.admin_health() to authenticated, qtech_engineer;
grant execute on function public.confirm_backup_decrypt_test() to authenticated, qtech_engineer;

comment on function public.admin_health() is
  '0120: admin only. Last backup / drill / decrypt test, database size (pg_database_size), storage bytes (storage.objects metadata), files waiting in the 30-day trash.';
comment on function public.confirm_backup_decrypt_test() is
  '0120: admin only. Records that the owner opened a backup with the private key (monthly key-custody check).';
