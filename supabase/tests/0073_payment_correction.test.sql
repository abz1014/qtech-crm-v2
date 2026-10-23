-- 0073_payment_correction: void, correct and undo a recorded payment (soft void; history kept).
--   structure      the four columns, the guard trigger, the three RPCs (SECURITY INVOKER, authenticated only)
--   readers        every view and function in public that reads payments_in leaves voided rows out (or is listed with its reason)
--   permissions    admin only: sales, engineer, deactivated and anon are refused
--   figures        balances (order_receivables, v_order_money), aging, P&L, cash, target progress, month-end checks and the
--                  exceptions input before and after a void, an Undo and a correction, against figures worked out by hand
--   refusals       closed month (old and new date), bank tick, no reason, already voided, nothing changed, Undo by someone
--                  else or after 10 minutes, Undo after the correction changed; the guard on direct writes
--   legacy         an imported payment is voided with a reason; its correction stays unattributed
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
begin;
select * from no_plan();

-- ================================================================== structure
select has_column('public', 'payments_in', 'voided_at', 'payments_in.voided_at exists');
select has_column('public', 'payments_in', 'voided_by', 'payments_in.voided_by exists');
select has_column('public', 'payments_in', 'void_reason', 'payments_in.void_reason exists');
select has_column('public', 'payments_in', 'corrects_payment_id', 'payments_in.corrects_payment_id exists');
select fk_ok('public', 'payments_in', 'corrects_payment_id', 'public', 'payments_in', 'id',
  'a correction references the payment it replaces');
select fk_ok('public', 'payments_in', 'voided_by', 'public', 'users', 'id', 'voided_by references users');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'payments_in_one_live_correction'
                    and indexdef like 'CREATE UNIQUE INDEX%'),
  'at most one live correction per payment (unique partial index)');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.payments_in'::regclass
                    and tgname = 'payments_in_void_guard' and not tgisinternal and tgtype & 2 = 2),
  'payments_in carries the BEFORE guard trigger');
select ok((select array_position(x.names, 'payments_in_month_lock') < array_position(x.names, 'payments_in_void_guard')
           from (select array_agg(t.tgname::text order by t.tgname::text collate "C") as names from pg_trigger t
                 where t.tgrelid = 'public.payments_in'::regclass and not t.tgisinternal
                   and t.tgtype & 2 = 2 and t.tgtype & 16 = 16) x),
  'BEFORE UPDATE triggers fire in name order: the month lock before the guard, so a closed month answers first');
select ok(not has_function_privilege('authenticated', 'public.guard_payment_void()', 'execute')
      and not has_function_privilege('anon', 'public.guard_payment_void()', 'execute'),
  'the guard trigger function has no client grant');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('void_payment', 'correct_payment', 'restore_payment')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'),
  array['correct_payment', 'restore_payment', 'void_payment'],
  'the three RPCs are SECURITY INVOKER with a fixed search_path');
select ok(has_function_privilege('authenticated', 'public.void_payment(uuid, text)', 'execute')
      and has_function_privilege('authenticated', 'public.correct_payment(uuid, numeric, date, text, text, text, uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.restore_payment(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.void_payment(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.correct_payment(uuid, numeric, date, text, text, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.restore_payment(uuid)', 'execute'),
  'the RPCs are executable by authenticated, not anon');

-- Every reader of payments_in leaves voided rows out. A view or function in public whose text names payments_in must also
-- name voided_at, apart from these four (see the 0073 header): close_month and close_months_through only find the earliest
-- month with a money row (a voided row still dates its month), enforce_month_lock locks voided rows like any other, and
-- take_month_snapshot reads payments through v_payment_net (it joins payments_in only for the reference).
select is((select coalesce(array_agg(x.name order by x.name), '{}') from (
             select p.proname::text as name from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.prosrc ~ '\mpayments_in\M' and p.prosrc !~ '\mvoided_at\M'
             union all
             select v.viewname::text from pg_views v
             where v.schemaname = 'public'
               and v.definition ~ '\mpayments_in\M' and v.definition !~ '\mvoided_at\M'
           ) x),
  array['close_month', 'close_months_through', 'enforce_month_lock', 'record_history', 'take_month_snapshot'],
  'every other view and function that reads payments_in leaves voided payments out');

