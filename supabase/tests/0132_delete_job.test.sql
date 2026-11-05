-- 0132_delete_job (owner request 2026-11-05): an admin deletes a job; when it cannot be deleted safely the blockers say what to clear first.
--   job_delete_blockers  one row per blocker, in step order; can_clear false for what the books keep
--   delete_job           refused (has_blockers) while a blocker remains; else the orders then the enquiry go (delete_order, delete_rfq)
begin;
select * from no_plan();

-- ------------------------------------------------------------------ machinery (session-local)
create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona
       when 'admin' then 'a0000000-0000-4000-8000-000000000001'
       when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
       else '00000000-0000-0000-0000-000000000000' end $$;

create function pg_temp.u(h text) returns uuid language sql immutable as
  $$ select ('32000000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs stmt as the persona, the way the API runs it (role authenticated, claims, then the 0081 pre-request, which moves an
-- engineer onto qtech_engineer). Returns 'ok:<first column>' for a select, 'ok:<rows>' for other statements ('<none>' for no
-- row), or 'E:<sqlstate>:<hint>|<message>'. Rolled back unless keep is true.
create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare
  v text;
  d text;
  h text;
  m text;
  n bigint;
  s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''32000000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '')
              when n = 0 then '<none>'
              else 'ok:' || n end;
    if keep then
      reset role;
      return d;
    end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      get stacked diagnostics h = pg_exception_hint, m = message_text;
      return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end
$f$;

-- the outcome without the message
create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;


-- ------------------------------------------------------------------ fixtures
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 01 an ordinary customer; 02 the customer with refunds and applied credit (kept apart: the credit guard looks at a whole customer)
insert into public.companies (id, name) values
  (pg_temp.u('01'), '0132 Customer'), (pg_temp.u('02'), '0132 Credit customer'), (pg_temp.u('03'), '0132 Supplier');

