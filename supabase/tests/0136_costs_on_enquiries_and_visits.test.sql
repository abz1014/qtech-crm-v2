-- 0136_costs_on_enquiries_and_visits: a cost (and an engineer's claim) can be tied to an RFQ and to a visit.
--
-- Fixture (company C, admin a0..01, sales a0..02, engineer a0..03):
--   RFQ R1 -> becomes order O1; R2 -> O2; R3 lost (closed); R4 open (later O4); R5 has no cost (deletable).
--   Order OX with visit V1; order OY with visit V2.
--   Costs: E1 (R1, March 2019, 100 less 10 input tax), E2 (R1, April 2019, 200), E3 (no link, March 2019), E4 (R2, March 2019),
--          E5 (visit V2, March 2019), E6 (R3, April 2019, 400), E7 (R4, April 2019, 25). March 2019 is then closed.
begin;
select * from no_plan();

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
select has_column('public', 'expenses', 'rfq_id', 'expenses.rfq_id');
select has_column('public', 'expenses', 'visit_id', 'expenses.visit_id');
select has_column('public', 'expense_claims', 'rfq_id', 'expense_claims.rfq_id');
select has_column('public', 'expense_claims', 'visit_id', 'expense_claims.visit_id');
select has_view('public', 'v_enquiry_costs', 'v_enquiry_costs exists');
select is((select count(*)::int from pg_trigger t where not t.tgisinternal
           and t.tgname in ('expenses_link_prepare', 'expense_claims_link_prepare', 'orders_adopt_rfq_costs', 'rfqs_costs_guard')), 4,
  'the four 0136 triggers exist');
select ok(not has_function_privilege('authenticated', 'public.link_cost_prepare()', 'execute')
      and not has_function_privilege('authenticated', 'public.orders_adopt_rfq_costs()', 'execute')
      and not has_function_privilege('authenticated', 'public.rfqs_costs_guard()', 'execute'), 'the trigger functions have no client grant');
select ok(has_table_privilege('qtech_engineer', 'public.v_enquiry_costs', 'select'), '0081 mirror: qtech_engineer holds select on the view (it has no row for them)');

-- ------------------------------------------------------------------ fixture
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('13600000-0000-4000-8000-0000000000c0', 'Costs Co');
insert into public.rfqs (id, company_id, owner_id) values
  ('13600000-0000-4000-8000-0000000000a1', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002'),
  ('13600000-0000-4000-8000-0000000000a2', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002'),
  ('13600000-0000-4000-8000-0000000000a3', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002'),
  ('13600000-0000-4000-8000-0000000000a4', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002'),
  ('13600000-0000-4000-8000-0000000000a5', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002');
update public.rfqs set closed_on = public.today_pkt(), close_reason = 'competitor' where id = '13600000-0000-4000-8000-0000000000a3';
insert into public.orders (id, company_id, owner_id) values
  ('13600000-0000-4000-8000-0000000000b8', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002'),   -- OX
  ('13600000-0000-4000-8000-0000000000b9', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002');   -- OY
insert into public.order_visits (id, order_id) values
  ('13600000-0000-4000-8000-0000000000d1', '13600000-0000-4000-8000-0000000000b8'),
  ('13600000-0000-4000-8000-0000000000d2', '13600000-0000-4000-8000-0000000000b9');

insert into public.expenses (id, amount_pkr, input_tax_pkr, category_id, paid_on, rfq_id, visit_id) values
  ('13600000-0000-4000-8000-0000000000e1', 100, 10, 'ca7e0000-0000-4000-8000-000000000005', '2019-03-10', '13600000-0000-4000-8000-0000000000a1', null),
  ('13600000-0000-4000-8000-0000000000e2', 200, 0,  'ca7e0000-0000-4000-8000-000000000005', '2019-04-05', '13600000-0000-4000-8000-0000000000a1', null),
  ('13600000-0000-4000-8000-0000000000e3', 50,  0,  'ca7e0000-0000-4000-8000-000000000005', '2019-03-12', null, null),
  ('13600000-0000-4000-8000-0000000000e4', 70,  0,  'ca7e0000-0000-4000-8000-000000000005', '2019-03-14', '13600000-0000-4000-8000-0000000000a2', null),
  ('13600000-0000-4000-8000-0000000000e5', 30,  0,  'ca7e0000-0000-4000-8000-000000000005', '2019-03-15', null, '13600000-0000-4000-8000-0000000000d2'),
  ('13600000-0000-4000-8000-0000000000e6', 400, 0,  'ca7e0000-0000-4000-8000-000000000005', '2019-04-06', '13600000-0000-4000-8000-0000000000a3', null),
  ('13600000-0000-4000-8000-0000000000e7', 25,  0,  'ca7e0000-0000-4000-8000-000000000005', '2019-04-07', '13600000-0000-4000-8000-0000000000a4', null);

-- ------------------------------------------------------------------ links are kept consistent
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e5'), '13600000-0000-4000-8000-0000000000b9'::uuid,
  'a cost on a visit takes the visit''s order');
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e1'), null,
  'a cost on an enquiry with no order has no order');
select is(pg_temp.do_as('admin', $q$insert into public.expenses (amount_pkr, category_id, visit_id, order_id) values (5, 'ca7e0000-0000-4000-8000-000000000005', '13600000-0000-4000-8000-0000000000d1', '13600000-0000-4000-8000-0000000000b9')$q$),
  'E:P0001', 'a visit and an order that do not match are refused');
select is(pg_temp.do_as('admin', $q$insert into public.expenses (amount_pkr, category_id, visit_id) values (5, 'ca7e0000-0000-4000-8000-000000000005', '13600000-0000-4000-8000-0000000000d1')$q$),
  'ok', 'a visit alone is accepted');
select is((select order_id from public.expenses where visit_id = '13600000-0000-4000-8000-0000000000d1'), '13600000-0000-4000-8000-0000000000b8'::uuid,
  'and fills the order from the visit');

-- ------------------------------------------------------------------ what was spent on enquiries (admin only)
select is(pg_temp.as_('admin', $q$select state || '|' || spent_net::text from public.v_enquiry_costs where rfq_id = '13600000-0000-4000-8000-0000000000a1'$q$),
  'open|290.00', 'R1: open, net of input tax (90 + 200)');
select is(pg_temp.as_('admin', $q$select state || '|' || spent_net::text from public.v_enquiry_costs where rfq_id = '13600000-0000-4000-8000-0000000000a3'$q$),
  'lost|400.00', 'R3: lost');
select is(pg_temp.as_('admin', $q$select state || '|' || spent_net::text from public.v_enquiry_costs where rfq_id = '13600000-0000-4000-8000-0000000000a4'$q$),
  'open|25.00', 'R4: open');
select is(pg_temp.as_('engineer', 'select count(*) from public.v_enquiry_costs'), '0', 'an engineer reads no amount in v_enquiry_costs');
select is(pg_temp.as_('sales', 'select count(*) from public.v_enquiry_costs'), '0', 'nor does sales (the money rule is admin only)');

-- ------------------------------------------------------------------ close March 2019, then win R1 and R2
insert into public.closed_months (month, closed_by) values ('2019-03-01', 'a0000000-0000-4000-8000-000000000001');

insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('13600000-0000-4000-8000-0000000000b1', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002', '13600000-0000-4000-8000-0000000000a1');
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e1'), '13600000-0000-4000-8000-0000000000b1'::uuid,
  'winning R1 moves its cost to the order, even though the cost''s month (March 2019) is closed');
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e2'), '13600000-0000-4000-8000-0000000000b1'::uuid,
  'and the open-month cost too');
select is((select actual_cost from public.v_order_money where order_id = '13600000-0000-4000-8000-0000000000b1'), 290::numeric,
  'the order''s actual cost counts both (net of input tax)');
select is(pg_temp.as_('admin', $q$select state from public.v_enquiry_costs where rfq_id = '13600000-0000-4000-8000-0000000000a1'$q$),
  'ordered', 'R1 now shows as ordered');
select is((select paid_on from public.expenses where id = '13600000-0000-4000-8000-0000000000e1'), '2019-03-10'::date, 'the paid date (cash month) did not move');

insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('13600000-0000-4000-8000-0000000000b2', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002', '13600000-0000-4000-8000-0000000000a2');
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e4'), '13600000-0000-4000-8000-0000000000b2'::uuid,
  'R2''s closed-month cost moves to O2');
select is((select order_id from public.expenses where id = '13600000-0000-4000-8000-0000000000e6'), null, 'a lost enquiry''s cost stays on the enquiry (no order)');

-- ------------------------------------------------------------------ every other closed-month edit is still refused
select throws_ok($$update public.expenses set amount_pkr = 999 where id = '13600000-0000-4000-8000-0000000000e1'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'a closed-month cost''s amount cannot change');
select throws_ok($$update public.expenses set description = 'x' where id = '13600000-0000-4000-8000-0000000000e1'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'nor its description');
select throws_ok($$update public.expenses set order_id = null, rfq_id = null where id = '13600000-0000-4000-8000-0000000000e1'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'nor can its order be taken away');
select throws_ok($$update public.expenses set order_id = '13600000-0000-4000-8000-0000000000b1' where id = '13600000-0000-4000-8000-0000000000e3'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'a closed-month cost with no enquiry cannot be given an order');
select throws_ok($$update public.expenses set paid_on = '2019-05-01' where id = '13600000-0000-4000-8000-0000000000e4'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'the paid date of a moved cost cannot change');
select throws_ok($$update public.expenses set rfq_id = '13600000-0000-4000-8000-0000000000a3' where id = '13600000-0000-4000-8000-0000000000e3'$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'a closed-month cost cannot be pointed at an enquiry');
select throws_ok($$update public.expenses set order_id = '13600000-0000-4000-8000-0000000000b1' where id = '13600000-0000-4000-8000-0000000000e4'$$, 'P0001', null,
  'a cost cannot move to the order of a different enquiry');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, paid_on) values (5, 'ca7e0000-0000-4000-8000-000000000005', '2019-03-20')$$, 'P0001', 'March 2019 is closed. An admin can reopen it.',
  'a new cost in a closed month is still refused');
select throws_ok($$insert into public.expenses (amount_pkr, category_id, rfq_id, order_id) values (5, 'ca7e0000-0000-4000-8000-000000000005', '13600000-0000-4000-8000-0000000000a3', '13600000-0000-4000-8000-0000000000b1')$$, 'P0001', null,
  'a cost cannot name an enquiry and the order of another');

-- removing a visit empties the link, also in a closed month
select lives_ok($$delete from public.order_visits where id = '13600000-0000-4000-8000-0000000000d2'$$, 'a visit with a closed-month cost can be removed');
select is((select coalesce(visit_id::text, '-') || '|' || order_id::text from public.expenses where id = '13600000-0000-4000-8000-0000000000e5'),
  '-|13600000-0000-4000-8000-0000000000b9', 'its cost keeps the order and loses the visit');

-- ------------------------------------------------------------------ an enquiry with costs is not deleted
select throws_ok($$delete from public.rfqs where id = '13600000-0000-4000-8000-0000000000a3'$$, 'P0001', 'This RFQ has costs recorded on it. Delete or move the costs first.',
  'an RFQ with a cost cannot be deleted');
select lives_ok($$delete from public.rfqs where id = '13600000-0000-4000-8000-0000000000a5'$$, 'an RFQ without costs can');

-- ------------------------------------------------------------------ claims: a visit, an enquiry, and approve copies both
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note, visit_id) values ('13600000-0000-4000-8000-0000000000f1', '2020-01-01', 60, 'Site taxi', '13600000-0000-4000-8000-0000000000d1')$q$),
  'ok', 'an engineer claims against a visit');