-- ================================================================== fixtures (table owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000073', 'Correction customer');
-- O1: one 18% line of 10,000 (gross 11,800), invoiced on 5 February 2025 (due 7 March with the default 30 days), paid in
--     two halves of 5,900 (P1 10 Feb, P2 20 Feb). Net share of a payment = amount x 10,000 / 11,800.
-- O2: an imported order (exempt, 3,000) with two imported payments in January 2025 (PL 1,000, PL2 2,000), credited to nobody.
-- O3: cancelled on 1 March 2025, exempt 500, paid 500 on 12 March (P3): "payment on a cancelled order".
insert into public.orders (id, company_id, owner_id, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000731', 'c0000000-0000-4000-8000-000000000073', 'a0000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000000732', 'c0000000-0000-4000-8000-000000000073', 'a0000000-0000-4000-8000-000000000002', null),
  ('a1000000-0000-4000-8000-000000000733', 'c0000000-0000-4000-8000-000000000073', 'a0000000-0000-4000-8000-000000000002', '2025-03-01');
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000731', 'correction item', 1, 10000, 18),
  ('a1000000-0000-4000-8000-000000000732', 'imported item', 1, 3000, 0),
  ('a1000000-0000-4000-8000-000000000733', 'cancelled item', 1, 500, 0);
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000731', 'a1000000-0000-4000-8000-000000000731', 'INV-PC-1', '2025-02-05', 10000, 1800);
insert into public.payments_in (id, order_id, received_on, amount, reference) values
  ('a4000000-0000-4000-8000-000000000731', 'a1000000-0000-4000-8000-000000000731', '2025-02-10', 5900, 'TT-1'),
  ('a4000000-0000-4000-8000-000000000732', 'a1000000-0000-4000-8000-000000000731', '2025-02-20', 5900, 'TT-2'),
  ('a4000000-0000-4000-8000-000000000735', 'a1000000-0000-4000-8000-000000000733', '2025-03-12', 500, null);
insert into public.payments_in (id, order_id, received_on, amount, reference, legacy_source) values
  ('a4000000-0000-4000-8000-000000000733', 'a1000000-0000-4000-8000-000000000732', '2025-01-15', 1000, 'LEG-1', '{"table":"order_payments","id":"7"}'),
  ('a4000000-0000-4000-8000-000000000734', 'a1000000-0000-4000-8000-000000000732', '2025-01-20', 2000, 'LEG-2', '{"table":"order_payments","id":"8"}');

select ok((select credited_user_id is null from public.payments_in where id = 'a4000000-0000-4000-8000-000000000733'),
  'fixture: an imported payment is credited to nobody');

-- ================================================================== permissions
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000731', 'x')$$, '42501', null, 'sales cannot void a payment');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 1, '2025-02-10', 'bank', null, 'x')$$,
  '42501', null, 'sales cannot correct a payment');
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000731')$$, '42501', null, 'sales cannot undo a void');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000731', 'x')$$, '42501', null, 'an engineer cannot void a payment');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 1, '2025-02-10', 'bank', null, 'x')$$,
  '42501', null, 'an engineer cannot correct a payment');
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000731')$$, '42501', null, 'an engineer cannot undo a void');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000731', 'x')$$, '42501', null, 'a deactivated user cannot void a payment');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000731', 'x')$$, '42501', null, 'anon cannot void a payment');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 1, '2025-02-10', 'bank', null, 'x')$$,
  '42501', null, 'anon cannot correct a payment');
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000731')$$, '42501', null, 'anon cannot undo a void');
reset role;
select ok((select count(*) = 0 from public.payments_in where voided_at is not null), 'nothing was voided by the refused calls');

