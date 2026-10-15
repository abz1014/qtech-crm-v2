begin;
select plan(13);

-- R19: customer_price_memory(rfq_id), the two price chips of the issue-quotation dialog. Fixture users come from supabase/seed.sql.

select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'customer_price_memory'
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'customer_price_memory is SECURITY INVOKER with a fixed search_path, executable by authenticated only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000d1', 'R19 Customer'),
  ('c0000000-0000-4000-8000-0000000000d2', 'R19 Other customer');

-- An earlier RFQ for the customer, quoted at 1200 for a flow meter, and an order at 1000 for the same model.
insert into public.rfqs (id, company_id) values
  ('b1000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-0000000000d1'),
  ('b1000000-0000-4000-8000-0000000000d2', 'c0000000-0000-4000-8000-0000000000d1'),
  ('b1000000-0000-4000-8000-0000000000d3', 'c0000000-0000-4000-8000-0000000000d2');
insert into public.rfq_items (id, rfq_id, description, qty, quoted_unit_price_net) values
  ('a1000000-0000-4000-8000-0000000000d1', 'b1000000-0000-4000-8000-0000000000d1', 'Flow meter FM1234 DN50', 1, 1200),
  ('a1000000-0000-4000-8000-0000000000d2', 'b1000000-0000-4000-8000-0000000000d2', 'Flow meter FM1234 DN50 flanged', 2, null),
  ('a1000000-0000-4000-8000-0000000000d3', 'b1000000-0000-4000-8000-0000000000d2', 'Garden hose reel', 1, null),
  ('a1000000-0000-4000-8000-0000000000d4', 'b1000000-0000-4000-8000-0000000000d3', 'Flow meter FM1234 DN50', 1, 9999);

select public.issue_quotation('d1000000-0000-4000-8000-0000000000d1', 'b1000000-0000-4000-8000-0000000000d1');
-- The other customer's quotation for the same model must never show up as a chip for this customer.
select public.issue_quotation('d1000000-0000-4000-8000-0000000000d2', 'b1000000-0000-4000-8000-0000000000d3');

insert into public.orders (id, company_id, ordered_on) values
  ('e1000000-0000-4000-8000-0000000000d1', 'c0000000-0000-4000-8000-0000000000d1', public.today_pkt() - 10),
  ('e1000000-0000-4000-8000-0000000000d2', 'c0000000-0000-4000-8000-0000000000d1', public.today_pkt() - 3),
  ('e1000000-0000-4000-8000-0000000000d3', 'c0000000-0000-4000-8000-0000000000d2', public.today_pkt() - 1);
insert into public.order_items (order_id, description, qty, unit_price_net) values
  ('e1000000-0000-4000-8000-0000000000d1', 'Flow meter FM1234 DN50', 1, 1000),
  ('e1000000-0000-4000-8000-0000000000d2', 'Flow meter FM1234 DN50', 1, 1111),   -- newer, but on a cancelled order
  ('e1000000-0000-4000-8000-0000000000d3', 'Flow meter FM1234 DN50', 1, 5);      -- another customer
update public.orders set cancelled_on = public.today_pkt() where id = 'e1000000-0000-4000-8000-0000000000d2';

select is((select count(*)::int from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 1,
  'only the item with a history gets a row (the unrelated hose reel gets none)');
select is((select rfq_item_id from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')),
  'a1000000-0000-4000-8000-0000000000d2'::uuid, 'the row is the flow meter');
select is((select sold_price from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 1000::numeric,
  'last sold: this customer''s order line, not the cancelled order and not the other customer');
select is((select sold_on from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), public.today_pkt() - 10,
  'last sold carries the order date');
select is((select sold_tier from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 0::smallint,
  'a shared model code is tier 0 (same model)');
select is((select quoted_price from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 1200::numeric,
  'last quoted: this customer''s earlier quotation line, not the other customer''s 9999');
select is((select quoted_revision from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 0::smallint,
  'last quoted carries the revision it came from');
select is((select quoted_on from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), public.today_pkt(),
  'last quoted carries the issue date');

-- The RFQ being quoted is excluded, so a re-issue does not offer its own earlier prices back.
update public.rfq_items set quoted_unit_price_net = 1300 where rfq_id = 'b1000000-0000-4000-8000-0000000000d2';
select public.issue_quotation('d1000000-0000-4000-8000-0000000000d3', 'b1000000-0000-4000-8000-0000000000d2');
select is((select quoted_price from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 1200::numeric,
  'the RFQ''s own quotation is not a chip for itself');

-- Another customer's RFQ sees only its own history.
select is((select quoted_price from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d3')), null::numeric,
  'the other customer has no earlier quotation to itself');
select is((select sold_price from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d3')), 5::numeric,
  'the other customer''s last sold is its own order');

-- Deactivated users get nothing (RLS on every table read).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.customer_price_memory('b1000000-0000-4000-8000-0000000000d2')), 0,
  'a deactivated user reads nothing');
reset role;

select * from finish();
rollback;
