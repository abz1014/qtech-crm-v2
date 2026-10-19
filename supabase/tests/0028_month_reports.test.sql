begin;
select * from no_plan();

-- S23 (migration 0028_month_reports), Amendment A6.3 / A6.6.
-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Every scenario is a named fixture with its own month (or as-of date), so the figures can be checked to the paisa:
--   F-PNL        Feb and Mar 2026   one GST payment, one exempt payment, overheads, order costs, input tax, a drawing
--   F-AGING      as of 2026-09-30   FIFO across two invoices, the 29/31/61/91 day buckets, an advance
--   F-PAYABLES   as of 2026-09-30   a USD leg with a PO, part payments, the 3% rule, a cancelled order
--   F-GST        April 2026         the FBR month summary, input tax for admin only
--   F-TEAM       Feb and Mar 2026   net cash credited per person, with the quarter
--   F-CHECKLIST  December 2025      one fixture row per warning
-- Fixtures are inserted as the table owner; the checks run as the `authenticated` role with the persona's claims.

create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select is((select count(*)::int from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('v_month_pnl', 'v_month_expense_category', 'v_gst_month', 'v_month_team')
             and coalesce(c.reloptions, '{}') @> array['security_invoker=true']), 4,
  'the four month views are security_invoker');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in ('public.v_month_pnl'::regclass, 'public.v_month_expense_category'::regclass,
                                      'public.v_gst_month'::regclass, 'public.v_month_team'::regclass)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privilege on the month views');
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('aging_as_of', 'payables_as_of', 'month_end_status')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 3,
  'the three report functions are SECURITY INVOKER with a fixed search_path, executable by authenticated only');

