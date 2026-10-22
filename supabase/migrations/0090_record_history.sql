-- 0090_record_history (task W2, "fix mistakes anywhere"): every record can show its history, "was X, now Y, by whom, when",
-- and an engineer never sees a money change.
--
-- audit_log already holds the history (0005, 0013, 0075) but only an admin may read it. This migration lets staff read the part
-- of it that belongs to a record they can open, through one function:
--
--   public.record_history(p_table, p_id, p_before, p_limit)      SECURITY INVOKER
--       Checks that the table is one of the record kinds that have a history page, then that the caller can see the row under
--       their OWN row security (an admin may also read the history of a deleted record). Then marks the transaction with
--       qtech.history_for = '<table>:<id>' (the 0073 mark pattern) and calls the definer function below.
--   public.record_history_rows(p_table, p_id, p_before, p_limit) SECURITY DEFINER, search_path ''
--       Refuses unless that mark matches, so it cannot be used to read the audit log of any other record. Reads the record's
--       own audit rows and those of its children (history_sources), including lines that were removed (their insert and
--       delete images carry the parent id), and returns them as jsonb.
--
-- Who sees what:
--   * Child tables are filtered by history_sources.roles, which mirrors each child table's SELECT policy (so sales get no
--     payments_in, expenses or order_costs events, an engineer gets no invoice events).
--   * Money never reaches an engineer: for an engineer the columns are filtered with has_column_privilege('qtech_engineer', ...)
--     (the PRICE columns of 0081 are not granted to that role), for everyone else with 'authenticated'. A key the caller may not
--     SELECT is stripped from was and now; an event that is empty after that is dropped. A key the table no longer has (a
--     dropped or renamed column) is kept for an admin only. updated_at, model_tokens and legacy_source are never returned.
--   * Names (refs) are looked up for the ids found in the already-redacted values only.
--
-- Paging: newest first, p_limit events (default 50, at most 200) and every event that shares the timestamp of the last one
-- (one transaction stamps all its rows with the same changed_at, so a page never splits it); has_more says whether older events
-- exist; the next page is p_before = the last event's "at".
--
-- The definer function lives in schema public (0081's test forbids SECURITY DEFINER in qtech_private); it pins search_path ''
-- (0057) and is granted to authenticated and qtech_engineer like every other function (0081).

-- ================================================================ 1. which child tables belong under which record
create table public.history_sources (
  child_table  text   not null,
  parent_table text   not null,
  parent_col   text   not null,
  label_col    text,
  roles        text[] not null,
  primary key (child_table, parent_table)
);

comment on table public.history_sources is
  '0090: the child tables whose audit rows are shown under a record''s history. roles = who may read that child table (its SELECT policy), parent_col = the column holding the parent id, label_col = the column that names a child line (NULL: none).';

alter table public.history_sources enable row level security;
revoke all on table public.history_sources from public, anon, authenticated;
grant select on table public.history_sources to authenticated, qtech_engineer;

create policy history_sources_select_staff on public.history_sources for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) is not null);

insert into public.history_sources (child_table, parent_table, parent_col, label_col, roles) values
  -- under an RFQ
  ('rfq_items',          'rfqs',      'rfq_id',     'description', '{admin,sales,engineer}'),
  ('supplier_inquiries', 'rfqs',      'rfq_id',     'supplier_id', '{admin,sales,engineer}'),
  ('clarifications',     'rfqs',      'rfq_id',     'question',    '{admin,sales,engineer}'),
  ('quotations',         'rfqs',      'rfq_id',     'number',      '{admin,sales,engineer}'),
  ('attachments',        'rfqs',      'rfq_id',     'file_name',   '{admin,sales,engineer}'),
  -- under an order
  ('order_items',        'orders',    'order_id',   'description', '{admin,sales,engineer}'),
  ('supplier_orders',    'orders',    'order_id',   'reference',   '{admin,sales,engineer}'),
  ('order_costs',        'orders',    'order_id',   null,          '{admin}'),
  ('order_engineers',    'orders',    'order_id',   'user_id',     '{admin,sales,engineer}'),
  ('invoices',           'orders',    'order_id',   'number',      '{admin,sales}'),
  ('payments_in',        'orders',    'order_id',   'reference',   '{admin}'),
  ('expenses',           'orders',    'order_id',   'description', '{admin}'),
  ('attachments',        'orders',    'order_id',   'file_name',   '{admin,sales,engineer}'),
  -- under a company
  ('contacts',           'companies', 'company_id', 'name',        '{admin,sales,engineer}'),
  ('company_sites',      'companies', 'company_id', 'name',        '{admin,sales,engineer}'),
  -- attachments of an invoice or an expense follow that parent's access (0026)
  ('attachments',        'invoices',  'invoice_id', 'file_name',   '{admin,sales}'),
  ('attachments',        'expenses',  'expense_id', 'file_name',   '{admin}');

