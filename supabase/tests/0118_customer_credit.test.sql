-- 0118 customer credit: the balance (overpayments incl. credit notes, less refunds, less credit applied), record_refund and
-- apply_credit, applied credit as settled money everywhere (order_receivables, v_order_money, aging_as_of), and the money oracle:
-- receivables = order money = basis = aging, cash month matches, with refunds and applied credit in play.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03. Fixtures are written as the table owner.
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003' else '00000000-0000-0000-0000-000000000000' end $$;
create function pg_temp.u(h text) returns uuid language sql immutable as $$ select ('11800000-0000-4000-8000-0000000000' || h)::uuid $$;
create function pg_temp.adm() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true) $$;

create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''11800000-0000-4000-8000-0000000000\1''::uuid', 'g');
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

-- Customer 01: order 10 (one line 1000 at 18%: gross 1180, invoiced, paid 1500: overpaid 320), order 11 (one exempt line 500,
-- invoiced, unpaid), order 13 (one exempt line 50, invoiced, unpaid), order 14 (a line, no invoice). Customer 02: order 20.
insert into public.companies (id, name) values (pg_temp.u('01'), '0118 Customer'), (pg_temp.u('02'), '0118 Other customer');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('11'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('13'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('14'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('20'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, gst_rate, created_by) values
  (pg_temp.u('21'), pg_temp.u('10'), 0, 'Line 10', 1000, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('22'), pg_temp.u('11'), 0, 'Line 11', 500, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('23'), pg_temp.u('13'), 0, 'Line 13', 50, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('24'), pg_temp.u('14'), 0, 'Line 14', 70, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('25'), pg_temp.u('20'), 0, 'Line 20', 900, 0, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('30'), pg_temp.u('10'), 'T118-1', public.today_pkt(), 1000, 180, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('31'), pg_temp.u('11'), 'T118-2', public.today_pkt(), 500, 0, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('33'), pg_temp.u('13'), 'T118-3', public.today_pkt(), 50, 0, 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, received_on, amount) values (pg_temp.u('40'), pg_temp.u('10'), public.today_pkt(), 1500);

-- ================================================================== the balance
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 320.00::numeric, 'the customer holds 320: 1500 paid on a 1180 order');
select is((select overpaid from public.v_company_credit where company_id = pg_temp.u('01')), 320.00::numeric, 'overpaid 320');
select is((select count(*)::int from public.v_company_credit where company_id = pg_temp.u('02')), 0, 'a customer with no credit has no row');
select is(pg_temp.code_('sales', 'select count(*)::text from public.v_company_credit'), 'ok:0', 'sales see no credit balance');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.v_company_credit'), 'ok:0', 'an engineer sees none');

-- ================================================================== record_refund
select is(pg_temp.code_('sales', $q$select public.record_refund(@50, @01, null, public.today_pkt(), 10)::text$q$), 'E:42501:admin_only', 'a refund is the admin''s');
select is(pg_temp.code_('engineer', $q$select public.record_refund(@50, @01, null, public.today_pkt(), 10)::text$q$), 'E:42501:admin_only', 'not an engineer''s');
select is(pg_temp.code_('admin', $q$select public.record_refund(@50, @01, null, public.today_pkt(), 0)::text$q$), 'E:22023:amount', 'a refund of nothing is refused');
select is(pg_temp.code_('admin', $q$select public.record_refund(@50, @01, null, public.today_pkt(), 400)::text$q$), 'E:P0001:refund_exceeds_credit', 'a refund above the credit is refused');
select alike(pg_temp.try_('admin', $q$select public.record_refund(@50, @01, null, public.today_pkt(), 400)::text$q$), '%holds Rs 320.00 of credit%', 'with the balance in the sentence');
select is(pg_temp.code_('admin', $q$select public.record_refund(@50, @02, null, public.today_pkt(), 1)::text$q$), 'E:P0001:refund_exceeds_credit', 'a customer with no credit is refused too');
select is(pg_temp.code_('admin', $q$select public.record_refund(@50, @01, @20, public.today_pkt(), 10)::text$q$), 'E:P0001:order_company', 'an order of another customer is refused');
select is(pg_temp.code_('admin', $q$select public.record_refund(@50, @01, @14, public.today_pkt(), 100, 'bank', 'RF-1', 'goodwill')::text$q$, true), 'ok:', 'a refund of 100 is recorded');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 220.00::numeric, 'the balance is 220');
select is((select refunded from public.v_company_credit where company_id = pg_temp.u('01')), 100.00::numeric, 'refunded 100');
select is(pg_temp.code_('admin', $q$select public.record_refund(@51, @01, null, public.today_pkt(), 100)::text$q$), 'E:P0001:duplicate_refund', 'the same amount on the same day is a duplicate');
select is(pg_temp.code_('admin', $q$select public.record_refund(@51, @01, null, public.today_pkt() - 4, 30, 'bank', ' rf-1 ')::text$q$), 'E:P0001:duplicate_refund', 'so is the same reference, capitals and spaces ignored');
select alike(pg_temp.try_('admin', $q$select public.record_refund(@51, @01, null, public.today_pkt(), 100)::text$q$), 'E:P0001:duplicate_refund|Looks like a refund already recorded on %.', 'the message names the date');
select is(pg_temp.code_('admin', $q$select public.record_refund(@51, @01, null, public.today_pkt(), 100, 'bank', null, null, true)::text$q$, true), 'ok:', 'confirmed, it goes in');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 120.00::numeric, 'the balance is 120');

