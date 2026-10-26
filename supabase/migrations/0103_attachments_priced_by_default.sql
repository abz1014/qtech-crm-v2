-- 0103_attachments_priced_by_default (checkpoint 1, security). EXPAND-ONLY: one default changes and one trigger is added; nothing is
-- dropped or renamed and no policy changes.
--
-- 0100 tagged priced files (customer PO, supplier quote, enquiry, invoice and expense receipts) with attachments.has_prices and hid
-- tagged rows and objects from engineers, but a NEW row defaulted to false and the app's uploadAttachment never wrote the tag, so every
-- file uploaded since stayed readable by an engineer. The app now writes the tag (src/features/rfqs/api.ts). This is the belt and braces
-- behind it: a row that does not say is treated as priced.
--
--   attachments.has_prices   default true. A forgotten tag now hides a file from engineers instead of exposing it. Existing rows keep
--       the value they have (a default change does not rewrite rows).
--   attachments_engineer_untagged   BEFORE INSERT: when the person inserting is an engineer the row is stored untagged. An engineer
--       cannot read a tagged row, and 0100's check refuses an engineer's explicit true, so with the new default their own uploads
--       (a site photo, a nameplate, the receipt of a claim) would otherwise be refused or vanish from under them. Admin and sales
--       (and the service role, which has no role) are unaffected: they write the tag, or get true.
alter table public.attachments alter column has_prices set default true;

create function public.attachments_engineer_untagged()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select public.current_user_role()) = 'engineer' then
    new.has_prices := false;
  end if;
  return new;
end
$$;

create trigger attachments_engineer_untagged
  before insert on public.attachments
  for each row execute function public.attachments_engineer_untagged();

comment on column public.attachments.has_prices is
  '0100/0103: the file shows a price (customer PO, supplier quote, enquiry with prices, our quotation or PO, a receipt). An engineer reads no such row or file. Default true (a forgotten tag hides, never exposes); an engineer''s own uploads are stored false by trigger. Set by admin and sales, never by an engineer.';

revoke all on function public.attachments_engineer_untagged() from public, anon;
grant execute on function public.attachments_engineer_untagged() to authenticated, qtech_engineer;