create trigger history_sources_audit after insert or update or delete on public.history_sources
  for each row execute function public.audit_row_change();

-- ================================================================ 2. indexes: children found by their parent id in the insert and delete images
create index audit_log_parent_order_idx on public.audit_log ((coalesce(new_value, old_value) ->> 'order_id'))
  where action in ('insert', 'delete');
create index audit_log_parent_rfq_idx on public.audit_log ((coalesce(new_value, old_value) ->> 'rfq_id'))
  where action in ('insert', 'delete');
create index audit_log_parent_company_idx on public.audit_log ((coalesce(new_value, old_value) ->> 'company_id'))
  where action in ('insert', 'delete');

-- ================================================================ 3. the definer reader (refuses unless record_history marked the transaction)
create function public.record_history_rows(
  p_table  text,
  p_id     uuid,
  p_before timestamptz default null,
  p_limit  integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text := (select public.current_user_role());
  v_api    text;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_parts  text := '';
  v_rid    text;
  v_lab    text;
  v_lab_q  text;
  s        record;
  v_sql    text;
  v_out    jsonb;
begin
  if coalesce(current_setting('qtech.history_for', true), '') is distinct from (p_table || ':' || p_id::text) then
    raise exception 'record_history_rows is internal: call record_history' using errcode = '42501', hint = 'history_internal';
  end if;
  -- one use: the mark does not stay valid for a second call in the same transaction
  perform set_config('qtech.history_for', '', true);

  if v_role is null then
    raise exception 'You cannot see the history of this record.' using errcode = '42501', hint = 'history_forbidden';
  end if;
  v_api := case when v_role = 'engineer' then 'qtech_engineer' else 'authenticated' end;

  -- the child lines: live ones, and those removed or imported-away that the audit log still remembers
  for s in
    select h.child_table, h.parent_col, h.label_col
    from public.history_sources h
    where h.parent_table = p_table and h.roles @> array[v_role]
    order by h.child_table
  loop
    v_rid := case s.child_table
               when 'order_costs' then 'c.order_id::text'
               when 'order_engineers' then 'jsonb_build_object(''order_id'', c.order_id, ''user_id'', c.user_id)::text'
               else 'c.id::text' end;
    if s.label_col is not null
       and has_column_privilege(v_api::name, 'public.' || s.child_table, s.label_col, 'SELECT') then
      v_lab   := format('c.%I::text', s.label_col);
      v_lab_q := format('coalesce(a.new_value, a.old_value) ->> %L', s.label_col);
    else
      v_lab   := 'null::text';
      v_lab_q := 'null::text';
    end if;
    v_parts := v_parts || case when v_parts = '' then '' else ' union all ' end
      || format(
           'select a.record_id as rid, %1$L::text as t, %2$s as label from public.audit_log a '
           || 'where a.table_name = %1$L and a.action in (''insert'', ''delete'') '
           || 'and coalesce(a.new_value, a.old_value) ->> %3$L = $2::text '
           || 'union all select %4$s as rid, %1$L::text as t, %5$s as label from public.%6$I c where c.%7$I = $2',
           s.child_table, v_lab_q, s.parent_col, v_rid, v_lab, s.child_table, s.parent_col);
  end loop;
  if v_parts = '' then
    v_parts := 'select null::text as rid, null::text as t, null::text as label where false';
  end if;

  v_sql := $q$
    with kids as (
      select u.t, u.rid, max(u.label) as label from ( $q$ || v_parts || $q$ ) u group by u.t, u.rid
    ),
    cand as (
      select a.id, a.changed_at, a.action, a.changed_by, a.table_name, a.record_id, a.old_value, a.new_value, null::text as label
      from public.audit_log a
      where a.table_name = $1 and a.record_id = $2::text and ($3 is null or a.changed_at < $3)
      union all
      select a.id, a.changed_at, a.action, a.changed_by, a.table_name, a.record_id, a.old_value, a.new_value, k.label
      from kids k
      join public.audit_log a on a.table_name = k.t and a.record_id = k.rid
      where ($3 is null or a.changed_at < $3)
    ),
    cols as (
      select cl.relname::text as t, pa.attname::text as k,
             has_column_privilege($6::name, cl.oid, pa.attnum, 'SELECT') as ok
      from pg_catalog.pg_class cl
      join pg_catalog.pg_attribute pa on pa.attrelid = cl.oid and pa.attnum > 0 and not pa.attisdropped
      where cl.relnamespace = 'public'::regnamespace and cl.relkind in ('r', 'p')
        and cl.relname::text in (select distinct c0.table_name from cand c0)
    ),
    red as (
      select c.id, c.changed_at, c.action, c.changed_by, c.table_name, c.record_id, c.label,
        (select jsonb_object_agg(e.key, e.value) from jsonb_each(c.old_value) e
          where e.key <> all (array['updated_at', 'model_tokens', 'legacy_source'])
            and coalesce((select cc.ok from cols cc where cc.t = c.table_name and cc.k = e.key), $5 = 'admin')) as was,
        (select jsonb_object_agg(e.key, e.value) from jsonb_each(c.new_value) e
          where e.key <> all (array['updated_at', 'model_tokens', 'legacy_source'])
            and coalesce((select cc.ok from cols cc where cc.t = c.table_name and cc.k = e.key), $5 = 'admin')) as now
      from cand c
    ),
    kept as (
      select r.* from red r where r.was is not null or r.now is not null
    ),
    bound as (
      select k.changed_at from kept k order by k.changed_at desc, k.id limit 1 offset ($4 - 1)
    ),
    page as (
      select k.* from kept k
      where not exists (select 1 from bound) or k.changed_at >= (select b.changed_at from bound b)
    ),
    more as (
      select exists (select 1 from kept k where k.changed_at < (select b.changed_at from bound b)) as m
    ),
    ev as (
      select p.changed_at, p.id,
             jsonb_build_object(
               'id', p.id, 'at', p.changed_at, 'action', p.action, 'table', p.table_name, 'record_id', p.record_id,
               'by', p.changed_by, 'by_name', u.name, 'was', p.was, 'now', p.now,
               'child_label', case when p.table_name <> $1 then p.label end) as j
      from page p
      left join public.users u on u.id = p.changed_by
    ),
    vals as (
      select x.s from (
        select e.value #>> '{}' as s
        from page p
        cross join lateral (select v.value from jsonb_each(coalesce(p.was, '{}'::jsonb)) v
                            union all
                            select v.value from jsonb_each(coalesce(p.now, '{}'::jsonb)) v) e
        where jsonb_typeof(e.value) = 'string'
        union all
        select p.label from page p where p.table_name <> $1
      ) x
      where x.s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    ids as (
      select distinct (case when vv.s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then vv.s::uuid end) as id
      from vals vv
    ),
    refs as (
      select r.k, r.v from (
        select c.id::text as k, c.name as v from public.companies c where c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.contacts c where c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.company_sites c where c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.users c where c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.brands c where c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.expense_categories c where $5 = 'admin' and c.id in (select i.id from ids i)
        union all select c.id::text, c.name from public.expense_groups c where $5 = 'admin' and c.id in (select i.id from ids i)
      ) r
    )
    select jsonb_build_object(
      'events',   coalesce((select jsonb_agg(ev.j order by ev.changed_at desc, ev.id) from ev), '[]'::jsonb),
      'refs',     coalesce((select jsonb_object_agg(rf.k, rf.v) from refs rf), '{}'::jsonb),
      'has_more', coalesce((select m.m from more m), false))
  $q$;

  execute v_sql into v_out using p_table, p_id, p_before, v_limit, v_role, v_api;
  return v_out;
end;
$$;

revoke all on function public.record_history_rows(text, uuid, timestamptz, integer) from public, anon;
grant execute on function public.record_history_rows(text, uuid, timestamptz, integer) to authenticated, qtech_engineer;

comment on function public.record_history_rows(text, uuid, timestamptz, integer) is
  '0090: DEFINER reader behind record_history. Refuses unless record_history marked this transaction for the same record. Strips every key the caller''s API role may not SELECT (an engineer: no prices).';

-- ================================================================ 4. the entry point (the caller's own row security decides)
create function public.record_history(
  p_table  text,
  p_id     uuid,
  p_before timestamptz default null,
  p_limit  integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seen boolean;
begin
  if p_table is null or p_id is null
     or p_table <> all (array['rfqs', 'orders', 'invoices', 'payments_in', 'expenses', 'quotations', 'purchase_orders',
                              'companies', 'contacts', 'company_sites', 'recurring_expenses']) then
    raise exception 'This kind of record has no history page.' using errcode = '22023', hint = 'history_table';
  end if;

  -- under the caller's own row security: a row they cannot open has no history for them
  execute format('select exists (select 1 from public.%I where id = $1)', p_table) into v_seen using p_id;
  if not v_seen and (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'You cannot see the history of this record.' using errcode = '42501', hint = 'history_forbidden';
  end if;

  perform set_config('qtech.history_for', p_table || ':' || p_id::text, true);
  return public.record_history_rows(p_table, p_id, p_before, p_limit);
end;
$$;

revoke all on function public.record_history(text, uuid, timestamptz, integer) from public, anon;
grant execute on function public.record_history(text, uuid, timestamptz, integer) to authenticated, qtech_engineer;

comment on function public.record_history(text, uuid, timestamptz, integer) is
  '0090: the history of one record and its child lines: {events, refs, has_more}. "was X, now Y, by whom, when"; an engineer never gets a money column.';

notify pgrst, 'reload schema';
