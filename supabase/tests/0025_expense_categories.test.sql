begin;
select * from no_plan();

-- S20 (migration 0025_expense_categories), Amendment A6.1 / A6.6.
-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.

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
select columns_are('public', 'expense_categories',
  array['id', 'created_at', 'created_by', 'name', 'grp', 'default_paid_via', 'sort', 'active', 'group_id', 'monthly_budget_pkr', 'is_misc'],
  'expense_categories has the A6.1 columns (and 0086: group_id, monthly_budget_pkr; 0091: is_misc)');
select hasnt_column('public', 'expenses', 'category', 'expenses.category (text) is gone');
select hasnt_column('public', 'recurring_expenses', 'category', 'recurring_expenses.category (text) is gone');
select col_not_null('public', 'expenses', 'category_id', 'expenses.category_id is required');
select col_not_null('public', 'expenses', 'paid_via', 'expenses.paid_via is NOT NULL');
select col_not_null('public', 'recurring_expenses', 'category_id', 'recurring_expenses.category_id is required');
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'expenses' and column_name = 'input_tax_pkr'),
  '0', 'input_tax_pkr defaults to 0');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'expenses' and column_name = 'paid_via'
                        and column_default is not null),
  'paid_via has no column default: the trigger fills it from the category');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.expenses'::regclass and contype = 'f'
                    and confrelid = 'public.expense_categories'::regclass and confdeltype = 'r'),
  'expenses.category_id is RESTRICT');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.recurring_expenses'::regclass and contype = 'f'
                    and confrelid = 'public.expense_categories'::regclass and confdeltype = 'r'),
  'recurring_expenses.category_id is RESTRICT');
select ok((select relrowsecurity from pg_class where oid = 'public.expense_categories'::regclass),
  'RLS is enabled on expense_categories');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'expense_categories'),
  array['expense_categories_delete_admin', 'expense_categories_insert_admin', 'expense_categories_select_admin',
        'expense_categories_update_admin'],
  'expense_categories has admin-only policies');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid = 'public.expense_categories'::regclass and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privilege on expense_categories');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.expense_categories'::regclass
                    and tgfoid = 'public.audit_row_change()'::regprocedure and not tgisinternal),
  'expense_categories carries the audit trigger');
select ok(not has_function_privilege('authenticated', 'public.expenses_prepare()', 'execute')
      and not has_function_privilege('anon', 'public.expenses_prepare()', 'execute'),
  'expenses_prepare is not callable by clients');

-- ------------------------------------------------------------------ the seed (the 0025 rows; 0086 adds seven defaults after them)
select is((select count(*)::int from public.expense_categories where id <= 'ca7e0000-0000-4000-8000-000000000017'), 17, '17 categories are seeded');
select is((select count(*)::int from public.expense_categories where grp = 'overhead' and id <= 'ca7e0000-0000-4000-8000-000000000017'), 10, '10 overhead categories');
select is((select count(*)::int from public.expense_categories where grp = 'order_cost' and id <= 'ca7e0000-0000-4000-8000-000000000017'), 5, '5 order-cost categories');
select is((select count(*)::int from public.expense_categories where grp = 'non_pnl' and id <= 'ca7e0000-0000-4000-8000-000000000017'), 2, '2 not-in-P&L categories');
select is((select array_agg(name order by sort) from public.expense_categories where grp = 'overhead' and id <= 'ca7e0000-0000-4000-8000-000000000017'),
  array['Salaries', 'Rent', 'Utilities', 'Fuel & travel', 'Office supplies & snacks', 'Courier & postage',
        'Repairs & maintenance', 'Bank charges', 'Taxes & fees', 'Other'],
  'the overhead categories, in order');
select is((select array_agg(name order by sort) from public.expense_categories where grp = 'order_cost' and id <= 'ca7e0000-0000-4000-8000-000000000017'),
  array['Supplier payment', 'Freight', 'Clearing', 'Commissioning', 'Subcontractor'],
  'the order-cost categories, in order');
select is((select array_agg(name order by sort) from public.expense_categories where grp = 'non_pnl' and id <= 'ca7e0000-0000-4000-8000-000000000017'),
  array['Owner drawings', 'Loan repayment'], 'the not-in-P&L categories (Owner drawings, Loan repayment)');
select is((select array_agg(name order by name) from public.expense_categories where default_paid_via = 'cash' and id <= 'ca7e0000-0000-4000-8000-000000000017'),
  array['Commissioning', 'Courier & postage', 'Fuel & travel', 'Office supplies & snacks', 'Repairs & maintenance'],
  'five categories default to cash; the other twelve to bank');
select ok((select bool_and(active) from public.expense_categories), 'every seeded category is active');
select is((select count(*)::int from public.audit_log where table_name = 'expense_categories'), 0,
  'seeding writes no audit rows');

