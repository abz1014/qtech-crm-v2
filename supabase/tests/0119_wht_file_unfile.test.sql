-- 0119: the WHT certificate file (the missing flag clears on a number OR a file, attaching works in a closed month, admin only) and
-- clearing a PSID or a tax deposit date on a filed invoice (admin only, audited). Fixture users come from supabase/seed.sql:
-- admin a0..01, sales a0..02, engineer a0..03. Fixtures are written as the table owner.
begin;
select * from no_plan();

create function pg_temp.uid(persona text) returns text language sql immutable as
  $$ select case persona when 'admin' then 'a0000000-0000-4000-8000-000000000001' when 'sales' then 'a0000000-0000-4000-8000-000000000002'
       when 'engineer' then 'a0000000-0000-4000-8000-000000000003' else '00000000-0000-0000-0000-000000000000' end $$;
create function pg_temp.u(h text) returns uuid language sql immutable as $$ select ('11900000-0000-4000-8000-0000000000' || h)::uuid $$;
create function pg_temp.adm() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true) $$;

create function pg_temp.try_(persona text, stmt text, keep boolean default false) returns text language plpgsql as $f$
declare v text; d text; h text; m text; n bigint; s text;
begin
  s := regexp_replace(stmt, '@([0-9a-f]{2})\M', '''11900000-0000-4000-8000-0000000000\1''::uuid', 'g');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(persona), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute s into v;
    get diagnostics n = row_count;
    d := case when left(ltrim(lower(s)), 6) = 'select' then 'ok:' || coalesce(v, '') when n = 0 then '<none>' else 'ok:' || n end;
    if keep then reset role; perform pg_temp.adm(); return d; end if;
    raise exception 'done' using errcode = 'P0999', detail = d;
  exception
    when sqlstate 'P0999' then get stacked diagnostics d = pg_exception_detail; perform pg_temp.adm(); return d;
    when others then get stacked diagnostics h = pg_exception_hint, m = message_text; perform pg_temp.adm(); return 'E:' || sqlstate || ':' || coalesce(h, '') || '|' || m;
  end;
end $f$;
create function pg_temp.code_(persona text, stmt text, keep boolean default false) returns text language sql as
  $$ select split_part(pg_temp.try_(persona, stmt, keep), '|', 1) $$;

select pg_temp.adm();

insert into public.companies (id, name) values (pg_temp.u('01'), '0119 Customer');
insert into public.orders (id, company_id, owner_id, created_by) values
  (pg_temp.u('10'), pg_temp.u('01'), 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.order_items (id, order_id, position, description, unit_price_net, gst_rate, created_by) values
  (pg_temp.u('20'), pg_temp.u('10'), 0, 'Line', 1000, 18, 'a0000000-0000-4000-8000-000000000001');
insert into public.invoices (id, order_id, number, invoice_date, net_amount, gst_amount, psid, tax_deposited_on, created_by) values
  (pg_temp.u('30'), pg_temp.u('10'), 'T119-1', public.today_pkt(), 1000, 180, 'P119', public.today_pkt(), 'a0000000-0000-4000-8000-000000000001');
insert into public.payments_in (id, order_id, received_on, amount, wht_amount) values
  (pg_temp.u('40'), pg_temp.u('10'), public.today_pkt(), 1100, 80),
  (pg_temp.u('41'), pg_temp.u('10'), '2019-03-10', 10, 1);

-- ================================================================== A. the certificate file
select is((select certificate_missing from public.v_wht_deducted where payment_id = pg_temp.u('40')), true, 'no number and no file: the certificate is missing');
select is(pg_temp.code_('admin', $q$update public.payments_in set wht_certificate_path = 'wht/x/a.pdf' where id = @40 returning 1$q$), 'E:23514:',
  'a path without a name is refused (the pair travels together)');
select is(pg_temp.code_('admin', $q$update public.payments_in set wht_certificate_path = 'wht/x/a.pdf', wht_certificate_name = 'cert.pdf' where id = @40 returning 1$q$, true), 'ok:1',
  'the admin attaches a file');
select is((select certificate_missing from public.v_wht_deducted where payment_id = pg_temp.u('40')), false, 'a file alone clears the missing flag');
select is((select certificate_name from public.v_wht_deducted where payment_id = pg_temp.u('40')), 'cert.pdf', 'the list carries the file name');
select is((select certificate_path from public.v_wht_deducted where payment_id = pg_temp.u('40')), 'wht/x/a.pdf', 'and the storage path');
update public.payments_in set wht_certificate_path = null, wht_certificate_name = null where id = pg_temp.u('40');
update public.payments_in set wht_certificate_no = 'CPR-9' where id = pg_temp.u('40');
select is((select certificate_missing from public.v_wht_deducted where payment_id = pg_temp.u('40')), false, 'a number alone clears it too');
update public.payments_in set wht_certificate_no = '   ' where id = pg_temp.u('40');
select is((select certificate_missing from public.v_wht_deducted where payment_id = pg_temp.u('40')), true, 'blank spaces are no number');
select is(pg_temp.code_('sales', $q$update public.payments_in set wht_certificate_path = 'wht/x/a.pdf', wht_certificate_name = 'cert.pdf' where id = @40 returning 1$q$), '<none>', 'sales attach nothing');
select is(pg_temp.code_('sales', 'select count(*)::text from public.v_wht_deducted'), 'ok:0', 'sales see no list');
select is(pg_temp.code_('engineer', 'select count(*)::text from public.v_wht_deducted'), 'ok:0', 'an engineer sees none');

-- a closed month still takes the file (it is not money), but not a change of the money
select lives_ok($$select public.close_months_through('2019-03-01')$$, 'March 2019 closes');
select is(pg_temp.code_('admin', $q$update public.payments_in set wht_certificate_path = 'wht/y/b.pdf', wht_certificate_name = 'late.pdf' where id = @41 returning 1$q$, true), 'ok:1',
  'the certificate file can be attached to a payment of a closed month');
select is(pg_temp.code_('admin', $q$update public.payments_in set amount = 11 where id = @41 returning 1$q$), 'E:P0001:', 'but its amount is frozen');
select is(pg_temp.code_('admin', $q$update public.payments_in set wht_certificate_no = 'N-1' where id = @41 returning 1$q$), 'E:P0001:', 'and so is its certificate number (unchanged from 0116)');

-- ================================================================== B. clearing a filing
select is(pg_temp.code_('sales', $q$update public.invoices set psid = null where id = @30 returning 1$q$), 'E:42501:admin_only_unfile', 'sales cannot clear a PSID');
select is(pg_temp.code_('sales', $q$update public.invoices set psid = '  ' where id = @30 returning 1$q$), 'E:42501:admin_only_unfile', 'nor blank it');
select is(pg_temp.code_('sales', $q$update public.invoices set tax_deposited_on = null where id = @30 returning 1$q$), 'E:42501:admin_only_unfile', 'nor clear the tax deposit date');
select is(pg_temp.code_('sales', $q$update public.invoices set psid = 'P119-B' where id = @30 returning 1$q$), 'ok:1', 'sales can still change a PSID');
select is(pg_temp.code_('sales', $q$update public.invoices set tcs_sent_on = public.today_pkt() where id = @30 returning 1$q$), 'ok:1', 'and stamp other things');
select is(pg_temp.code_('admin', $q$update public.invoices set psid = null where id = @30 returning 1$q$, true), 'ok:1', 'the admin clears the PSID');
select is(pg_temp.code_('admin', $q$update public.invoices set tax_deposited_on = null where id = @30 returning 1$q$, true), 'ok:1', 'and the deposit date');
select ok((select count(*) = 1 from public.audit_log l
           where l.table_name = 'invoices' and l.record_id = pg_temp.u('30')::text and l.action = 'update'
             and l.changed_by = 'a0000000-0000-4000-8000-000000000001' and l.old_value ->> 'psid' = 'P119' and (l.new_value ->> 'psid') is null),
  'the PSID clearing is in the audit log with the admin as the actor');
select ok((select count(*) = 1 from public.audit_log l
           where l.table_name = 'invoices' and l.record_id = pg_temp.u('30')::text and l.action = 'update'
             and l.changed_by = 'a0000000-0000-4000-8000-000000000001' and (l.old_value ->> 'tax_deposited_on') is not null and (l.new_value ->> 'tax_deposited_on') is null),
  'and so is the deposit date');
select is(pg_temp.code_('sales', $q$update public.invoices set psid = 'P119-C' where id = @30 returning 1$q$, true), 'ok:1', 'a PSID that is empty can be set by sales again');

select * from finish();
rollback;
