begin;
select * from no_plan();

-- 0074 part A and B: the role check runs once per statement, and nothing anyone can see changes.
--   1. Structure: no policy (public, and the qtech_ storage policies) and no public view calls current_user_role() or auth.uid()
--      outside the (select ...) wrapper. This also holds any LATER migration to the wrapped form.
--   2. Plan: a policy check shows up as an InitPlan (evaluated once), not as a per-row call.
--   3. Same rows: every table and view in public, plus storage.objects, is read as admin, sales, engineer, a deactivated user
--      and anon, and fingerprinted (md5 of every visible row, and the count). Then, inside this transaction, every policy and
--      view is put back to the unwrapped text (exactly what it was before 0074) and everything is read again. Every
--      fingerprint must be identical. Writes are covered by the S14 matrix (0025_access_matrix.test.sql), unchanged.

-- Text helpers, as in the migration. The deparse runs with an empty search_path, so names are schema-qualified.
create function pg_temp.rls_unwrap(t text) returns text language sql immutable as $f$
  select regexp_replace(
           regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)\s+AS\s+current_user_role\s*\)', 'public.current_user_role()', 'gi'),
           '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', 'auth.uid()', 'gi')
$f$;
create function pg_temp.rls_has_bare(t text) returns boolean language sql immutable as $f$
  select coalesce(
    regexp_replace(
      regexp_replace(t, '\(\s*SELECT\s+public\.current_user_role\(\)\s+AS\s+current_user_role\s*\)', '', 'gi'),
      '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi')
    ~ '(public\.current_user_role\(\)|auth\.uid\(\))', false)
$f$;
create function pg_temp.rls_has_wrapped(t text) returns boolean language sql immutable as $f$
  select coalesce(t ~* '\(\s*SELECT\s+(public\.current_user_role\(\)\s+AS\s+current_user_role|auth\.uid\(\)\s+AS\s+uid)\s*\)', false)
$f$;

-- the policies and views in scope, with their text as pg_dump would print it
create function pg_temp.scope_policies()
returns table (poid oid, sch text, tbl text, pname text, qual text, wcheck text)
language sql stable set search_path = '' as $f$
  select pol.oid, n.nspname::text, c.relname::text, pol.polname::text,
         pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
  from pg_catalog.pg_policy pol
  join pg_catalog.pg_class c on c.oid = pol.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects' and pol.polname like 'qtech\_%')
$f$;
create function pg_temp.scope_views()
returns table (void oid, vname text, opts text[], def text)
language sql stable set search_path = '' as $f$
  select c.oid, c.relname::text, c.reloptions, pg_catalog.pg_get_viewdef(c.oid)
  from pg_catalog.pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
$f$;

-- Puts every policy and view back to its pre-0074 text (the wrapper removed). Returns how many objects it changed.
create function pg_temp.unwrap_everything() returns integer language plpgsql set search_path = '' as $f$
declare
  p record;
  v record;
  s text;
  n integer := 0;
begin
  for p in select * from pg_temp.scope_policies() loop
    if not (coalesce(pg_temp.rls_has_wrapped(p.qual), false) or coalesce(pg_temp.rls_has_wrapped(p.wcheck), false)) then
      continue;
    end if;
    s := format('alter policy %I on %I.%I', p.pname, p.sch, p.tbl);
    if p.qual is not null then s := s || format(' using (%s)', pg_temp.rls_unwrap(p.qual)); end if;
    if p.wcheck is not null then s := s || format(' with check (%s)', pg_temp.rls_unwrap(p.wcheck)); end if;
    execute s;
    n := n + 1;
  end loop;
  for v in select * from pg_temp.scope_views() loop
    if not pg_temp.rls_has_wrapped(v.def) then
      continue;
    end if;
    execute format('create or replace view public.%I%s as %s', v.vname,
                   case when v.opts is null then '' else format(' with (%s)', array_to_string(v.opts, ', ')) end,
                   pg_temp.rls_unwrap(regexp_replace(v.def, ';\s*$', '')));
    n := n + 1;
  end loop;
  return n;
end
$f$;

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       when 'deactivated' then 'a0000000-0000-4000-8000-000000000004'
       else '00000000-0000-0000-0000-000000000000' end $$;

-- One fingerprint per (persona, relation): md5 of the visible rows in a fixed order, and the row count; or the error code.
create temp table fp (state text, persona text, rel text, fp text);
create function pg_temp.fingerprint_all(p_state text) returns integer language plpgsql as $f$
declare
  per text;
  rel text;
  v   text;
  n   integer := 0;
