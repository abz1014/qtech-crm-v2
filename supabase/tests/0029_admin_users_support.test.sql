begin;
select plan(9);

-- Fixture: exactly one active admin (a0..01). Runs as the table owner, as the service role would.

select throws_ok($$update public.users set role = 'sales' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'P0001', 'the system must keep at least one active admin', 'the last admin cannot be demoted');
select throws_ok($$update public.users set deactivated_at = now() where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'P0001', 'the system must keep at least one active admin', 'the last admin cannot be deactivated');
select throws_ok($$delete from public.users where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'P0001', 'the system must keep at least one active admin', 'the last admin cannot be deleted');
select lives_ok($$update public.users set name = 'Renamed Admin' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'the last admin can still be edited otherwise');
select lives_ok($$update public.users set role = 'engineer' where id = 'a0000000-0000-4000-8000-000000000002'$$,
  'a non-admin can change role');

-- With a second active admin the first can be demoted.
select lives_ok($$update public.users set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000002'$$,
  'promoting a second admin works');
select lives_ok($$update public.users set role = 'sales' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'with another active admin, the first can be demoted');

select ok(not has_function_privilege('authenticated', 'public.revoke_user_sessions(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.revoke_user_sessions(uuid)', 'execute'),
  'clients cannot revoke sessions');
select ok(has_function_privilege('service_role', 'public.revoke_user_sessions(uuid)', 'execute'),
  'service_role can revoke sessions');

select * from finish();
rollback;
