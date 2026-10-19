begin;
select * from no_plan();

-- 0057 and the P9 security review (docs/SECURITY_REVIEW.md). Fixture users come from supabase/seed.sql:
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.
--
-- Part 1 proves the H-1 fix (issued PDFs). Part 2 is a set of schema-wide guards that keep the whole public schema
-- closed to anon and to PUBLIC (S14 checks objects by name; these catch an overload or a new object nobody listed).
-- Part 3 holds the medium and low findings that are left as recommendations: each is written as the SECURE behaviour
-- inside todo_start/todo_end, so it demonstrates the gap today without failing the run, and turns green when fixed.

-- ------------------------------------------------------------------ fixtures (table owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('57000000-0000-4000-8000-000000000001', '0057 Customer'),
  ('57000000-0000-4000-8000-000000000002', '0057 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('57000000-0000-4000-8000-000000000010', '57000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.quotations (id, rfq_id, number, revision, valid_until, lines) values
  ('57000000-0000-4000-8000-000000000020', '57000000-0000-4000-8000-000000000010', 9571, 0, public.today_pkt() + 30,
   '[{"qty":1,"unit_price_net":1,"gst_rate":0}]'),
  ('57000000-0000-4000-8000-000000000021', '57000000-0000-4000-8000-000000000010', 9571, 1, public.today_pkt() + 30,
   '[{"qty":1,"unit_price_net":1,"gst_rate":0}]');
insert into public.orders (id, company_id, owner_id) values
  ('57000000-0000-4000-8000-000000000030', '57000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('57000000-0000-4000-8000-000000000031', '57000000-0000-4000-8000-000000000030', '57000000-0000-4000-8000-000000000002', 'USD');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  ('57000000-0000-4000-8000-000000000040', '57000000-0000-4000-8000-000000000031', 9572, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');
insert into storage.objects (bucket_id, name) values
  ('generated-docs', '57000000-0000-4000-8000-000000000020/0.pdf'),
  ('generated-docs', '57000000-0000-4000-8000-000000000040/0.pdf'),
  ('generated-docs', '0057/loose.pdf');
-- Revision 0 and the PO are issued with their PDF attached; revision 1 has no PDF yet.
update public.quotations set pdf_path = '57000000-0000-4000-8000-000000000020/0.pdf' where id = '57000000-0000-4000-8000-000000000020';
update public.purchase_orders set pdf_path = '57000000-0000-4000-8000-000000000040/0.pdf' where id = '57000000-0000-4000-8000-000000000040';

-- ================================================================== part 1: H-1, issued PDFs
select is((select allowed_mime_types from storage.buckets where id = 'generated-docs'), array['application/pdf'],
  'H-1: generated-docs accepts PDFs only');
select is((select public from storage.buckets where id = 'generated-docs'), false, 'generated-docs stays private');

set local role authenticated;

-- ---------------------------------------------------------------- engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'generated-docs'
           and name = '57000000-0000-4000-8000-000000000020/0.pdf' returning 1)
select is((select count(*)::int from u), 0, 'H-1: an engineer cannot overwrite the PDF of an issued quotation');
with u as (update storage.objects set name = '0057/moved.pdf' where bucket_id = 'generated-docs'
           and name = '57000000-0000-4000-8000-000000000040/0.pdf' returning 1)
select is((select count(*)::int from u), 0, 'H-1: nor move the PDF of an issued PO out of the way');
-- An upload with upsert onto an existing object is an UPDATE of that row for row security, so the two checks above cover it.
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'generated-docs' and name = '0057/loose.pdf' returning 1)
select is((select count(*)::int from u), 1, 'an object no document points at stays writable (first generation unchanged)');
select is((select count(*)::int from storage.objects where bucket_id = 'generated-docs' and name like '57000000-0000-4000-8000-0000000000%'), 2,
  'the engineer can still read the issued PDFs');

