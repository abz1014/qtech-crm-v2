-- 0058_money_review: the database bugs the money review found (docs/MONEY_REVIEW.md, MR-6 and MR-7). Each block failed before 0058.
begin;
select plan(9);

-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000058', 'Review customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000058', 'c0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ MR-6 the invoice series rolls past its digit width
-- lpad() truncates a longer string, so INV-9999 + 1 came out as INV-1000: an old number, refused by the unique index.
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', 'INV-9999', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-10000', 'MR-6: INV-9999 is followed by INV-10000, not INV-1000');
reset role;

delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', '99', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), '100', 'MR-6: a bare 99 is followed by 100');
reset role;

delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000058', 'INV-0041', '2026-01-10', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-0042', 'MR-6: the zero padding is still kept');
reset role;
delete from public.invoices;

-- ------------------------------------------------------------------ MR-7 an exempt invoice has no tax to deposit
-- January 2026 (a past month): one invoice at 18%, one exempt (GST 0). Neither is deposited.
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000058', 'INV-0101', '2026-01-10', 1000, 180),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000058', 'INV-0102', '2026-01-12', 1000, 0);

set local role authenticated;
select is((select needs_fbr_attention from public.v_invoice_state where invoice_id = 'e1000000-0000-4000-8000-000000000001'), true,
  'MR-7: an 18% invoice of a past month with no deposit needs FBR attention');
select is((select needs_fbr_attention from public.v_invoice_state where invoice_id = 'e1000000-0000-4000-8000-000000000002'), false,
  'MR-7: an exempt invoice (GST 0) never needs a deposit');
select is((select needs_fbr_attention from public.v_gst_register where invoice_id = 'e1000000-0000-4000-8000-000000000002'), false,
  'MR-7: and the GST register does not flag it');
select is((select n from public.month_end_status('2026-01-01') where check_key = 'fbr_pending'), 1,
  'MR-7: the month-end checklist counts only the invoice with tax to deposit');
select is((select gst_to_deposit from public.v_gst_month where month = '2026-01-01'), 180.00::numeric,
  'MR-7: GST still to deposit is unchanged (the exempt invoice adds 0)');

-- sales read the register too: the same answer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.v_gst_register where needs_fbr_attention and invoice_month = '2026-01-01'), 1,
  'MR-7: sales see one invoice needing attention, not two');

select * from finish();
rollback;
