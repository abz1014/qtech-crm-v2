-- 0093_supplier_categories: the curated product categories, the per-supplier category evidence (counts only), the category
-- price wins (NULL for anyone but admin and sales) and the admin-and-sales-only tagging of a supplier with a category.
begin;
select * from no_plan();

-- ------------------------------------------------------------------ machinery
-- Runs stmt as the persona the way the data API does (claims, role authenticated, pre_request: an engineer becomes
-- qtech_engineer) and returns the first column of the first row as text: '<none>' no row, '<null>' NULL, 'E:<sqlstate>' an error.
-- Always rolled back.
create function pg_temp.as_(persona text, stmt text) returns text language plpgsql as $f$
declare
  v text;
  d text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', case persona
      when 'admin' then 'a0000000-0000-4000-8000-000000000001'
      when 'sales' then 'a0000000-0000-4000-8000-000000000002'
      when 'engineer' then 'a0000000-0000-4000-8000-000000000003'
      when 'deactivated' then 'a0000000-0000-4000-8000-000000000004' end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform qtech_private.pre_request();
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

-- ================================================================== the seed
select is((select count(*)::int from public.brands where id::text like 'ca7e0000-%' and kind = 'family' and curated), 46,
  'the migration seeded the 46 canonical categories as curated families (fixed ids)');
select is((select count(*)::int from public.brands where curated), 46, 'and nothing else is curated');
select is((select count(*)::int from public.brands where curated and kind <> 'family'), 0, 'curated is only ever set on a family');
select ok(exists (select 1 from public.brands where name = 'MCCB' and id = 'ca7e0000-0000-4000-8000-000000000002'),
  'a fixed id: position 2 is MCCB');
select ok(exists (select 1 from public.brands where name = 'Commissioning service' and id = 'ca7e0000-0000-4000-8000-000000000046'),
  'and position 46 is Commissioning service');

-- ================================================================== item matching is unchanged by the seed
-- "Before 0093" = the 0036 definition over the brands rows that are not the seeded categories (on this database: none yet).
create function pg_temp.words_before() returns text[] language sql as $f$
  select coalesce(array_agg(distinct x.w order by x.w), '{}'::text[])
  from (select unnest(string_to_array(public.item_text_norm(b.name), ' ')) as w from public.brands b where b.id::text not like 'ca7e0000-%') x
  where x.w <> ''
$f$;
create temp table words_start as select pg_temp.words_before() as w, public.brand_tokens() as t;
select is(public.brand_words(), (select w from words_start), 'the stripped word set after the seed equals the set without the 46 categories (no category word added)');
select is(public.brand_tokens(), (select t from words_start), 'and the brand tokens (0035) are unchanged too');

-- other brands and families are still stripped, as before; a matched legacy family keeps its old behaviour
insert into public.brands (id, name, kind) values
  ('b0930000-0000-4000-8000-0000000000c1', 'E+H', 'brand'),
  ('b0930000-0000-4000-8000-0000000000c2', 'Legacy Actuators', 'family');
select ok(public.brand_words() @> array['actuators', 'legacy', 'h'], 'a brand and an imported family are still stripped');
select ok(public.brand_words() = pg_temp.words_before(), 'and it is still exactly the 0036 definition over those rows');

-- two fixture descriptions: the same text normalised, stripped and scored with and without the seeded categories
create temp table sim as select
  public.item_text_norm('Pressure transmitter 0-10 bar E+H cerabar series') as a,
  public.item_text_norm('Pressure transmitter 0-16 bar E+H cerabar series') as b;
select is(public.strip_words((select a from sim), public.brand_words()), public.strip_words((select a from sim), pg_temp.words_before()),
  'the stripped description is the same with and without the seeded categories');
select is(extensions.similarity(public.strip_words((select a from sim), public.brand_words()), public.strip_words((select b from sim), public.brand_words())),
          extensions.similarity(public.strip_words((select a from sim), pg_temp.words_before()), public.strip_words((select b from sim), pg_temp.words_before())),
  'the similarity score of the two pressure transmitter descriptions is unchanged');
