-- 0055_import_support (I01, P8): two helpers for the legacy import, callable by the service role only.
--
-- audit_log is append-only: even the service role has SELECT and INSERT but no DELETE. The import deletes and reinserts
-- its own rows on every run, and every one of those writes is audited, so without a way to take them out again each dry
-- run would bury the history in thousands of "inserted by nobody" rows (BUILD_PLAN section 5: "audit rows written during
-- an import are removed afterwards by a service-role cleanup step"). These two functions are that step. Nothing else in
-- the database changes, and no client role can run either of them.

-- Removes the audit rows the import itself caused. Deliberately narrow:
--   * only ids that are version 5 UUIDs (the import's own ids; v2 makes random version 4 ids), so v2 history cannot be
--     named by mistake: anything else is refused;
--   * only rows written without a signed-in user (changed_by is null), so an edit a person made to an imported row after
--     go-live stays on record.
create function public.import_purge_audit(p_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad integer;
  v_removed bigint;
begin
  select count(*) into v_bad from unnest(p_ids) as i (id) where substr(i.id::text, 15, 1) <> '5';
  if v_bad > 0 then
    raise exception 'import_purge_audit: % id(s) are not import ids (version 5 UUIDs)', v_bad using errcode = '22023';
  end if;
  delete from public.audit_log a where a.record_id = any (p_ids) and a.changed_by is null;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- RFQ and order numbers are identities, so a delete-and-reinsert import would use up new numbers on every dry run
-- (RFQ-0177 becoming RFQ-0530). After the previous run's rows are gone, this puts both counters back to the number
-- after the highest one still in use (rows v2 made survive, so they are counted).
create function public.import_reset_numbers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform setval(pg_get_serial_sequence('public.rfqs', 'number'), coalesce((select max(r.number) from public.rfqs r), 0) + 1, false);
  perform setval(pg_get_serial_sequence('public.orders', 'number'), coalesce((select max(o.number) from public.orders o), 0) + 1, false);
end;
$$;

revoke all on function public.import_purge_audit(uuid[]) from public, anon, authenticated;
revoke all on function public.import_reset_numbers() from public, anon, authenticated;
grant execute on function public.import_purge_audit(uuid[]) to service_role;
grant execute on function public.import_reset_numbers() to service_role;

comment on function public.import_purge_audit(uuid[]) is
  'Import cleanup (service role only): deletes audit rows with changed_by null for import ids (version 5 UUIDs).';
comment on function public.import_reset_numbers() is
  'Import cleanup (service role only): restarts the RFQ and order number counters after the highest number in use.';
