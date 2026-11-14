-- 0140_inquiry_asked_items (supplier flow D): a supplier can be asked about only some items of an RFQ, and the inquiry says which.
--
--   supplier_inquiries.asked_item_ids  uuid[]  the rfq_items this supplier was asked about. NULL means every item of the RFQ, which
--                                              is what every inquiry meant before this migration, so no row is rewritten.
--
-- An inquiry stays one row per supplier per RFQ (supplier_inquiries_rfq_supplier_key). Asking the same supplier about more items
-- later widens the list; asking about every item sets it back to NULL. The app writes the column with the ask ("Copy message",
-- "Record as asked"); RLS, grants and the audit trigger are the table's own (staff select, insert and update, 0008).
--
-- An array, not a child table, on purpose: removing an item from the RFQ leaves its id in the list (the app reads the list against
-- the RFQ's items), so an inquiry about only that item never turns into "asked about every item", as an empty child table would.
-- The list is never empty (NULL says "all"), and every id must be an item of the inquiry's own RFQ when it is written.
-- Expand-only: one nullable column, one check, one trigger. v_inquiry_state and v_rfq_state are unchanged.

alter table public.supplier_inquiries
  add column asked_item_ids uuid[]
    constraint supplier_inquiries_asked_item_ids_not_empty check (asked_item_ids is null or cardinality(asked_item_ids) > 0);

comment on column public.supplier_inquiries.asked_item_ids is
  '0140: the rfq_items this supplier was asked about. NULL = every item of the RFQ (all inquiries before 0140).';

-- INVOKER: the caller can read the RFQ's items (rfq_items is readable by every staff role), so the check sees what they see.
create function qtech_private.check_inquiry_asked_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asked_item_ids is not null and exists (
    select 1
      from unnest(new.asked_item_ids) as a(item_id)
     where not exists (select 1 from public.rfq_items i where i.id = a.item_id and i.rfq_id = new.rfq_id)
  ) then
    raise exception 'An item asked about is not an item of this RFQ.' using errcode = '23503';
  end if;
  return new;
end
$$;

create trigger supplier_inquiries_asked_items_check
  before insert or update of asked_item_ids, rfq_id on public.supplier_inquiries
  for each row execute function qtech_private.check_inquiry_asked_items();

revoke all on function qtech_private.check_inquiry_asked_items() from public, anon, authenticated;
