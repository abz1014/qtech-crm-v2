-- 0136 and 0138 both change public.enforce_month_lock(): 0136 recreates it whole (an enquiry's cost moves to its order on conversion, and rfq_id /
-- visit_id may go empty), 0138 then patches the result (an auto_booked flip alone never touches a closed month). The definition that is live
-- after ALL migrations must hold both. Fixture year 2014 (no other fixture uses it); March 2014 is closed.
--   E1 cost on enquiry R, paid 2014-03-10      E2 auto-booked bill, paid 2014-03-15 (confirm)
--   E3 ordinary cost, paid 2014-03-18          E4 auto-booked bill, paid 2014-03-20 (other edits)
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- the live definition carries the branches of both migrations
select ok(strpos(pg_get_functiondef('public.enforce_month_lock()'::regprocedure), '''auto_booked''') > 0, 'the live month lock names auto_booked (0138)');
select ok(strpos(pg_get_functiondef('public.enforce_month_lock()'::regprocedure), '''rfq_id''') > 0
      and strpos(pg_get_functiondef('public.enforce_month_lock()'::regprocedure), '''visit_id''') > 0, 'and rfq_id and visit_id (0136)');
select ok(strpos(pg_get_functiondef('public.enforce_month_lock()'::regprocedure), '''wht_certificate_name''') > 0
      and strpos(pg_get_functiondef('public.enforce_month_lock()'::regprocedure), 'category_merge') > 0, 'and the older branches (0128, 0086)');
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.expenses'::regclass and t.tgfoid = 'public.enforce_month_lock()'::regprocedure), 1,
  'the lock is attached to expenses once');

insert into public.companies (id, name) values ('01380000-0000-4000-8000-0000000000c0', '0138 lock Co');
insert into public.rfqs (id, company_id, owner_id) values
  ('01380000-0000-4000-8000-0000000000a1', '01380000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002');
insert into public.expenses (id, amount_pkr, category_id, paid_on, rfq_id, auto_booked, paid_via) values
  ('01380000-0000-4000-8000-0000000000e1', 100, 'ca7e0000-0000-4000-8000-000000000005', '2014-03-10', '01380000-0000-4000-8000-0000000000a1', false, 'bank'),
  ('01380000-0000-4000-8000-0000000000e2', 200, 'ca7e0000-0000-4000-8000-000000000005', '2014-03-15', null, true, 'bank'),
  ('01380000-0000-4000-8000-0000000000e3', 300, 'ca7e0000-0000-4000-8000-000000000005', '2014-03-18', null, false, 'bank'),
  ('01380000-0000-4000-8000-0000000000e4', 400, 'ca7e0000-0000-4000-8000-000000000005', '2014-03-20', null, true, 'bank');
insert into public.closed_months (month, closed_by) values ('2014-03-01', 'a0000000-0000-4000-8000-000000000001');

-- 1. the enquiry's cost moves to its order when the enquiry is won, in the closed month
insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('01380000-0000-4000-8000-0000000000b1', '01380000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002', '01380000-0000-4000-8000-0000000000a1');
select is((select order_id from public.expenses where id = '01380000-0000-4000-8000-0000000000e1'), '01380000-0000-4000-8000-0000000000b1'::uuid,
  'closed month: the RFQ cost moved to the order on conversion');
select is((select paid_on from public.expenses where id = '01380000-0000-4000-8000-0000000000e1'), '2014-03-10'::date, 'and its paid date did not move');

-- 2. confirming an auto-booked row (a person ticks it against the bank statement) works in the closed month
select is((select auto_booked from public.expenses where id = '01380000-0000-4000-8000-0000000000e2'), true, 'E2 is still unconfirmed');
select lives_ok($$update public.expenses set bank_month = '2014-03-01' where id = '01380000-0000-4000-8000-0000000000e2'$$,
  'closed month: confirming an auto-booked row (bank tick) is allowed');
select is((select auto_booked from public.expenses where id = '01380000-0000-4000-8000-0000000000e2'), false, 'and the row is confirmed');
select is((select amount_pkr from public.expenses where id = '01380000-0000-4000-8000-0000000000e2'), 200::numeric, 'with its amount untouched');

-- 3. every other edit is refused
select throws_ok($$update public.expenses set amount_pkr = 999 where id = '01380000-0000-4000-8000-0000000000e3'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: an ordinary cost''s amount cannot change');
select throws_ok($$update public.expenses set amount_pkr = 1 where id = '01380000-0000-4000-8000-0000000000e4'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: an auto-booked row''s amount cannot change either');
select is((select auto_booked from public.expenses where id = '01380000-0000-4000-8000-0000000000e4'), true, 'and the refused edit did not confirm it');
select throws_ok($$update public.expenses set auto_booked = false, description = 'x' where id = '01380000-0000-4000-8000-0000000000e4'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: confirming together with another change is refused');
select throws_ok($$update public.expenses set paid_on = '2014-05-01' where id = '01380000-0000-4000-8000-0000000000e4'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: moving the paid date out is refused');
select throws_ok($$update public.expenses set order_id = '01380000-0000-4000-8000-0000000000b1' where id = '01380000-0000-4000-8000-0000000000e3'$$, 'P0001',
  'March 2014 is closed. An admin can reopen it.', 'closed month: a cost with no enquiry cannot be given an order');
select throws_ok($$update public.expenses set amount_pkr = 5 where id = '01380000-0000-4000-8000-0000000000e1'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: the moved cost''s amount cannot change');
select throws_ok($$delete from public.expenses where id = '01380000-0000-4000-8000-0000000000e3'$$, 'P0001', 'March 2014 is closed. An admin can reopen it.',
  'closed month: a cost cannot be deleted');

select * from finish();
rollback;
