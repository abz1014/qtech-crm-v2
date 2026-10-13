begin;
select plan(24);

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
select columns_are('public', 'snoozes',
  array['id', 'user_id', 'rule', 'subject_id', 'until_on', 'created_at'],
  'snoozes has the section 2.21 columns');
select ok((select relrowsecurity from pg_class where oid = 'public.snoozes'::regclass), 'RLS is enabled on snoozes');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'snoozes'),
  array['snoozes_delete_own', 'snoozes_insert_own', 'snoozes_select_own', 'snoozes_update_own'],
  'snoozes policies');
select ok(not (has_table_privilege('anon', 'public.snoozes', 'SELECT')
            or has_table_privilege('anon', 'public.snoozes', 'INSERT')
            or has_table_privilege('anon', 'public.snoozes', 'UPDATE')
            or has_table_privilege('anon', 'public.snoozes', 'DELETE')),
  'anon has no privileges on snoozes');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.snoozes'::regclass
                    and tgname = 'snoozes_audit' and not tgisinternal
                    and tgfoid = 'public.audit_row_change()'::regprocedure),
  'snoozes carries the audit trigger');

-- ------------------------------------------------------------------ constraints (as owner)
insert into public.snoozes (id, user_id, rule, subject_id, until_on) values
  ('51000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   'chase_customer_clarification', '99000000-0000-4000-8000-000000000001', '2030-01-01'),
  ('51000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
   'chase_customer_clarification', '99000000-0000-4000-8000-000000000001', '2030-01-01'),
  ('51000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'bid_due', '99000000-0000-4000-8000-000000000002', '2030-01-01');

select throws_ok($$insert into public.snoozes (user_id, rule, subject_id, until_on)
                   values ('a0000000-0000-4000-8000-000000000002', 'chase_customer_clarification',
                           '99000000-0000-4000-8000-000000000001', '2031-01-01')$$,
  '23505', null, 'the same (user, rule, subject) cannot be snoozed twice');
select lives_ok($$insert into public.snoozes (user_id, rule, subject_id, until_on)
                  values ('a0000000-0000-4000-8000-000000000002', 'bid_due',
                          '99000000-0000-4000-8000-000000000001', '2031-01-01')$$,
  'another rule on the same subject is accepted');
select throws_ok($$insert into public.snoozes (user_id, rule, subject_id)
                   values ('a0000000-0000-4000-8000-000000000002', 'x', gen_random_uuid())$$,
  '23502', null, 'until_on is required');
select throws_ok($$insert into public.snoozes (user_id, rule, subject_id, until_on)
                   values (gen_random_uuid(), 'x', gen_random_uuid(), '2030-01-01')$$,
  '23503', null, 'user_id must be a real user');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.snoozes), 2, 'sales sees only their own snoozes');
select lives_ok($$insert into public.snoozes (id, rule, subject_id, until_on)
                  values ('51000000-0000-4000-8000-0000000000a1', 'goods_late',
                          '99000000-0000-4000-8000-000000000003', '2030-02-01')$$,
  'user_id defaults to the caller');
select is((select user_id from public.snoozes where id = '51000000-0000-4000-8000-0000000000a1'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'and it is the caller');
select throws_ok($$insert into public.snoozes (user_id, rule, subject_id, until_on)
                   values ('a0000000-0000-4000-8000-000000000003', 'goods_late',
                           '99000000-0000-4000-8000-000000000003', '2030-02-01')$$,
  '42501', null, 'sales cannot snooze on behalf of someone else');
select is(public.t_rows($q$update public.snoozes set until_on = '2032-01-01'
                           where id = '51000000-0000-4000-8000-0000000000a1'$q$), 1, 'sales updates their own snooze');
select is(public.t_rows($q$update public.snoozes set until_on = '2032-01-01'
                           where id = '51000000-0000-4000-8000-000000000002'$q$), 0,
  'sales cannot update someone else''s snooze');
select throws_ok($$update public.snoozes set user_id = 'a0000000-0000-4000-8000-000000000003'
                   where id = '51000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'a snooze cannot be handed to another user');
select is(public.t_rows($q$delete from public.snoozes where id = '51000000-0000-4000-8000-000000000003'$q$), 0,
  'sales cannot delete someone else''s snooze');
select is(public.t_rows($q$delete from public.snoozes where id = '51000000-0000-4000-8000-0000000000a1'$q$), 1,
  'sales deletes their own snooze');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.snoozes), 1, 'engineer sees only their own snooze');
select lives_ok($$insert into public.snoozes (rule, subject_id, until_on)
                  values ('plan_commissioning', '99000000-0000-4000-8000-000000000004', '2030-02-01')$$,
  'engineer can snooze');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.snoozes), 0, 'deactivated user sees no snoozes');
select throws_ok($$insert into public.snoozes (rule, subject_id, until_on)
                   values ('x', gen_random_uuid(), '2030-01-01')$$,
  '42501', null, 'deactivated user cannot snooze');

-- ------------------------------------------------------------------ admin sees only their own too
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.snoozes), 1, 'admin sees only their own snoozes as well');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.snoozes$$, '42501', null, 'anon cannot read snoozes');
reset role;

select * from finish();
rollback;
