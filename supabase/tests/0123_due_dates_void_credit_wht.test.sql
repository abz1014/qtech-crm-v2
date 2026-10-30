-- 0123_due_dates_void_credit_wht: the per-invoice due dates and oldest-first allocation of 0123 hold together with the money integrity
-- rules of 0112 (a void invoice, credit notes) and 0116 (withholding tax settles). The same figure on every screen:
-- order_receivables = v_order_money = aging_as_of, and a payment can be tied to an invoice through record_payment.
-- Fixture users come from supabase/seed.sql: admin a0..01. Ids are 12300000-...-0000000000NN. Fixtures are written as the table owner.
-- Every order has 2 lines worth 1,000 + 180 GST, terms 20 days, and two invoices of 500 + 90: P (9 Feb 2024) and Q (1 Mar 2024).
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create function pg_temp.u(h text) returns uuid language sql immutable as
  $$ select ('12300000-0000-4000-8000-' || lpad(h, 12, '0'))::uuid $$;

insert into public.companies (id, name) values (pg_temp.u('01'), '0123 Customer');

-- orders 10 void, 20 credit note, 30 WHT untied, 40 WHT tied, 50 record_payment tie, 60 WHT pays the invoice (void refused)
insert into public.orders (id, company_id, owner_id, payment_terms_days)
select pg_temp.u(n), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 20 from unnest(array['10', '20', '30', '40', '50', '60']) n;
insert into public.order_items (order_id, position, description, qty, unit_price_net, gst_rate)
select pg_temp.u(n), 1, 'line', 1, 1000, 18 from unnest(array['10', '20', '30', '40', '50', '60']) n;
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount)
select pg_temp.u(o || k), pg_temp.u(o), 'T123-' || o || k, case k when '1' then date '2024-02-09' else date '2024-03-01' end, 500, 90
from unnest(array['10', '20', '30', '40', '50']) o cross join unnest(array['1', '2']) k;
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  (pg_temp.u('61'), pg_temp.u('60'), 'T123-601', '2024-02-09', 1000, 180);

-- WHT counts as settled money, tied or not
insert into public.payments_in (id, order_id, received_on, amount, wht_amount) values
  (pg_temp.u('a3'), pg_temp.u('30'), '2024-02-20', 500, 90),
  (pg_temp.u('a6'), pg_temp.u('60'), '2024-02-20', 1000, 180);
insert into public.payments_in (id, order_id, received_on, amount, wht_amount, invoice_id) values
  (pg_temp.u('a4'), pg_temp.u('40'), '2024-02-20', 500, 90, pg_temp.u('402'));

-- a tie to a void invoice is refused, and the void itself needs no payment on it
set local role authenticated;
select lives_ok($$select public.void_invoice('12300000-0000-4000-8000-000000000101', 'duplicate')$$, 'void: invoice 101 is voided');
reset role;
select throws_ok($$insert into public.payments_in (order_id, received_on, amount, invoice_id)
                    values ('12300000-0000-4000-8000-000000000010', '2024-02-21', 10, '12300000-0000-4000-8000-000000000101')$$,
  '22023', 'That invoice is void, so a payment cannot be tied to it.', 'a payment cannot be tied to a void invoice');
select throws_ok($$insert into public.payments_in (order_id, received_on, amount, invoice_id)
                    values ('12300000-0000-4000-8000-000000000010', '2024-02-21', 10, '12300000-0000-4000-8000-000000000201')$$,
  '22023', 'That invoice is not on this order.', 'nor to an invoice of another order');

-- a credit note takes what is open on its own invoice off: order 20, invoice 201 credited in full
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.create_credit_note('12300000-0000-4000-8000-000000000201', 500, 'returned', 90, '2024-04-01')$$, 'credit note: invoice 201 credited in full');

-- the payment tie through record_payment (order 50: 590 for the second invoice)
select lives_ok($$select public.record_payment('12300000-0000-4000-8000-0000000000a5', '12300000-0000-4000-8000-000000000050', '2024-02-20', 590, null, 'bank', false, 0, null,
                                              '12300000-0000-4000-8000-000000000502')$$, 'record_payment takes the invoice the payment is for');
select is((select invoice_id from public.payments_in where id = pg_temp.u('a5')), pg_temp.u('502'), 'and stores it');
select throws_ok($$select public.record_payment('12300000-0000-4000-8000-0000000000a7', '12300000-0000-4000-8000-000000000050', '2024-02-22', 11, null, 'bank', false, 0, null,
                                               '12300000-0000-4000-8000-000000000101')$$,
  '22023', null, 'record_payment refuses an invoice that is void or on another order');
select lives_ok($$select public.record_payment('12300000-0000-4000-8000-0000000000a8', '12300000-0000-4000-8000-000000000050', '2024-02-23', 12, 'R-1', 'bank')$$,
  'the old 6-argument call still works');