select ok(public.strip_words((select a from sim), public.brand_words()) like 'pressure transmitter%',
  'and "pressure transmitter" is still in the stripped text');
select is(public.similar_enough(public.strip_words((select a from sim), public.brand_words()), public.strip_words((select b from sim), public.brand_words()), 0.45),
          public.similar_enough(public.strip_words((select a from sim), pg_temp.words_before()), public.strip_words((select b from sim), pg_temp.words_before()), 0.45),
  'the tier 1 decision (>= 0.45) is unchanged');
select ok(public.item_text_norm('Pressure transmitter 0-10 bar E+H') like 'pressure transmitter%', 'item_text_norm itself is unchanged (a pure function)');
delete from public.brands where id in ('b0930000-0000-4000-8000-0000000000c1', 'b0930000-0000-4000-8000-0000000000c2');

create temp table seed_before as select count(*)::int as n, md5(string_agg(id::text || name || kind || curated::text, ',' order by id)) as h from public.brands;
select is((select row(s.inserted, s.matched)::text from qtech_private.seed_curated_categories() s), '(0,0)',
  'running the seed again inserts nothing and matches nothing new');
select is((select row(count(*)::int, md5(string_agg(id::text || name || kind || curated::text, ',' order by id)))::text from public.brands),
          (select row(n, h)::text from seed_before), 'and the brands table is exactly as it was (idempotent)');

-- an existing family with a canonical name (any case, stray blanks) is marked curated, not duplicated and not renamed
delete from public.brands where name = 'Timers';
insert into public.brands (id, name, kind) values ('b0930000-0000-4000-8000-0000000000a1', 'TIMERS ', 'family');
select is((select curated from public.brands where id = 'b0930000-0000-4000-8000-0000000000a1'), false, 'precondition: the imported family is not curated');
select is((select row(s.inserted, s.matched)::text from qtech_private.seed_curated_categories() s), '(0,1)',
  'a same-named family is matched (0 added, 1 marked)');
select is((select count(*)::int from public.brands where lower(btrim(name)) = 'timers'), 1, 'it is not duplicated');
select ok(public.brand_words() @> array['timers'], 'a matched legacy family keeps being stripped from descriptions, as before');
select is((select name || '|' || curated::text from public.brands where id = 'b0930000-0000-4000-8000-0000000000a1'), 'TIMERS |true',
  'it is marked curated and its name is left alone');
select is((select count(*)::int from public.brands where curated and kind = 'family'), 46, 'still 46 curated categories');

-- a brand-kind row that has a canonical name is not turned into a category and is not duplicated
delete from public.brands where name = 'Motors';
insert into public.brands (id, name, kind) values ('b0930000-0000-4000-8000-0000000000a2', 'motors', 'brand');
select is((select row(s.inserted, s.matched)::text from qtech_private.seed_curated_categories() s), '(0,0)',
  'a brand-kind row with a canonical name is skipped, not duplicated');
select is((select kind || '|' || curated::text from public.brands where id = 'b0930000-0000-4000-8000-0000000000a2'), 'brand|false',
  'and stays a plain brand');
delete from public.brands where id = 'b0930000-0000-4000-8000-0000000000a2';
select is((select row(s.inserted, s.matched)::text from qtech_private.seed_curated_categories() s), '(1,0)',
  'once it is gone the seed puts Motors back');

-- ================================================================== fixtures (as the table owner)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.companies (id, name) values
  ('c0930000-0000-4000-8000-000000000001', '0093 Customer'),
  ('c0930000-0000-4000-8000-000000000011', '0093 Supplier 1'),
  ('c0930000-0000-4000-8000-000000000012', '0093 Supplier 2'),
  ('c0930000-0000-4000-8000-000000000013', '0093 Supplier 3');
insert into public.brands (id, name) values ('b0930000-0000-4000-8000-0000000000b1', '0093 Brand');
insert into public.company_brands (company_id, brand_id) values ('c0930000-0000-4000-8000-000000000013', 'b0930000-0000-4000-8000-0000000000b1');