-- ================================================================== before: the figures with every payment counted
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok((select settled = 11800 and balance = 0 and payment_state = 'settled'
           from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'before: O1 is settled (11,800 of 11,800)');
select ok((select settled = 11800 and receivable = 0 from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000731'),
  'before: v_order_money agrees');
select is((select count(*)::int from public.aging_as_of('2025-02-28') where order_id = 'a1000000-0000-4000-8000-000000000731'), 0,
  'before: nothing of O1 is open in the aging at 28 February');
select ok((select net_in = 10000 and gst_in = 1800 from public.v_month_pnl where month = '2025-02-01'),
  'before: February P&L: net in 10,000, GST 1,800');
select is((select gross_received from public.v_cash_month where month = '2025-02-01'), 11800.00::numeric,
  'before: February cash in 11,800');
select is((select achieved_net from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2025 and quarter = 1), 10500.00::numeric,
  'before: sales target Q1 2025: 10,000 (O1) + 500 (O3)');
select is((select n from public.month_end_status('2025-02-01') where check_key = 'bank_unticked'), 4,
  'before: four bank payments to tick up to February (P1, P2, PL, PL2)');
select ok((select (detail ->> 'in_n')::int = 4 and (detail ->> 'in_amount')::numeric = 14800 and (detail ->> 'prior_n')::int = 2
           from public.month_end_check_details('2025-02-01') where check_key = 'bank_unticked'),
  'before: the checklist figures: 4 in, 14,800, 2 of them from before February');
select ok((public.money_exceptions_input() -> 'payments') @> '[{"id":"a4000000-0000-4000-8000-000000000735"}]'::jsonb,
  'before: the payment on the cancelled order is flagged');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select achieved_net from public.my_target_progress_at('2025-02-25 12:00:00+05')), 10500.00::numeric,
  'before: the sales tile for Q1 2025 reads 10,500');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== void P2 (typed twice)
set local role authenticated;
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000732', '   ')$$,
  '22023', 'Give a reason for voiding this payment (a few words).', 'a void needs a reason');
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-0000000007ff', 'x')$$,
  'P0002', 'This payment is no longer there. Reload the page.', 'an unknown payment is not found');
select lives_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000732', ' Typed twice ')$$, 'admin voids P2');
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000732', 'again')$$,
  'P0001', 'This payment is already voided. Nothing was changed.', 'a payment is voided once');
reset role;

select ok((select voided_at is not null and voided_by = 'a0000000-0000-4000-8000-000000000001' and void_reason = 'Typed twice'
                  and amount = 5900 and reference = 'TT-2'
           from public.payments_in where id = 'a4000000-0000-4000-8000-000000000732'),
  'the voided row stays, marked with when, who and why (reason trimmed)');
select is((select count(*)::int from public.audit_log
           where table_name = 'payments_in' and record_id = 'a4000000-0000-4000-8000-000000000732' and action = 'update'
             and changed_by = 'a0000000-0000-4000-8000-000000000001'
             and old_value ->> 'voided_at' is null and new_value ->> 'void_reason' = 'Typed twice'), 1,
  'the void is in the audit log, by the admin');

set local role authenticated;
select ok((select settled = 5900 and balance = 5900 and payment_state = 'overdue'
           from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'after the void: O1 has 5,900 settled and 5,900 to collect, overdue since 7 March 2025');
select ok((select settled = 5900 and receivable = 5900 and payment_state = 'overdue'
           from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000731'),
  'after the void: v_order_money agrees');
select ok((select applied = 5900 and remaining = 5900 and bucket = '0-30' and age_days = 23
           from public.aging_as_of('2025-02-28') where order_id = 'a1000000-0000-4000-8000-000000000731'),
  'after the void: INV-PC-1 has 5,900 open in the 0-30 bucket at 28 February');
select ok((select net_in = 5000 and gst_in = 900 from public.v_month_pnl where month = '2025-02-01'),
  'after the void: February P&L: net in 5,000, GST 900');
select is((select gross_received from public.v_cash_month where month = '2025-02-01'), 5900.00::numeric,
  'after the void: February cash in 5,900');
select is((select count(*)::int from public.v_payment_net where payment_id = 'a4000000-0000-4000-8000-000000000732'), 0,
  'after the void: the payment is not in v_payment_net');
select is((select achieved_net from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2025 and quarter = 1), 5500.00::numeric,
  'after the void: sales target Q1 2025: 5,500');
select is((select n from public.month_end_status('2025-02-01') where check_key = 'bank_unticked'), 3,
  'after the void: three bank payments to tick');
select ok((select (detail ->> 'in_n')::int = 3 and (detail ->> 'in_amount')::numeric = 8900
           from public.month_end_check_details('2025-02-01') where check_key = 'bank_unticked'),
  'after the void: the checklist figures: 3 in, 8,900');
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select achieved_net from public.my_target_progress_at('2025-02-25 12:00:00+05')), 5500.00::numeric,
  'after the void: the sales tile reads 5,500');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== Undo (restore) within the window, by the same person
