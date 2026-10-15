begin;
select * from no_plan();

-- R23 (0038): the nightly FX job inside Postgres. No network is used: payloads are fixtures passed to
-- apply_fx_payload(), and ingest_fx_response() is fed through fx_fetch_log rows that already hold a response.
-- The cron part runs only when the cron schema exists (it may be absent on a local stack).
-- Rates in the fixtures are chosen so that 1 / value is exact: 0.004 -> 250, 0.0025 -> 400, 0.04 -> 25, 0.016 -> 62.5.

-- ------------------------------------------------------------------ grants: nobody but the owner (pg_cron runs as postgres)
select is((select count(*)::int from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('fetch_fx_rates', 'ingest_fx_response', 'apply_fx_payload', 'fx_wanted_currencies', 'schedule_fx_cron')
             and p.prosecdef
             and array_to_string(p.proconfig, ',') like 'search_path=%'
             and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 5,
  'the five FX job functions are SECURITY DEFINER, have a fixed search_path and no anon, authenticated or PUBLIC execute');
select ok(not has_table_privilege('anon', 'public.fx_fetch_log', 'SELECT')
          and has_table_privilege('authenticated', 'public.fx_fetch_log', 'SELECT')
          and not has_table_privilege('authenticated', 'public.fx_fetch_log', 'INSERT')
          and not has_table_privilege('authenticated', 'public.fx_fetch_log', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.fx_fetch_log', 'DELETE'),
  'fx_fetch_log: no anon access, authenticated may only select (the policy then limits it to admin)');
select is((select array_agg(policyname::text) from pg_policies where schemaname = 'public' and tablename = 'fx_fetch_log'),
  array['fx_fetch_log_select_admin'], 'fx_fetch_log has one policy, admin select');
set local role authenticated;
select throws_ok($$select public.apply_fx_payload('{}'::jsonb, 'x')$$, '42501', null,
  'a client cannot call apply_fx_payload');
reset role;

-- ------------------------------------------------------------------ fixtures
delete from public.fx_rates where source = 'auto';
delete from public.fx_fetch_log;
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'i1'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'i2'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'i3');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
insert into public.supplier_quote_lines (inquiry_id, rfq_item_id, unit_price, currency, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 10, 'JPY', now()),
  ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 10, 'SEK', now() - interval '100 days'),
  ('e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 10, 'PKR', now());

-- ------------------------------------------------------------------ currency selection
select is(public.fx_wanted_currencies(), array['AED', 'CNY', 'EUR', 'GBP', 'JPY', 'USD'],
  'wanted = the five fixed currencies plus JPY seen in the last 90 days; SEK (100 days old) and PKR are left out');

-- ------------------------------------------------------------------ parsing and inversion (open.er-api.com shape)
create temp table r1 as select public.apply_fx_payload(
  '{"result":"success","base_code":"PKR","rates":{"PKR":1,"USD":0.004,"EUR":0.0025,"CNY":0.04,"AED":0.016,"GBP":0.002,"JPY":0.5,"SEK":0.03}}'::jsonb,
  'open.er-api.com') as r;
select is((select r from r1), '{"usable": true, "written": 6, "skipped": 0}'::jsonb, 'a full payload writes the six wanted currencies');
select is((select array_agg(currency || '=' || rate_pkr::text order by currency) from public.fx_rates where source = 'auto' and as_of = public.today_pkt()),
  array['AED=62.500000', 'CNY=25.000000', 'EUR=400.000000', 'GBP=500.000000', 'JPY=2.000000', 'USD=250.000000'],
  'PKR-base values are inverted to PKR per 1 foreign unit; SEK was not written');
select is((select array_agg(distinct provider) from public.fx_rates where source = 'auto'), array['open.er-api.com'],
  'the provider is recorded on the auto rows');
select is((select to_char(rate_pkr, 'FM999999990.000000') from public.fx_rates where currency = 'USD' and source = 'auto'), '250.000000', 'rate has 6 decimals');
select public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"USD":0.004}}'::jsonb, 'open.er-api.com');
select is((select count(*)::int from public.fx_rates where source = 'auto' and currency = 'USD'), 1, 'running twice on one day leaves one row per currency');
select is((select count(*)::int from public.fx_rates where source = 'auto' and as_of = public.today_pkt()), 6, 'and no extra rows');

-- ------------------------------------------------------------------ a manual row is never overwritten
insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('USD', 281, public.today_pkt(), 'manual');
select public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"USD":0.005,"EUR":0.0025}}'::jsonb, 'open.er-api.com');
select is((select rate_pkr from public.fx_rates where currency = 'USD' and source = 'manual' and as_of = public.today_pkt()), 281.000000::numeric,
  'the manual USD row keeps its value');
select is((select rate_pkr from public.fx_rates where currency = 'USD' and source = 'auto' and as_of = public.today_pkt()), 200.000000::numeric,
  'the auto USD row is updated beside it');
