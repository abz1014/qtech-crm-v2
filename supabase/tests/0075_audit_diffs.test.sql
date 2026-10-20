begin;
select * from no_plan();

-- 0075: audit_log growth. Updates are stored as their changes only, a no-op update writes nothing, every version of a row can
-- still be rebuilt, and old work-flow rows can be moved to a compressed archive without losing a byte of history; money rows
-- never move. The size of an update event is measured with the old trigger and the new one on the same workload (the figures
-- are printed in the test descriptions).

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ structure and access
select ok(exists (select 1 from pg_namespace where nspname = 'audit_archive'), 'schema audit_archive exists');
select ok(not (has_schema_privilege('anon', 'audit_archive', 'usage') or has_schema_privilege('authenticated', 'audit_archive', 'usage')
               or has_schema_privilege('service_role', 'audit_archive', 'usage')),
  'no API role can even reach the audit_archive schema');
select ok(not (has_table_privilege('authenticated', 'audit_archive.audit_log_months', 'select')
               or has_table_privilege('service_role', 'audit_archive.audit_log_months', 'select')
               or has_table_privilege('anon', 'audit_archive.audit_log_months', 'select')),
  'the archive table is granted to no API role');
select ok(not (has_function_privilege('authenticated', 'audit_archive.compact(integer)', 'execute')
               or has_function_privilege('service_role', 'audit_archive.compact(integer)', 'execute')
               or has_function_privilege('anon', 'audit_archive.compact(integer)', 'execute')),
  'compact() is executable by no API role (pg_cron and the owner only)');
select ok((select prosecdef and array_to_string(proconfig, ',') like 'search_path=%' from pg_proc where oid = 'audit_archive.compact(integer)'::regprocedure),
  'compact() is SECURITY DEFINER with an empty search_path');
select ok(not (has_table_privilege('service_role', 'public.audit_log', 'delete') or has_table_privilege('authenticated', 'public.audit_log', 'delete')
               or has_table_privilege('service_role', 'public.audit_log', 'update')),
  'audit_log itself is still append-only for every API role');
select ok(not ('invoices' = any (audit_archive.archivable_tables()) or 'payments_in' = any (audit_archive.archivable_tables())
               or 'expenses' = any (audit_archive.archivable_tables()) or 'orders' = any (audit_archive.archivable_tables())
               or 'order_costs' = any (audit_archive.archivable_tables()) or 'closed_months' = any (audit_archive.archivable_tables())
               or 'quotations' = any (audit_archive.archivable_tables()) or 'purchase_orders' = any (audit_archive.archivable_tables())
               or 'rfq_items' = any (audit_archive.archivable_tables()) or 'supplier_quote_lines' = any (audit_archive.archivable_tables())),
  'no money table can ever be archived');
select ok((select bool_and(exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                                   where c.relnamespace = 'public'::regnamespace and c.relname = t
                                     and tg.tgfoid = 'public.audit_row_change()'::regprocedure))
           from unnest(audit_archive.archivable_tables()) t),
  'every archivable table name is an audited table (no typo)');

-- ------------------------------------------------------------------ updates are diffs; no-op updates write nothing
insert into public.companies (id, name) values ('cd000000-0000-4000-8000-000000000001', 'Diff Co');
select is((select new_value ->> 'name' from public.audit_log where record_id = 'cd000000-0000-4000-8000-000000000001' and action = 'insert'),
  'Diff Co', 'insert still stores the full new row');
select ok((select new_value ? 'created_at' and new_value ? 'legacy_flags' from public.audit_log
           where record_id = 'cd000000-0000-4000-8000-000000000001' and action = 'insert'),
  'every column is in the insert image');

update public.companies set country = 'PK', notes = 'first note' where id = 'cd000000-0000-4000-8000-000000000001';
select is((select old_value from public.audit_log where record_id = 'cd000000-0000-4000-8000-000000000001' and action = 'update'),
  '{"country": null, "notes": null}'::jsonb, 'update old_value holds the old value of the changed columns only');
select is((select new_value from public.audit_log where record_id = 'cd000000-0000-4000-8000-000000000001' and action = 'update'),
  '{"country": "PK", "notes": "first note"}'::jsonb, 'update new_value holds their new values only (updated_at left out)');
select is((select changed_by from public.audit_log where record_id = 'cd000000-0000-4000-8000-000000000001' and action = 'update'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'who changed it is kept');

update public.companies set name = name, country = country where id = 'cd000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.audit_log where record_id = 'cd000000-0000-4000-8000-000000000001'), 2,
  'a no-op update writes no audit row');

