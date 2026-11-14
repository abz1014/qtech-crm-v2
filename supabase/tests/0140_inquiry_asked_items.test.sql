-- 0140_inquiry_asked_items: supplier_inquiries.asked_item_ids says which items a supplier was asked about (NULL = every item).
-- Fixture: RFQ R1 with items I1, I2, I3; RFQ R2 with item J1. Supplier S asked on R1 about I1 and I2 only; supplier T asked on
-- R1 the old way (NULL). Users come from supabase/seed.sql: admin a0..01, sales a0..02, engineer a0..03.
begin;
select * from no_plan();

create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case persona
    when 'admin' then 'a0000000-0000-4000-8000-000000000001'
    when 'sales' then 'a0000000-0000-4000-8000-000000000002'
    else 'a0000000-0000-4000-8000-000000000003' end, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform qtech_private.pre_request();
    execute stmt;
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  return r;
end $f$;

-- ------------------------------------------------------------------ shape
select has_column('public', 'supplier_inquiries', 'asked_item_ids', 'supplier_inquiries.asked_item_ids exists');
select col_type_is('public', 'supplier_inquiries', 'asked_item_ids', 'uuid[]', 'it is a list of item ids');
select col_is_null('public', 'supplier_inquiries', 'asked_item_ids', 'it is nullable (NULL = every item)');
select col_hasnt_default('public', 'supplier_inquiries', 'asked_item_ids', 'it has no default, so an inquiry means every item unless told');

-- ------------------------------------------------------------------ fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('01400000-0000-4000-8000-0000000000c1', '0140 Customer'),
  ('01400000-0000-4000-8000-0000000000c2', '0140 Supplier S'),
  ('01400000-0000-4000-8000-0000000000c3', '0140 Supplier T');
insert into public.rfqs (id, company_id, owner_id) values
  ('01400000-0000-4000-8000-0000000000d1', '01400000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000002'),
  ('01400000-0000-4000-8000-0000000000d2', '01400000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description) values
  ('01400000-0000-4000-8000-0000000000e1', '01400000-0000-4000-8000-0000000000d1', 0, '0140 item one'),
  ('01400000-0000-4000-8000-0000000000e2', '01400000-0000-4000-8000-0000000000d1', 1, '0140 item two'),
  ('01400000-0000-4000-8000-0000000000e3', '01400000-0000-4000-8000-0000000000d1', 2, '0140 item three'),
  ('01400000-0000-4000-8000-0000000000f1', '01400000-0000-4000-8000-0000000000d2', 0, '0140 other RFQ item');

-- ------------------------------------------------------------------ an ask about some items
select is(pg_temp.as_('sales', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, asked_item_ids) values
  ('01400000-0000-4000-8000-0000000000a1', '01400000-0000-4000-8000-0000000000d1', '01400000-0000-4000-8000-0000000000c2', public.today_pkt(),
   array['01400000-0000-4000-8000-0000000000e1', '01400000-0000-4000-8000-0000000000e2']::uuid[])$q$), 'ok',
  'sales records an ask about two of the three items');
select is((select asked_item_ids from public.supplier_inquiries where id = '01400000-0000-4000-8000-0000000000a1'),
  array['01400000-0000-4000-8000-0000000000e1', '01400000-0000-4000-8000-0000000000e2']::uuid[], 'and the two items read back');
select is(pg_temp.as_('sales', $q$insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('01400000-0000-4000-8000-0000000000a2', '01400000-0000-4000-8000-0000000000d1', '01400000-0000-4000-8000-0000000000c3', public.today_pkt())$q$), 'ok',
  'an ask the old way still works');
select is((select asked_item_ids from public.supplier_inquiries where id = '01400000-0000-4000-8000-0000000000a2'), null::uuid[],
  'and leaves the list NULL: asked about every item');

-- ------------------------------------------------------------------ widening, and the checks
select is(pg_temp.as_('engineer', $q$update public.supplier_inquiries set asked_item_ids = asked_item_ids || '01400000-0000-4000-8000-0000000000e3'::uuid
  where id = '01400000-0000-4000-8000-0000000000a1'$q$), 'ok', 'an engineer can widen the list (asking is not price work)');
select is((select cardinality(asked_item_ids) from public.supplier_inquiries where id = '01400000-0000-4000-8000-0000000000a1'), 3,
  'the list now has three items');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set asked_item_ids = null where id = '01400000-0000-4000-8000-0000000000a1'$q$), 'ok',
  'asking about every item sets it back to NULL');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set asked_item_ids = '{}'::uuid[] where id = '01400000-0000-4000-8000-0000000000a1'$q$), '23514',
  'an empty list is refused (NULL says every item)');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set asked_item_ids = array['01400000-0000-4000-8000-0000000000f1']::uuid[]
  where id = '01400000-0000-4000-8000-0000000000a1'$q$), '23503', 'an item of another RFQ is refused');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set asked_item_ids = array['01400000-0000-4000-8000-0000000000ff']::uuid[]
  where id = '01400000-0000-4000-8000-0000000000a1'$q$), '23503', 'an id that is no item is refused');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set notes = '0140 note' where id = '01400000-0000-4000-8000-0000000000a2'$q$), 'ok',
  'other updates of an old inquiry are untouched by the check');

-- ------------------------------------------------------------------ an item removed later stays in the list (never "every item")
update public.supplier_inquiries set asked_item_ids = array['01400000-0000-4000-8000-0000000000e3']::uuid[]
 where id = '01400000-0000-4000-8000-0000000000a1';
delete from public.rfq_items where id = '01400000-0000-4000-8000-0000000000e3';
select is((select asked_item_ids from public.supplier_inquiries where id = '01400000-0000-4000-8000-0000000000a1'),
  array['01400000-0000-4000-8000-0000000000e3']::uuid[], 'removing the only item asked about does not turn the inquiry into every item');
select is(pg_temp.as_('sales', $q$update public.supplier_inquiries set notes = '0140 later note' where id = '01400000-0000-4000-8000-0000000000a1'$q$), 'ok',
  'and the inquiry can still be updated without touching the list');

-- ------------------------------------------------------------------ views keep their meaning
select is((select response_state from public.v_inquiry_state where inquiry_id = '01400000-0000-4000-8000-0000000000a2'), 'awaiting',
  'v_inquiry_state is unchanged for an old inquiry');

select * from finish();
rollback;