-- a clean job: enquiry a1 with an item, order a3 with a line and a file
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('a1'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.rfq_items (id, rfq_id, position, description, qty, created_by) values
  (pg_temp.u('a2'), pg_temp.u('a1'), 0, '0132 clean item', 1, 'a0000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id, created_by, rfq_id) values
  (pg_temp.u('a3'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.u('a1'));
insert into public.order_items (id, order_id, position, description, unit_price_net, rfq_item_id, created_by) values
  (pg_temp.u('a4'), pg_temp.u('a3'), 0, '0132 clean line', 100, pg_temp.u('a2'), 'a0000000-0000-4000-8000-000000000001');
insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id) values
  (pg_temp.u('a5'), 'rfq-files', 'm132/o.jpg', 'o.jpg', 'image/jpeg', 10, pg_temp.u('a3'));

-- orders without an enquiry, one blocker each. 10 plain payment, 11 voided payment, 12 bank-ticked payment,
-- 20 numbered invoice, 21 invoice with no number, 30 expense, 40 issued PO (two revisions)
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('11'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('12'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('20'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('21'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('30'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('40'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');

insert into public.payments_in (id, order_id, amount, received_on, created_by) values
  (pg_temp.u('13'), pg_temp.u('10'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('14'), pg_temp.u('11'), 10, public.today_pkt(), 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, amount, received_on, paid_via, bank_month, created_by) values
  (pg_temp.u('15'), pg_temp.u('12'), 10, public.today_pkt(), 'bank', date_trunc('month', public.today_pkt())::date,
   'a0000000-0000-4000-8000-000000000001');
update public.payments_in set voided_at = now(), voided_by = 'a0000000-0000-4000-8000-000000000001', void_reason = '0132 fixture'
where id = pg_temp.u('14');

insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, created_by) values
  (pg_temp.u('22'), pg_temp.u('20'), 'T132-1', public.today_pkt(), 100, 18, 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('23'), pg_temp.u('21'), 'T132-2', public.today_pkt(), 100, 18, 'a0000000-0000-4000-8000-000000000001');
-- 0112: a numbered invoice is voided, never deleted; the deletable one carries no number (a legacy row)
update public.invoices set number = null, legacy_flags = array['undated'] where id = pg_temp.u('23');

insert into public.expenses (id, amount_pkr, category_id, order_id, description) values
  (pg_temp.u('31'), 5, 'ca7e0000-0000-4000-8000-000000000010', pg_temp.u('30'), '0132 fixture expense');

insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.u('41'), pg_temp.u('40'), pg_temp.u('03'), 'USD');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  (pg_temp.u('42'), pg_temp.u('41'), 13201, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]'),
  (pg_temp.u('43'), pg_temp.u('41'), 13201, 1, 'USD', 0, '[{"qty":1,"unit_price":1}]');

-- the credit customer: 50 and 51 (credit applied from 51 to 50), 52 a refund, 53 a refund ticked against the bank statement
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('50'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('51'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('52'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('53'), pg_temp.u('02'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.credit_applications (id, company_id, to_order_id, from_order_id, amount) values
  (pg_temp.u('54'), pg_temp.u('02'), pg_temp.u('50'), pg_temp.u('51'), 7);
insert into public.customer_refunds (id, company_id, order_id, amount, paid_via) values
  (pg_temp.u('55'), pg_temp.u('02'), pg_temp.u('52'), 7, 'cash');
insert into public.customer_refunds (id, company_id, order_id, amount, paid_via, bank_month) values
  (pg_temp.u('56'), pg_temp.u('02'), pg_temp.u('53'), 7, 'bank', date_trunc('month', public.today_pkt())::date);

-- an enquiry whose item another order (without that enquiry) took a line from
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('60'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.rfq_items (id, rfq_id, position, description, qty, created_by) values
  (pg_temp.u('61'), pg_temp.u('60'), 0, '0132 shared item', 1, 'a0000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('62'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, rfq_item_id, created_by) values
  (pg_temp.u('63'), pg_temp.u('62'), 0, '0132 line from another enquiry', 100, pg_temp.u('61'), 'a0000000-0000-4000-8000-000000000001');

-- a job with a live order and a cancelled one (both clean)
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('70'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id, created_by, rfq_id) values
  (pg_temp.u('71'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.u('70'));
insert into public.orders (id, company_id, owner_id, created_by, rfq_id, cancelled_on, cancel_reason) values
  (pg_temp.u('72'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.u('70'),
   public.today_pkt(), 'duplicate_or_mistake');

-- ================================================================== structure
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('job_delete_blockers', 'delete_job')
             and not p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'
             and has_function_privilege('authenticated', p.oid, 'execute')
             and has_function_privilege('qtech_engineer', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')),
  2, 'both functions are SECURITY INVOKER with a fixed search_path, for authenticated and qtech_engineer, not anon');

-- ================================================================== admin only
select is(pg_temp.code_('sales', 'select count(*)::text from public.job_delete_blockers(null, @10)'), 'E:42501:admin_only', 'blockers: sales is refused');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.job_delete_blockers(null, @10)'), 'E:42501:admin_only', 'blockers: an engineer is refused');
select is(pg_temp.code_('sales', 'select count(*)::text from public.delete_job(null, @a3)'), 'E:42501:admin_only', 'delete_job: sales is refused');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.delete_job(@a1, @a3)'), 'E:42501:admin_only', 'delete_job: an engineer is refused');
select is(pg_temp.code_('deactivated', 'select count(*)::text from public.delete_job(@a1, @a3)'), 'E:42501:admin_only', 'delete_job: a deactivated person is refused');
select is((select count(*)::int from public.orders where id = pg_temp.u('a3')), 1, 'and the refused job is still there');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job()'), 'E:22023:job', 'delete_job: no job named');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@ee)'), 'E:P0002:not_found', 'delete_job: an enquiry that is not there');

-- ================================================================== each blocker kind is found
select is(pg_temp.try_('admin', 'select count(*)::text from public.job_delete_blockers(@a1, @a3)'), 'ok:0', 'a clean job has no blocker');

select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @50)$q$),
  'ok:credit_applied:true', '1 credit_applied: found from the order it is applied to');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @51)$q$),
  'ok:credit_applied:true', '1 credit_applied: and from the order it comes from');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @52)$q$),
  'ok:refund:true', '2 refund: found, can be cleared');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @53)$q$),
  'ok:refund:false', '2 refund: ticked against the bank statement is not clearable until it is unticked');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @10)$q$),
  'ok:payment:true', '3 payment: a plain one can be cleared');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @11)$q$),
  'ok:payment:false', '3 payment: a voided one is kept as history');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @12)$q$),
  'ok:payment:true', '3 payment: a bank-ticked one can be cleared (untick first)');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @20)$q$),
  'ok:invoice:false', '4 invoice: a numbered invoice is kept for the books');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @21)$q$),
  'ok:invoice:true', '4 invoice: one with no number can be deleted');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(null, @30)$q$),
  'ok:expense:true', '5 expense: found');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear || ':' || why, ',' order by step, ref_label) from public.job_delete_blockers(null, @40)$q$),
  'ok:purchase_order:true:Delete the later revision of this purchase order first.,purchase_order:true:Delete the purchase order (the supplier order, Purchase order).',
  '6 purchase_order: both revisions found, the earlier one waits for the later');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step, ref_label) from public.job_delete_blockers(@60, null)$q$),
  'ok:other_order_lines:true', '7 other_order_lines: a line of another order taken from this enquiry');