-- ------------------------------------------------------------------ constraints
select throws_ok($$insert into public.expense_categories (name, grp) values ('SALARIES', 'overhead')$$,
  '23505', null, 'a duplicate name differing only in case is rejected');
select throws_ok($$insert into public.expense_categories (name, grp) values ('  rent ', 'overhead')$$,
  '23505', null, 'a duplicate name differing in case and surrounding spaces is rejected');
select throws_ok($$insert into public.expense_categories (name, grp) values ('Bad group', 'revenue')$$,
  '23514', null, 'grp must be overhead, order_cost or non_pnl');
select throws_ok($$insert into public.expense_categories (name, grp, default_paid_via) values ('Bad via', 'overhead', 'card')$$,
  '23514', null, 'default_paid_via must be bank or cash');
select lives_ok($$insert into public.expense_categories (id, name, grp) values
                  ('ca7e0000-0000-4000-8000-0000000000f1', 'Office tea', 'overhead')$$,
  'an admin can add a category');
select is((select default_paid_via || '/' || sort || '/' || active from public.expense_categories
           where id = 'ca7e0000-0000-4000-8000-0000000000f1'),
  'bank/0/true', 'a new category defaults to bank, sort 0, active');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000001', 'Item', 1, 10000, 18);

-- ------------------------------------------------------------------ paid_via is filled from the category
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id)
                  values ('b4000000-0000-4000-8000-000000000001', 120, 'ca7e0000-0000-4000-8000-000000000005')$$,
  'an expense needs only an amount and a category');
select is((select paid_via from public.expenses where id = 'b4000000-0000-4000-8000-000000000001'), 'cash',
  '"Office supplies & snacks" gives paid_via cash');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id)
                  values ('b4000000-0000-4000-8000-000000000002', 50000, 'ca7e0000-0000-4000-8000-000000000001')$$,
  'a Salaries expense is accepted');
select is((select paid_via from public.expenses where id = 'b4000000-0000-4000-8000-000000000002'), 'bank',
  '"Salaries" gives paid_via bank');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id, paid_via)
                  values ('b4000000-0000-4000-8000-000000000003', 70, 'ca7e0000-0000-4000-8000-000000000001', 'cash')$$,
  'an explicit paid_via is accepted');
select is((select paid_via from public.expenses where id = 'b4000000-0000-4000-8000-000000000003'), 'cash',
  'an explicit paid_via is kept, not overwritten by the category default');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, paid_via)
                   values (1, 'ca7e0000-0000-4000-8000-000000000001', 'card')$$,
  '23514', null, 'paid_via must be bank or cash');
select throws_ok($$insert into public.expenses (amount_pkr) values (1)$$,
  '23502', null, 'a category is required');
select throws_ok($$insert into public.expenses (amount_pkr, category_id)
                   values (1, 'ca7e0000-0000-4000-8000-0000000000ee')$$,
  '23503', null, 'an unknown category is rejected');

-- ------------------------------------------------------------------ input tax
select throws_ok($$insert into public.expenses (amount_pkr, category_id, input_tax_pkr)
                   values (100, 'ca7e0000-0000-4000-8000-000000000011', 100.01)$$,
  '23514', null, 'input_tax_pkr greater than the amount is rejected');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, input_tax_pkr)
                   values (100, 'ca7e0000-0000-4000-8000-000000000011', -1)$$,
  '23514', null, 'a negative input_tax_pkr is rejected');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id, input_tax_pkr)
                  values ('b4000000-0000-4000-8000-000000000004', 100, 'ca7e0000-0000-4000-8000-000000000011', 100)$$,
  'input tax equal to the amount is accepted');
delete from public.expenses where id = 'b4000000-0000-4000-8000-000000000004';
select throws_ok($$update public.expenses set input_tax_pkr = 121 where id = 'b4000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an update that pushes input tax above the amount is rejected');