-- money: a payment's amount and a bank tick
insert into public.orders (id, company_id, owner_id) values
  ('ad000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.payments_in (id, order_id, amount, received_on) values
  ('ad100000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 1000, public.today_pkt());
update public.payments_in set amount = 1180 where id = 'ad100000-0000-4000-8000-000000000001';
update public.payments_in set bank_month = date_trunc('month', public.today_pkt())::date where id = 'ad100000-0000-4000-8000-000000000001';
select is((select array_agg(old_value::text || ' -> ' || new_value::text order by new_value::text)
           from public.audit_log where record_id = 'ad100000-0000-4000-8000-000000000001' and action = 'update'),
  array['{"amount": 1000.00} -> {"amount": 1180.00}',
        '{"bank_month": null} -> {"bank_month": "' || date_trunc('month', public.today_pkt())::date || '"}'],
  'money: who changed a payment, from what to what, and the bank tick, are each one small row');

-- every version can be rebuilt: the insert image, then each update's new_value (distinct columns here, so any order)
update public.orders set notes = 'call first' where id = 'ad000000-0000-4000-8000-000000000001';
update public.orders set payment_terms_days = 45 where id = 'ad000000-0000-4000-8000-000000000001';
update public.orders set customer_po_number = 'PO-77', commissioning_planned_on = public.today_pkt() + 5
where id = 'ad000000-0000-4000-8000-000000000001';
select is(
  (select (select new_value from public.audit_log where record_id = 'ad000000-0000-4000-8000-000000000001' and action = 'insert')
          || coalesce((select jsonb_object_agg(e.key, e.value)
                       from public.audit_log a cross join lateral jsonb_each(a.new_value) e
                       where a.record_id = 'ad000000-0000-4000-8000-000000000001' and a.action = 'update'), '{}'::jsonb)) - 'updated_at',
  (select to_jsonb(o) - 'updated_at' from public.orders o where o.id = 'ad000000-0000-4000-8000-000000000001'),
  'lossless: insert image plus the diffs rebuild the current row exactly');

delete from public.payments_in where id = 'ad100000-0000-4000-8000-000000000001';
select is((select old_value ->> 'amount' from public.audit_log where record_id = 'ad100000-0000-4000-8000-000000000001' and action = 'delete'),
  '1180.00', 'delete still stores the full old row');

-- ------------------------------------------------------------------ size: the same workload under the old and the new trigger
-- 40 rows in two identical sets. Set A runs under the pre-0075 trigger (re-created here, rolled back with the test), set B under
-- the current one. Workload per row: a chase on an enquiry, a TCS stamp and a bank tick on an invoice, a note on an order, a PDF
-- attached to a quotation and to a PO (their lines are the big part of the row), and one no-op update of each.
insert into public.companies (id, name) values ('cd000000-0000-4000-8000-000000000002', 'Size supplier');
insert into public.rfqs (id, company_id, owner_id)
select ('cd100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'cd000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'
from generate_series(1, 40) g;
insert into public.rfq_items (rfq_id, description, qty)
select ('cd100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'Size item ' || p || ' LF24-SR actuator with a fairly long description', 1
from generate_series(1, 40) g, generate_series(1, 6) p;
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on)
select ('cd200000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('cd100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'cd000000-0000-4000-8000-000000000002', public.today_pkt() - 3
from generate_series(1, 40) g;
insert into public.orders (id, company_id, owner_id)
select ('cd300000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'cd000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'
from generate_series(1, 40) g;
insert into public.invoices (id, order_id, number, net_amount, gst_amount)
select ('cd400000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('cd300000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'SZ-' || g, 1000, 180
from generate_series(1, 40) g;
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines)
select ('cd500000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('cd100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       50000 + g, 0, public.today_pkt() + 30,
       (select jsonb_agg(jsonb_build_object('rfq_item_id', i.id, 'description', i.description, 'qty', 1, 'unit', 'pcs',
                                            'unit_price_net', 1000, 'gst_rate', 18, 'lead_time', '4-6 weeks'))
        from public.rfq_items i where i.rfq_id = ('cd100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid)
from generate_series(1, 40) g;
insert into public.supplier_orders (id, order_id, supplier_id, currency)
select ('cd600000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('cd300000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'cd000000-0000-4000-8000-000000000002', 'USD'
from generate_series(1, 40) g;
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines)
select ('cd700000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, ('cd600000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       60000 + g, 0, 'USD', 0,
       (select jsonb_agg(jsonb_build_object('order_item_id', gen_random_uuid(), 'description', 'PO line ' || p || ' LF24-SR actuator with a fairly long description',
                                            'qty', 2, 'unit', 'pcs', 'unit_price', 120, 'price_source', 'quote'))
        from generate_series(1, 6) p)
from generate_series(1, 40) g;
insert into storage.objects (bucket_id, name)
select 'generated-docs', 'size/' || g || '.pdf' from generate_series(1, 40) g;

create function pg_temp.workload(lo integer, hi integer) returns void language plpgsql as $f$
begin
  update public.supplier_inquiries set last_chased_on = public.today_pkt(), chase_count = chase_count + 1
  where id in (select ('cd200000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.invoices set tcs_sent_on = public.today_pkt()
  where id in (select ('cd400000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.invoices set tax_deposited_on = public.today_pkt()
  where id in (select ('cd400000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.orders set notes = 'Customer asked for delivery before Friday'
  where id in (select ('cd300000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.quotations set pdf_path = 'size/' || substr(id::text, 31) || '.pdf'
  where id in (select ('cd500000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.purchase_orders set pdf_path = 'size/' || substr(id::text, 31) || '.pdf'
  where id in (select ('cd700000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  -- no-op updates (a save that changes nothing)
  update public.orders set notes = notes
  where id in (select ('cd300000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
  update public.invoices set number = number
  where id in (select ('cd400000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(lo, hi) g);
end
$f$;


-- The current (0075) trigger is kept as text so it can be put back after set A ran under the old one.
create temp table saved_fn as select pg_get_functiondef('public.audit_row_change()'::regprocedure) as def;

-- the pre-0075 trigger body (0013), for set A
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   jsonb;
  rid text;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  if tg_nargs = 0 then
    rid := r ->> 'id';
  elsif tg_nargs = 1 then
    rid := r ->> tg_argv[0];
  else
    select jsonb_object_agg(k, r -> k)::text into rid from unnest(tg_argv) as k;
  end if;
  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'delete', auth.uid(), to_jsonb(old), null);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'insert', auth.uid(), null, to_jsonb(new));
    return new;
  end if;
end;
$$;
create temp table seen as select id from public.audit_log;
select pg_temp.workload(1, 20);
create temp table rows_a as select a.id from public.audit_log a where not exists (select 1 from seen s where s.id = a.id);

-- the 0075 trigger again, for set B
do $$ begin execute (select def from saved_fn); end $$;
select ok((select pg_get_functiondef('public.audit_row_change()'::regprocedure) = def from saved_fn), 'the 0075 trigger is back for set B');
insert into seen select id from rows_a;
select pg_temp.workload(21, 40);
create temp table rows_b as select a.id from public.audit_log a where not exists (select 1 from seen s where s.id = a.id);

-- Bytes stored per event: the two jsonb images plus the key columns, plus about 64 bytes of row header and fixed columns.
create temp table size_report as
select x.label, count(*)::int as events,
       sum(pg_column_size(a.old_value) + pg_column_size(a.new_value) + pg_column_size(a.record_id) + pg_column_size(a.table_name) + 64)::bigint as bytes
from (select 'old' as label, id from rows_a union all select 'new', id from rows_b) x
join public.audit_log a on a.id = x.id
group by x.label;

select is((select events from size_report where label = 'old'), 160,
  'the old trigger wrote 160 rows for 20 rows of workload (6 real updates and 2 no-op updates each)');
select is((select events from size_report where label = 'new'), 120,
  'the new trigger writes 120: the 40 no-op updates write nothing');
select cmp_ok((select bytes from size_report where label = 'new') * 3, '<', (select bytes from size_report where label = 'old'),
  format('the same workload stores at least 3x fewer bytes: old %s bytes (%s per event), new %s bytes (%s per event)',
         (select bytes from size_report where label = 'old'),
         (select bytes / events from size_report where label = 'old'),
         (select bytes from size_report where label = 'new'),
         (select bytes / events from size_report where label = 'new')));
select pass(format('measured per update event: quotation PDF attached old %s / new %s bytes; PO PDF attached old %s / new %s; enquiry chase old %s / new %s; invoice stamp old %s / new %s',
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_a) and a.table_name = 'quotations'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_b) and a.table_name = 'quotations'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_a) and a.table_name = 'purchase_orders'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_b) and a.table_name = 'purchase_orders'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_a) and a.table_name = 'supplier_inquiries'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_b) and a.table_name = 'supplier_inquiries'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_a) and a.table_name = 'invoices' and a.new_value ? 'tcs_sent_on'),
  (select avg(pg_column_size(a.old_value) + pg_column_size(a.new_value))::int from public.audit_log a where a.id in (select id from rows_b) and a.table_name = 'invoices' and a.new_value ? 'tcs_sent_on')));

-- ------------------------------------------------------------------ the archive: lossless, money never moves
-- Synthetic history, written as the table owner: 300 snooze events and 200 enquiry events from 2-3 years ago (archivable),
-- 50 snooze events from 6 months ago (too recent), 100 invoice events from 30 months ago (money: never archived).
insert into public.audit_log (table_name, record_id, action, changed_by, changed_at, old_value, new_value)
select 'snoozes', gen_random_uuid()::text, (array['insert', 'update', 'delete'])[1 + g % 3], 'a0000000-0000-4000-8000-000000000002',
       date_trunc('month', now()) - interval '30 months' + make_interval(hours => 6 + g),
       case when g % 3 > 0 then jsonb_build_object('until_on', '2024-01-01', 'rule', 'chase_supplier') end,
       case when g % 3 < 2 then jsonb_build_object('until_on', '2024-01-0' || (1 + g % 9), 'rule', 'chase_supplier', 'subject_id', gen_random_uuid()) end
from generate_series(1, 300) g;
insert into public.audit_log (table_name, record_id, action, changed_by, changed_at, old_value, new_value)
select 'supplier_inquiries', gen_random_uuid()::text, 'update', null,
       date_trunc('month', now()) - interval '27 months' + make_interval(hours => 6 + g),
       jsonb_build_object('chase_count', g % 4, 'last_chased_on', null), jsonb_build_object('chase_count', 1 + g % 4, 'last_chased_on', '2024-07-02')
from generate_series(1, 200) g;
insert into public.audit_log (table_name, record_id, action, changed_by, changed_at, old_value, new_value)
select 'snoozes', gen_random_uuid()::text, 'insert', 'a0000000-0000-4000-8000-000000000003',
       now() - interval '6 months', null, jsonb_build_object('rule', 'r')
from generate_series(1, 50) g;
insert into public.audit_log (table_name, record_id, action, changed_by, changed_at, old_value, new_value)
select 'invoices', gen_random_uuid()::text, 'update', 'a0000000-0000-4000-8000-000000000001',
       date_trunc('month', now()) - interval '30 months' + make_interval(hours => 6 + g),
       jsonb_build_object('tcs_sent_on', null), jsonb_build_object('tcs_sent_on', '2024-04-05')
from generate_series(1, 100) g;

create temp table to_move as
select a.* from public.audit_log a
where a.table_name = any (audit_archive.archivable_tables())
  and a.changed_at < (date_trunc('month', now() at time zone 'Asia/Karachi') - interval '24 months') at time zone 'Asia/Karachi';
create temp table counts_before as
select (select count(*) from audit_archive.audit_log_all) as all_rows,
       (select count(*) from public.audit_log where table_name = 'invoices') as invoice_rows;

select is((select count(*)::int from to_move), 500, 'setup: 500 archivable events are older than 24 months');
select is(audit_archive.compact(), 500, 'compact() moves exactly those 500 events');
select is((select count(*)::int from public.audit_log a where a.id in (select id from to_move)), 0, 'they are no longer in audit_log');
select is((select count(*)::int from public.audit_log where table_name = 'invoices'), (select invoice_rows::int from counts_before),
  'money: every invoice event stays in audit_log, however old');
select is((select count(*)::int from public.audit_log where table_name = 'snoozes' and changed_at > now() - interval '7 months'), 50,
  'events newer than 24 months stay in audit_log');
select bag_eq(
  $$select id, table_name, record_id, action, changed_by, changed_at, old_value, new_value from audit_archive.audit_log_all where archived$$,
  $$select id, table_name, record_id, action, changed_by, changed_at, old_value, new_value from to_move$$,
  'lossless: every moved event comes back from the archive with every column equal');
select is((select count(*) from audit_archive.audit_log_all), (select all_rows from counts_before),
  'audit_log_all shows exactly as many events as before');
select is(audit_archive.compact(), 0, 'running it again moves nothing');
select is((select sum(row_count)::int from audit_archive.audit_log_months), 500, 'the archive counts 500 events');
select throws_ok($$select audit_archive.compact(6)$$, '22023', null, 'fewer than 12 months live is refused');
select cmp_ok((select sum(pg_column_size(m.rows))::bigint from audit_archive.audit_log_months m), '<',
              (select sum(pg_column_size(to_jsonb(t)))::bigint from to_move t),
  format('the archive is compressed: %s bytes for events that took %s bytes as rows',
         (select sum(pg_column_size(m.rows)) from audit_archive.audit_log_months m),
         (select sum(pg_column_size(to_jsonb(t))) from to_move t)));

select * from finish();
rollback;
