-- 0087_expense_gaps: engineers' "I paid" claims (pending claims are in no total; approve writes the expense), cash in hand
-- (opening, cash drawn from the bank, cash expenses, counts and their difference), supplier payments in the supplier's currency
-- (We owe suppliers settles a foreign leg in its own currency), and the for-month of monthly bills.
--
-- Fixture (December 2016, a month no other fixture uses, then today for the cash box):
--   C1  engineer's claim, 3 Dec 2016, 1,500.00 "Petrol to site"   -> approved as Fuel & travel, from petty cash (dated 3 Dec, cash)
--   C2  engineer's claim, 4 Dec 2016,   700.00 "Tea"               -> rejected
--   L1  a USD supplier order: 10 x 100 = USD 1,000 committed, rate 280 -> PKR 280,000
begin;
select * from no_plan();

-- ------------------------------------------------------------------ helpers: act as a persona the way the API does (0081)
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

-- Runs stmt as the persona and KEEPS its effect (no rollback); returns 'ok' or 'E:<sqlstate>'.
create function pg_temp.do_as(persona text, stmt text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    when 'engineer' then 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform qtech_private.pre_request();
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return 'E:' || sqlstate;
  end;
  execute 'reset role';
  return 'ok';
end
$f$;

-- ------------------------------------------------------------------ structure
select has_table('public', 'expense_claims', 'expense_claims exists');
select has_table('public', 'cash_topups', 'cash_topups exists');
select has_table('public', 'cash_counts', 'cash_counts exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.expense_claims'::regclass, 'public.cash_topups'::regclass, 'public.cash_counts'::regclass)),
  'row security is on for the three new tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('expense_claims', 'cash_topups', 'cash_counts')
           and not ('qtech_engineer' = any (roles))), 0, 'every new policy applies to qtech_engineer too (0081)');
select ok(not (select prosecdef from pg_proc where oid = 'public.approve_expense_claim(uuid, uuid, text, date)'::regprocedure)
      and not has_function_privilege('anon', 'public.approve_expense_claim(uuid, uuid, text, date)', 'execute'),
  'approve_expense_claim: SECURITY INVOKER, no anon grant');
select ok(not has_function_privilege('authenticated', 'public.expense_claims_guard()', 'execute')
      and not has_function_privilege('authenticated', 'public.cash_counts_prepare()', 'execute'),
  'the trigger functions have no client grant');
select is((select public from storage.buckets where id = 'claim-receipts'), false, 'claim-receipts is a private bucket');

-- ------------------------------------------------------------------ claims: the engineer adds, cannot decide, sees own only
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note, status, expense_id)
  values ('87000000-0000-4000-8000-0000000000c1', '2016-12-03', 1500, 'Petrol to site', 'approved', null)$q$), 'ok',
  'an engineer records "I paid" (as qtech_engineer, through the API role)');
select is((select status || '|' || coalesce(created_by::text, '-') from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1'),
  'pending|a0000000-0000-4000-8000-000000000003', 'a new claim is always pending and the engineer''s own, whatever the insert says');
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note)
  values ('87000000-0000-4000-8000-0000000000c2', '2016-12-04', 700, 'Tea')$q$), 'ok', 'a second claim');
select is(pg_temp.as_('engineer', $q$update public.expense_claims set amount_pkr = 9 where id = '87000000-0000-4000-8000-0000000000c1' returning 1$q$),
  '<none>', 'an engineer cannot change a claim (the admin decides)');
select is(pg_temp.as_('engineer', $q$select public.approve_expense_claim('87000000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004', 'cash_back')::text$q$),
  'E:42501', 'an engineer cannot approve');
select is(pg_temp.as_('sales', 'select count(*) from public.expense_claims'), '0', 'sales see no claim');
select is(pg_temp.as_('sales', $q$insert into public.expense_claims (amount_pkr) values (5)$q$), 'E:42501', 'sales cannot make a claim');
select is(pg_temp.as_('admin', $q$insert into public.expense_claims (amount_pkr) values (5)$q$), 'E:42501',
  'the admin records an expense directly, not a claim');
select is(pg_temp.as_('engineer', 'select count(*) from public.expenses'), '0', 'the engineer still reads no expense');

-- A pending claim is in no total: December 2016's books are empty.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.expenses where paid_on between '2016-12-01' and '2016-12-31'), 0, 'pending claims are not expenses');
select is(coalesce((select money_out from public.v_month_cash_flow where month = '2016-12-01'), 0), 0::numeric, 'In vs out has no December 2016 money out');

-- ------------------------------------------------------------------ approve and reject (admin)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($q$select public.approve_expense_claim('87000000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000011', 'bank')$q$,
  '22023', null, 'a claim is never approved as a supplier payment (one door: Pay)');
select throws_ok($q$select public.approve_expense_claim('87000000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004', 'card')$q$,
  '22023', null, 'paid-via must be cash given back, petty cash or bank');
select lives_ok($q$select public.approve_expense_claim('87000000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004', 'petty_cash')$q$,
  'the admin approves C1 as Fuel & travel, from petty cash');
