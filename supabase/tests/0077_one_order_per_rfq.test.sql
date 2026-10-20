begin;
select * from no_plan();

-- 0077 (BUG-CONC-1): one RFQ is won once. Two people pressing Mark won -> Create order on the same RFQ each send their own order id;
-- the second is refused with "This RFQ is already order ORD-…" and hint rfq_has_order:<id> (the app opens that order). The same id
-- sent again (a retry of one dialog) still returns its order. A cancelled order does not block a new one. The RFQ row is locked
-- (SELECT … FOR UPDATE), so two sessions converting at once run one after the other; the e2e suite verify-resilience drives that
-- with two browsers. Fixture users from supabase/seed.sql: admin a0..01, sales a0..02.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values ('c7700000-0000-4000-8000-000000000001', 'Won Once Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('d7700000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty, quoted_unit_price_net, gst_rate) values
  ('d7710000-0000-4000-8000-000000000001', 'd7700000-0000-4000-8000-000000000001', 0, 'Ultrasonic level transmitter', 2, 48500, 18);

-- The refusal's hint, read back (throws_ok checks only code and message).
create function pg_temp.hint_of(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end
$f$;

select ok((select p.prosrc ilike '%from public.rfqs where id = p_rfq_id for update%' from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'convert_rfq_to_order'),
  'convert_rfq_to_order locks the RFQ row before it checks for a live order');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- Person A
select is(public.convert_rfq_to_order('f7700000-0000-4000-8000-000000000001', 'd7700000-0000-4000-8000-000000000001'),
  'f7700000-0000-4000-8000-000000000001'::uuid, 'A converts the RFQ');
select is(public.convert_rfq_to_order('f7700000-0000-4000-8000-000000000001', 'd7700000-0000-4000-8000-000000000001'),
  'f7700000-0000-4000-8000-000000000001'::uuid, 'A''s retry with the same id returns the same order');

-- Person B, from a dialog opened before A pressed Create order
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.convert_rfq_to_order('f7700000-0000-4000-8000-000000000002', 'd7700000-0000-4000-8000-000000000001')$$,
  'P0001',
  (select format('This RFQ is already order ORD-%s.', lpad(number::text, 4, '0')) from public.orders
   where id = 'f7700000-0000-4000-8000-000000000001'),
  'B''s own order id is refused with the plain sentence naming A''s order');
select is(pg_temp.hint_of($$select public.convert_rfq_to_order('f7700000-0000-4000-8000-000000000002', 'd7700000-0000-4000-8000-000000000001')$$),
  'rfq_has_order:f7700000-0000-4000-8000-000000000001', 'the hint carries A''s order id, so the app opens it');
select is((select count(*)::int from public.orders where rfq_id = 'd7700000-0000-4000-8000-000000000001'), 1, 'one RFQ, one order');
select is((select count(*)::int from public.orders where id = 'f7700000-0000-4000-8000-000000000002'), 0, 'B''s order was not made');

-- A cancelled order does not block winning the RFQ again.
update public.orders set cancelled_on = public.today_pkt() where id = 'f7700000-0000-4000-8000-000000000001';
select is(public.convert_rfq_to_order('f7700000-0000-4000-8000-000000000003', 'd7700000-0000-4000-8000-000000000001'),
  'f7700000-0000-4000-8000-000000000003'::uuid, 'after A''s order is cancelled, the RFQ can be converted again');
select is((select count(*)::int from public.orders where rfq_id = 'd7700000-0000-4000-8000-000000000001' and cancelled_on is null), 1,
  'still one live order');
reset role;

select * from finish();
rollback;
