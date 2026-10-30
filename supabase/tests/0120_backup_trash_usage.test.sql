-- 0120_backup_trash_usage: the 30-day trash for stored files, the backup status row, and the admin readout.
begin;
select * from no_plan();

-- ------------------------------------------------------------------ nobody but the owner touches the private objects
select ok(not has_table_privilege('authenticated', 'qtech_private.pending_file_deletes', 'SELECT'), 'authenticated cannot read the trash table');
select ok(not has_table_privilege('authenticated', 'qtech_private.backup_status', 'SELECT'), 'authenticated cannot read the backup status table');
select ok(not has_table_privilege('anon', 'qtech_private.pending_file_deletes', 'SELECT'), 'anon cannot read the trash table');
select ok(not has_function_privilege('authenticated', 'qtech_private.record_backup(bigint, bigint, bigint)', 'execute'), 'authenticated cannot record a backup');
select ok(not has_function_privilege('authenticated', 'qtech_private.trash_claim_due(integer)', 'execute'), 'authenticated cannot claim trash');
select ok(not has_function_privilege('authenticated', 'qtech_private.trash_done(uuid[])', 'execute'), 'authenticated cannot clear trash');
select ok(not has_function_privilege('anon', 'public.admin_health()', 'execute'), 'anon cannot call admin_health');
select is((select count(*)::int from qtech_private.backup_status), 1, 'one backup status row');
select throws_ok($$insert into qtech_private.backup_status (id) values (2)$$, '23514', null, 'the status is a singleton');

-- ------------------------------------------------------------------ fixtures (as owner)
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id) values
  ('e0000000-0000-4000-8000-000000000001', 'rfq-files', '0120/a.pdf', 'a.pdf', 'application/pdf', 10, 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'rfq-files', '0120/b.pdf', 'b.pdf', 'application/pdf', 10, 'd0000000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------------ deleting a record lists its files, and removes none
select is((select count(*)::int from qtech_private.pending_file_deletes), 0, 'nothing in the trash before a delete');
delete from public.rfqs where id = 'd0000000-0000-4000-8000-000000000001';   -- the attachments cascade
select is((select array_agg(path order by path) from qtech_private.pending_file_deletes where bucket = 'rfq-files'),
  array['0120/a.pdf', '0120/b.pdf'], 'both files of the deleted RFQ are in the trash (cascaded rows included)');
select is((select count(*)::int from qtech_private.pending_file_deletes where purge_after > now() + interval '29 days 23 hours' and purge_after < now() + interval '30 days 1 hour'),
  2, 'each waits 30 days');
select is((select count(*)::int from qtech_private.trash_claim_due()), 0, 'nothing is due inside the 30 days');

-- ------------------------------------------------------------------ past 30 days: due, unless a live record points at the path again
update qtech_private.pending_file_deletes set purge_after = now() - interval '1 day';
insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
  values ('rfq-files', '0120/b.pdf', 'b.pdf', 'application/pdf', 10, 'd0000000-0000-4000-8000-000000000002');   -- re-attached
select is((select array_agg(path) from qtech_private.trash_claim_due()), array['0120/a.pdf'], 'a file a live record points at again is released, not due');
select is((select count(*)::int from qtech_private.pending_file_deletes where path = '0120/b.pdf'), 0, 'and it left the trash');
select is(qtech_private.trash_done((select array_agg(id) from qtech_private.trash_claim_due())), 1, 'trash_done clears what the job removed');
select is((select count(*)::int from qtech_private.pending_file_deletes), 0, 'the trash is empty');

-- a delete never fails or doubles: the same path twice is one row
delete from public.rfqs where id = 'd0000000-0000-4000-8000-000000000002';
select is((select count(*)::int from qtech_private.pending_file_deletes), 1, 're-deleting the re-attached file lists it once');

-- ------------------------------------------------------------------ backup status
select qtech_private.record_backup(1234, 5678, 9);
select qtech_private.record_drill(true);

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    raise exception 'done' using errcode = 'P0999', detail = coalesce(v, '<null>');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics v = pg_exception_detail;
      return v;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

select is(pg_temp.as_('admin', $q$select last_backup_bytes::text || '/' || last_backup_storage_bytes::text || '/' || last_backup_objects::text from public.admin_health()$q$),
  '1234/5678/9', 'the admin sees what the backup job recorded');
select is(pg_temp.as_('admin', $q$select last_drill_ok::text from public.admin_health()$q$), 'true', 'and the drill result');
select is(pg_temp.as_('admin', $q$select (last_backup_at > now() - interval '1 minute')::text from public.admin_health()$q$), 'true', 'last_backup_at is now');
select is(pg_temp.as_('admin', $q$select (db_bytes > 0)::text from public.admin_health()$q$), 'true', 'the database size is reported');
select is(pg_temp.as_('admin', $q$select (storage_bytes >= 0 and storage_objects >= 0)::text from public.admin_health()$q$), 'true', 'the storage bytes are reported');
select is(pg_temp.as_('admin', $q$select trash_files::text from public.admin_health()$q$), '1', 'and the files waiting in the trash');
select is(pg_temp.as_('sales', $q$select db_bytes::text from public.admin_health()$q$), 'E:42501', 'sales is refused');
select is(pg_temp.as_('engineer', $q$select db_bytes::text from public.admin_health()$q$), 'E:42501', 'an engineer is refused');

-- ------------------------------------------------------------------ the monthly decrypt-test confirmation
select is((select last_decrypt_test_at from qtech_private.backup_status), null, 'never confirmed to start with');
select is(pg_temp.as_('sales', $q$select public.confirm_backup_decrypt_test()::text$q$), 'E:42501', 'sales cannot confirm');
select is(pg_temp.as_('engineer', $q$select public.confirm_backup_decrypt_test()::text$q$), 'E:42501', 'an engineer cannot confirm');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.confirm_backup_decrypt_test()$$, 'the admin confirms');
reset role;
select ok((select last_decrypt_test_at > now() - interval '1 minute' from qtech_private.backup_status), 'and the time is stored');

select * from finish();
rollback;
