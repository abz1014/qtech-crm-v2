begin;
select plan(109);

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
select columns_are('public', 'invoices',
  array['id', 'created_at', 'created_by', 'updated_at', 'order_id', 'company_id', 'number', 'invoice_date',
        'net_amount', 'gst_amount', 'copy_received_on', 'tcs_sent_on', 'tcs_number', 'client_received_on', 'psid',
        'wasif_receipt_on', 'tax_deposited_on', 'tax_deposit_amount', 'notes', 'last_reminded_on', 'reminder_count',
        'legacy_flags', 'legacy_source', 'tax_bank_month'],
  'invoices has the section 2.16 columns (reminder stamps, no tax_deposit_bank)');
select hasnt_column('public', 'invoices', 'tax_deposit_bank', 'invoices.tax_deposit_bank is dropped (A3-2)');
select columns_are('public', 'payments_in',
  array['id', 'created_at', 'created_by', 'order_id', 'received_on', 'amount', 'credited_user_id', 'reference',
        'legacy_flags', 'legacy_source', 'paid_via', 'bank_month'],
  'payments_in has the section 2.17 columns and no tax_withheld');
select columns_are('public', 'expenses',
  array['id', 'created_at', 'created_by', 'paid_on', 'amount_pkr', 'category_id', 'description', 'order_id',
        'supplier_order_id', 'payee_id', 'reference', 'recurring_id', 'period', 'legacy_flags', 'legacy_source',
        'paid_via', 'input_tax_pkr', 'bank_month'],
  'expenses has the section 2.18 columns (A6: category_id, paid_via, input_tax_pkr, bank_month)');
select columns_are('public', 'recurring_expenses',
  array['id', 'created_at', 'created_by', 'label', 'category_id', 'amount', 'day_of_month', 'active', 'start_month',
        'notes'],
  'recurring_expenses has the section 2.19 columns');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.invoices'::regclass, 'public.payments_in'::regclass, 'public.expenses'::regclass,
                         'public.recurring_expenses'::regclass)),
  'RLS is enabled on all four tables');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'invoices'),
  array['invoices_delete_admin', 'invoices_insert_admin_sales', 'invoices_select_admin_sales',
        'invoices_update_admin_sales'],
  'invoices policies');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'payments_in'),
  array['payments_in_delete_admin', 'payments_in_insert_admin', 'payments_in_select_admin',
        'payments_in_update_admin'],
  'payments_in has admin-only policies');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename in ('expenses', 'recurring_expenses')
             and policyname like '%\_admin'), 8,
  'expenses and recurring_expenses have admin-only policies');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in (select ('public.' || t)::regclass from unnest(array['invoices', 'payments_in',
                              'expenses', 'recurring_expenses']) t)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the S06 tables');
select ok(not has_function_privilege('authenticated', 'public.set_payment_credited_user()', 'execute')
      and not has_function_privilege('anon', 'public.set_payment_credited_user()', 'execute'),
  'set_payment_credited_user is not callable by clients');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass
                    and tgname = 'invoices_set_updated_at' and not tgisinternal),
  'invoices has the updated_at trigger');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.invoices'::regclass and contype = 'f'
                    and confrelid = 'public.orders'::regclass and confdeltype = 'r'),
  'invoices.order_id is RESTRICT');

-- ------------------------------------------------------------------ fixtures (as owner)
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', array['owner_unknown']);
insert into public.supplier_orders (id, order_id, supplier_id) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ invoices constraints
insert into public.invoices (id, order_id, number, net_amount, gst_amount, updated_at) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'INV-1', 1000, 180,
   '2020-01-01 00:00:00+00');
select is((select invoice_date from public.invoices where id = 'b1000000-0000-4000-8000-000000000001'),
  public.today_pkt(), 'invoice_date defaults to today in Karachi');
select is((select reminder_count from public.invoices where id = 'b1000000-0000-4000-8000-000000000001'),
  0::smallint, 'reminder_count defaults to 0');
select ok((select last_reminded_on is null and tcs_sent_on is null and psid is null and tax_deposited_on is null
                  and client_received_on is null and copy_received_on is null and notes is null
           from public.invoices where id = 'b1000000-0000-4000-8000-000000000001'),
  'an invoice needs only an order, a number and the amounts');
select throws_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-1', 1, 0)$$,
  '23505', null, 'invoice numbers are globally unique');
select throws_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-2', 100, 101)$$,
  '23514', null, 'gst_amount cannot exceed net_amount');
select throws_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-2', 100, -1)$$,
  '23514', null, 'gst_amount cannot be negative');
select lives_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                  values ('a1000000-0000-4000-8000-000000000001', 'INV-ZERO', 100, 0)$$,
  'a GST-exempt invoice (gst 0) is accepted');
