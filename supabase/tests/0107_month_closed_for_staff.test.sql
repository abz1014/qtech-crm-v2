begin;
select * from no_plan();

-- 0107: month_closed(date) answers closed / open for any signed-in staff role (closed_months itself stays admin-only).
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.closed_months (month, closed_by) values ('2019-03-01', 'a0000000-0000-4000-8000-000000000001');

select ok(has_function_privilege('authenticated', 'public.month_closed(date)', 'execute')
      and not has_function_privilege('anon', 'public.month_closed(date)', 'execute'),
  'month_closed is granted to authenticated and not to anon');

set local role authenticated;

select is(public.month_closed(date '2019-03-15'), true, 'admin: a day in a closed month is closed');
select is(public.month_closed(date '2019-04-01'), false, 'admin: the next month is open');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.closed_months), 0, 'sales still cannot read closed_months');
select is(public.month_closed(date '2019-03-31'), true, 'sales: the last day of a closed month is closed');
select is(public.month_closed(date '2019-02-28'), false, 'sales: the month before is open');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.month_closed(date '2019-03-01'), true, 'engineer: closed month is closed');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.month_closed(date '2019-03-01')$$, '42501', null, 'a deactivated user is refused');

select * from finish();
rollback;
