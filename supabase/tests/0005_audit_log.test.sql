begin;
select plan(27);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- Structure
select columns_are('public', 'audit_log',
  array['id', 'table_name', 'record_id', 'action', 'changed_by', 'changed_at', 'old_value', 'new_value'],
  'audit_log has the section 2.22 columns');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'RLS is enabled on audit_log');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'audit_log'),
  array['audit_log_select_admin'], 'audit_log has only the admin SELECT policy');

-- Grants (section 10: admin read; nobody writes from the client)
select ok(not (has_table_privilege('anon', 'public.audit_log', 'SELECT')
            or has_table_privilege('anon', 'public.audit_log', 'INSERT')
            or has_table_privilege('anon', 'public.audit_log', 'UPDATE')
            or has_table_privilege('anon', 'public.audit_log', 'DELETE')),
  'anon has no privileges on audit_log');
select ok(has_table_privilege('authenticated', 'public.audit_log', 'SELECT'),
  'authenticated has SELECT (RLS narrows it to admin)');
select ok(not (has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
            or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
            or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
            or has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE')),
  'authenticated has no write privileges on audit_log');
select ok(has_table_privilege('service_role', 'public.audit_log', 'SELECT')
      and has_table_privilege('service_role', 'public.audit_log', 'INSERT')
      and not (has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
            or has_table_privilege('service_role', 'public.audit_log', 'DELETE')
            or has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE')),
  'service_role is append-only: SELECT and INSERT, no UPDATE/DELETE/TRUNCATE');

-- Trigger function hardening
select ok((select prosecdef from pg_proc where oid = 'public.audit_row_change()'::regprocedure),
  'audit_row_change is SECURITY DEFINER');
select ok((select array_to_string(proconfig, ',') like 'search_path=%' from pg_proc
           where oid = 'public.audit_row_change()'::regprocedure),
  'audit_row_change has a fixed search_path');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = 'public.audit_row_change()'::regprocedure and a.grantee = 0),
  'audit_row_change execute is revoked from PUBLIC');
select ok(not has_function_privilege('anon', 'public.audit_row_change()', 'execute'),
  'audit_row_change execute is revoked from anon');
select ok(not has_function_privilege('authenticated', 'public.audit_row_change()', 'execute'),
  'audit_row_change execute is revoked from authenticated');

select throws_ok($$insert into public.audit_log (table_name, record_id, action) values ('t', gen_random_uuid(), 'INSERT')$$,
  '23514', null, 'action CHECK accepts only lowercase insert/update/delete');

-- Trigger behaviour, driven as the table owner while impersonating the admin fixture
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table t_aud (id uuid primary key default gen_random_uuid(), v text);
create trigger t_aud_audit after insert or update or delete on t_aud
  for each row execute function public.audit_row_change();
insert into t_aud (id, v) values ('b0000000-0000-4000-8000-000000000001', 'a');
update t_aud set v = 'b';
delete from t_aud;

select is((select array_agg(action order by action) from public.audit_log where table_name = 't_aud'),
  array['delete', 'insert', 'update'], 'one lowercase audit row per insert, update and delete');
select is((select count(*)::int from public.audit_log
           where table_name = 't_aud' and changed_by = 'a0000000-0000-4000-8000-000000000001'), 3,
  'changed_by is auth.uid()');
select is((select count(distinct record_id)::int from public.audit_log
           where table_name = 't_aud' and record_id = 'b0000000-0000-4000-8000-000000000001'), 1,
  'record_id is the row id');
select ok((select old_value ->> 'v' = 'a' and new_value ->> 'v' = 'b'
           from public.audit_log where table_name = 't_aud' and action = 'update'),
  'update records old and new jsonb');
select ok((select old_value is null from public.audit_log where table_name = 't_aud' and action = 'insert')
      and (select new_value is null from public.audit_log where table_name = 't_aud' and action = 'delete'),
  'insert has no old_value, delete has no new_value');

-- Read access per role
set local role authenticated;
select is((select count(*)::int from public.audit_log where table_name = 't_aud'), 3, 'admin reads audit_log');
select throws_ok($$insert into public.audit_log (table_name, record_id, action) values ('t', gen_random_uuid(), 'insert')$$,
  '42501', null, 'admin cannot insert');
select throws_ok($$update public.audit_log set table_name = 'x'$$, '42501', null, 'admin cannot update');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'admin cannot delete');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'sales sees no audit_log rows');
select throws_ok($$insert into public.audit_log (table_name, record_id, action) values ('t', gen_random_uuid(), 'insert')$$,
  '42501', null, 'sales cannot insert');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'engineer sees no audit_log rows');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'deactivated user sees no audit_log rows');

reset role;
set local role anon;
select throws_ok($$select * from public.audit_log$$, '42501', null, 'anon cannot read audit_log');
reset role;

select * from finish();
rollback;
