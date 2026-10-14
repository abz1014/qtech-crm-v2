begin;
select plan(16);

-- Fixture users come from supabase/seed.sql: admin a0..01, sales a0..02. Run as the table owner.

insert into public.companies (id, name) values ('c0000000-0000-4000-8000-000000000001', 'Customer');
insert into public.company_sites (id, company_id, name) values
  ('51e00000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Used by RFQ'),
  ('51e00000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Used by order'),
  ('51e00000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Unused'),
  ('51e00000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Has contacts');
insert into public.contacts (id, company_id, site_id, name) values
  ('c7e00000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', null, 'On RFQ'),
  ('c7e00000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', null, 'On quotation'),
  ('c7e00000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', null, 'On order'),
  ('c7e00000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', null, 'Unused'),
  ('c7e00000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001',
   '51e00000-0000-4000-8000-000000000004', 'Sited');
insert into public.rfqs (id, company_id, owner_id, site_id, contact_id) values
  ('d7e00000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', '51e00000-0000-4000-8000-000000000001',
   'c7e00000-0000-4000-8000-000000000001');
insert into public.orders (id, company_id, owner_id, site_id, contact_id) values
  ('a7e00000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', '51e00000-0000-4000-8000-000000000002',
   'c7e00000-0000-4000-8000-000000000003');
insert into public.quotations (rfq_id, number, revision, valid_until, lines, net_total, gst_total, contact_id) values
  ('d7e00000-0000-4000-8000-000000000001', 9001, 0, '2030-01-01',
   '[{"description":"A","qty":1,"unit_price_net":1,"gst_rate":0}]'::jsonb, 1, 0,
   'c7e00000-0000-4000-8000-000000000002');

-- ------------------------------------------------------------------ the FK actions
select is((select array_agg(c.conrelid::regclass::text || '.' || a.attname order by c.conrelid::regclass::text || '.' || a.attname)
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid in ('public.company_sites'::regclass, 'public.contacts'::regclass)
             and c.confdeltype = 'r'),
  array['orders.contact_id', 'orders.site_id', 'quotations.contact_id', 'rfqs.contact_id', 'rfqs.site_id'],
  'every FK from RFQs, orders and quotations to sites and contacts is RESTRICT');
select is((select array_agg(c.conrelid::regclass::text || '.' || a.attname)
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid in ('public.company_sites'::regclass, 'public.contacts'::regclass)
             and c.confdeltype = 'n'),
  array['contacts.site_id'], 'contacts.site_id is the only one left SET NULL');

-- ------------------------------------------------------------------ sites
select throws_ok($$delete from public.company_sites where id = '51e00000-0000-4000-8000-000000000001'$$,
  '23503', null, 'a site used by an RFQ cannot be deleted');
select throws_ok($$delete from public.company_sites where id = '51e00000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a site used by an order cannot be deleted');
select is((select site_id from public.rfqs where id = 'd7e00000-0000-4000-8000-000000000001'),
  '51e00000-0000-4000-8000-000000000001'::uuid, 'the RFQ still has its site');
select is((select site_id from public.orders where id = 'a7e00000-0000-4000-8000-000000000001'),
  '51e00000-0000-4000-8000-000000000002'::uuid, 'the order still has its site');
select lives_ok($$delete from public.company_sites where id = '51e00000-0000-4000-8000-000000000003'$$,
  'an unused site can be deleted');

-- ------------------------------------------------------------------ contacts
select throws_ok($$delete from public.contacts where id = 'c7e00000-0000-4000-8000-000000000001'$$,
  '23503', null, 'a contact used by an RFQ cannot be deleted');
select throws_ok($$delete from public.contacts where id = 'c7e00000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a contact used by a quotation cannot be deleted');
select throws_ok($$delete from public.contacts where id = 'c7e00000-0000-4000-8000-000000000003'$$,
  '23503', null, 'a contact used by an order cannot be deleted');
select is((select contact_id from public.rfqs where id = 'd7e00000-0000-4000-8000-000000000001'),
  'c7e00000-0000-4000-8000-000000000001'::uuid, 'the RFQ still has its contact');
select is((select contact_id from public.quotations where number = 9001),
  'c7e00000-0000-4000-8000-000000000002'::uuid, 'the quotation still has its contact');
select lives_ok($$delete from public.contacts where id = 'c7e00000-0000-4000-8000-000000000004'$$,
  'an unused contact can be deleted');

-- ------------------------------------------------------------------ a contact outlives its site
select lives_ok($$delete from public.company_sites where id = '51e00000-0000-4000-8000-000000000004'$$,
  'a site with contacts but no RFQ or order can be deleted');
select is((select site_id from public.contacts where id = 'c7e00000-0000-4000-8000-000000000005'), null,
  'its contact stays, with site_id NULL');

select * from finish();
rollback;
