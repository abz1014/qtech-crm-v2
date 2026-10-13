-- 0012_attachments (S08): DATA_MODEL section 2.20 and section 10.
-- The attachments table, the private rfq-files and gst-receipts buckets, and the storage policies.
-- Audit triggers are attached in 0013 (S09).

-- ---------------------------------------------------------------- attachments [std]
create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references public.users (id) on delete restrict,
  bucket            text not null check (bucket in ('rfq-files', 'gst-receipts')),
  -- Format {parent_id}/{uuid}.{ext}
  path              text not null,
  file_name         text not null,
  mime_type         text not null,
  size_bytes        integer not null check (size_bytes <= 5242880),
  rfq_id            uuid references public.rfqs (id) on delete cascade,
  clarification_id  uuid references public.clarifications (id) on delete set null,
  invoice_id        uuid references public.invoices (id) on delete cascade,
  constraint attachments_bucket_path_key unique (bucket, path),
  -- Exactly one parent: an RFQ (optionally narrowed to a clarification) or an invoice.
  constraint attachments_one_parent check ((rfq_id is not null)::int + (invoice_id is not null)::int = 1),
  constraint attachments_clarification_needs_rfq check (clarification_id is null or rfq_id is not null),
  -- The bucket matches the parent.
  constraint attachments_bucket_matches_parent check (
    (rfq_id is not null and bucket = 'rfq-files') or (invoice_id is not null and bucket = 'gst-receipts')
  )
);

comment on table public.attachments is
  'Two attach points only: an RFQ (or one of its clarifications) or an invoice. Storage objects are removed by the app after a cascade.';

create index attachments_rfq_idx on public.attachments (rfq_id) where rfq_id is not null;
create index attachments_clarification_idx on public.attachments (clarification_id) where clarification_id is not null;
create index attachments_invoice_idx on public.attachments (invoice_id) where invoice_id is not null;

alter table public.attachments enable row level security;

revoke all on table public.attachments from public, anon, authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;

-- Section 10: RFQ and clarification attachments are open to all staff; invoice attachments to admin and sales.
create policy attachments_select_by_parent on public.attachments for select to authenticated
  using (
    case when invoice_id is not null
      then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_insert_by_parent on public.attachments for insert to authenticated
  with check (
    case when invoice_id is not null
      then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_update_by_parent on public.attachments for update to authenticated
  using (
    case when invoice_id is not null
      then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  )
  with check (
    case when invoice_id is not null
      then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );
create policy attachments_delete_by_parent on public.attachments for delete to authenticated
  using (
    case when invoice_id is not null
      then public.current_user_role() in ('admin', 'sales')
      else public.current_user_role() is not null
    end
  );

-- ---------------------------------------------------------------- storage buckets
-- Private, 5 MB per file (enforced by Storage itself, in addition to the size_bytes CHECK).
insert into storage.buckets (id, name, public, file_size_limit)
values ('rfq-files', 'rfq-files', false, 5242880),
       ('gst-receipts', 'gst-receipts', false, 5242880)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

-- Who may touch objects in which bucket. Unknown buckets are denied.
create function public.can_access_bucket(bucket text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case bucket
    when 'rfq-files'    then public.current_user_role() is not null
    when 'gst-receipts' then public.current_user_role() in ('admin', 'sales')
    else false
  end
$$;

revoke all on function public.can_access_bucket(text) from public, anon;
grant execute on function public.can_access_bucket(text) to authenticated;

create policy qtech_objects_select on storage.objects for select to authenticated
  using (public.can_access_bucket(bucket_id));
create policy qtech_objects_insert on storage.objects for insert to authenticated
  with check (public.can_access_bucket(bucket_id));
create policy qtech_objects_update on storage.objects for update to authenticated
  using (public.can_access_bucket(bucket_id)) with check (public.can_access_bucket(bucket_id));
create policy qtech_objects_delete on storage.objects for delete to authenticated
  using (public.can_access_bucket(bucket_id));