-- ================================================================== apply_credit
select is(pg_temp.code_('sales', $q$select public.apply_credit(@60, @11, 10)::text$q$), 'E:42501:admin_only', 'applying credit is the admin''s');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@60, @11, 150)::text$q$), 'E:P0001:credit_exceeds_balance', 'more than the balance is refused');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@60, @13, 60)::text$q$), 'E:P0001:credit_exceeds_order', 'more than the order owes is refused (order 13 owes 50)');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@60, @20, 5)::text$q$), 'E:P0001:credit_exceeds_balance', 'credit of one customer cannot go to another customer''s order (that customer holds none)');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@60, @11, 0)::text$q$), 'E:22023:amount', 'nothing to apply is refused');
select throws_ok($$select public.apply_credit(gen_random_uuid(), gen_random_uuid(), 5)$$, 'P0002', null, 'an order that is not there is refused');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('11')), 500.00::numeric, 'before: order 11 owes 500');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@60, @11, 120, null, 'from the overpayment')::text$q$, true), 'ok:', '120 of credit goes to order 11');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 0.00::numeric, 'the balance is used up');
select is((select applied from public.v_company_credit where company_id = pg_temp.u('01')), 120.00::numeric, 'applied 120');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@61, @11, 1)::text$q$), 'E:P0001:credit_exceeds_balance', 'and no more can be applied');
select is((select count(*)::int from public.payments_in where order_id = pg_temp.u('11')), 0, 'applied credit is an allocation record: no payment row');
select is((select count(*)::int from public.customer_refunds where reference = 'from the overpayment'), 0, 'and no refund');

-- ================================================================== the oracle: one figure on every screen
select is((select balance from public.order_receivables(pg_temp.u('11'))), 380.00::numeric, 'receivables: order 11 owes 380');
select is((select settled from public.order_receivables(pg_temp.u('11'))), 120.00::numeric, 'settled 120');
select is((select payment_state from public.order_receivables(pg_temp.u('11'))), 'part', 'part paid');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('11')), 380.00::numeric, 'order money agrees: 380');
select is((select settled from public.v_order_money where order_id = pg_temp.u('11')), 120.00::numeric, 'settled 120 there too');
select is((select sum(remaining) from public.aging_as_of(public.today_pkt()) where order_id = pg_temp.u('11')), 380.00::numeric, 'aging lists 380');
select is((select g from public.v_order_basis where order_id = pg_temp.u('11')), 500.00::numeric, 'the basis is the invoiced 500, credit never changes what was invoiced');
select is((select count(*)::int
           from public.order_receivables() r
           join public.v_order_money m on m.order_id = r.order_id
           where r.company_id = pg_temp.u('01')
             and (r.gross_target, r.settled, r.balance, r.overpaid_by, r.due_on, r.payment_state)
                 is distinct from (m.gross_target, m.settled, m.receivable, m.overpaid_by, m.due_on, m.payment_state)), 0,
  'receivables and order money agree on every order of the customer');
select is((select coalesce(sum(a.remaining), 0) from public.aging_as_of(public.today_pkt()) a where a.company_id = pg_temp.u('01') and a.kind = 'invoice'),
          (select coalesce(sum(r.balance), 0) from public.order_receivables() r where r.company_id = pg_temp.u('01')
             and exists (select 1 from public.invoices v where v.order_id = r.order_id and v.voided_at is null)),
  'aging adds up to the receivables of the invoiced orders');