-- category A = Pressure transmitters (position 17 = 0x11), category B = Fuses (position 7)
create temp table cat as
  select (select id from public.brands where name = 'Pressure transmitters') as a, (select id from public.brands where name = 'Fuses') as b;

insert into public.rfqs (id, company_id, owner_id) values
  ('d0930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d0930000-0000-4000-8000-000000000002', 'c0930000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('d0930000-0000-4000-8000-000000000003', 'c0930000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, position, description, qty, family_id) values
  ('e0930000-0000-4000-8000-000000000001', 'd0930000-0000-4000-8000-000000000001', 0, '0093 transmitter one', 1, (select a from cat)),
  ('e0930000-0000-4000-8000-000000000002', 'd0930000-0000-4000-8000-000000000001', 1, '0093 transmitter two', 1, (select a from cat)),
  ('e0930000-0000-4000-8000-000000000003', 'd0930000-0000-4000-8000-000000000001', 2, '0093 fuse', 1, (select b from cat)),
  ('e0930000-0000-4000-8000-000000000004', 'd0930000-0000-4000-8000-000000000002', 0, '0093 transmitter three', 1, (select a from cat)),
  ('e0930000-0000-4000-8000-000000000005', 'd0930000-0000-4000-8000-000000000003', 0, '0093 transmitter four', 1, (select a from cat)),
  ('e0930000-0000-4000-8000-000000000006', 'd0930000-0000-4000-8000-000000000003', 1, '0093 uncategorised', 1, null);

-- rfq1: asked of S1, S2 (10 days ago) and S3 (declined). rfq2: S1 and S2 (3 days ago). rfq3: S3 only (yesterday), unanswered.
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on, no_offer_on) values
  ('f0930000-0000-4000-8000-000000000001', 'd0930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000011', public.today_pkt() - 10, null),
  ('f0930000-0000-4000-8000-000000000002', 'd0930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000012', public.today_pkt() - 10, null),
  ('f0930000-0000-4000-8000-000000000003', 'd0930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000013', public.today_pkt() - 10, public.today_pkt() - 8),
  ('f0930000-0000-4000-8000-000000000004', 'd0930000-0000-4000-8000-000000000002', 'c0930000-0000-4000-8000-000000000011', public.today_pkt() - 3, null),
  ('f0930000-0000-4000-8000-000000000005', 'd0930000-0000-4000-8000-000000000002', 'c0930000-0000-4000-8000-000000000012', public.today_pkt() - 3, null),
  ('f0930000-0000-4000-8000-000000000006', 'd0930000-0000-4000-8000-000000000003', 'c0930000-0000-4000-8000-000000000013', public.today_pkt() - 1, null);
-- shortlisted but not sent: never counts as asked
insert into public.supplier_inquiries (id, rfq_id, supplier_id, sent_on) values
  ('f0930000-0000-4000-8000-000000000007', 'd0930000-0000-4000-8000-000000000003', 'c0930000-0000-4000-8000-000000000012', null);

insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency) values
  ('f1930000-0000-4000-8000-000000000001', 'f0930000-0000-4000-8000-000000000001', 'e0930000-0000-4000-8000-000000000001', 3000, 'PKR'),
  ('f1930000-0000-4000-8000-000000000002', 'f0930000-0000-4000-8000-000000000001', 'e0930000-0000-4000-8000-000000000002', 3000, 'PKR'),
  ('f1930000-0000-4000-8000-000000000003', 'f0930000-0000-4000-8000-000000000002', 'e0930000-0000-4000-8000-000000000001', 2000, 'PKR'),
  ('f1930000-0000-4000-8000-000000000004', 'f0930000-0000-4000-8000-000000000002', 'e0930000-0000-4000-8000-000000000003', 100, 'PKR'),
  ('f1930000-0000-4000-8000-000000000005', 'f0930000-0000-4000-8000-000000000004', 'e0930000-0000-4000-8000-000000000004', 1000, 'PKR'),
  ('f1930000-0000-4000-8000-000000000006', 'f0930000-0000-4000-8000-000000000005', 'e0930000-0000-4000-8000-000000000004', 1500, 'PKR');

