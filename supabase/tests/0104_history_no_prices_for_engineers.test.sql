begin;
select * from no_plan();

-- 0104: an engineer's record_history answer carries no tax, rate or price key, even where the column grant allows it (gst_rate).
-- Admin and sales still see them. Fictional fixtures only.

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('f4000000-0000-4000-8000-0000000000' || h)::uuid $$;

create function pg_temp.hist(persona text, tbl text, id uuid) returns jsonb language plpgsql as $f$
declare
  v text;
  d text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
    execute format('select public.record_history(%L, %L, null, 200)::text', tbl, id) into v;
    raise exception 'done' using errcode = 'P0999', detail = coalesce(v, '<null>');
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d::jsonb;
    when others then
      return jsonb_build_object('error', sqlstate);
  end;
end;
$f$;

-- every key of every event's was and now
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select jsonb_object_keys(e -> side)
  from jsonb_array_elements(j -> 'events') e, unnest(array['was', 'now']) side
  where jsonb_typeof(e -> side) = 'object'
$$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Hr Traders');
insert into public.rfqs (id, company_id, owner_id) values (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description, quoted_unit_price_net, gst_rate) values (pg_temp.f('11'), pg_temp.f('10'), 'Hr rfq item', 70, 18);
insert into public.orders (id, company_id, owner_id) values (pg_temp.f('20'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');
insert into public.order_items (id, order_id, description, unit_price_net, gst_rate) values (pg_temp.f('21'), pg_temp.f('20'), 'Hr order line', 50, 18);
update public.rfq_items set description = 'Hr rfq item renamed', gst_rate = 17 where id = pg_temp.f('11');
update public.order_items set description = 'Hr order line renamed', gst_rate = 17 where id = pg_temp.f('21');

create temp table rfq_adm as select pg_temp.hist('admin', 'rfqs', pg_temp.f('10')) as j;
create temp table rfq_sal as select pg_temp.hist('sales', 'rfqs', pg_temp.f('10')) as j;
create temp table rfq_eng as select pg_temp.hist('engineer', 'rfqs', pg_temp.f('10')) as j;
create temp table ord_adm as select pg_temp.hist('admin', 'orders', pg_temp.f('20')) as j;
create temp table ord_eng as select pg_temp.hist('engineer', 'orders', pg_temp.f('20')) as j;
grant all on rfq_adm, rfq_sal, rfq_eng, ord_adm, ord_eng to public;

select ok(not (select j ? 'error' from rfq_eng), 'the engineer reads the history of an RFQ');
select ok(not (select j ? 'error' from ord_eng), 'and of an order');
select ok((select count(*) > 0 from pg_temp.keys((select j from rfq_adm)) k where k = 'gst_rate'), 'admin sees gst_rate in an RFQ history');
select ok((select count(*) > 0 from pg_temp.keys((select j from rfq_sal)) k where k = 'gst_rate'), 'sales sees gst_rate in an RFQ history');
select ok((select count(*) > 0 from pg_temp.keys((select j from ord_adm)) k where k = 'gst_rate'), 'admin sees gst_rate in an order history');
select is((select count(*)::int from pg_temp.keys((select j from rfq_eng)) k where k = 'gst_rate'), 0, 'the engineer sees no gst_rate in an RFQ history');
select is((select count(*)::int from pg_temp.keys((select j from ord_eng)) k where k = 'gst_rate'), 0, 'nor in an order history');
select is((select string_agg(distinct k, ',') from pg_temp.keys((select j from rfq_eng)) k
           where k ~ '(^|_)(price|prices|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|settled|payable|owed|committed|overhead|deposit|profit|sale|sold|sell|rate)(_|$)'),
  null, 'no price-like key anywhere in the engineer''s RFQ history');
select is((select string_agg(distinct k, ',') from pg_temp.keys((select j from ord_eng)) k
           where k ~ '(^|_)(price|prices|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|settled|payable|owed|committed|overhead|deposit|profit|sale|sold|sell|rate)(_|$)'),
  null, 'nor in the engineer''s order history');
select ok((select exists (select 1 from jsonb_array_elements(j -> 'events') e where e -> 'now' ->> 'description' = 'Hr order line renamed') from ord_eng),
  'the engineer still sees the rename (the history is not emptied)');

select * from finish();
rollback;
