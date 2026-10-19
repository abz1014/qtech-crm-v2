begin;
select plan(11);

-- 0048: who made the last chase. Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.

select has_column('public', 'clarifications', 'last_asked_by', 'clarifications.last_asked_by exists');
select has_column('public', 'supplier_inquiries', 'last_chased_by', 'supplier_inquiries.last_chased_by exists');
select has_column('public', 'supplier_orders', 'last_chased_by', 'supplier_orders.last_chased_by exists');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000f1', '0048 Customer'),
  ('c0000000-0000-4000-8000-0000000000f2', '0048 Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000002');
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('e0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000f2', public.today_pkt() - 5);
insert into public.clarifications (id, rfq_id, question, first_asked_at, last_asked_at, ask_count) values
  ('f2000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000f1', 'Q?', now() - interval '5 days', now() - interval '5 days', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select last_asked_by from public.clarifications where id = 'f2000000-0000-4000-8000-0000000000f1'), null::uuid, 'history has no actor');
select is(public.stamp_clarification_ask(array['f2000000-0000-4000-8000-0000000000f1']::uuid[]), 1, 'sales stamps an ask');
select is((select last_asked_by from public.clarifications where id = 'f2000000-0000-4000-8000-0000000000f1'), 'a0000000-0000-4000-8000-000000000002'::uuid, 'and is recorded as who asked');

select is(public.stamp_supplier_chase('e0000000-0000-4000-8000-0000000000f1')::int, 1, 'sales chases a supplier');
select is((select last_chased_by from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000f1'), 'a0000000-0000-4000-8000-000000000002'::uuid, 'and is recorded as who chased');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(public.stamp_supplier_chase('e0000000-0000-4000-8000-0000000000f1')::int, 2, 'the engineer chases next');
select is((select last_chased_by from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000f1'), 'a0000000-0000-4000-8000-000000000003'::uuid, 'and the name moves to them');

-- An Undo restores the stamp. Since 0065 (security review L-1) a signed-in caller cannot name the actor: the earlier
-- chaser cannot be proven, so an Undo leaves no name rather than a possibly wrong one.
update public.supplier_inquiries set last_chased_on = public.today_pkt() - 1, chase_count = 1, last_chased_by = 'a0000000-0000-4000-8000-000000000002'
  where id = 'e0000000-0000-4000-8000-0000000000f1';
select is((select last_chased_by from public.supplier_inquiries where id = 'e0000000-0000-4000-8000-0000000000f1'), null::uuid, 'an Undo leaves no actor (0065: a named actor is ignored)');

select * from finish();
rollback;
