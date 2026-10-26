-- 0097_todo_states (redesign L1, plan section "To do" and (j2)): the two stored facts the To do list needs.
-- EXPAND-ONLY: two nullable/defaulted columns, one partial index, one trigger function and four triggers. Nothing is
-- changed or removed, and nothing here depends on 0093-0095.
--
-- 1. snoozes.until_change  "Not ours to chase". A snooze with until_change = true ends by itself when the record it is
--    keyed to changes (it is not a date snooze: until_on still holds a date, the client sets it far ahead, and the change
--    deletes the row long before). subject_id is polymorphic (0017): it names an RFQ, an inquiry, an order or a supplier
--    order, so the clearing triggers sit on exactly those four tables (the same four as 0092's purge_snoozes()).
--    Snoozes belong to the person who set them (own-rows RLS), so the cleanup is a definer trigger function that deletes
--    only until_change rows keyed to the record that changed. A write that changes nothing (a column set to its own value,
--    or only updated_at moving) is not a change.
-- 2. supplier_inquiries.sent_confirmed_at  the honest "Did you send it? [Yes, sent]" stamp. sent_on only means the message
--    was copied. Table-level grants and the existing staff RLS already cover a new column: any active staff role (engineers
--    too, qtech_engineer holds the table-level UPDATE of 0081, no price column here) can stamp a row it can select; a
--    deactivated person cannot (current_user_role() is NULL).

alter table public.snoozes
  add column until_change boolean not null default false;

comment on column public.snoozes.until_change is
  '"Not ours to chase": the snooze ends when the record named by subject_id changes (AFTER UPDATE triggers on rfqs, orders, supplier_inquiries, supplier_orders delete it). until_on is then only a far-off ceiling.';

-- the clearing triggers look a snooze up by its subject, which the (user_id, rule, subject_id) key cannot serve
create index snoozes_until_change_subject_idx on public.snoozes (subject_id) where until_change;

alter table public.supplier_inquiries
  add column sent_confirmed_at timestamptz;

comment on column public.supplier_inquiries.sent_confirmed_at is
  'When a person confirmed the message to the supplier was really sent ("Yes, sent"). NULL until then; sent_on alone only means it was copied.';

-- ================================================================ clear until_change snoozes when the record changes
create function public.clear_until_change_snoozes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- updated_at moves on every write; only a change to something else counts
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    delete from public.snoozes where subject_id = new.id and until_change;
  end if;
  return null;
end;
$$;

revoke all on function public.clear_until_change_snoozes() from public, anon, authenticated;

create trigger rfqs_clear_until_change after update on public.rfqs
  for each row execute function public.clear_until_change_snoozes();
create trigger orders_clear_until_change after update on public.orders
  for each row execute function public.clear_until_change_snoozes();
create trigger supplier_inquiries_clear_until_change after update on public.supplier_inquiries
  for each row execute function public.clear_until_change_snoozes();
create trigger supplier_orders_clear_until_change after update on public.supplier_orders
  for each row execute function public.clear_until_change_snoozes();