select is((select source from public.v_fx_latest where currency = 'USD'), 'manual', 'on the same day the manual rate still wins in v_fx_latest');
select is((select count(*)::int from public.fx_rates where source = 'manual'), 1, 'no manual row was added');

-- ------------------------------------------------------------------ missing and nonsensical values are skipped and logged
delete from public.fx_rates where source = 'auto';
delete from public.fx_fetch_log;
create temp table r2 as select public.apply_fx_payload(
  '{"result":"success","base_code":"PKR","rates":{"USD":0,"EUR":-0.0025,"CNY":"abc","GBP":null,"JPY":0.5}}'::jsonb,
  'open.er-api.com', 'b0000000-0000-4000-8000-000000000001') as r;
select is((select r from r2), '{"usable": true, "written": 1, "skipped": 5}'::jsonb, 'zero, negative, text, null and absent values are skipped (AED is absent)');
select is((select array_agg(currency order by currency) from public.fx_fetch_log where batch_id = 'b0000000-0000-4000-8000-000000000001' and kind = 'skip'),
  array['AED', 'CNY', 'EUR', 'GBP', 'USD'], 'every skipped currency is logged');
select is((select array_agg(currency::text) from public.fx_rates where source = 'auto'), array['JPY'], 'only the sane value was written');

-- ------------------------------------------------------------------ jump guard (more than 50% from the previous auto value)
delete from public.fx_rates where source = 'auto';
delete from public.fx_fetch_log;
insert into public.fx_rates (currency, rate_pkr, as_of, source, provider) values ('USD', 250, public.today_pkt() - 1, 'auto', 'open.er-api.com');
select public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"USD":0.002}}'::jsonb, 'open.er-api.com', 'b0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.fx_rates where currency = 'USD' and as_of = public.today_pkt()), 0, 'a +100% jump is not written');
select ok((select detail like 'jump over 50%' from public.fx_fetch_log
           where batch_id = 'b0000000-0000-4000-8000-000000000002' and currency = 'USD' and kind = 'skip'), 'and the jump is logged');
select is((select (public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"USD":0.002}}'::jsonb, 'open.er-api.com') ->> 'usable')::boolean), true,
  'a payload whose only value was jump-guarded counts as usable (no fallback needed)');
select public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"USD":0.0035}}'::jsonb, 'open.er-api.com');
select is((select rate_pkr from public.fx_rates where currency = 'USD' and as_of = public.today_pkt()), 285.714286::numeric, 'a +14% move is accepted');

-- ------------------------------------------------------------------ unusable payloads
select is((select (public.apply_fx_payload('{"result":"error","error-type":"quota-reached"}'::jsonb, 'open.er-api.com') ->> 'usable')::boolean), false, 'an error payload is unusable');
select is((select (public.apply_fx_payload('{"foo":1}'::jsonb, 'x') ->> 'usable')::boolean), false, 'a payload of unknown shape is unusable');
select is((select (public.apply_fx_payload('{"result":"success","base_code":"PKR","rates":{"SEK":0.03}}'::jsonb, 'x') ->> 'usable')::boolean), false, 'a payload with none of the wanted currencies is unusable');
select is((select (public.apply_fx_payload('{"result":"success","base_code":"USD","rates":{"EUR":0.9}}'::jsonb, 'x') ->> 'usable')::boolean), false, 'a payload not based on PKR is unusable');
select is((select (public.apply_fx_payload('[1,2]'::jsonb, 'x') ->> 'usable')::boolean), false, 'a non-object payload is unusable');

-- ------------------------------------------------------------------ fallback source (currency-api shape) and its recording
delete from public.fx_rates where source = 'auto';
delete from public.fx_fetch_log;
select public.apply_fx_payload('{"date":"2026-10-14","pkr":{"usd":0.004,"eur":0.0025,"cny":0.04,"aed":0.016,"gbp":0.002}}'::jsonb, 'currency-api');
select is((select array_agg(currency || '=' || rate_pkr::text order by currency) from public.fx_rates where source = 'auto'),
  array['AED=62.500000', 'CNY=25.000000', 'EUR=400.000000', 'GBP=500.000000', 'USD=250.000000'], 'the lower-case fallback shape is parsed and inverted too (JPY absent, so skipped)');
select is((select array_agg(distinct provider) from public.fx_rates where source = 'auto'), array['currency-api'], 'the fallback provider is recorded');

-- ------------------------------------------------------------------ ingest: primary failed -> fallback used
delete from public.fx_rates where source = 'auto';
delete from public.fx_fetch_log;
insert into public.fx_fetch_log (batch_id, kind, source, priority, detail, response_status, response_body, response_at) values
  ('b0000000-0000-4000-8000-000000000003', 'request', 'open.er-api.com', 1, 'u1', 500, 'oops', now()),
  ('b0000000-0000-4000-8000-000000000003', 'request', 'currency-api', 2, 'u2', 200, '{"date":"x","pkr":{"usd":0.004}}', now());
