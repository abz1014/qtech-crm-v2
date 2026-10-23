-- 0090 / 0091 / 0092 (batch B): the transaction-local marker settings cannot be set from outside.
--   qtech.entered_by_bypass (0092, skips guard_entered_by), qtech.history_for (0090, opens record_history_rows),
--   qtech.category_merge (0086/0091, lets expenses move category in a closed month).
-- The data API (PostgREST) cannot run set_config itself: it exposes only the schemas in supabase/config.toml (public,
-- graphql_public), and pg_catalog is not one of them; request headers become `request.header.*` settings only. So the
-- remaining way for a caller to reach a marker is a function in public that passes caller input to set_config as the
-- setting NAME or value, or that sets a marker outside the reviewed functions. This test pins both closed:
--   1. no function in public is a set_config / current_setting passthrough;
--   2. in every function in public, every set_config call has a string-literal setting name and is transaction-local (true);
--   3. each marker is set only in its reviewed functions, and the bypass marker only ever to 'on' (never from an argument);
--   4. a non-admin gets nothing from the reviewed internal reader without the mark.
-- (An API role can of course run SELECT set_config(...) in a raw SQL session; the point is that the API gives it no way to.)
begin;
select * from no_plan();

select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('set_config', 'current_setting', 'set_guc', 'set_gucs', 'exec_sql', 'execute_sql', 'run_sql')),
  0, 'no function in public passes a setting name or a statement through to the database');

select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (select count(*) from regexp_matches(p.prosrc, 'set_config\s*\(', 'g'))
                 <> (select count(*) from regexp_matches(p.prosrc, 'set_config\s*\(\s*''[a-z_.]+''\s*,', 'g'))),
  '{}'::text[], 'every set_config call in public has a literal setting name (no caller input chooses the setting)');

select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (select count(*) from regexp_matches(p.prosrc, 'set_config\s*\(', 'g'))
                 <> (select count(*) from regexp_matches(p.prosrc, 'set_config\s*\(\s*''[a-z_.]+''\s*,[^;]*,\s*true\s*\)', 'g'))),
  '{}'::text[], 'every set_config call in public is transaction-local (is_local = true): nothing outlives its request');

select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'set_config\s*\(\s*''qtech\.entered_by_bypass'''),
  array['issue_purchase_order', 'issue_quotation', 'split_order_item'],
  'qtech.entered_by_bypass is set only by the three reviewed workflow RPCs');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
           and (select count(*) from regexp_matches(p.prosrc, 'set_config\s*\(\s*''qtech\.entered_by_bypass''\s*,\s*''on''\s*,\s*true\s*\)', 'g')) <> 1
           and p.prosrc ~ 'set_config\s*\(\s*''qtech\.entered_by_bypass'''),
  0, 'each of them sets it exactly once, to the constant ''on'', for the transaction only');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'qtech\.entered_by_bypass'),
  array['guard_entered_by', 'issue_purchase_order', 'issue_quotation', 'split_order_item'],
  'the bypass marker is read only by guard_entered_by');

select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'set_config\s*\(\s*''qtech\.history_for'''),
  array['record_history', 'record_history_rows'],
  'qtech.history_for is set only by record_history (record_history_rows clears it after one use)');
select is((select coalesce(array_agg(p.proname::text order by p.proname::text), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'set_config\s*\(\s*''qtech\.category_merge'''),
  array['merge_expense_categories', 'promote_misc_title'],
  'qtech.category_merge is set only by the two admin-only re-filing RPCs');

-- the functions that set a marker are not callable by a caller who could use them to reach a marker with other input:
-- the two category RPCs refuse a non-admin inside, the workflow RPCs set the bypass only for their own writes.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',
    case persona when 'sales' then 'a0000000-0000-4000-8000-000000000002' else 'a0000000-0000-4000-8000-000000000003' end,
    'role', 'authenticated')::text, true);
  begin
    execute 'set local role ' || 'authenticated';
    execute stmt;
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  reset role;
  return r;
end $f$;

select is(pg_temp.as_(p, $q$select public.record_history_rows('rfqs', 'a0000000-0000-4000-8000-0000000000aa', null, 50)$q$), '42501',
  format('%s calling record_history_rows without the mark is refused', p))
from unnest(array['sales', 'engineer']) p;
select is(pg_temp.as_(p, $q$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'x', 'y')$q$), '42501',
  format('%s calling promote_misc_title (sets qtech.category_merge) is refused', p))
from unnest(array['sales', 'engineer']) p;
select is(pg_temp.as_(p, $q$select public.merge_expense_categories('ca7e0000-0000-4000-8000-000000000031', 'ca7e0000-0000-4000-8000-000000000010')$q$), '42501',
  format('%s calling merge_expense_categories (sets qtech.category_merge) is refused', p))
from unnest(array['sales', 'engineer']) p;

select * from finish();
rollback;