-- orders: S2 delivered a category A line on a live order; S1 had one on a cancelled order (not counted)
insert into public.orders (id, company_id, owner_id, created_at) values
  ('a1930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
insert into public.orders (id, company_id, owner_id, created_at, cancelled_on) values
  ('a1930000-0000-4000-8000-000000000002', 'c0930000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day', public.today_pkt());
insert into public.supplier_orders (id, order_id, supplier_id, currency) values
  ('a2930000-0000-4000-8000-000000000001', 'a1930000-0000-4000-8000-000000000001', 'c0930000-0000-4000-8000-000000000012', 'PKR'),
  ('a2930000-0000-4000-8000-000000000002', 'a1930000-0000-4000-8000-000000000002', 'c0930000-0000-4000-8000-000000000011', 'PKR');
insert into public.order_items (id, order_id, position, description, qty, unit, unit_price_net, gst_rate, supplier_order_id, supplier_unit_price, family_id) values
  ('a3930000-0000-4000-8000-000000000001', 'a1930000-0000-4000-8000-000000000001', 0, '0093 transmitter', 1, 'ea', 5000, 18,
   'a2930000-0000-4000-8000-000000000001', 2000, (select a from cat)),
  ('a3930000-0000-4000-8000-000000000002', 'a1930000-0000-4000-8000-000000000002', 0, '0093 transmitter cancelled', 1, 'ea', 5000, 18,
   'a2930000-0000-4000-8000-000000000002', 2000, (select a from cat));

-- the learn trigger (0008) tagged each supplier with the categories it quoted: S1 quoted A; S2 quoted A and B
select is((select count(*)::int from public.company_brands cb
           where cb.brand_id in ((select a from cat), (select b from cat))
             and cb.company_id in ('c0930000-0000-4000-8000-000000000011', 'c0930000-0000-4000-8000-000000000012')), 3,
  'learn_company_brands tagged the suppliers with the categories they quoted');

-- ================================================================== the evidence view
-- The statement that lists the evidence of one category, so it can be run as each persona.
create function pg_temp.evq(fam uuid) returns text language sql as $f$
  select format($q$select string_agg(right(e.supplier_id::text, 2) || ':' || e.asked || '/' || e.replied || '/' || e.quoted || '/' || e.no_offer || '/' || e.ordered
                    || '@' || coalesce((public.today_pkt() - e.last_asked_on)::text, '-'), ' ' order by e.supplier_id)
                    from public.v_supplier_category_evidence e where e.family_id = %L$q$, fam)
$f$;

-- format: supplier:asked/replied/quoted/no_offer/ordered@days since last asked
select is(pg_temp.as_('admin', pg_temp.evq((select a from cat))), '11:2/2/2/0/0@3 12:2/2/2/0/1@3 13:2/1/0/1/0@1',
  'category A: S1 asked 2, replied 2, quoted 2, ordered 0 (the cancelled order does not count); S2 ordered 1; S3 declined once and was not answered once');
select is(pg_temp.as_('admin', pg_temp.evq((select b from cat))), '11:1/0/0/0/0@10 12:1/1/1/0/0@10 13:1/1/0/1/0@10',
  'category B: S1 asked and unanswered, S2 quoted, S3 declined');
-- (S2 was also shortlisted on rfq3 without being sent: its category A count above is 2, not 3)
select is((select count(*)::int from public.v_supplier_category_evidence where family_id is null), 0, 'an item with no category produces no row');

-- the view holds counts and a date, no money
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'public' and table_name = 'v_supplier_category_evidence'),
          array['supplier_id', 'family_id', 'asked', 'replied', 'quoted', 'no_offer', 'ordered', 'last_asked_on'], 'the view has exactly the agreed columns');
