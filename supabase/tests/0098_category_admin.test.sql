-- 0098_category_admin: only an admin renames or curates a product category; "Fill missing categories" is not blocked by the month
-- lock and is audited.
begin;
select * from no_plan();

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

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.brands (id, name, kind, curated) values
  ('b0980000-0000-4000-8000-000000000001', '0098 Curated family', 'family', true),
  ('b0980000-0000-4000-8000-000000000002', '0098 Plain family', 'family', false),
  ('b0980000-0000-4000-8000-000000000003', '0098 A brand', 'brand', false);

-- ------------------------------------------------------------------ the guard
select is(pg_temp.as_('sales', $q$update public.brands set curated = false where id = 'b0980000-0000-4000-8000-000000000001' returning 'x'$q$), 'E:42501',
          'sales cannot un-curate a category');
select is(pg_temp.as_('sales', $q$update public.brands set curated = true where id = 'b0980000-0000-4000-8000-000000000002' returning 'x'$q$), 'E:42501',
          'sales cannot curate one');
select is(pg_temp.as_('sales', $q$update public.brands set name = '0098 Renamed' where id = 'b0980000-0000-4000-8000-000000000001' returning 'x'$q$), 'E:42501',
          'sales cannot rename a curated category');
select is(pg_temp.as_('engineer', $q$update public.brands set name = '0098 Renamed' where id = 'b0980000-0000-4000-8000-000000000001' returning 'x'$q$), 'E:42501',
          'an engineer cannot either');
select is(pg_temp.as_('sales', $q$insert into public.brands (name, kind, curated) values ('0098 Sneaky', 'family', true) returning 'x'$q$), 'E:42501',
          'sales cannot add a curated category');
select is(pg_temp.as_('sales', $q$update public.brands set name = '0098 Plain renamed' where id = 'b0980000-0000-4000-8000-000000000002' returning 'x'$q$), 'x',
          'sales can still rename an uncurated family (as before)');
select is(pg_temp.as_('sales', $q$update public.brands set name = '0098 Brand renamed' where id = 'b0980000-0000-4000-8000-000000000003' returning 'x'$q$), 'x',
          'and a brand (as before)');
select is(pg_temp.as_('sales', $q$insert into public.brands (name, kind) values ('0098 New family', 'family') returning 'x'$q$), 'x',
          'and add an uncurated family on the fly (an item with a new family)');
select is(pg_temp.as_('admin', $q$update public.brands set name = '0098 Curated renamed' where id = 'b0980000-0000-4000-8000-000000000001' returning 'x'$q$), 'x',
          'an admin renames a curated category');
select is(pg_temp.as_('admin', $q$update public.brands set curated = true where id = 'b0980000-0000-4000-8000-000000000002' returning 'x'$q$), 'x',
          'and curates one');
select is(pg_temp.as_('sales', 'select public.guard_category_admin()::text'), 'E:42501', 'nobody can call the guard function');
select is(has_function_privilege('qtech_engineer', 'public.guard_category_admin()', 'execute'), false, 'the engineer role holds no execute on it');

-- ------------------------------------------------------------------ Fill missing categories: not blocked by the month lock, and audited
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where p.proname = 'enforce_month_lock' and t.tgrelid in ('public.order_items'::regclass, 'public.rfq_items'::regclass)), 0,
          'the month lock is on no item table, so no allowance is needed (0089 needed one for invoices only)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000009801', '0098 Customer');
insert into public.rfqs (id, company_id, owner_id) values ('a2000000-0000-4000-8000-000000009801', 'c0000000-0000-4000-8000-000000009801', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty) values ('a4000000-0000-4000-8000-000000009801', 'a2000000-0000-4000-8000-000000009801', 0, '0098 contactor', 1);
insert into public.orders (id, company_id, owner_id, created_at) values ('a1000000-0000-4000-8000-000000009801', 'c0000000-0000-4000-8000-000000009801', 'a0000000-0000-4000-8000-000000000002', now() - interval '60 days');
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, gst_rate) values
  ('a3000000-0000-4000-8000-000000009801', 'a1000000-0000-4000-8000-000000009801', 0, '0098 contactor', 1, 'ea', 5000, 18);

select is(pg_temp.as_('admin', $q$update public.order_items set family_id = 'b0980000-0000-4000-8000-000000000001' where id = 'a3000000-0000-4000-8000-000000009801' and family_id is null returning 'x'$q$), 'x',
          'an admin fills the category of an order line');
select is(pg_temp.as_('admin', $q$update public.rfq_items set family_id = 'b0980000-0000-4000-8000-000000000001' where id = 'a4000000-0000-4000-8000-000000009801' and family_id is null returning 'x'$q$), 'x',
          'and of an RFQ item');
-- the as_ calls above are rolled back by design, so the audited write is made here, as the admin (the claims set above)
update public.order_items set family_id = 'b0980000-0000-4000-8000-000000000001' where id = 'a3000000-0000-4000-8000-000000009801' and family_id is null;
select is((select count(*)::int from public.audit_log where table_name = 'order_items' and record_id = 'a3000000-0000-4000-8000-000000009801' and action = 'update'
           and (new_value ->> 'family_id') = 'b0980000-0000-4000-8000-000000000001' and (old_value ->> 'family_id') is null), 1,
          'the change is in the audit log: from nothing to the category');
select is((select changed_by::text from public.audit_log where table_name = 'order_items' and record_id = 'a3000000-0000-4000-8000-000000009801' and action = 'update' order by changed_at desc limit 1), 'a0000000-0000-4000-8000-000000000001', 'and it names the admin who made it');

select * from finish();
rollback;
