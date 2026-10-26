begin;
select plan(15);

-- R22: attachments.order_id (0042). Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03

create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select has_column('public', 'attachments', 'order_id', 'attachments.order_id exists');
select ok(exists (select 1 from pg_constraint
                  where conrelid = 'public.attachments'::regclass and contype = 'f'
                    and confrelid = 'public.orders'::regclass and confdeltype = 'c'),
  'attachments.order_id is CASCADE');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'attachments_order_idx'),
  'attachments_order_idx exists');

-- ------------------------------------------------------------------ fixtures (as owner)
insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.orders (id, company_id, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.clarifications (id, rfq_id, question) values
  ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Voltage?');

-- ------------------------------------------------------------------ constraints
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id, has_prices)
                  values ('e1000000-0000-4000-8000-000000000001', 'rfq-files', 'o1/a.jpg', 'a.jpg', 'image/jpeg', 1000,
                          'a1000000-0000-4000-8000-000000000001', false)$$,
  'an order attachment in rfq-files is accepted');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id)
                   values ('gst-receipts', 'o1/b.jpg', 'b.jpg', 'image/jpeg', 1000, 'a1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an order attachment must be in rfq-files (gst-receipts is rejected)');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id)
                   values ('expense-receipts', 'o1/c.jpg', 'c.jpg', 'image/jpeg', 1000, 'a1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an order attachment must be in rfq-files (expense-receipts is rejected)');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id, rfq_id)
                   values ('rfq-files', 'o1/d.jpg', 'd.jpg', 'image/jpeg', 1000, 'a1000000-0000-4000-8000-000000000001',
                           'd0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'one parent: an order and an RFQ together are rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id, clarification_id)
                   values ('rfq-files', 'o1/e.jpg', 'e.jpg', 'image/jpeg', 1000, 'a1000000-0000-4000-8000-000000000001',
                           'b0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an order file cannot be narrowed to a clarification (that needs an RFQ)');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes)
                   values ('rfq-files', 'o1/f.jpg', 'f.jpg', 'image/jpeg', 1000)$$,
  '23514', null, 'one parent: no parent is still rejected');
select throws_ok($$insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, order_id)
                   values ('rfq-files', 'o1/g.jpg', 'g.jpg', 'image/jpeg', 5242881, 'a1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an order file is held to 5 MB too');

-- ------------------------------------------------------------------ who can see and change them
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.attachments where order_id is not null), 1, 'an engineer sees order files');
select lives_ok($$insert into public.attachments (id, bucket, path, file_name, mime_type, size_bytes, order_id)
                  values ('e1000000-0000-4000-8000-000000000002', 'rfq-files', 'o2/a.jpg', 'a.jpg', 'image/jpeg', 1000,
                          'a1000000-0000-4000-8000-000000000002')$$,
  'an engineer can attach a file to an order');
select is(public.t_rows($q$update public.attachments set file_name = 'x.jpg' where order_id is not null$q$), 2,
  'an engineer can rename order files');
select is(public.t_rows($q$delete from public.attachments where id = 'e1000000-0000-4000-8000-000000000002'$q$), 1,
  'an engineer can remove an order file');
reset role;

-- ------------------------------------------------------------------ cascade
delete from public.orders where id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.attachments where order_id = 'a1000000-0000-4000-8000-000000000001'), 0,
  'deleting the order removes its file rows');

select * from finish();
rollback;
