-- 0091_misc_expenses: the "Other" of every expense group takes a typed title (expenses.description), cannot be archived, removed or
-- moved, and a repeated title is promoted to a category of its own. Admin only. Fictional data (February and March 2016).
--
-- Fixture, in "Other (Office running)" (ca7e0000-0000-4000-8000-000000000031):
--   M1  10 Feb 2016  100  "Courier from shop"      (February 2016 is then closed)
--   M2   5 Mar 2016  200  " courier  FROM shop "   (the same title, spaced and cased differently)
--   M3   6 Mar 2016  300  "Tea cups"
-- Promoting "courier from shop" as "Shop courier" moves M1 and M2 (the closed month included) and nothing else; every figure of
-- February and March 2016 stays. Recent rows: "Printer ink" three times (suggested), "Door lock" twice (not), "Old thing" three
-- times 120 days ago (not).
begin;
select * from no_plan();

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return '<no error>';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ' / ' || coalesce(v_hint, '');
end;
$$;

-- ------------------------------------------------------------------ structure and seed
select has_column('public', 'expense_categories', 'is_misc', 'expense_categories.is_misc exists');
select is((select count(*)::int from public.expense_categories where is_misc), (select count(*)::int from public.expense_groups),
  'one misc category per group (every group that existed at migration time has one)');
select is((select count(*)::int from public.expense_groups g where (select count(*) from public.expense_categories c where c.group_id = g.id and c.is_misc) <> 1), 0,
  'no group has two, none has none');
select ok((select is_misc from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000010'),
  'the existing Other (ca7e...0010) is the misc category of "Bank, taxes and other"');
select results_eq(
  $$select c.name, g.name, c.grp from public.expense_categories c join public.expense_groups g on g.id = c.group_id
    where c.is_misc order by g.sort$$,
  $$values ('Other (Office running)', 'Office running', 'overhead'),
           ('Other (Vehicles)', 'Vehicles', 'overhead'),
           ('Other (Staff)', 'Staff', 'overhead'),
           ('Other', 'Bank, taxes and other', 'overhead'),
           ('Other (Order costs)', 'Order costs', 'order_cost'),
           ('Other (Owner and loans)', 'Owner and loans', 'non_pnl')$$,
  'the seeded Other categories carry the kind of their group');
select ok(exists (select 1 from pg_indexes where indexname = 'expense_categories_one_misc_per_group'), 'a partial unique index keeps it to one per group');
select ok(not has_function_privilege('authenticated', 'public.expense_categories_misc_guard()', 'execute')
      and not has_function_privilege('authenticated', 'public.expenses_misc_title()', 'execute'),
  'the trigger functions have no client grant');
select ok(not (select prosecdef from pg_proc where oid = 'public.suggest_misc_categories()'::regprocedure)
      and not (select prosecdef from pg_proc where oid = 'public.promote_misc_title(uuid, text, text)'::regprocedure)
      and has_function_privilege('authenticated', 'public.suggest_misc_categories()', 'execute')
      and not has_function_privilege('anon', 'public.suggest_misc_categories()', 'execute')
      and not has_function_privilege('anon', 'public.promote_misc_title(uuid, text, text)', 'execute'),
  'suggest_misc_categories and promote_misc_title: SECURITY INVOKER, signed-in callers only, admin checked inside');

-- ------------------------------------------------------------------ as the admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$insert into public.expenses (paid_on, amount_pkr, category_id) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000031')$$,
  '23514', 'Write what it was for, e.g. Courier from shop to office', 'a misc expense with no title is refused (23514)');
