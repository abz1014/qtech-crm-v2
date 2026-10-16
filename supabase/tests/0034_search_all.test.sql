begin;
select plan(51);

-- R12: search_all. Fixture users come from supabase/seed.sql (a0..01 admin, a0..02 sales, a0..03 engineer, a0..04 deactivated).

select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'search_all'
             and not p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'search_all is SECURITY INVOKER with a fixed search_path, executable by authenticated only');

select is((select array_agg(a order by ord) from unnest((select proargnames from pg_proc where proname = 'search_all' and pronamespace = 'public'::regnamespace)) with ordinality t(a, ord)),
  array['q', 'lim', 'kind', 'id', 'label', 'meta', 'company_id', 'order_id', 'role', 'score'],
  'search_all returns names, phones, e-mails, references, order links and a role label only: no amount, price, margin or invoice-amount column (P02, 0054)');

-- ------------------------------------------------------------------ fixture
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name, country) values
  ('c0000000-0000-4000-8000-0000000000e1', 'Zqx Textile Mills', 'Pakistan'),
  ('c0000000-0000-4000-8000-0000000000e2', 'Zqx Energy', 'Germany'),
  ('c0000000-0000-4000-8000-0000000000e3', 'Plain 100% Cotton_Works', null),
  ('c0000000-0000-4000-8000-0000000000e4', 'Quietco', null);
insert into public.contacts (id, company_id, name, phone, email) values
  ('c1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'Naveed Akhtar', '+92 300 555 0142', 'naveed@zqxtextile.example'),
  ('c1000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e2', 'Greta Vogel', '+49 30 1234567', 'greta.vogel@zqxenergy.example'),
  ('c1000000-0000-4000-8000-0000000000e3', 'c0000000-0000-4000-8000-0000000000e4', 'Hira Naveed', null, null),
  ('c1000000-0000-4000-8000-0000000000e4', 'c0000000-0000-4000-8000-0000000000e4', 'Local Format', '0321 7654321', null);
insert into public.rfqs (id, company_id, owner_id, customer_ref) values
  ('d1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000002', 'ENQ-ZQX-2211'),
  ('d1000000-0000-4000-8000-0000000000e2', 'c0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000002', null);
insert into public.orders (id, company_id, owner_id, customer_po_number) values
  ('b1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000002', 'POSECRET9');
insert into public.invoices (id, order_id, company_id, number, net_amount, gst_amount) values
  ('b2000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 'INVSECRET9', 100000, 18000);

insert into public.order_items (id, order_id, position, description, unit_price_net) values
  ('b3000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-0000000000e1', 0, 'Zqx Siemens 6ES7 214-1AG40 PLC', 777123);
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('b4000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e2', 'USD');
insert into public.purchase_orders (id, supplier_order_id, number, revision, currency, total, lines) values
  ('b5000000-0000-4000-8000-0000000000e1', 'b4000000-0000-4000-8000-0000000000e1', 8123, 0, 'USD', 0, '[{"qty":1,"unit_price":1}]');

create temp table fxo as select number from public.orders where id = 'b1000000-0000-4000-8000-0000000000e1';
grant select on fxo to authenticated;
create temp table fx as
select r.id, r.number from public.rfqs r where r.id in ('d1000000-0000-4000-8000-0000000000e1', 'd1000000-0000-4000-8000-0000000000e2');
grant select on fx to authenticated;

-- ------------------------------------------------------------------ sales
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select array_agg(label order by label) from public.search_all('zqx', 8) where kind = 'company'),
  array['Zqx Energy', 'Zqx Textile Mills'], 'a company is found by part of its name, any case');
select is((select label from public.search_all('zqx te', 8) where kind = 'company'), 'Zqx Textile Mills',
  'the text is matched as one substring, so more letters narrow the list');
select is((select meta from public.search_all('Quietco', 8) where kind = 'company'), null,
  'a company with no country has no meta');
select is((select meta from public.search_all('Zqx Energy', 8) where kind = 'company'), 'Germany', 'the company meta is its country');

