begin;
select * from no_plan();

-- 0068 (owner decision 2026-10-19): an imported invoice with no order, paid before the new system, is settled before
-- cutover. Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02. Fixtures are written as the table owner
-- (the import's service role is not limited either); the checks run as `authenticated` with a persona's claims.
-- Fixture month: March 2019, so no other data shares the GST month.

-- ------------------------------------------------------------------ structure
select has_column('public', 'invoices', 'settled_before_cutover', 'invoices.settled_before_cutover exists');
select col_not_null('public', 'invoices', 'settled_before_cutover', 'it is NOT NULL');
select col_default_is('public', 'invoices', 'settled_before_cutover', 'false', 'it defaults to false');
select ok(not has_function_privilege('authenticated', 'public.guard_invoice_settled_before_cutover()', 'execute')
      and not has_function_privilege('anon', 'public.guard_invoice_settled_before_cutover()', 'execute'),
  'the guard trigger function has no client grant');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('68000000-0000-4000-8000-000000000001', '0068 Old Customer');
insert into public.orders (id, company_id, owner_id) values
  ('68000000-0000-4000-8000-000000000020', '68000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');

-- the CHECK: only an imported row (legacy_source set) with no order
select throws_ok($$insert into public.invoices (company_id, number, invoice_date, net_amount, gst_amount, settled_before_cutover)
                   values ('68000000-0000-4000-8000-000000000001', 'SBC-X1', '2019-03-01', 100, 18, true)$$,
  '23514', null, 'CHECK: settled before cutover needs legacy_source');
select throws_ok($$insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover)
                   values ('68000000-0000-4000-8000-000000000020', 'SBC-X2', '2019-03-01', 100, 18, '{"t":1}', true)$$,
  '23514', null, 'CHECK: and no order');

-- SBC-1 settled (as the import writes it), SBC-2 an old company-only invoice still open (the control)
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover) values
  ('68000000-0000-4000-8000-000000000031', '68000000-0000-4000-8000-000000000001', 'SBC-1', '2019-03-10', 1000, 180, '{"t":"gst_invoices"}', true),
  ('68000000-0000-4000-8000-000000000032', '68000000-0000-4000-8000-000000000001', 'SBC-2', '2019-03-12', 500, 90, '{"t":"gst_invoices"}', false);

set local role authenticated;

-- ================================================================== admin: money reads
select is((select count(*)::int from public.aging_as_of('2026-09-30') where invoice_number = 'SBC-1'), 0,
  'aging_as_of: a settled invoice has nothing open (no row)');
select is((select remaining from public.aging_as_of('2026-09-30') where invoice_number = 'SBC-2'), 590.00::numeric,
  'aging_as_of: the open company-only invoice is still owed in full');
select is((select bucket from public.aging_as_of('2026-09-30') where invoice_number = 'SBC-2'), '90+',
  'and it ages');
select is((select count(*)::int from public.aging_as_of('2026-09-30') where company_id = '68000000-0000-4000-8000-000000000001' and kind = 'invoice'), 1,
  'the customer owes one invoice, not two');
select is((select count(*)::int from public.order_receivables() r
           join public.invoices v on v.order_id = r.order_id
           where v.id = '68000000-0000-4000-8000-000000000031'), 0,
  'order_receivables: a settled invoice is in no receivable');
select is((select count(*)::int from public.v_order_money m where m.order_id is null), 0,
  'v_order_money: nothing without an order');

-- revenue and tax are unchanged: still a sale, still output GST
select is((select gross_amount from public.v_gst_register where invoice_id = '68000000-0000-4000-8000-000000000031'), 1180.00::numeric,
  'v_gst_register still lists the settled invoice at its gross');
select is((select gst from public.v_gst_month where month = '2019-03-01'), 270.00::numeric,
  'v_gst_month still counts its GST as output tax');
select is((select invoice_count from public.v_gst_month where month = '2019-03-01'), 2,
  'and the invoice as a sale of the month');
select is((select needs_fbr_attention from public.v_invoice_state where invoice_id = '68000000-0000-4000-8000-000000000031'), true,
  'the FBR deposit of a settled invoice is still followed (tax, not payment)');

-- ================================================================== reminders
select is(public.stamp_payment_reminder(array['68000000-0000-4000-8000-000000000031']::uuid[]), 0,
  'stamp_payment_reminder: a settled invoice is not remindable');
select is(public.stamp_payment_reminder(array['68000000-0000-4000-8000-000000000032']::uuid[]), 1,
  'the open one still is');
select is((select reminder_count::int from public.invoices where id = '68000000-0000-4000-8000-000000000031'), 0,
  'and the settled invoice carries no reminder');

-- ================================================================== nobody in the app sets or clears it
select throws_ok($$update public.invoices set settled_before_cutover = true where id = '68000000-0000-4000-8000-000000000032'$$,
  '42501', null, 'admin cannot mark an invoice settled before cutover');
select throws_ok($$update public.invoices set settled_before_cutover = false where id = '68000000-0000-4000-8000-000000000031'$$,
  '42501', null, 'admin cannot clear it');
select lives_ok($$update public.invoices set notes = 'checked' where id = '68000000-0000-4000-8000-000000000031'$$,
  'admin still edits the rest of a settled invoice');
select lives_ok($$update public.invoices set psid = 'PSID-68' where id = '68000000-0000-4000-8000-000000000031'$$,
  'including its FBR fields');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);   -- sales
select throws_ok($$insert into public.invoices (company_id, number, invoice_date, net_amount, gst_amount, legacy_source, settled_before_cutover)
                   values ('68000000-0000-4000-8000-000000000001', 'SBC-S1', '2019-03-20', 100, 18, '{"t":1}', true)$$,
  '42501', null, 'sales cannot insert an invoice settled before cutover');
select throws_ok($$update public.invoices set settled_before_cutover = true where id = '68000000-0000-4000-8000-000000000032'$$,
  '42501', null, 'sales cannot set it');
select lives_ok($$insert into public.invoices (company_id, number, invoice_date, net_amount, gst_amount)
                  values ('68000000-0000-4000-8000-000000000001', 'SBC-S2', '2019-03-20', 100, 18)$$,
  'sales still create ordinary invoices (false by default)');
select is((select settled_before_cutover from public.invoices where number = 'SBC-S2'), false,
  'an app-made invoice is never settled before cutover');

reset role;
select lives_ok($$update public.invoices set settled_before_cutover = false where id = '68000000-0000-4000-8000-000000000031'$$,
  'the import (not authenticated) can still change it');

select * from finish();
rollback;
