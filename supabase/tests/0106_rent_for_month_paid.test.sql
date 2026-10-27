-- 0106_rent_for_month_paid: Rent is for the month it is paid in; rows the 0087 rule filed under the month before are re-filed when both
-- months are open and the template holds no row for the target month. The migration's UPDATE is repeated below (a migration cannot be
-- re-run from a test), so keep the two in step.
--
-- Fixture (2014, a year no other fixture uses); R = Rent ca7e..0002, S = Salaries ca7e..0001, all bank:
--   E1 rent paid 3 May,  period 2014-04                    -> re-filed to 2014-05
--   E2 salary paid 5 May, period 2014-04                   -> unchanged (other bills keep the rule)
--   E3 rent paid 4 Jun,  period 2014-06 (already this month) -> unchanged
--   E4 rent paid 12 Jun, period 2014-05 (paid after the 10th, filed for last month on purpose) -> unchanged
--   E5 rent paid 2 Aug,  period 2014-07, template T1 already holds 2014-08 (E6) -> unchanged (would clash)
--   E7 rent paid 2 Oct,  period 2014-09, October closed    -> unchanged
--   E8 rent paid 2 Dec,  period 2014-11, November closed   -> unchanged
begin;
select * from no_plan();

insert into public.recurring_expenses (id, label, category_id, amount, day_of_month, start_month) values
  ('01060000-0000-4000-8000-0000000000f1', '0106 rent', 'ca7e0000-0000-4000-8000-000000000002', 100000, 2, '2014-01');
insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via, recurring_id, period) values
  ('01060000-0000-4000-8000-000000000001', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-05-03', 'bank', null, '2014-04'),
  ('01060000-0000-4000-8000-000000000002',  90000, 'ca7e0000-0000-4000-8000-000000000001', '2014-05-05', 'bank', null, '2014-04'),
  ('01060000-0000-4000-8000-000000000003', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-06-04', 'bank', null, '2014-06'),
  ('01060000-0000-4000-8000-000000000004', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-06-12', 'bank', null, '2014-05'),
  ('01060000-0000-4000-8000-000000000005', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-08-02', 'bank', '01060000-0000-4000-8000-0000000000f1', '2014-07'),
  ('01060000-0000-4000-8000-000000000006', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-08-20', 'bank', '01060000-0000-4000-8000-0000000000f1', '2014-08'),
  ('01060000-0000-4000-8000-000000000007', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-10-02', 'bank', null, '2014-09'),
  ('01060000-0000-4000-8000-000000000008', 100000, 'ca7e0000-0000-4000-8000-000000000002', '2014-12-02', 'bank', null, '2014-11');
insert into public.closed_months (month, closed_by) values
  ('2014-10-01', 'a0000000-0000-4000-8000-000000000001'),
  ('2014-11-01', 'a0000000-0000-4000-8000-000000000001');

-- the migration's statement
update public.expenses e
set period = to_char(e.paid_on, 'YYYY-MM')
where e.category_id = 'ca7e0000-0000-4000-8000-000000000002'
  and extract(day from e.paid_on) <= 10
  and e.period = to_char(date_trunc('month', e.paid_on) - interval '1 month', 'YYYY-MM')
  and not public.month_is_closed(e.paid_on)
  and not public.month_is_closed((e.paid_on - interval '1 month')::date)
  and (e.recurring_id is null
       or not exists (
         select 1 from public.expenses x
         where x.recurring_id = e.recurring_id
           and x.period = to_char(e.paid_on, 'YYYY-MM')));

select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000001'), '2014-05', 'rent paid 3 May is for May, not April');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000002'), '2014-04', 'a salary paid 5 May stays for April');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000003'), '2014-06', 'rent already for its own month is untouched');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000004'), '2014-05', 'rent paid after the 10th and filed for last month is left as the person chose');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000005'), '2014-07', 'no re-file into a month the template already holds');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000007'), '2014-09', 'no re-file when the month paid in is closed');
select is((select period from public.expenses where id = '01060000-0000-4000-8000-000000000008'), '2014-11', 'no re-file out of a closed month');

select * from finish();
rollback;
