begin;
select * from no_plan();

-- S21 (migration 0026_bank_and_receipts), Amendment A6.1 / A6.6.
-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.

create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'payments_in' and column_name = 'paid_via'),
  $$'bank'::text$$, 'payments_in.paid_via defaults to bank');
select col_not_null('public', 'payments_in', 'paid_via', 'payments_in.paid_via is NOT NULL');
select has_column('public', 'payments_in', 'bank_month', 'payments_in.bank_month exists');
select col_is_null('public', 'payments_in', 'bank_month', 'payments_in.bank_month is nullable (NULL = not ticked)');
select has_column('public', 'expenses', 'bank_month', 'expenses.bank_month exists');
select col_is_null('public', 'expenses', 'bank_month', 'expenses.bank_month is nullable');
select has_column('public', 'invoices', 'tax_bank_month', 'invoices.tax_bank_month exists');
select col_is_null('public', 'invoices', 'tax_bank_month', 'invoices.tax_bank_month is nullable');
select has_column('public', 'attachments', 'expense_id', 'attachments.expense_id exists');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.attachments'::regclass and contype = 'f'
                    and confrelid = 'public.expenses'::regclass and confdeltype = 'c'),
  'attachments.expense_id is CASCADE');
select is((select count(*)::int from storage.buckets
           where id = 'expense-receipts' and public = false and file_size_limit = 5242880), 1,
  'expense-receipts is a private bucket with a 5 MB limit');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'INV-1', 100, 18);
insert into public.payments_in (id, order_id, amount) values
  ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 50);
insert into public.payments_in (id, order_id, amount, paid_via) values
  ('b2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 20, 'cash');
-- 120 is a cash category (Office supplies & snacks), 50000 a bank one (Salaries)
insert into public.expenses (id, amount_pkr, category_id) values
  ('b4000000-0000-4000-8000-000000000001', 120, 'ca7e0000-0000-4000-8000-000000000005'),
  ('b4000000-0000-4000-8000-000000000002', 50000, 'ca7e0000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------------ bank ticks
select is((select paid_via from public.payments_in where id = 'b2000000-0000-4000-8000-000000000001'), 'bank',
  'a payment in is a bank item unless said otherwise');
select lives_ok($$update public.payments_in set bank_month = '2026-05-01' where id = 'b2000000-0000-4000-8000-000000000001'$$,
  'a bank payment can be ticked against a statement month');
select lives_ok($$update public.expenses set bank_month = '2026-05-01' where id = 'b4000000-0000-4000-8000-000000000002'$$,
  'a bank expense can be ticked against a statement month');
select lives_ok($$update public.payments_in set bank_month = null where id = 'b2000000-0000-4000-8000-000000000001'$$,
  'a tick can be removed');

select throws_ok($$update public.payments_in set bank_month = '2026-05-01' where id = 'b2000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'bank_month is refused on a cash payment');
select throws_ok($$update public.expenses set bank_month = '2026-05-01' where id = 'b4000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'bank_month is refused on a cash expense');
select throws_ok($$update public.payments_in set bank_month = '2026-05-15' where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'bank_month is refused unless it is the first day of a month (payment)');
select throws_ok($$update public.expenses set bank_month = '2026-05-02' where id = 'b4000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'bank_month is refused unless it is the first day of a month (expense)');
select throws_ok($$insert into public.payments_in (order_id, amount, paid_via, bank_month)
                   values ('a1000000-0000-4000-8000-000000000001', 5, 'cash', '2026-05-01')$$,
  '23514', null, 'inserting a cash payment that is already ticked is refused');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, bank_month)
                   values (5, 'ca7e0000-0000-4000-8000-000000000005', '2026-05-01')$$,
  '23514', null, 'inserting a cash-default expense that is already ticked is refused');
select lives_ok($$insert into public.expenses (id, amount_pkr, category_id, bank_month)
                  values ('b4000000-0000-4000-8000-000000000003', 5, 'ca7e0000-0000-4000-8000-000000000001', '2026-05-01')$$,
  'inserting a bank expense that is already ticked is accepted');
select throws_ok($$update public.expenses set paid_via = 'cash' where id = 'b4000000-0000-4000-8000-000000000003'$$,
  '23514', null, 'a ticked item cannot be switched to cash');
select throws_ok($$update public.payments_in set paid_via = 'card' where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'payments_in.paid_via must be bank or cash');

select lives_ok($$update public.invoices set tax_bank_month = '2026-06-01' where id = 'b1000000-0000-4000-8000-000000000001'$$,
  'an FBR deposit can be ticked against a statement month');
select throws_ok($$update public.invoices set tax_bank_month = '2026-06-10' where id = 'b1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'tax_bank_month is refused unless it is the first day of a month');
select is((select count(*)::int from public.audit_log
           where table_name = 'expenses' and record_id = 'b4000000-0000-4000-8000-000000000002' and action = 'update'
             and new_value ->> 'bank_month' = '2026-05-01'), 1,
  'ticking is audited (who and when are in audit_log)');

-- ------------------------------------------------------------------ attachments: the three parents
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id)
                  values ('e0000000-0000-4000-8000-000000000001', 'expense-receipts', 'exp1/a.jpg', 'a.jpg', 'image/jpeg',
                          1000, 'b4000000-0000-4000-8000-000000000001')$$,
  'an expense receipt in the expense-receipts bucket is accepted');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id)
                  values ('e0000000-0000-4000-8000-000000000002', 'rfq-files', 'rfq1/a.jpg', 'a.jpg', 'image/jpeg',
                          1000, 'd0000000-0000-4000-8000-000000000001')$$,
  'an RFQ attachment is still accepted');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id)
                  values ('e0000000-0000-4000-8000-000000000003', 'gst-receipts', 'inv1/a.pdf', 'a.pdf',
                          'application/pdf', 1000, 'b1000000-0000-4000-8000-000000000001')$$,
  'an invoice attachment is still accepted');

