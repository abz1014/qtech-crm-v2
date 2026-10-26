-- 0105_history_hides_priced_files (VERIFY pass, security). EXPAND-ONLY: CREATE OR REPLACE of one function (record_history_rows), patched from its
-- CURRENT definition; no table, column, grant or policy changes.
--
-- 0100 hides a has_prices attachment (a customer PO, a supplier quote) from an engineer: the row and the file. But record_history is
-- SECURITY DEFINER and reads the audit log, so an engineer who asked for the history of an RFQ or an order still got the attachment's
-- insert event, and with it the file's NAME ("Customer PO 4471.pdf"). The app hides History from engineers, so only a direct API call
-- showed it; the verify-roles check "the history an engineer can fetch names no priced file" found it.
--
-- For an engineer, an attachments event whose row is tagged has_prices (the audit row's own copy of the tag) is now dropped from the
-- history, whole. Admin and sales are unchanged. The patch changes two strings in the function (a `priced` column in the `red` step and
-- a filter in the `kept` step); a definition that does not contain them stops the migration instead of being replaced blind.
do $$
declare
  def     text := pg_catalog.pg_get_functiondef('public.record_history_rows(text, uuid, timestamptz, integer)'::regprocedure);
  patched text := def;
begin
  if def like '%priced%' then
    return;
  end if;
  patched := replace(patched,
    'select c.id, c.changed_at, c.action, c.changed_by, c.table_name, c.record_id, c.label,',
    'select c.id, c.changed_at, c.action, c.changed_by, c.table_name, c.record_id, c.label, (c.table_name = ''attachments'' and coalesce(c.new_value, c.old_value) ->> ''has_prices'' = ''true'') as priced,');
  patched := replace(patched,
    'select r.* from red r where r.was is not null or r.now is not null',
    'select r.* from red r where (r.was is not null or r.now is not null) and not ($5 = ''engineer'' and r.priced)');
  if patched = def or patched not like '%as priced,%' or patched not like '%and r.priced)%' then
    raise exception 'record_history_rows could not be patched for priced files';
  end if;
  execute patched;
end
$$;
