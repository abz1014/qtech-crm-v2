begin;
select * from no_plan();

-- 0144_to_collect_excludes_archived: receivables_summary() (the Home "To collect" card, the Money home hero and the To collect page totals and
-- tiles) leaves out archived orders when archiving is ON. Everything else that reads receivables is unchanged.
--   (a) archiving off: the summary is the whole book (totals over receivables_list)
--   (b) archiving on: the summary is the totals over receivables_list rows where not is_archived('order', id)
--   (c) unhide brings an order back into To collect; rehide drops it again
--   (d) the same for sales as for admin; an engineer is refused (42501); a deactivated person gets no row
--   (e) receivables_list and order_receivables are identical with archiving on and off; the signature is unchanged
-- Cutoff 17 Nov 2026. Fixtures: A old overdue invoiced unpaid, B new invoiced not yet due, C imported not invoiced, D old invoiced (unhidden later).

-- ------------------------------------------------------------------ machinery (as 0141)
create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b9144000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

-- ------------------------------------------------------------------ fixtures (archiving OFF, the default)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values (pg_temp.f('01'), '0144 Customer');

insert into public.orders (id, company_id, owner_id, ordered_on, legacy_flags, legacy_source) values
  (pg_temp.f('21'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-01-05', '{}', null),               -- A old, overdue
  (pg_temp.f('22'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2099-01-01', '{}', null),               -- B new, not yet due
  (pg_temp.f('23'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-12-01', '{}', '{"table":"orders"}'), -- C imported, not invoiced
  (pg_temp.f('24'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', '2026-01-10', '{}', null);               -- D old, to be unhidden

insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount) values
  (pg_temp.f('31'), pg_temp.f('21'), 'INV-144-A', '2026-01-05', 1000, 180),
  (pg_temp.f('32'), pg_temp.f('22'), 'INV-144-B', '2099-01-01', 100, 18),
  (pg_temp.f('34'), pg_temp.f('24'), 'INV-144-D', '2026-01-10', 200, 0);

insert into public.order_items (order_id, description, unit_price_net) values
  (pg_temp.f('23'), '0144 imported item', 500);

-- Totals over receivables_list, the way receivableTotals and 0076 define them; p_hide drops the orders is_archived() says are archived
create function pg_temp.expected(p_hide boolean) returns jsonb language sql stable as $$
  with l as (
    select x.*, cardinality(x.invoice_numbers) > 0 as invoiced
    from public.receivables_list(null, null, null, true) x
    where not (p_hide and coalesce(public.is_archived('order', x.order_id), false))
  ),
  o as (select * from l where payment_state <> 'settled')
  select jsonb_build_object(
    'open_count', (select count(*) from o),
    'outstanding', (select coalesce(sum(balance), 0) from o),
    'overdue_count', (select count(*) from o where payment_state = 'overdue'),
    'overdue', (select coalesce(sum(balance), 0) from o where payment_state = 'overdue'),
    'not_yet_due_count', (select count(*) from o where invoiced and payment_state <> 'overdue'),
    'not_yet_due', (select coalesce(sum(balance), 0) from o where invoiced and payment_state <> 'overdue'),
    'not_invoiced_count', (select count(*) from o where not invoiced),
    'not_invoiced', (select coalesce(sum(balance), 0) from o where not invoiced),
    'gross', (select coalesce(sum(gross_target), 0) from o),
    'settled', (select coalesce(sum(settled), 0) from o),
    'settled_count', (select count(*) from l where payment_state = 'settled'))
$$;
-- The summary, without reminder_due_count (it depends on today's date and the reminder dates, not on the archive)
create function pg_temp.summary() returns jsonb language sql stable as $$
  select to_jsonb(s) - 'reminder_due_count' from public.receivables_summary() s
$$;

create temp table snap (k text, step text, j jsonb);
create function pg_temp.take(p_step text) returns void language plpgsql as $$
begin
  insert into snap select 'receivables_list', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.receivables_list(null, null, null, false) t;
  insert into snap select 'order_receivables', p_step, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.order_receivables() t;
end $$;

-- ------------------------------------------------------------------ (a) archiving off: the whole book
select is((select count(*)::int from public.receivables_list(null, null, null, true) where order_id in (pg_temp.f('21'), pg_temp.f('22'), pg_temp.f('23'), pg_temp.f('24'))), 4,
  'precondition: all four fixture orders are in the receivables list');
select is((select payment_state from public.receivables_list(null, null, null, true) where order_id = pg_temp.f('21')), 'overdue', 'precondition: A is overdue');
select is((select payment_state from public.receivables_list(null, null, null, true) where order_id = pg_temp.f('22')), 'unpaid', 'precondition: B is not yet due');
select is((select cardinality(invoice_numbers) from public.receivables_list(null, null, null, true) where order_id = pg_temp.f('23')), 0, 'precondition: C is not invoiced');
create temp table off1 as select pg_temp.summary() as j;
select is((select j from off1), pg_temp.expected(false), 'off: receivables_summary is the totals over the whole receivables_list');
select pg_temp.take('off');

-- ------------------------------------------------------------------ (b) archiving on
select is((select (public.archive_set(true, date '2026-11-17')).enabled), true, 'archive_set(true, 17 Nov 2026) switches archiving on');
select is(public.is_archived('order', pg_temp.f('21')), true, 'A is archived');
select is(public.is_archived('order', pg_temp.f('22')), false, 'B is live');
select is(public.is_archived('order', pg_temp.f('23')), true, 'C (imported) is archived');
select is(public.is_archived('order', pg_temp.f('24')), true, 'D is archived');
create temp table on1 as select pg_temp.summary() as j;
select is((select j from on1), pg_temp.expected(true), 'on: receivables_summary is the totals over receivables_list rows that are not archived');
select isnt((select j from on1), (select j from off1), 'on: the summary differs from the off summary');
select is(((select j from off1) ->> 'open_count')::int - ((select j from on1) ->> 'open_count')::int, 3, 'on: three open orders drop out of the count (A, C, D)');
select is(((select j from off1) ->> 'outstanding')::numeric - ((select j from on1) ->> 'outstanding')::numeric, 1180::numeric + 590 + 200,
  'on: outstanding drops by the balances of A, C and D');
select is(((select j from off1) ->> 'not_invoiced')::numeric - ((select j from on1) ->> 'not_invoiced')::numeric, 590::numeric, 'on: not invoiced drops by the imported order C');
select is(((select j from off1) ->> 'overdue')::numeric - ((select j from on1) ->> 'overdue')::numeric, 1180::numeric + 200, 'on: overdue drops by A and D');
select ok(((select j from on1) ->> 'not_yet_due_count')::int >= 1 and ((select j from on1) ->> 'not_yet_due')::numeric >= 118, 'on: the live order B is still counted as not yet due');
select pg_temp.take('on');

-- ------------------------------------------------------------------ (c) unhide and rehide
select is(public.archive_unhide('order', pg_temp.f('24')), true, 'unhide: D is brought back');
select is(((select pg_temp.summary()) ->> 'outstanding')::numeric - ((select j from on1) ->> 'outstanding')::numeric, 200::numeric, 'unhide: D counts again in To collect');
select is((select pg_temp.summary()), pg_temp.expected(true), 'unhide: the summary still matches the totals over the non-archived list');
select is(public.archive_rehide('order', pg_temp.f('24')), true, 'rehide: D is archived again');
select is((select pg_temp.summary()), (select j from on1), 'rehide: the summary is back to the first on figures');

-- ------------------------------------------------------------------ (d) who sees what
select is(pg_temp.as_('sales', $q$select (to_jsonb(s) - 'reminder_due_count')::text from public.receivables_summary() s$q$),
          pg_temp.as_('admin', $q$select (to_jsonb(s) - 'reminder_due_count')::text from public.receivables_summary() s$q$),
  'sales sees the same To collect figures as admin');
select is(pg_temp.as_('sales', $q$select outstanding::text from public.receivables_summary()$q$), ((select j from on1) ->> 'outstanding'), 'sales: outstanding excludes the archived orders');
select is(pg_temp.as_('engineer', $q$select outstanding::text from public.receivables_summary()$q$), 'E:42501', 'an engineer is still refused (42501)');
select is(pg_temp.as_('deactivated', $q$select outstanding::text from public.receivables_summary()$q$), '<none>', 'a deactivated person gets no row');

-- ------------------------------------------------------------------ (e) nothing else moved
select is((select (public.archive_set(false, null)).enabled), false, 'archive_set(false) switches archiving off');
create temp table off2 as select pg_temp.summary() as j;
select is((select j from off2), (select j from off1), 'off again: the summary is the whole book again');
select is((select j from snap where k = 'receivables_list' and step = 'on'), (select j from snap where k = 'receivables_list' and step = 'off'),
  'receivables_list is identical with archiving on and off');
select is((select j from snap where k = 'order_receivables' and step = 'on'), (select j from snap where k = 'order_receivables' and step = 'off'),
  'order_receivables is identical with archiving on and off');
select ok((select jsonb_array_length(j) > 0 from snap where k = 'receivables_list' and step = 'on'), 'receivables_list has rows (the comparison is not empty)');
select is((select pg_get_function_result('public.receivables_summary(date)'::regprocedure)),
  'TABLE(open_count integer, outstanding numeric, overdue_count integer, overdue numeric, reminder_due_count integer, not_yet_due_count integer, not_yet_due numeric, not_invoiced_count integer, not_invoiced numeric, gross numeric, settled numeric, settled_count integer)',
  'the signature and the returned columns are unchanged');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.receivables_summary(date)'::regprocedure), false, 'receivables_summary is still SECURITY INVOKER');
select is((select has_function_privilege('anon', 'public.receivables_summary(date)', 'execute')), false, 'anon cannot execute it');
select is((select has_function_privilege('authenticated', 'public.receivables_summary(date)', 'execute')), true, 'authenticated can');

select * from finish();
rollback;