select is(public.ingest_fx_response(), 1, 'ingest closes the batch');
select is((select provider from public.fx_rates where currency = 'USD' and source = 'auto'), 'currency-api', 'a failed primary falls back, and the fallback is recorded');
select ok(exists (select 1 from public.fx_fetch_log where batch_id = 'b0000000-0000-4000-8000-000000000003' and kind = 'error' and source = 'open.er-api.com' and detail like 'HTTP status 500%'),
  'the primary failure is logged');
select is((select count(*)::int from public.fx_fetch_log where batch_id = 'b0000000-0000-4000-8000-000000000003' and kind = 'request' and processed_at is null), 0, 'both requests are marked processed');
select is(public.ingest_fx_response(), 0, 'running ingest again does nothing');

-- primary good -> fallback not applied
delete from public.fx_rates where source = 'auto';
insert into public.fx_fetch_log (batch_id, kind, source, priority, detail, response_status, response_body, response_at) values
  ('b0000000-0000-4000-8000-000000000004', 'request', 'open.er-api.com', 1, 'u1', 200, '{"result":"success","base_code":"PKR","rates":{"USD":0.004}}', now()),
  ('b0000000-0000-4000-8000-000000000004', 'request', 'currency-api', 2, 'u2', 200, '{"pkr":{"usd":0.01}}', now());
select is(public.ingest_fx_response(), 1, 'second batch closed');
select is((select provider || ':' || rate_pkr::text from public.fx_rates where currency = 'USD' and source = 'auto'), 'open.er-api.com:250.000000',
  'a good primary is used and the fallback is ignored');

-- both failed (old batch, one never answered, one not JSON)
delete from public.fx_rates where source = 'auto';
insert into public.fx_fetch_log (batch_id, kind, source, priority, detail, created_at, response_status, response_body, response_at) values
  ('b0000000-0000-4000-8000-000000000005', 'request', 'open.er-api.com', 1, 'u1', now() - interval '1 hour', null, null, null),
  ('b0000000-0000-4000-8000-000000000005', 'request', 'currency-api', 2, 'u2', now() - interval '1 hour', 200, '<html>', now());
select is(public.ingest_fx_response(), 1, 'an old batch with no usable source is closed');
select ok(exists (select 1 from public.fx_fetch_log where batch_id = 'b0000000-0000-4000-8000-000000000005' and kind = 'error' and detail like 'no source gave usable rates%'),
  'and the failure is logged as an error');
select is((select count(*)::int from public.fx_rates where source = 'auto'), 0, 'no rate is written');

-- a young batch still waiting is left alone
insert into public.fx_fetch_log (batch_id, kind, source, priority, detail) values
  ('b0000000-0000-4000-8000-000000000006', 'request', 'open.er-api.com', 1, 'u1'),
  ('b0000000-0000-4000-8000-000000000006', 'request', 'currency-api', 2, 'u2');
select is(public.ingest_fx_response(), 0, 'a batch under 15 minutes old with no answer yet is left for the next run');
select is((select count(*)::int from public.fx_fetch_log where batch_id = 'b0000000-0000-4000-8000-000000000006' and processed_at is null), 2, 'and stays pending');

-- ------------------------------------------------------------------ fetch_fx_rates without a network
create temp table f1 as select public.fetch_fx_rates() as b;
select is((select count(*)::int from public.fx_fetch_log where kind = 'request' and batch_id = (select b from f1)),
  case when to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then 0 else 2 end,
  'fetch_fx_rates queues two requests when pg_net exists, and quietly logs an error when it does not');
select is((select b is null from f1), to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null, 'no batch id without pg_net');

-- ------------------------------------------------------------------ scheduling is idempotent (only where pg_cron exists)
create function pg_temp.cron_jobs() returns text language plpgsql as $f$
declare r text;
begin
  if to_regnamespace('cron') is null then return 'no-cron'; end if;
  execute $q$select string_agg(jobname || '|' || schedule || '|' || command, ';' order by jobname) from cron.job where jobname in ('fx-fetch', 'fx-ingest')$q$ into r;
  return coalesce(r, 'none');
end;
$f$;
select public.schedule_fx_cron();
select public.schedule_fx_cron();
select is(pg_temp.cron_jobs(),
  case when to_regnamespace('cron') is null then 'no-cron'
       else 'fx-fetch|0 21 * * *|select public.fetch_fx_rates();fx-ingest|5,20 21 * * *|select public.ingest_fx_response()' end,
  'two schedule calls leave exactly one fx-fetch (21:00 UTC = 02:00 PKT) and one fx-ingest job, or are skipped without pg_cron');

select * from finish();
rollback;