set local role authenticated;
select lives_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000732')$$, 'admin undoes the void at once');
select ok((select settled = 11800 and balance = 0 from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'after Undo: O1 is settled again');
select ok((select net_in = 10000 from public.v_month_pnl where month = '2025-02-01'), 'after Undo: February net in is 10,000 again');
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000732')$$,
  'P0001', 'This payment is not voided. Nothing to undo.', 'Undo of a payment that is not voided is refused');
reset role;
select ok((select voided_at is null and voided_by is null and void_reason is null
           from public.payments_in where id = 'a4000000-0000-4000-8000-000000000732'),
  'after Undo: the void marks are cleared');
select is((select count(*)::int from public.audit_log
           where table_name = 'payments_in' and record_id = 'a4000000-0000-4000-8000-000000000732' and action = 'update'
             and old_value ->> 'void_reason' = 'Typed twice' and new_value ->> 'voided_at' is null), 1,
  'the Undo is in the audit log too');

-- someone else cannot undo it; nobody can after 10 minutes
set local role authenticated;
select lives_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000732', 'Typed twice')$$, 'P2 is voided again');
reset role;
update public.users set role = 'admin' where id = 'a0000000-0000-4000-8000-000000000002';   -- a second admin, for this check only
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000732')$$,
  'P0001', 'Only the person who voided this payment can undo it. Record the payment again instead.',
  'another admin cannot undo the void');
reset role;
update public.users set role = 'sales' where id = 'a0000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update public.payments_in set voided_at = voided_at - interval '11 minutes' where id = 'a4000000-0000-4000-8000-000000000732';
set local role authenticated;
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000732')$$,
  'P0001', 'Undo works for 10 minutes after a void. Record the payment again instead.', 'Undo is refused after 10 minutes');
reset role;
select ok((select voided_at is not null from public.payments_in where id = 'a4000000-0000-4000-8000-000000000732'),
  'P2 stays voided');

-- ================================================================== bank tick
set local role authenticated;
update public.payments_in set bank_month = '2025-02-01' where id = 'a4000000-0000-4000-8000-000000000731';
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000731', 'Wrong amount')$$,
  'P0001', 'This payment is ticked against the February 2025 bank statement. Untick it first (Money, Match bank statement), then change it.',
  'a ticked payment cannot be voided');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 5000, '2025-02-11', 'cash', 'CHQ-9', 'Wrong amount')$$,
  'P0001', 'This payment is ticked against the February 2025 bank statement. Untick it first (Money, Match bank statement), then change it.',
  'a ticked payment cannot be corrected');
update public.payments_in set bank_month = null where id = 'a4000000-0000-4000-8000-000000000731';

-- ================================================================== correct P1: 5,000 in cash on 11 February
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 5900, '2025-02-10', 'bank', ' TT-1 ', 'x')$$,
  '22023', 'Nothing to correct: the amount, date, paid via and reference are all the same.', 'a correction must change something');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 0, '2025-02-11', 'cash', null, 'x')$$,
  '22023', 'The amount must be above zero.', 'a correction needs an amount above zero');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 5000, '2025-02-11', 'card', null, 'x')$$,
  '22023', 'Paid via must be bank or cash.', 'paid via is bank or cash');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 5000, '2025-02-11', 'cash', null, '')$$,
  '22023', 'Give a reason for voiding this payment (a few words).', 'a correction needs a reason');
