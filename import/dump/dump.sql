-- dump.sql: the old CRM's data as one JSON value, for the v2 import. READ ONLY: this is a single SELECT.
--
-- HOW TO RUN (owner, in the OLD project): Dashboard > SQL Editor > New query, paste this whole file, Run.
-- The result is one row with one column, "dump". Copy the cell (in the Results grid: click it, then the copy button, or
-- Export > Download as JSON/CSV) and save it as  import/.data/dump/dump.json  on your own machine. Never commit it.
--
-- WHY IT IS BUILT THIS WAY
--  * One statement, only SELECT: it cannot change anything. (It uses query_to_xml, which runs a SELECT you give it as text,
--    so that a table or column the old project does not have gives an empty list and a note, not an error.)
--  * Every table is read with to_jsonb(row): the columns that exist are the columns you get. Nothing is named, so a column that
--    drifted into production without a migration comes through, and a missing one cannot stop the query.
--  * A table that does not exist is listed under meta.tables_missing and comes out as an empty list.
--  * users.password (a plain-text password in the old schema) is removed from the output. employees and attendance (salaries,
--    HR) and the big audit and follow-up tables are counted, not copied: their rows are not needed.
--  * "catalog" records the shape of the old database (columns, check constraints, triggers, functions, views, cron jobs, login
--    providers, storage buckets) so the I06 checklist can answer the section 8 questions. It holds no passwords, keys, e-mail
--    addresses, or cron command text.
--
-- IF THE RESULT IS TOO BIG FOR THE EDITOR: run it twice. In the line below that says 'all'::text as parts, put 'a' for the first
-- run (people, customers, RFQs, orders) and 'b' for the second (money, receipt files, catalog). Save both results, one per
-- run. Save them as dump.json and dump-b.json in the same folder: the reader joins them. (Normally one run is enough: a few
-- hundred orders is well under a megabyte.)

