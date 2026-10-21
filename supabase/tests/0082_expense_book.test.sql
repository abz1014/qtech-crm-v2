-- 0082_expense_book: expense groups (group -> category), the kind each category takes from its group, budgets, the default
-- categories, recurring paid_via, and merge_expense_categories (closed months keep every figure). Admin only.
--
-- Fixture (July to September 2017, months no other fixture uses), all as the admin:
--   X1  5 Jul 2017  "Office tea"   (new, Office running)   1,200.00 cash  "Pantry"
--   X2 20 Jul 2017  "Water"        (seeded, Office running)  500.00 cash  "Office water"
--   X3  3 Aug 2017  "Office tea"                              800.00 bank
--   X4  9 Aug 2017  "Owner cash"   (new, Owner and loans)   5,000.00 bank
--   R1  a recurring template on "Office tea", 1,000.00 a month
-- Totals: July out 1,700.00 (overheads 1,700.00), August out 5,800.00 (overheads 800.00, not in P&L 5,000.00).
-- July 2017 is then closed. Merging "Office tea" into "Water" (both overheads) moves 2 expenses and the template, removes
-- "Office tea", and leaves every July and August figure as it was. Merging "Owner cash" (not in P&L) into "Water" is
-- refused only while it has an expense in a closed month (it has none, but "Office tea" -> "Owner cash" would: refused).
begin;
select * from no_plan();

-- ------------------------------------------------------------------ structure
select has_table('public', 'expense_groups', 'expense_groups exists');
select ok((select relrowsecurity from pg_class where oid = 'public.expense_groups'::regclass), 'row security is on');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'expense_groups'
           and coalesce(qual, with_check) ~* '\(\s*SELECT\s+(public\.)?current_user_role\(\)'), 4,
  'four admin policies, each with the wrapped role check (0074)');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid = 'public.expense_groups'::regclass and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privilege on expense_groups');
select ok(exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                  where g.tgrelid = 'public.expense_groups'::regclass and p.proname = 'audit_row_change'),
  'expense_groups is audited');
select results_eq(
  $$select id::text, name, kind, sort::int from public.expense_groups order by sort$$,
  $$values ('ca7e9000-0000-4000-8000-000000000001', 'Office running', 'overhead', 10),
           ('ca7e9000-0000-4000-8000-000000000002', 'Vehicles', 'overhead', 20),
           ('ca7e9000-0000-4000-8000-000000000003', 'Staff', 'overhead', 30),
           ('ca7e9000-0000-4000-8000-000000000004', 'Bank, taxes and other', 'overhead', 40),
           ('ca7e9000-0000-4000-8000-000000000005', 'Order costs', 'order_cost', 50),
           ('ca7e9000-0000-4000-8000-000000000006', 'Owner and loans', 'non_pnl', 60)$$,
  'six groups are seeded with fixed ids');
select is((select count(*)::int from public.expense_categories c join public.expense_groups g on g.id = c.group_id where c.grp <> g.kind), 0,
  'every category is filed under a group of its own kind');
select results_eq(
  $$select c.name, g.name from public.expense_categories c join public.expense_groups g on g.id = c.group_id
    where c.id in ('ca7e0000-0000-4000-8000-000000000001', 'ca7e0000-0000-4000-8000-000000000004', 'ca7e0000-0000-4000-8000-000000000011',
                   'ca7e0000-0000-4000-8000-000000000016', 'ca7e0000-0000-4000-8000-000000000018', 'ca7e0000-0000-4000-8000-000000000022',
                   'ca7e0000-0000-4000-8000-000000000024')
    order by c.id$$,
  $$values ('Salaries', 'Staff'), ('Fuel & travel', 'Vehicles'), ('Supplier payment', 'Order costs'), ('Owner drawings', 'Owner and loans'),
           ('Water', 'Office running'), ('Token tax', 'Vehicles'), ('Customs duty', 'Order costs')$$,
  'the 0025 seed and the new defaults sit in the expected groups');
select is((select count(*)::int from public.expense_categories where id between 'ca7e0000-0000-4000-8000-000000000018' and 'ca7e0000-0000-4000-8000-000000000024'), 7,
  'seven default categories are added (Water, Electricity, Internet and phone, Vehicle repairs, Token tax, Staff meals, Customs duty)');
select ok((select prosecdef from pg_proc where oid = 'public.merge_expense_categories(uuid, uuid)'::regprocedure)
      and has_function_privilege('authenticated', 'public.merge_expense_categories(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.merge_expense_categories(uuid, uuid)', 'execute'),
  'merge_expense_categories: SECURITY DEFINER, signed-in callers only (it checks the role itself)');
select ok(not has_function_privilege('authenticated', 'public.expense_categories_group()', 'execute')
      and not has_function_privilege('authenticated', 'public.expense_groups_kind_lock()', 'execute'),
  'the trigger functions have no client grant');

