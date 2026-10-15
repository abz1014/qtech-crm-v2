-- 0038_fx_nightly_cron (R23): the nightly FX fetch runs INSIDE Postgres with pg_cron + pg_net (both free on Supabase).
-- No GitHub job, no service-role key outside Supabase. BUILD_PLAN R23 originally said "a step in nightly.yml"; see DECISIONS.
--
-- Flow (pg_net is asynchronous, so two steps):
--   02:00 Asia/Karachi (21:00 UTC)  fetch_fx_rates()      queues two HTTP GETs (primary + fallback) and logs their request ids
--   02:05 and 02:20 PKT             ingest_fx_response()  copies finished responses from net._http_response into the log,
--                                                         then applies the first usable source through apply_fx_payload()
-- apply_fx_payload(jsonb, text) is pure database logic (no network): parse, invert PKR-base values to "PKR per 1 unit",
-- guard, upsert source = 'auto' rows. It never touches a manual row (the unique key includes source).
-- Nothing here is callable by a client: every function below is revoked from public, anon and authenticated.
-- Local guard: pg_cron / pg_net are created only if the server offers them, cron.schedule runs only if the cron schema
-- exists, and the net schema is referenced only through dynamic SQL, so this file applies on a stack without them.

-- ---------------------------------------------------------------- which provider wrote an auto row
alter table public.fx_rates add column provider text;
comment on column public.fx_rates.provider is
  'Which source an auto row came from (open.er-api.com, or currency-api for the fallback). NULL on manual rows.';

-- ---------------------------------------------------------------- fx_fetch_log (admin can read; nobody writes directly)
create table public.fx_fetch_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  batch_id         uuid,
  kind             text not null check (kind in ('request', 'upsert', 'skip', 'error', 'info')),
  source           text,
  priority         smallint,
  request_id       bigint,
  currency         text,
  detail           text,
  response_status  integer,
  response_body    text,
  response_at      timestamptz,
  processed_at     timestamptz
);

comment on table public.fx_fetch_log is
  'Journal of the nightly FX job (migration 0038). kind = request: one queued HTTP call (response columns filled by ingest); skip / error / info: what the job decided and why. Pruned after 60 days.';

create index fx_fetch_log_pending_idx on public.fx_fetch_log (batch_id) where kind = 'request' and processed_at is null;

alter table public.fx_fetch_log enable row level security;
revoke all on table public.fx_fetch_log from public, anon, authenticated;
grant select on table public.fx_fetch_log to authenticated;
create policy fx_fetch_log_select_admin on public.fx_fetch_log for select to authenticated
  using (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------- the currencies we want
-- USD, EUR, CNY, AED, GBP plus any currency seen on a supplier quote line in the last 90 days. Never PKR.
create function public.fx_wanted_currencies()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c order by c), '{}')
  from (
    select unnest(array['USD', 'EUR', 'CNY', 'AED', 'GBP']) as c
    union
    select upper(btrim(l.currency::text))
    from public.supplier_quote_lines l
    where l.created_at >= now() - interval '90 days'
  ) s
  where c ~ '^[A-Z]{3}$' and c <> 'PKR';
$$;

revoke all on function public.fx_wanted_currencies() from public, anon, authenticated;