select throws_ok($$update public.quotations set pdf_path = '0057/loose.pdf' where id = '57000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'H-1: an engineer cannot point an issued quotation at another file');
select throws_ok($$update public.quotations set pdf_path = null where id = '57000000-0000-4000-8000-000000000020'$$,
  '42501', null, 'H-1: nor clear its PDF');
select throws_ok($$update public.purchase_orders set pdf_path = '0057/loose.pdf' where id = '57000000-0000-4000-8000-000000000040'$$,
  '42501', null, 'H-1: nor re-point an issued PO');
select lives_ok($$update public.quotations set pdf_path = pdf_path where id = '57000000-0000-4000-8000-000000000020'$$,
  'writing the same path again is fine (an idempotent retry)');
select lives_ok($$update public.quotations set pdf_path = '57000000-0000-4000-8000-000000000021/1.pdf' where id = '57000000-0000-4000-8000-000000000021'$$,
  'the first PDF of a revision is attached by anyone, as before');
select throws_ok($$update public.quotations set notes = 'x' where id = '57000000-0000-4000-8000-000000000021'$$,
  '55000', null, 'the 0022 lock is unchanged: nothing else on an issued quotation changes');

-- ---------------------------------------------------------------- sales
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
with u as (update storage.objects set metadata = '{"x":2}' where bucket_id = 'generated-docs'
           and name = '57000000-0000-4000-8000-000000000020/0.pdf' returning 1)
select is((select count(*)::int from u), 0, 'H-1: sales cannot overwrite an issued PDF either');
select throws_ok($$update public.quotations set pdf_path = '0057/loose.pdf' where id = '57000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'H-1: nor re-point a quotation whose PDF is attached');

-- ---------------------------------------------------------------- deactivated
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
with u as (update storage.objects set metadata = '{"x":3}' where bucket_id = 'generated-docs' returning 1)
select is((select count(*)::int from u), 0, 'a deactivated user writes nothing in generated-docs');

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
with u as (update storage.objects set metadata = '{"x":4}' where bucket_id = 'generated-docs'
           and name = '57000000-0000-4000-8000-000000000020/0.pdf' returning 1)
select is((select count(*)::int from u), 1, 'an admin can still replace an issued PDF');
select lives_ok($$update public.quotations set pdf_path = null where id = '57000000-0000-4000-8000-000000000020'$$,
  'and clear pdf_path ("generate the PDF again")');
select lives_ok($$update public.purchase_orders set pdf_path = '0057/loose.pdf' where id = '57000000-0000-4000-8000-000000000040'$$,
  'and re-point a PO');

reset role;

-- ================================================================== part 2: schema-wide guards
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (has_function_privilege('anon', p.oid, 'execute')
                  or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
          '{}'::text[], 'guard: no function in public (any overload) is executable by anon or PUBLIC');
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef
             and not coalesce(p.proconfig @> array['search_path=""'], false)),
          '{}'::text[], 'guard: every SECURITY DEFINER function in public pins an empty search_path');
select is((select coalesce(array_agg(c.relname::text order by 1), '{}') from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
          '{}'::text[], 'guard: row level security is on for every table in public');
select is((select coalesce(array_agg(c.relname::text order by 1), '{}') from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
          '{}'::text[], 'guard: every view in public is security_invoker');
select is((select coalesce(array_agg(id::text order by 1), '{}') from storage.buckets where public),
          '{}'::text[], 'guard: no storage bucket is public');
select is((select coalesce(array_agg(pl.policyname::text order by 1), '{}') from pg_policies pl
           where (pl.schemaname = 'public' or (pl.schemaname = 'storage' and pl.tablename = 'objects'))
             and (pl.roles && array['anon', 'public']::name[])),
          '{}'::text[], 'guard: no row-security policy in public or on storage objects is granted to anon or PUBLIC');

-- ================================================================== part 3: documented findings (todo until fixed)
select todo_start('M-1 (SECURITY_REVIEW.md): figures of a closed month still move when order data changes');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.order_items (id, order_id, description, qty, unit_price_net, gst_rate) values
  ('57000000-0000-4000-8000-000000000032', '57000000-0000-4000-8000-000000000030', '0057 line', 1, 100, 18);
insert into public.payments_in (id, order_id, amount, received_on) values
  ('57000000-0000-4000-8000-000000000050', '57000000-0000-4000-8000-000000000030', 118, '2020-01-15');
select public.close_months_through('2020-01-01');
create temp table m1_before as select net_in from public.v_month_pnl where month = '2020-01-01';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
update public.orders set legacy_flags = array['value_basis_unknown'] where id = '57000000-0000-4000-8000-000000000030';
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select net_in from public.v_month_pnl where month = '2020-01-01'), (select net_in from m1_before),
  'M-1: an engineer editing an order cannot change the net income of a closed month');
select todo_end();

select todo_start('L-1 (SECURITY_REVIEW.md): the chase actor (0048) can be named by the caller');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('57000000-0000-4000-8000-000000000060', '57000000-0000-4000-8000-000000000010', '57000000-0000-4000-8000-000000000002', public.today_pkt() - 3);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$update public.supplier_inquiries set last_chased_on = public.today_pkt(), chase_count = 1,
                   last_chased_by = 'a0000000-0000-4000-8000-000000000002' where id = '57000000-0000-4000-8000-000000000060'$$,
  '42501', null, 'L-1: an engineer cannot record a chase in the name of a colleague');
reset role;
select todo_end();

select todo_start('L-2 (SECURITY_REVIEW.md): anon keeps the default Supabase grants on sequences in public');
select is((select coalesce(array_agg(c.relname::text order by 1), '{}') from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
             and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') else false end),
          '{}'::text[], 'L-2: anon holds no privilege on any sequence in public');
select todo_end();

select todo_start('L-3 (SECURITY_REVIEW.md): pg_net HTTP functions keep the Supabase grants to anon and authenticated');
select ok(case when to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then true
               else not (has_function_privilege('anon', to_regprocedure('net.http_get(text,jsonb,jsonb,integer)'), 'execute')
                         or has_function_privilege('authenticated', to_regprocedure('net.http_get(text,jsonb,jsonb,integer)'), 'execute')) end,
  'L-3: no client role can call net.http_get (only the nightly FX job needs it)');
select todo_end();

select * from finish();
rollback;
