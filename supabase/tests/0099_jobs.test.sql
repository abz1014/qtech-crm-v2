-- 0099_jobs: v_jobs, job_stage(), orders.repeat_of_order_id.
--   (a) structure: security_invoker, exact columns, no money column, grants (incl. qtech_engineer), the definer helper is pinned
--   (b) one row per RFQ plus one per order with no RFQ; a cancel followed by a reorder is ONE job; a cancelled-only job reads cancelled
--   (c) the stage matrix, stage_detail and is_history for fixtures
--   (d) create_repeat_order stores its source; repeat_of_job_key
--   (e) personas: an engineer reads the same rows as the admin and no price; a deactivated person none; anon is refused
--   (f) EXPLAIN on about 5,000 rows uses indexes
begin;
select * from no_plan();

create function pg_temp.f(h text) returns uuid language sql immutable as
  $$ select ('b9900000-0000-4000-8000-0000000000' || h)::uuid $$;

-- Runs `stmt` as the persona the way PostgREST does (role authenticated, claims, then the pre-request that moves an engineer onto
-- qtech_engineer) and returns the first column of the first row as text: '<none>' for no row, '<null>' for NULL, 'E:<sqlstate>' for an error.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    if persona = 'anon' then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', case persona
        when 'admin' then 'a0000000-0000-4000-8000-000000000001'
        when 'sales' then 'a0000000-0000-4000-8000-000000000002'
        when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
        when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform qtech_private.pre_request();
    end if;
    execute stmt into v;
    get diagnostics n = row_count;
    raise exception 'done' using errcode = 'P0999', detail = case when n = 0 then '<none>' when v is null then '<null>' else v end;
  exception
    when sqlstate 'P0999' then
      get stacked diagnostics d = pg_exception_detail;
      return d;
    when others then
      return 'E:' || sqlstate;
  end;
end
$f$;

create function pg_temp.plan(q text) returns text language plpgsql as $f$
declare r text; o text := '';
begin
  for r in execute 'explain ' || q loop o := o || r || E'\n'; end loop;
  return o;
end
$f$;

-- ------------------------------------------------------------------ fixtures (as the table owner, admin claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('01'), 'Jb Customer'), (pg_temp.f('02'), 'Jb Supplier');