select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes)
                   values ('expense-receipts', 'none/a.jpg', 'a.jpg', 'image/jpeg', 1)$$,
  '23514', null, 'one_parent: no parent is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, invoice_id, expense_id)
                   values ('rfq-files', 'all3/a.jpg', 'a.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000001',
                           'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'one_parent: three parents are rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id, expense_id)
                   values ('rfq-files', 'rfqexp/a.jpg', 'a.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000001',
                           'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'one_parent: an RFQ and an expense together are rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id, expense_id)
                   values ('gst-receipts', 'invexp/a.jpg', 'a.jpg', 'image/jpeg', 1, 'b1000000-0000-4000-8000-000000000001',
                           'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'one_parent: an invoice and an expense together are rejected');

select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('rfq-files', 'exp1/b.jpg', 'b.jpg', 'image/jpeg', 1, 'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'bucket pairing: an expense receipt cannot live in rfq-files');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('gst-receipts', 'exp1/c.jpg', 'c.jpg', 'image/jpeg', 1, 'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'bucket pairing: an expense receipt cannot live in gst-receipts');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id)
                   values ('expense-receipts', 'rfq1/z.jpg', 'z.jpg', 'image/jpeg', 1, 'd0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'bucket pairing: an RFQ attachment cannot live in expense-receipts');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, invoice_id)
                   values ('expense-receipts', 'inv1/z.pdf', 'z.pdf', 'application/pdf', 1,
                           'b1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'bucket pairing: an invoice attachment cannot live in expense-receipts');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('expense-receipts', 'exp1/big.jpg', 'big.jpg', 'image/jpeg', 5242881,
                           'b4000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a receipt over 5 MB is rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('expense-receipts', 'exp1/a.jpg', 'dup.jpg', 'image/jpeg', 1, 'b4000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a (bucket, path) pair is unique');

-- storage objects inserted as owner so that role checks below have something to read
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'rfq1/a.jpg'),
  ('gst-receipts', 'inv1/a.pdf'),
  ('expense-receipts', 'exp1/a.jpg');

-- ------------------------------------------------------------------ the bucket helper
select is((select bool_and(public.can_access_bucket(b)) from unnest(array['rfq-files', 'gst-receipts', 'expense-receipts']) b),
  true, 'as the owner with admin claims, can_access_bucket is true for all three buckets');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments where expense_id is not null), 0,
  'sales sees no expense attachment rows');
