-- 0138_recurring_auto_book: book_recurring_month() books each auto_book template on its day, once, and leaves everything else alone.
-- Fixture (2013, a year no other fixture uses; cash check in 2037). S = Salaries ca7e..0001, R = Rent ..0002, I = Internet ..0020.
--   T1 salaries  day 5  auto   -> booked on 5 May 2013, for April (0087), auto_booked
--   T2 salaries2 day 5  NOT auto -> never touched
--   T3 internet  day 20 auto   -> not on 5 May, booked on 20 May for May
--   T4 rent      day 5  auto   -> booked on 5 May for May (rent is the month paid, 0106)
--   T5 salaries3 day 7  auto, August 2013 closed -> skipped on 7 Aug
--   T6 internet2 day 5  auto, start month 2013-06 -> not booked on 5 May (April is before its start)
--   T7 paused    day 5  auto but inactive -> not booked
begin;
select * from no_plan();

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

select has_column('public', 'recurring_expenses', 'auto_book', 'recurring_expenses.auto_book exists');
select col_default_is('public', 'recurring_expenses', 'auto_book', 'false', 'the switch is off by default');
select col_default_is('public', 'expenses', 'auto_booked', 'false', 'expenses.auto_booked is false by default');

insert into public.recurring_expenses (id, label, category_id, amount, day_of_month, auto_book, active, start_month, paid_via) values
  ('01380000-0000-4000-8000-0000000000a1', '0138 T1 salaries',  'ca7e0000-0000-4000-8000-000000000001', 90000, 5,  true,  true,  null,      'bank'),
  ('01380000-0000-4000-8000-0000000000a2', '0138 T2 salaries2', 'ca7e0000-0000-4000-8000-000000000001', 80000, 5,  false, true,  null,      'bank'),
  ('01380000-0000-4000-8000-0000000000a3', '0138 T3 internet',  'ca7e0000-0000-4000-8000-000000000020', 7000,  20, true,  true,  null,      null),
  ('01380000-0000-4000-8000-0000000000a4', '0138 T4 rent',      'ca7e0000-0000-4000-8000-000000000002', 150000, 5, true,  true,  null,      'bank'),
  ('01380000-0000-4000-8000-0000000000a5', '0138 T5 salaries3', 'ca7e0000-0000-4000-8000-000000000001', 70000, 7,  true,  true,  null,      'bank'),
  ('01380000-0000-4000-8000-0000000000a6', '0138 T6 internet2', 'ca7e0000-0000-4000-8000-000000000020', 6000,  5,  true,  true,  '2013-06', 'bank'),
  ('01380000-0000-4000-8000-0000000000a7', '0138 T7 paused',    'ca7e0000-0000-4000-8000-000000000001', 60000, 5,  true,  false, null,      'bank');
insert into public.closed_months (month, closed_by) values ('2013-08-01', 'a0000000-0000-4000-8000-000000000001');

select is((select auto_book from public.recurring_expenses where id = '01380000-0000-4000-8000-0000000000a2'), false, 'a template with the switch off stays off');

-- pg_cron: no signed-in person
select set_config('request.jwt.claims', '', true);
select is(public.book_recurring_month('2013-05-05'), 2, 'on 5 May two templates are booked (T1 salaries, T4 rent)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$select paid_on::text, period::text, amount_pkr::text, auto_booked::text, description from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a1'$$,
  $$values ('2013-05-05', '2013-04', '90000.00', 'true', '0138 T1 salaries')$$, 'T1 is booked on its day, for April, flagged auto_booked');
select results_eq($$select paid_on::text, period::text, auto_booked::text from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a4'$$,
  $$values ('2013-05-05', '2013-05', 'true')$$, 'rent is for the month it is paid in');