begin
  for per in select unnest(array['admin', 'sales', 'engineer', 'deactivated', 'anon']) loop
    for rel in
      select 'public.' || quote_ident(c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
      union all select 'storage.objects'
      order by 1
    loop
      begin
        if per = 'anon' then
          perform set_config('request.jwt.claims', '', true);
          set local role anon;
        else
          perform set_config('request.jwt.claims',
            json_build_object('sub', pg_temp.uid(per), 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        execute format('select count(*) || '':'' || md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) from %s t', rel)
          into v;
        raise exception 'done' using errcode = 'P0999', detail = v;   -- roll the role back
      exception
        when sqlstate 'P0999' then
          get stacked diagnostics v = pg_exception_detail;
        when others then
          v := 'ERR ' || sqlstate;
      end;
      insert into fp values (p_state, per, rel, v);
      n := n + 1;
    end loop;
  end loop;
  return n;
end
$f$;

-- ------------------------------------------------------------------ fixture: the S14 matrix fixture (0025), one row or more per table
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f0000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- ------------------------------------------------------------------ fixtures (as the table owner, admin claims)
-- Row ids are written in hex and appear in the probes as @NN (same two hex digits).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  (pg_temp.f('01'), 'M Main'), (pg_temp.f('02'), 'M Leaf'), (pg_temp.f('03'), 'M Supplier'),
  (pg_temp.f('04'), 'M Supplier 2'), (pg_temp.f('05'), 'M Supplier 3');
insert into public.company_sites (id, company_id, name) values
  (pg_temp.f('10'), pg_temp.f('01'), 'Main site'), (pg_temp.f('11'), pg_temp.f('01'), 'Leaf site');
insert into public.contacts (id, company_id, name) values (pg_temp.f('12'), pg_temp.f('01'), 'Contact');
insert into public.brands (id, name) values (pg_temp.f('13'), 'M Brand'), (pg_temp.f('14'), 'M Brand leaf');
insert into public.company_brands (company_id, brand_id) values (pg_temp.f('01'), pg_temp.f('13'));
insert into public.rfqs (id, company_id, owner_id) values
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, brand_id, quoted_unit_price_net) values
  (pg_temp.f('17'), pg_temp.f('15'), 0, 'Fixture item', pg_temp.f('13'), 50),
  (pg_temp.f('18'), pg_temp.f('15'), 1, 'Leaf item', null, 50);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  (pg_temp.f('19'), pg_temp.f('15'), pg_temp.f('03'), public.today_pkt()),
  (pg_temp.f('1a'), pg_temp.f('15'), pg_temp.f('04'), public.today_pkt()),
  (pg_temp.f('1b'), pg_temp.f('15'), pg_temp.f('05'), null);
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.f('1c'), pg_temp.f('19'), pg_temp.f('17'), 10, 'PKR');
insert into public.inquiry_item_declines (inquiry_id, rfq_item_id, reason) values   -- R07 (0032)
  (pg_temp.f('19'), pg_temp.f('18'), 'other');
insert into public.clarifications (id, rfq_id, question) values
  (pg_temp.f('1d'), pg_temp.f('15'), 'Main q'), (pg_temp.f('1e'), pg_temp.f('15'), 'Leaf q');
update public.clarifications set first_asked_at = now(), last_asked_at = now() where id = pg_temp.f('1e');   -- P01 (0053): one asked question, so v_report_clarification_turnaround has a row to probe
insert into public.orders (id, company_id, owner_id) values
  (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
update public.orders set customer_po_number = 'PO-M1' where id = pg_temp.f('20');   -- P02 (0054): search_all customer PO
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.f('23'), pg_temp.f('20'), pg_temp.f('03'), 'USD'),
  (pg_temp.f('24'), pg_temp.f('20'), pg_temp.f('03'), 'USD');
insert into public.order_items (id, order_id, position, description, unit_price_net, supplier_order_id, supplier_unit_price) values
  (pg_temp.f('25'), pg_temp.f('20'), 0, 'Fixture order item', 100, pg_temp.f('23'), 10);
insert into public.order_costs (order_id, expected_cost_pkr) values (pg_temp.f('20'), 5);
insert into public.order_engineers (order_id, user_id) values (pg_temp.f('20'), 'a0000000-0000-4000-8000-000000000003');
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  (pg_temp.f('26'), pg_temp.f('20'), 'INV-M1', 100, 18), (pg_temp.f('27'), pg_temp.f('20'), 'INV-M2', 100, 18);
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('28'), pg_temp.f('20'), 118);
insert into public.expenses (id, amount_pkr, category_id) values (pg_temp.f('29'), 5, 'ca7e0000-0000-4000-8000-000000000005');
insert into public.recurring_expenses (id, label, category_id, amount) values (pg_temp.f('2a'), 'rent', 'ca7e0000-0000-4000-8000-000000000002', 5);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, rfq_id, has_prices) values   -- untagged: 0103 defaults to true
  (pg_temp.f('2b'), 'rfq-files', 'm/1.pdf', 'a.pdf', 'application/pdf', 10, pg_temp.f('15'), false);
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, invoice_id) values
  (pg_temp.f('2c'), 'gst-receipts', 'm/2.pdf', 'b.pdf', 'application/pdf', 10, pg_temp.f('26'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, expense_id) values   -- A6
  (pg_temp.f('3c'), 'expense-receipts', 'm/3.jpg', 'c.jpg', 'image/jpeg', 10, pg_temp.f('29'));
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices) values   -- R22 (0042), untagged
  (pg_temp.f('3f'), 'rfq-files', 'm/4.jpg', 'd.jpg', 'image/jpeg', 10, pg_temp.f('20'), false);
