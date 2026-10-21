-- 0081_engineer_no_prices (owner decision 2026-10-22, decision 5; closes the residual of SECURITY_REVIEW M-3).
--
-- Engineers see no price anywhere, and since this migration the DATABASE refuses them too, not only the app. Every signed-in
-- person is the Postgres role `authenticated`, so a column grant alone cannot tell an engineer from an admin. The data API
-- (PostgREST) therefore moves an engineer's request onto a role of its own before the request runs:
--
--   qtech_engineer          a NOLOGIN role with every privilege `authenticated` has in public (tables, views, sequences,
--                           functions, row-security policies), EXCEPT:
--                             - no SELECT, INSERT or UPDATE on the price, total and rate columns (PRICE below): `select=*` on
--                               those tables is refused (42501), any other column reads and writes as before, and an engineer
--                               can never set or change a price;
--                             - no SELECT on v_fx_latest (exchange rates);
--                             - no EXECUTE on the price RPCs (rank_item_quotes, customer_price_memory, supplier_item_memory,
--                               po_line_prefill) nor on the pricing actions that read prices (issue_quotation,
--                               issue_purchase_order, convert_rfq_to_order, create_repeat_order, split_order_item, set_fx_rate).
--                           It is a member of `anon` only for anon's schema usages (auth, extensions); anon holds nothing
--                           in public (0057's checks).
--   qtech_private.pre_request()
--                           PostgREST's db-pre-request (set on the authenticator role below): when the request runs as
--                           `authenticated` and current_user_role() is 'engineer', it switches the transaction to
--                           qtech_engineer (SET LOCAL ROLE). Admin, sales, anon, service_role and a deactivated person are
--                           untouched, so nothing changes for them.
--   v_order_items_total     an engineer would now be refused by every view that reads order_items.unit_price_net (it feeds
--                           v_order_state, the Orders list and Today). The sums are computed by qtech_private.order_item_totals,
--                           a view in a schema the API does not expose, owned by the migration role, that returns them NULL to
--                           qtech_engineer (everyone else as before); v_order_items_total stays security_invoker and reads it, so
--                           its columns, rows and figures for admin and sales are exactly as before, and an engineer's are NULL.
--   supplier_item_evidence  0074's definition without the unused `price` column it read (an engineer's supplier picker calls it).
--   can_access_bucket       generated-docs (the quotation and PO PDFs: prices on every page) is admin and sales only.
--
-- New tables, views, functions and policies must be granted to qtech_engineer too (or deliberately not, for a price):
-- supabase/tests/0081_engineer_no_prices.test.sql fails when authenticated holds something qtech_engineer does not, outside the
-- PRICE list. Storage requests do not go through PostgREST; the bucket rule covers them.

-- ================================================================ the role
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'qtech_engineer') then
    create role qtech_engineer nologin inherit;
  end if;
end
$$;
comment on role qtech_engineer is
  'Owner decision 2026-10-22 (0081): an engineer''s API requests run as this role (qtech_private.pre_request): authenticated''s privileges without prices.';

-- PostgREST connects as authenticator and switches roles; SET ROLE needs the session user to be a member.
grant qtech_engineer to authenticator;
-- The migration role (and pgTAP, which connects as it) can take the role to prove what it sees.
do $$
begin
  execute 'grant qtech_engineer to postgres';
exception when insufficient_privilege or invalid_grant_operation then
  raise notice '0081: postgres not made a member of qtech_engineer (%)', sqlerrm;
end
$$;

-- Schema usages (auth.uid() in policies and column defaults, pg_trgm in extensions): anon's, nothing in public.
do $$
begin
  begin
    execute 'grant anon to qtech_engineer';
  exception when insufficient_privilege or invalid_grant_operation then
    raise notice '0081: could not grant anon to qtech_engineer (%), granting the schemas directly', sqlerrm;
  end;
  begin
    execute 'grant usage on schema auth to qtech_engineer';
  exception when insufficient_privilege then
    raise notice '0081: usage on schema auth not granted directly (%)', sqlerrm;
  end;
  begin
    execute 'grant usage on schema extensions to qtech_engineer';
  exception when insufficient_privilege or invalid_schema_name then
    raise notice '0081: usage on schema extensions not granted directly (%)', sqlerrm;
  end;
