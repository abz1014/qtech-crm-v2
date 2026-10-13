begin;
select plan(34);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'targets',
  array['id', 'created_at', 'created_by', 'updated_at', 'user_id', 'year', 'quarter', 'target_net_pkr', 'note'],
  'targets has the section 2.23 columns');
select ok((select relrowsecurity from pg_class where oid = 'public.targets'::regclass), 'RLS is enabled on targets');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'targets'),
  array['targets_delete_admin', 'targets_insert_admin', 'targets_select_own_or_admin', 'targets_update_admin'],
  'targets policies');
select ok(not (has_table_privilege('anon', 'public.targets', 'SELECT')
            or has_table_privilege('anon', 'public.targets', 'INSERT')
            or has_table_privilege('anon', 'public.targets', 'UPDATE')
            or has_table_privilege('anon', 'public.targets', 'DELETE')),
  'anon has no privileges on targets');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.targets'::regclass
                    and tgname = 'targets_set_updated_at' and not tgisinternal),
  'targets has the updated_at trigger');

-- ------------------------------------------------------------------ constraints (as owner)
insert into public.targets (id, user_id, year, quarter, target_net_pkr, updated_at) values
  ('f1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 2026, 4, 1000000,
   '2020-01-01 00:00:00+00'),
  ('f1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 2026, 4, 500000, now());

select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000002', 2026, 4, 1)$$,
  '23505', null, 'a duplicate (user, year, quarter) is rejected');
select lives_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                  values ('a0000000-0000-4000-8000-000000000002', 2026, 3, 1),
                         ('a0000000-0000-4000-8000-000000000002', 2027, 4, 1)$$,
  'another quarter or year for the same user is accepted');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000001', 2026, 0, 1)$$,
  '23514', null, 'quarter 0 is rejected');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000001', 2026, 5, 1)$$,
  '23514', null, 'quarter 5 is rejected');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000001', 2019, 1, 1)$$,
  '23514', null, 'year 2019 is rejected');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000001', 2101, 1, 1)$$,
  '23514', null, 'year 2101 is rejected');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000001', 2026, 1, 0)$$,
  '23514', null, 'a zero target is rejected');
select throws_ok($$insert into public.targets (user_id, year, quarter)
                   values ('a0000000-0000-4000-8000-000000000001', 2026, 1)$$,
  '23502', null, 'the target amount is required');
select lives_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                  values ('a0000000-0000-4000-8000-000000000001', 2026, 1, 250000)$$,
  'an admin can have a target too, and the note is optional');
update public.targets set note = 'touched' where id = 'f1000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.targets
           where id = 'f1000000-0000-4000-8000-000000000001'),
  'updated_at is bumped by the trigger');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.targets), 3, 'sales sees only their own targets');
select is((select count(*)::int from public.targets where user_id <> 'a0000000-0000-4000-8000-000000000002'), 0,
  'sales sees no one else''s target');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000002', 2030, 1, 1)$$,
  '42501', null, 'sales cannot set a target, even their own');
select is(public.t_rows($q$update public.targets set target_net_pkr = 9999999$q$), 0, 'sales cannot update targets');
select is(public.t_rows($q$delete from public.targets$q$), 0, 'sales cannot delete targets');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.targets), 1, 'engineer sees only their own target');
select is((select target_net_pkr from public.targets), 500000::numeric, 'and it is the engineer''s row');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000003', 2030, 1, 1)$$,
  '42501', null, 'engineer cannot set a target');
select is(public.t_rows($q$update public.targets set target_net_pkr = 1$q$), 0, 'engineer cannot update targets');
select is(public.t_rows($q$delete from public.targets$q$), 0, 'engineer cannot delete targets');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.targets), 0, 'deactivated user sees no targets');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000004', 2030, 1, 1)$$,
  '42501', null, 'deactivated user cannot insert a target');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.targets), 5, 'admin sees every target');
select lives_ok($$insert into public.targets (id, user_id, year, quarter, target_net_pkr)
                  values ('f1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000003', 2030, 1, 100)$$,
  'admin sets a target for an engineer');
select is((select created_by from public.targets where id = 'f1000000-0000-4000-8000-0000000000a1'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'created_by defaults to the caller');
select is(public.t_rows($q$update public.targets set target_net_pkr = 200
                           where id = 'f1000000-0000-4000-8000-0000000000a1'$q$), 1, 'admin updates a target');
select is(public.t_rows($q$delete from public.targets where id = 'f1000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes a target');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.targets$$, '42501', null, 'anon cannot read targets');
select throws_ok($$insert into public.targets (user_id, year, quarter, target_net_pkr)
                   values ('a0000000-0000-4000-8000-000000000002', 2030, 1, 1)$$,
  '42501', null, 'anon cannot insert a target');
reset role;

select * from finish();
rollback;
