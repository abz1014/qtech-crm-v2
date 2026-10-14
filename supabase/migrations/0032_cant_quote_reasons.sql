-- 0032_cant_quote_reasons (R07): "can't quote" is a structured record, not text in the notes.
--
-- Gate 2 decision (2026-10-14): one reason per supplier inquiry, with an optional per-item override. The RFQ-outcome
-- reports (P01) group by these reasons, and notes belong to people, so both live in columns with a fixed list of keys.
-- The words the screen shows are built from the key in the app.
--
--   supplier_inquiries.no_offer_reason   the reason for the whole inquiry. Only with no_offer_on (a reason for a refusal
--                                        that was never recorded would be a record of nothing).
--   inquiry_item_declines                a different reason for one item of that inquiry (a supplier who quotes some items
--                                        and cannot quote another, or cannot quote one for its own reason).
--
-- Keys: no_brand (doesn't carry this brand), cant_source_in_time, discontinued, wont_quote_quantity, other.
-- No data is moved: nothing wrote these reasons before this migration. v_inquiry_state and v_rfq_state are unchanged
-- (response_state still comes from no_offer_on and the quote lines); reports read the reason from the table.

alter table public.supplier_inquiries
  add column no_offer_reason text
    constraint supplier_inquiries_no_offer_reason_check
    check (no_offer_reason in ('no_brand', 'cant_source_in_time', 'discontinued', 'wont_quote_quantity', 'other')),
  add constraint supplier_inquiries_reason_needs_no_offer
    check (no_offer_reason is null or no_offer_on is not null);

comment on column public.supplier_inquiries.no_offer_reason is
  'Why the supplier cannot quote (a fixed key). Set together with no_offer_on; NULL when no reason was given.';

-- ---------------------------------------------------------------- inquiry_item_declines [L]
create table public.inquiry_item_declines (
  inquiry_id   uuid not null references public.supplier_inquiries (id) on delete cascade,
  rfq_item_id  uuid not null references public.rfq_items (id) on delete cascade,
  reason       text not null
    constraint inquiry_item_declines_reason_check
    check (reason in ('no_brand', 'cant_source_in_time', 'discontinued', 'wont_quote_quantity', 'other')),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users (id) on delete restrict,
  constraint inquiry_item_declines_pkey primary key (inquiry_id, rfq_item_id)
);

comment on table public.inquiry_item_declines is
  'A supplier cannot quote one item of an inquiry, with its own reason. Overrides supplier_inquiries.no_offer_reason for that item.';

create index inquiry_item_declines_item_idx on public.inquiry_item_declines (rfq_item_id);

alter table public.inquiry_item_declines enable row level security;

revoke all on table public.inquiry_item_declines from public, anon, authenticated;
grant select, insert, update, delete on table public.inquiry_item_declines to authenticated;

-- Same rules as supplier_quote_lines: select, insert, update and delete for every staff role.
create policy inquiry_item_declines_select_staff on public.inquiry_item_declines for select to authenticated
  using (public.current_user_role() is not null);
create policy inquiry_item_declines_insert_staff on public.inquiry_item_declines for insert to authenticated
  with check (public.current_user_role() is not null);
create policy inquiry_item_declines_update_staff on public.inquiry_item_declines for update to authenticated
  using (public.current_user_role() is not null) with check (public.current_user_role() is not null);
create policy inquiry_item_declines_delete_staff on public.inquiry_item_declines for delete to authenticated
  using (public.current_user_role() is not null);

-- The table has no id column: the audit trigger is keyed on the composite primary key (see 0013).
create trigger inquiry_item_declines_audit after insert or update or delete on public.inquiry_item_declines
  for each row execute function public.audit_row_change('inquiry_id', 'rfq_item_id');
