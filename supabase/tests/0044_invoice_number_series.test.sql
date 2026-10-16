begin;
select plan(14);

-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ structure
select ok((select p.prosecdef = false and array_to_string(p.proconfig, ',') like 'search_path=%'
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and has_function_privilege('authenticated', p.oid, 'execute')
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'next_invoice_number'),
  'next_invoice_number is SECURITY INVOKER with a fixed search_path, executable by authenticated only');

-- ------------------------------------------------------------------ fixtures
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');

set local role authenticated;

-- ------------------------------------------------------------------ an empty register starts the series
select is((select next_number from public.next_invoice_number()), 'INV-0001', 'no invoice yet: the series starts at INV-0001');
select ok((select last_number is null and last_date is null from public.next_invoice_number()), 'and nothing precedes it');

-- ------------------------------------------------------------------ the series is read from the data
reset role;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, created_at) values
  ('a1000000-0000-4000-8000-000000000001', 'INV-2299', '2026-10-30', 100, 18, '2026-10-30 10:00+05'),
  ('a1000000-0000-4000-8000-000000000001', 'INV-2311', '2026-11-25', 100, 18, '2026-11-25 10:00+05'),
  ('a1000000-0000-4000-8000-000000000001', 'INV-2308', '2026-11-21', 100, 18, '2026-11-26 10:00+05');   -- backdated: created last, lower number
set local role authenticated;

select is((select next_number from public.next_invoice_number()), 'INV-2312', 'the highest number in the series plus one, even when a lower number was created last');
select is((select last_number from public.next_invoice_number()), 'INV-2311', 'the line under the field names the invoice it follows');
select is((select last_date from public.next_invoice_number()), date '2026-11-25', 'and its date');

-- ------------------------------------------------------------------ width and prefix are kept
reset role;
delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000001', 'INV-0009', '2026-11-01', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-0010', 'zero padding grows with the number: INV-0009 -> INV-0010');

reset role;
delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000001', '2311', '2026-11-01', 100, 18);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), '2312', 'a bare number carries on as a bare number');

reset role;
delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, created_at) values
  ('a1000000-0000-4000-8000-000000000001', 'S-7', '2026-01-01', 100, 18, '2026-01-01 10:00+05'),
  ('a1000000-0000-4000-8000-000000000001', 'INV-0100', '2026-11-01', 100, 18, '2026-11-01 10:00+05');
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-0101', 'the series is the most recent invoice''s prefix; an older prefix is ignored');

reset role;
delete from public.invoices;
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount, legacy_flags) values
  ('a1000000-0000-4000-8000-000000000001', null, null, 100, 18, array['undated', 'unnumbered']);
set local role authenticated;
select is((select next_number from public.next_invoice_number()), 'INV-0001', 'a legacy invoice with no number does not break the series');

-- ------------------------------------------------------------------ who may ask
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select * from public.next_invoice_number()$$, 'sales can ask');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from public.next_invoice_number()$$, '42501', null, 'an engineer is refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select * from public.next_invoice_number()$$, '42501', null, 'a deactivated user is refused');

reset role;
set local role anon;
select throws_ok($$select * from public.next_invoice_number()$$, '42501', null, 'anon cannot execute it');

select * from finish();
rollback;
