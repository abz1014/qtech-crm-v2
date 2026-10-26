-- 0100_attachments_has_prices (redesign phase 5, lane L2; owner decision 5 of 2026-10-22: engineers see no prices anywhere, and
-- the job page and its files inherit that; plan section (d) "Engineers", review 3.3). EXPAND-ONLY: one column, two policies and one
-- helper function; nothing is dropped or renamed and no existing policy changes.
--
-- 0081 closed the price COLUMNS and the generated-docs bucket (our quotation and PO PDFs) to an engineer. The files in the ordinary
-- attachments table and the rfq-files bucket were still open to every role, and some of them carry prices: the customer's PO, a
-- supplier's quote, the enquiry itself with target prices. `attachments.has_prices` tags those. An engineer reads no tagged row and no
-- tagged storage object; admin and sales are unchanged.
--
--   attachments.has_prices   boolean not null default false.
--       Backfill (owner decision 5): every EXISTING attachment is true (customer PO, supplier quote, RFQ files, and the invoice and
--       expense receipts that an engineer could never read anyway) EXCEPT files an engineer uploaded and image files on orders
--       (site photos), which stay false. A file added from now on is false until the app tags it (an upload of a customer PO or a
--       supplier quote is tagged by the Jobs screens; the tag is set by admin and sales, never by an engineer).
--   attachments_hide_priced_from_engineers   a RESTRICTIVE row-security policy for authenticated and qtech_engineer, for every
--       command: a row with has_prices is visible and writable only to someone whose role is not engineer. It is restrictive, so it
--       narrows what the existing permissive policies (0026) allow and never widens them; an engineer cannot tag a row (the check
--       refuses has_prices = true) and cannot see, change or delete a tagged one. The check reads the person's role, not the API role,
--       so it holds on every path (PostgREST runs an engineer as qtech_engineer, 0081; the storage API runs as authenticated).
--   attachment_is_priced(bucket, name)   SECURITY DEFINER (an engineer cannot read the tagged row to ask): true when a tagged
--       attachment has that bucket and path, NULL for a person without a role. Used by the storage policy below.
--   qtech_objects_hide_priced_from_engineers   a RESTRICTIVE policy on storage.objects (select, update, delete): in the rfq-files
--       bucket an engineer reaches no object whose attachment is tagged has_prices. Other buckets and other roles are untouched.
--
-- The 0081 coverage test (qtech_engineer holds what authenticated holds) is met by the grants below; pgTAP: 0100_attachments_has_prices.test.sql.

-- ================================================================ the column and its backfill
-- Added true so every existing row reads true without a rewrite and without firing a trigger; the default is then set to false.
alter table public.attachments add column has_prices boolean not null default true;
alter table public.attachments alter column has_prices set default false;

-- The audit and month-lock triggers are for a person's edits, not for this one-off tagging (it changes no file, no amount, no month):
-- no audit row per file, and no refusal for a receipt in a closed month.
alter table public.attachments disable trigger user;
update public.attachments a
set has_prices = false
where exists (select 1 from public.users u where u.id = a.created_by and u.role = 'engineer')
   or (a.order_id is not null and a.mime_type like 'image/%');
alter table public.attachments enable trigger user;

comment on column public.attachments.has_prices is
  '0100: the file shows a price (customer PO, supplier quote, enquiry with prices, our quotation or PO). An engineer reads no such row or file. Set by admin and sales, never by an engineer.';

-- ================================================================ row security: an engineer reads no priced attachment
create policy attachments_hide_priced_from_engineers on public.attachments
  as restrictive
  for all
  to authenticated, qtech_engineer
  using (not has_prices or (select public.current_user_role()) is distinct from 'engineer')
  with check (not has_prices or (select public.current_user_role()) is distinct from 'engineer');

-- ================================================================ storage: nor the file itself
create function public.attachment_is_priced(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_user_role() is null then null
    else exists (select 1 from public.attachments a where a.bucket = p_bucket and a.path = p_name and a.has_prices)
  end
$$;

comment on function public.attachment_is_priced(text, text) is
  '0100: true when a has_prices attachment is stored at that bucket and path; NULL for a person without a role. The storage policy behind it keeps an engineer away from such a file.';

revoke all on function public.attachment_is_priced(text, text) from public, anon, authenticated;
grant execute on function public.attachment_is_priced(text, text) to authenticated, qtech_engineer;

create policy qtech_objects_hide_priced_from_engineers on storage.objects
  as restrictive
  for all
  to authenticated
  using (
    bucket_id <> 'rfq-files'
    or (select public.current_user_role()) is distinct from 'engineer'
    or not coalesce(public.attachment_is_priced(bucket_id, objects.name), false)
  );