select is(pg_temp.hint_of($$insert into public.expenses (paid_on, amount_pkr, category_id) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000031')$$),
  '23514 / title_required', '... with the hint title_required');
select throws_ok($$insert into public.expenses (paid_on, amount_pkr, category_id, description) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000031', '   ')$$,
  '23514', null, 'a title of spaces is refused too');
select throws_ok($$insert into public.expenses (paid_on, amount_pkr, category_id) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000010')$$,
  '23514', 'Write what it was for, e.g. Courier from shop to office', 'the old Other (ca7e...0010) needs a title as well');
select lives_ok($$insert into public.expenses (paid_on, amount_pkr, category_id) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000002')$$,
  'a category that is not misc (Rent) still takes an expense with no description');
select lives_ok($$insert into public.expenses (paid_on, amount_pkr, category_id, description) values ('2016-03-01', 50, 'ca7e0000-0000-4000-8000-000000000032', 'Tyre air')$$,
  'a misc expense with a title is accepted');
select lives_ok($$update public.expenses set description = null where category_id = 'ca7e0000-0000-4000-8000-000000000002' and paid_on = '2016-03-01'$$,
  'a non-misc expense can still have its description cleared');
select throws_ok($$update public.expenses set description = ' ' where category_id = 'ca7e0000-0000-4000-8000-000000000032' and paid_on = '2016-03-01'$$,
  '23514', null, 'blanking the title of a misc expense is refused');
select throws_ok($$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000031'
                   where category_id = 'ca7e0000-0000-4000-8000-000000000002' and paid_on = '2016-03-01'$$,
  '23514', null, 'moving an untitled expense into a misc category is refused');
select lives_ok($$update public.expenses set description = 'Tyre air', category_id = 'ca7e0000-0000-4000-8000-000000000031'
                   where category_id = 'ca7e0000-0000-4000-8000-000000000002' and paid_on = '2016-03-01'$$,
  '... unless it is given a title in the same change');

-- an imported row with no title stays valid while it is not re-filed or re-titled
reset role;
insert into public.expenses (id, paid_on, amount_pkr, category_id, legacy_flags) values
  ('e0910000-0000-4000-8000-0000000000b1', '2016-03-02', 70, 'ca7e0000-0000-4000-8000-000000000031', array['category_unmapped']);
set local role authenticated;
select lives_ok($$update public.expenses set amount_pkr = 75 where id = 'e0910000-0000-4000-8000-0000000000b1'$$,
  'an imported misc row with no title can still change its amount (untouched category and description)');
select throws_ok($$update public.expenses set description = '' where id = 'e0910000-0000-4000-8000-0000000000b1'$$,
  '23514', null, '... but not have its description touched to nothing');
delete from public.expenses where id = 'e0910000-0000-4000-8000-0000000000b1';
delete from public.expenses where paid_on = '2016-03-01';

-- ------------------------------------------------------------------ one per group; the guard
select throws_ok($$insert into public.expense_categories (name, grp, group_id, is_misc) values ('Another other', 'overhead', 'ca7e9000-0000-4000-8000-000000000001', true)$$,
  '23505', null, 'a second misc category in a group is refused');
select throws_ok($$update public.expense_categories set active = false where id = 'ca7e0000-0000-4000-8000-000000000031'$$,
  '23514', null, 'a misc category cannot be archived');
select throws_ok($$delete from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000031'$$,
  '23514', null, 'a misc category cannot be deleted');
select throws_ok($$update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000002' where id = 'ca7e0000-0000-4000-8000-000000000031'$$,
  '23514', null, 'a misc category cannot move to another group');
select throws_ok($$update public.expense_categories set is_misc = false where id = 'ca7e0000-0000-4000-8000-000000000031'$$,
  '23514', null, 'a misc category cannot stop being misc');
select throws_ok($$select public.merge_expense_categories('ca7e0000-0000-4000-8000-000000000031', 'ca7e0000-0000-4000-8000-000000000018')$$,
  '23514', null, 'a misc category cannot be merged away');
select lives_ok($$update public.expense_categories set sort = 29 where id = 'ca7e0000-0000-4000-8000-000000000031'$$,
  'but it can be reordered');

-- ------------------------------------------------------------------ fixture for the promotion
insert into public.expenses (id, paid_on, amount_pkr, category_id, paid_via, description) values
  ('e0910000-0000-4000-8000-000000000001', '2016-02-10', 100.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Courier from shop'),
  ('e0910000-0000-4000-8000-000000000002', '2016-03-05', 200.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', ' courier  FROM shop '),
  ('e0910000-0000-4000-8000-000000000003', '2016-03-06', 300.00, 'ca7e0000-0000-4000-8000-000000000031', 'bank', 'Tea cups');

reset role;
create temp table before_fig as
select to_char(month, 'YYYY-MM') as m, money_out, expenses_count from public.v_month_cash_flow where month between '2016-02-01' and '2016-03-01';
create temp table before_pnl as
select to_char(month, 'YYYY-MM') as m, overheads, order_costs, non_pnl_out, cash_out_total from public.v_month_pnl where month between '2016-02-01' and '2016-03-01';
create temp table before_cat as
select to_char(month, 'YYYY-MM') as m, sum(gross_paid) as gross from public.v_month_expense_category where month between '2016-02-01' and '2016-03-01' group by month;
grant select on before_fig, before_pnl, before_cat to authenticated;
insert into public.closed_months (month, closed_by) values ('2016-02-01', 'a0000000-0000-4000-8000-000000000001');
set local role authenticated;

select results_eq($$select m, money_out, expenses_count from before_fig order by m$$,
  $$values ('2016-02', 100.00::numeric, 1), ('2016-03', 500.00::numeric, 2)$$, 'cash out before: February 100.00, March 500.00');
select throws_ok($$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000018' where id = 'e0910000-0000-4000-8000-000000000001'$$,
  'P0001', 'February 2016 is closed. An admin can reopen it.', 'outside a promote or merge a closed month''s expense still cannot change category');

-- ------------------------------------------------------------------ suggestions (recent rows)
insert into public.expenses (paid_on, amount_pkr, category_id, paid_via, description) values
  (public.today_pkt() - 3,  10.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Printer ink'),
  (public.today_pkt() - 4,  20.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'printer   INK'),
  (public.today_pkt() - 5,  30.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', ' Printer ink '),
  (public.today_pkt() - 6,  40.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Door lock'),
  (public.today_pkt() - 7,  50.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'door lock'),
  (public.today_pkt() - 120, 1.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Old thing'),
  (public.today_pkt() - 121, 1.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Old thing'),
  (public.today_pkt() - 122, 1.00, 'ca7e0000-0000-4000-8000-000000000031', 'cash', 'Old thing'),
  (public.today_pkt() - 2,  60.00, 'ca7e0000-0000-4000-8000-000000000002', 'cash', 'Printer ink');   -- Rent: not misc, not counted
select results_eq($$select misc_category_id::text, title_key, title, uses, spent from public.suggest_misc_categories()$$,
  $$values ('ca7e0000-0000-4000-8000-000000000031', 'printer ink', 'Printer ink', 3, 60.00::numeric)$$,
  'suggestions: only a title used 3+ times in 90 days under a misc category, normalised, with its count and gross total');

-- ------------------------------------------------------------------ promote
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000002', 'x', 'Whatever')$$, '23514', null,
  'a category that is not misc cannot be promoted from');
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'no such title', 'Whatever')$$, 'P0002', null,
  'a title nobody used is refused');
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'tea cups', 'Customs duty')$$, '23514', null,
  'an existing category of a different kind (Customs duty, order cost) is refused');
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'tea cups', 'other')$$, '23514', null,
  'a misc category cannot be the target');
select is((select count(*)::int from public.expenses where category_id = 'ca7e0000-0000-4000-8000-000000000031' and paid_on between '2016-02-01' and '2016-03-31'), 3,
  'the refused promotions moved nothing');

select is((select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'Courier  From shop', '  Shop   courier ')), 2,
  'promote "courier from shop" as "Shop courier": 2 expenses move, one of them in closed February');
