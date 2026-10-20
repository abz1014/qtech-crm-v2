-- 0075_audit_diffs_and_archive (performance audit 2026-10-20, item 4): keep audit_log well inside the Free plan's 500 MB
-- without losing any history the owner needs (who changed a money row, when, from what to what).
--
-- Measured before this change (0075_audit_diffs.test.sql and supabase/perf/db_perf.sql print the figures in CI): every UPDATE
-- stored the whole old row AND the whole new row as jsonb, on 29 tables, so one tick, chase or stamp cost two full copies of the
-- row (two copies of a quotation's or PO's `lines` when only pdf_path changed), and a no-op update (`set x = x`) cost the same.
--
-- 1. audit_row_change() stores an UPDATE as its changes only: old_value holds the old value of every column that changed and
--    new_value the new value of the same columns. An update that changes nothing writes no row. updated_at and model_tokens
--    are left out (updated_at moves on every write and changed_at already records the moment; model_tokens is generated from
--    description, which is in the diff whenever it changes). INSERT still stores the full new row and DELETE the full old row,
--    so every version of a row can be rebuilt: the insert image, then each update's new_value applied in order (the pgTAP test
--    does exactly that). Who (changed_by), when (changed_at) and what (every changed column, old and new) are kept for every
--    table, money tables included, for ever. The shape of audit_log is unchanged (DATA_MODEL 2.22).
-- 2. audit_archive.compact(p_keep_months default 24, at least 12): moves the audit rows older than that, of the tables listed
--    by audit_archive.archivable_tables() (work-flow tables that carry no money: snoozes, enquiries, questions and the like),
--    out of public.audit_log into audit_archive.audit_log_months: one row per table and Karachi month holding those rows as one
--    jsonb array, which Postgres compresses (TOAST; lz4 where the server offers it). Nothing is lost: the array holds every
--    column of every row, and the view audit_archive.audit_log_all shows live and archived rows together. Money tables
--    (invoices, payments_in, expenses, recurring_expenses, expense_categories, order_costs, orders, order_items,
--    supplier_orders, quotations, purchase_orders, rfq_items, supplier_quote_lines, targets, closed_months, company_profile,
--    fx_rates, attachments) are never moved. Runs monthly from pg_cron when the server has it (as the FX job does, 0038).
-- The audit_archive schema is not exposed by the API and nothing in it is granted to anon, authenticated or service_role:
-- only the database owner (the SQL editor) reads it. public.audit_log keeps its grants: still no UPDATE or DELETE for anyone;
-- compact() is SECURITY DEFINER, like import_purge_audit() (0055).

-- ================================================================ 1. updates as diffs, no-op updates skipped
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      jsonb;
  rid    text;
  v_old  jsonb;
  v_was  jsonb;
  v_now  jsonb;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);

  if tg_nargs = 0 then
    rid := r ->> 'id';
  elsif tg_nargs = 1 then
    rid := r ->> tg_argv[0];
  else
    select jsonb_object_agg(k, r -> k)::text into rid from unnest(tg_argv) as k;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'delete', auth.uid(), r, null);
    return old;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select jsonb_object_agg(c.key, v_old -> c.key), jsonb_object_agg(c.key, c.value)
    into v_was, v_now
    from jsonb_each(r) as c
    where c.key not in ('updated_at', 'model_tokens')
      and c.value is distinct from (v_old -> c.key);
    if v_now is null then
      return new;   -- nothing changed (or only updated_at): no audit row
    end if;
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'update', auth.uid(), v_was, v_now);
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, changed_by, old_value, new_value)
    values (tg_table_name, rid, 'insert', auth.uid(), null, r);
    return new;
  end if;
end;
$$;

comment on function public.audit_row_change() is
  'Audit trigger (0013, 0075): insert = full new row, delete = full old row, update = the changed columns only (old and new), no row for a no-op update.';

-- ================================================================ 2. archive of old work-flow rows
create schema audit_archive;
comment on schema audit_archive is
  'Compressed archive of old audit_log rows of tables that carry no money (0075). Not exposed by the API; owner only.';
revoke all on schema audit_archive from public;

create table audit_archive.audit_log_months (
  table_name   text        not null,
  month        date        not null,
  row_count    integer     not null check (row_count > 0),
  first_at     timestamptz not null,
  last_at      timestamptz not null,
  rows         jsonb       not null,
  archived_at  timestamptz not null default now(),
  primary key (table_name, month)
);

comment on table audit_archive.audit_log_months is
  'One row per table and Karachi month: the audit_log rows moved by audit_archive.compact(), oldest first, every column kept (0075).';