select is(public.correct_payment('a4000000-0000-4000-8000-000000000731', 5000, '2025-02-11', 'cash', 'CHQ-9', 'Wrong amount',
                                 'a4000000-0000-4000-8000-0000000007c1'),
  'a4000000-0000-4000-8000-0000000007c1'::uuid, 'correct_payment returns the new payment''s id');
select is(public.correct_payment('a4000000-0000-4000-8000-000000000731', 5000, '2025-02-11', 'cash', 'CHQ-9', 'Wrong amount',
                                 'a4000000-0000-4000-8000-0000000007c1'),
  'a4000000-0000-4000-8000-0000000007c1'::uuid, 'a retry with the same new id returns it again');
reset role;
select is((select count(*)::int from public.payments_in where corrects_payment_id = 'a4000000-0000-4000-8000-000000000731'), 1,
  'the retry made no second correction');
select ok((select voided_at is not null and void_reason = 'Wrong amount' from public.payments_in
           where id = 'a4000000-0000-4000-8000-000000000731'),
  'the original is voided with the reason');
select ok((select order_id = 'a1000000-0000-4000-8000-000000000731' and amount = 5000 and received_on = '2025-02-11'
                  and paid_via = 'cash' and reference = 'CHQ-9' and voided_at is null and legacy_source is null
                  and credited_user_id = 'a0000000-0000-4000-8000-000000000002'
                  and created_by = 'a0000000-0000-4000-8000-000000000001'
                  and created_at = (select voided_at from public.payments_in where id = 'a4000000-0000-4000-8000-000000000731')
           from public.payments_in where id = 'a4000000-0000-4000-8000-0000000007c1'),
  'the correction: same order, the new figures, same credited person, made by the admin when the original was voided');
select is((select count(*)::int from public.audit_log
           where table_name = 'payments_in' and record_id = 'a4000000-0000-4000-8000-0000000007c1' and action = 'insert'
             and new_value ->> 'corrects_payment_id' = 'a4000000-0000-4000-8000-000000000731'), 1,
  'the correction is in the audit log');

set local role authenticated;
-- O1 now has only the correction (P2 voided, P1 voided): 5,000 of 11,800. Net share 5,000 x 10,000 / 11,800 = 4,237.29.
select ok((select settled = 5000 and balance = 6800 from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'after the correction: O1 has 5,000 settled and 6,800 to collect');
select ok((select settled = 5000 and receivable = 6800 from public.v_order_money where order_id = 'a1000000-0000-4000-8000-000000000731'),
  'after the correction: v_order_money agrees');
select ok((select applied = 5000 and remaining = 6800 from public.aging_as_of('2025-02-28')
           where order_id = 'a1000000-0000-4000-8000-000000000731'),
  'after the correction: the aging shows 6,800 open');
select ok((select net_in = 4237.29 and gst_in = 762.71 from public.v_month_pnl where month = '2025-02-01'),
  'after the correction: February P&L: net in 4,237.29, GST 762.71');
select is((select gross_received from public.v_cash_month where month = '2025-02-01'), 5000.00::numeric,
  'after the correction: February cash in 5,000');
select is((select achieved_net from public.v_target_progress
           where user_id = 'a0000000-0000-4000-8000-000000000002' and year = 2025 and quarter = 1), 4737.29::numeric,
  'after the correction: sales target Q1 2025: 4,237.29 + 500');
select is((select n from public.month_end_status('2025-02-01') where check_key = 'bank_unticked'), 2,
  'after the correction: the cash correction needs no tick; PL and PL2 remain');

-- Undo of the correction: the original comes back and the correction is voided, so the money counts once
select lives_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000731')$$, 'admin undoes the correction');
select ok((select settled = 5900 and balance = 5900 from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'after undoing the correction: O1 has P1 (5,900) again and nothing else');
reset role;
select ok((select voided_at is not null and void_reason = 'Undo of a correction' and voided_by = 'a0000000-0000-4000-8000-000000000001'
           from public.payments_in where id = 'a4000000-0000-4000-8000-0000000007c1'),
  'the undone correction is kept, voided');
select ok((select voided_at is null from public.payments_in where id = 'a4000000-0000-4000-8000-000000000731'), 'P1 counts again');

-- a correction of a correction: Undo of the first is refused, Undo of the second works
set local role authenticated;
select lives_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000731', 5800, '2025-02-10', 'bank', 'TT-1', 'Bank charge',
                                                'a4000000-0000-4000-8000-0000000007c2')$$, 'P1 corrected to 5,800 (N2)');