select results_eq($$select c.name, c.grp, g.name, c.is_misc from public.expense_categories c join public.expense_groups g on g.id = c.group_id where c.name = 'Shop courier'$$,
  $$values ('Shop courier', 'overhead', 'Office running', false)$$, 'the new category is in the same group and kind, and is not misc');
select results_eq($$select e.description from public.expenses e join public.expense_categories c on c.id = e.category_id where c.name = 'Shop courier' order by e.paid_on$$,
  $$values ('Courier from shop'), (' courier  FROM shop ')$$, 'the descriptions are kept');
select is((select category_id::text from public.expenses where id = 'e0910000-0000-4000-8000-000000000003'), 'ca7e0000-0000-4000-8000-000000000031',
  'a different title ("Tea cups") stayed in Other');
select results_eq($$select to_char(month, 'YYYY-MM'), money_out, expenses_count from public.v_month_cash_flow where month between '2016-02-01' and '2016-03-01' order by month$$,
  $$select m, money_out, expenses_count from before_fig order by m$$, 'cash out per month is unchanged');
select results_eq($$select to_char(month, 'YYYY-MM'), overheads, order_costs, non_pnl_out, cash_out_total from public.v_month_pnl where month between '2016-02-01' and '2016-03-01' order by month$$,
  $$select m, overheads, order_costs, non_pnl_out, cash_out_total from before_pnl order by m$$, 'the P&L per month is unchanged');
select results_eq($$select to_char(month, 'YYYY-MM'), sum(gross_paid) from public.v_month_expense_category where month between '2016-02-01' and '2016-03-01' group by month order by month$$,
  $$select m, gross from before_cat order by m$$, 'the expense report totals per month are unchanged (only the category split moved)');
select throws_ok($$update public.expenses set amount_pkr = 1 where id = 'e0910000-0000-4000-8000-000000000001'$$,
  'P0001', 'February 2016 is closed. An admin can reopen it.', 'after the promotion the month lock is whole again');

select is((select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'tea cups', 'water')), 1,
  'promote into an existing category of the same name and kind (Water): no new category, 1 expense moves');
select is((select count(*)::int from public.expense_categories where lower(name) = 'water'), 1, '... still one Water');

-- ------------------------------------------------------------------ the other roles
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from public.suggest_misc_categories()$$, '42501', 'Only an admin can turn a one-off title into a category.', 'sales: cannot ask for suggestions');
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'printer ink', 'Printer ink')$$,
  '42501', 'Only an admin can turn a one-off title into a category.', 'sales: cannot promote');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.promote_misc_title('ca7e0000-0000-4000-8000-000000000031', 'printer ink', 'Printer ink')$$,
  '42501', 'Only an admin can turn a one-off title into a category.', 'engineer: cannot promote');

select * from finish();
rollback;