-- ---------------------------------------------------------------- the pure part: parse, invert, guard, upsert
-- p_payload is either
--   open.er-api.com:   {"result":"success","base_code":"PKR","rates":{"USD":0.0035,...}}   (foreign units per 1 PKR)
--   currency-api:      {"date":"...","pkr":{"usd":0.0035,...}}                              (same meaning, lower-case codes)
-- Stored rate = PKR per 1 unit of the foreign currency = 1 / value, 6 decimals, on today's PKT date.
-- A currency is skipped (and logged) when its value is missing, not a number, <= 0, out of range, or differs from the
-- previous auto rate by more than 50%. Returns {"usable": bool, "written": n, "skipped": n}; usable means at least one
-- wanted currency had a sane value, so the caller need not fall back.
create function public.apply_fx_payload(p_payload jsonb, p_source text, p_batch uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := public.today_pkt();
  v_rates   jsonb;
  v_lower   boolean := false;
  v_cur     text;
  v_raw     numeric;
  v_rate    numeric;
  v_prev    numeric;
  v_written int := 0;
  v_skipped int := 0;
  v_sane    int := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    insert into public.fx_fetch_log (batch_id, kind, source, detail) values (p_batch, 'error', p_source, 'payload is not a JSON object');
    return jsonb_build_object('usable', false, 'written', 0, 'skipped', 0);
  end if;

  if p_payload ? 'rates' then
    if coalesce(p_payload ->> 'result', 'success') <> 'success' or upper(coalesce(p_payload ->> 'base_code', 'PKR')) <> 'PKR' then
      insert into public.fx_fetch_log (batch_id, kind, source, detail)
      values (p_batch, 'error', p_source, 'payload says result=' || coalesce(p_payload ->> 'result', '?') || ', base=' || coalesce(p_payload ->> 'base_code', '?'));
      return jsonb_build_object('usable', false, 'written', 0, 'skipped', 0);
    end if;
    v_rates := p_payload -> 'rates';
  elsif p_payload ? 'pkr' then
    v_rates := p_payload -> 'pkr';
    v_lower := true;
  end if;

  if v_rates is null or jsonb_typeof(v_rates) <> 'object' then
    insert into public.fx_fetch_log (batch_id, kind, source, detail) values (p_batch, 'error', p_source, 'payload has no rates object');
    return jsonb_build_object('usable', false, 'written', 0, 'skipped', 0);
  end if;

  foreach v_cur in array public.fx_wanted_currencies() loop
    v_raw := null;
    begin
      v_raw := (v_rates ->> case when v_lower then lower(v_cur) else v_cur end)::numeric;
    exception when others then
      v_raw := null;
    end;

    if v_raw is null then
      v_skipped := v_skipped + 1;
      insert into public.fx_fetch_log (batch_id, kind, source, currency, detail) values (p_batch, 'skip', p_source, v_cur, 'value missing or not a number');
      continue;
    end if;
    if v_raw = 'NaN'::numeric or v_raw <= 0 then
      v_skipped := v_skipped + 1;
      insert into public.fx_fetch_log (batch_id, kind, source, currency, detail) values (p_batch, 'skip', p_source, v_cur, 'value is not positive: ' || v_raw);
      continue;
    end if;

    v_rate := round(1 / v_raw, 6);
    if v_rate <= 0 or v_rate >= 100000000 then
      v_skipped := v_skipped + 1;
      insert into public.fx_fetch_log (batch_id, kind, source, currency, detail) values (p_batch, 'skip', p_source, v_cur, 'inverted rate out of range: ' || v_rate);
      continue;
    end if;
    v_sane := v_sane + 1;

    select r.rate_pkr into v_prev from public.fx_rates r
    where r.currency = v_cur and r.source = 'auto' and r.as_of < v_today
    order by r.as_of desc limit 1;
    if v_prev is not null and abs(v_rate - v_prev) / v_prev > 0.5 then
      v_skipped := v_skipped + 1;
      insert into public.fx_fetch_log (batch_id, kind, source, currency, detail)
      values (p_batch, 'skip', p_source, v_cur, format('jump over 50%%: previous auto %s, new %s', v_prev, v_rate));
      continue;
    end if;

    insert into public.fx_rates (currency, rate_pkr, as_of, source, provider)
    values (v_cur, v_rate, v_today, 'auto', p_source)
    on conflict (currency, as_of, source) do update
      set rate_pkr = excluded.rate_pkr, provider = excluded.provider
      where (public.fx_rates.rate_pkr, public.fx_rates.provider) is distinct from (excluded.rate_pkr, excluded.provider);
    v_written := v_written + 1;
  end loop;

  insert into public.fx_fetch_log (batch_id, kind, source, detail)
  values (p_batch, 'info', p_source, format('applied: %s written, %s skipped', v_written, v_skipped));
  return jsonb_build_object('usable', v_sane > 0, 'written', v_written, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_fx_payload(jsonb, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- step 1: queue the HTTP calls
-- Both sources are queued up front (two small free GETs); ingest uses the primary when it is usable and the
-- fallback otherwise, so there is no second round trip at night. Returns the batch id, or NULL when pg_net is absent.
create function public.fetch_fx_rates()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_id    bigint;
  v_src   record;
begin
  delete from public.fx_fetch_log where created_at < now() - interval '60 days';
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    insert into public.fx_fetch_log (batch_id, kind, detail) values (v_batch, 'error', 'pg_net is not installed: nothing fetched');
    return null;
  end if;
  for v_src in
    select * from (values
      (1::smallint, 'open.er-api.com', 'https://open.er-api.com/v6/latest/PKR'),
      (2::smallint, 'currency-api', 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/pkr.json')
    ) s (priority, source, url) order by priority
  loop
    execute 'select net.http_get(url := $1, timeout_milliseconds := 10000)' into v_id using v_src.url;
    insert into public.fx_fetch_log (batch_id, kind, source, priority, request_id, detail)
    values (v_batch, 'request', v_src.source, v_src.priority, v_id, v_src.url);
  end loop;
  return v_batch;
end;
$$;

revoke all on function public.fetch_fx_rates() from public, anon, authenticated;

-- ---------------------------------------------------------------- step 2: read the answers and apply
-- (a) copy finished responses out of net._http_response (pg_net keeps them only for a few hours),
-- (b) per pending batch, in priority order, apply the first usable source. A batch younger than 15 minutes that is still
--     waiting for a response is left for the next run; an older one counts that source as failed.
-- Returns the number of batches closed. A batch where no source worked is closed with an error row in fx_fetch_log.
create function public.ingest_fx_response()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req    record;
  v_batch  record;
  v_resp   jsonb;
  v_json   jsonb;
  v_result jsonb;
  v_done   boolean;
  v_wait   boolean;
  v_closed int := 0;
begin
  if to_regclass('net._http_response') is not null then
    for v_req in select id, request_id from public.fx_fetch_log
                 where kind = 'request' and processed_at is null and response_at is null and request_id is not null loop
      execute 'select to_jsonb(r) from net._http_response r where r.id = $1' into v_resp using v_req.request_id;
      if v_resp is not null then
        update public.fx_fetch_log
        set response_status = case when coalesce((v_resp ->> 'timed_out')::boolean, false) then null else (v_resp ->> 'status_code')::int end,
            response_body = case when v_resp ->> 'error_msg' is not null then 'error: ' || (v_resp ->> 'error_msg') else v_resp ->> 'content' end,
            response_at = now()
        where id = v_req.id;
      end if;
    end loop;
  end if;

  for v_batch in select batch_id, min(created_at) as started from public.fx_fetch_log
                 where kind = 'request' and processed_at is null group by batch_id order by min(created_at) loop
    v_done := false;
    v_wait := false;
    for v_req in select * from public.fx_fetch_log
                 where kind = 'request' and batch_id = v_batch.batch_id order by priority loop
      if v_req.response_at is null then
        if v_batch.started > now() - interval '15 minutes' then
          v_wait := true;
          exit;
        end if;
        insert into public.fx_fetch_log (batch_id, kind, source, detail) values (v_batch.batch_id, 'error', v_req.source, 'no response received');
        continue;
      end if;
      if v_req.response_status is distinct from 200 then
        insert into public.fx_fetch_log (batch_id, kind, source, detail)
        values (v_batch.batch_id, 'error', v_req.source, format('HTTP status %s: %s', coalesce(v_req.response_status::text, 'none'), left(coalesce(v_req.response_body, ''), 200)));
        continue;
      end if;
      begin
        v_json := v_req.response_body::jsonb;
      exception when others then
        insert into public.fx_fetch_log (batch_id, kind, source, detail) values (v_batch.batch_id, 'error', v_req.source, 'response is not valid JSON');
        continue;
      end;
      v_result := public.apply_fx_payload(v_json, v_req.source, v_batch.batch_id);
      if (v_result ->> 'usable')::boolean then
        v_done := true;
        exit;
      end if;
    end loop;

    if v_wait then
      continue;
    end if;
    if not v_done then
      insert into public.fx_fetch_log (batch_id, kind, detail) values (v_batch.batch_id, 'error', 'no source gave usable rates: FX rates not refreshed tonight');
    end if;
    update public.fx_fetch_log set processed_at = now() where kind = 'request' and batch_id = v_batch.batch_id;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

revoke all on function public.ingest_fx_response() from public, anon, authenticated;

-- ---------------------------------------------------------------- scheduling (idempotent, guarded)
-- Safe to run again at any time, for example from the SQL editor after enabling pg_cron in Database -> Extensions.
-- 21:00 UTC = 02:00 Asia/Karachi (Pakistan has no daylight saving). Ingest runs at 02:05 and again at 02:20 PKT.
create function public.schedule_fx_cron()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    return 'skipped: the cron schema is not installed';
  end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('fx-fetch', 'fx-ingest')$q$;
  execute $q$select cron.schedule('fx-fetch', '0 21 * * *', 'select public.fetch_fx_rates()')$q$;
  execute $q$select cron.schedule('fx-ingest', '5,20 21 * * *', 'select public.ingest_fx_response()')$q$;
  return 'scheduled: fx-fetch 21:00 UTC, fx-ingest 21:05 and 21:20 UTC';
end;
$$;

revoke all on function public.schedule_fx_cron() from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net not enabled (%): enable it under Database -> Extensions, then run select public.schedule_fx_cron()', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not enabled (%): enable it under Database -> Extensions, then run select public.schedule_fx_cron()', sqlerrm;
  end;
  raise notice '%', public.schedule_fx_cron();
end;
$$;
