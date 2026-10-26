begin;
select plan(98);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'orders',
  array['id', 'created_at', 'created_by', 'updated_at', 'number', 'company_id', 'site_id', 'contact_id', 'rfq_id',
        'owner_id', 'customer_po_number', 'ordered_on', 'payment_terms_days', 'needs_commissioning',
        'commissioning_planned_on', 'commissioning_done_on', 'cancelled_on', 'cancel_reason', 'notes', 'legacy_flags',
        'legacy_source', 'legacy_review'],   -- 0096: legacy_review
  'orders has the section 2.12 columns and no money columns');
select columns_are('public', 'order_items',
  array['id', 'created_at', 'created_by', 'order_id', 'position', 'description', 'brand_id', 'family_id', 'qty',
        'unit', 'unit_price_net', 'gst_rate', 'is_service', 'supplier_order_id', 'rfq_item_id',
        'supplier_unit_price', 'model_tokens', 'legacy_flags', 'legacy_source'],
  'order_items has the section 2.13 columns (with supplier_unit_price, model_tokens)');
select columns_are('public', 'supplier_orders',
  array['id', 'created_at', 'created_by', 'order_id', 'supplier_id', 'inquiry_id', 'reference', 'placed_on',
        'expected_on', 'received_on', 'delivered_on', 'currency', 'legacy_flags', 'legacy_source', 'last_chased_on', 'chase_count', 'last_chased_by'],
  'supplier_orders has the section 2.14 columns (with currency, and the goods-chase stamp from 0033)');
select columns_are('public', 'order_engineers', array['order_id', 'user_id'],
  'order_engineers has the section 2.15 columns');
select columns_are('public', 'order_costs',
  array['order_id', 'created_at', 'created_by', 'updated_at', 'expected_cost_pkr', 'costs_complete_at',
        'costs_complete_by'],
  'order_costs has the section 2.12a columns');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.orders'::regclass, 'public.order_items'::regclass, 'public.supplier_orders'::regclass,
                         'public.order_engineers'::regclass, 'public.order_costs'::regclass)),
  'RLS is enabled on all five tables');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'orders'),
  array['orders_delete_admin', 'orders_insert_staff', 'orders_select_staff', 'orders_update_staff'],
  'orders policies');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'order_costs'),
  array['order_costs_delete_admin', 'order_costs_insert_admin', 'order_costs_select_admin', 'order_costs_update_admin'],
  'order_costs has admin-only policies');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename in ('order_items', 'supplier_orders', 'order_engineers')), 12,
  'order_items, supplier_orders and order_engineers have four policies each');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid in (select ('public.' || t)::regclass from unnest(array['orders', 'order_items',
                              'supplier_orders', 'order_engineers', 'order_costs']) t)
                        and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on the S05 tables');
select ok((select count(*) = 2 from pg_trigger where not tgisinternal
             and tgname in ('orders_set_updated_at', 'order_costs_set_updated_at')),
  'orders and order_costs have updated_at triggers');
select ok((select indexdef like '%USING gin (model_tokens)%' from pg_indexes
           where schemaname = 'public' and indexname = 'order_items_model_tokens_idx'),
  'order_items.model_tokens has a GIN index');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.orders'::regclass and contype = 'f'
                    and confrelid = 'public.rfqs'::regclass and confdeltype = 'r'),
  'orders.rfq_id is RESTRICT');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.order_items'::regclass and contype = 'f'
                    and confrelid = 'public.supplier_orders'::regclass and confdeltype = 'n'),
  'order_items.supplier_order_id is SET NULL');

-- ------------------------------------------------------------------ constraints (as owner)
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier'),
  ('c0000000-0000-4000-8000-000000000003', 'Other Customer');
insert into public.orders (id, company_id, owner_id, customer_po_number, updated_at) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'PO-1', '2020-01-01 00:00:00+00');

