-- 0089_imported_months_locked (owner decision 2026-10-22, redesign decision 5: months lock one at a time; months before
-- go-live are locked as Imported).
--   (a) qtech_private.lock_imported_months(through) closes the earliest money month through `through`, oldest first, with
--       snapshots and the note 'Imported'; it does nothing without imported money rows, and is idempotent. The next month
--       after the range then closes with close_month (one month, as the app does).
--   (b) the qtech.legacy_link allowance: only invoices.order_id of an IMPORTED invoice may change in a closed month.
-- The fixture months are January to May 2019 (nothing else in the test database is dated then).
begin;
select * from no_plan();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- the migration itself did nothing here: the test database has no imported money
select is((select count(*)::int from public.closed_months where note = 'Imported'), 0, 'on a database with no imported data the migration locked nothing');

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000890', 'Imported months customer');
insert into public.orders (id, company_id) values
  ('a1000000-0000-4000-8000-000000000891', 'c0000000-0000-4000-8000-000000000890'),   -- the order an imported invoice is linked to
  ('a1000000-0000-4000-8000-000000000892', 'c0000000-0000-4000-8000-000000000890');   -- money of the new system

-- money that is not imported only: still nothing to lock
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000892', '2019-02-10', 500);
select is(qtech_private.lock_imported_months('2019-04-01'), 0, 'no imported money rows: nothing is locked');
select is((select count(*)::int from public.closed_months where month between '2019-01-01' and '2019-12-01'), 0, 'and no month is closed');

-- the imported history: an imported payment in January, an imported invoice (no order) in March
insert into public.payments_in (order_id, received_on, amount, legacy_source) values
  ('a1000000-0000-4000-8000-000000000892', '2019-01-15', 1000, '{"sheet":"payments","row":1}');
insert into public.invoices (id, company_id, number, invoice_date, net_amount, gst_amount, legacy_source) values
  ('b0000000-0000-4000-8000-000000000893', 'c0000000-0000-4000-8000-000000000890', 'IMP-0089-1', '2019-03-05', 1000, 180, '{"sheet":"gst","row":7}');
-- a new-system invoice in February (on an order), for the "non-imported row" case
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  ('b0000000-0000-4000-8000-000000000894', 'a1000000-0000-4000-8000-000000000892', 'NEW-0089-1', '2019-02-05', 500, 90);
-- next month's money, after the imported range
insert into public.payments_in (order_id, received_on, amount) values ('a1000000-0000-4000-8000-000000000892', '2019-05-10', 200);

-- ------------------------------------------------------------------ (a) lock January to April 2019
select throws_ok($$select qtech_private.lock_imported_months(date_trunc('month', public.today_pkt())::date)$$, 'P0001', null,
  'the current month cannot be locked as Imported');
select is(qtech_private.lock_imported_months('2019-04-01'), 4, 'January to April 2019 are locked: four months, from the earliest money month');
select is((select array_agg(month::text order by month) from public.closed_months where month between '2019-01-01' and '2019-12-01'),
  array['2019-01-01', '2019-02-01', '2019-03-01', '2019-04-01'], 'oldest first, through the given month, and not May');
select ok((select bool_and(note = 'Imported' and closed_by = 'a0000000-0000-4000-8000-000000000001') from public.closed_months where month between '2019-01-01' and '2019-04-01'),
  'each with the note Imported, closed by the first active admin');
select is((select count(*)::int from public.month_snapshots where month between '2019-01-01' and '2019-04-01'), 4, 'each with its snapshot');
select is((select (payments ->> 'count')::int from public.month_snapshots where month = '2019-01-01'), 1,
  'the snapshot holds the figures (read as the admin, not zeros)');
select is(current_setting('request.jwt.claims', true), '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  'the caller''s claims are put back');
select is(qtech_private.lock_imported_months('2019-04-01'), 0, 'idempotent: running it again closes nothing');

select ok(not has_function_privilege('authenticated', 'qtech_private.lock_imported_months(date)', 'execute')
      and not has_function_privilege('anon', 'qtech_private.lock_imported_months(date)', 'execute')
      and not has_function_privilege('service_role', 'qtech_private.lock_imported_months(date)', 'execute'),
  'nobody but the owner may run lock_imported_months');

-- the next month after the imported range closes on its own (one month, close_month, as the app does)
select lives_ok($$select public.close_month('2019-05-01')$$, 'May 2019, the month after the imported range, closes with close_month');
select ok(exists (select 1 from public.closed_months where month = '2019-05-01' and note is null), 'May 2019 is closed (not marked Imported)');

-- a later month is closed now, so locking again does nothing
select is(qtech_private.lock_imported_months('2019-03-01'), 0, 'with a later month closed, nothing more is locked');

-- ------------------------------------------------------------------ (b) the qtech.legacy_link allowance
-- without the allowance: linking the imported March invoice to an order is refused
select throws_ok($$update public.invoices set order_id = 'a1000000-0000-4000-8000-000000000891' where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'without the allowance, linking an imported invoice in a closed month is refused');

-- with it: order_id alone changes
select set_config('qtech.legacy_link', 'on', true);
select lives_ok($$update public.invoices set order_id = 'a1000000-0000-4000-8000-000000000891' where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'with the allowance, an imported invoice in a closed month is linked to an order');
select is((select order_id from public.invoices where id = 'b0000000-0000-4000-8000-000000000893'), 'a1000000-0000-4000-8000-000000000891'::uuid,
  'the link is saved');

-- with it, any other change is still refused
select throws_ok($$update public.invoices set net_amount = 999 where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'with the allowance, the amount of an imported invoice is still locked');
select throws_ok($$update public.invoices set order_id = null, number = 'IMP-0089-X' where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'with the allowance, order_id together with another column is refused');
select throws_ok($$update public.invoices set psid = 'PSID-0089' where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'with the allowance, even a filing column of the imported invoice is refused');
select throws_ok($$update public.invoices set invoice_date = '2019-06-05' where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'with the allowance, moving the imported invoice out of the closed month is refused');

-- with it, a non-imported invoice is not covered
select throws_ok($$update public.invoices set order_id = 'a1000000-0000-4000-8000-000000000891' where id = 'b0000000-0000-4000-8000-000000000894'$$,
  'P0001', 'February 2019 is closed. An admin can reopen it.', 'with the allowance, a non-imported invoice in a closed month is still locked');
select set_config('qtech.legacy_link', 'off', true);

-- off again: refused as before
select throws_ok($$update public.invoices set order_id = null where id = 'b0000000-0000-4000-8000-000000000893'$$,
  'P0001', 'March 2019 is closed. An admin can reopen it.', 'with the allowance off again, the link cannot be changed');

-- months still reopen newest first (0080)
select throws_ok($$select public.reopen_month('2019-04-01')$$, 'P0001', null, 'an imported month cannot be reopened while a later one is closed');

select * from finish();
rollback;