select is((select count(*)::int from public.attachments where expense_id is null), 2,
  'sales still sees the RFQ and invoice attachments');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('expense-receipts', 'exp1/s.jpg', 's.jpg', 'image/jpeg', 1, 'b4000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'sales cannot attach a receipt to an expense');
select is(public.t_rows($q$update public.attachments set file_name = 'x.jpg' where expense_id is not null$q$), 0,
  'sales cannot update an expense attachment');
select is(public.t_rows($q$delete from public.attachments where expense_id is not null$q$), 0,
  'sales cannot delete an expense attachment');
select is(public.can_access_bucket('expense-receipts'), false, 'can_access_bucket(expense-receipts) is false for sales');
select is((select count(*)::int from storage.objects where bucket_id = 'expense-receipts'), 0,
  'sales cannot read objects in expense-receipts');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('expense-receipts', 'sales.jpg')$$,
  '42501', null, 'sales cannot write objects to expense-receipts');
select is(public.t_rows($q$update storage.objects set name = name where bucket_id = 'expense-receipts'$q$), 0,
  'sales cannot update objects in expense-receipts');
select is((select count(*)::int from storage.objects where bucket_id = 'gst-receipts'), 1,
  'sales still reads gst-receipts');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments where expense_id is not null), 0,
  'engineer sees no expense attachment rows');
select is((select count(*)::int from public.attachments where expense_id is null), 1,
  'engineer still sees the RFQ attachment (not the invoice one)');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, expense_id)
                   values ('expense-receipts', 'exp1/e.jpg', 'e.jpg', 'image/jpeg', 1, 'b4000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'engineer cannot attach a receipt to an expense');
select is(public.t_rows($q$delete from public.attachments where expense_id is not null$q$), 0,
  'engineer cannot delete an expense attachment');
select is((select count(*)::int from storage.objects where bucket_id = 'expense-receipts'), 0,
  'engineer cannot read objects in expense-receipts');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('expense-receipts', 'eng.jpg')$$,
  '42501', null, 'engineer cannot write objects to expense-receipts');

-- ------------------------------------------------------------------ deactivated
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments), 0, 'a deactivated user sees no attachments at all');
select is((select count(*)::int from storage.objects where bucket_id = 'expense-receipts'), 0,
  'a deactivated user cannot read expense-receipts');
select is(public.can_access_bucket('expense-receipts'), false, 'can_access_bucket(expense-receipts) is false when deactivated');

-- ------------------------------------------------------------------ admin through the API
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.attachments where expense_id is not null), 1, 'admin sees the expense attachment');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id)
                  values ('e0000000-0000-4000-8000-0000000000a1', 'expense-receipts', 'exp2/a.jpg', 'a.jpg', 'image/jpeg',
                          1, 'b4000000-0000-4000-8000-000000000002')$$,
  'admin attaches a receipt to an expense');
select is(public.t_rows($q$update public.attachments set file_name = 'r.jpg' where id = 'e0000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin updates an expense attachment');
select is(public.can_access_bucket('expense-receipts'), true, 'can_access_bucket(expense-receipts) is true for admin');
select is((select count(*)::int from storage.objects where bucket_id = 'expense-receipts'), 1,
  'admin reads objects in expense-receipts');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('expense-receipts', 'exp2/a.jpg')$$,
  'admin writes objects to expense-receipts');
select is(public.t_rows($q$delete from public.attachments where id = 'e0000000-0000-4000-8000-0000000000a1'$q$), 1,
  'admin deletes an expense attachment');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.attachments$$, '42501', null, 'anon cannot read attachments');
select throws_ok($$select public.can_access_bucket('expense-receipts')$$, '42501', null, 'anon cannot call can_access_bucket');
reset role;

-- ------------------------------------------------------------------ cascade
select is((select count(*)::int from public.attachments where expense_id = 'b4000000-0000-4000-8000-000000000001'), 1,
  'the receipt exists before its expense is deleted');
delete from public.expenses where id = 'b4000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.attachments where expense_id = 'b4000000-0000-4000-8000-000000000001'), 0,
  'deleting an expense removes its receipt rows (CASCADE)');

select * from finish();
rollback;