select is(pg_temp.try_('admin', $q$select string_agg(order_number::text, ',') from public.job_delete_blockers(@60, null)$q$),
  'ok:' || (select o.number from public.orders o where o.id = pg_temp.u('62'))::text, 'and it names that other order');
select is(pg_temp.try_('admin', $q$select string_agg(step::text, ',' order by step) from public.job_delete_blockers(null, @10)$q$), 'ok:3', 'step numbers: payment is step 3');

-- ================================================================== delete_job refused while blocked
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @10)'), 'E:P0001:has_blockers', 'delete_job: refused with a payment');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @20)'), 'E:P0001:has_blockers', 'delete_job: refused with a numbered invoice');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @30)'), 'E:P0001:has_blockers', 'delete_job: refused with an expense');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @40)'), 'E:P0001:has_blockers', 'delete_job: refused with an issued PO');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @52)'), 'E:P0001:has_blockers', 'delete_job: refused with a refund');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @50)'), 'E:P0001:has_blockers', 'delete_job: refused with applied credit');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@60, null)'), 'E:P0001:has_blockers', 'delete_job: refused with a line of another order');
select is((select count(*)::int from public.orders where id in (pg_temp.u('10'), pg_temp.u('20'), pg_temp.u('30'), pg_temp.u('40'), pg_temp.u('52'), pg_temp.u('50'))),
  6, 'and every refused order is still there');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('60')), 1, 'and the refused enquiry is still there');

-- ================================================================== clear the blocker, then the job goes
select is(pg_temp.code_('admin', 'select public.delete_payment(@13)::text', true), 'ok:', 'the payment is deleted (the step the guide asks for)');
select is(pg_temp.try_('admin', 'select count(*)::text from public.job_delete_blockers(null, @10)'), 'ok:0', 'check again: nothing is left to clear');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @10)', true), 'ok:0', 'the order is deleted (no file to remove)');
select is((select count(*)::int from public.orders where id = pg_temp.u('10')), 0, 'and it is gone');

select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_invoice(@23)', true), 'ok:0', 'the unnumbered invoice is deleted');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(null, @21)', true), 'ok:0', 'then the order of it is deleted');

-- ================================================================== a clean job
select is(pg_temp.try_('admin', $q$select string_agg(storage_bucket || '/' || storage_path, ',') from public.delete_job(@a1, @a3)$q$, true),
  'ok:rfq-files/m132/o.jpg', 'a clean job is deleted and its file is returned to remove from storage');
select is((select count(*)::int from public.orders where id = pg_temp.u('a3')), 0, 'the order is gone');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('a1')), 0, 'the enquiry is gone');
select is((select count(*)::int from public.order_items where id = pg_temp.u('a4')), 0, 'and its lines');