select is((select order_id::text from public.expense_claims where id = '13600000-0000-4000-8000-0000000000f1'), '13600000-0000-4000-8000-0000000000b8',
  'the claim takes the visit''s order');
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note, rfq_id) values ('13600000-0000-4000-8000-0000000000f2', '2020-01-01', 45, 'Samples', '13600000-0000-4000-8000-0000000000a4')$q$),
  'ok', 'an engineer claims against an enquiry');
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note, rfq_id) values ('13600000-0000-4000-8000-0000000000f3', '2020-01-01', 15, 'Parking', '13600000-0000-4000-8000-0000000000a4')$q$),
  'ok', 'and a second one, left pending');
select is(pg_temp.as_('engineer', 'select count(*) from public.expense_claims'), '3', 'the engineer reads their own claims');

select isnt(pg_temp.as_('admin', $q$select public.approve_expense_claim('13600000-0000-4000-8000-0000000000f1', 'ca7e0000-0000-4000-8000-000000000005', 'bank')::text$q$), 'E:P0001', 'the admin approves the visit claim');
select is((select coalesce(e.visit_id::text, '-') || '|' || coalesce(e.order_id::text, '-') || '|' || coalesce(e.rfq_id::text, '-')
           from public.expense_claims c join public.expenses e on e.id = c.expense_id where c.id = '13600000-0000-4000-8000-0000000000f1'),
  '13600000-0000-4000-8000-0000000000d1|13600000-0000-4000-8000-0000000000b8|-', 'the approved expense has the claim''s visit and order');