select throws_ok($$insert into public.invoices (number, net_amount, gst_amount) values ('INV-3', 100, 18)$$,
  '23514', null, 'an invoice needs an order or a company');
select lives_ok($$insert into public.invoices (company_id, number, net_amount, gst_amount)
                  values ('c0000000-0000-4000-8000-000000000001', 'INV-4', 100, 18)$$,
  'an unlinked register row with a company is accepted');
select throws_ok($$insert into public.invoices (order_id, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 100, 18)$$,
  '23514', null, 'number may be NULL only on a row with a legacy flag');
select lives_ok($$insert into public.invoices (order_id, net_amount, gst_amount, legacy_flags)
                  values ('a1000000-0000-4000-8000-000000000001', 100, 18, array['fbr_generated_legacy']),
                         ('a1000000-0000-4000-8000-000000000001', 100, 18, array['fbr_generated_legacy'])$$,
  'legacy rows without a number are accepted and never collide');
select throws_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-5', null, 100, 18)$$,
  '23514', null, 'invoice_date may be NULL only on a row with a legacy flag');
select lives_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, legacy_flags)
                  values ('a1000000-0000-4000-8000-000000000001', 'INV-6', null, 100, 18, array['dates_estimated'])$$,
  'a legacy row may lack its date');
select throws_ok($$insert into public.invoices (order_id, number, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-7', 0)$$,
  '23502', null, 'net_amount is required');
select throws_ok($$update public.invoices set reminder_count = -1
                   where id = 'b1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'reminder_count cannot be negative');
select lives_ok($$update public.invoices set last_reminded_on = '2026-10-10', reminder_count = reminder_count + 1
                  where id = 'b1000000-0000-4000-8000-000000000001'$$,
  'the payment-reminder stamp can be written');
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.invoices
           where id = 'b1000000-0000-4000-8000-000000000001'),
  'invoices.updated_at is bumped by the trigger');

-- ------------------------------------------------------------------ payments_in constraints
select lives_ok($$insert into public.payments_in (id, order_id, amount)
                  values ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 500)$$,
  'a payment needs only an order and an amount');
select is((select received_on from public.payments_in where id = 'b2000000-0000-4000-8000-000000000001'),
  public.today_pkt(), 'received_on defaults to today in Karachi');
select is((select credited_user_id from public.payments_in where id = 'b2000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'credited_user_id defaults to the order owner');
select lives_ok($$insert into public.payments_in (id, order_id, amount, credited_user_id)
                  values ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 5,
                          'a0000000-0000-4000-8000-000000000001')$$,
  'a payment with an explicit credited user is accepted');
select is((select credited_user_id from public.payments_in where id = 'b2000000-0000-4000-8000-000000000002'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'an explicit credited_user_id is kept');
select lives_ok($$insert into public.payments_in (id, order_id, amount)
                  values ('b2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000009', 5)$$,
  'a payment on an ownerless order is accepted');
select ok((select credited_user_id is null from public.payments_in where id = 'b2000000-0000-4000-8000-000000000003'),
  'an ownerless order leaves the payment unattributed');
select lives_ok($$insert into public.payments_in (id, order_id, amount, legacy_source)
                  values ('b2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 5, '{}')$$,
  'an imported payment is accepted');
select ok((select credited_user_id is null from public.payments_in where id = 'b2000000-0000-4000-8000-000000000004'),
  'an imported payment is left unattributed unless the import sets it');
update public.orders set owner_id = 'a0000000-0000-4000-8000-000000000003'
  where id = 'a1000000-0000-4000-8000-000000000001';
select is((select credited_user_id from public.payments_in where id = 'b2000000-0000-4000-8000-000000000001'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'reassigning the order does not rewrite past credit');
select throws_ok($$insert into public.payments_in (order_id, amount)
                   values ('a1000000-0000-4000-8000-000000000001', 0)$$,
  '23514', null, 'a zero payment is rejected');
select throws_ok($$insert into public.payments_in (order_id, amount)
                   values ('a1000000-0000-4000-8000-000000000001', -10)$$,
  '23514', null, 'a negative payment is rejected');
select throws_ok($$insert into public.payments_in (amount) values (10)$$,
  '23502', null, 'a payment needs an order');

-- ------------------------------------------------------------------ recurring_expenses and expenses constraints
insert into public.recurring_expenses (id, label, category_id, amount) values
  ('b3000000-0000-4000-8000-000000000001', 'Salaries', 'ca7e0000-0000-4000-8000-000000000001', 100000);
select is((select active from public.recurring_expenses where id = 'b3000000-0000-4000-8000-000000000001'), true,
  'recurring_expenses.active defaults to true');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount) values ('x', 'ca7e0000-0000-4000-8000-000000000010', 0)$$,
  '23514', null, 'a zero recurring amount is rejected');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount, day_of_month)
                   values ('x', 'ca7e0000-0000-4000-8000-000000000010', 1, 29)$$,
  '23514', null, 'day_of_month above 28 is rejected');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount, day_of_month)
                   values ('x', 'ca7e0000-0000-4000-8000-000000000010', 1, 0)$$,
  '23514', null, 'day_of_month below 1 is rejected');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount, start_month)
                   values ('x', 'ca7e0000-0000-4000-8000-000000000010', 1, '2026-13')$$,
  '23514', null, 'a malformed start_month is rejected');