select is((select id from public.search_all('naveed akh', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  'a contact is found by name');
select is((select company_id from public.search_all('naveed akh', 8) where kind = 'contact'), 'c0000000-0000-4000-8000-0000000000e1'::uuid,
  'a contact carries its company, so the palette can open the company');
select is((select count(*)::int from public.search_all('naveed', 8) where kind = 'contact'), 2,
  'both contacts with the first name are found');
select is((select label from public.search_all('naveed', 8) where kind = 'contact' order by score desc, label limit 1), 'Naveed Akhtar',
  'a name that starts with the text ranks above one that only contains it');
select is((select id from public.search_all('greta.vogel@zqx', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e2'::uuid,
  'a contact is found by part of the e-mail');
select is((select id from public.search_all('300 555 0142', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  'a contact is found by phone digits, however the number is spaced');
select is((select id from public.search_all('0300 555 0142', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  'a local leading 0 finds a stored +92 number');
select is((select id from public.search_all('923005550142', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  '92 and no plus finds it');
select is((select id from public.search_all('3005550142', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  'the bare national number finds it');
select is((select id from public.search_all('300555', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e1'::uuid,
  'a partial national number matches by contains');
select is((select id from public.search_all('+92 321 7654321', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e4'::uuid,
  'a +92 query finds a stored local 0321 number');
select is((select id from public.search_all('923217654321', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e4'::uuid,
  '92 digits find a stored local number');
select is((select id from public.search_all('0321-7654', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e4'::uuid,
  'a partial local number with dashes matches by contains');
select is((select id from public.search_all('(30) 123', 8) where kind = 'contact'), 'c1000000-0000-4000-8000-0000000000e2'::uuid,
  'phone digits ignore brackets and spaces, so "(30) 123" finds +49 30 1234567');
select is((select count(*)::int from public.search_all('55', 8) where kind = 'contact'), 0,
  'two digits are not treated as a phone number (too short to mean anything)');

select is((select id from public.search_all((select number::text from fx where id = 'd1000000-0000-4000-8000-0000000000e1'), 8) where kind = 'rfq' and score = 3),
  'd1000000-0000-4000-8000-0000000000e1'::uuid, 'an RFQ is found by its number');
select is((select id from public.search_all('RFQ-' || lpad((select number::text from fx where id = 'd1000000-0000-4000-8000-0000000000e2'), 4, '0'), 8)
           where kind = 'rfq' and score = 3), 'd1000000-0000-4000-8000-0000000000e2'::uuid, 'an RFQ is found by "RFQ-0177" style text, as an exact match');
select is((select id from public.search_all('enq-zqx', 8) where kind = 'rfq' and meta like 'Ref ENQ-ZQX-2211%'), 'd1000000-0000-4000-8000-0000000000e1'::uuid,
  'an RFQ is found by part of the customer reference');
select is((select label from public.search_all('Zqx Energy', 8) where kind = 'rfq'),
  'RFQ-' || lpad((select number::text from fx where id = 'd1000000-0000-4000-8000-0000000000e2'), 4, '0') || ' Zqx Energy',
  'an RFQ is found by its company name and labelled "RFQ-nnnn Company"');
select is((select meta from public.search_all('Zqx Energy', 8) where kind = 'rfq'), 'Open', 'an RFQ with no reference shows only Open or Closed');

select is((select count(*)::int from public.search_all('%', 8)), 1, 'a typed % is a literal: it finds only the company with a % in its name');
select is((select count(*)::int from public.search_all('_', 8)), 1, 'a typed _ is a literal too');
select is((select count(*)::int from public.search_all('   ', 8)) + (select count(*)::int from public.search_all(null, 8)), 0, 'blank and null text find nothing');
select is((select count(*)::int from public.search_all('zqx', 1) where kind = 'company'), 1, 'lim caps each kind');

-- ------------------------------------------------------------------ P02 (0054): orders, items, supplier POs, invoices
select is((select id from public.search_all('ORD-' || lpad((select number::text from fxo), 4, '0'), 8) where kind = 'order' and score = 3),
  'b1000000-0000-4000-8000-0000000000e1'::uuid, 'an order is found by "ORD-0038" style text, as an exact match');
select is((select meta from public.search_all('POSECRET', 8) where kind = 'order'), 'Customer PO POSECRET9',
  'sales find an order by part of the customer PO, and see the PO in the meta');
select is((select label from public.search_all('POSECRET9', 8) where kind = 'order'),
  'ORD-' || lpad((select number::text from fxo), 4, '0') || ' Zqx Textile Mills', 'an order is labelled "ORD-nnnn Company"');
select is((select order_id from public.search_all('6es7 214', 8) where kind = 'item'), 'b1000000-0000-4000-8000-0000000000e1'::uuid,
  'an order item is found by part of its description and points at its order');
select is((select meta from public.search_all('6es7 214', 8) where kind = 'item'),
  'ORD-' || lpad((select number::text from fxo), 4, '0') || ' · Zqx Textile Mills', 'an item shows its order and company, no price');
select is((select order_id from public.search_all('PO-8123', 8) where kind = 'po'), 'b1000000-0000-4000-8000-0000000000e1'::uuid,
  'a supplier PO is found by "PO-8123" and points at its order');
select is((select label from public.search_all('PO-' || to_char(public.today_pkt(), 'YY') || '-8123', 8) where kind = 'po'),
  'PO-' || to_char(public.today_pkt(), 'YY') || '-8123 Zqx Energy', 'a supplier PO is found by "PO-YY-NNNN" and labelled with its supplier');
select is((select count(*)::int from public.search_all('8123', 8) where kind = 'po'), 0, 'a bare number is not a PO number (it stays an RFQ or order number)');
select is((select id from public.search_all('INVSECRET9', 8) where kind = 'invoice'), 'b2000000-0000-4000-8000-0000000000e1'::uuid,
  'sales find an invoice by its number');
select is((select id from public.search_all('vsecret', 8) where kind = 'invoice'), 'b2000000-0000-4000-8000-0000000000e1'::uuid,
  'an invoice is found by part of its number');
select is((select meta from public.search_all('INVSECRET9', 8) where kind = 'invoice'),
  'Zqx Textile Mills · ORD-' || lpad((select number::text from fxo), 4, '0'), 'an invoice shows its company and order, never an amount');
select is((select count(*)::int from public.search_all('100000', 8)) + (select count(*)::int from public.search_all('18000', 8)), 0,
  'nothing is searchable by amount');

-- ------------------------------------------------------------------ engineer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.search_all('zqx', 8)),
          (select count(*)::int from public.search_all('zqx', 8) where kind in ('company', 'contact', 'rfq', 'order', 'item', 'po')),
  'an engineer never gets an invoice row');
select ok((select count(*) from public.search_all('zqx', 8) where kind = 'company') = 2 and (select count(*) from public.search_all('zqx', 8) where kind = 'rfq') >= 2,
  'an engineer finds companies and RFQs (engineers work them)');
select is((select count(*)::int from public.search_all('INVSECRET9', 8)) + (select count(*)::int from public.search_all('INV', 8) where kind = 'invoice')
          + (select count(*)::int from public.search_all('POSECRET9', 8)) + (select count(*)::int from public.search_all('POSECRET', 8))
          + (select count(*)::int from public.search_all('100000', 8)) + (select count(*)::int from public.search_all('18000', 8)), 0,
  'an engineer finds nothing by an invoice number, a customer PO number or an amount');
select is((select count(*)::int from public.search_all('ORD-' || lpad((select number::text from fxo), 4, '0'), 8) where kind = 'order'), 1,
  'an engineer finds an order by its number');
select is((select meta from public.search_all('ORD-' || lpad((select number::text from fxo), 4, '0'), 8) where kind = 'order'), null,
  'an engineer is not shown the customer PO');
select is((select count(*)::int from public.search_all('6es7 214', 8) where kind = 'item'), 1, 'an engineer finds an order item');
select is((select count(*)::int from public.search_all('PO-8123', 8) where kind = 'po'), 1, 'an engineer finds a supplier PO (engineers work them)');

-- ------------------------------------------------------------------ deactivated and anonymous
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.search_all('zqx', 8)) + (select count(*)::int from public.search_all('naveed', 8)), 0,
  'a deactivated user gets nothing');

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.search_all('zqx', 8)$$, '42501', null, 'anonymous callers cannot execute search_all');

select * from finish();
rollback;