end
$$;
grant usage on schema public to qtech_engineer;

-- ================================================================ privileges: authenticated's, without prices
do $$
declare
  price constant jsonb := '{
    "rfq_items": ["quoted_unit_price_net"],
    "supplier_quote_lines": ["unit_price", "fx_rate_pkr"],
    "quotations": ["lines", "net_total", "gst_total"],
    "order_items": ["unit_price_net", "supplier_unit_price"],
    "purchase_orders": ["total", "lines"],
    "fx_rates": ["rate_pkr"]
  }';
  no_select constant text[] := array['v_fx_latest'];
  no_execute constant text[] := array['rank_item_quotes', 'customer_price_memory', 'supplier_item_memory', 'po_line_prefill',
    'issue_quotation', 'issue_purchase_order', 'convert_rfq_to_order', 'create_repeat_order', 'split_order_item', 'set_fx_rate'];
  r record;
  cols text;
  roles text;
begin
  -- tables, views, sequences: table-level grants
  for r in
    select cl.oid, cl.relname, cl.relkind, a.privilege_type
    from pg_catalog.pg_class cl
    cross join lateral aclexplode(cl.relacl) a
    where cl.relnamespace = 'public'::regnamespace
      and cl.relkind in ('r', 'p', 'v', 'm', 'S')
      and a.grantee = 'authenticated'::regrole
  loop
    if r.relkind = 'S' then
      execute format('grant %s on sequence public.%I to qtech_engineer', r.privilege_type, r.relname);
    elsif r.privilege_type = 'SELECT' and r.relname = any (no_select) then
      continue;
    elsif r.privilege_type in ('SELECT', 'INSERT', 'UPDATE') and price ? r.relname then
      -- read, add or change every column but the prices: an engineer neither reads nor writes a price
      select string_agg(quote_ident(att.attname), ', ' order by att.attnum) into cols
      from pg_catalog.pg_attribute att
      where att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped
        and not ((price -> r.relname) ? att.attname::text);
      execute format('grant %s (%s) on public.%I to qtech_engineer', r.privilege_type, cols, r.relname);
    else
      execute format('grant %s on public.%I to qtech_engineer', r.privilege_type, r.relname);
    end if;
  end loop;

  -- column-level grants (users.phone, 0039)
  for r in
    select cl.relname, att.attname, a.privilege_type
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class cl on cl.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    where cl.relnamespace = 'public'::regnamespace and a.grantee = 'authenticated'::regrole
  loop
    if r.privilege_type in ('SELECT', 'INSERT', 'UPDATE') and price ? r.relname and (price -> r.relname) ? r.attname::text then
      continue;
    end if;
    execute format('grant %s (%I) on public.%I to qtech_engineer', r.privilege_type, r.attname, r.relname);
  end loop;

  -- functions
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'
  loop
    if r.proname = any (no_execute) then
      continue;
    end if;
    execute format('grant execute on function %s to qtech_engineer', r.sig);
  end loop;

  -- row-security policies written for authenticated apply to qtech_engineer too
  for r in
    select pol.polname, cl.relname, pol.polroles
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class cl on cl.oid = pol.polrelid
    where cl.relnamespace = 'public'::regnamespace and 'authenticated'::regrole = any (pol.polroles)
  loop
    select string_agg(quote_ident(rolname), ', ') into roles
    from (select pg_catalog.pg_get_userbyid(x) as rolname from unnest(r.polroles) x
          union select 'qtech_engineer') q;
    execute format('alter policy %I on public.%I to %s', r.polname, r.relname, roles);
  end loop;
end
$$;

