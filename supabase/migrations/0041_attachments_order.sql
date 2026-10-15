-- 0041_attachments_order (R22): files on an order.
--
-- Capture's "attach to order" (and the Files panel on the order page) keep a file with an order. The new parent is
--
--   attachments.order_id   uuid FK orders ON DELETE CASCADE, like the invoice and expense parents.
--
-- Order files live in the existing private rfq-files bucket (5 MB, readable by all staff), so no storage policy changes. The
-- row-security policies already say "anything that is not an invoice or an expense is open to every active role", which now
-- also covers order files; they are not touched. Exactly one parent per row, the bucket matches the parent, and an order file
-- cannot be narrowed to a clarification (that still needs an RFQ).

alter table public.attachments add column order_id uuid references public.orders (id) on delete cascade;
create index attachments_order_idx on public.attachments (order_id) where order_id is not null;

alter table public.attachments drop constraint attachments_one_parent;
alter table public.attachments add constraint attachments_one_parent
  check ((rfq_id is not null)::int + (order_id is not null)::int + (invoice_id is not null)::int + (expense_id is not null)::int = 1);

alter table public.attachments drop constraint attachments_bucket_matches_parent;
alter table public.attachments add constraint attachments_bucket_matches_parent check (
  ((rfq_id is not null or order_id is not null) and bucket = 'rfq-files')
  or (invoice_id is not null and bucket = 'gst-receipts')
  or (expense_id is not null and bucket = 'expense-receipts')
);

comment on table public.attachments is
  'Four attach points only: an RFQ (or one of its clarifications), an order (R22), an invoice, or an expense (A6, admin only). Storage objects are removed by the app after a cascade.';