select is((select invoice_id from public.payments_in where id = pg_temp.u('a8')), null, 'and ties nothing');
select throws_ok($$select public.void_invoice('12300000-0000-4000-8000-000000000601', 'x')$$, 'P0001', null, 'void is refused when cash plus WHT already covers the invoice');
select throws_ok($$select public.void_invoice('12300000-0000-4000-8000-000000000502', 'x')$$, 'P0001', null, 'and when a payment is tied to it');

-- ------------------------------------------------------------------ the figures
-- order 10: invoice 101 void -> only 102 counts: 590 owed, due 1 Mar 2024 + 20 = 21 Mar 2024
select is((select due_on from public.order_receivables(pg_temp.u('10'))), '2024-03-21'::date, 'void: the order follows the invoice that is left (21 Mar)');
select is((select gross_target from public.order_receivables(pg_temp.u('10'))), 590.00::numeric, 'void: the order is invoiced for 590');
select is((select due_on from public.v_order_money where order_id = pg_temp.u('10')), '2024-03-21'::date, 'void: the order money view agrees on the due date');
select is((select receivable from public.v_order_money where order_id = pg_temp.u('10')), 590.00::numeric, 'and on what is owed');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where invoice_id = pg_temp.u('101')), 0, 'void: the void invoice does not age');
select is((select sum(remaining) from public.aging_as_of('2024-04-30') where order_id = pg_temp.u('10')), 590.00::numeric, 'void: aging lists the 590');

-- order 20: invoice 201 credited in full: not unpaid, 202 is the oldest unpaid
select is((select due_on from public.order_receivables(pg_temp.u('20'))), '2024-03-21'::date, 'credit note: the credited invoice is not unpaid (21 Mar)');
select is((select gross_target from public.order_receivables(pg_temp.u('20'))), 590.00::numeric, 'credit note: receivables are invoiced less credited');
select is((select due_on from public.v_order_money where order_id = pg_temp.u('20')), '2024-03-21'::date, 'credit note: the money view agrees');
select is((select sum(remaining) from public.aging_as_of('2024-04-30') where order_id = pg_temp.u('20')), 590.00::numeric, 'credit note: aging lists 590 (the credited invoice is gone)');
select is((select count(*)::int from public.aging_as_of('2024-03-15') where invoice_id = pg_temp.u('201')), 1, 'credit note: before it was issued the invoice still aged');

-- order 30: 500 cash + 90 WHT, untied: placed oldest first, so invoice 301 is settled and 302 is the oldest unpaid
select is((select settled from public.order_receivables(pg_temp.u('30'))), 590.00::numeric, 'WHT: settled is cash + WHT');
select is((select due_on from public.order_receivables(pg_temp.u('30'))), '2024-03-21'::date, 'WHT: settles the oldest invoice (due 21 Mar)');
select is((select due_on from public.v_order_money where order_id = pg_temp.u('30')), '2024-03-21'::date, 'WHT: the money view agrees');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where invoice_id = pg_temp.u('301')), 0, 'WHT: aging does not list the settled invoice');
select is((select sum(remaining) from public.aging_as_of('2024-04-30') where order_id = pg_temp.u('30')), (select balance from public.order_receivables(pg_temp.u('30'))), 'WHT: receivables and aging agree');

-- order 40: the same money tied to the SECOND invoice: the first stays the oldest unpaid
select is((select due_on from public.order_receivables(pg_temp.u('40'))), '2024-02-29'::date, 'WHT tied to the second invoice: the first is still due 29 Feb');
select is((select due_on from public.v_order_money where order_id = pg_temp.u('40')), '2024-02-29'::date, 'WHT tied: the money view agrees');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where invoice_id = pg_temp.u('402')), 0, 'WHT tied: the invoice it was for is not aged');
select is((select sum(remaining) from public.aging_as_of('2024-04-30') where order_id = pg_temp.u('40')), (select balance from public.order_receivables(pg_temp.u('40'))), 'WHT tied: receivables and aging agree');

-- order 50: 590 tied through record_payment to the second invoice (+12 untied went to the oldest)
select is((select due_on from public.order_receivables(pg_temp.u('50'))), '2024-02-29'::date, 'record_payment tie: the first invoice is the oldest unpaid');

-- order 60: one invoice, paid in full with cash + WHT: settled
select is((select payment_state from public.order_receivables(pg_temp.u('60'))), 'settled', 'WHT: cash 1,000 + WHT 180 settles an invoice of 1,180');
select is((select count(*)::int from public.aging_as_of('2024-04-30') where order_id = pg_temp.u('60')), 0, 'and it does not age');

-- the statement lists a credit note and counts WHT with the payment
select is((select sum(debit) - sum(credit) from public.customer_statement(pg_temp.u('01'), '2024-12-31')),
  (select sum(balance) from public.order_receivables() where company_id = pg_temp.u('01')), 'the statement closes on what receivables owe (voids out, credit notes and WHT in)');

select * from finish();
rollback;