-- ------------------------------------------------------------------ as the admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$insert into public.expense_categories (id, name, grp) values ('ca7e0820-0000-4000-8000-000000000001', 'Office tea', 'overhead')$$,
  'admin: a category given only a kind (an older client) is accepted');
select is((select group_id::text from public.expense_categories where id = 'ca7e0820-0000-4000-8000-000000000001'), 'ca7e9000-0000-4000-8000-000000000001',
  '... and is filed under the first group of that kind (Office running)');
select lives_ok($$insert into public.expense_categories (id, name, grp, group_id) values
  ('ca7e0820-0000-4000-8000-000000000002', 'Owner cash', 'overhead', 'ca7e9000-0000-4000-8000-000000000006')$$,
  'admin: a category filed under a group');
select is((select grp from public.expense_categories where id = 'ca7e0820-0000-4000-8000-000000000002'), 'non_pnl',
  '... takes the group''s kind, whatever grp was sent');
select throws_ok($$update public.expense_categories set monthly_budget_pkr = 0 where id = 'ca7e0820-0000-4000-8000-000000000001'$$,
  '23514', null, 'a budget must be above zero');
select lives_ok($$update public.expense_categories set monthly_budget_pkr = 3000 where id = 'ca7e0820-0000-4000-8000-000000000001'$$,
  'admin: sets a monthly budget');
select lives_ok($$insert into public.expense_groups (id, name, kind, sort) values ('ca7e9820-0000-4000-8000-000000000001', 'Site visits', 'overhead', 70)$$,
  'admin: adds a group');
select throws_ok($$insert into public.expense_groups (name, kind) values ('  site VISITS ', 'overhead')$$, '23505', null,
  'group names are unique ignoring case and outer spaces');

insert into public.expenses (id, paid_on, amount_pkr, category_id, paid_via, description) values
  ('e0820000-0000-4000-8000-000000000001', '2017-07-05', 1200.00, 'ca7e0820-0000-4000-8000-000000000001', 'cash', 'Pantry'),
  ('e0820000-0000-4000-8000-000000000002', '2017-07-20', 500.00, 'ca7e0000-0000-4000-8000-000000000018', 'cash', 'Office water'),
  ('e0820000-0000-4000-8000-000000000003', '2017-08-03', 800.00, 'ca7e0820-0000-4000-8000-000000000001', 'bank', null),
  ('e0820000-0000-4000-8000-000000000004', '2017-08-09', 5000.00, 'ca7e0820-0000-4000-8000-000000000002', 'bank', null);
insert into public.recurring_expenses (id, label, category_id, amount, paid_via) values
  ('e0820000-0000-4000-8000-0000000000a1', 'Tea every month', 'ca7e0820-0000-4000-8000-000000000001', 1000.00, 'cash');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount, paid_via) values ('x', 'ca7e0000-0000-4000-8000-000000000018', 1, 'card')$$,
  '23514', null, 'recurring paid_via is bank or cash');

-- A group of another kind is fine while nothing is closed; back again.
select lives_ok($$update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000005' where id = 'ca7e0820-0000-4000-8000-000000000001'$$,
  'admin: moves a category to a group of another kind while no month is closed');
select is((select grp from public.expense_categories where id = 'ca7e0820-0000-4000-8000-000000000001'), 'order_cost', '... and it takes that kind');
update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000001' where id = 'ca7e0820-0000-4000-8000-000000000001';
select lives_ok($$update public.expense_categories set grp = 'non_pnl' where id = 'ca7e0000-0000-4000-8000-000000000019'$$,
  'an older client changing only grp ...');