-- a live and a cancelled order of one enquiry: both go, then the enquiry
select is(pg_temp.try_('admin', 'select count(*)::text from public.job_delete_blockers(@70, @71)'), 'ok:0', 'a live and a cancelled order, both clean: no blocker');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@70, @71)', true), 'ok:0', 'the job with a cancelled order is deleted');
select is((select count(*)::int from public.orders where id in (pg_temp.u('71'), pg_temp.u('72'))), 0, 'both orders are gone');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('70')), 0, 'and the enquiry');

-- an enquiry alone (no order)
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('80'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@80, null)', true), 'ok:0', 'an enquiry with no order is deleted');
select is((select count(*)::int from public.rfqs where id = pg_temp.u('80')), 0, 'and it is gone');

-- ================================================================== costs and claims on the enquiry (0136 added rfqs_costs_guard)
-- 90 enquiry with a cost on it, no order; 91 enquiry with a pending claim; 92 enquiry won as order 93, with a cost that moved to the order
insert into public.rfqs (id, company_id, owner_id, created_by) values
  (pg_temp.u('90'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('91'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  (pg_temp.u('92'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.expenses (id, amount_pkr, category_id, description, rfq_id) values
  (pg_temp.u('94'), 40, 'ca7e0000-0000-4000-8000-000000000010', '0132 travel to site', pg_temp.u('90')),
  (pg_temp.u('95'), 60, 'ca7e0000-0000-4000-8000-000000000010', '0132 survey fee', pg_temp.u('92'));
insert into public.expense_claims (id, created_by, amount_pkr, note, rfq_id) values
  (pg_temp.u('96'), 'a0000000-0000-4000-8000-000000000003', 25, 'rickshaw', pg_temp.u('91'));
insert into public.orders (id, company_id, owner_id, created_by, rfq_id) values
  (pg_temp.u('93'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', pg_temp.u('92'));

select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear || ':' || coalesce(order_id::text, '-'), ',' order by step) from public.job_delete_blockers(@90, null)$q$),
  'ok:expense:true:-', 'a cost on an enquiry with no order is a clearable expense step');
select is(pg_temp.try_('admin', $q$select ref_label from public.job_delete_blockers(@90, null)$q$), 'ok:0132 travel to site, Rs 40.00 (on the enquiry)', 'and it names the cost');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@90, null)'), 'E:P0001:has_blockers',
  'delete_job: refused with a guide step, not the bare rfq_has_costs');
select is(pg_temp.try_('admin', $q$select string_agg(kind || ':' || can_clear, ',' order by step) from public.job_delete_blockers(@91, null)$q$),
  'ok:expense:true', 'a pending claim on the enquiry is an expense step too');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@91, null)'), 'E:P0001:has_blockers', 'delete_job: refused with a pending claim');
select is(pg_temp.try_('admin', $q$select count(*)::text from public.job_delete_blockers(@92, @93)$q$), 'ok:1',
  'a cost that moved to the order is listed once (with the order), not twice');
select is(pg_temp.try_('admin', $q$select order_id::text from public.job_delete_blockers(@92, @93)$q$), 'ok:' || pg_temp.u('93')::text, 'and it sits on the order');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.job_delete_blockers(@90, null)'), 'E:42501:admin_only', 'an engineer is still refused');

-- clear the step the guide gives, check again, delete
select is(pg_temp.code_('admin', 'delete from public.expenses where id = @94 returning id', true), 'ok:1', 'the cost is removed (the step the guide asks for)');
select is(pg_temp.try_('admin', 'select count(*)::text from public.job_delete_blockers(@90, null)'), 'ok:0', 'check again: nothing is left to clear');
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@90, null)', true), 'ok:0', 'the enquiry is deleted');
delete from public.expense_claims where id = pg_temp.u('96');   -- the admin decides the claim on the Expenses screen
select is(pg_temp.code_('admin', 'select count(*)::text from public.delete_job(@91, null)', true), 'ok:0', 'then its enquiry is deleted');

select * from finish();
rollback;