select is((select ordered_on from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  public.today_pkt(), 'ordered_on defaults to today in Karachi');
select is((select needs_commissioning from public.orders where id = 'a1000000-0000-4000-8000-000000000001'), false,
  'needs_commissioning defaults to false');
select ok((select number is not null from public.orders where id = 'a1000000-0000-4000-8000-000000000001'),
  'number is generated');
select throws_ok($$insert into public.orders (company_id, number)
                   values ('c0000000-0000-4000-8000-000000000001', 5)$$,
  '428C9', null, 'number cannot be set by an insert');
select throws_ok($$insert into public.orders (company_id) values ('c0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'owner_id may be NULL only with the owner_unknown legacy flag');
select lives_ok($$insert into public.orders (company_id, legacy_flags)
                  values ('c0000000-0000-4000-8000-000000000001', array['owner_unknown'])$$,
  'a legacy order flagged owner_unknown may have no owner');
select throws_ok($$insert into public.orders (company_id, owner_id, ordered_on)
                   values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null)$$,
  '23514', null, 'ordered_on may be NULL only with the undated legacy flag');
select lives_ok($$insert into public.orders (company_id, owner_id, ordered_on, legacy_flags)
                  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', null,
                          array['undated'])$$,
  'a legacy order flagged undated may have no date');
select throws_ok($$insert into public.orders (company_id, owner_id, customer_po_number)
                   values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'PO-1')$$,
  '23505', null, 'same PO number for the same company is rejected');
select lives_ok($$insert into public.orders (company_id, owner_id, customer_po_number)
                  values ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'PO-1')$$,
  'same PO number for another company is accepted');
select lives_ok($$insert into public.orders (company_id, owner_id, customer_po_number, legacy_flags)
                  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'PO-1',
                          array['po_shared'])$$,
  'a po_shared legacy order may repeat a PO number');
select lives_ok($$insert into public.orders (company_id, owner_id)
                  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
                         ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002')$$,
  'orders without a PO number never collide');
select throws_ok($$insert into public.orders (company_id, owner_id, payment_terms_days)
                   values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', -1)$$,
  '23514', null, 'payment_terms_days cannot be negative');
update public.orders set cancelled_on = '2026-10-10' where id = 'a1000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.orders
           where id = 'a1000000-0000-4000-8000-000000000001'),
  'orders.updated_at is bumped by the trigger');

-- supplier_orders
insert into public.supplier_orders (id, order_id, supplier_id) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002');
select ok((select currency is null from public.supplier_orders where id = 'a2000000-0000-4000-8000-000000000001'),
  'a leg needs only an order and a supplier; currency may be empty');
select lives_ok($$update public.supplier_orders set currency = 'USD'
                  where id = 'a2000000-0000-4000-8000-000000000001'$$, 'a valid leg currency is accepted');