select is((select coalesce(array_agg(column_name::text order by ordinal_position), '{}') from information_schema.columns
           where table_schema = 'public' and table_name = 'v_supplier_category_evidence'
             and data_type not in ('uuid', 'integer', 'date')),
          '{}'::text[], 'and every column is an id, a count or a date: no numeric or money column (0902)');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.v_supplier_category_evidence'::regclass),
  'the view is security_invoker');
select ok(has_table_privilege('authenticated', 'public.v_supplier_category_evidence', 'select')
      and has_table_privilege('qtech_engineer', 'public.v_supplier_category_evidence', 'select')
      and not has_table_privilege('anon', 'public.v_supplier_category_evidence', 'select')
      and not has_table_privilege('authenticated', 'public.v_supplier_category_evidence', 'insert'),
  'authenticated and qtech_engineer read the view; anon does not; nobody writes it');
select is(pg_temp.as_('engineer', pg_temp.evq((select a from cat))), pg_temp.as_('admin', pg_temp.evq((select a from cat))),
  'the engineer reads the same counts as the admin');
select is(pg_temp.as_('sales', pg_temp.evq((select a from cat))), pg_temp.as_('admin', pg_temp.evq((select a from cat))), 'and so does sales');
select is(pg_temp.as_('deactivated', 'select count(*)::text from public.v_supplier_category_evidence'), '0',
  'a deactivated person sees no row');

-- ================================================================== supplier_category_price_wins
-- Category A, item e..01: S2 (2000) beats S1 (3000). Item e..04: S1 (1000) beats S2 (1500). Item e..02 has one quote only: not ranked.
create temp table pw_sql as select
  'select string_agg(right(w.supplier_id::text, 2) || ''='' || coalesce(w.wins::text, ''null'') || ''/'' || coalesce(w.of_ranked::text, ''null''), '' '' order by w.supplier_id) '
  || 'from public.supplier_category_price_wins(array[' || quote_literal((select a from cat)) || '::uuid]) w' as qa;

select is(pg_temp.as_('admin', (select qa from pw_sql)), '11=1/2 12=1/2 13=0/0', 'admin: wins and items ranked per supplier, category A');
select is(pg_temp.as_('sales', (select qa from pw_sql)), '11=1/2 12=1/2 13=0/0', 'sales: the same');
select is(pg_temp.as_('engineer', (select qa from pw_sql)), '11=null/null 12=null/null 13=null/null',
  'engineer: a row per supplier, every count NULL (no price is learnt from a count)');
select is(pg_temp.as_('deactivated', (select qa from pw_sql)), '<null>', 'a deactivated person gets no rows');
select is(pg_temp.as_('admin', 'select count(*)::text from public.supplier_category_price_wins(null)'), '0', 'no categories asked, no rows');
select is(pg_temp.as_('admin', 'select count(*)::text from public.supplier_category_price_wins(array[]::uuid[])'), '0', 'an empty list, no rows');
select ok(not has_function_privilege('anon', 'public.supplier_category_price_wins(uuid[])', 'execute'), 'anon cannot run it');
select ok(has_function_privilege('authenticated', 'public.supplier_category_price_wins(uuid[])', 'execute')
      and has_function_privilege('qtech_engineer', 'public.supplier_category_price_wins(uuid[])', 'execute'),
  'authenticated and qtech_engineer can run it (the engineer gets NULLs)');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.supplier_category_price_wins(uuid[])'::regprocedure),
  'it is SECURITY DEFINER in public with an empty search_path (0057)');

-- ================================================================== tagging a supplier with a category
create temp table ids as select (select a from cat)::text as a, (select b from cat)::text as b;

select is(pg_temp.as_('engineer', format($q$insert into public.company_brands (company_id, brand_id) values ('c0930000-0000-4000-8000-000000000013', %L) returning brand_id::text$q$, (select b from ids))),
  'E:P0001', 'an engineer cannot tag a supplier with a category');