select lives_ok($$insert into public.recurring_expenses (label, category_id, amount, day_of_month, start_month)
                  values ('Rent', 'ca7e0000-0000-4000-8000-000000000002', 1, 28, '2026-01')$$, 'a valid day and start month are accepted');

select lives_ok($$insert into public.expenses (id, amount_pkr, category_id)
                  values ('b4000000-0000-4000-8000-000000000001', 250, 'ca7e0000-0000-4000-8000-000000000012')$$,
  'an expense needs only an amount and a category');
select is((select paid_on from public.expenses where id = 'b4000000-0000-4000-8000-000000000001'),
  public.today_pkt(), 'paid_on defaults to today in Karachi');
select throws_ok($$insert into public.expenses (amount_pkr) values (250)$$,
  '23502', null, 'category is required');
select throws_ok($$insert into public.expenses (amount_pkr, category_id) values (0, 'ca7e0000-0000-4000-8000-000000000010')$$,
  '23514', null, 'a zero expense is rejected');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, period) values (1, 'ca7e0000-0000-4000-8000-000000000010', '2026-1')$$,
  '23514', null, 'a malformed period is rejected');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id, recurring_id, period)
                  values ('b4000000-0000-4000-8000-000000000002', 100000, 'ca7e0000-0000-4000-8000-000000000001',
                          'b3000000-0000-4000-8000-000000000001', '2026-10')$$,
  'a recurring expense for a period is accepted');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, recurring_id, period)
                   values (1, 'ca7e0000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', '2026-10')$$,
  '23505', null, 'one expense per (recurring, period)');
select lives_ok($$insert into public.expenses (amount_pkr, category_id, recurring_id, period)
                  values (1, 'ca7e0000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', '2026-11')$$,
  'the same template in another period is accepted');

