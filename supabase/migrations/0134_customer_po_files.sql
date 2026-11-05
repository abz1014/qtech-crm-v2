-- 0134_customer_po_files: a place for the customer's PO document itself (the purchase order the customer sends us), on an order.
-- EXPAND-ONLY: one column, one check and one partial index on public.attachments. No new bucket and no new policy: the file lives in
-- rfq-files like every order file, and it is hidden from engineers by the 0100 machinery (has_prices) alone.
--
--   attachments.is_customer_po   boolean not null default false. True marks the file as the customer's PO document.
--   attachments_customer_po_priced   check: a PO file hangs off an order and carries prices (has_prices). So the restrictive row policy
--       (0100) and the storage rule (attachment_is_priced) close it to an engineer, and nobody, the admin included, can untag it by
--       mistake. An engineer's insert is stored untagged by 0103's trigger, so it cannot become a PO file either.
--   attachments_customer_po_idx   the order page asks "the PO files of this order".
alter table public.attachments add column is_customer_po boolean not null default false;

alter table public.attachments add constraint attachments_customer_po_priced
  check (not is_customer_po or (order_id is not null and has_prices));

create index attachments_customer_po_idx on public.attachments (order_id) where is_customer_po;

comment on column public.attachments.is_customer_po is
  '0134: the file is the customer''s PO document, attached to an order. It always has_prices (checked), so an engineer reads neither the row nor the file.';
