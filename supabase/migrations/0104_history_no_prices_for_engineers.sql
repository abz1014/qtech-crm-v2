-- 0104_history_no_prices_for_engineers (checkpoint 1, security). EXPAND-ONLY: CREATE OR REPLACE of one function; no table, column, grant or
-- policy changes (the function's grants and comment stay as 0090 set them).
--
-- 0090's reader strips every key the caller's API role may not SELECT. For an engineer that left gst_rate (a column the engineer may read,
-- classified "info" in the verify-roles money list) in the record_history answer for an RFQ or order line. Owner decision (checkpoint 1):
-- an engineer sees no tax or price field in a history, even where a column grant allows it. For an engineer the reader now also drops
-- every key named like a price, cost, margin, amount, total, GST, net, gross, balance, payment, PKR, tax, spread, rate or the like
-- (whole words between underscores, so "generated_by" and "delivered_on" stay). Admin and sales are unchanged. The rest of the body is 0090's.

create or replace function public.record_history_rows(
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
            and coalesce((select cc.ok from cols cc where cc.t = c.table_name and cc.k = e.key), $5 = 'admin')
            and ($5 <> 'engineer' or e.key !~ $re$(^|_)(price|prices|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|settled|payable|owed|committed|overhead|deposit|profit|sale|sold|sell|rate)(_|$)$re$)) as was,
        (select jsonb_object_agg(e.key, e.value) from jsonb_each(c.new_value) e
          where e.key <> all (array['updated_at', 'model_tokens', 'legacy_source'])
            and coalesce((select cc.ok from cols cc where cc.t = c.table_name and cc.k = e.key), $5 = 'admin')
            and ($5 <> 'engineer' or e.key !~ $re$(^|_)(price|prices|cost|margin|amount|total|gst|net|gross|balance|paid|pkr|tax|spread|settled|payable|owed|committed|overhead|deposit|profit|sale|sold|sell|rate)(_|$)$re$)) as now
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

