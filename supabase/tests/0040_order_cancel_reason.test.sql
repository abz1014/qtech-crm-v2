begin;
select plan(16);

-- O03: the cancel reason is structured (orders.cancel_reason), never appended to the notes.
-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04.

-- ------------------------------------------------------------------ shape
select has_column('public', 'orders', 'cancel_reason', 'orders has cancel_reason');
select col_is_null('public', 'orders', 'cancel_reason', 'cancel_reason is nullable');
select col_type_is('public', 'orders', 'cancel_reason', 'text', 'cancel_reason is text');
select has_check('public', 'orders', 'orders has check constraints');
select is((select count(*)::int from pg_constraint
           where conrelid = 'public.orders'::regclass and conname in ('orders_cancel_reason_check', 'orders_cancel_reason_needs_cancelled_on')),
  2, 'both checks exist: the key list, and a reason needs cancelled_on');

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-0000000000c1', 'O03 Customer');
insert into public.orders (id, company_id, notes) values
  ('d0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c1', 'Gate pass needed 2 days ahead.');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- ------------------------------------------------------------------ the keys
select lives_ok($$update public.orders set cancelled_on = public.today_pkt(), cancel_reason = 'customer_cancelled'
                  where id = 'd0000000-0000-4000-8000-0000000000c1'$$, 'a reason is saved together with cancelled_on');
select is((select cancel_reason from public.orders where id = 'd0000000-0000-4000-8000-0000000000c1'), 'customer_cancelled', 'and reads back');
select is((select lifecycle from public.v_order_state where order_id = 'd0000000-0000-4000-8000-0000000000c1'), 'cancelled',
  'v_order_state still says cancelled (its meaning is unchanged)');
select is((select notes from public.orders where id = 'd0000000-0000-4000-8000-0000000000c1'), 'Gate pass needed 2 days ahead.',
  'the notes are untouched by a cancel');

select lives_ok($$update public.orders set cancel_reason = 'lost_to_competitor' where id = 'd0000000-0000-4000-8000-0000000000c1'$$,
  'the reason can be corrected while the order stays cancelled');
select throws_ok($$update public.orders set cancel_reason = 'because' where id = 'd0000000-0000-4000-8000-0000000000c1'$$, '23514', null,
  'a key outside the list is refused');
select throws_ok($$update public.orders set cancelled_on = null where id = 'd0000000-0000-4000-8000-0000000000c1'$$, '23514', null,
  'reopening without clearing the reason is refused (a reason needs cancelled_on)');
select lives_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'd0000000-0000-4000-8000-0000000000c1'$$,
  'reopening clears both together');
select throws_ok($$update public.orders set cancel_reason = 'other' where id = 'd0000000-0000-4000-8000-0000000000c1'$$, '23514', null,
  'a reason on an active order is refused');

-- ------------------------------------------------------------------ every key in the list is accepted
select lives_ok($$update public.orders set cancelled_on = public.today_pkt(), cancel_reason = 'supplier_cannot_supply' where id = 'd0000000-0000-4000-8000-0000000000c1';
                  update public.orders set cancel_reason = 'price_or_terms' where id = 'd0000000-0000-4000-8000-0000000000c1';
                  update public.orders set cancel_reason = 'duplicate_or_mistake' where id = 'd0000000-0000-4000-8000-0000000000c1';
                  update public.orders set cancel_reason = 'other' where id = 'd0000000-0000-4000-8000-0000000000c1'$$,
  'supplier_cannot_supply, price_or_terms, duplicate_or_mistake and other are all accepted');

-- an engineer works the full CRM on orders (DATA_MODEL section 10), so the same update is theirs too
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$update public.orders set cancelled_on = null, cancel_reason = null where id = 'd0000000-0000-4000-8000-0000000000c1'$$,
  'an engineer can reopen an order, clearing the reason');

select * from finish();
rollback;