comment on column audit_archive.audit_log_months.rows is
  'jsonb array of to_jsonb(audit_log row): id, table_name, record_id, action, changed_by, changed_at, old_value, new_value.';

alter table audit_archive.audit_log_months enable row level security;
revoke all on table audit_archive.audit_log_months from public, anon, authenticated, service_role;

-- lz4 compresses jsonb faster and about as well as the default pglz; keep pglz where the server was built without it.
do $do$
begin
  execute 'alter table audit_archive.audit_log_months alter column rows set compression lz4';
exception when others then
  raise notice '0075: lz4 not available (%), the archive uses the default compression', sqlerrm;
end
$do$;

-- The tables whose old audit rows may be archived: work-flow records with no money in them. Any table not listed (every money
-- table, and any table added later) stays in public.audit_log for ever.
create function audit_archive.archivable_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['brands', 'clarifications', 'companies', 'company_brands', 'company_sites', 'contacts',
               'inquiry_item_declines', 'order_engineers', 'rfqs', 'snoozes', 'supplier_inquiries']::text[]
$$;

-- Live and archived rows together, for the SQL editor: one row per audit event, as audit_log has them.
create view audit_archive.audit_log_all with (security_invoker = true) as
select a.id, a.table_name, a.record_id, a.action, a.changed_by, a.changed_at, a.old_value, a.new_value, false as archived
from public.audit_log a
union all
select (e ->> 'id')::uuid,
       e ->> 'table_name',
       e ->> 'record_id',
       e ->> 'action',
       (e ->> 'changed_by')::uuid,
       (e ->> 'changed_at')::timestamptz,
       nullif(e -> 'old_value', 'null'::jsonb),
       nullif(e -> 'new_value', 'null'::jsonb),
       true
from audit_archive.audit_log_months m
cross join lateral jsonb_array_elements(m.rows) as e;

revoke all on audit_archive.audit_log_all from public, anon, authenticated, service_role;

-- Moves whole Karachi months older than p_keep_months (at least 12) of the archivable tables; returns the number of rows moved.
-- One statement: the delete and the insert commit together or not at all. Running it again moves nothing new.
create function audit_archive.compact(p_keep_months integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_moved  integer;
begin
  if p_keep_months is null or p_keep_months < 12 then
    raise exception 'audit_archive.compact keeps at least 12 months in audit_log (asked for %)', p_keep_months
      using errcode = '22023';
  end if;
  v_cutoff := (date_trunc('month', now() at time zone 'Asia/Karachi') - make_interval(months => p_keep_months))
              at time zone 'Asia/Karachi';

  with moved as (
    delete from public.audit_log a
    where a.changed_at < v_cutoff
      and a.table_name = any (audit_archive.archivable_tables())
    returning a.*
  ),
  grouped as (
    select m.table_name,
           date_trunc('month', m.changed_at at time zone 'Asia/Karachi')::date as month,
           count(*)::int as n,
           min(m.changed_at) as first_at,
           max(m.changed_at) as last_at,
           jsonb_agg(to_jsonb(m) order by m.changed_at, m.id) as rows
    from moved m
    group by 1, 2
  ),
  ins as (
    insert into audit_archive.audit_log_months as t (table_name, month, row_count, first_at, last_at, rows)
    select g.table_name, g.month, g.n, g.first_at, g.last_at, g.rows from grouped g
    on conflict (table_name, month) do update
      set row_count   = t.row_count + excluded.row_count,
          first_at    = least(t.first_at, excluded.first_at),
          last_at     = greatest(t.last_at, excluded.last_at),
          rows        = t.rows || excluded.rows,
          archived_at = now()
    returning 1
  )
  select count(*)::int into v_moved from moved;

  return v_moved;
end;
$$;

revoke all on function audit_archive.compact(integer) from public, anon, authenticated, service_role;
revoke all on function audit_archive.archivable_tables() from public, anon, authenticated, service_role;

comment on function audit_archive.compact(integer) is
  'Moves audit_log rows older than p_keep_months (>= 12) of audit_archive.archivable_tables() into audit_log_months. Lossless. 0075.';

-- Monthly at 03:17 Karachi time on the 3rd, when pg_cron is installed (0038 installs it where the server offers it).
do $do$
begin
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '0075: pg_cron not installed, audit_archive.compact() is not scheduled (run it by hand when wanted)';
    return;
  end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'audit-compact'$q$;
  execute $q$select cron.schedule('audit-compact', '17 22 2 * *', 'select audit_archive.compact()')$q$;
exception when others then
  raise notice '0075: could not schedule audit-compact (%): run audit_archive.compact() by hand when wanted', sqlerrm;
end
$do$;
