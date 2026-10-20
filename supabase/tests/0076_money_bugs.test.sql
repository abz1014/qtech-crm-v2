-- 0076_money_bugs: the objects 0076 re-creates keep 0074's once-per-statement wrapper (0074_rls_initplan.test.sql only checks at
-- 0074 time), and receivables_list / receivables_summary follow order_receivables' due basis for an undated invoice (M9) and
-- the 7-working-day reminder rule (M5).
begin;
select * from no_plan();

create function pg_temp.has_bare(t text) returns boolean language sql immutable as $f$
  select coalesce(
    regexp_replace(
      regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)(\s+AS\s+current_user_role)?\s*\)', '', 'gi'),
      '\(\s*SELECT\s+auth\.uid\(\)(\s+AS\s+uid)?\s*\)', '', 'gi')
    ~ '(public\.current_user_role\(\)|auth\.uid\(\))', false)
$f$;

select ok(not pg_temp.has_bare(pg_catalog.pg_get_viewdef('public.v_order_money'::regclass)),
  'v_order_money (re-created in 0076) calls current_user_role() only in the wrapped form');
select is((select count(*)::int from pg_catalog.pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('order_receivables', 'aging_as_of', 'month_end_check_details', 'receivables_summary', 'take_month_snapshot_details')
             and pg_temp.has_bare(p.prosrc)), 0,
  'the functions 0076 re-creates call current_user_role() / auth.uid() only in the wrapped form');
select ok((select prosrc ~ 'gst_amount > 0' from pg_catalog.pg_proc where proname = 'month_end_check_details'),
  'month_end_check_details keeps 0074''s gst_amount > 0 (M4)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000761', 'Undated customer');
insert into public.orders (id, company_id, owner_id, ordered_on) values
  ('a1000000-0000-4000-8000-000000000761', 'c0000000-0000-4000-8000-000000000761', 'a0000000-0000-4000-8000-000000000001', '2025-01-01');
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, legacy_flags, legacy_source) values
  ('a1000000-0000-4000-8000-000000000761', 'UND-0761', null, 1000, 180, array['undated'], '{"test":"0076"}');
set local role authenticated;

select ok((select due_on = '2025-01-31' and is_overdue from public.order_receivables('a1000000-0000-4000-8000-000000000761')),
  'M9: the undated invoice is due order date + 30 and overdue');
select is((select (l.due_on, l.is_overdue, l.payment_state, l.balance)::text
           from public.receivables_list(null, null, 'a1000000-0000-4000-8000-000000000761', false) l),
          (select (r.due_on, r.is_overdue, r.payment_state, r.balance)::text
           from public.order_receivables('a1000000-0000-4000-8000-000000000761') r),
  'M9: receivables_list has the same due date, overdue flag, state and balance as order_receivables');
select is((select count(*)::int from public.receivables_list('overdue', 'c0000000-0000-4000-8000-000000000761', null, true)), 1,
  'M9: and lists it under overdue');

-- M5: reminded Mon 5 Oct 2026. On Mon 12 Oct (7 calendar, 5 working days) no reminder is due; on Wed 14 Oct one is.
reset role;
update public.invoices set last_reminded_on = '2026-10-05', reminder_count = 1 where number = 'UND-0761';
set local role authenticated;
select ok((select s12.reminder_due_count + 1 = s14.reminder_due_count
           from public.receivables_summary('2026-10-12') s12, public.receivables_summary('2026-10-14') s14),
  'M5: receivables_summary counts the reminder due on the 7th working day, not the 7th calendar day');

select * from finish();
rollback;
