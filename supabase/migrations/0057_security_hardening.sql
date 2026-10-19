-- 0057_security_hardening (P9 security review, docs/SECURITY_REVIEW.md finding H-1): an issued quotation or supplier PO
-- keeps the PDF it was issued with.
--
-- Before this migration every active user (sales and engineers included) could
--   (a) overwrite the stored PDF of an issued quotation or PO in the generated-docs bucket (storage UPDATE, used by an
--       upload with upsert), with any content and any content type, and
--   (b) point quotations.pdf_path / purchase_orders.pdf_path at any other object, or clear it (lock_issued_document
--       left pdf_path open for everyone).
-- The app opens a stored PDF by downloading it and navigating a new tab to URL.createObjectURL(blob): the blob keeps the
-- content type the uploader chose, so a file uploaded as text/html would render as a page on the app's own origin
-- (the CSP the blob document inherits blocks its scripts, but not the page itself). And the PDF is what the customer or
-- supplier receives, so replacing it silently changes an issued commercial document.
--
-- Now:
--   1. generated-docs accepts application/pdf only (the storage API refuses any other content type on upload).
--   2. A stored PDF that an issued quotation or PO points at (its pdf_path) can be overwritten, moved or renamed by an
--      admin only. Objects nobody points at yet stay open to every active user, so first generation (upload with
--      upsert, then set pdf_path) works exactly as before for sales and engineers.
--   3. pdf_path: anyone who may update the row can attach the first PDF (NULL to a path) or re-send the same path;
--      changing or clearing an attached path is admin only (42501). Writes with no signed-in user (service role,
--      maintenance) are not limited, like the other triggers.
-- Section 10 is unchanged for every other operation; S14 gains the 'issued' rows that prove 2 and 3.

-- ---------------------------------------------------------------- 1. content type
update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'generated-docs';

-- ---------------------------------------------------------------- 2. issued PDFs cannot be overwritten by non-admins
drop policy qtech_objects_update on storage.objects;
create policy qtech_objects_update on storage.objects for update to authenticated
  using (
    public.can_access_bucket(bucket_id)
    and (
      bucket_id <> 'generated-docs'
      or public.current_user_role() = 'admin'
      or not (
        exists (select 1 from public.quotations q where q.pdf_path = objects.name)
        or exists (select 1 from public.purchase_orders p where p.pdf_path = objects.name)
      )
    )
  )
  with check (public.can_access_bucket(bucket_id));

-- ---------------------------------------------------------------- 3. pdf_path: attach once, admin re-points
create or replace function public.lock_issued_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An issued document may change only its pdf_path (unchanged rule from 0022).
  if (to_jsonb(new) - 'pdf_path') is distinct from (to_jsonb(old) - 'pdf_path') then
    raise exception 'an issued % cannot be changed; issue a new revision', tg_table_name
      using errcode = '55000';
  end if;
  -- 0057: once a PDF is attached, only an admin may point the document at another file or clear it.
  if new.pdf_path is distinct from old.pdf_path
     and old.pdf_path is not null
     and auth.uid() is not null
     and public.current_user_role() is distinct from 'admin' then
    raise exception 'the PDF of this issued % is already attached; only an admin can replace it', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.lock_issued_document() from public, anon, authenticated;