select isnt(pg_temp.as_('admin', $q$select public.approve_expense_claim('13600000-0000-4000-8000-0000000000f2', 'ca7e0000-0000-4000-8000-000000000005', 'bank')::text$q$), 'E:P0001', 'the admin approves the enquiry claim');
select is((select coalesce(e.rfq_id::text, '-') || '|' || coalesce(e.order_id::text, '-')
           from public.expense_claims c join public.expenses e on e.id = c.expense_id where c.id = '13600000-0000-4000-8000-0000000000f2'),
  '13600000-0000-4000-8000-0000000000a4|-', 'the approved expense has the claim''s enquiry and no order yet');

-- R4 is won: its approved cost and its pending claim both get the order
insert into public.orders (id, company_id, owner_id, rfq_id) values
  ('13600000-0000-4000-8000-0000000000b4', '13600000-0000-4000-8000-0000000000c0', 'a0000000-0000-4000-8000-000000000002', '13600000-0000-4000-8000-0000000000a4');
select is((select count(*)::int from public.expenses where rfq_id = '13600000-0000-4000-8000-0000000000a4' and order_id = '13600000-0000-4000-8000-0000000000b4'), 2,
  'winning R4 gives its two costs (typed one and approved claim) the order');
select is((select order_id::text from public.expense_claims where id = '13600000-0000-4000-8000-0000000000f3'), '13600000-0000-4000-8000-0000000000b4',
  'and its pending claim');
select is((select actual_cost from public.v_order_money where order_id = '13600000-0000-4000-8000-0000000000b4'), 70::numeric, 'O4 counts 25 + 45 (the pending claim is not a cost yet)');

select * from finish();
rollback;
