-- 0135_imported_text_private (security fix; owner decisions in chat: "Approve all"): the old CRM's free text no longer reaches engineers.
--
-- Problem. An engineer sees no price and no supplier name (0081, 0104, 0108), but the import copies the old system's free text into
-- columns every staff role reads: orders.notes and rfqs.notes (every old note joined with "---"), and the first sentence of the old
-- notes into order_items.description / rfq_items.description. That text holds supplier breakdowns such as
-- "Supplier breakdown: • ITEM#30: <item> x6 - <supplier> @ Rs 2,505/unit". An engineer read it in the Jobs list (v_jobs.items_summary), on
-- the order page, in search and in the record history (audit_log keeps the insert image).
--
-- Decisions (owner): (1) ALL imported notes move to admin and sales, not only those with prices; (2) the item text is cleaned; (3) the same
-- text is cleaned from the change history; (4) a short gap before the "Imported note" panel exists is acceptable.
--
-- What this migration does (0078's pattern for legacy_source: a marker stays, the raw text moves to a place engineers cannot read):
--   a. public.imported_notes (table_name, row_id, parent_id, note, stored_at): the ORIGINAL text, nothing lost. admin and sales read it
--      (row security); qtech_engineer holds no grant, so an engineer's select is refused (42501). Written only by the service role,
--      postgres and the definer/trigger functions below. Not audited (an audit row would copy the text back into audit_log).
--   b. qtech_private.clean_item_text(text): item text without "Supplier breakdown:", "ITEM#n:", the supplier (everything after " - " in a
--      breakdown line), any "@ ..." and any piece that names a price (Rs, PKR, /unit); first item kept, " +N more" for the rest. Idempotent.
--   c. qtech_private.keep_imported_text() as a BEFORE INSERT/UPDATE trigger "keep_imported_text" on orders, rfqs, order_items, rfq_items: on a
--      row with legacy_source set, written by the import (service role), postgres or a definer function, the notes (orders, rfqs) or the
--      raw description (order_items, rfq_items) go to imported_notes and the column keeps null / the cleaned text. A signed-in person
--      (authenticated, qtech_engineer) is NOT limited: what a person types on an imported order stays where they typed it.
--      An AFTER DELETE trigger removes the stored text with its row (the import deletes and re-inserts on every run; delete_order,
--      delete_rfq and the delete-job flow delete the rows, which drops the stored text with them).
--   d. qtech_private.move_imported_text(): the one-time data step (run at the end of this file; callable again, it is idempotent). For rows
--      with legacy_source set it (i) moves every orders.notes / rfqs.notes and every unclean description through the trigger, with the audit,
--      updated_at, "clear until change" and credit-guard triggers of the four tables switched off so the move writes no history row and
--      moves no timestamp or snooze, (ii) removes notes from, and cleans descriptions in, the matching audit_log rows (and
--      audit_archive.audit_log_months, where rfqs may have been archived), and raises a notice with the counts.
--   Month lock (0027) sits on payments, expenses and invoices, not on these tables; the 0065/0078/0092/0096 guards let postgres through.
--
-- ROLLBACK (text is never destroyed): drop the eight triggers (keep_imported_text and <table>_drop_imported_note on the four tables), then
--   update public.orders o set notes = n.note from public.imported_notes n where n.table_name = 'orders' and n.row_id = o.id;
--   (same for rfqs.notes; and for order_items / rfq_items: set description = n.note) with the four tables' audit triggers switched off if the
--   restored text must not show in history. What cannot be restored: the earlier versions of notes in audit_log (they equalled the stored
--   note for imported rows: the import wrote them once).

-- ================================================================ a. the table
create table public.imported_notes (
  table_name text        not null check (table_name in ('orders', 'rfqs', 'order_items', 'rfq_items')),
  row_id     uuid        not null,
  parent_id  uuid        not null,
  note       text        not null,
  stored_at  timestamptz not null default now(),
  primary key (table_name, row_id)
);

comment on table public.imported_notes is
  'The old CRM''s free text behind an imported row (0135): orders.notes, rfqs.notes, and the raw description of order_items / rfq_items '
  '(table_name + row_id name the row; parent_id is the order or RFQ it belongs to). May hold prices and supplier names. admin and sales '
  'read it; an engineer holds no grant (42501). No foreign key (as legacy_archive.legacy_rows): the AFTER DELETE trigger removes it.';

create index imported_notes_parent_idx on public.imported_notes (parent_id);

alter table public.imported_notes enable row level security;
revoke all on table public.imported_notes from public, anon, authenticated, service_role;
grant select on table public.imported_notes to authenticated;
grant select, insert, update, delete on table public.imported_notes to service_role;

-- qtech_engineer is named so 0081's coverage test (every policy for authenticated applies to it too) holds; it has no table grant, so it never gets here.
create policy imported_notes_select_staff on public.imported_notes for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'));

-- ================================================================ b. the cleaner
-- Breakdown text (it names "Supplier breakdown", "ITEM#" or a bullet) is split into pieces at bullets and line ends; each piece loses its
-- "ITEM#n:" and everything from " - " (em dash) or "@" on; a piece that still names Rs, PKR or /unit is dropped. Plain text is split at
-- " - " (em dash) only to drop a part that names a price; text with no price marker at all is returned as it is ("Gauge x1 - Batch B").
create function qtech_private.clean_item_text(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v         text;
  parts     text[];
  piece     text;
  kept      text[] := '{}';
  breakdown boolean;
  n         integer;
  -- a price: "Rs 2,505", "Rs.2505", "2505 PKR", "/unit". Not "RS-485" or "Cars".
  v_price   constant text := '(\m(rs|pkr)\.?\s*[0-9]|[0-9]\s*(rs|pkr)\M(?!-)|/unit)';
begin
  if p is null then
    return null;
  end if;
  if p !~* ('(supplier\s+breakdown|item\s*#|•|@|' || substr(v_price, 2)) then
    return p;
  end if;
  breakdown := p ~* '(supplier\s+breakdown|item\s*#|•)';
  v := regexp_replace(p, 'supplier\s+breakdown\s*:?', '', 'gi');
  if breakdown then
    parts := regexp_split_to_array(v, '\s*•\s*|\s*[\r\n]+\s*');
  else
    parts := regexp_split_to_array(v, '\s—\s');
  end if;
  foreach piece in array parts loop
    piece := regexp_replace(piece, 'item\s*#\s*\d+\s*:?\s*', '', 'gi');
    if breakdown then
      piece := regexp_replace(piece, '\s—\s.*$', '');
    end if;
    piece := regexp_replace(piece, '@.*$', '');
    piece := btrim(piece, E' 	
');
    if piece = '' or piece ~* v_price then
      continue;
    end if;
    kept := kept || piece;
  end loop;
  n := coalesce(cardinality(kept), 0);
  if n = 0 then
    return 'Imported item';
  end if;
  if breakdown then
    return kept[1] || case when n > 1 then ' +' || (n - 1)::text || ' more' else '' end;
  end if;
  return array_to_string(kept, ' — ');
end;
$$;

comment on function qtech_private.clean_item_text(text) is
  '0135: item text without supplier breakdown, supplier names after an em dash, "@ ..." and any piece that names Rs, PKR or /unit; the first item and " +N more". Idempotent.';

-- The audit images: notes leave the history of an imported order or RFQ; a description is cleaned (and its generated tokens with it).
create function qtech_private.scrub_audit_json(j jsonb, p_table text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb := j;
  d text;
begin
  if r is null or jsonb_typeof(r) <> 'object' then
    return r;
  end if;
  if p_table in ('orders', 'rfqs') then
    return r - 'notes';
  end if;
  if r ? 'description' and jsonb_typeof(r -> 'description') = 'string' then
    d := qtech_private.clean_item_text(r ->> 'description');
    r := jsonb_set(r, '{description}', to_jsonb(d));
    if r ? 'model_tokens' then
      r := jsonb_set(r, '{model_tokens}', to_jsonb(public.model_tokens(d)));
    end if;
  end if;
  return r;
end;
$$;

-- The rows that came from the import: the ones that exist now and the ones the audit log remembers as imported (a deleted one too).
create function qtech_private.imported_ids()
returns table (t text, id uuid)
language sql
stable
set search_path = ''
as $$
  select 'orders'::text, o.id from public.orders o where o.legacy_source is not null
  union select 'rfqs', r.id from public.rfqs r where r.legacy_source is not null
  union select 'order_items', i.id from public.order_items i where i.legacy_source is not null
  union select 'rfq_items', i.id from public.rfq_items i where i.legacy_source is not null
  union select a.table_name, a.record_id::uuid from public.audit_log a
        where a.table_name in ('orders', 'rfqs', 'order_items', 'rfq_items') and a.action in ('insert', 'delete')
          and jsonb_typeof(coalesce(a.new_value, a.old_value) -> 'legacy_source') = 'object'
$$;

-- ================================================================ c. the triggers
-- INVOKER on purpose: current_user is the caller (a SECURITY DEFINER function would always see its owner). A signed-in person is skipped.
create function qtech_private.keep_imported_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clean  text;
  v_parent uuid;
begin
  if new.legacy_source is null or current_user in ('authenticated', 'qtech_engineer') then
    return new;
  end if;
  if tg_table_name in ('orders', 'rfqs') then
    if new.notes is not null then
      insert into public.imported_notes (table_name, row_id, parent_id, note)
      values (tg_table_name, new.id, new.id, new.notes)
      on conflict (table_name, row_id) do update set note = excluded.note, stored_at = now();
      new.notes := null;
    end if;
  else
    v_clean := qtech_private.clean_item_text(new.description);
    if v_clean is distinct from new.description then
      -- one statement per table: a CASE would resolve both new.order_id and new.rfq_id, and each table has only one of them
      if tg_table_name = 'order_items' then
        v_parent := new.order_id;
      else
        v_parent := new.rfq_id;
      end if;
      insert into public.imported_notes (table_name, row_id, parent_id, note)
      values (tg_table_name, new.id, v_parent, new.description)
      on conflict (table_name, row_id) do update set note = excluded.note, parent_id = excluded.parent_id, stored_at = now();
      new.description := v_clean;
    end if;
  end if;
  return new;
end;
$$;

-- DEFINER: whoever deletes the row (an admin deleting an order) may not touch imported_notes.
create function qtech_private.drop_imported_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.legacy_source is not null then
    delete from public.imported_notes where table_name = tg_table_name and row_id = old.id;
  end if;
  return old;
end;
$$;

revoke all on function qtech_private.keep_imported_text() from public, anon, authenticated;
revoke all on function qtech_private.drop_imported_note() from public, anon, authenticated;
revoke all on function qtech_private.scrub_audit_json(jsonb, text) from public, anon, authenticated;
revoke all on function qtech_private.imported_ids() from public, anon, authenticated;

do $do$
declare
  t text;
begin
  foreach t in array array['orders', 'rfqs', 'order_items', 'rfq_items']
  loop
    execute format('create trigger keep_imported_text before insert or update on public.%I for each row execute function qtech_private.keep_imported_text()', t);
    execute format('create trigger %I after delete on public.%I for each row execute function qtech_private.drop_imported_note()', t || '_drop_imported_note', t);
  end loop;
end
$do$;

-- ================================================================ d. the one-time data step
create function qtech_private.move_imported_text()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_orders  integer;
  n_rfqs    integer;
  n_oi      integer;
  n_ri      integer;
  n_audit   integer := 0;
  n_archive integer := 0;
  k         integer;
  tbl       text;
begin
  -- no history row, no new updated_at, no snooze cleared, no credit check for a change that only hides text
  alter table public.orders      disable trigger orders_audit;
  alter table public.orders      disable trigger orders_set_updated_at;
  alter table public.orders      disable trigger orders_clear_until_change;
  alter table public.rfqs        disable trigger rfqs_audit;
  alter table public.rfqs        disable trigger rfqs_set_updated_at;
  alter table public.rfqs        disable trigger rfqs_clear_until_change;
  alter table public.order_items disable trigger order_items_audit;
  alter table public.order_items disable trigger order_items_credit_guard;
  alter table public.rfq_items   disable trigger rfq_items_audit;

  -- the keep_imported_text trigger does the move
  update public.orders set notes = notes where legacy_source is not null and notes is not null;
  get diagnostics n_orders = row_count;
  update public.rfqs set notes = notes where legacy_source is not null and notes is not null;
  get diagnostics n_rfqs = row_count;
  update public.order_items set description = description
  where legacy_source is not null and qtech_private.clean_item_text(description) is distinct from description;
  get diagnostics n_oi = row_count;
  update public.rfq_items set description = description
  where legacy_source is not null and qtech_private.clean_item_text(description) is distinct from description;
  get diagnostics n_ri = row_count;

  alter table public.orders      enable trigger orders_audit;
  alter table public.orders      enable trigger orders_set_updated_at;
  alter table public.orders      enable trigger orders_clear_until_change;
  alter table public.rfqs        enable trigger rfqs_audit;
  alter table public.rfqs        enable trigger rfqs_set_updated_at;
  alter table public.rfqs        enable trigger rfqs_clear_until_change;
  alter table public.order_items enable trigger order_items_audit;
  alter table public.order_items enable trigger order_items_credit_guard;
  alter table public.rfq_items   enable trigger rfq_items_audit;

  -- the history: every audit row of an imported record loses its notes / has its description cleaned
  foreach tbl in array array['orders', 'rfqs', 'order_items', 'rfq_items']
  loop
    update public.audit_log a
    set old_value = qtech_private.scrub_audit_json(a.old_value, a.table_name),
        new_value = qtech_private.scrub_audit_json(a.new_value, a.table_name)
    where a.table_name = tbl
      and a.record_id in (select x.id::text from qtech_private.imported_ids() x where x.t = a.table_name)
      and (a.old_value is distinct from qtech_private.scrub_audit_json(a.old_value, a.table_name)
           or a.new_value is distinct from qtech_private.scrub_audit_json(a.new_value, a.table_name));
    get diagnostics k = row_count;
    n_audit := n_audit + k;
  end loop;

  -- audit_archive (0075) holds old rows of rfqs: the same, element by element
  update audit_archive.audit_log_months m
  set rows = (
    select coalesce(jsonb_agg(
             case when e ->> 'table_name' in ('orders', 'rfqs', 'order_items', 'rfq_items')
                       and ((e ->> 'record_id') in (select x.id::text from qtech_private.imported_ids() x where x.t = e ->> 'table_name')
                            or jsonb_typeof(coalesce(nullif(e -> 'new_value', 'null'::jsonb), e -> 'old_value') -> 'legacy_source') = 'object')
                  then jsonb_set(jsonb_set(e, '{old_value}', coalesce(qtech_private.scrub_audit_json(e -> 'old_value', e ->> 'table_name'), 'null'::jsonb)),
                                 '{new_value}', coalesce(qtech_private.scrub_audit_json(e -> 'new_value', e ->> 'table_name'), 'null'::jsonb))
                  else e end
             order by w.ord), '[]'::jsonb)
    from jsonb_array_elements(m.rows) with ordinality as w (e, ord))
  where m.table_name in ('orders', 'rfqs', 'order_items', 'rfq_items');
  get diagnostics n_archive = row_count;

  return jsonb_build_object('orders', n_orders, 'rfqs', n_rfqs, 'order_items', n_oi, 'rfq_items', n_ri,
                            'audit_rows', n_audit, 'archive_months', n_archive);
end;
$$;

revoke all on function qtech_private.move_imported_text() from public, anon, authenticated;

do $do$
declare
  r jsonb := qtech_private.move_imported_text();
begin
  raise notice '0135: imported text moved to imported_notes: % orders, % rfqs; descriptions cleaned: % order items, % rfq items; audit rows cleaned: %; archive months rewritten: %',
    r ->> 'orders', r ->> 'rfqs', r ->> 'order_items', r ->> 'rfq_items', r ->> 'audit_rows', r ->> 'archive_months';
end
$do$;