select throws_ok($$update public.supplier_orders set currency = 'usd'
                   where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a lower-case leg currency is rejected');
select throws_ok($$update public.supplier_orders set currency = 'US'
                   where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a two-letter leg currency is rejected');

-- order_items
insert into public.order_items (id, order_id, description, unit_price_net, supplier_order_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Hach HQ1110 portable meter',
   1000, 'a2000000-0000-4000-8000-000000000001');
select is((select gst_rate from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'), 18::numeric,
  'gst_rate defaults to 18');
select is((select qty from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'), 1::numeric,
  'qty defaults to 1');
select is((select is_service from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'), false,
  'is_service defaults to false');
select ok((select supplier_unit_price is null from public.order_items
           where id = 'a3000000-0000-4000-8000-000000000001'),
  'supplier_unit_price is optional');
select is((select model_tokens from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'),
  array['HQ1110'], 'model_tokens is generated from the description');
select throws_ok($$insert into public.order_items (order_id, description, unit_price_net, model_tokens)
                   values ('a1000000-0000-4000-8000-000000000001', 'x', 1, '{A1B2}')$$,
  '428C9', null, 'model_tokens cannot be written');
select throws_ok($$insert into public.order_items (order_id, description)
                   values ('a1000000-0000-4000-8000-000000000001', 'x')$$,
  '23502', null, 'unit_price_net is required');
select throws_ok($$insert into public.order_items (order_id, unit_price_net)
                   values ('a1000000-0000-4000-8000-000000000001', 1)$$,
  '23502', null, 'description is required');
select throws_ok($$insert into public.order_items (order_id, description, unit_price_net)
                   values ('a1000000-0000-4000-8000-000000000001', 'x', -1)$$,
  '23514', null, 'a negative sale price is rejected');
select throws_ok($$insert into public.order_items (order_id, description, unit_price_net, qty)
                   values ('a1000000-0000-4000-8000-000000000001', 'x', 1, 0)$$,
  '23514', null, 'qty must be positive');
select throws_ok($$insert into public.order_items (order_id, description, unit_price_net, gst_rate)
                   values ('a1000000-0000-4000-8000-000000000001', 'x', 1, 100.5)$$,
  '23514', null, 'gst_rate above 100 is rejected');
select throws_ok($$insert into public.order_items (order_id, description, unit_price_net, supplier_unit_price)
                   values ('a1000000-0000-4000-8000-000000000001', 'x', 1, -0.0001)$$,
  '23514', null, 'a negative supplier price is rejected');
select lives_ok($$insert into public.order_items (id, order_id, description, unit_price_net, gst_rate,
                                                  supplier_unit_price, is_service)
                  values ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
                          'Commissioning', 0, 0, 0, true)$$,
  'a free, GST-exempt service line with a zero supplier price is accepted');
select lives_ok($$update public.order_items set supplier_unit_price = 12.3456
                  where id = 'a3000000-0000-4000-8000-000000000001'$$,
  'supplier_unit_price takes four decimals');
select is((select supplier_unit_price from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'),
  12.3456::numeric, 'four decimals are kept');

delete from public.supplier_orders where id = 'a2000000-0000-4000-8000-000000000001';
select ok((select supplier_order_id is null from public.order_items where id = 'a3000000-0000-4000-8000-000000000001'),
  'deleting a leg unsources its items');

-- order_engineers and order_costs
insert into public.order_engineers (order_id, user_id)
  values ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
select throws_ok($$insert into public.order_engineers (order_id, user_id)
                   values ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003')$$,
  '23505', null, 'an engineer is assigned to an order once');
insert into public.order_costs (order_id, expected_cost_pkr, updated_at)
  values ('a1000000-0000-4000-8000-000000000001', 500, '2020-01-01 00:00:00+00');
select throws_ok($$insert into public.order_costs (order_id, expected_cost_pkr)
                   values ('a1000000-0000-4000-8000-000000000001', 1)$$,
  '23505', null, 'one order_costs row per order');
select throws_ok($$update public.order_costs set expected_cost_pkr = -1
                   where order_id = 'a1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'expected_cost_pkr cannot be negative');
update public.order_costs set expected_cost_pkr = 0 where order_id = 'a1000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2020-01-01 00:00:00+00' from public.order_costs
           where order_id = 'a1000000-0000-4000-8000-000000000001'),
  'order_costs.updated_at is bumped by the trigger');

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.orders where id = 'a1000000-0000-4000-8000-000000000001'), 1,
  'sales reads orders');
select lives_ok($$insert into public.orders (id, company_id) values
                  ('a1000000-0000-4000-8000-0000000000b2', 'c0000000-0000-4000-8000-000000000001')$$,
  'sales inserts an order with only a company');
select is((select owner_id from public.orders where id = 'a1000000-0000-4000-8000-0000000000b2'),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'orders.owner_id defaults to the caller');
select is(public.t_rows($q$update public.orders set notes = 'n' where id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'sales updates an order');
select is(public.t_rows($q$delete from public.orders where id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 0,
  'sales cannot delete an order');
select lives_ok($$insert into public.supplier_orders (id, order_id, supplier_id)
                  values ('a2000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000b2',
                          'c0000000-0000-4000-8000-000000000002')$$, 'sales inserts a leg');
select lives_ok($$insert into public.order_items (id, order_id, description, unit_price_net)
                  values ('a3000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000b2', 'Item', 5)$$,
  'sales inserts an order item');
select is(public.t_rows($q$delete from public.order_items where id = 'a3000000-0000-4000-8000-0000000000b2'$q$), 1,
  'sales deletes an order item');
select is(public.t_rows($q$delete from public.supplier_orders where id = 'a2000000-0000-4000-8000-0000000000b2'$q$), 1,
  'sales deletes a leg');
select lives_ok($$insert into public.order_engineers (order_id, user_id)
                  values ('a1000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000003')$$,
  'sales assigns an engineer');
select is(public.t_rows($q$delete from public.order_engineers where order_id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'sales unassigns an engineer');
select is((select count(*)::int from public.order_costs), 0, 'sales sees no order_costs rows');
select throws_ok($$insert into public.order_costs (order_id) values ('a1000000-0000-4000-8000-0000000000b2')$$,
  '42501', null, 'sales cannot insert order_costs');
select is(public.t_rows($q$update public.order_costs set expected_cost_pkr = 1$q$), 0,
  'sales cannot update order_costs');
select is(public.t_rows($q$delete from public.order_costs$q$), 0, 'sales cannot delete order_costs');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.orders where id = 'a1000000-0000-4000-8000-000000000001'), 1,
  'engineer reads orders');
select is((select count(*)::int from public.order_items), 2, 'engineer reads order items (sale prices)');
select is((select count(*)::int from public.order_costs), 0, 'engineer gets 0 rows from order_costs');
select throws_ok($$insert into public.order_costs (order_id) values ('a1000000-0000-4000-8000-0000000000b2')$$,
  '42501', null, 'engineer cannot insert order_costs');
select is(public.t_rows($q$update public.order_costs set expected_cost_pkr = 1$q$), 0,
  'engineer cannot update order_costs');
select is(public.t_rows($q$delete from public.order_costs$q$), 0, 'engineer cannot delete order_costs');
select is(public.t_rows($q$update public.orders set commissioning_done_on = '2026-10-12'
                           where id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'engineer marks commissioning done on an order');
select lives_ok($$insert into public.orders (id, company_id) values
                  ('a1000000-0000-4000-8000-0000000000c3', 'c0000000-0000-4000-8000-000000000001')$$,
  'engineer inserts an order (WhatsApp / repeat order path)');
select is(public.t_rows($q$delete from public.orders where id = 'a1000000-0000-4000-8000-0000000000c3'$q$), 0,
  'engineer cannot delete an order');
select lives_ok($$insert into public.order_items (order_id, description, unit_price_net)
                  values ('a1000000-0000-4000-8000-0000000000c3', 'Eng item', 1)$$,
  'engineer inserts an order item');

-- ------------------------------------------------------------------ deactivated: fails closed
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.orders), 0, 'deactivated user sees no orders');
select is((select count(*)::int from public.order_items), 0, 'deactivated user sees no order items');
select is((select count(*)::int from public.supplier_orders), 0, 'deactivated user sees no legs');
select is((select count(*)::int from public.order_engineers), 0, 'deactivated user sees no order_engineers');
select is((select count(*)::int from public.order_costs), 0, 'deactivated user sees no order_costs');
select throws_ok($$insert into public.orders (company_id) values ('c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'deactivated user cannot insert an order');
select is(public.t_rows($q$update public.orders set notes = 'x'$q$), 0, 'deactivated user cannot update orders');

-- ------------------------------------------------------------------ admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.order_costs), 1, 'admin reads order_costs');
select lives_ok($$insert into public.order_costs (order_id, expected_cost_pkr, costs_complete_at, costs_complete_by)
                  values ('a1000000-0000-4000-8000-0000000000b2', 100, now(), 'a0000000-0000-4000-8000-000000000001')$$,
  'admin inserts order_costs');
select is((select created_by from public.order_costs where order_id = 'a1000000-0000-4000-8000-0000000000b2'),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'order_costs.created_by defaults to the caller');
select is(public.t_rows($q$update public.order_costs set expected_cost_pkr = 200
                           where order_id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'admin updates order_costs');
select is(public.t_rows($q$delete from public.order_costs
                           where order_id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'admin deletes order_costs');
select lives_ok($$insert into public.order_costs (order_id) values ('a1000000-0000-4000-8000-0000000000b2')$$,
  'admin can create an order_costs row with every field empty');
select is(public.t_rows($q$delete from public.orders where id = 'a1000000-0000-4000-8000-0000000000b2'$q$), 1,
  'admin deletes an order');
select is((select count(*)::int from public.order_costs where order_id = 'a1000000-0000-4000-8000-0000000000b2'), 0,
  'deleting an order cascades to its order_costs');
select is(public.t_rows($q$delete from public.orders where id = 'a1000000-0000-4000-8000-0000000000c3'$q$), 1,
  'admin deletes an order created by an engineer');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.orders$$, '42501', null, 'anon cannot read orders');
select throws_ok($$select * from public.order_items$$, '42501', null, 'anon cannot read order_items');
select throws_ok($$select * from public.supplier_orders$$, '42501', null, 'anon cannot read supplier_orders');
select throws_ok($$select * from public.order_engineers$$, '42501', null, 'anon cannot read order_engineers');
select throws_ok($$select * from public.order_costs$$, '42501', null, 'anon cannot read order_costs');
reset role;

select * from finish();
rollback;
