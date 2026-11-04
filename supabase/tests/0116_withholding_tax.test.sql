-- 0116 withholding tax: a customer's WHT deduction settles the invoice with the cash, is not cash in, and is listed as a tax credit
-- with a missing-certificate flag. Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003' else '00000000-0000-0000-0000-000000000000' end $$;
create function pg_temp.u(h text) returns uuid language sql immutable as $$ select ('11600000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''11600000-0000-4000-8000-0000000000\1''::uuid', 'g');
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

insert into public.companies (id, name) values (pg_temp.u('01'), '0116 Customer');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, gst_rate, created_by) values
  (pg_temp.u('20'), pg_temp.u('10'), 0, 'Line', 1000, 18, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('30'), pg_temp.u('10'), 'T116-1', public.today_pkt(), 1000, 180, 'a0000000-0000-4000-8000-000000000001');

select is((select balance from public.order_receivables(pg_temp.u('10'))), 1180.00::numeric, 'before the payment the order owes 1180');
select is(pg_temp.code_('admin', $q$select public.record_payment(@40, @10, public.today_pkt(), 1100, 'REF-W', 'bank', false, -1, null)::text$q$), 'E:22023:wht',
  'a negative WHT is refused');
select is(pg_temp.code_('admin', $q$select public.record_payment(@40, @10, public.today_pkt(), 1100, 'REF-W', 'bank', false, 80, null)::text$q$, true), 'ok:',
  'a payment of 1100 cash with 80 WHT deducted is recorded');
select is((select balance from public.order_receivables(pg_temp.u('10'))), 0.00::numeric, 'cash and WHT together settle the order: nothing is owing');
select is((select payment_state from public.order_receivables(pg_temp.u('10'))), 'settled', 'and it reads settled');
select is((select settled from public.v_order_money where order_id = pg_temp.u('10')), 1180.00::numeric, 'the order money view settles with amount + WHT');
select is((select count(*)::int from public.aging_as_of(public.today_pkt()) where order_id = pg_temp.u('10')), 0, 'aging lists nothing for it');
select is((select amount from public.v_payment_net where payment_id = pg_temp.u('40')), 1100.00::numeric, 'the cash view of the payment is the cash only (WHT is not money in)');
select is((select gross_received from public.v_cash_month where month = date_trunc('month', public.today_pkt())::date), 1100.00::numeric,
  'In vs out: cash received is 1100, not 1180');
select is((select count(*)::int from public.v_wht_deducted where payment_id = pg_temp.u('40') and wht_amount = 80 and certificate_missing), 1,
  'the WHT list shows it, flagged: no certificate yet');
update public.payments_in set wht_certificate_no = 'CPR-123' where id = pg_temp.u('40');
select is((select certificate_missing from public.v_wht_deducted where payment_id = pg_temp.u('40')), false, 'with a certificate number the flag clears');
select is(pg_temp.try_('sales', 'select count(*)::text from public.v_wht_deducted'), 'ok:0', 'sales see no WHT list');
select is(pg_temp.try_('engineer', 'select count(*)::text from public.v_wht_deducted'), 'ok:0', 'an engineer sees none');

select * from finish();
rollback;
