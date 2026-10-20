-- 0078_legacy_columns (roles/security verification, BUG-RV-01, BUG-RV-02, BUG-RV-03): the legacy import's columns.
--
-- BUG-RV-01 (high): legacy_source held the old CRM's raw row (old order value, cost value, GST, estimated value, quoted
--   price...) on tables every staff role reads (orders, order_items, supplier_orders, rfqs, rfq_items...). An engineer read
--   cost and margin of all imported history through it.
--   Fix: the raw row moves to legacy_archive.legacy_rows (table_name, row_id, data), a schema the API does not expose and
--   no client role can use (owner only, like audit_archive in 0075). legacy_source keeps only a marker with no money:
--   {"imported": true, "table": "<old table>"} ("table" left out when the raw row named none). Every reader of the column
--   asks only whether it is set (supplier memory "legacy", target credit 0073, FX capture 0021, default expected date
--   0067, settled_before_cutover 0068, the import's own re-run delete), so all keep working unchanged.
--   The move is done by the database, not trusted to the writer: a BEFORE INSERT/UPDATE trigger on each of the 11 tables
--   (legacy_archive.keep_legacy_source) stores whatever raw jsonb arrives in the archive and writes the marker in its place.
--   So the import (service role) may keep sending the raw row and it still never lands in a readable column. An AFTER
--   DELETE trigger removes the archived row with its row (the import deletes and re-inserts on every run).
-- BUG-RV-02: nothing guarded legacy_source. Now only the import (service role) and postgres (migrations, pg_cron, SECURITY
--   DEFINER functions) may set or change it: a signed-in person (current_user = 'authenticated') is refused, the 0065/0068
--   pattern (guard_invoice_settled_before_cutover).
-- BUG-RV-03: legacy_flags was guarded on orders only (0065, admin only). The same rule now holds on all 11 tables: inserting
--   a row with flags, or changing them, is admin only for a signed-in person. (A flag lifts NOT NULL rules: invoices with
--   a flag may have no number and no date, an RFQ with owner_unknown no owner.) orders keeps 0065 as well
--   (value_basis_unknown moves only through resolve_value_basis).

-- ================================================================ the archive
create schema legacy_archive;
comment on schema legacy_archive is
  'The legacy import''s raw rows (0078). Not exposed by the API; owner only. May hold old prices, costs and GST.';
revoke all on schema legacy_archive from public;

create table legacy_archive.legacy_rows (
  table_name  text        not null,
  row_id      uuid        not null,
  data        jsonb       not null,
  stored_at   timestamptz not null default now(),
  primary key (table_name, row_id)
);

comment on table legacy_archive.legacy_rows is
  'The old CRM row(s) behind an imported row (0078, BUG-RV-01): what the import sent as legacy_source. table_name and '
  'row_id name the row in public. Owner only: no client role (anon, authenticated, service_role) can read it.';

alter table legacy_archive.legacy_rows enable row level security;
revoke all on table legacy_archive.legacy_rows from public, anon, authenticated, service_role;

-- ================================================================ the marker
-- True for the money-free marker this migration writes: an object with "imported": true and at most a text "table".
create function legacy_archive.is_marker(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'object'
     and j -> 'imported' = 'true'::jsonb
     and (j - array['imported', 'table']) = '{}'::jsonb
     and coalesce(jsonb_typeof(j -> 'table'), 'string') = 'string'
$$;

create function legacy_archive.marker(j jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'imported', true,
    'table', case when jsonb_typeof(j) = 'object' and jsonb_typeof(j -> 'table') = 'string' then j ->> 'table' end))
$$;

revoke all on function legacy_archive.is_marker(jsonb) from public;
revoke all on function legacy_archive.marker(jsonb) from public;

-- ================================================================ the triggers
-- BUG-RV-02 and BUG-RV-03: a signed-in person may not set legacy_source, and only an admin may set legacy_flags.
create function public.guard_legacy_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.legacy_source is not null then
      raise exception 'legacy_source is set by the legacy import only' using errcode = '42501';
    end if;
    if cardinality(coalesce(new.legacy_flags, '{}')) > 0 and public.current_user_role() is distinct from 'admin' then
      raise exception 'only an admin can set legacy flags' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.legacy_source is distinct from old.legacy_source then
    raise exception 'legacy_source is set by the legacy import only' using errcode = '42501';
  end if;
  if new.legacy_flags is distinct from old.legacy_flags and public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can change legacy flags' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_legacy_columns() from public, anon, authenticated;

-- BUG-RV-01: the raw row goes to the archive, the column keeps the marker. SECURITY DEFINER: the archive is owner only.
create function legacy_archive.keep_legacy_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.legacy_source is null or legacy_archive.is_marker(new.legacy_source) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.legacy_source is not distinct from old.legacy_source then
    return new;
  end if;
  insert into legacy_archive.legacy_rows (table_name, row_id, data)
  values (tg_table_name, new.id, new.legacy_source)
  on conflict (table_name, row_id) do update set data = excluded.data, stored_at = now();
  new.legacy_source := legacy_archive.marker(new.legacy_source);
  return new;
end;
$$;

create function legacy_archive.drop_legacy_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.legacy_source is not null then
    delete from legacy_archive.legacy_rows where table_name = tg_table_name and row_id = old.id;
  end if;
  return old;
end;
$$;

revoke all on function legacy_archive.keep_legacy_source() from public, anon, authenticated;
revoke all on function legacy_archive.drop_legacy_row() from public, anon, authenticated;

do $do$
declare
  t text;
begin
  foreach t in array array['companies', 'rfqs', 'rfq_items', 'supplier_inquiries', 'supplier_quote_lines', 'orders',
                           'order_items', 'supplier_orders', 'invoices', 'payments_in', 'expenses']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.guard_legacy_columns()',
                   t || '_guard_legacy_columns', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function legacy_archive.keep_legacy_source()',
                   t || '_keep_legacy_source', t);
    execute format('create trigger %I after delete on public.%I for each row execute function legacy_archive.drop_legacy_row()',
                   t || '_drop_legacy_row', t);
    -- rows already there (none on production: the import has not run): archive the raw row, keep the marker
    execute format(
      'insert into legacy_archive.legacy_rows (table_name, row_id, data) '
      'select %L, id, legacy_source from public.%I where legacy_source is not null and not legacy_archive.is_marker(legacy_source) '
      'on conflict (table_name, row_id) do update set data = excluded.data', t, t);
    execute format(
      'update public.%I set legacy_source = legacy_archive.marker(legacy_source) '
      'where legacy_source is not null and not legacy_archive.is_marker(legacy_source)', t);
    execute format(
      'comment on column public.%I.legacy_source is %L', t,
      'Set on rows made by the legacy import: {"imported": true, "table": <old table>}. No money. The old raw row is in '
      'legacy_archive.legacy_rows (owner only, 0078). Import (service role) only.');
  end loop;
end
$do$;
