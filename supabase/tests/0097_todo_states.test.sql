-- 0097_todo_states: a "Not ours to chase" snooze (until_change) ends when its record changes, and an engineer can stamp
-- supplier_inquiries.sent_confirmed_at on an inquiry they can see.
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
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000009701', '0097 Customer'), ('c0000000-0000-4000-8000-000000009702', '0097 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000009701', 'c0000000-0000-4000-8000-000000009701', 'a0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000009702', 'c0000000-0000-4000-8000-000000009701', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0000000-0000-4000-8000-000000009701', 'd0000000-0000-4000-8000-000000009701', 'c0000000-0000-4000-8000-000000009702', public.today_pkt());
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000009701', 'c0000000-0000-4000-8000-000000009701', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2000000-0000-4000-8000-000000009701', 'a1000000-0000-4000-8000-000000009701', 'c0000000-0000-4000-8000-000000009702', 'PKR');

-- the sales person has an until_change snooze and a date snooze on every kind of record; the engineer has one on the RFQ
insert into public.snoozes (user_id, rule, subject_id, until_on, until_change) values
  ('a0000000-0000-4000-8000-000000000002', 'r_rfq',   'd0000000-0000-4000-8000-000000009701', current_date + 3650, true),
  ('a0000000-0000-4000-8000-000000000002', 'r_rfq_d', 'd0000000-0000-4000-8000-000000009701', current_date + 7,    false),
  ('a0000000-0000-4000-8000-000000000003', 'r_rfq',   'd0000000-0000-4000-8000-000000009701', current_date + 3650, true),
  ('a0000000-0000-4000-8000-000000000002', 'r_rfq',   'd0000000-0000-4000-8000-000000009702', current_date + 3650, true),
  ('a0000000-0000-4000-8000-000000000002', 'r_inq',   'f0000000-0000-4000-8000-000000009701', current_date + 3650, true),
  ('a0000000-0000-4000-8000-000000000002', 'r_inq_d', 'f0000000-0000-4000-8000-000000009701', current_date + 7,    false),
  ('a0000000-0000-4000-8000-000000000002', 'r_ord',   'a1000000-0000-4000-8000-000000009701', current_date + 3650, true),
  ('a0000000-0000-4000-8000-000000000002', 'r_leg',   'a2000000-0000-4000-8000-000000009701', current_date + 3650, true);

create function pg_temp.n(rule_ text, who text default 'a0000000-0000-4000-8000-000000000002') returns bigint language sql as
  $$ select count(*) from public.snoozes where rule = rule_ and user_id = who::uuid and subject_id <> 'd0000000-0000-4000-8000-000000009702' $$;

-- ------------------------------------------------------------------ the default
select is((select count(*) from public.snoozes where until_change), 6::bigint, 'six snoozes were inserted with until_change');
select is((select until_change from public.snoozes where rule = 'r_rfq_d'), false, 'until_change defaults to false for a date snooze');
select is((select count(*) from public.supplier_inquiries where sent_confirmed_at is not null), 0::bigint, 'sent_confirmed_at starts empty');

-- ------------------------------------------------------------------ a write that changes nothing does not clear
update public.rfqs set notes = notes where id = 'd0000000-0000-4000-8000-000000009701';
update public.orders set notes = notes where id = 'a1000000-0000-4000-8000-000000009701';
select is(pg_temp.n('r_rfq'), 1::bigint, 'an RFQ write that changes nothing leaves the snooze');
select is(pg_temp.n('r_ord'), 1::bigint, 'an order write that changes nothing leaves the snooze');

-- ------------------------------------------------------------------ a real change clears it
update public.rfqs set notes = '0097 changed' where id = 'd0000000-0000-4000-8000-000000009701';
select is(pg_temp.n('r_rfq'), 0::bigint, 'a change to the RFQ ends the until_change snooze');
select is(pg_temp.n('r_rfq', 'a0000000-0000-4000-8000-000000000003'), 0::bigint, 'it ends everyone''s until_change snooze on that RFQ');
select is(pg_temp.n('r_rfq_d'), 1::bigint, 'a date snooze on the same RFQ stays');
select is((select count(*) from public.snoozes where rule = 'r_rfq' and subject_id = 'd0000000-0000-4000-8000-000000009702'), 1::bigint,
          'an until_change snooze on another RFQ stays');
select is(pg_temp.n('r_inq'), 1::bigint, 'the inquiry snooze is not touched by the RFQ change');

update public.supplier_inquiries set notes = '0097 changed' where id = 'f0000000-0000-4000-8000-000000009701';
select is(pg_temp.n('r_inq'), 0::bigint, 'a change to the inquiry ends its until_change snooze');
select is(pg_temp.n('r_inq_d'), 1::bigint, 'and leaves its date snooze');

update public.orders set notes = '0097 changed' where id = 'a1000000-0000-4000-8000-000000009701';
select is(pg_temp.n('r_ord'), 0::bigint, 'a change to the order ends its until_change snooze');

update public.supplier_orders set reference = '0097 changed' where id = 'a2000000-0000-4000-8000-000000009701';
select is(pg_temp.n('r_leg'), 0::bigint, 'a change to the supplier order ends its until_change snooze');

-- ------------------------------------------------------------------ the clearing function is not callable by a client
select is(pg_temp.as_('sales', 'select public.clear_until_change_snoozes()::text'), 'E:42501', 'nobody can call the trigger function');

-- ------------------------------------------------------------------ sent_confirmed_at: an engineer stamps a visible inquiry
select is(pg_temp.as_('engineer', $q$with u as (update public.supplier_inquiries set sent_confirmed_at = now() where id = 'f0000000-0000-4000-8000-000000009701' returning sent_confirmed_at) select (sent_confirmed_at is not null)::text from u$q$),
  'true', 'an engineer stamps "Yes, sent" on an inquiry they can see, and the stamp is there');
-- as_ rolls each statement back, so the owner writes the stamp the later checks read
update public.supplier_inquiries set sent_confirmed_at = now() where id = 'f0000000-0000-4000-8000-000000009701';
select is((select sent_confirmed_at is not null from public.supplier_inquiries where id = 'f0000000-0000-4000-8000-000000009701'), true, 'and it can be stored');
select is(pg_temp.as_('engineer', $q$select (sent_confirmed_at is not null)::text from public.supplier_inquiries where id = 'f0000000-0000-4000-8000-000000009701'$q$),
  'true', 'an engineer reads the stamp');
select is(pg_temp.as_('sales', $q$with u as (update public.supplier_inquiries set sent_confirmed_at = now() where id = 'f0000000-0000-4000-8000-000000009701' returning 1) select count(*)::text from u$q$),
  '1', 'sales stamp it too');
select is(pg_temp.as_('deactivated', $q$with u as (update public.supplier_inquiries set sent_confirmed_at = null where id = 'f0000000-0000-4000-8000-000000009701' returning 1) select count(*)::text from u$q$),
  '0', 'a deactivated person sees no inquiry, so stamps none');
select is((select sent_confirmed_at is not null from public.supplier_inquiries where id = 'f0000000-0000-4000-8000-000000009701'), true, 'the stamp is still there after the refused write');

select * from finish();
rollback;
