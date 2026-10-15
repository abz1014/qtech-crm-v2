begin;
select plan(11);

-- R16: stamp_goods_chase and the two new supplier_orders columns. Fixture users come from supabase/seed.sql.

select has_column('public', 'supplier_orders', 'last_chased_on', 'supplier_orders.last_chased_on exists');
select col_not_null('public', 'supplier_orders', 'chase_count', 'chase_count is not null');
select col_default_is('public', 'supplier_orders', 'chase_count', '0', 'chase_count defaults to 0');

select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'stamp_goods_chase'
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'stamp_goods_chase is SECURITY INVOKER with a fixed search_path, executable by authenticated only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000c1', 'R16 Customer'),
  ('c0000000-0000-4000-8000-0000000000c2', 'R16 Supplier');
insert into public.orders (id, company_id, owner_id) values
  ('b0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_orders (id, order_id, supplier_id, reference, placed_on, expected_on) values
  ('f1000000-0000-4000-8000-0000000000c1', 'b0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2',
   'PO 253102', public.today_pkt() - 20, public.today_pkt() - 5);

select is((select chase_count from public.supplier_orders where id = 'f1000000-0000-4000-8000-0000000000c1'), 0::smallint,
  'a new leg has not been chased');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.stamp_goods_chase('f1000000-0000-4000-8000-0000000000c1'), 1::smallint, 'sales stamps the first chase and gets the new count');
select is((select last_chased_on from public.supplier_orders where id = 'f1000000-0000-4000-8000-0000000000c1'), public.today_pkt(),
  'last_chased_on is today');
select is(public.stamp_goods_chase('f1000000-0000-4000-8000-0000000000c1'), 2::smallint, 'a second chase counts 2');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.stamp_goods_chase('f1000000-0000-4000-8000-0000000000c1'), 3::smallint, 'an engineer may chase goods too (all staff)');

select throws_ok($$select public.stamp_goods_chase('f1000000-0000-4000-8000-0000000000ff')$$, 'P0002', null,
  'an unknown leg is an error, not a silent no-op');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.stamp_goods_chase('f1000000-0000-4000-8000-0000000000c1')$$, 'P0002', null,
  'a deactivated user cannot see the leg, so the stamp fails');

select * from finish();
rollback;
