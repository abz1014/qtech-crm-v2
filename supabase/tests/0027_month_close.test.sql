begin;
select * from no_plan();

-- S22 (migration 0027_month_close), Amendment A6.1 / A6.2 / A6.6.
-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Lock behaviour is checked as the table owner with the admin's claims (the triggers fire for every role);
-- the role checks on the RPCs and the sales/engineer cases switch to `authenticated` below.
-- All fixture rows are dated May to July 2026, safely before the current month.

create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'closed_months', array['month', 'closed_at', 'closed_by', 'note'],
  'closed_months has the A6.1 columns');
select col_is_pk('public', 'closed_months', 'month', 'closed_months is keyed by month');
select throws_ok($$insert into public.closed_months (month, closed_by)
                   values ('2020-01-15', 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'closed_months.month must be the first day of a month');
select ok((select relrowsecurity from pg_class where oid = 'public.closed_months'::regclass),
  'RLS is enabled on closed_months');
select is((select array_agg(policyname::text) from pg_policies
           where schemaname = 'public' and tablename = 'closed_months'),
  array['closed_months_select_admin'], 'closed_months has a single admin-only select policy');
select ok(has_table_privilege('authenticated', 'public.closed_months', 'SELECT')
      and not has_table_privilege('authenticated', 'public.closed_months', 'INSERT')
      and not has_table_privilege('authenticated', 'public.closed_months', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.closed_months', 'DELETE'),
  'clients can only select from closed_months; they write through the RPCs');
select ok(not has_table_privilege('anon', 'public.closed_months', 'SELECT'), 'anon has no privilege on closed_months');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.closed_months'::regclass
                    and tgfoid = 'public.audit_row_change()'::regprocedure and not tgisinternal),
  'closed_months carries the audit trigger');
select is((select count(*)::int from pg_trigger t
           where t.tgfoid = 'public.enforce_month_lock()'::regprocedure and not t.tgisinternal
             and t.tgtype & 1 = 1 and t.tgtype & 2 = 2),
  9, 'the lock trigger is BEFORE ... FOR EACH ROW on nine tables (0115 added credit notes, cash top-ups, cash counts and order costs; 0117 refunds and applied credit)');