-- RFQs, one per no-order stage and three with orders
insert into public.rfqs (id, company_id, owner_id) values
  (pg_temp.f('10'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- enquiry
  (pg_temp.f('11'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- asking suppliers
  (pg_temp.f('12'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- prices in
  (pg_temp.f('13'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- quoted
  (pg_temp.f('14'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- lost
  (pg_temp.f('15'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- ordered (one live order)
  (pg_temp.f('16'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- cancelled order, then reordered
  (pg_temp.f('17'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');   -- cancelled, never reordered
insert into public.rfq_items (id, rfq_id, position, description, qty) values
  (pg_temp.f('20'), pg_temp.f('10'), 0, 'Jb enquiry item', 1),
  (pg_temp.f('21'), pg_temp.f('11'), 0, 'Jb pump', 1),
  (pg_temp.f('22'), pg_temp.f('11'), 1, 'Jb valve', 1),
  (pg_temp.f('23'), pg_temp.f('11'), 2, 'Jb gauge', 1),
  (pg_temp.f('24'), pg_temp.f('12'), 0, 'Jb sensor', 1),
  (pg_temp.f('25'), pg_temp.f('12'), 1, 'Jb cable', 1);
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  (pg_temp.f('30'), pg_temp.f('11'), pg_temp.f('02'), public.today_pkt()),
  (pg_temp.f('31'), pg_temp.f('12'), pg_temp.f('02'), public.today_pkt());
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  (pg_temp.f('32'), pg_temp.f('31'), pg_temp.f('24'), 10, 'PKR');
update public.rfqs set quoted_on = public.today_pkt() where id = pg_temp.f('13');
update public.rfqs set closed_on = public.today_pkt(), close_reason = 'price' where id = pg_temp.f('14');

-- orders of RFQs
insert into public.orders (id, company_id, owner_id, rfq_id, cancelled_on) values
  (pg_temp.f('40'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('15'), null),
  (pg_temp.f('41'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('16'), public.today_pkt()),
  (pg_temp.f('42'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('16'), null),
  (pg_temp.f('43'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002', pg_temp.f('17'), public.today_pkt());
-- direct orders (no RFQ)
insert into public.orders (id, company_id, owner_id) values
  (pg_temp.f('50'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- supplier ordered
  (pg_temp.f('51'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- delivered, not invoiced
  (pg_temp.f('52'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- invoiced, not paid
  (pg_temp.f('53'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- paid
  (pg_temp.f('54'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- 1 of 2 delivered
  (pg_temp.f('55'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002'),   -- advance received
  (pg_temp.f('56'), pg_temp.f('01'), 'a0000000-0000-4000-8000-000000000002');   -- paid, installation still to plan
update public.orders set needs_commissioning = true where id = pg_temp.f('56');
-- one supplier leg per order that has goods (order 40 has an unsourced item), 54 has two
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  (pg_temp.f('60'), pg_temp.f('42'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('61'), pg_temp.f('50'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('62'), pg_temp.f('51'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('63'), pg_temp.f('52'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('64'), pg_temp.f('53'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('65'), pg_temp.f('54'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('66'), pg_temp.f('54'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('67'), pg_temp.f('55'), pg_temp.f('02'), 'PKR'),
  (pg_temp.f('68'), pg_temp.f('56'), pg_temp.f('02'), 'PKR');
-- every line is 1 x 100 net, 18% GST: a gross of 118
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price) values
  (pg_temp.f('70'), pg_temp.f('40'), 0, 'Jb item unsourced', 1, 'ea', 100, 18, null, null),
  (pg_temp.f('71'), pg_temp.f('42'), 0, 'Jb reorder item', 1, 'ea', 100, 18, pg_temp.f('60'), 50),
  (pg_temp.f('72'), pg_temp.f('50'), 0, 'Jb direct item', 1, 'ea', 100, 18, pg_temp.f('61'), 50),
  (pg_temp.f('73'), pg_temp.f('51'), 0, 'Jb item delivered', 1, 'ea', 100, 18, pg_temp.f('62'), 50),
  (pg_temp.f('74'), pg_temp.f('52'), 0, 'Jb item invoiced', 1, 'ea', 100, 18, pg_temp.f('63'), 50),
  (pg_temp.f('75'), pg_temp.f('53'), 0, 'Jb item paid', 1, 'ea', 100, 18, pg_temp.f('64'), 50),
  (pg_temp.f('76'), pg_temp.f('54'), 0, 'Jb split a', 1, 'ea', 100, 18, pg_temp.f('65'), 50),
  (pg_temp.f('77'), pg_temp.f('54'), 1, 'Jb split b', 1, 'ea', 100, 18, pg_temp.f('66'), 50),
  (pg_temp.f('78'), pg_temp.f('55'), 0, 'Jb item advance', 1, 'ea', 100, 18, pg_temp.f('67'), 50),
  (pg_temp.f('79'), pg_temp.f('56'), 0, 'Jb item installed', 1, 'ea', 100, 18, pg_temp.f('68'), 50);
update public.supplier_orders set placed_on = public.today_pkt() where id in
  (pg_temp.f('60'), pg_temp.f('61'), pg_temp.f('62'), pg_temp.f('63'), pg_temp.f('64'), pg_temp.f('65'), pg_temp.f('66'), pg_temp.f('67'), pg_temp.f('68'));
update public.supplier_orders set received_on = public.today_pkt(), delivered_on = public.today_pkt() where id in
  (pg_temp.f('62'), pg_temp.f('63'), pg_temp.f('64'), pg_temp.f('65'), pg_temp.f('68'));
insert into public.invoices (id, order_id, number, net_amount, gst_amount) values
  (pg_temp.f('80'), pg_temp.f('52'), 'JB-1', 100, 18),
  (pg_temp.f('81'), pg_temp.f('53'), 'JB-2', 100, 18),
  (pg_temp.f('82'), pg_temp.f('56'), 'JB-3', 100, 18);
insert into public.payments_in (id, order_id, amount) values
  (pg_temp.f('90'), pg_temp.f('53'), 118),
  (pg_temp.f('91'), pg_temp.f('55'), 50),
  (pg_temp.f('92'), pg_temp.f('56'), 118);

-- ------------------------------------------------------------------ (a) structure
select ok((select coalesce(c.reloptions @> array['security_invoker=true'], false) from pg_class c where c.oid = 'public.v_jobs'::regclass),
  'v_jobs is security_invoker');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'v_jobs'),
  array['job_key', 'kind', 'rfq_id', 'order_id', 'company_id', 'site_id', 'owner_id', 'items_summary', 'stage', 'stage_detail',
        'is_history', 'last_activity_on', 'repeat_of_job_key', 'cancelled_orders'],
  'v_jobs has exactly the agreed columns');
select is((select coalesce(array_agg(column_name::text order by column_name), '{}') from information_schema.columns
           where table_schema = 'public' and table_name = 'v_jobs'
             and (data_type in ('numeric', 'real', 'double precision', 'money', 'integer', 'smallint', 'jsonb', 'json')
                  or (data_type = 'bigint' and column_name <> 'cancelled_orders')
                  or column_name ~ '(price|amount|total|gross|net|gst|balance|paid|cost|rate|margin|pkr|tax|value)')),
  '{}'::text[], 'v_jobs has no price, amount, rate or other money column (cancelled_orders is a count)');
select ok(not exists (select 1 from pg_attribute a where a.attrelid = 'public.v_jobs'::regclass and a.attnum > 0 and not a.attisdropped
                        and a.atttypid in ('numeric'::regtype, 'money'::regtype)),
  'no numeric or money typed column in v_jobs');
select ok(has_table_privilege('authenticated', 'public.v_jobs', 'select') and has_table_privilege('qtech_engineer', 'public.v_jobs', 'select'),
  'v_jobs is granted to authenticated and qtech_engineer');
select ok(not has_table_privilege('anon', 'public.v_jobs', 'select') and not has_table_privilege('authenticated', 'public.v_jobs', 'insert'),
  'anon has no access and nobody can write to the view');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.job_stage(uuid, uuid)'::regprocedure),
  'job_stage is SECURITY DEFINER with an empty search_path (0057)');
select ok(has_function_privilege('authenticated', 'public.job_stage(uuid, uuid)', 'execute')
      and has_function_privilege('qtech_engineer', 'public.job_stage(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.job_stage(uuid, uuid)', 'execute'),
  'job_stage runs for authenticated and qtech_engineer, never for anon');
select is((select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = 'public.orders'::regclass
           and a.attname = 'repeat_of_order_id' and not a.attisdropped),
  array['repeat_of_order_id'], 'orders.repeat_of_order_id exists');
select ok(exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname in ('rfqs_job_key_idx') and i.indrelid = 'public.rfqs'::regclass)
      and exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname in ('orders_job_key_idx') and i.indrelid = 'public.orders'::regclass),
  'the job_key lookups have their expression indexes');
select ok(pg_get_function_identity_arguments('public.create_repeat_order(uuid, uuid, text, date, boolean)'::regprocedure)
          = 'p_order_id uuid, p_from_order_id uuid, p_customer_po_number text, p_ordered_on date, p_repeat_cancelled boolean',
  'create_repeat_order keeps its signature');

-- ------------------------------------------------------------------ (b) the rows
select is((select count(*) from public.v_jobs),
          (select count(*) from public.rfqs) + (select count(*) from public.orders where rfq_id is null),
  'v_jobs has one row per RFQ plus one per order with no RFQ');
select is((select count(distinct job_key) from public.v_jobs), (select count(*) from public.v_jobs), 'every job_key is unique');
select is((select count(*)::int from public.v_jobs where rfq_id is null and kind <> 'direct')
        + (select count(*)::int from public.v_jobs where rfq_id is not null and kind <> 'enquiry'), 0,
  'kind is enquiry for an RFQ job and direct for an order with no RFQ');
select is((select job_key from public.v_jobs where rfq_id = pg_temp.f('10')), (select number::text from public.rfqs where id = pg_temp.f('10')),
  'an RFQ job is keyed by the RFQ number');
select is((select job_key from public.v_jobs where order_id = pg_temp.f('50')), (select 'O-' || number::text from public.orders where id = pg_temp.f('50')),
  'a direct order is keyed O- plus its order number');
select is((select count(*)::int from public.v_jobs where rfq_id = pg_temp.f('16')), 1, 'a cancel followed by a reorder is one job');
select is((select order_id from public.v_jobs where rfq_id = pg_temp.f('16')), pg_temp.f('42'), 'the job holds the live order');
select is((select cancelled_orders from public.v_jobs where rfq_id = pg_temp.f('16')), 1::bigint, 'and counts the cancelled one');
select is((select count(*)::int from public.v_jobs where order_id = pg_temp.f('41')), 0, 'the cancelled order is not a job of its own');
select is((select count(*)::int from public.v_jobs where kind = 'direct' and order_id in (pg_temp.f('40'), pg_temp.f('41'), pg_temp.f('42'), pg_temp.f('43'))), 0,
  'orders that belong to an RFQ are never direct jobs');
select is((select stage || '|' || coalesce(order_id::text, 'none') || '|' || cancelled_orders::text from public.v_jobs where rfq_id = pg_temp.f('17')),
  'cancelled|none|1', 'an RFQ whose only order was cancelled is a cancelled job with no live order');
select is((select items_summary from public.v_jobs where rfq_id = pg_temp.f('11')), 'Jb pump +2 more', 'items_summary: the first item and how many more');
select is((select items_summary from public.v_jobs where rfq_id = pg_temp.f('10')), 'Jb enquiry item', 'items_summary: a single item has no "more"');
select is((select items_summary from public.v_jobs where rfq_id = pg_temp.f('15')), 'Jb item unsourced', 'items_summary reads the order lines once there is an order');
select is((select items_summary from public.v_jobs where order_id = pg_temp.f('54') and kind = 'direct'), 'Jb split a +1 more', 'items_summary of a direct order');
select is((select company_id from public.v_jobs where rfq_id = pg_temp.f('10')), pg_temp.f('01'), 'company_id is carried');
select is((select owner_id from public.v_jobs where order_id = pg_temp.f('50')), 'a0000000-0000-4000-8000-000000000002'::uuid, 'owner_id is carried');

-- ------------------------------------------------------------------ (c) the stage matrix
create temp table want (label text, rfq uuid, ord uuid, stage text, detail text, hist boolean);
insert into want values
  ('enquiry', pg_temp.f('10'), null, 'enquiry', 'suppliers not asked yet', false),
  ('asking suppliers', pg_temp.f('11'), null, 'asking_suppliers', '0 of 1 suppliers replied', false),
  ('prices in', pg_temp.f('12'), null, 'prices_in', '1 of 2 items priced', false),
  ('quoted', pg_temp.f('13'), null, 'quoted', 'waiting for the customer', false),
  ('lost', pg_temp.f('14'), null, 'lost', 'price too high', true),
  ('ordered, item to source', pg_temp.f('15'), null, 'ordered', 'to source', false),
  ('cancel then reorder', pg_temp.f('16'), null, 'supplier_ordered', 'with the supplier', false),
  ('cancelled only', pg_temp.f('17'), null, 'cancelled', 'order cancelled', true),
  ('direct, supplier ordered', null, pg_temp.f('50'), 'supplier_ordered', 'with the supplier', false),
  ('direct, delivered not invoiced', null, pg_temp.f('51'), 'delivered', 'not invoiced yet', false),
  ('direct, invoiced not paid', null, pg_temp.f('52'), 'invoiced', 'not paid yet', false),
  ('direct, paid', null, pg_temp.f('53'), 'paid', null, true),
  ('direct, 1 of 2 delivered', null, pg_temp.f('54'), 'supplier_ordered', '1 of 2 delivered', false),
  ('direct, advance received', null, pg_temp.f('55'), 'supplier_ordered', 'with the supplier, advance received', false),
  ('direct, paid but installation to plan', null, pg_temp.f('56'), 'paid', 'installation to plan', false);
select is((select stage from public.v_jobs j where j.rfq_id = w.rfq or (w.rfq is null and j.order_id = w.ord and j.kind = 'direct')),
          w.stage, 'stage: ' || w.label)
from want w order by w.label;
select is((select stage_detail from public.v_jobs j where j.rfq_id = w.rfq or (w.rfq is null and j.order_id = w.ord and j.kind = 'direct')),
          w.detail, 'stage_detail: ' || w.label)
from want w order by w.label;
select is((select is_history from public.v_jobs j where j.rfq_id = w.rfq or (w.rfq is null and j.order_id = w.ord and j.kind = 'direct')),
          w.hist, 'is_history: ' || w.label)
from want w order by w.label;
select ok((select count(*) from public.v_jobs where stage not in ('enquiry', 'asking_suppliers', 'prices_in', 'quoted', 'ordered', 'supplier_ordered',
                                                                  'delivered', 'invoiced', 'paid', 'lost', 'cancelled')
                                                or stage is null) = 0,
  'every job has one of the eleven stages');
select is((select last_activity_on from public.v_jobs where rfq_id = pg_temp.f('13')), public.today_pkt(), 'last_activity_on: a quotation sent today');
select is((select last_activity_on from public.v_jobs where order_id = pg_temp.f('53') and kind = 'direct'), public.today_pkt(), 'last_activity_on: a payment today');
-- cancelled with money held is not history either
update public.orders set cancelled_on = public.today_pkt() where id = pg_temp.f('55');
select is((select stage || '|' || is_history::text from public.v_jobs where order_id = pg_temp.f('55') and kind = 'direct'), 'cancelled|false',
  'a cancelled order that still holds an advance is not history');

-- ------------------------------------------------------------------ (d) repeat orders
select lives_ok($$select public.create_repeat_order('b9900000-0000-4000-8000-0000000000a0', 'b9900000-0000-4000-8000-000000000053')$$, 'create_repeat_order runs');
select is((select repeat_of_order_id from public.orders where id = pg_temp.f('a0')), pg_temp.f('53'), 'it stores its source order');
select is((select repeat_of_job_key from public.v_jobs where order_id = pg_temp.f('a0')), (select 'O-' || number::text from public.orders where id = pg_temp.f('53')),
  'a repeat of a direct order says "Repeat of Job O-n"');
select lives_ok($$select public.create_repeat_order('b9900000-0000-4000-8000-0000000000a1', 'b9900000-0000-4000-8000-000000000042')$$, 'repeating an order that came from an RFQ works');
select is((select repeat_of_job_key from public.v_jobs where order_id = pg_temp.f('a1')), (select number::text from public.rfqs where id = pg_temp.f('16')),
  'a repeat of an RFQ job says "Repeat of Job <RFQ number>"');
select is((select count(*)::int from public.v_jobs where repeat_of_job_key is not null), 2, 'only repeats carry repeat_of_job_key');
select is((select stage from public.v_jobs where order_id = pg_temp.f('a0') and kind = 'direct'), 'ordered', 'a repeat order starts at ordered (its supplier order is still to place)');
select is((select count(*)::int from public.orders where repeat_of_order_id is not null and repeat_of_order_id = id), 0, 'no order repeats itself');

-- ------------------------------------------------------------------ (e) personas
select is(pg_temp.as_('engineer', 'select count(*)::text from public.v_jobs'), (select count(*)::text from public.v_jobs),
  'an engineer reads every job row row security allows (the same rows as the admin)');
select is(pg_temp.as_('sales', 'select count(*)::text from public.v_jobs'), (select count(*)::text from public.v_jobs), 'sales reads the same rows');
select is(pg_temp.as_('admin', 'select count(*)::text from public.v_jobs'), (select count(*)::text from public.v_jobs), 'so does the admin');
select is(pg_temp.as_('deactivated', 'select count(*)::text from public.v_jobs'), '0', 'a deactivated person reads no job');
select is(pg_temp.as_('anon', 'select count(*)::text from public.v_jobs'), 'E:42501', 'anon is refused');
select is(pg_temp.as_('engineer', $q$select stage || '|' || coalesce(stage_detail, '') from public.v_jobs where order_id = 'b9900000-0000-4000-8000-000000000053' and kind = 'direct'$q$),
  'paid|', 'an engineer reads the stage of a paid job (a word, no money)');
select is(pg_temp.as_('engineer', $q$select stage || '|' || stage_detail from public.v_jobs where order_id = 'b9900000-0000-4000-8000-000000000052' and kind = 'direct'$q$),
  'invoiced|not paid yet', 'and of an invoiced one, although invoices and payments are closed to them');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.invoices$q$), '0', 'precondition: an engineer reads no invoice');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.payments_in$q$), '0', 'precondition: nor any payment');
select is(pg_temp.as_('engineer', $q$select count(*)::text from (select * from public.v_jobs) x$q$), (select count(*)::text from public.v_jobs),
  'select * on v_jobs works for an engineer: the view holds no price column');
select is(pg_temp.as_('engineer', $q$select count(*)::text from public.job_stage('b9900000-0000-4000-8000-000000000010', null)$q$), '1',
  'an engineer may call job_stage');
select is(pg_temp.as_('deactivated', $q$select count(*)::text from public.job_stage('b9900000-0000-4000-8000-000000000010', null)$q$), '0',
  'a deactivated person gets nothing from job_stage');
select is(pg_temp.as_('anon', $q$select count(*)::text from public.job_stage('b9900000-0000-4000-8000-000000000010', null)$q$), 'E:42501',
  'anon cannot call job_stage');
select is(pg_temp.as_('sales', $q$select repeat_of_order_id::text from public.orders where id = 'b9900000-0000-4000-8000-0000000000a0'$q$),
  'b9900000-0000-4000-8000-000000000053', 'orders.repeat_of_order_id is readable by staff');

-- ------------------------------------------------------------------ (f) EXPLAIN on about 5,000 rows uses the indexes
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values (pg_temp.f('b0'), 'Jb Bulk Customer');
insert into public.rfqs (company_id, owner_id)
select pg_temp.f('b0'), 'a0000000-0000-4000-8000-000000000002' from generate_series(1, 2500);
insert into public.orders (company_id, owner_id)
select pg_temp.f('b0'), 'a0000000-0000-4000-8000-000000000002' from generate_series(1, 2500);
analyze public.rfqs;
analyze public.orders;
select cmp_ok((select count(*)::int from public.rfqs) + (select count(*)::int from public.orders where rfq_id is null), '>=', 5000,
  'the bulk fixture gives 5,000 or more jobs');
set local enable_seqscan = off;
select ok(pg_temp.plan($q$select * from public.v_jobs where rfq_id = 'b9900000-0000-4000-8000-000000000010'$q$) like '%rfqs_pkey%',
  'a job by rfq_id is found by the RFQ primary key');
select ok(pg_temp.plan($q$select * from public.v_jobs where rfq_id = 'b9900000-0000-4000-8000-000000000010'$q$) not like '%Seq Scan%',
  'and reads nothing sequentially');
select ok(pg_temp.plan($q$select * from public.v_jobs where company_id = 'b9900000-0000-4000-8000-0000000000b0'$q$) like '%rfqs_company%'
      and pg_temp.plan($q$select * from public.v_jobs where company_id = 'b9900000-0000-4000-8000-0000000000b0'$q$) like '%orders_company_idx%',
  'a company''s jobs use the company indexes on both sides');
select ok(pg_temp.plan($q$select * from public.v_jobs where job_key = 'O-5'$q$) like '%orders_job_key_idx%'
      and pg_temp.plan($q$select * from public.v_jobs where job_key = 'O-5'$q$) like '%rfqs_job_key_idx%',
  'a job by its key ("139", "O-45") uses the key indexes');
select ok(pg_temp.plan($q$select * from public.v_jobs where owner_id = 'a0000000-0000-4000-8000-000000000002' and company_id = 'b9900000-0000-4000-8000-0000000000b0'$q$) not like '%Seq Scan%',
  'owner and company together read no table sequentially');
reset enable_seqscan;

select * from finish();
rollback;
