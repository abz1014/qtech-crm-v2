-- 0110_gst_deadlines: the GST pay-by and file-by days are settings the admin edits (defaults 15 and 18), with an optional one-off
-- date for one month. Admin reads and writes, sales reads, an engineer sees nothing.
begin;
select * from no_plan();

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

-- ------------------------------------------------------------------ defaults
select is((select pay_day::text || '/' || return_day::text from public.gst_deadline_settings where id = 1), '15/18', 'the defaults are the 15th and the 18th');
select is((select count(*)::int from public.gst_deadline_settings), 1, 'one settings row');
select throws_ok($$insert into public.gst_deadline_settings (id) values (2)$$, '23514', null, 'the settings are a singleton');
select throws_ok($$update public.gst_deadline_settings set pay_day = 0$$, '23514', null, 'day 0 is refused');
select throws_ok($$update public.gst_deadline_settings set return_day = 29$$, '23514', null, 'day 29 is refused: every month has the day');
select throws_ok($$insert into public.gst_deadline_overrides (month, pay_by) values ('2026-10-15', '2026-11-20')$$, '23514', null, 'an override month must be the first of a month');
select throws_ok($$insert into public.gst_deadline_overrides (month) values ('2026-10-01')$$, '23514', null, 'an override must carry at least one date');

-- ------------------------------------------------------------------ the admin (each probe is rolled back; the real writes follow, as the table owner)
select is(pg_temp.as_('admin', $q$with u as (update public.gst_deadline_settings set pay_day = 20, return_day = 25 returning pay_day, return_day) select pay_day::text || '/' || return_day::text from u$q$),
  '20/25', 'the admin changes both days');
select is(pg_temp.as_('admin', $q$with i as (insert into public.gst_deadline_overrides (month, pay_by, return_by) values ('2026-10-01', '2026-11-22', '2026-11-28') returning month) select month::text from i$q$),
  '2026-10-01', 'the admin adds a one-off date for October''s GST');
select is(pg_temp.as_('admin', $q$with i as (insert into public.gst_deadline_overrides (month, pay_by) values ('2026-10-01', '2026-11-22') returning pay_by, return_by) select pay_by::text || '|' || coalesce(return_by::text, 'usual') from i$q$),
  '2026-11-22|usual', 'and may leave one of the two dates empty');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.gst_deadline_settings set pay_day = 20, return_day = 25;
insert into public.gst_deadline_overrides (month, pay_by) values ('2026-10-01', '2026-11-22');
select is((select count(*)::int from public.audit_log where table_name = 'gst_deadline_settings' and action = 'update'), 1, 'a change of the days is in the history');
select is((select updated_by::text from public.gst_deadline_overrides where month = '2026-10-01'), 'a0000000-0000-4000-8000-000000000001', 'and who made it is kept');

-- ------------------------------------------------------------------ sales reads, never writes
select is(pg_temp.as_('sales', $q$select pay_day::text || '/' || return_day::text from public.gst_deadline_settings$q$), '20/25', 'sales reads the days');
select is(pg_temp.as_('sales', $q$select pay_by::text from public.gst_deadline_overrides where month = '2026-10-01'$q$), '2026-11-22', 'and the override');
select is(pg_temp.as_('sales', $q$with u as (update public.gst_deadline_settings set pay_day = 1 returning 1) select count(*)::text from u$q$), '<none>', 'sales cannot change the days');
select is(pg_temp.as_('sales', $q$with i as (insert into public.gst_deadline_overrides (month, pay_by) values ('2026-09-01', '2026-10-20') returning 1) select count(*)::text from i$q$), 'E:42501', 'nor add an override');
select is(pg_temp.as_('sales', $q$with d as (delete from public.gst_deadline_overrides returning 1) select count(*)::text from d$q$), '<none>', 'nor delete one');

-- ------------------------------------------------------------------ an engineer sees nothing GST
select is(pg_temp.as_('engineer', $q$select pay_day::text from public.gst_deadline_settings$q$), '<none>', 'an engineer reads no GST day');
select is(pg_temp.as_('engineer', $q$select pay_by::text from public.gst_deadline_overrides$q$), '<none>', 'and no override');
select is(pg_temp.as_('engineer', $q$with u as (update public.gst_deadline_settings set pay_day = 1 returning 1) select count(*)::text from u$q$), '<none>', 'an engineer cannot change the days');
select is(pg_temp.as_('engineer', $q$with i as (insert into public.gst_deadline_overrides (month, pay_by) values ('2026-09-01', '2026-10-20') returning 1) select count(*)::text from i$q$), 'E:42501', 'nor add an override');
select is(pg_temp.as_('deactivated', $q$select pay_day::text from public.gst_deadline_settings$q$), '<none>', 'a deactivated person reads nothing');

select * from finish();
rollback;