-- ================================================================ guards that name the API role
-- The 0065/0068/0073/0078 triggers limit "a signed-in person" by `current_user = 'authenticated'` (the service role and the
-- definer functions are not limited). An engineer's request is now qtech_engineer, so each of them must treat it the same, or
-- the guard would let an engineer through (legacy columns, money fields of an order line, created_by, the chase actor...).
-- Rewritten in place from their current definitions; pgTAP 0081 fails if any function still names only 'authenticated'.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~ 'current_user\s*(=|<>)\s*''authenticated'''
  loop
    def := pg_catalog.pg_get_functiondef(f.oid);
    def := regexp_replace(def, 'current_user\s*<>\s*''authenticated''', 'current_user not in (''authenticated'', ''qtech_engineer'')', 'g');
    def := regexp_replace(def, 'current_user\s*=\s*''authenticated''', 'current_user in (''authenticated'', ''qtech_engineer'')', 'g');
    execute def;
  end loop;
end
$$;

-- ================================================================ the private schema: pre-request and the order sums
create schema qtech_private;
comment on schema qtech_private is
  '0081: not exposed by the API. PostgREST''s pre-request function and the order sums behind v_order_items_total.';
revoke all on schema qtech_private from public;
-- PostgREST runs the pre-request as whichever role the request has: anon, authenticated or service_role.
grant usage on schema qtech_private to anon, authenticated, service_role, qtech_engineer;

-- No SET clause: SET LOCAL ROLE must outlive the function (a SET clause only scopes its own variable, but nothing here needs one;
-- every name is schema-qualified).
create function qtech_private.pre_request()
returns void
language plpgsql
security invoker
as $$
begin
  -- Nested, not AND: only authenticated may run current_user_role() (anon and service_role have no execute on it).
  if current_user = 'authenticated' then
    if (select public.current_user_role()) = 'engineer' then
      perform pg_catalog.set_config('role', 'qtech_engineer', true);
    end if;
  end if;
end;
$$;
revoke all on function qtech_private.pre_request() from public;
grant execute on function qtech_private.pre_request() to anon, authenticated, service_role;
comment on function qtech_private.pre_request() is
  '0081: PostgREST db-pre-request. An engineer''s request runs as qtech_engineer (no prices); everyone else is untouched.';

alter role authenticator set pgrst.db_pre_request to 'qtech_private.pre_request';
notify pgrst, 'reload config';

-- The sums of v_order_items_total (0014), unchanged; NULL for an engineer's request (role qtech_engineer). Owned by the migration
-- role, so it reads the prices qtech_engineer may not; the API cannot reach this schema, and the filter keeps a person without a role out.
create view qtech_private.order_item_totals with (security_invoker = false) as
select
  s.order_id,
  case when k.ok then s.net end::numeric(14,2)   as net,
  case when k.ok then s.gst end::numeric(14,2)   as gst,
  case when k.ok then s.gross end::numeric(14,2) as gross
from (
  select
    o.id as order_id,
    coalesce(sum(l.line_net), 0)::numeric(14,2)                       as net,
    coalesce(sum(l.line_gst), 0)::numeric(14,2)                       as gst,
    (coalesce(sum(l.line_net), 0) + coalesce(sum(l.line_gst), 0))::numeric(14,2) as gross
  from public.orders o
  left join lateral (
    select round(i.qty * i.unit_price_net, 2)                              as line_net,
           round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0) as line_gst
    from public.order_items i
    where i.order_id = o.id
  ) l on true
  group by o.id
) s
-- NULL only for the engineer's API role. SECURITY DEFINER functions (order_receivables, my_target_progress_at) run as their owner
-- and keep the figures; a view does not change current_user, so an engineer's request reaching this view is qtech_engineer.
cross join lateral (select current_user <> 'qtech_engineer' as ok) k
where (select public.current_user_role()) is not null;

revoke all on qtech_private.order_item_totals from public;
grant select on qtech_private.order_item_totals to authenticated, qtech_engineer;

create or replace view public.v_order_items_total with (security_invoker = true) as
select o.id as order_id, t.net, t.gst, t.gross
from public.orders o
join qtech_private.order_item_totals t on t.order_id = o.id;