-- ------------------------------------------------------------------ fixtures (as owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier Alpha'),
  ('c0000000-0000-4000-8000-000000000003', 'Supplier Beta');

-- Owners: sales a0..02 unless noted. OX is admin-owned, CK3 engineer-owned.
insert into public.orders (id, company_id, owner_id, legacy_flags, cancelled_on) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- OG  taxed
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '{}', null),   -- OX  exempt
  ('a1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', array['value_basis_unknown'], null), -- OU
  ('a1000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- AA
  ('a1000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- AB
  ('a1000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- AC
  ('a1000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- AE
  ('a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- P1
  ('a1000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', '2026-09-01'), -- P2 cancelled
  ('a1000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- CK1
  ('a1000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- CK2
  ('a1000000-0000-4000-8000-000000000033', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', '{}', null),   -- CK3
  ('a1000000-0000-4000-8000-000000000034', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', '2026-01-20'), -- CK4 cancelled
  ('a1000000-0000-4000-8000-000000000035', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null),   -- CK5
  ('a1000000-0000-4000-8000-000000000036', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', array['value_basis_unknown'], null), -- CKU
  ('a1000000-0000-4000-8000-000000000037', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '{}', null);   -- CKZ no value

insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate) values
  ('a1000000-0000-4000-8000-000000000001', 'OG taxed', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000002', 'OX exempt', 1, 2000, 0),
  ('a1000000-0000-4000-8000-000000000003', 'OU', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000031', 'CK1', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000032', 'CK2', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000033', 'CK3', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000034', 'CK4', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000035', 'CK5', 1, 1000, 18),
  ('a1000000-0000-4000-8000-000000000036', 'CKU', 1, 1000, 18);
insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at, costs_complete_by) values
  ('a1000000-0000-4000-8000-000000000032', 100, now(), 'a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- F-PNL (Feb and Mar 2026)
-- Money in, Feb: OG 590 of 1180 gross (net 1000) -> net 500.00, GST 90.00; OX 1000 of 2000 gross exempt -> net 1000.00;
-- OU 118 has no net split (value basis unknown) -> unresolved_gross 118. Mar: OG 590 again -> net 500.00.
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000001', '2026-02-10', 590),
  ('a1000000-0000-4000-8000-000000000002', '2026-02-10', 1000),
  ('a1000000-0000-4000-8000-000000000003', '2026-02-10', 118),
  ('a1000000-0000-4000-8000-000000000001', '2026-03-10', 590);
-- Money out, Feb: Salaries 400 + Fuel 100 = overheads 500; Supplier payment 600 (input tax 90, net 510) + Freight 200 =
-- order costs 710; Owner drawings 300 is not in the P&L. Gross cash out 1600, input tax 90.
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, order_id) values
  ('2026-02-12', 400, 0,  'ca7e0000-0000-4000-8000-000000000001', null),
  ('2026-02-12', 100, 0,  'ca7e0000-0000-4000-8000-000000000004', null),
  ('2026-02-12', 600, 90, 'ca7e0000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001'),
  ('2026-02-12', 200, 0,  'ca7e0000-0000-4000-8000-000000000012', 'a1000000-0000-4000-8000-000000000001'),
  ('2026-02-12', 300, 0,  'ca7e0000-0000-4000-8000-000000000016', null);
insert into public.targets (user_id, year, quarter, target_net_pkr) values
  ('a0000000-0000-4000-8000-000000000002', 2026, 1, 5000);

-- ---------------------------------------------------------------- F-AGING (as of 2026-09-30)
-- AA: invoices at D-91 and D-61 (gross 1180 each) and a payment of 500 on 2026-07-15 -> FIFO: A1 owes 680, A2 owes 1180.
--     An invoice dated after the as-of date and a payment received after it are both ignored.
-- AB: invoices at D-31 and D-29 (gross 590 each), payment 400 -> B1 owes 190, B2 owes 590.
-- AC: an advance of 300 on an order with no invoice. AE: unpaid invoices exactly 30, 60 and 90 days old (gross 118).
insert into public.invoices (order_id, number, invoice_date, net_amount, gst_amount) values
  ('a1000000-0000-4000-8000-000000000011', 'AG-A1', date '2026-09-30' - 91, 1000, 180),
  ('a1000000-0000-4000-8000-000000000011', 'AG-A2', date '2026-09-30' - 61, 1000, 180),
  ('a1000000-0000-4000-8000-000000000011', 'AG-A3', '2026-10-02', 1000, 180),
  ('a1000000-0000-4000-8000-000000000012', 'AG-B1', date '2026-09-30' - 31, 500, 90),
  ('a1000000-0000-4000-8000-000000000012', 'AG-B2', date '2026-09-30' - 29, 500, 90),
  ('a1000000-0000-4000-8000-000000000014', 'AG-E1', date '2026-09-30' - 30, 100, 18),
  ('a1000000-0000-4000-8000-000000000014', 'AG-E2', date '2026-09-30' - 60, 100, 18),
  ('a1000000-0000-4000-8000-000000000014', 'AG-E3', date '2026-09-30' - 90, 100, 18);
insert into public.payments_in (order_id, received_on, amount) values
  ('a1000000-0000-4000-8000-000000000011', '2026-07-15', 500),
  ('a1000000-0000-4000-8000-000000000011', '2026-10-05', 1000),
  ('a1000000-0000-4000-8000-000000000012', '2026-09-10', 400),
  ('a1000000-0000-4000-8000-000000000013', '2026-09-15', 300);

-- ---------------------------------------------------------------- F-PAYABLES (as of 2026-09-30)
insert into public.supplier_orders (id, order_id, supplier_id, currency, placed_on) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'USD', '2026-09-10'), -- L1
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', null,  '2026-09-05'), -- L2
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000003', 'PKR', '2026-09-06'), -- L3
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000003', 'PKR', null),         -- L4 not placed
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000003', 'PKR', '2026-10-03'), -- L5 placed after
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'EUR', '2026-09-12'), -- L6 no rate
  ('a2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'PKR', '2026-09-13'), -- L7 unpriced
  ('a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000003', 'PKR', '2026-09-14'), -- L8 exactly 3%
  ('a2000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000003', 'PKR', '2026-09-14'), -- L9 just over 3%
  ('a2000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000003', 'PKR', '2026-08-20'); -- L10 cancelled order
insert into public.order_items (order_id, description, qty, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  ('a1000000-0000-4000-8000-000000000021', 'L1 item (PO is the source)', 10, 500, 18, 'a2000000-0000-4000-8000-000000000001', 50),   -- items would say 500 USD
  ('a1000000-0000-4000-8000-000000000021', 'L2 item a', 2, 9000, 18, 'a2000000-0000-4000-8000-000000000002', 5000),
  ('a1000000-0000-4000-8000-000000000021', 'L2 item b', 1, 4000, 18, 'a2000000-0000-4000-8000-000000000002', 2500),
  ('a1000000-0000-4000-8000-000000000021', 'L3 item', 1, 12000, 18, 'a2000000-0000-4000-8000-000000000003', 10000),
  ('a1000000-0000-4000-8000-000000000021', 'L5 item', 1, 100, 18, 'a2000000-0000-4000-8000-000000000005', 100),
  ('a1000000-0000-4000-8000-000000000021', 'L6 item', 10, 1500, 18, 'a2000000-0000-4000-8000-000000000006', 100),
  ('a1000000-0000-4000-8000-000000000021', 'L8 item', 1, 12000, 18, 'a2000000-0000-4000-8000-000000000008', 10000),
  ('a1000000-0000-4000-8000-000000000021', 'L9 item', 1, 12000, 18, 'a2000000-0000-4000-8000-000000000009', 10000),
  ('a1000000-0000-4000-8000-000000000022', 'L10 item', 1, 1000, 18, 'a2000000-0000-4000-8000-000000000010', 1000);
-- L1's PO: 10 x 100 = 1000.00 USD (the trigger computes the total from the lines)
insert into public.purchase_orders (supplier_order_id, number, revision, currency, lines) values
  ('a2000000-0000-4000-8000-000000000001', 9001, 0, 'USD', '[{"qty":9,"unit_price":100}]'),
  ('a2000000-0000-4000-8000-000000000001', 9001, 1, 'USD', '[{"qty":10,"unit_price":100}]');
-- USD: manual 280 and auto 279 on the same day (manual wins); a later manual 290 (after the as-of date) is ignored
-- on 2026-09-30 and used on 2026-10-31; an older 270 is superseded.
insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('USD', 270, '2026-09-01', 'manual'),
  ('USD', 279, '2026-09-25', 'auto'),
  ('USD', 280, '2026-09-25', 'manual'),
  ('USD', 290, '2026-10-02', 'manual');
-- Supplier payments by leg (category ...0011 = Supplier payment). L1 also has a Freight expense (not a supplier payment)
-- and a payment dated after the as-of date.
insert into public.expenses (paid_on, amount_pkr, category_id, supplier_order_id) values
  ('2026-09-20', 100000, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001'),
  ('2026-10-05',  50000, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001'),
  ('2026-09-21',   5000, 'ca7e0000-0000-4000-8000-000000000012', 'a2000000-0000-4000-8000-000000000001'),
  ('2026-09-22',  12300, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000002'),
  ('2026-09-22',  10500, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000003'),
  ('2026-09-22',   9700, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000008'),
  ('2026-09-22',   9699, 'ca7e0000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000009');

-- ---------------------------------------------------------------- F-GST (April 2026, plus input tax in Feb 2026 and Oct 2025)
insert into public.invoices (company_id, number, invoice_date, net_amount, gst_amount, psid, tax_deposited_on, tax_deposit_amount) values
  ('c0000000-0000-4000-8000-000000000001', 'GST-1', '2026-04-05', 1000, 180, 'P1', '2026-04-20', 180),
  ('c0000000-0000-4000-8000-000000000001', 'GST-2', '2026-04-15', 2000, 360, 'P1', null, null),
  ('c0000000-0000-4000-8000-000000000001', 'GST-3', '2026-04-25',  500,   0, null, null, null);
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id) values
  ('2026-04-12', 1150, 150, 'ca7e0000-0000-4000-8000-000000000011');
-- input tax with no invoices in that month (cash, so it adds nothing to the December checklist)
insert into public.expenses (paid_on, amount_pkr, input_tax_pkr, category_id, paid_via) values
  ('2025-10-12', 240, 40, 'ca7e0000-0000-4000-8000-000000000013', 'cash');

-- ---------------------------------------------------------------- F-CHECKLIST (December 2025, as of 2025-12-31)
insert into public.payments_in (order_id, received_on, amount, paid_via, bank_month) values
  ('a1000000-0000-4000-8000-000000000031', '2025-12-05', 1180, 'bank', null),          -- CK1 settled, bank, unticked
  ('a1000000-0000-4000-8000-000000000032', '2025-12-06', 1180, 'bank', '2025-12-01'),  -- CK2 settled, ticked
  ('a1000000-0000-4000-8000-000000000033', '2026-01-05', 1180, 'bank', null),          -- CK3 settled only in January
  ('a1000000-0000-4000-8000-000000000034', '2025-12-07', 1180, 'cash', null),          -- CK4 cancelled, cash
  ('a1000000-0000-4000-8000-000000000035', '2025-12-08',  500, 'bank', null),          -- CK5 part paid, unticked
  ('a1000000-0000-4000-8000-000000000036', '2025-12-09',  118, 'bank', null),          -- CKU basis unknown, unticked
  ('a1000000-0000-4000-8000-000000000037', '2025-12-10',   50, 'cash', null);          -- CKZ zero value, cash
insert into public.expenses (paid_on, amount_pkr, category_id, description, order_id, bank_month, legacy_flags) values
  ('2025-12-05', 1000, 'ca7e0000-0000-4000-8000-000000000001', null,    null, null, '{}'),                       -- e1 bank, unticked
  ('2025-12-06',  500, 'ca7e0000-0000-4000-8000-000000000002', null,    null, '2025-12-01', '{}'),               -- e2 bank, ticked
  ('2025-12-07',  100, 'ca7e0000-0000-4000-8000-000000000004', null,    null, null, '{}'),                       -- e3 cash (Fuel)
  ('2025-12-08',   10, 'ca7e0000-0000-4000-8000-000000000010', null,    null, null, '{}'),                       -- e4 Other, no description
  ('2025-12-09',   20, 'ca7e0000-0000-4000-8000-000000000010', 'Water', null, null, '{}'),                       -- e5 Other with description
  ('2025-12-10',   30, 'ca7e0000-0000-4000-8000-000000000012', null,    null, null, '{}'),                       -- e6 Freight, no order
  ('2025-12-11',   40, 'ca7e0000-0000-4000-8000-000000000012', null,    'a1000000-0000-4000-8000-000000000031', '2025-12-01', '{}'), -- e7 Freight on an order, ticked
  ('2025-12-12',   50, 'ca7e0000-0000-4000-8000-000000000010', 'old',   null, null, array['category_unmapped']),  -- e8 legacy unmapped
  ('2025-11-20',   60, 'ca7e0000-0000-4000-8000-000000000001', null,    null, null, '{}'),                       -- e9 an older unticked bank item
  ('2026-01-15',   70, 'ca7e0000-0000-4000-8000-000000000001', null,    null, null, '{}');                       -- e10 after month end
insert into public.recurring_expenses (id, label, category_id, amount, active, start_month) values
  ('b3000000-0000-4000-8000-000000000001', 'R1 recorded',   'ca7e0000-0000-4000-8000-000000000002', 500, true,  null),
  ('b3000000-0000-4000-8000-000000000002', 'R2 missing',    'ca7e0000-0000-4000-8000-000000000003', 100, true,  null),
  ('b3000000-0000-4000-8000-000000000003', 'R3 inactive',   'ca7e0000-0000-4000-8000-000000000003', 100, false, null),
  ('b3000000-0000-4000-8000-000000000004', 'R4 starts Mar', 'ca7e0000-0000-4000-8000-000000000003', 100, true,  '2026-03'),
  ('b3000000-0000-4000-8000-000000000005', 'R5 from Dec',   'ca7e0000-0000-4000-8000-000000000003', 100, true,  '2025-12');
insert into public.expenses (paid_on, amount_pkr, category_id, recurring_id, period, bank_month) values
  ('2025-12-13', 500, 'ca7e0000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000001', '2025-12', '2025-12-01');
insert into public.invoices (company_id, number, invoice_date, net_amount, gst_amount, tax_deposited_on, tax_bank_month) values
  ('c0000000-0000-4000-8000-000000000001', 'CK-I1', '2025-11-10', 100, 18, '2025-12-15', null),         -- deposited, unticked
  ('c0000000-0000-4000-8000-000000000001', 'CK-I2', '2025-11-12', 100, 18, '2025-12-16', '2025-12-01'), -- deposited, ticked
  ('c0000000-0000-4000-8000-000000000001', 'CK-I3', '2025-12-03', 100, 18, null, null),                 -- FBR pending
  ('c0000000-0000-4000-8000-000000000001', 'CK-I4', '2025-12-04', 100, 18, '2026-01-05', null),         -- deposited after month end
  ('c0000000-0000-4000-8000-000000000001', 'CK-I5', '2026-01-02', 100, 18, null, null);                 -- dated after month end

-- Everything below runs as an admin, through the API role, so row security applies.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================================================== F-PNL: v_month_pnl
select is((select net_in from public.v_month_pnl where month = '2026-02-01'), 1500.00,
  'F-PNL Feb: net_in = 500.00 (GST order) + 1000.00 (exempt order) = 1500.00');
select is((select gst_in from public.v_month_pnl where month = '2026-02-01'), 90.00, 'F-PNL Feb: gst_in = 90.00 (shown, not revenue)');
select is((select unresolved_gross from public.v_month_pnl where month = '2026-02-01'), 118.00,
  'F-PNL Feb: unresolved_gross = 118.00 (value basis unknown, not in net_in)');
select is((select order_costs from public.v_month_pnl where month = '2026-02-01'), 710.00,
  'F-PNL Feb: order_costs = 510.00 (600 less 90 input tax) + 200.00 = 710.00');
select is((select overheads from public.v_month_pnl where month = '2026-02-01'), 500.00, 'F-PNL Feb: overheads = 400.00 + 100.00 = 500.00');
select is((select result from public.v_month_pnl where month = '2026-02-01'), 290.00,
  'F-PNL Feb: result = 1500.00 - 710.00 - 500.00 = 290.00');
select is((select non_pnl_out from public.v_month_pnl where month = '2026-02-01'), 300.00, 'F-PNL Feb: non_pnl_out (Owner drawings) = 300.00');
select is((select after_drawings from public.v_month_pnl where month = '2026-02-01'), -10.00,
  'F-PNL Feb: after_drawings = 290.00 - 300.00 = -10.00');
select is((select cash_out_total from public.v_month_pnl where month = '2026-02-01'), 1600.00,
  'F-PNL Feb: cash_out_total = sum of amount_pkr = 1600.00');
select is((select input_tax from public.v_month_pnl where month = '2026-02-01'), 90.00, 'F-PNL Feb: input_tax = 90.00');
select is((select net_in from public.v_month_pnl where month = '2026-03-01'), 500.00, 'F-PNL Mar: net_in = 500.00');
select is((select result from public.v_month_pnl where month = '2026-03-01'), 500.00, 'F-PNL Mar: no costs, result = 500.00');
select is((select after_drawings from public.v_month_pnl where month = '2026-03-01'), 500.00, 'F-PNL Mar: after_drawings = 500.00');
select is((select count(*)::int from public.v_month_pnl where month in ('2026-02-01', '2026-03-01')), 2,
  'F-PNL: one row per month');

-- v_month_expense_category (Feb): five categories
select is((select count(*)::int from public.v_month_expense_category where month = '2026-02-01'), 5,
  'F-PNL by category, Feb: five category rows');
select ok((select net_cost = 510.00 and gross_paid = 600.00 and expense_count = 1 and grp = 'order_cost'
           from public.v_month_expense_category where month = '2026-02-01' and category = 'Supplier payment'),
  'F-PNL by category: Supplier payment net 510.00, gross 600.00, 1 expense, order_cost');
select ok((select net_cost = 400.00 and gross_paid = 400.00 and grp = 'overhead'
           from public.v_month_expense_category where month = '2026-02-01' and category = 'Salaries'),
  'F-PNL by category: Salaries 400.00 (overhead)');
select ok((select net_cost = 300.00 and grp = 'non_pnl'
           from public.v_month_expense_category where month = '2026-02-01' and category = 'Owner drawings'),
  'F-PNL by category: Owner drawings 300.00 (non_pnl)');
select is((select sum(net_cost) from public.v_month_expense_category where month = '2026-02-01'), 1510.00,
  'F-PNL by category: net costs add up to 1510.00 (710 + 500 + 300)');

-- ================================================================== F-TEAM: v_month_team
select ok((select net_credited = 500.00 and payment_count = 1 and quarter_target_net = 5000.00
                  and quarter_achieved_net = 1000.00 and quarter_gap = 4000.00
           from public.v_month_team where month = '2026-02-01' and user_id = 'a0000000-0000-4000-8000-000000000002'),
  'F-TEAM Feb, sales: net 500.00 (the unresolved payment is not counted); quarter target 5000.00, achieved 1000.00, gap 4000.00');
select ok((select net_credited = 1000.00 and payment_count = 1 and quarter_target_net is null and quarter_achieved_net = 1000.00
           from public.v_month_team where month = '2026-02-01' and user_id = 'a0000000-0000-4000-8000-000000000001'),
  'F-TEAM Feb, admin: net 1000.00, no target, quarter achieved 1000.00');
select ok((select net_credited = 500.00 and quarter_achieved_net = 1000.00
           from public.v_month_team where month = '2026-03-01' and user_id = 'a0000000-0000-4000-8000-000000000002'),
  'F-TEAM Mar, sales: net 500.00, the quarter total repeats beside it');
select is((select user_name from public.v_month_team where month = '2026-02-01' and user_id = 'a0000000-0000-4000-8000-000000000002'),
  'Test Sales', 'F-TEAM: the user name is shown');

-- ================================================================== F-AGING: aging_as_of
select is((select count(*)::int from public.aging_as_of('2026-09-30')
           where kind = 'invoice' and order_id in ('a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000012')),
  4, 'F-AGING: four invoices owe money (AG-A3, dated after the as-of date, is not listed)');
select ok((select gross = 1180.00 and applied = 500.00 and remaining = 680.00 and age_days = 91 and bucket = '90+'
           from public.aging_as_of('2026-09-30') where invoice_number = 'AG-A1'),
  'F-AGING: AG-A1 (91 days) takes the whole 500.00 payment first-in first-out: owes 680.00 in 90+');
select ok((select applied = 0.00 and remaining = 1180.00 and age_days = 61 and bucket = '61-90'
           from public.aging_as_of('2026-09-30') where invoice_number = 'AG-A2'),
  'F-AGING: AG-A2 (61 days) gets nothing: owes 1180.00 in 61-90');
select ok((select applied = 400.00 and remaining = 190.00 and age_days = 31 and bucket = '31-60'
           from public.aging_as_of('2026-09-30') where invoice_number = 'AG-B1'),
  'F-AGING: AG-B1 (31 days) takes the 400.00 payment: owes 190.00 in 31-60');
select ok((select applied = 0.00 and remaining = 590.00 and age_days = 29 and bucket = '0-30'
           from public.aging_as_of('2026-09-30') where invoice_number = 'AG-B2'),
  'F-AGING: AG-B2 (29 days) owes 590.00 in 0-30');
select is((select array_agg(bucket order by invoice_number) from public.aging_as_of('2026-09-30') where invoice_number like 'AG-E%'),
  array['0-30', '31-60', '61-90'], 'F-AGING: 30, 60 and 90 days old fall in 0-30, 31-60 and 61-90');
select is((select count(*)::int from public.aging_as_of('2026-09-30') where invoice_number = 'AG-A3'), 0,
  'F-AGING: an invoice dated after the as-of date is ignored');
select is((select sum(remaining) from public.aging_as_of('2026-09-30') where order_id = 'a1000000-0000-4000-8000-000000000011'),
  1860.00, 'F-AGING: the payment received after the as-of date (1000.00) is not applied: 680.00 + 1180.00 = 1860.00');
select ok((select advance_held = 300.00 and invoice_id is null and remaining is null and bucket is null
           from public.aging_as_of('2026-09-30') where kind = 'advance' and order_id = 'a1000000-0000-4000-8000-000000000013'),
  'F-AGING: an advance on an uninvoiced order is listed as advance held, with no negative aging');
select is((select count(*)::int from public.aging_as_of('2026-09-30') where kind = 'advance'
             and order_id in ('a1000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000012')), 0,
  'F-AGING: an invoiced order has no advance row');
-- the same orders as of an earlier date
select ok((select count(*) = 1 and bool_and(remaining = 680.00 and age_days = 19 and bucket = '0-30')
           from public.aging_as_of('2026-07-20') where order_id = 'a1000000-0000-4000-8000-000000000011'),
  'F-AGING as of 2026-07-20: only AG-A1 exists yet; the 500.00 payment of 2026-07-15 applies: owes 680.00, 19 days');

-- ================================================================== F-PAYABLES: payables_as_of
select is((select count(*)::int from public.payables_as_of('2026-09-30')
           where order_id in ('a1000000-0000-4000-8000-000000000021', 'a1000000-0000-4000-8000-000000000022')), 7,
  'F-PAYABLES: seven legs (unplaced, placed-later and cancelled-order legs are excluded)');
select ok((select committed = 1000.00 and currency = 'USD' and fx_rate = 280 and committed_pkr = 280000.00
                  and paid_pkr = 100000.00 and owed_pkr = 180000.00 and state = 'owing' and flag is null
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000001'),
  'F-PAYABLES L1: PO latest revision 10 x 100 = 1000.00 USD at the 280 manual rate = 280000.00 PKR, paid 100000.00 (the Freight and the later payment do not count): owed 180000.00');
select ok((select committed_pkr = 290000.00 and paid_pkr = 150000.00 and owed_pkr = 140000.00
           from public.payables_as_of('2026-10-31') where supplier_order_id = 'a2000000-0000-4000-8000-000000000001'),
  'F-PAYABLES L1 as of 2026-10-31: rate 290, paid 150000.00, owed 140000.00');
select ok((select committed = 12500.00 and fx_rate = 1 and committed_pkr = 12500.00 and paid_pkr = 12300.00
                  and owed_pkr = 200.00 and state = 'settled' and flag is null
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000002'),
  'F-PAYABLES L2: no PO, items 2 x 5000 + 1 x 2500 = 12500.00 PKR, paid 12300.00, owed 200.00 is within 3%: settled');
select ok((select owed_pkr = 0.00 and state = 'settled' and flag = 'overpaid'
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000003'),
  'F-PAYABLES L3: paid 10500.00 of 10000.00: owed clamped to 0.00 and flagged overpaid');
select ok((select owed_pkr = 300.00 and state = 'settled'
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000008'),
  'F-PAYABLES L8: owed exactly 3% of committed (300.00 of 10000.00) is settled');
select ok((select owed_pkr = 301.00 and state = 'owing'
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000009'),
  'F-PAYABLES L9: owed 301.00 of 10000.00 is over 3%: owing');
select ok((select state = 'no_rate' and committed = 1000.00 and fx_rate is null and committed_pkr is null and owed_pkr is null
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000006'),
  'F-PAYABLES L6: a EUR leg with no rate says so and invents no figure');
select ok((select state = 'unpriced' and committed is null and owed_pkr is null
           from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000007'),
  'F-PAYABLES L7: a leg with nothing priced is unpriced');
select is((select count(*)::int from public.payables_as_of('2026-09-30')
           where supplier_order_id in ('a2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000005',
                                       'a2000000-0000-4000-8000-000000000010')), 0,
  'F-PAYABLES: the unplaced leg, the leg placed after the date and the leg on a cancelled order are excluded');
select is((select count(*)::int from public.payables_as_of('2026-10-31')
           where supplier_order_id = 'a2000000-0000-4000-8000-000000000005'), 1,
  'F-PAYABLES: the leg placed on 2026-10-03 appears once the as-of date reaches it');
select is((select supplier_name from public.payables_as_of('2026-09-30') where supplier_order_id = 'a2000000-0000-4000-8000-000000000001'),
  'Supplier Alpha', 'F-PAYABLES: the supplier name is shown');

-- ================================================================== F-GST: v_gst_month (admin sees input tax)
select ok((select invoice_count = 3 and net = 3500.00 and gst = 540.00 and psid_set_count = 2 and deposited_count = 1
                  and deposited_amount = 180.00 and gst_to_deposit = 360.00 and input_tax = 150.00
           from public.v_gst_month where month = '2026-04-01'),
  'F-GST April (admin): 3 invoices, net 3500.00, GST 540.00, 2 with a PSID, 1 deposited (180.00), 360.00 still to deposit, input tax 150.00');
select ok((select invoice_count = 0 and net = 0 and gst = 0 and input_tax = 40.00
           from public.v_gst_month where month = '2025-10-01'),
  'F-GST Oct 2025 (admin): a month with input tax and no invoices still shows the input tax');
select is((select count(*)::int from public.v_gst_month where month = '2026-03-01'), 0,
  'F-GST: a month with nothing to report has no row');

-- ================================================================== F-CHECKLIST: month_end_status
select is((select jsonb_object_agg(check_key, n) from public.month_end_status('2025-12-01')),
  '{"bank_unticked": 9, "fbr_deposits_unticked": 1, "uncategorised": 3, "recurring_not_recorded": 2,
    "provisional_margins": 1, "fbr_pending": 1, "unresolved_payments": 2}'::jsonb,
  'F-CHECKLIST December: every warning count is right');
select is((select count(*)::int from public.month_end_status('2025-12-01')), 7, 'F-CHECKLIST: seven checks');
select is((select n from public.month_end_status('2025-12-15') where check_key = 'bank_unticked'), 9,
  'F-CHECKLIST: any day of the month selects the month');
select is((select jsonb_object_agg(check_key, n) from public.month_end_status('2025-11-01')),
  '{"bank_unticked": 1, "fbr_deposits_unticked": 0, "uncategorised": 0, "recurring_not_recorded": 2,
    "provisional_margins": 0, "fbr_pending": 0, "unresolved_payments": 0}'::jsonb,
  'F-CHECKLIST November: unticked items accumulate, the rest are bound to the month');
-- ticking clears the warnings
update public.payments_in set bank_month = '2025-12-01'
where order_id in ('a1000000-0000-4000-8000-000000000031', 'a1000000-0000-4000-8000-000000000035', 'a1000000-0000-4000-8000-000000000036');
update public.invoices set tax_bank_month = '2025-12-01' where number = 'CK-I1';
select is((select n from public.month_end_status('2025-12-01') where check_key = 'bank_unticked'), 6,
  'F-CHECKLIST: ticking three payments leaves the six expenses');
select is((select n from public.month_end_status('2025-12-01') where check_key = 'fbr_deposits_unticked'), 0,
  'F-CHECKLIST: ticking the FBR deposit clears that warning');

-- ================================================================== F-CHECKLIST-DETAILS: month_end_check_details (0064)
select is((select count(*)::int from public.month_end_check_details('2025-12-01')), 7, 'F-CHECKLIST-DETAILS: one row per check');
select is((select ((detail->>'in_n')::int + (detail->>'out_n')::int) from public.month_end_check_details('2025-12-01') where check_key = 'bank_unticked'),
  (select n from public.month_end_status('2025-12-01') where check_key = 'bank_unticked'),
  'F-CHECKLIST-DETAILS: money in and money out add up to the bank count');
select is((select (detail->>'groups')::int from public.month_end_check_details('2025-12-01') where check_key = 'fbr_deposits_unticked'), 1,
  'F-CHECKLIST-DETAILS: the one unticked FBR deposit is one PSID group');
select is((select jsonb_array_length(detail->'names') from public.month_end_check_details('2025-12-01') where check_key = 'recurring_not_recorded'),
  (select n from public.month_end_status('2025-12-01') where check_key = 'recurring_not_recorded'),
  'F-CHECKLIST-DETAILS: the unrecorded recurring templates are named');
select is((select jsonb_array_length(detail->'numbers') from public.month_end_check_details('2025-12-01') where check_key = 'provisional_margins'),
  (select n from public.month_end_status('2025-12-01') where check_key = 'provisional_margins'),
  'F-CHECKLIST-DETAILS: the provisional orders are listed');
select is((select jsonb_array_length(detail->'invoices') from public.month_end_check_details('2025-12-01') where check_key = 'fbr_pending'),
  (select n from public.month_end_status('2025-12-01') where check_key = 'fbr_pending'),
  'F-CHECKLIST-DETAILS: the pending invoices are listed');
select ok((select (detail->>'amount')::numeric > 0 and (detail->'first'->>'order_number') is not null
           from public.month_end_check_details('2025-12-01') where check_key = 'unresolved_payments'),
  'F-CHECKLIST-DETAILS: unresolved payments carry an amount and the order to open');

-- ================================================================== access: sales
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.v_month_pnl), 0, 'sales gets 0 rows from v_month_pnl');
select is((select count(*)::int from public.v_month_expense_category), 0, 'sales gets 0 rows from v_month_expense_category');
select is((select count(*)::int from public.v_month_team), 0, 'sales gets 0 rows from v_month_team');
select is((select count(*)::int from public.aging_as_of('2026-09-30')), 0, 'sales gets 0 rows from aging_as_of');
select is((select count(*)::int from public.payables_as_of('2026-09-30')), 0, 'sales gets 0 rows from payables_as_of');
select is((select count(*)::int from public.month_end_status('2025-12-01')), 0, 'sales gets 0 rows from month_end_status');
select is((select count(*)::int from public.month_end_check_details('2025-12-01')), 0, 'sales gets 0 rows from month_end_check_details');
select ok((select invoice_count = 3 and net = 3500.00 and gst = 540.00 and psid_set_count = 2 and deposited_count = 1
                  and deposited_amount = 180.00 and gst_to_deposit = 360.00
           from public.v_gst_month where month = '2026-04-01'),
  'F-GST April (sales): sales see the same invoice figures');
select ok((select input_tax is null from public.v_gst_month where month = '2026-04-01'),
  'F-GST April (sales): input tax is NULL for sales');
select is((select count(*)::int from public.v_gst_month where input_tax is not null), 0,
  'F-GST (sales): input tax is NULL on every row');
select is((select count(*)::int from public.v_gst_month where month = '2025-10-01'), 0,
  'F-GST (sales): a month that exists only through input tax is not shown to sales');

-- ================================================================== access: engineer and deactivated
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.v_month_pnl), 0, 'engineer gets 0 rows from v_month_pnl');
select is((select count(*)::int from public.v_month_expense_category), 0, 'engineer gets 0 rows from v_month_expense_category');
select is((select count(*)::int from public.v_month_team), 0, 'engineer gets 0 rows from v_month_team');
select is((select count(*)::int from public.v_gst_month), 0, 'engineer gets 0 rows from v_gst_month');
select is((select count(*)::int from public.aging_as_of('2026-09-30')), 0, 'engineer gets 0 rows from aging_as_of');
select is((select count(*)::int from public.payables_as_of('2026-09-30')), 0, 'engineer gets 0 rows from payables_as_of');
select is((select count(*)::int from public.month_end_status('2025-12-01')), 0, 'engineer gets 0 rows from month_end_status');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.v_month_pnl), 0, 'a deactivated user gets 0 rows from v_month_pnl');
select is((select count(*)::int from public.v_month_expense_category), 0, 'a deactivated user gets 0 rows from v_month_expense_category');
select is((select count(*)::int from public.v_month_team), 0, 'a deactivated user gets 0 rows from v_month_team');
select is((select count(*)::int from public.v_gst_month), 0, 'a deactivated user gets 0 rows from v_gst_month');
select is((select count(*)::int from public.aging_as_of('2026-09-30')), 0, 'a deactivated user gets 0 rows from aging_as_of');
select is((select count(*)::int from public.payables_as_of('2026-09-30')), 0, 'a deactivated user gets 0 rows from payables_as_of');
select is((select count(*)::int from public.month_end_status('2025-12-01')), 0, 'a deactivated user gets 0 rows from month_end_status');

-- ================================================================== access: anon
reset role;
set local role anon;
select throws_ok($$select * from public.v_month_pnl$$, '42501', null, 'anon cannot read v_month_pnl');
select throws_ok($$select * from public.v_month_expense_category$$, '42501', null, 'anon cannot read v_month_expense_category');
select throws_ok($$select * from public.v_month_team$$, '42501', null, 'anon cannot read v_month_team');
select throws_ok($$select * from public.v_gst_month$$, '42501', null, 'anon cannot read v_gst_month');
select throws_ok($$select * from public.aging_as_of('2026-09-30')$$, '42501', null, 'anon cannot call aging_as_of');
select throws_ok($$select * from public.payables_as_of('2026-09-30')$$, '42501', null, 'anon cannot call payables_as_of');
select throws_ok($$select * from public.month_end_status('2025-12-01')$$, '42501', null, 'anon cannot call month_end_status');
reset role;

select * from finish();
rollback;
