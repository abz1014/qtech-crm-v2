-- 0102_checked_findings (plan D10 part 2): "Mistakes to fix" ticks stored per company, not per browser. Admin only, audited,
-- unique on (finding_key, message_hash), never edited (un-tick = delete).
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Runs stmt as the persona (role authenticated, then 0081's pre_request as PostgREST does) and returns 'ok' or the SQLSTATE.
-- A statement that row security filters to nothing does not raise, so callers also check the row count in the table.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform qtech_private.pre_request();
    execute stmt;
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  return r;
end $f$;

-- the key format the browser already uses (src/features/money/exceptions/checked.ts: finding key, then message)
select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash)
  values ('order-overpaid-in-a0000000-0000-4000-8000-000000000a01', 'f3a1c0de')$q$), 'ok', 'an admin ticks a finding');
select is((select count(*)::int from public.checked_findings), 1, 'one row');
select is((select checked_by from public.checked_findings), 'a0000000-0000-4000-8000-000000000001'::uuid, 'checked_by is the admin');
select ok((select checked_at is not null and checked_at <= now() from public.checked_findings), 'checked_at is set');

select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash, checked_by, checked_at)
  values ('invoice-negative-a0000000-0000-4000-8000-000000000a02', 'abc', 'a0000000-0000-4000-8000-000000000002', '2001-01-01')$q$), 'ok',
  'an admin who names someone else and a past time is accepted');
select is((select checked_by from public.checked_findings where finding_key like 'invoice-negative-%'), 'a0000000-0000-4000-8000-000000000001'::uuid,
  'but who ticked it is always the caller, never a name typed in');
select ok((select checked_at > now() - interval '1 minute' from public.checked_findings where finding_key like 'invoice-negative-%'), 'and when is the server''s clock');

-- unique on the pair: the same finding with the same message cannot be ticked twice; a changed message is a new pair
select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash)
  values ('order-overpaid-in-a0000000-0000-4000-8000-000000000a01', 'f3a1c0de')$q$), '23505', 'the same finding and message twice is refused (unique)');
select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash)
  values ('order-overpaid-in-a0000000-0000-4000-8000-000000000a01', '0ther')$q$), 'ok', 'the same finding with a changed message is a new tick');
select is((select count(*)::int from public.checked_findings where finding_key like 'order-overpaid-in-%'), 2, 'both are kept');

-- shape
select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash) values ('', 'x')$q$), '23514', 'an empty key is refused');
select is(pg_temp.as_('admin', $q$insert into public.checked_findings (finding_key, message_hash) values ('k', '')$q$), '23514', 'an empty hash is refused');
select is(pg_temp.as_('admin', format($q$insert into public.checked_findings (finding_key, message_hash) values ('k', %L)$q$, repeat('x', 129))), '23514',
  'a hash over 128 characters is refused');

-- admin only
select is(pg_temp.as_('sales', $q$insert into public.checked_findings (finding_key, message_hash) values ('sales-k', 'h')$q$), '42501', 'sales cannot tick');
select is(pg_temp.as_('engineer', $q$insert into public.checked_findings (finding_key, message_hash) values ('eng-k', 'h')$q$), '42501', 'an engineer cannot tick');
select is((select count(*)::int from public.checked_findings where finding_key in ('sales-k', 'eng-k')), 0, 'and nothing was stored');
select is(pg_temp.as_('sales', 'select count(*) from public.checked_findings'), 'ok', 'sales may run a select');
create function pg_temp.count_as(persona text) returns text language plpgsql as $f$
declare n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform qtech_private.pre_request();
  select count(*) into n from public.checked_findings;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  return n::text;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  return 'E:' || sqlstate;
end $f$;
select is(pg_temp.count_as('admin'), '3', 'the admin reads every tick');
select is(pg_temp.count_as('sales'), '0', 'sales read none');
select ok(pg_temp.count_as('engineer') in ('0', 'E:42501'), 'an engineer reads none');

-- never edited
select is(pg_temp.as_('admin', $q$update public.checked_findings set message_hash = 'edited' where finding_key like 'invoice-negative-%'$q$), '42501',
  'a tick cannot be edited, not even by the admin (no update privilege)');

-- un-tick = delete; admin only
select is(pg_temp.as_('sales', $q$delete from public.checked_findings where finding_key like 'invoice-negative-%'$q$), 'ok', 'sales run the delete');
select is((select count(*)::int from public.checked_findings where finding_key like 'invoice-negative-%'), 1, 'but it removes nothing');
select is(pg_temp.as_('admin', $q$delete from public.checked_findings where finding_key like 'invoice-negative-%'$q$), 'ok', 'the admin un-ticks');
select is((select count(*)::int from public.checked_findings where finding_key like 'invoice-negative-%'), 0, 'and the finding is back');

-- audited
select is((select count(*)::int from public.audit_log where table_name = 'checked_findings' and action = 'insert'
             and changed_by = 'a0000000-0000-4000-8000-000000000001'), 3, 'every tick is in the audit log, with who');
select is((select count(*)::int from public.audit_log where table_name = 'checked_findings' and action = 'delete'
             and old_value ->> 'message_hash' = 'abc'), 1, 'and so is the un-tick, with what was ticked');
select ok(exists (select 1 from public.audit_log where table_name = 'checked_findings' and record_id like '%order-overpaid-in-%' and record_id like '%f3a1c0de%'),
  'the audit key is the pair (finding_key and message_hash)');

-- grants
select ok(not has_table_privilege('anon', 'public.checked_findings', 'select'), 'anon holds nothing');
select ok(has_table_privilege('authenticated', 'public.checked_findings', 'select') and has_table_privilege('authenticated', 'public.checked_findings', 'insert')
          and has_table_privilege('authenticated', 'public.checked_findings', 'delete') and not has_table_privilege('authenticated', 'public.checked_findings', 'update'),
  'authenticated may select, insert and delete (row security lets only an admin in), never update');
select ok(has_table_privilege('qtech_engineer', 'public.checked_findings', 'select') and not has_table_privilege('qtech_engineer', 'public.checked_findings', 'update'),
  'qtech_engineer mirrors authenticated (0081 coverage); its rows are closed by row security');

select * from finish();
rollback;