-- ------------------------------------------------------------------ v_order_money uses the net cost
-- Two Supplier payments on the order: 1150 with 150 input tax (net 1000) and 500 with none. Cost = 1500.
-- Order net sale is 10000, so the margin is 8500; the gross cash outflow (1650) is not the cost.
insert into public.expenses (amount_pkr, input_tax_pkr, category_id, order_id) values
  (1150, 150, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001'),
  (500,    0, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001');
select is((select actual_cost from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  1500.00, 'v_order_money actual_cost = sum(amount - input tax) = 1500.00');
select is((select margin from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  8500.00, 'v_order_money margin = net sale 10000 - net cost 1500 = 8500.00');
update public.expenses set input_tax_pkr = 0
where order_id = 'a1000000-0000-4000-8000-000000000001' and amount_pkr = 1150;
select is((select actual_cost from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000001'),
  1650.00, 'with input tax 0 the cost is the plain amount (results unchanged)');

-- ------------------------------------------------------------------ inactive categories
update public.expense_categories set active = false where id = 'ca7e0000-0000-4000-8000-000000000002';  -- Rent
select throws_ok($$insert into public.expenses (amount_pkr, category_id)
                   values (1, 'ca7e0000-0000-4000-8000-000000000002')$$,
  '23514', null, 'an insert with an inactive category is rejected');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id, legacy_flags)
                  values ('b4000000-0000-4000-8000-000000000005', 1, 'ca7e0000-0000-4000-8000-000000000002',
                          array['category_unmapped'])$$,
  'a legacy row (non-empty legacy_flags) with an inactive category is accepted');
select is((select paid_via from public.expenses where id = 'b4000000-0000-4000-8000-000000000005'), 'bank',
  'the legacy row still gets its paid_via from the category');
select throws_ok($$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000002'
                   where id = 'b4000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'changing an expense to an inactive category is rejected');
select lives_ok($$update public.expenses set description = 'edited' where id = 'b4000000-0000-4000-8000-000000000005'$$,
  'editing another field of a row on an inactive category is fine');
update public.expense_categories set active = true where id = 'ca7e0000-0000-4000-8000-000000000002';
select lives_ok($$update public.expenses set category_id = 'ca7e0000-0000-4000-8000-000000000002'
                  where id = 'b4000000-0000-4000-8000-000000000002'$$,
  'the same change is accepted once the category is active again');

-- ------------------------------------------------------------------ delete is blocked while in use; deactivate works
select throws_ok($$delete from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000002'$$,
  '23503', null, 'deleting a category that is in use is blocked');
insert into public.recurring_expenses (id, label, category_id, amount) values
  ('b3000000-0000-4000-8000-000000000001', 'Internet', 'ca7e0000-0000-4000-8000-000000000003', 9000);
select throws_ok($$delete from public.expense_categories where id = 'ca7e0000-0000-4000-8000-000000000003'$$,
  '23503', null, 'a category used only by a recurring template cannot be deleted either');
select lives_ok($$update public.expense_categories set active = false where id = 'ca7e0000-0000-4000-8000-000000000002'$$,
  'deactivating a category that is in use works');
select is(public.t_rows($q$delete from public.expense_categories where id = 'ca7e0000-0000-4000-8000-0000000000f1'$q$), 1,
  'an unused category can be deleted');
select ok((select count(*) = 2 from public.audit_log where table_name = 'expense_categories'
           and record_id = 'ca7e0000-0000-4000-8000-0000000000f1'),
  'adding and deleting a category are both audited (insert and delete)');
select ok(exists (select 1 from public.audit_log where table_name = 'expense_categories' and action = 'update'
                  and record_id = 'ca7e0000-0000-4000-8000-000000000002'
                  and old_value ->> 'active' = 'true' and new_value ->> 'active' = 'false'),
  'deactivating a category is audited with old and new values');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.expense_categories), 0, 'sales gets 0 rows from expense_categories');
select throws_ok($$insert into public.expense_categories (name, grp) values ('Sales try', 'overhead')$$,
  '42501', null, 'sales cannot add a category');
select is(public.t_rows($q$update public.expense_categories set active = false$q$), 0, 'sales cannot update categories');
select is(public.t_rows($q$delete from public.expense_categories$q$), 0, 'sales cannot delete categories');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.expense_categories), 0, 'engineer gets 0 rows from expense_categories');
select throws_ok($$insert into public.expense_categories (name, grp) values ('Eng try', 'overhead')$$,
  '42501', null, 'engineer cannot add a category');

-- ------------------------------------------------------------------ deactivated
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.expense_categories), 0, 'a deactivated user gets 0 rows from expense_categories');
select throws_ok($$insert into public.expense_categories (name, grp) values ('Deactivated try', 'overhead')$$,
  '42501', null, 'a deactivated user cannot add a category');

-- ------------------------------------------------------------------ admin through the API
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.expense_categories), 29, 'admin reads all 29 categories (17 from 0025, 7 from 0086, 5 from 0091)');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id)
                  values ('b4000000-0000-4000-8000-0000000000a1', 40, 'ca7e0000-0000-4000-8000-000000000004')$$,
  'admin inserts an expense through the API; the category default is read despite row security');
select is((select paid_via from public.expenses where id = 'b4000000-0000-4000-8000-0000000000a1'), 'cash',
  'Fuel & travel gives paid_via cash through the API');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.expense_categories$$, '42501', null, 'anon cannot read expense_categories');
reset role;

select * from finish();
rollback;