select results_eq(
  $$select e.amount_pkr, e.category_id::text, e.paid_on, e.paid_via, c.status, c.paid_how, c.decided_by::text
    from public.expense_claims c join public.expenses e on e.id = c.expense_id
    where c.id = '87000000-0000-4000-8000-0000000000c1'$$,
  $$values (1500.00::numeric(14,2), 'ca7e0000-0000-4000-8000-000000000004', '2016-12-03'::date, 'cash', 'approved', 'petty_cash', 'a0000000-0000-4000-8000-000000000001')$$,
  'approving writes one cash expense on the day spent (petty cash), linked to the claim, decided by the admin');
select ok((select description from public.expenses e join public.expense_claims c on c.expense_id = e.id where c.id = '87000000-0000-4000-8000-0000000000c1')
          like 'Petrol to site · %', 'the expense''s detail is the engineer''s note and name');
select is((select money_out from public.v_month_cash_flow where month = '2016-12-01'), 1500.00::numeric, 'once approved it counts: In vs out money out');
select is((select cash_out_total from public.v_month_pnl where month = '2016-12-01'), 1500.00::numeric, 'and the P&L cash out');
select throws_ok($q$select public.approve_expense_claim('87000000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004', 'bank')$q$,
  'P0001', null, 'a claim is approved once');
select lives_ok($q$update public.expense_claims set status = 'rejected', reject_reason = 'No receipt' where id = '87000000-0000-4000-8000-0000000000c2'$q$,
  'the admin rejects C2 with a reason');
