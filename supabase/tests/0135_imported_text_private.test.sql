begin;
select * from no_plan();

-- 0135 imported text is private: an engineer never reads a price or a supplier name that sits in the old system's free text.
-- Fictional fixtures only (made-up suppliers and items). Personas run as the API runs them (role authenticated with the persona's
-- claims, then qtech_private.pre_request(), which moves an engineer onto qtech_engineer).
--   (a) qtech_private.clean_item_text cases
--   (b) a legacy row written by the import is cleaned by the trigger, the original is in imported_notes
--   (c) what an engineer reads: v_jobs.items_summary, order_items.description, orders.notes, rfqs.notes, imported_notes (refused), history
--   (d) admin and sales read the original; a person's own note on an imported order stays where they typed it
--   (e) the one-time data step (move_imported_text) on rows written WITHOUT the trigger: text moved, audit_log cleaned, idempotent
--   (f) deleting the row drops the stored text

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f7000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       else '00000000-0000-0000-0000-000000000000' end $$;

-- Runs `stmt` as the persona and returns the first column of the first row as text, or 'E:<sqlstate>'. Always rolled back.
create function pg_temp.scalar_as(stmt text, persona text) returns text language plpgsql as $f$
declare
  v text;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    raise exception 'scalar done' using errcode = 'P0999', detail = coalesce(v, '<null>');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end;
$f$;

-- what must never reach an engineer
create function pg_temp.leak(t text) returns boolean language sql immutable as
  $$ select coalesce(t ~* '(\mrs\.?\s*[0-9]|pkr|/unit|@|supplier breakdown|item\s*#|acme components|borealis traders)', false) $$;
-- the same for a JSON answer (history, audit images), where an e-mail address of a person could appear: no "@"
create function pg_temp.leak_json(t text) returns boolean language sql immutable as
  $$ select coalesce(t ~* '(\mrs\.?\s*[0-9]|pkr|/unit|supplier breakdown|item\s*#|acme components|borealis traders)', false) $$;