select is((select group_id::text from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000019'), 'ca7e9000-0000-4000-8000-000000000006',
  '... moves the category to the first group of that kind');
update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000001' where id = 'ca7e0000-0000-4000-8000-000000000019';
select throws_ok($$update public.expense_groups set kind = 'order_cost' where id = 'ca7e9000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the kind of a group that holds categories cannot change');
select lives_ok($$update public.expense_groups set kind = 'order_cost' where id = 'ca7e9820-0000-4000-8000-000000000001'$$,
  'an empty group may change its kind');

-- ------------------------------------------------------------------ the figures before (kept as the owner, read back as the admin)
reset role;
create temp table before_fig as
select to_char(month, 'YYYY-MM') as m, money_out, expenses_count from public.v_month_cash_flow where month between '2017-07-01' and '2017-08-01';
create temp table before_pnl as
select to_char(month, 'YYYY-MM') as m, overheads, order_costs, non_pnl_out, cash_out_total from public.v_month_pnl where month between '2017-07-01' and '2017-08-01';
grant select on before_fig, before_pnl to authenticated;
set local role authenticated;
select results_eq($$select m, money_out, expenses_count from before_fig order by m$$,
  $$values ('2017-07', 1700.00::numeric, 2), ('2017-08', 5800.00::numeric, 2)$$, 'cash out before: July 1,700.00, August 5,800.00');
select results_eq($$select m, overheads, order_costs, non_pnl_out from before_pnl order by m$$,
  $$values ('2017-07', 1700.00::numeric, 0::numeric, 0::numeric), ('2017-08', 800.00::numeric, 0::numeric, 5000.00::numeric)$$,
  'P&L before: July overheads 1,700.00; August overheads 800.00, not in P&L 5,000.00');

-- ------------------------------------------------------------------ close July (as the table owner; close_month is covered by 0027)
reset role;
insert into public.closed_months (month, closed_by) values ('2017-07-01', 'a0000000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok($$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000018' where id = 'e0820000-0000-4000-8000-000000000001'$$,
  'P0001', 'July 2017 is closed. An admin can reopen it.', 'outside a merge, a closed month''s expense still cannot change its category');
select throws_ok($$update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000006' where id = 'ca7e0820-0000-4000-8000-000000000001'$$,
  '23514', null, 'a category with an expense in a closed month cannot move to a group of another kind');
select lives_ok($$update public.expense_categories set group_id = 'ca7e9000-0000-4000-8000-000000000003', name = 'Pantry and tea' where id = 'ca7e0820-0000-4000-8000-000000000001'$$,
  '... but may move to another group of the same kind, and be renamed');
select throws_ok($$select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000001', 'ca7e0820-0000-4000-8000-000000000002')$$,
  '23514', null, 'merge into a category of another kind is refused while the source has an expense in a closed month');
select throws_ok($$select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000001', 'ca7e0820-0000-4000-8000-000000000001')$$,
  '23514', 'Pick two different categories to merge.', 'merging a category into itself is refused');
update public.expense_categories set active = false where id = 'ca7e0000-0000-4000-8000-000000000020';
select throws_ok($$select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000001', 'ca7e0000-0000-4000-8000-000000000020')$$,
  '23514', null, 'merging into an archived category is refused');

select is((select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000001', 'ca7e0000-0000-4000-8000-000000000018')), 2,
  'merge "Pantry and tea" into "Water": 2 expenses move, one of them in closed July');
select is((select count(*)::int from public.expenses where category_id = 'ca7e0000-0000-4000-8000-000000000018' and id::text like 'e0820000%'), 3,
  'Water now holds the 3 overhead expenses');
select is((select category_id::text from public.recurring_expenses where id = 'e0820000-0000-4000-8000-0000000000a1'), 'ca7e0000-0000-4000-8000-000000000018',
  'the recurring template moved too');
select is((select count(*)::int from public.expense_categories where id = 'ca7e0820-0000-4000-8000-000000000001'), 0,
  'the emptied category is removed');
select results_eq($$select to_char(month, 'YYYY-MM'), money_out, expenses_count from public.v_month_cash_flow where month between '2017-07-01' and '2017-08-01' order by month$$,
  $$select m, money_out, expenses_count from before_fig order by m$$, 'cash out per month is unchanged by the merge (July frozen, August live)');
select results_eq($$select to_char(month, 'YYYY-MM'), overheads, order_costs, non_pnl_out, cash_out_total from public.v_month_pnl where month between '2017-07-01' and '2017-08-01' order by month$$,
  $$select m, overheads, order_costs, non_pnl_out, cash_out_total from before_pnl order by m$$, 'the P&L per month is unchanged by the merge');
select results_eq($$select to_char(month, 'YYYY-MM'), overheads, order_costs, non_pnl_out from public.v_month_pnl_live where month = '2017-07-01'$$,
  $$values ('2017-07', 1700.00::numeric, 0::numeric, 0::numeric)$$, 'the live figures of closed July still equal its snapshot');
select is((select sum(gross_paid) from public.v_month_expense_category where month = '2017-07-01'), 1700.00::numeric,
  'July''s expenses by category still add up to 1,700.00');
select throws_ok($$update public.expenses set amount_pkr = 1 where id = 'e0820000-0000-4000-8000-000000000001'$$,
  'P0001', 'July 2017 is closed. An admin can reopen it.', 'after a merge the month lock is whole again');

-- ------------------------------------------------------------------ the other roles
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.expense_groups), 0, 'sales: sees no group');
select throws_ok($$insert into public.expense_groups (name, kind) values ('sales group', 'overhead')$$, '42501', null, 'sales: cannot add a group');
select throws_ok($$select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000002', 'ca7e0000-0000-4000-8000-000000000016')$$,
  '42501', 'Only an admin can merge categories.', 'sales: cannot merge');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.expense_groups) + (select count(*)::int from public.expense_categories), 0, 'engineer: sees no group and no category');
select throws_ok($$select public.merge_expense_categories('ca7e0820-0000-4000-8000-000000000002', 'ca7e0000-0000-4000-8000-000000000016')$$,
  '42501', 'Only an admin can merge categories.', 'engineer: cannot merge');

select * from finish();
rollback;
