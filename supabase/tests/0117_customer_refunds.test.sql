-- 0117 customer refunds: the table is admin only and has no API insert, a refund is cash OUT in v_cash_month, v_month_cash_flow,
-- cash_in_hand and the bank tick, and the month lock covers it. Fixture users come from supabase/seed.sql: admin a0..01,
-- sales a0..02, engineer a0..03. Fixtures are written as the table owner. Dates are in 2020 so no other test row shares the month.
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003' else '00000000-0000-0000-0000-000000000000' end $$;
create function pg_temp.u(h text) returns uuid language sql immutable as $$ select ('11700000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''11700000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '') when n = 0 then '<none>' else 'ok:' || n end;
    if keep then reset role; return d; end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then get stacked diagnostics d = pg_exception_detail; return d;
    when others then get stacked diagnostics h = pg_exception_hint, m = message_text; return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end $f$;
create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values (pg_temp.u('01'), '0117 Customer');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, received_on, amount) values (pg_temp.u('40'), pg_temp.u('10'), '2020-02-03', 1500);
insert into public.customer_refunds (id, company_id, refunded_on, amount, reference) values (pg_temp.u('50'), pg_temp.u('01'), '2020-02-10', 100, 'RF-117');

-- ================================================================== who sees and writes it
select is(pg_temp.code_('admin', 'select count(*)::text from public.customer_refunds where company_id = ''11700000-0000-4000-8000-000000000001'''), 'ok:1', 'the admin reads the refund');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('sales', 'select count(*)::text from public.customer_refunds'), 'ok:0', 'sales read no refund');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('engineer', 'select count(*)::text from public.customer_refunds'), 'ok:0', 'an engineer reads none');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('admin', $q$insert into public.customer_refunds (company_id, amount) values (@01, 5) returning 1$q$), 'E:42501:', 'not even the admin inserts through the API: record_refund() is the door');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('admin', $q$update public.customer_refunds set amount = 5 where id = @50 returning 1$q$), 'E:42501:', 'and a refund''s amount cannot be edited');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('admin', $q$update public.customer_refunds set bank_month = '2020-02-01' where id = @50 returning 1$q$), 'ok:1', 'the bank tick is the one thing that changes');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('sales', $q$update public.customer_refunds set bank_month = '2020-02-01' where id = @50 returning 1$q$), '<none>', 'sales tick nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== the cash figures
select is((select refunds_out from public.v_cash_month where month = '2020-02-01'), 100.00::numeric, 'v_cash_month: 100 refunded in February 2020');
select is((select money_out from public.v_cash_month where month = '2020-02-01'), 0.00::numeric, 'and money_out (expenses) is untouched');
select is((select gross_received from public.v_cash_month where month = '2020-02-01'), 1500.00::numeric, 'and so is cash received');
select is((select refunds_out from public.v_month_cash_flow where month = '2020-02-01'), 100.00::numeric, 'In vs out: refunds_out 100');
select is((select refunds_count from public.v_month_cash_flow where month = '2020-02-01'), 1, 'one refund');
select is((select money_out from public.v_month_cash_flow where month = '2020-02-01'), 0.00::numeric, 'In vs out: money_out is the expenses only');
select is((select money_in from public.v_month_cash_flow where month = '2020-02-01'), 1500.00::numeric, 'In vs out: money_in is the payment');
select is(pg_temp.code_('sales', $q$select count(*)::text from public.v_month_cash_flow where month = '2020-02-01'$q$), 'ok:0', 'sales see no In vs out');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- the cash box: a refund paid in cash leaves it like a cash expense
insert into public.cash_counts (id, counted_pkr, is_opening) values (pg_temp.u('60'), 1000, true);
insert into public.customer_refunds (id, company_id, amount, paid_via) values (pg_temp.u('51'), pg_temp.u('01'), 40, 'cash');
insert into public.customer_refunds (id, company_id, amount, paid_via) values (pg_temp.u('52'), pg_temp.u('01'), 7, 'bank');
select is((select expected_pkr from public.cash_in_hand()), 960.00::numeric, 'cash in hand: 1000 counted less the 40 cash refund (a bank refund does not touch the box)');
select is((select cash_out_pkr from public.cash_in_hand()), 40.00::numeric, 'cash out of the box is 40');
select is((select cash_out_count from public.cash_in_hand()), 1, 'one cash item');

-- ================================================================== bank tick and month end
select is((select n from public.month_end_status('2020-02-01') where check_key = 'bank_unticked'), 2, 'month end: the bank payment and the bank refund are both unticked');
update public.customer_refunds set bank_month = '2020-02-01' where id = pg_temp.u('50');
select is((select n from public.month_end_status('2020-02-01') where check_key = 'bank_unticked'), 1, 'ticking the refund takes it off the list');
select is((select (detail ->> 'out_n')::int from public.month_end_check_details('2020-02-01') where check_key = 'bank_unticked'), 0, 'the details list no bank money out left (the refund is ticked)');
update public.customer_refunds set bank_month = null where id = pg_temp.u('50');
select is((select (detail ->> 'out_n')::int from public.month_end_check_details('2020-02-01') where check_key = 'bank_unticked'), 1, 'untick it and it is the one bank item out');
select is(pg_temp.code_('admin', $q$update public.customer_refunds set bank_month = '2020-02-01' where id = @51 returning 1$q$), 'E:23514:', 'a cash refund cannot be ticked against the bank');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('admin', $q$update public.customer_refunds set bank_month = '2020-02-15' where id = @52 returning 1$q$), 'E:23514:', 'a tick is the first of a month');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== the month lock
insert into public.customer_refunds (id, company_id, refunded_on, amount) values (pg_temp.u('53'), pg_temp.u('01'), '2019-03-05', 9);
select ok((select count(*) = 2 from pg_trigger t where not t.tgisinternal and t.tgname in ('customer_refunds_month_lock', 'credit_applications_month_lock')),
  'the lock is on refunds and applied credit');
select ok((select pg_get_functiondef('public.close_month(date)'::regprocedure) like '%customer_refunds%'
           and pg_get_functiondef('public.close_months_through(date)'::regprocedure) like '%customer_refunds%'), 'both close functions lock and count refunds');
select lives_ok($$select public.close_months_through('2019-03-01')$$, 'March 2019 closes');
select is(pg_temp.code_('admin', $q$delete from public.customer_refunds where id = @53 returning 1$q$), 'E:P0001:', 'a refund of a closed month cannot be deleted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(pg_temp.code_('admin', $q$update public.customer_refunds set bank_month = '2019-03-01' where id = @53 returning 1$q$), 'ok:1', 'but it can still be ticked against the bank');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok((select count(*) = 1 from public.customer_refunds where id = pg_temp.u('53')), 'it is still there');
select throws_ok($$insert into public.customer_refunds (company_id, refunded_on, amount) values ('11700000-0000-4000-8000-000000000001', '2019-03-09', 5)$$, 'P0001', null,
  'a refund cannot be added to a closed month');
select throws_ok($$insert into public.credit_applications (company_id, to_order_id, applied_on, amount) values ('11700000-0000-4000-8000-000000000001', '11700000-0000-4000-8000-000000000010', '2019-03-06', 1)$$, 'P0001', null,
  'credit cannot be applied into a closed month either');

select * from finish();
rollback;