select is((select count(*)::int from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a2'), 0, 'a template with auto_book off is untouched');
select is((select count(*)::int from public.expenses where recurring_id in ('01380000-0000-4000-8000-0000000000a3', '01380000-0000-4000-8000-0000000000a6', '01380000-0000-4000-8000-0000000000a7')), 0,
  'not its day, before its start month, or paused: nothing booked');

-- repeat-safe
select is(public.book_recurring_month('2013-05-05'), 0, 'a second run on the same day books nothing');
select is((select count(*)::int from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a1'), 1, 'still one row for T1');

-- a row recorded by hand first (Record all) is not doubled
insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via, recurring_id, period, description) values
  ('01380000-0000-4000-8000-000000000001', 7000, 'ca7e0000-0000-4000-8000-000000000020', '2013-05-19', 'bank', '01380000-0000-4000-8000-0000000000a3', '2013-05', 'by hand');
select is(public.book_recurring_month('2013-05-20'), 0, 'T3 was already recorded for May by hand: nothing is added');
select is((select auto_booked from public.expenses where id = '01380000-0000-4000-8000-000000000001'), false, 'and the hand row is not flagged');

-- closed month skipped
select is(public.book_recurring_month('2013-08-07'), 0, 'August 2013 is closed: T5 is skipped, no error');
select is((select count(*)::int from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a5'), 0, 'nothing was added to the closed month');

-- the paid_via of a template with none follows the category (T3 internet)
delete from public.expenses where id = '01380000-0000-4000-8000-000000000001';
select is(public.book_recurring_month('2013-05-20'), 1, 'with the hand row gone, T3 is booked on 20 May');
select is((select paid_via from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a3'),
          (select default_paid_via from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000020'), 'a template with no way of paying follows its category');

-- who may call it
select is(pg_temp.as_('sales', $q$select public.book_recurring_month('2013-05-05')$q$), '42501', 'sales are refused');
select is(pg_temp.as_('engineer', $q$select public.book_recurring_month('2013-05-05')$q$), '42501', 'an engineer is refused');
select is(pg_temp.as_('admin', $q$select public.book_recurring_month('2013-05-05')$q$), 'ok', 'an admin may call it');
select ok(not has_function_privilege('anon', 'public.book_recurring_month(date)', 'execute'), 'anon cannot execute it');
select ok(exists (select 1 from pg_proc p where p.oid = 'public.book_recurring_month(date)'::regprocedure and p.prosecdef
                  and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 'it is SECURITY DEFINER with a pinned search_path');

-- a person's change confirms the row; confirming in a closed month is allowed (the month is not touched)
select is((select auto_booked from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a1'), true, 'T1 row is still unconfirmed');
update public.expenses set bank_month = '2013-05-01' where recurring_id = '01380000-0000-4000-8000-0000000000a1';
select is((select auto_booked from public.expenses where recurring_id = '01380000-0000-4000-8000-0000000000a1'), false, 'ticking it against the bank statement confirms it');

-- cash in hand ignores an unconfirmed auto-booked cash row until it is confirmed (2037, later than any other fixture)
insert into public.cash_counts (counted_pkr, expected_pkr, counted_on) values (1000, 1, '2037-01-01');
insert into public.recurring_expenses (id, label, category_id, amount, day_of_month, auto_book, paid_via) values
  ('01380000-0000-4000-8000-0000000000b1', '0138 cash bill', 'ca7e0000-0000-4000-8000-000000000020', 300, 27, true, 'cash');
select is(public.book_recurring_month('2037-02-27'), 1, 'the cash bill is booked');
select is((select expected_pkr from public.cash_in_hand()), 1000::numeric, 'cash in hand does not count the unconfirmed auto-booked cash row');
update public.expenses set description = '0138 cash bill (checked)' where recurring_id = '01380000-0000-4000-8000-0000000000b1';
select is((select expected_pkr from public.cash_in_hand()), 700::numeric, 'once an admin has changed the row it counts as cash out');

-- the schedule: 03:00 Karachi = 22:00 UTC, or skipped without pg_cron
create function pg_temp.cron_job() returns text language plpgsql as $f$
declare r text;
begin
  if to_regnamespace('cron') is null then return 'no-cron'; end if;
  execute $q$select string_agg(schedule || '|' || command, ';') from cron.job where jobname = 'book-recurring'$q$ into r;
  return coalesce(r, 'none');
end;
$f$;
select is(pg_temp.cron_job(),
  case when to_regnamespace('cron') is null then 'no-cron' else '0 22 * * *|select public.book_recurring_month()' end,
  'book-recurring runs daily at 22:00 UTC (03:00 Karachi), or is skipped without pg_cron');

select * from finish();
rollback;