select is((select gross_received from public.v_cash_month where month = date_trunc('month', public.today_pkt())::date),
          (select sum(amount) from public.payments_in where voided_at is null and date_trunc('month', received_on)::date = date_trunc('month', public.today_pkt())::date),
  'cash received is the payments only: applied credit and refunds are not payments');
select is((select refunds_out from public.v_cash_month where month = date_trunc('month', public.today_pkt())::date),
          (select sum(amount) from public.customer_refunds where date_trunc('month', refunded_on)::date = date_trunc('month', public.today_pkt())::date),
  'the cash month shows the refunds as cash out');
select is((select money_in from public.v_month_cash_flow where month = date_trunc('month', public.today_pkt())::date),
          (select gross_received from public.v_cash_month where month = date_trunc('month', public.today_pkt())::date),
  'In vs out and the cash month agree on money in');
select is((select refunds_out from public.v_month_cash_flow where month = date_trunc('month', public.today_pkt())::date),
          (select refunds_out from public.v_cash_month where month = date_trunc('month', public.today_pkt())::date),
  'and on refunds out');

-- applied credit settles an order completely, and the order leaves aging
select is(pg_temp.code_('admin', $q$select public.apply_credit(@62, @13, 1)::text$q$), 'E:P0001:credit_exceeds_balance', 'control: nothing left to apply');
insert into public.payments_in (id, order_id, received_on, amount) values (pg_temp.u('41'), pg_temp.u('10'), public.today_pkt(), 50);
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 50.00::numeric, 'another 50 overpaid: the balance is 50');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@62, @13, 50)::text$q$, true), 'ok:', '50 settles order 13');
select is((select payment_state from public.order_receivables(pg_temp.u('13'))), 'settled', 'order 13 is settled');
select is((select count(*)::int from public.aging_as_of(public.today_pkt()) where order_id = pg_temp.u('13')), 0, 'and leaves aging');
select is((select settled_ok from public.v_order_money where order_id = pg_temp.u('13')), true, 'order money says settled too');

-- a credit note on the paid invoice is credit, never counted twice
select is(pg_temp.code_('admin', $q$select count(*)::text from public.create_credit_note(@30, 100, 'goods returned')$q$, true), 'ok:1', 'a credit note of 100 + 18 GST is issued on invoice 1');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 118.00::numeric, 'the customer''s credit grows by the 118 the credit note took off the order');

-- ================================================================== other rules around it
select is(pg_temp.code_('admin', $q$select public.void_invoice(@31, 'wrong')::text$q$), 'E:P0001:paid', 'an invoice that applied credit already covers cannot be voided');
select is(pg_temp.code_('admin', $q$delete from public.credit_applications where to_order_id = @13 returning 1$q$, true), 'ok:1', 'an applied credit is removed by deleting it (open month)');
select is((select payment_state from public.order_receivables(pg_temp.u('13'))), 'unpaid', 'order 13 owes again');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('01')), 168.00::numeric, 'and the credit is back: 118 + 50');
insert into public.customer_refunds (id, company_id, order_id, amount) values (pg_temp.u('54'), pg_temp.u('01'), pg_temp.u('14'), 3);
select is(pg_temp.code_('admin', $q$select count(*)::text from public.delete_order(@14)$q$), 'E:P0001:has_payment', 'an order a refund points to is kept');
select is(left(pg_temp.code_('admin', $q$update public.credit_applications set amount = 5 returning 1$q$), 8), 'E:42501:', 'an application cannot be edited');
select is(pg_temp.code_('sales', 'select count(*)::text from public.credit_applications'), 'ok:0', 'sales read no applied credit');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.customer_refunds'), 'ok:0', 'an engineer reads no refund');

-- the month lock on applied credit
select lives_ok($$select public.close_months_through('2019-03-01')$$, 'March 2019 closes');
select is(pg_temp.code_('admin', $q$select public.apply_credit(@63, @13, 5, '2019-03-10')::text$q$), 'E:P0001:', 'credit cannot be applied into a closed month');

-- merge_companies carries refunds and applied credit to the kept customer
select lives_ok($$select public.merge_companies('11800000-0000-4000-8000-000000000002', '11800000-0000-4000-8000-000000000001')$$, 'merging customer 01 into 02 works');
select is((select count(*)::int from public.customer_refunds where company_id = pg_temp.u('02')), 3, 'the refunds moved with it');
select is((select balance from public.v_company_credit where company_id = pg_temp.u('02')), 165.00::numeric, 'and the balance stays 165 (the 3 refund is taken off)');

select * from finish();
rollback;