select is((select status || '|' || reject_reason || '|' || (decided_by is not null)::text from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c2'),
  'rejected|No receipt|true', 'a rejection is stamped');
select throws_ok($q$update public.expense_claims set status = 'approved' where id = '87000000-0000-4000-8000-0000000000c2'$q$,
  '23514', null, 'approved needs an expense (only approve_expense_claim makes one)');
select is(pg_temp.as_('engineer', $q$select status from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1'$q$), 'approved',
  'the engineer sees that their claim was approved');
select is(pg_temp.as_('engineer', $q$delete from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1' returning 1$q$), '<none>',
  'an engineer cannot withdraw an approved claim');
-- deleting the expense puts the claim back to pending
delete from public.expenses where id = (select expense_id from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1');
select is((select status || '|' || (expense_id is null)::text || '|' || (paid_how is null)::text from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1'),
  'pending|true|true', 'deleting the approved expense puts the claim back to pending');
select is(pg_temp.as_('engineer', $q$delete from public.expense_claims where id = '87000000-0000-4000-8000-0000000000c1' returning 1$q$), '1',
  'an engineer withdraws their own pending claim');

-- claim photos: the admin and the claim's engineer
select ok(pg_temp.as_('engineer', $q$select public.claim_object_ok('87000000-0000-4000-8000-0000000000c1/a.jpg', true)::text$q$) = 'true',
  'the engineer may add a photo to their own pending claim');
select ok(pg_temp.as_('engineer', $q$select public.claim_object_ok('87000000-0000-4000-8000-0000000000c2/a.jpg', true)::text$q$) = 'false',
  'but not to a decided one');
select ok(pg_temp.as_('engineer', $q$select public.claim_object_ok('87000000-0000-4000-8000-0000000000c2/a.jpg', false)::text$q$) = 'true',
  'and still reads its photo');
select ok(pg_temp.as_('sales', $q$select public.claim_object_ok('87000000-0000-4000-8000-0000000000c2/a.jpg', false)::text$q$) = 'false',
  'sales read no claim photo');

-- ------------------------------------------------------------------ cash in hand
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select base_kind from public.cash_in_hand()), 'none', 'with no opening balance, cash in hand is not set up');
insert into public.cash_counts (counted_pkr, note) values (10000, 'opening');
select is((select is_opening::text || '|' || coalesce(expected_pkr::text, '-') from public.cash_counts order by created_at limit 1), 'true|-',
  'the first count is the opening balance');
insert into public.cash_topups (amount_pkr, note) values (5000, 'drawn from the bank');
insert into public.expenses (amount_pkr, category_id, paid_via, description) values
  (1200, 'ca7e0000-0000-4000-8000-000000000005', 'cash', '0087 cash'),
  (9999, 'ca7e0000-0000-4000-8000-000000000008', 'bank', '0087 bank');
select results_eq($$select base_kind, base_pkr, topups_pkr, cash_out_pkr, expected_pkr from public.cash_in_hand()$$,
  $$values ('opening', 10000.00::numeric, 5000.00::numeric, 1200.00::numeric, 13800.00::numeric)$$,
  'expected cash = opening 10,000 + drawn 5,000 - cash spent 1,200 (a bank expense is not cash)');
select is((select money_out from public.v_month_cash_flow where month = date_trunc('month', public.today_pkt())::date)
          - (select coalesce(sum(amount_pkr), 0) from public.expenses where date_trunc('month', paid_on) = date_trunc('month', public.today_pkt())), 0::numeric,
  'cash drawn from the bank is not money out (it moves between our own boxes)');
-- a count stores what was expected and the difference, whatever the client sends
insert into public.cash_counts (counted_pkr, expected_pkr, counted_on) values (13500, 1, '2016-01-01');
select results_eq($$select counted_on, expected_pkr, difference_pkr, is_opening from public.cash_counts order by created_at desc, counted_on desc limit 1$$,
  $$values (public.today_pkt(), 13800.00::numeric(14,2), -300.00::numeric(14,2), false)$$,
  'a count is dated today, keeps the books'' 13,800 and the difference -300');
select is((select last_difference_pkr from public.cash_in_hand()), -300.00::numeric, 'cash in hand shows the last difference');
-- after the count, only what comes later counts
select is((select expected_pkr from public.cash_in_hand()), 13500.00::numeric, 'after a count, expected starts from the counted 13,500');
select is(pg_temp.as_('engineer', 'select count(*) from public.cash_in_hand()'), '0', 'cash in hand is admin only');
select is(pg_temp.as_('sales', 'select count(*) from public.cash_topups'), '0', 'cash drawn is admin only');
select is(pg_temp.as_('admin', $q$update public.cash_counts set counted_pkr = 1 returning 1$q$), 'E:42501', 'a count is never edited');

-- ------------------------------------------------------------------ supplier payments in the supplier's currency
select throws_ok($q$insert into public.expenses (amount_pkr, category_id, paid_via, fx_currency, fx_amount) values (1, 'ca7e0000-0000-4000-8000-000000000010', 'bank', 'PKR', 1)$q$,
  '23514', null, 'a PKR payment carries no fx amount');
select throws_ok($q$insert into public.expenses (amount_pkr, category_id, paid_via, fx_currency) values (1, 'ca7e0000-0000-4000-8000-000000000010', 'bank', 'USD')$q$,
  '23514', null, 'a currency needs its amount');
insert into public.companies (id, name) values
  ('87000000-0000-4000-8000-0000000000a1', '0087 Customer'), ('87000000-0000-4000-8000-0000000000a2', '0087 Supplier GmbH');
insert into public.orders (id, company_id, owner_id, created_at) values
  ('87000000-0000-4000-8000-0000000000b1', '87000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on) values
  ('87000000-0000-4000-8000-0000000000d1', '87000000-0000-4000-8000-0000000000b1', '87000000-0000-4000-8000-0000000000a2', 'USD', public.today_pkt());
insert into public.order_items (id, order_id, position, description, qty, unit_price_net, supplier_order_id, supplier_unit_price) values
  ('87000000-0000-4000-8000-0000000000e1', '87000000-0000-4000-8000-0000000000b1', 0, '0087 valve', 10, 50000, '87000000-0000-4000-8000-0000000000d1', 100);
insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('USD', 280, public.today_pkt() - 1, 'manual')
  on conflict do nothing;
select results_eq($$select currency, committed, owed_pkr, state from public.payables_as_of(public.today_pkt()) where supplier_order_id = '87000000-0000-4000-8000-0000000000d1'$$,
  $$values ('USD', 1000::numeric, (select round(1000 * r.rate_pkr, 2) from public.fx_rates r where r.currency = 'USD' and r.as_of <= public.today_pkt() order by r.as_of desc, (r.source = 'manual') desc limit 1), 'owing')$$,
  'a placed USD leg owes its USD 1,000 at the rate');
-- USD 600 paid, PKR 170,000 debited (a rate of 283.33, not the book rate)
insert into public.expenses (amount_pkr, category_id, paid_via, order_id, supplier_order_id, payee_id, fx_currency, fx_amount) values
  (170000, 'ca7e0000-0000-4000-8000-000000000011', 'bank', '87000000-0000-4000-8000-0000000000b1', '87000000-0000-4000-8000-0000000000d1', '87000000-0000-4000-8000-0000000000a2', 'USD', 600);
select results_eq($$select paid_pkr, owed_pkr, state from public.payables_as_of(public.today_pkt()) where supplier_order_id = '87000000-0000-4000-8000-0000000000d1'$$,
  $$values (170000::numeric, (select round(400 * r.rate_pkr, 2) from public.fx_rates r where r.currency = 'USD' and r.as_of <= public.today_pkt() order by r.as_of desc, (r.source = 'manual') desc limit 1), 'owing')$$,
  'paid USD 600: what is owed is the other USD 400 at the rate, whatever PKR the 600 cost');
insert into public.expenses (amount_pkr, category_id, paid_via, order_id, supplier_order_id, payee_id, fx_currency, fx_amount) values
  (118000, 'ca7e0000-0000-4000-8000-000000000011', 'bank', '87000000-0000-4000-8000-0000000000b1', '87000000-0000-4000-8000-0000000000d1', '87000000-0000-4000-8000-0000000000a2', 'USD', 400);
select results_eq($$select owed_pkr, state, flag from public.payables_as_of(public.today_pkt()) where supplier_order_id = '87000000-0000-4000-8000-0000000000d1'$$,
  $$values (0::numeric, 'settled', null::text)$$,
  'paid USD 1,000 in all: settled at any rate');
select is(pg_temp.as_('engineer', 'select count(*) from public.payables_as_of(public.today_pkt())'), '0', 'We owe suppliers stays admin only');

select * from finish();
rollback;