select lives_ok($$select public.correct_payment('a4000000-0000-4000-8000-0000000007c2', 5700, '2025-02-10', 'bank', 'TT-1', 'Bank charge again',
                                                'a4000000-0000-4000-8000-0000000007c3')$$, 'N2 corrected to 5,700 (N3)');
select throws_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000731')$$,
  'P0001', 'The correction of this payment has been changed since. Undo is no longer possible; record the payment again if it is missing.',
  'Undo of P1 is refused once its correction was corrected again');
select lives_ok($$select public.restore_payment('a4000000-0000-4000-8000-0000000007c2')$$, 'Undo of the second correction');
select ok((select settled = 5800 from public.order_receivables('a1000000-0000-4000-8000-000000000731')),
  'O1 now counts N2 (5,800) only');

-- an older correction that was undone does not stop the Undo of a later plain void (P3)
select lives_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000735', 450, '2025-03-12', 'bank', null, 'Typo',
                                                'a4000000-0000-4000-8000-0000000007c4')$$, 'P3 corrected (N4)');
select lives_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000735')$$, 'and undone');
select lives_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000735', 'Belongs to another order')$$, 'P3 voided');
select lives_ok($$select public.restore_payment('a4000000-0000-4000-8000-000000000735')$$, 'and that void undone');
reset role;
select is((select count(*)::int from public.payments_in where order_id = 'a1000000-0000-4000-8000-000000000733' and voided_at is null), 1,
  'O3 counts P3 once; the undone correction N4 stays voided');

-- the exceptions input forgets a voided payment
set local role authenticated;
select lives_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000735', 'Belongs to another order')$$, 'P3 voided for good');
select ok(not ((public.money_exceptions_input() -> 'payments') @> '[{"id":"a4000000-0000-4000-8000-000000000735"}]'::jsonb),
  'a voided payment on a cancelled order is no longer flagged');
reset role;

-- ================================================================== closed month
set local role authenticated;
select lives_ok($$select public.close_month('2025-01-01')$$, 'January 2025 is closed');
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000733', 'Duplicate of an import row')$$,
  'P0001', 'January 2025 is closed. Reopen it first (Money, Month-end), then change this payment.',
  'a payment in a closed month cannot be voided; the admin is told to reopen it');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000734', 1500, '2025-02-03', 'bank', 'LEG-2', 'x')$$,
  'P0001', 'January 2025 is closed. Reopen it first (Money, Month-end), then change this payment.',
  'a payment in a closed month cannot be corrected, not even to a date in an open month');
select throws_ok($$select public.correct_payment('a4000000-0000-4000-8000-0000000007c2', 5800, '2025-01-31', 'bank', 'TT-1', 'Wrong date')$$,
  'P0001', 'The new date is in January 2025, which is closed. Reopen it first (Money, Month-end), or choose a date in an open month.',
  'a correction cannot move a payment into a closed month');
select ok((select voided_at is null from public.payments_in where id = 'a4000000-0000-4000-8000-0000000007c2'),
  'the refused correction changed nothing');
select lives_ok($$select public.reopen_month('2025-01-01', 'void an imported payment')$$, 'January 2025 is reopened');

-- ================================================================== legacy payments
select throws_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000733', null)$$,
  '22023', 'Give a reason for voiding this payment (a few words).', 'an imported payment needs a reason too');
select lives_ok($$select public.void_payment('a4000000-0000-4000-8000-000000000733', 'Duplicate of an import row')$$,
  'an imported payment is voided with a reason');
