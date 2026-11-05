-- 0137 order profit: v_order_profit gives, per order, the invoiced-basis margin (as v_order_money) and the cash view: received
-- (settled less refunds and credit moved out, GST included), paid out (gross expenses) and cash profit. Admin only.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Fixtures are written as the table owner.
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003' else '00000000-0000-0000-0000-000000000000' end $$;
create function pg_temp.u(h text) returns uuid language sql immutable as $$ select ('13700000-0000-4000-8000-0000000000' || h)::uuid $$;
create function pg_temp.adm() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true) $$;

create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''13700000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '') when n = 0 then '<none>' else 'ok:' || n end;
    if keep then reset role; perform pg_temp.adm(); return d; end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then get stacked diagnostics d = pg_exception_detail; perform pg_temp.adm(); return d;
    when others then get stacked diagnostics h = pg_exception_hint, m = message_text; perform pg_temp.adm(); return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end $f$;
create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;

select pg_temp.adm();

-- Customer 01: order 10 (one line 1000 at 18%, invoiced 1000 + 180 GST = 1180, paid 1500, so overpaid 320; an expense of 300 with 30
-- input tax), order 11 (one exempt line 500, invoiced, unpaid, takes 50 of credit), order 12 (one line 70, not invoiced, an expense of 40).
insert into public.companies (id, name) values (pg_temp.u('01'), '0137 Customer');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('11'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('12'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, gst_rate, created_by) values
  (pg_temp.u('21'), pg_temp.u('10'), 0, 'Line 10', 1000, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('22'), pg_temp.u('11'), 0, 'Line 11', 500, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('23'), pg_temp.u('12'), 0, 'Line 12', 70, 0, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('30'), pg_temp.u('10'), 'T137-1', public.today_pkt(), 1000, 180, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('31'), pg_temp.u('11'), 'T137-2', public.today_pkt(), 500, 0, 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, received_on, amount) values (pg_temp.u('40'), pg_temp.u('10'), public.today_pkt(), 1500);
insert into public.expenses (id, order_id, amount_pkr, input_tax_pkr, category_id, paid_on) values
  (pg_temp.u('50'), pg_temp.u('10'), 300, 30, 'ca7e0000-0000-4000-8000-000000000011', public.today_pkt()),
  (pg_temp.u('51'), pg_temp.u('12'), 40, 0, 'ca7e0000-0000-4000-8000-000000000011', public.today_pkt());

-- ================================================================== before any refund or credit
select is((select net_sale from public.v_order_profit where order_id = pg_temp.u('10')), 1000.00::numeric, 'invoiced net sale, GST left out');
select is((select actual_cost from public.v_order_profit where order_id = pg_temp.u('10')), 270.00::numeric, 'the cost the margin uses is net of input tax');
select is((select margin from public.v_order_profit where order_id = pg_temp.u('10')), 730.00::numeric, 'the invoiced margin is net sale less net cost');
select is((select margin_state from public.v_order_profit where order_id = pg_temp.u('10')), 'provisional', 'and it is provisional until costs are complete');
select is((select received from public.v_order_profit where order_id = pg_temp.u('10')), 1500.00::numeric, 'received is the cash that came in, GST inside');
select is((select paid_out from public.v_order_profit where order_id = pg_temp.u('10')), 300.00::numeric, 'paid out is the gross amount, input tax included');
select is((select cash_profit from public.v_order_profit where order_id = pg_temp.u('10')), 1200.00::numeric, 'cash profit is received less paid out (the GST owed to FBR is not taken off)');
select is((select received from public.v_order_profit where order_id = pg_temp.u('11')), 0.00::numeric, 'an unpaid order has received nothing');
select is((select paid_out from public.v_order_profit where order_id = pg_temp.u('11')), 0.00::numeric, 'and paid out nothing (0, not null)');

-- ================================================================== an order not invoiced yet
select is((select basis from public.v_order_profit where order_id = pg_temp.u('12')), 'items', 'an order with no invoice uses the items');
select is((select net_sale from public.v_order_profit where order_id = pg_temp.u('12')), 70.00::numeric, 'net sale from the items');
select is((select cash_profit from public.v_order_profit where order_id = pg_temp.u('12')), -40.00::numeric, 'nothing received, 40 paid out: minus 40');

-- ================================================================== a refund and credit moved out
select is(pg_temp.code_('admin', $q$select public.record_refund(@60, @01, public.today_pkt(), 100, @10)::text$q$, true), 'ok:', 'a refund of 100 out of order 10 is recorded');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@61, @11, 50, null, null, @10)::text$q$, true), 'ok:', '50 of order 10''s credit is put against order 11');
select is((select received from public.v_order_profit where order_id = pg_temp.u('10')), 1350.00::numeric, 'received is settled less the refund and the credit moved out: 1500 - 100 - 50');
select is((select cash_profit from public.v_order_profit where order_id = pg_temp.u('10')), 1050.00::numeric, 'cash profit follows: 1350 - 300');
select is((select margin from public.v_order_profit where order_id = pg_temp.u('10')), 730.00::numeric, 'the invoiced margin does not move');
select is((select received from public.v_order_profit where order_id = pg_temp.u('11')), 50.00::numeric, 'the order that took the credit counts it as settled money');
select is((select settled from public.v_order_money where order_id = pg_temp.u('10')), 1500.00::numeric, 'v_order_money is unchanged: settled is still 1500');

-- ================================================================== one row per order, admin only
select is((select count(*)::int from public.v_order_profit where order_id in (pg_temp.u('10'), pg_temp.u('11'), pg_temp.u('12'))), 3, 'one row per order');
select is(pg_temp.code_('sales', 'select count(*)::text from public.v_order_profit'), 'ok:0', 'sales see no row');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.v_order_profit'), 'ok:0', 'an engineer sees no row');
select isnt(pg_temp.code_('admin', 'select count(*)::text from public.v_order_profit'), 'ok:0', 'the admin sees rows');
select ok((select coalesce(c.reloptions, '{}') @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_order_profit'::regclass), 'security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid = 'public.v_order_profit'::regclass and a.grantee in (0, 'anon'::regrole::oid)), 'anon and PUBLIC have no privilege');

select * from finish();
rollback;