insert into public.expense_categories (id, name, grp) values (pg_temp.f('3d'), 'M Category', 'overhead');   -- A6
insert into public.closed_months (month, closed_by) values ('2019-01-01', 'a0000000-0000-4000-8000-000000000001');   -- A6
update public.supplier_orders set placed_on = public.today_pkt() where id = pg_temp.f('23');   -- A6: payables_as_of needs a placed leg
insert into public.snoozes (user_id, rule, subject_id, until_on)
select u, 'r', pg_temp.f('2d'), public.today_pkt() + 3
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.targets (user_id, year, quarter, target_net_pkr)
select u, 2090, 1, 100
from unnest(array['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
                  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004']::uuid[]) u;
insert into public.fx_rates (id, currency, rate_pkr, as_of, source) values
  (pg_temp.f('38'), 'USD', 280, public.today_pkt() - 5, 'manual'),
  (pg_temp.f('39'), 'EUR', 300, public.today_pkt() - 5, 'auto');
insert into public.fx_fetch_log (id, kind, detail) values (pg_temp.f('3e'), 'info', 'fixture');
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values
  (pg_temp.f('3a'), pg_temp.f('15'), 7001, 0, public.today_pkt() + 5, '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  (pg_temp.f('3b'), pg_temp.f('23'), 7002, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
-- order @21 is the target of resolve_value_basis
update public.orders set legacy_flags = '{value_basis_unknown}' where id = pg_temp.f('21');
insert into storage.objects (bucket_id, name) values
  ('rfq-files', 'fixture.txt'), ('gst-receipts', 'fixture.txt'), ('generated-docs', 'fixture.txt'),
  ('expense-receipts', 'fixture.txt');
-- 0057 (H-1): quotation @3a and PO @3b are issued with their PDF attached.
insert into storage.objects (bucket_id, name) values ('generated-docs', 'm/q.pdf'), ('generated-docs', 'm/p.pdf');
update public.quotations set pdf_path = 'm/q.pdf' where id = pg_temp.f('3a');
update public.purchase_orders set pdf_path = 'm/p.pdf' where id = pg_temp.f('3b');
-- 0065 (M-1): the fixture orders were created earlier, not in the transaction that writes their lines.
update public.orders set created_at = now() - interval '1 day' where id in (pg_temp.f('20'), pg_temp.f('21'));


-- Extra rows so more views have something to show: an invoice that is GST-exempt, a second payment, a sales-owned RFQ item
-- quoted by two suppliers, an asked and answered question to relay.
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values (pg_temp.f('c5'), pg_temp.f('21'), 'INV-M3', 50, 0);
insert into public.payments_in (id, order_id, amount) values (pg_temp.f('c6'), pg_temp.f('21'), 20);
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.f('c7'), pg_temp.f('1a'), pg_temp.f('17'), 12, 'USD');
insert into public.clarifications (id, rfq_id, question, raised_by_inquiry_id, first_asked_at, last_asked_at, answered_at, answer) values
  (pg_temp.f('c8'), pg_temp.f('15'), 'Relay q', pg_temp.f('19'), now() - interval '2 days', now() - interval '2 days', now() - interval '1 day', 'Yes');

-- ------------------------------------------------------------------ 1. structure
select is((select count(*)::int from pg_temp.scope_policies() p
           where pg_temp.rls_has_bare(p.qual) or pg_temp.rls_has_bare(p.wcheck)), 0,
  'no policy calls current_user_role() or auth.uid() outside (select ...): the check runs once per statement');
select cmp_ok((select count(*)::int from pg_temp.scope_policies() p
               where pg_temp.rls_has_wrapped(p.qual) or pg_temp.rls_has_wrapped(p.wcheck)), '>=', 100,
  'over a hundred policies carry the wrapped role check');
select is((select count(*)::int from pg_temp.scope_views() v where pg_temp.rls_has_bare(v.def)), 0,
  'no public view calls current_user_role() outside (select ...)');
select ok((select pg_temp.rls_has_wrapped(v.def) from pg_temp.scope_views() v where v.vname = 'v_order_state'),
  'v_order_state reads the role once (it used to call it about three times per order)');
select is((select count(*)::int from pg_temp.scope_views() v
           where pg_temp.rls_has_wrapped(v.def) and not (coalesce(v.opts, '{}') @> array['security_invoker=true'])), 0,
  'every re-created view is still security_invoker');
select is((select count(*)::int from pg_temp.scope_policies() p
           where p.sch = 'public' and p.tbl = 'snoozes'
             and (coalesce(p.qual, '') || coalesce(p.wcheck, '')) ~ 'SELECT auth\.uid\(\)'), 4,
  'the four snoozes policies wrap auth.uid() as well');

-- ------------------------------------------------------------------ 2. plan
create function pg_temp.plan_of(q text, persona text) returns text language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    execute 'explain (format json, costs off) ' || q into v;
    raise exception 'done' using errcode = 'P0999', detail = v;
  exception when sqlstate 'P0999' then
    get stacked diagnostics v = pg_exception_detail;
  end;
  return v;
end
$f$;
select ok(pg_temp.plan_of('select * from public.attachments', 'sales') like '%InitPlan%',
  'plan: the attachments policy check is an InitPlan (once per statement)');
select ok(pg_temp.plan_of('select * from public.snoozes', 'engineer') like '%InitPlan%',
  'plan: the snoozes policy (role and auth.uid()) is an InitPlan');

-- ------------------------------------------------------------------ 3. same rows, before and after
select cmp_ok(pg_temp.fingerprint_all('after'), '>=', 250, 'fingerprinted every table and view for five personas (wrapped)');
select cmp_ok((select count(*)::int from fp where state = 'after' and persona = 'admin' and fp not like '0:%' and fp not like 'ERR%'), '>=', 30,
  'the admin sees rows in at least 30 tables and views (the comparison is not of empty sets)');

select cmp_ok(pg_temp.unwrap_everything(), '>=', 100, 'every wrapped policy and view put back to its pre-0074 text');
select cmp_ok((select count(*)::int from pg_temp.scope_policies() p where pg_temp.rls_has_bare(p.qual) or pg_temp.rls_has_bare(p.wcheck)), '>=', 100,
  'the unwrapped state really calls the role check per row again (the "before" state)');
select ok(pg_temp.plan_of('select * from public.attachments', 'sales') not like '%InitPlan%',
  'plan before 0074: no InitPlan for the attachments policy');

select cmp_ok(pg_temp.fingerprint_all('before'), '>=', 250, 'fingerprinted every table and view for five personas (unwrapped)');
select is((select count(*)::int from fp a join fp b on b.persona = a.persona and b.rel = a.rel and b.state = 'before'
           where a.state = 'after'),
          (select count(*)::int from fp where state = 'after'),
  'every (persona, relation) pair was read in both states');
select is((select coalesce(array_agg(a.persona || ' ' || a.rel || ': ' || a.fp || ' vs ' || b.fp order by a.persona, a.rel), '{}')
           from fp a join fp b on b.persona = a.persona and b.rel = a.rel and b.state = 'before'
           where a.state = 'after' and a.fp is distinct from b.fp),
          '{}'::text[],
  'same rows: every table, view and storage.objects reads the same for admin, sales, engineer, deactivated and anon');

select * from finish();
rollback;