-- Money attached to an order or leg blocks deleting it (the FKs are RESTRICT).
insert into public.expenses (id, amount_pkr, category_id, order_id, supplier_order_id) values
  ('b4000000-0000-4000-8000-000000000003', 70, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000001');
select throws_ok($$delete from public.orders where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'an order with invoices, payments or expenses cannot be deleted');
insert into public.payments_in (order_id, amount) values ('a1000000-0000-4000-8000-000000000002', 10);
select throws_ok($$delete from public.orders where id = 'a1000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'an order with a payment cannot be deleted');
insert into public.invoices (order_id, number, net_amount, gst_amount)
  values ('a1000000-0000-4000-8000-000000000003', 'INV-ORD3', 10, 1);
select throws_ok($$delete from public.orders where id = 'a1000000-0000-4000-8000-000000000003'$$,
  '23503', null, 'an order with an invoice cannot be deleted');
select throws_ok($$delete from public.supplier_orders where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'a leg with an expense attached cannot be deleted');
select lives_ok($$delete from public.orders where id = 'a1000000-0000-4000-8000-000000000004'$$,
  'an order with no money attached can be deleted');
delete from public.recurring_expenses where id = 'b3000000-0000-4000-8000-000000000001';
select ok((select recurring_id is null from public.expenses where id = 'b4000000-0000-4000-8000-000000000002'),
  'deleting a recurring template detaches its expenses');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select cmp_ok((select count(*)::int from public.invoices), '>=', 1, 'sales reads invoices');
select lives_ok($$insert into public.invoices (id, order_id, number, net_amount, gst_amount)
                  values ('b1000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-000000000001', 'INV-S', 100, 18)$$,
  'sales inserts an invoice');
select is((select created_by from public.invoices where id = 'b1000000-0000-4000-8000-0000000000a2'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'invoices.created_by defaults to the caller');
select is(public.t_rows($q$update public.invoices set tcs_sent_on = '2026-10-10', last_reminded_on = '2026-10-11',
                                  reminder_count = 1 where id = 'b1000000-0000-4000-8000-0000000000a2'$q$), 1,
  'sales updates an invoice, including the reminder stamp');
select is(public.t_rows($q$delete from public.invoices where id = 'b1000000-0000-4000-8000-0000000000a2'$q$), 0,
  'sales cannot delete an invoice');
select is((select count(*)::int from public.payments_in), 0, 'sales sees no payments');
select throws_ok($$insert into public.payments_in (order_id, amount)
                   values ('a1000000-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'sales cannot insert a payment');
select is(public.t_rows($q$update public.payments_in set amount = 1$q$), 0, 'sales cannot update payments');
select is(public.t_rows($q$delete from public.payments_in$q$), 0, 'sales cannot delete payments');
select is((select count(*)::int from public.expenses), 0, 'sales sees no expenses');
select throws_ok($$insert into public.expenses (amount_pkr, category_id) values (1, 'ca7e0000-0000-4000-8000-000000000010')$$,
  '42501', null, 'sales cannot insert an expense');
select is(public.t_rows($q$delete from public.expenses$q$), 0, 'sales cannot delete expenses');
select is((select count(*)::int from public.recurring_expenses), 0, 'sales sees no recurring expenses');
select throws_ok($$insert into public.recurring_expenses (label, category_id, amount) values ('x', 'ca7e0000-0000-4000-8000-000000000010', 1)$$,
  '42501', null, 'sales cannot insert a recurring expense');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.invoices), 0, 'engineer gets 0 invoice rows');
select throws_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-E', 1, 0)$$,
  '42501', null, 'engineer cannot insert an invoice');
select is(public.t_rows($q$update public.invoices set notes = 'x'$q$), 0, 'engineer cannot update invoices');
select is(public.t_rows($q$delete from public.invoices$q$), 0, 'engineer cannot delete invoices');
select is((select count(*)::int from public.payments_in), 0, 'engineer gets 0 payment rows');
select throws_ok($$insert into public.payments_in (order_id, amount)
                   values ('a1000000-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'engineer cannot insert a payment');
select is((select count(*)::int from public.expenses), 0, 'engineer gets 0 expense rows');
select throws_ok($$insert into public.expenses (amount_pkr, category_id) values (1, 'ca7e0000-0000-4000-8000-000000000010')$$,
  '42501', null, 'engineer cannot insert an expense');
select is((select count(*)::int from public.recurring_expenses), 0, 'engineer gets 0 recurring rows');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.invoices), 0, 'deactivated user sees no invoices');
select is((select count(*)::int from public.payments_in), 0, 'deactivated user sees no payments');
select is((select count(*)::int from public.expenses), 0, 'deactivated user sees no expenses');
select is((select count(*)::int from public.recurring_expenses), 0, 'deactivated user sees no recurring expenses');
select throws_ok($$insert into public.invoices (order_id, number, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-D', 1, 0)$$,
  '42501', null, 'deactivated user cannot insert an invoice');
select is(public.t_rows($q$update public.invoices set notes = 'x'$q$), 0, 'deactivated user cannot update invoices');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select cmp_ok((select count(*)::int from public.invoices), '>=', 2, 'admin reads invoices');
select is((select count(*)::int from public.payments_in), 5, 'admin reads payments');
select cmp_ok((select count(*)::int from public.expenses), '>=', 3, 'admin reads expenses');
select lives_ok($$insert into public.payments_in (id, order_id, amount)
                  values ('b2000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 20)$$,
  'admin inserts a payment');
select is((select credited_user_id from public.payments_in where id = 'b2000000-0000-4000-8000-0000000000a1'),
  'a0000000-0000-4000-8000-000000000003'::uuid, 'a payment through the API is credited to the current order owner');
select is(public.t_rows($q$update public.payments_in set credited_user_id = 'a0000000-0000-4000-8000-000000000002'
                           where id = 'b2000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin can change credited_user_id');
select is(public.t_rows($q$delete from public.payments_in where id = 'b2000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes a payment');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id)
                  values ('b4000000-0000-4000-8000-0000000000a1', 5, 'ca7e0000-0000-4000-8000-000000000003')$$, 'admin inserts an expense');
select is(public.t_rows($q$update public.expenses set description = 'bill' where id = 'b4000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin updates an expense');
select is(public.t_rows($q$delete from public.expenses where id = 'b4000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes an expense');
select lives_ok($$insert into public.recurring_expenses (id, label, category_id, amount)
                  values ('b3000000-0000-4000-8000-0000000000a1', 'Internet', 'ca7e0000-0000-4000-8000-000000000003', 9000)$$,
  'admin inserts a recurring expense');
select is(public.t_rows($q$delete from public.recurring_expenses where id = 'b3000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes a recurring expense');
select is(public.t_rows($q$delete from public.invoices where id = 'b1000000-0000-4000-8000-0000000000a2'$q$), 1,
  'admin deletes an invoice');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.invoices$$, '42501', null, 'anon cannot read invoices');
select throws_ok($$select * from public.payments_in$$, '42501', null, 'anon cannot read payments_in');
select throws_ok($$select * from public.expenses$$, '42501', null, 'anon cannot read expenses');
select throws_ok($$select * from public.recurring_expenses$$, '42501', null, 'anon cannot read recurring_expenses');
reset role;

select * from finish();
rollback;