-- ------------------------------------------------------------------ (a) the cleaner
select is(qtech_private.clean_item_text(
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Traders @ Rs 410/unit • ITEM#32: Fuse 5A ×10 — Acme Components Ltd @ Rs 12/unit'),
  'IC TLC0838C 20PIN SMD ×6 +2 more', '(a) the real-looking sample: first item and +2 more, no supplier, no price');
select is(qtech_private.clean_item_text(
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Trad'),
  'IC TLC0838C 20PIN SMD ×6 +1 more', '(a) the same text cut at 200 characters in the middle of a supplier name');
select is(qtech_private.clean_item_text('Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Some Supplier @ Rs 5/unit'), 'Alpha gauge ×1',
  '(a) one bullet: no +N more');
select is(qtech_private.clean_item_text('Supplier breakdown: • ITEM#1: Alpha gauge ×1 — Some Supplier @ Rs 5/unit • ITEM#2: Beta valve — Other Co @ PKR 9/unit'),
  'Alpha gauge ×1 +1 more', '(a) two bullets: +1 more');
select is(qtech_private.clean_item_text('Gauge x1 — Batch B'), 'Gauge x1 — Batch B', '(a) the import''s own "item — Unit label" text is left alone');
select is(qtech_private.clean_item_text('Wallmount Ultrasonic Flow Meter x1 — Unit A'), 'Wallmount Ultrasonic Flow Meter x1 — Unit A', '(a) plain text is returned as it is');
select is(qtech_private.clean_item_text('RS-485 converter, 2 RS-485 ports'), 'RS-485 converter, 2 RS-485 ports', '(a) RS-485 is not a price');
select is(qtech_private.clean_item_text('Cars and Doors'), 'Cars and Doors', '(a) "rs" inside a word is not a price');
select is(qtech_private.clean_item_text('Pump 5HP @ Rs 300/unit'), 'Pump 5HP', '(a) plain text with an "@ price" tail keeps what comes before');
select is(qtech_private.clean_item_text('Valve — Rs 5000/unit'), 'Valve', '(a) plain text: the part that names a price is dropped');
select is(qtech_private.clean_item_text('Cable 2500 PKR'), 'Imported item', '(a) nothing left once the price is dropped: a neutral placeholder, never the price');
select is(qtech_private.clean_item_text(null), null, '(a) null stays null');
select is(qtech_private.clean_item_text(qtech_private.clean_item_text(
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Traders @ Rs 410/unit')),
  'IC TLC0838C 20PIN SMD ×6 +1 more', '(a) idempotent');
select is(qtech_private.scrub_audit_json('{"notes":"Rs 5/unit","number":3}'::jsonb, 'orders'), '{"number":3}'::jsonb, '(a) audit image of an order: notes removed');
select is(qtech_private.scrub_audit_json('{"description":"Supplier breakdown: • ITEM#1: Alpha — X @ Rs 5/unit","qty":1}'::jsonb, 'order_items'),
  '{"description":"Alpha","qty":1}'::jsonb, '(a) audit image of a line: description cleaned');

-- ------------------------------------------------------------------ (b) rows written by the import (postgres here; the trigger lets the service role, postgres and definer functions through)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Ip Main Traders');

create temp table sample (note text, descr text);
insert into sample values (
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Traders @ Rs 410/unit',
  'Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — Acme Components Ltd @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — Borealis Traders @ Rs 410/unit');

insert into public.rfqs (id, company_id, owner_id, legacy_source, notes)
  select pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '{"imported": true}', note || E'\n---\nQuoted Rs 9,000 to Acme Components Ltd' from sample;
insert into public.rfq_items (id, rfq_id, description, legacy_source)
  select pg_temp.f('11'), pg_temp.f('10'), descr, '{"imported": true}' from sample;
insert into public.orders (id, company_id, owner_id, rfq_id, legacy_source, notes)
  select pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('10'), '{"imported": true}', note from sample;
insert into public.order_items (id, order_id, position, description, unit_price_net, legacy_source)
  select pg_temp.f('21'), pg_temp.f('20'), 0, descr, 100, '{"imported": true}' from sample;
insert into public.order_items (id, order_id, position, description, unit_price_net)   -- a line a person typed on the same order: untouched
  values (pg_temp.f('22'), pg_temp.f('20'), 1, 'Typed by a person: test line', 100);

select is((select notes from public.orders where id = pg_temp.f('20')), null, '(b) the imported order keeps no notes');
select is((select notes from public.rfqs where id = pg_temp.f('10')), null, '(b) the imported RFQ keeps no notes');
select is((select description from public.order_items where id = pg_temp.f('21')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(b) the imported line keeps the cleaned text');
select is((select description from public.rfq_items where id = pg_temp.f('11')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(b) the imported RFQ line keeps the cleaned text');
select is((select description from public.order_items where id = pg_temp.f('22')), 'Typed by a person: test line', '(b) a line without legacy_source is not touched');
select is((select note from public.imported_notes where table_name = 'orders' and row_id = pg_temp.f('20')), (select note from sample), '(b) the order''s original notes are in imported_notes');
select is((select note from public.imported_notes where table_name = 'order_items' and row_id = pg_temp.f('21')), (select descr from sample), '(b) the line''s original description is in imported_notes');
select is((select parent_id from public.imported_notes where table_name = 'order_items' and row_id = pg_temp.f('21')), pg_temp.f('20'), '(b) a line''s stored text points at its order');
select is((select parent_id from public.imported_notes where table_name = 'rfq_items' and row_id = pg_temp.f('11')), pg_temp.f('10'), '(b) an RFQ line''s stored text points at its RFQ');
select ok((select note like '%Quoted Rs 9,000 to Acme Components Ltd' from public.imported_notes where table_name = 'rfqs' and row_id = pg_temp.f('10')),
  '(b) every part of the RFQ''s joined notes is kept');
select is((select count(*)::int from public.imported_notes where row_id in (pg_temp.f('22'))), 0, '(b) nothing stored for a line without legacy_source');
select ok(not exists (select 1 from public.audit_log where record_id in (pg_temp.f('10')::text, pg_temp.f('11')::text, pg_temp.f('20')::text, pg_temp.f('21')::text)
                        and (pg_temp.leak_json(old_value::text) or pg_temp.leak_json(new_value::text))),
  '(b) the audit log of the imported rows never held the text (the trigger runs before the audit trigger)');

-- re-inserting a legacy row (a re-run of the import) is cleaned again, whoever writes
delete from public.order_items where id = pg_temp.f('21');
select is((select count(*)::int from public.imported_notes where table_name = 'order_items' and row_id = pg_temp.f('21')), 0, '(f) deleting a line drops its stored text');
insert into public.order_items (id, order_id, position, description, unit_price_net, legacy_source)
  select pg_temp.f('21'), pg_temp.f('20'), 0, descr, 100, '{"imported": true}' from sample;
select is((select description from public.order_items where id = pg_temp.f('21')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(b) a re-inserted legacy line is cleaned by the trigger');
update public.order_items set description = (select descr from sample) where id = pg_temp.f('21');
select is((select description from public.order_items where id = pg_temp.f('21')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(b) an update that writes the raw text back is cleaned too');
update public.orders set notes = 'Re-import: Acme Components Ltd @ Rs 77/unit' where id = pg_temp.f('20');
select is((select notes from public.orders where id = pg_temp.f('20')), null, '(b) notes written by the import on an update move away');
select is((select note from public.imported_notes where table_name = 'orders' and row_id = pg_temp.f('20')), 'Re-import: Acme Components Ltd @ Rs 77/unit',
  '(b) the stored note is the latest import''s');
update public.orders set notes = (select note from sample) where id = pg_temp.f('20');

-- ------------------------------------------------------------------ (c) what an engineer reads
select ok(not pg_temp.leak(pg_temp.scalar_as(format($q$select items_summary from public.v_jobs where rfq_id = %L$q$, pg_temp.f('10')), 'engineer')),
  '(c) engineer: v_jobs.items_summary has no price or supplier');
select is(pg_temp.scalar_as(format($q$select items_summary from public.v_jobs where rfq_id = %L$q$, pg_temp.f('10')), 'engineer'),
  'IC TLC0838C 20PIN SMD ×6 +1 more +1 more', '(c) engineer: v_jobs.items_summary is the cleaned first line and the count of lines');
select ok(not pg_temp.leak(pg_temp.scalar_as(format($q$select string_agg(description, '|') from public.order_items where order_id = %L$q$, pg_temp.f('20')), 'engineer')),
  '(c) engineer: order_items.description has no price or supplier');
select is(pg_temp.scalar_as(format($q$select coalesce(notes, '<null>') from public.orders where id = %L$q$, pg_temp.f('20')), 'engineer'), '<null>', '(c) engineer: orders.notes is empty on the imported order');
select is(pg_temp.scalar_as(format($q$select coalesce(notes, '<null>') from public.rfqs where id = %L$q$, pg_temp.f('10')), 'engineer'), '<null>', '(c) engineer: rfqs.notes is empty on the imported RFQ');
select ok(not pg_temp.leak(pg_temp.scalar_as(format($q$select string_agg(description, '|') from public.rfq_items where rfq_id = %L$q$, pg_temp.f('10')), 'engineer')),
  '(c) engineer: rfq_items.description has no price or supplier');
select is(pg_temp.scalar_as('select count(*) from public.imported_notes', 'engineer'), 'E:42501', '(c) engineer: imported_notes is refused (42501)');
select is(pg_temp.scalar_as('select note from public.imported_notes limit 1', 'engineer'), 'E:42501', '(c) engineer: no column of imported_notes either');
select is(pg_temp.scalar_as(format($q$insert into public.imported_notes (table_name, row_id, parent_id, note) values ('orders', %L, %L, 'x') returning 'in'$q$, pg_temp.f('2f'), pg_temp.f('2f')), 'engineer'),
  'E:42501', '(c) engineer cannot write imported_notes');
select is(pg_temp.scalar_as(format($q$insert into public.imported_notes (table_name, row_id, parent_id, note) values ('orders', %L, %L, 'x') returning 'in'$q$, pg_temp.f('2f'), pg_temp.f('2f')), 'admin'),
  'E:42501', '(c) nor can an admin through the API');
select ok(not has_table_privilege('qtech_engineer', 'public.imported_notes', 'select'), '(c) qtech_engineer holds no SELECT on imported_notes');
select ok(not has_table_privilege('anon', 'public.imported_notes', 'select'), '(c) anon holds no SELECT on imported_notes');
select ok(not pg_temp.leak_json(pg_temp.scalar_as(format($q$select public.record_history('orders', %L)::text$q$, pg_temp.f('20')), 'engineer')),
  '(c) engineer: record_history of the imported order has no price or supplier');
select ok(not pg_temp.leak_json(pg_temp.scalar_as(format($q$select public.record_history('rfqs', %L)::text$q$, pg_temp.f('10')), 'engineer')),
  '(c) engineer: record_history of the imported RFQ has no price or supplier');

-- ------------------------------------------------------------------ (d) admin and sales read the original
select is(pg_temp.scalar_as(format($q$select note from public.imported_notes where table_name = 'orders' and row_id = %L$q$, pg_temp.f('20')), 'admin'), (select note from sample),
  '(d) admin reads the original notes');
select is(pg_temp.scalar_as(format($q$select note from public.imported_notes where table_name = 'orders' and row_id = %L$q$, pg_temp.f('20')), 'sales'), (select note from sample),
  '(d) sales reads the original notes');
select is(pg_temp.scalar_as(format($q$select count(*) from public.imported_notes where parent_id = %L$q$, pg_temp.f('20')), 'sales'), '2',
  '(d) sales finds the order''s note and its line''s original by the order id');
select is(pg_temp.scalar_as('select count(*) from public.imported_notes', 'deactivated'), '0', '(d) a deactivated person reads nothing');
select is(pg_temp.scalar_as(format($q$update public.orders set notes = 'Gate pass at 3pm' where id = %L returning notes$q$, pg_temp.f('20')), 'sales'), 'Gate pass at 3pm',
  '(d) a note a person types on an imported order stays on the order');

-- ------------------------------------------------------------------ (e) the one-time data step, on rows written without the trigger
alter table public.rfqs disable trigger keep_imported_text;
alter table public.rfq_items disable trigger keep_imported_text;
alter table public.orders disable trigger keep_imported_text;
alter table public.order_items disable trigger keep_imported_text;

insert into public.rfqs (id, company_id, owner_id, legacy_source, notes)
  select pg_temp.f('30'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '{"imported": true}', note from sample;
insert into public.rfq_items (id, rfq_id, description, legacy_source)
  select pg_temp.f('31'), pg_temp.f('30'), descr, '{"imported": true}' from sample;
insert into public.orders (id, company_id, owner_id, legacy_source, notes)
  select pg_temp.f('32'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '{"imported": true}', note from sample;
insert into public.order_items (id, order_id, position, description, unit_price_net, legacy_source)
  select pg_temp.f('33'), pg_temp.f('32'), 0, descr, 100, '{"imported": true}' from sample;
update public.order_items set description = description || ' ' where id = pg_temp.f('33');   -- a second audit row (an update diff) that carries the text
update public.orders set notes = notes || ' (edited)' where id = pg_temp.f('32');

alter table public.rfqs enable trigger keep_imported_text;
alter table public.rfq_items enable trigger keep_imported_text;
alter table public.orders enable trigger keep_imported_text;
alter table public.order_items enable trigger keep_imported_text;

select ok(pg_temp.leak((select notes from public.orders where id = pg_temp.f('32'))), '(e) precondition: the order written without the trigger holds the raw notes');
select ok(exists (select 1 from public.audit_log where record_id in (pg_temp.f('32')::text, pg_temp.f('33')::text)
                    and (pg_temp.leak_json(old_value::text) or pg_temp.leak_json(new_value::text))), '(e) precondition: its audit rows hold the raw text');
create temp table audit_before as
  select count(*)::int as n from public.audit_log
  where record_id in (pg_temp.f('30')::text, pg_temp.f('31')::text, pg_temp.f('32')::text, pg_temp.f('33')::text);

create temp table moved as select qtech_private.move_imported_text() as j;

select ok((select (j ->> 'orders')::int >= 1 and (j ->> 'rfqs')::int >= 1 and (j ->> 'order_items')::int >= 1 and (j ->> 'rfq_items')::int >= 1 from moved),
  '(e) the step reports the rows it moved');
select is((select notes from public.orders where id = pg_temp.f('32')), null, '(e) the order''s notes are gone from the order');
select is((select notes from public.rfqs where id = pg_temp.f('30')), null, '(e) the RFQ''s notes are gone from the RFQ');
select is((select description from public.order_items where id = pg_temp.f('33')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(e) the line is cleaned');
select is((select description from public.rfq_items where id = pg_temp.f('31')), 'IC TLC0838C 20PIN SMD ×6 +1 more', '(e) the RFQ line is cleaned');
select is((select note from public.imported_notes where table_name = 'orders' and row_id = pg_temp.f('32')), (select note from sample) || ' (edited)', '(e) the original notes are kept whole');
select is((select note from public.imported_notes where table_name = 'order_items' and row_id = pg_temp.f('33')), (select descr from sample) || ' ', '(e) the original description is kept whole');
select ok(not exists (select 1 from public.audit_log where record_id in (pg_temp.f('30')::text, pg_temp.f('31')::text, pg_temp.f('32')::text, pg_temp.f('33')::text)
                        and (pg_temp.leak_json(old_value::text) or pg_temp.leak_json(new_value::text))),
  '(e) no audit row of the moved rows holds a price or a supplier (insert images and update diffs)');
select is((select count(*)::int from public.audit_log where record_id in (pg_temp.f('30')::text, pg_temp.f('31')::text, pg_temp.f('32')::text, pg_temp.f('33')::text)),
  (select n from audit_before), '(e) the step writes no history row of its own and removes none');
select ok(not pg_temp.leak_json(pg_temp.scalar_as(format($q$select public.record_history('orders', %L)::text$q$, pg_temp.f('32')), 'engineer')),
  '(e) engineer: record_history of the moved order has no price or supplier');
select ok(not pg_temp.leak_json(pg_temp.scalar_as(format($q$select public.record_history('rfqs', %L)::text$q$, pg_temp.f('30')), 'engineer')),
  '(e) engineer: record_history of the moved RFQ has no price or supplier');
select is((select count(*)::int from pg_trigger t
           where t.tgname in ('orders_audit', 'order_items_audit', 'rfqs_audit', 'rfq_items_audit', 'orders_set_updated_at', 'rfqs_set_updated_at',
                              'orders_clear_until_change', 'rfqs_clear_until_change', 'order_items_credit_guard', 'keep_imported_text')
             and t.tgenabled <> 'O'), 0,
  '(e) every trigger the step switched off is on again');
select is((select (j ->> 'orders')::int + (j ->> 'rfqs')::int + (j ->> 'order_items')::int + (j ->> 'rfq_items')::int + (j ->> 'audit_rows')::int
           from (select qtech_private.move_imported_text() as j) x), 0, '(e) a second run finds nothing to do');

-- ------------------------------------------------------------------ (f) deleting the row drops the stored text
delete from public.orders where id = pg_temp.f('32');
select is((select count(*)::int from public.imported_notes where row_id in (pg_temp.f('32'), pg_temp.f('33'))), 0, '(f) deleting an order drops its stored text and its lines''');
select is((select count(*)::int from public.imported_notes where row_id = pg_temp.f('20')), 1, '(f) other orders keep theirs');

select * from finish();
rollback;