select is((select array_agg(c.relname::text order by c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where t.tgfoid = 'public.enforce_month_lock()'::regprocedure and not t.tgisinternal),
  array['cash_counts', 'cash_topups', 'credit_applications', 'credit_notes', 'customer_refunds', 'expenses', 'invoices', 'order_costs', 'payments_in'], 'the lock covers payments_in, expenses and invoices, and (0115) credit notes, cash top-ups, cash counts and order costs');
select ok(not has_function_privilege('authenticated', 'public.month_is_closed(date)', 'execute')
      and not has_function_privilege('anon', 'public.month_is_closed(date)', 'execute'),
  'month_is_closed is for the triggers only: no client grant');
select ok(not has_function_privilege('authenticated', 'public.enforce_month_lock()', 'execute')
      and not has_function_privilege('anon', 'public.enforce_month_lock()', 'execute'),
  'the lock trigger function has no client grant');
select ok(has_function_privilege('authenticated', 'public.close_month(date)', 'execute')
      and has_function_privilege('authenticated', 'public.close_months_through(date)', 'execute')
      and has_function_privilege('authenticated', 'public.reopen_month(date, text)', 'execute')
      and not has_function_privilege('anon', 'public.close_month(date)', 'execute')
      and not has_function_privilege('anon', 'public.close_months_through(date)', 'execute')
      and not has_function_privilege('anon', 'public.reopen_month(date, text)', 'execute'),
  'the three RPCs are executable by authenticated, not anon');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('close_month', 'close_months_through', 'reopen_month', 'month_is_closed')
             and p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'), 4,
  'the month functions are SECURITY DEFINER with a fixed search_path');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('b1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'INV-MAY', '2026-05-10', 100, 18),
  ('b1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'INV-JUN', '2026-06-10', 100, 18),
  ('b1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'INV-JUL', '2026-07-10', 100, 18);
insert into public.payments_in (id, order_id, received_on, amount) values
  ('b2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', '2026-05-15', 118),
  ('b2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', '2026-06-15', 118),
  ('b2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', '2026-07-15', 50);
insert into public.expenses (id, paid_on, amount_pkr, category_id) values
  ('b4000000-0000-4000-8000-000000000005', '2026-05-20', 100, 'ca7e0000-0000-4000-8000-000000000001'),
  ('b4000000-0000-4000-8000-000000000006', '2026-06-20', 100, 'ca7e0000-0000-4000-8000-000000000001'),
  ('b4000000-0000-4000-8000-000000000007', '2026-07-20', 100, 'ca7e0000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------------ nothing is locked while no month is closed
select is((select count(*)::int from public.closed_months), 0, 'no month is closed at the start');
select lives_ok($$update public.payments_in set reference = 'open' where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'with no month closed, payments are editable');
select lives_ok($$update public.invoices set net_amount = 100 where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'with no month closed, invoice amounts are editable');

-- ------------------------------------------------------------------ close_month: the refusals
select throws_ok($$select public.close_month(public.today_pkt())$$, 'P0001', null,
  'close_month on the current month is refused');
select throws_ok($$select public.close_month((public.today_pkt() + interval '2 months')::date)$$, 'P0001', null,
  'close_month on a future month is refused');
select throws_ok($$select public.close_months_through(public.today_pkt())$$, 'P0001', null,
  'close_months_through on the current month is refused');
select throws_ok($$select public.close_month('2026-07-01')$$, 'P0001',
  'May 2026 is still open. Close earlier months first (close_months_through closes them all).',
  'close_month with an earlier open month that has rows is refused, naming the earliest one');
select is((select count(*)::int from public.closed_months), 0, 'the refusals closed nothing');

-- An earlier month with no money rows does not block (nothing before May has any).
select lives_ok($$select public.close_month('2026-04-15')$$,
  'close_month accepts any day of the month and an empty earlier history');
select is((select array_agg(month::text) from public.closed_months), array['2026-04-01'],
  'the month is stored as its first day');
select lives_ok($$select public.close_month('2026-04-01')$$, 'closing a closed month again does nothing');
select is((select count(*)::int from public.closed_months), 1, 'still one closed month');

-- ------------------------------------------------------------------ close_months_through
select is(public.close_months_through('2026-06-01'), 2,
  'close_months_through closes every open month from the first money row (May) through June');
select is((select array_agg(month::text order by month) from public.closed_months),
  array['2026-04-01', '2026-05-01', '2026-06-01'], 'April, May and June are closed');
select is((select closed_by from public.closed_months where month = '2026-06-01'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'closed_by is the admin who closed it');
select is(public.close_months_through('2026-06-01'), 0, 'running it again closes nothing');
select is((select count(*)::int from public.audit_log
           where table_name = 'closed_months' and action = 'insert' and record_id in ('2026-05-01', '2026-06-01')), 2,
  'closing is audited, keyed by the month');

-- ------------------------------------------------------------------ the lock: payments
select throws_ok($$insert into public.payments_in (order_id, received_on, amount)
                   values ('a1000000-0000-4000-8000-000000000001', '2026-05-12', 5)$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'inserting a payment into a closed month is refused');
select throws_ok($$update public.payments_in set reference = 'x' where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'updating a payment in a closed month is refused');
select throws_ok($$update public.payments_in set amount = 119 where id = 'b2000000-0000-4000-8000-000000000006'$$,
  'P0001', 'June 2026 is closed. An admin can reopen it.', 'the message names the month of the row');
select throws_ok($$delete from public.payments_in where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'deleting a payment in a closed month is refused');
select throws_ok($$update public.payments_in set received_on = '2026-05-20' where id = 'b2000000-0000-4000-8000-000000000007'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'moving a payment into a closed month is refused');
select throws_ok($$update public.payments_in set received_on = '2026-07-01' where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'moving a payment out of a closed month is refused');
select lives_ok($$update public.payments_in set bank_month = '2026-05-01' where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'ticking bank_month on a payment in a closed month succeeds');
select lives_ok($$update public.payments_in set bank_month = null where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'and so does removing the tick');
select throws_ok($$update public.payments_in set bank_month = '2026-05-01', reference = 'sneak'
                   where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'a tick bundled with another change is refused');
select lives_ok($$update public.payments_in set reference = 'open' where id = 'b2000000-0000-4000-8000-000000000007'$$,
  'a payment in the open month (July) is still editable');
select lives_ok($$insert into public.payments_in (id, order_id, received_on, amount)
                  values ('b2000000-0000-4000-8000-0000000000a7', 'a1000000-0000-4000-8000-000000000001', '2026-07-16', 5)$$,
  'a payment can still be inserted into an open month');
select lives_ok($$delete from public.payments_in where id = 'b2000000-0000-4000-8000-0000000000a7'$$,
  'and deleted again');

-- ------------------------------------------------------------------ the lock: expenses
select throws_ok($$insert into public.expenses (paid_on, amount_pkr, category_id)
                   values ('2026-06-02', 5, 'ca7e0000-0000-4000-8000-000000000001')$$,
  'P0001', 'June 2026 is closed. An admin can reopen it.', 'inserting an expense into a closed month is refused');
select throws_ok($$update public.expenses set description = 'x' where id = 'b4000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'updating an expense in a closed month is refused');
select throws_ok($$delete from public.expenses where id = 'b4000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'deleting an expense in a closed month is refused');
select throws_ok($$update public.expenses set paid_on = '2026-06-05' where id = 'b4000000-0000-4000-8000-000000000007'$$,
  'P0001', 'June 2026 is closed. An admin can reopen it.', 'moving an expense into a closed month is refused');
select throws_ok($$update public.expenses set paid_on = '2026-07-05' where id = 'b4000000-0000-4000-8000-000000000006'$$,
  'P0001', 'June 2026 is closed. An admin can reopen it.', 'moving an expense out of a closed month is refused');
select lives_ok($$update public.expenses set bank_month = '2026-05-01' where id = 'b4000000-0000-4000-8000-000000000005'$$,
  'ticking bank_month on an expense in a closed month succeeds');
select throws_ok($$update public.expenses set input_tax_pkr = 10 where id = 'b4000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'input tax on a closed-month expense is locked');
select lives_ok($$update public.expenses set description = 'open' where id = 'b4000000-0000-4000-8000-000000000007'$$,
  'an expense in the open month is editable');

-- ------------------------------------------------------------------ the lock: invoices
select throws_ok($$update public.invoices set net_amount = 101 where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'changing net_amount on a closed-month invoice is refused');
select throws_ok($$update public.invoices set gst_amount = 17 where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'changing gst_amount is refused');
select throws_ok($$update public.invoices set number = 'INV-X' where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'changing the number is refused');
select throws_ok($$update public.invoices set invoice_date = '2026-07-01' where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'moving an invoice out of a closed month is refused');
select throws_ok($$update public.invoices set invoice_date = '2026-05-01' where id = 'b1000000-0000-4000-8000-000000000007'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'moving an invoice into a closed month is refused');
select throws_ok($$update public.invoices set company_id = 'c0000000-0000-4000-8000-000000000001'
                   where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'changing company_id is refused');
select throws_ok($$update public.invoices set order_id = null, company_id = 'c0000000-0000-4000-8000-000000000001'
                   where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'changing order_id is refused');
select throws_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-NEW', '2026-06-30', 1, 0)$$,
  'P0001', 'June 2026 is closed. An admin can reopen it.', 'inserting an invoice into a closed month is refused');
select throws_ok($$delete from public.invoices where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'deleting an invoice in a closed month is refused');
select lives_ok($$update public.invoices set net_amount = 100 where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'an update that changes nothing locked is accepted (same net_amount)');
select lives_ok($$update public.invoices set tax_bank_month = '2026-06-01', notes = 'filed', client_received_on = '2026-05-20',
                         last_reminded_on = '2026-06-01', reminder_count = 1, tcs_number = 'T1', tcs_sent_on = '2026-05-12',
                         psid = 'P1', wasif_receipt_on = '2026-06-02', tax_deposited_on = '2026-06-03',
                         tax_deposit_amount = 18, copy_received_on = '2026-05-11'
                  where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'the filing and reminder columns and tax_bank_month stay editable in a closed month');
select lives_ok($$update public.invoices set net_amount = 110 where id = 'b1000000-0000-4000-8000-000000000007'$$,
  'an invoice in the open month is editable');

-- stamp RPCs in a closed month (they only touch the exempt columns, so they need no change)
select is(public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000006']::uuid[], 'T2', '2026-06-12'), 1,
  'stamp_tcs_sent works on a closed-month invoice');
select is(public.stamp_fbr_psid(array['b1000000-0000-4000-8000-000000000006']::uuid[], 'P2'), 1,
  'stamp_fbr_psid works on a closed-month invoice');
select is(public.stamp_tax_deposited(array['b1000000-0000-4000-8000-000000000006']::uuid[]), 1,
  'stamp_tax_deposited works on a closed-month invoice');
select is(public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000006']::uuid[]), 1,
  'stamp_payment_reminder works on a closed-month invoice');
select ok((select tcs_number = 'T2' and psid = 'P2' and tax_deposited_on is not null and tax_deposit_amount = 18
                  and reminder_count = 1
           from public.invoices where id = 'b1000000-0000-4000-8000-000000000006'),
  'the stamps landed on the closed-month invoice');

-- ------------------------------------------------------------------ sales and engineer
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.closed_months), 0, 'sales cannot read closed_months');
select throws_ok($$update public.invoices set net_amount = 105 where id = 'b1000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.',
  'sales editing a closed-month invoice amount gets the plain closed-month message (the lock works without a grant)');
select is(public.t_rows($q$update public.invoices set notes = 'sales note' where id = 'b1000000-0000-4000-8000-000000000005'$q$), 1,
  'sales can still edit the notes of a closed-month invoice');
select is(public.stamp_tcs_sent(array['b1000000-0000-4000-8000-000000000005']::uuid[], null, null), 0,
  'sales stamps TCS on an invoice that is already stamped: nothing changes, no error');
select is(public.stamp_payment_reminder(array['b1000000-0000-4000-8000-000000000005']::uuid[]), 1,
  'sales can stamp a payment reminder on a closed-month invoice');
select throws_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount)
                   values ('a1000000-0000-4000-8000-000000000001', 'INV-S', '2026-05-30', 1, 0)$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'sales cannot insert an invoice into a closed month');
select throws_ok($$select public.close_month('2026-07-01')$$, '42501', null, 'sales cannot close a month');
select throws_ok($$select public.close_months_through('2026-07-01')$$, '42501', null, 'sales cannot close months through a month');
select throws_ok($$select public.reopen_month('2026-06-01')$$, '42501', null, 'sales cannot reopen a month');
select throws_ok($$select public.month_is_closed('2026-06-01')$$, '42501', null, 'sales cannot call month_is_closed');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok($$select public.close_month('2026-07-01')$$, '42501', null, 'engineer cannot close a month');
select throws_ok($$select public.close_months_through('2026-07-01')$$, '42501', null, 'engineer cannot close months through a month');
select throws_ok($$select public.reopen_month('2026-06-01')$$, '42501', null, 'engineer cannot reopen a month');
select is((select count(*)::int from public.closed_months), 0, 'engineer cannot read closed_months');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select throws_ok($$select public.close_month('2026-07-01')$$, '42501', null, 'a deactivated user cannot close a month');
select throws_ok($$select public.close_months_through('2026-07-01')$$, '42501', null, 'a deactivated user cannot close months through a month');
select throws_ok($$select public.reopen_month('2026-06-01')$$, '42501', null, 'a deactivated user cannot reopen a month');

-- ------------------------------------------------------------------ admin through the API
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.closed_months), 3, 'admin reads the three closed months');
select throws_ok($$insert into public.closed_months (month) values ('2026-07-01')$$, '42501', null,
  'even an admin cannot insert into closed_months directly');
select throws_ok($$delete from public.closed_months where month = '2026-06-01'$$, '42501', null,
  'even an admin cannot delete from closed_months directly');
select throws_ok($$update public.closed_months set note = 'x' where month = '2026-06-01'$$, '42501', null,
  'even an admin cannot update closed_months directly');
select lives_ok($$select public.close_month('2026-07-01')$$, 'admin closes July once June is closed');
select throws_ok($$update public.payments_in set reference = 'x' where id = 'b2000000-0000-4000-8000-000000000007'$$,
  'P0001', 'July 2026 is closed. An admin can reopen it.', 'July is now locked');

select lives_ok($$select public.reopen_month('2026-07-01', 'late supplier credit note')$$, 'admin reopens July with a note');
select is((select count(*)::int from public.closed_months where month = '2026-07-01'), 0, 'the July row is gone');
select ok(exists (select 1 from public.audit_log where table_name = 'closed_months' and action = 'delete'
                  and record_id = '2026-07-01' and changed_by = 'a0000000-0000-4000-8000-000000000001'),
  'reopening writes an audit row (delete, keyed by the month, by the admin)');
select ok(exists (select 1 from public.audit_log where table_name = 'closed_months' and action = 'update'
                  and record_id = '2026-07-01' and new_value ->> 'note' like '%late supplier credit note%'),
  'the reopen note is in the audit log');
select lives_ok($$update public.payments_in set reference = 'x' where id = 'b2000000-0000-4000-8000-000000000007'$$,
  'July is editable again');

select lives_ok($$select public.reopen_month('2026-06-01')$$, 'admin reopens June without a note');
select lives_ok($$update public.payments_in set amount = 118.50 where id = 'b2000000-0000-4000-8000-000000000006'$$,
  'June is editable again');
select throws_ok($$update public.payments_in set amount = 119 where id = 'b2000000-0000-4000-8000-000000000005'$$,
  'P0001', 'May 2026 is closed. An admin can reopen it.', 'May is still locked');
select lives_ok($$select public.reopen_month('2026-03-01')$$, 'reopening a month that is not closed does nothing');
select lives_ok($$select public.close_month('2026-06-01')$$, 'June closes again');
select is((select count(*)::int from public.audit_log where table_name = 'closed_months' and record_id = '2026-06-01'), 3,
  'June has insert, delete and insert in the audit log');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.closed_months$$, '42501', null, 'anon cannot read closed_months');
select throws_ok($$select public.close_month('2026-07-01')$$, '42501', null, 'anon cannot call close_month');
reset role;

select * from finish();
rollback;
