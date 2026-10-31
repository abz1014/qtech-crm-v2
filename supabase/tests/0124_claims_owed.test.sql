-- 0124_claims_owed (process audit 5): a claim can be approved as OWED to the person and paid back later; sales may claim too.
--
-- Fixture: the engineer's claim C1 (700, "Petrol") and the salesperson's claim C2 (300, "Lunch with a customer").
--   C1 is approved as owed (Fuel & travel): no expense, no cash effect. Marked paid back by bank on 2 Jan 2020: the expense is written then.
--   C2 stays pending: a salesperson reads their own claim only, and cannot decide it.
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

-- structure
select has_column('public', 'expense_claims', 'category_id', 'the owed claim remembers its category');
select ok(not has_function_privilege('anon', 'public.owe_expense_claim(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.pay_back_expense_claim(uuid, text, date)', 'execute'), 'no anon grant');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'expense_claims' and not ('qtech_engineer' = any (roles))), 0,
  'every claim policy applies to qtech_engineer too (0081)');

-- both people make a claim
select is(pg_temp.do_as('engineer', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note) values ('12400000-0000-4000-8000-0000000000c1', '2020-01-01', 700, 'Petrol')$q$), 'ok', 'an engineer claims');
select is(pg_temp.do_as('sales', $q$insert into public.expense_claims (id, spent_on, amount_pkr, note) values ('12400000-0000-4000-8000-0000000000c2', '2020-01-01', 300, 'Lunch with a customer')$q$), 'ok', '0124: a salesperson claims too');
select is((select status || '|' || created_by::text from public.expense_claims where id = '12400000-0000-4000-8000-0000000000c2'),
  'pending|a0000000-0000-4000-8000-000000000002', 'a salesperson''s claim is pending and their own, whatever the insert says');

-- who reads what
select is(pg_temp.as_('sales', 'select count(*) from public.expense_claims'), '1', 'a salesperson reads their own claim only');
select is(pg_temp.as_('engineer', 'select count(*) from public.expense_claims'), '1', 'an engineer reads their own claim only');
select ok(pg_temp.as_('sales', $q$select public.claim_object_ok('12400000-0000-4000-8000-0000000000c2/a.jpg', true)::text$q$) = 'true', 'a salesperson adds photos to their pending claim');
select ok(pg_temp.as_('sales', $q$select public.claim_object_ok('12400000-0000-4000-8000-0000000000c1/a.jpg', false)::text$q$) = 'false', 'but reads no one else''s');

-- only the admin decides
select is(pg_temp.as_('sales', $q$select public.owe_expense_claim('12400000-0000-4000-8000-0000000000c2', 'ca7e0000-0000-4000-8000-000000000004')::text$q$), 'E:42501', 'sales cannot approve');
select is(pg_temp.as_('engineer', $q$select public.pay_back_expense_claim('12400000-0000-4000-8000-0000000000c1', 'bank')::text$q$), 'E:42501', 'an engineer cannot pay back');

-- approve as owed
select is(pg_temp.do_as('admin', $q$select public.owe_expense_claim('12400000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004')$q$), 'ok', 'the admin approves it as owed');
select is((select status || '|' || coalesce(expense_id::text, '-') || '|' || category_id::text from public.expense_claims where id = '12400000-0000-4000-8000-0000000000c1'),
  'owed|-|ca7e0000-0000-4000-8000-000000000004', 'owed: no expense yet, the category is kept');
select is((select count(*)::int from public.expenses where description like 'Petrol%'), 0, 'an owed claim is in no cost');
select is(pg_temp.as_('admin', $q$select public.owe_expense_claim('12400000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-000000000004')::text$q$), 'E:P0001', 'it cannot be approved twice');
select is(pg_temp.as_('engineer', 'select status from public.expense_claims'), 'owed', 'the engineer sees it as owed to them');

-- pay back
select is(pg_temp.as_('admin', $q$select public.pay_back_expense_claim('12400000-0000-4000-8000-0000000000c2', 'bank')::text$q$), 'E:P0001', 'a pending claim is not "owed": it cannot be paid back');
select is(pg_temp.as_('admin', $q$select public.pay_back_expense_claim('12400000-0000-4000-8000-0000000000c1', 'cheque')::text$q$), 'E:22023', 'how it was paid must be one of the known ways');
select is(pg_temp.do_as('admin', $q$select public.pay_back_expense_claim('12400000-0000-4000-8000-0000000000c1', 'bank', '2020-01-02')$q$), 'ok', 'marked paid back by bank on 2 Jan 2020');
select is((select status || '|' || paid_how from public.expense_claims where id = '12400000-0000-4000-8000-0000000000c1'), 'approved|bank', 'the claim is approved and remembers how it was paid');
select is((select amount_pkr::text || '|' || paid_on::text || '|' || paid_via || '|' || category_id::text from public.expenses
           where id = (select expense_id from public.expense_claims where id = '12400000-0000-4000-8000-0000000000c1')),
  '700.00|2020-01-02|bank|ca7e0000-0000-4000-8000-000000000004', 'the expense is written when it is paid back: that day, by bank, in the chosen category');
select is(pg_temp.as_('admin', $q$select public.pay_back_expense_claim('12400000-0000-4000-8000-0000000000c1', 'bank')::text$q$), 'E:P0001', 'it cannot be paid back twice');

select * from finish();
rollback;
