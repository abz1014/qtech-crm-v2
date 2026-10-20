begin;
select plan(13);

-- R05: float_rfq's p_is_priority and the atomic Undo (set_rfq_floated). Fixture users come from supabase/seed.sql.

select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('float_rfq', 'set_rfq_floated')
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'float_rfq and set_rfq_floated are SECURITY INVOKER with a fixed search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'float_rfq'), 1,
  'there is exactly one float_rfq (the old signature was replaced, not overloaded)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-0000000000a1', 'R05 Customer'),
  ('c0000000-0000-4000-8000-0000000000a2', 'R05 Supplier One'),
  ('c0000000-0000-4000-8000-0000000000a3', 'R05 Supplier Two');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(public.float_rfq('d0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1',
            '[{"description":"Pump A"}]'::jsonb,
            array['c0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000a3']::uuid[],
            null, null, null, null, true, true) ->> 'id',
  'd0000000-0000-4000-8000-0000000000a1', 'float_rfq accepts p_is_priority (0070: returns {"id", "created"})');
select is((select is_priority from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a1'), true,
  'and the RFQ is top priority');

select lives_ok($$select public.float_rfq('d0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000a1',
                    '[{"description":"Pump B"}]'::jsonb)$$, 'a call without p_is_priority still works');
select is((select is_priority from public.rfqs where id = 'd0000000-0000-4000-8000-0000000000a2'), false,
  'and is not priority by default');

-- Undo: both inquiries were stamped today, so both go back to shortlisted in one statement.
select is(public.set_rfq_floated('d0000000-0000-4000-8000-0000000000a1', false), 2, 'Undo reports the two inquiries it reverted');
select is((select count(*)::int from public.supplier_inquiries
           where rfq_id = 'd0000000-0000-4000-8000-0000000000a1' and sent_on is null), 2,
  'both are shortlisted again (sent_on empty), none deleted');
select is(public.set_rfq_floated('d0000000-0000-4000-8000-0000000000a1', false), 0, 'a second Undo changes nothing');

-- Float it now: every shortlisted inquiry is stamped today.
select is(public.set_rfq_floated('d0000000-0000-4000-8000-0000000000a1', true), 2, 'floating a saved RFQ stamps both inquiries');
select is((select count(*)::int from public.supplier_inquiries
           where rfq_id = 'd0000000-0000-4000-8000-0000000000a1' and sent_on = public.today_pkt()), 2, 'with today''s date');

-- An inquiry that has moved on is never reverted: one chased, one sent on an earlier day.
update public.supplier_inquiries set last_chased_on = public.today_pkt(), chase_count = 1
  where rfq_id = 'd0000000-0000-4000-8000-0000000000a1' and supplier_id = 'c0000000-0000-4000-8000-0000000000a2';
update public.supplier_inquiries set sent_on = public.today_pkt() - 1
  where rfq_id = 'd0000000-0000-4000-8000-0000000000a1' and supplier_id = 'c0000000-0000-4000-8000-0000000000a3';
select is(public.set_rfq_floated('d0000000-0000-4000-8000-0000000000a1', false), 0,
  'Undo leaves a chased inquiry and an earlier day''s inquiry alone');

select throws_ok($$select public.set_rfq_floated('d0000000-0000-4000-8000-0000000000ff', false)$$, 'P0002', null,
  'an unknown RFQ is an error, not a silent no-op');

reset role;
select * from finish();
rollback;