with cfg as (
  select 'public'::text as sch,   -- the schema that holds the old CRM tables
         'all'::text as parts     -- 'all', or 'a' / 'b' to split a very large result in two
),
-- (key, columns to leave out of the copy, part)
tbl(key, hide, part) as (values
  ('users',               '{password}'::text[], 'a'),
  ('clients',             '{}', 'a'),
  ('prospects',           '{}', 'a'),
  ('vendors',             '{}', 'a'),
  ('rfqs',                '{}', 'a'),
  ('rfq_line_items',      '{}', 'a'),
  ('supplier_inquiries',  '{}', 'a'),
  ('supplier_quotes',     '{}', 'a'),
  ('orders',              '{}', 'a'),
  ('order_engineers',     '{}', 'a'),
  ('gst_invoices',        '{}', 'b'),
  ('invoices',            '{}', 'b'),
  ('payment_records',     '{}', 'b'),
  ('order_payments',      '{}', 'b'),
  ('supplier_payments',   '{}', 'b'),
  ('payables',            '{}', 'b'),
  ('payable_payments',    '{}', 'b'),
  ('expenses',            '{}', 'b'),
  ('recurring_expenses',  '{}', 'b'),
  ('quarterly_targets',   '{}', 'b'),
  ('documents',           '{}', 'b'),
  ('budgets',             '{}', 'b'),
  ('costing_config',      '{}', 'b')
),
-- Tables that are only counted (HR data, machine-generated or very large, not carried to v2).
counted(key) as (values ('employees'), ('attendance'), ('follow_up_actions'), ('cost_lines'), ('audit_log')),
jobs(key, kind, reg, sql, part) as (
  -- full copies
  select t.key, 'table', format('%I.%I', c.sch, t.key),
         format($q$select coalesce(jsonb_agg(to_jsonb(x) - %L::text[]), '[]'::jsonb) as j from %I.%I x$q$, t.hide, c.sch, t.key),
         t.part
  from tbl t cross join cfg c
  union all
  -- counts only
  select n.key, 'count', format('%I.%I', c.sch, n.key),
         format($q$select jsonb_build_object('rows', count(*)) as j from %I.%I$q$, c.sch, n.key),
         'a'
  from counted n cross join cfg c
  union all
  -- the receipt files
  select 'storage', 'storage', 'storage.objects',
         $q$select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name,
              'size_bytes', nullif(metadata ->> 'size', '')::bigint, 'mime_type', metadata ->> 'mimetype')), '[]'::jsonb) as j
            from storage.objects where bucket_id = 'gst-receipts'$q$, 'b'
  union all
  -- the shape of the old database
  select 'columns', 'catalog', 'information_schema.columns',
         format($q$select coalesce(jsonb_object_agg(table_name, cols), '{}'::jsonb) as j from (
            select table_name, jsonb_agg(jsonb_build_object('column', column_name, 'type', data_type, 'nullable', is_nullable)
                                         order by ordinal_position) as cols
            from information_schema.columns where table_schema = %L group by table_name) s$q$, c.sch), 'b'
  from cfg c
  union all
  select 'checks', 'catalog', 'pg_catalog.pg_constraint',
         format($q$select coalesce(jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname, 'type', contype,
            'definition', pg_get_constraintdef(oid))), '[]'::jsonb) as j
            from pg_constraint where connamespace = %L::regnamespace and contype in ('c', 'u', 'f')$q$, c.sch), 'b'
  from cfg c
  union all
  select 'triggers', 'catalog', 'pg_catalog.pg_trigger',
         format($q$select coalesce(jsonb_agg(jsonb_build_object('table', tgrelid::regclass::text, 'name', tgname)), '[]'::jsonb) as j
            from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = %L::regnamespace)$q$, c.sch), 'b'
  from cfg c
  union all
  select 'functions', 'catalog', 'pg_catalog.pg_proc',
         format($q$select coalesce(jsonb_agg(proname order by proname), '[]'::jsonb) as j
            from pg_proc where pronamespace = %L::regnamespace$q$, c.sch), 'b'
  from cfg c
  union all
  select 'views', 'catalog', 'pg_catalog.pg_class',
         format($q$select coalesce(jsonb_agg(relname order by relname), '[]'::jsonb) as j
            from pg_class where relnamespace = %L::regnamespace and relkind in ('v', 'm')$q$, c.sch), 'b'
  from cfg c
  union all
  select 'cron', 'catalog', 'cron.job',
         $q$select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb) as j from cron.job$q$, 'b'
  union all
  select 'auth_providers', 'catalog', 'auth.identities',
         $q$select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) as j from (select provider, count(*) as n from auth.identities group by provider) s$q$, 'b'
  union all
  select 'auth_users', 'catalog', 'auth.users',
         $q$select jsonb_build_object('rows', count(*)) as j from auth.users$q$, 'b'
  union all
  select 'buckets', 'catalog', 'storage.buckets',
         $q$select coalesce(jsonb_agg(jsonb_build_object('bucket', b.id, 'public', b.public,
              'objects', (select count(*) from storage.objects o where o.bucket_id = b.id),
              'bytes', (select coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0) from storage.objects o where o.bucket_id = b.id))), '[]'::jsonb) as j
            from storage.buckets b$q$, 'b'
),
-- Run each job as text, only when the table it reads exists. xpath/replace undo the XML escaping of the JSON text.
done as (
  select j.key, j.kind, j.part, (to_regclass(j.reg) is not null) as present,
         case when to_regclass(j.reg) is null or not (cfg.parts = 'all' or cfg.parts = j.part) then null
              else replace(replace(replace(
                     (xpath('string(/row/*)', query_to_xml(j.sql, false, true, '')))[1]::text,
                     '&lt;', '<'), '&gt;', '>'), '&amp;', '&')::jsonb
         end as val
  from jobs j cross join cfg
)
select jsonb_build_object(
  'meta', jsonb_build_object(
    'made_on', now(),
    'schema', (select sch from cfg),
    'parts', (select parts from cfg),
    'postgres', version(),
    'tables_missing', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from done where kind in ('table', 'count') and not present),
    'note', 'dump for the Q-Tech CRM v2 import; users.password removed'
  ),
  'tables', (select coalesce(jsonb_object_agg(key, val), '{}'::jsonb) from done where kind = 'table' and val is not null),
  'storage', (select coalesce((select val from done where kind = 'storage' and val is not null), '[]'::jsonb)),
  'catalog', jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(key, coalesce(val -> 'rows', '0'::jsonb)), '{}'::jsonb) from done where kind = 'count'),
    'details', (select coalesce(jsonb_object_agg(key, val), '{}'::jsonb) from done where kind = 'catalog' and val is not null)
  )
) as dump;