select lives_ok($$select public.correct_payment('a4000000-0000-4000-8000-000000000734', 1500, '2025-01-20', 'bank', 'LEG-2', 'Imported amount was wrong',
                                                'a4000000-0000-4000-8000-0000000007c5')$$, 'an imported payment is corrected');
select ok((select net_in = 1500 from public.v_month_pnl where month = '2025-01-01'),
  'January P&L: only the corrected 1,500 counts (1,000 voided, 2,000 replaced)');
reset role;
select ok((select voided_at is not null and void_reason = 'Duplicate of an import row'
                  and legacy_source is not null and credited_user_id is null
                  and (select data ->> 'id' from legacy_archive.legacy_rows where table_name = 'payments_in' and row_id = 'a4000000-0000-4000-8000-000000000733') = '7'
           from public.payments_in where id = 'a4000000-0000-4000-8000-000000000733'),
  'the voided imported payment keeps its legacy source and stays credited to nobody');
select ok((select credited_user_id is null and legacy_source is null and corrects_payment_id = 'a4000000-0000-4000-8000-000000000734'
           from public.payments_in where id = 'a4000000-0000-4000-8000-0000000007c5'),
  'the correction of an imported payment stays unattributed (it does not take the order owner) and is not marked imported');

-- ================================================================== the guard on direct writes (admin, through the API)
set local role authenticated;
select throws_ok($$update public.payments_in set voided_at = now(), void_reason = 'x' where id = 'a4000000-0000-4000-8000-0000000007c2'$$,
  '42501', 'a payment is voided or restored only through void_payment, correct_payment and restore_payment',
  'the void columns are not written directly');
select throws_ok($$update public.payments_in set voided_at = null, void_reason = null, voided_by = null where id = 'a4000000-0000-4000-8000-000000000732'$$,
  '42501', 'a payment is voided or restored only through void_payment, correct_payment and restore_payment',
  'a void is not cleared directly');
select throws_ok($$insert into public.payments_in (order_id, amount, voided_at, void_reason) values ('a1000000-0000-4000-8000-000000000731', 1, now(), 'x')$$,
  '42501', 'a payment is voided only through void_payment or correct_payment', 'a payment is not inserted voided');
select throws_ok($$insert into public.payments_in (order_id, amount, corrects_payment_id) values ('a1000000-0000-4000-8000-000000000731', 1, 'a4000000-0000-4000-8000-000000000732')$$,
  '42501', 'a correction is recorded only through correct_payment', 'a correction is not inserted directly');
select throws_ok($$update public.payments_in set corrects_payment_id = null where id = 'a4000000-0000-4000-8000-0000000007c2'$$,
  '42501', 'which payment a correction replaces cannot be changed', 'the link of a correction is fixed');
select throws_ok($$update public.payments_in set reference = 'x' where id = 'a4000000-0000-4000-8000-000000000732'$$,
  'P0001', 'This payment is voided and kept as history. It cannot be changed.', 'a voided payment cannot be changed');
select throws_ok($$update public.payments_in set bank_month = '2025-02-01' where id = 'a4000000-0000-4000-8000-000000000732'$$,
  'P0001', 'This payment is voided and kept as history. It cannot be changed.', 'a voided payment cannot be ticked');
select throws_ok($$delete from public.payments_in where id = 'a4000000-0000-4000-8000-000000000732'$$,
  'P0001', 'This payment is voided and kept as history. It cannot be deleted.', 'a voided payment cannot be deleted');
select lives_ok($$update public.payments_in set reference = reference where id = 'a4000000-0000-4000-8000-000000000732'$$,
  'a no-op update of a voided payment is harmless');
select lives_ok($$update public.payments_in set reference = 'TT-1b' where id = 'a4000000-0000-4000-8000-0000000007c2'$$,
  'a live payment is still edited as before');
reset role;
-- and the table itself never holds a ticked voided row, whoever writes
select throws_ok($$update public.payments_in set bank_month = '2025-02-01' where id = 'a4000000-0000-4000-8000-000000000732'$$,
  '23514', null, 'CHECK: a voided payment is never ticked');

select * from finish();
rollback;