-- ================================================================ generated-docs: admin and sales only
create or replace function public.can_access_bucket(bucket text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case bucket
    when 'rfq-files'         then public.current_user_role() is not null
    when 'gst-receipts'      then public.current_user_role() in ('admin', 'sales')
    -- 0081: the quotation and PO PDFs carry prices on every page (owner decision 2026-10-22: engineers see none)
    when 'generated-docs'    then coalesce(public.current_user_role() in ('admin', 'sales'), false)
    when 'expense-receipts'  then coalesce(public.current_user_role() = 'admin', false)
    else false
  end
$$;

-- ================================================================ supplier_item_evidence without the price it never returned
create or replace function public.supplier_item_evidence(
  p_supplier_ids   uuid[],
  p_brand_id       uuid,
  p_family_id      uuid,
  p_description    text,
  p_exclude_rfq_id uuid default null,
  p_limit          integer default 3
)
returns table (
  supplier_id           uuid,
  evidence_rank         smallint,
  tier                  smallint,
  order_id              uuid,
  order_number          bigint,
  item_desc             text,
  qty                   numeric,
  placed_on             date,
  expected_on           date,
  delivered_on          date,
  delivered_after_days  integer,
  count_at_tier         integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  t as (
    select public.tokens_without(public.model_tokens(p_description), b.arr) as tok,
           public.strip_words(public.item_text_norm(p_description), b.words) as nrm,
           b.arr as bt,
           b.words as bw
    from (select public.brand_tokens() as arr, public.brand_words() as words) b
  ),
  sup as (
    select u.supplier_id, min(u.ord) as ord
    from unnest(p_supplier_ids) with ordinality as u (supplier_id, ord)
    where u.supplier_id is not null
    group by u.supplier_id
  ),
  -- procurement legs
  lc as (
    select
      so.supplier_id,
      oi.id as order_item_id,
      so.id as leg_id,
      o.id as order_id,
      o.number as order_number,
      oi.description as item_desc,
      so.placed_on as leg_placed_on,
      so.expected_on as leg_expected_on,
      coalesce(so.delivered_on, so.received_on) as leg_delivered_on,
      oi.qty,
      oi.unit,
      so.currency,
      coalesce(so.placed_on, o.ordered_on, public.today_pkt(so.created_at)) as on_date,
      so.created_at,
      case when oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok then
      public.item_match_tier(t.tok, t.nrm, p_brand_id, p_family_id,
                             public.tokens_without(oi.model_tokens, t.bt), public.strip_words(public.item_text_norm(oi.description), t.bw), oi.brand_id, oi.family_id,
                             false) end as tier
    from sup
    join public.supplier_orders so on so.supplier_id = sup.supplier_id
    join public.orders o on o.id = so.order_id and o.cancelled_on is null
    join public.order_items oi on oi.supplier_order_id = so.id and not oi.is_service
    cross join t
    where (p_exclude_rfq_id is null or o.rfq_id is distinct from p_exclude_rfq_id)
      -- 0074 prefilter (legs keeps only rows with a tier)
      and (oi.brand_id = p_brand_id or oi.family_id = p_family_id or oi.model_tokens && t.tok)
  ),
  -- one row per leg: the item of that leg that matches best
  legs as (
    select distinct on (lc.supplier_id, lc.leg_id) lc.*
    from lc
    where lc.tier is not null
    order by lc.supplier_id, lc.leg_id, lc.tier, lc.on_date desc, lc.created_at desc, lc.order_item_id
  ),
  bt as (
    select l.supplier_id, min(l.tier) as best_tier from legs l group by l.supplier_id
  ),
  ranked as (
    select l.*,
           row_number() over (partition by l.supplier_id
                              order by l.on_date desc, l.created_at desc, l.order_item_id) as rn,
           count(*) over (partition by l.supplier_id) as n
    from legs l
    join bt on bt.supplier_id = l.supplier_id and bt.best_tier = l.tier
  )
  select
    r.supplier_id,
    r.rn::smallint,
    r.tier::smallint,
    r.order_id,
    r.order_number,
    r.item_desc,
    r.qty,
    r.leg_placed_on,
    r.leg_expected_on,
    r.leg_delivered_on,
    case when r.leg_placed_on is not null and r.leg_delivered_on is not null
         then r.leg_delivered_on - r.leg_placed_on end,
    r.n::int
  from ranked r
  join sup s on s.supplier_id = r.supplier_id
  where r.rn <= least(greatest(coalesce(p_limit, 3), 1), 10)
  order by s.ord, r.rn
$$;
