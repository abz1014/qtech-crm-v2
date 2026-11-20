-- 0145_quote_later: a supplier says it will quote an item later ("please wait", "advise for wait").
--
-- Owner, 20 Nov 2026: replies often price some items now and say "please wait" for the rest (one supplier on Job 183 did so for 15
-- of 31 items). Until now the app could only say "cannot offer", so those items looked the same as items nobody had answered.
--
--   inquiry_item_waits (inquiry_id, rfq_item_id)   this supplier will quote this item later. One row per item, no reason.
--
-- It is not a refusal: it is kept apart from inquiry_item_declines, so the "cannot quote" reasons the reports group by are untouched.
-- A wait ends by itself: when a price is saved for the item, or the supplier says it cannot offer it, the row is removed (two
-- triggers below). Same access as supplier_quote_lines and inquiry_item_declines: every staff role may read and write.
-- EXPAND-ONLY: one new table and two triggers (on insert or update). Nothing existing is altered; no data is moved.

create table public.inquiry_item_waits (
  inquiry_id   uuid not null references public.supplier_inquiries (id) on delete cascade,
  rfq_item_id  uuid not null references public.rfq_items (id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users (id) on delete restrict,
  constraint inquiry_item_waits_pkey primary key (inquiry_id, rfq_item_id)
);

comment on table public.inquiry_item_waits is
  'A supplier will quote one item of an inquiry later ("please wait"). Removed when a price or a decline is saved for that item.';

create index inquiry_item_waits_item_idx on public.inquiry_item_waits (rfq_item_id);

alter table public.inquiry_item_waits enable row level security;

revoke all on table public.inquiry_item_waits from public, anon, authenticated;
grant select, insert, update, delete on table public.inquiry_item_waits to authenticated;

-- The role check in the wrapped form (0074): run once per statement.
create policy inquiry_item_waits_select_staff on public.inquiry_item_waits for select to authenticated
  using ((select public.current_user_role()) is not null);
create policy inquiry_item_waits_insert_staff on public.inquiry_item_waits for insert to authenticated
  with check ((select public.current_user_role()) is not null);
create policy inquiry_item_waits_update_staff on public.inquiry_item_waits for update to authenticated
  using ((select public.current_user_role()) is not null) with check ((select public.current_user_role()) is not null);
create policy inquiry_item_waits_delete_staff on public.inquiry_item_waits for delete to authenticated
  using ((select public.current_user_role()) is not null);

-- The table has no id column: the audit trigger is keyed on the composite primary key (see 0013 and 0032).
create trigger inquiry_item_waits_audit after insert or update or delete on public.inquiry_item_waits
  for each row execute function public.audit_row_change('inquiry_id', 'rfq_item_id');

-- A price or a decline for the item ends the wait. Runs as the caller (security invoker): staff may delete waits anyway.
create function public.end_item_wait()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.inquiry_item_waits w where w.inquiry_id = new.inquiry_id and w.rfq_item_id = new.rfq_item_id;
  return new;
end;
$$;

revoke all on function public.end_item_wait() from public, anon, authenticated;

create trigger supplier_quote_lines_end_wait after insert or update of unit_price on public.supplier_quote_lines
  for each row execute function public.end_item_wait();
create trigger inquiry_item_declines_end_wait after insert or update on public.inquiry_item_declines
  for each row execute function public.end_item_wait();