select is(pg_temp.as_('sales', format($q$insert into public.company_brands (company_id, brand_id) values ('c0930000-0000-4000-8000-000000000013', %L) returning brand_id::text$q$, (select b from ids))),
  (select b from ids), 'sales can');
select is(pg_temp.as_('admin', format($q$insert into public.company_brands (company_id, brand_id) values ('c0930000-0000-4000-8000-000000000013', %L) returning brand_id::text$q$, (select b from ids))),
  (select b from ids), 'and so can the admin');
select is(pg_temp.as_('engineer', format($q$delete from public.company_brands where company_id = 'c0930000-0000-4000-8000-000000000011' and brand_id = %L returning brand_id::text$q$, (select a from ids))),
  'E:P0001', 'an engineer cannot remove a category from a supplier');
select is(pg_temp.as_('sales', format($q$delete from public.company_brands where company_id = 'c0930000-0000-4000-8000-000000000011' and brand_id = %L returning brand_id::text$q$, (select a from ids))),
  (select a from ids), 'sales can');
select is(pg_temp.as_('admin', format($q$delete from public.company_brands where company_id = 'c0930000-0000-4000-8000-000000000011' and brand_id = %L returning brand_id::text$q$, (select a from ids))),
  (select a from ids), 'and so can the admin');
select is(pg_temp.as_('engineer', format($q$update public.company_brands set brand_id = %L where company_id = 'c0930000-0000-4000-8000-000000000013' and brand_id = 'b0930000-0000-4000-8000-0000000000b1' returning brand_id::text$q$, (select b from ids))),
  'E:P0001', 'an engineer cannot turn a brand tag into a category tag');
-- a plain brand tag is unchanged: every staff role keeps it (0025 matrix)
select is(pg_temp.as_('engineer', $q$insert into public.company_brands (company_id, brand_id) values ('c0930000-0000-4000-8000-000000000011', 'b0930000-0000-4000-8000-0000000000b1') returning brand_id::text$q$),
  'b0930000-0000-4000-8000-0000000000b1', 'an engineer can still tag a supplier with a brand');
select is(pg_temp.as_('engineer', $q$delete from public.company_brands where company_id = 'c0930000-0000-4000-8000-000000000013' and brand_id = 'b0930000-0000-4000-8000-0000000000b1' returning brand_id::text$q$),
  'b0930000-0000-4000-8000-0000000000b1', 'and remove one');

-- the learn trigger and the owner paths are not limited: a quote line by sales for a new category tags the supplier
create function pg_temp.learn_check(fam uuid) returns text language plpgsql as $f$
begin
  insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency)
  values ('f1930000-0000-4000-8000-0000000000f1', 'f0930000-0000-4000-8000-000000000006', 'e0930000-0000-4000-8000-000000000005', 10, 'PKR');
  return exists (select 1 from public.company_brands cb where cb.company_id = 'c0930000-0000-4000-8000-000000000013' and cb.brand_id = fam)::text;
end
$f$;
select is(pg_temp.as_('sales', format('select pg_temp.learn_check(%L::uuid)', (select a from ids))), 'true',
  'a quote line still tags the supplier with its category (the definer trigger is not limited by the guard)');

-- any staff member sets the category of an RFQ item (rfq_items.family_id)
select is(pg_temp.as_('engineer', format($q$update public.rfq_items set family_id = %L where id = 'e0930000-0000-4000-8000-000000000006' returning family_id::text$q$, (select b from ids))),
  (select b from ids), 'an engineer can set the category of an RFQ item');
select is(pg_temp.as_('sales', format($q$update public.rfq_items set family_id = %L where id = 'e0930000-0000-4000-8000-000000000006' returning family_id::text$q$, (select b from ids))),
  (select b from ids), 'so can sales');
select is(pg_temp.as_('deactivated', format($q$update public.rfq_items set family_id = %L where id = 'e0930000-0000-4000-8000-000000000006' returning family_id::text$q$, (select b from ids))),
  '<none>', 'a deactivated person cannot');

select * from finish();
rollback;
