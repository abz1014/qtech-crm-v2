begin;
select plan(4);

-- R12 performance budget: search_all p95 < 300 ms server-side on 1,000 companies, 3,000 contacts and 1,000 RFQs.
-- Timing is taken inside the test with clock_timestamp(), as the `authenticated` role, so row security (and its
-- current_user_role() checks) is part of what is measured. The numbers are printed in the test descriptions.

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fixture
insert into public.companies (id, name, country)
select ('c9000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       (array['Indus', 'Karachi', 'Lahore', 'Mehran', 'Crescent', 'Gul', 'Nishat', 'Faran', 'Hub', 'Kohinoor'])[1 + g % 10] || ' ' ||
       (array['Textile', 'Chemicals', 'Power', 'Steel', 'Sugar', 'Cement', 'Paper', 'Energy'])[1 + (g / 10) % 8] || ' ' ||
       (array['Mills', 'Industries', 'Works', 'Limited'])[1 + g % 4] || ' ' || g,
       (array['Pakistan', 'Germany', 'China', 'Italy'])[1 + g % 4]
from generate_series(1, 1000) g;

insert into public.contacts (id, company_id, name, phone, email)
select ('c9100000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('c9000000-0000-4000-8000-' || lpad(to_hex(1 + g % 1000), 12, '0'))::uuid,
       (array['Naveed', 'Ayesha', 'Bilal', 'Sana', 'Imran', 'Farah', 'Usman', 'Hina', 'Kamran', 'Zara'])[1 + g % 10] || ' ' ||
         (array['Akhtar', 'Khan', 'Malik', 'Sheikh', 'Qureshi', 'Siddiqui', 'Butt'])[1 + (g / 7) % 7] || ' ' || g,
       '+92 3' || lpad((g % 100)::text, 2, '0') || ' ' || lpad((g * 7919 % 10000000)::text, 7, '0'),
       'contact' || g || '@company' || (g % 1000) || '.example'
from generate_series(1, 3000) g;

insert into public.rfqs (id, company_id, owner_id, customer_ref, received_on)
select ('c9200000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('c9000000-0000-4000-8000-' || lpad(to_hex(1 + g % 1000), 12, '0'))::uuid,
       'a0000000-0000-4000-8000-000000000002',
       'ENQ-' || (2000 + g * 3),
       public.today_pkt() - (g % 400)
from generate_series(1, 1000) g;

analyze public.companies, public.contacts, public.rfqs;

select ok((select count(*) from public.companies) >= 1000 and (select count(*) from public.contacts) >= 3000 and (select count(*) from public.rfqs) >= 1000,
  format('fixture: %s companies, %s contacts, %s RFQs', (select count(*) from public.companies), (select count(*) from public.contacts), (select count(*) from public.rfqs)));

-- ------------------------------------------------------------------ timing
create temp table perf_runs (kind text, ms numeric);
grant all on perf_runs to authenticated;
create temp table perf_terms (kind text, t text);
insert into perf_terms
select 'company', (array['indus', 'text', 'works 4', 'kohi', 'sugar mills', 'ste', 'lim'])[1 + g % 7] from generate_series(0, 69) g
union all
select 'contact', (array['naveed', 'khan 1', 'contact12', '@company7', '300', '3007', 'ayesha m'])[1 + g % 7] from generate_series(0, 69) g
union all
select 'rfq', (array['RFQ-0042', '42', 'ENQ-20', 'enq-2999', '777', 'rfq 1000', 'ENQ'])[1 + g % 7] from generate_series(0, 69) g;
grant select on perf_terms to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare
  t0 timestamptz;
  r record;
  ms numeric;
begin
  -- Warm-up (plans, caches), as a user's first keystroke of the day would not be the one we are measuring.
  perform * from public.search_all('warm', 8);
  for r in select kind, t from perf_terms loop
    t0 := clock_timestamp();
    perform * from public.search_all(r.t, 8);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    insert into perf_runs values (r.kind, ms), ('all', ms);
  end loop;
end $$;

reset role;

select ok((select percentile_cont(0.95) within group (order by ms) < 300 from perf_runs where kind = 'all'),
  (select format('search_all (engineer, 1,000 companies / 3,000 contacts / 1,000 RFQs) p95 %s ms, median %s ms, max %s ms over %s calls (budget 300 ms)',
                 round(percentile_cont(0.95) within group (order by ms)::numeric, 1),
                 round(percentile_cont(0.5) within group (order by ms)::numeric, 1),
                 round(max(ms), 1), count(*))
   from perf_runs where kind = 'all'));
select ok((select bool_and(p95 < 300) from (select percentile_cont(0.95) within group (order by ms) p95 from perf_runs where kind <> 'all' group by kind) x),
  (select 'per kind of search, p95 ms: ' || string_agg(kind || ' ' || round(p95::numeric, 1), ', ' order by kind)
   from (select kind, percentile_cont(0.95) within group (order by ms) p95 from perf_runs where kind <> 'all' group by kind) x));
select ok((select count(*) from public.search_all('indus', 8)) > 0 and (select count(*) from public.search_all('RFQ-0042', 8) where kind = 'rfq') > 0,
  'the fixture queries return rows (the timing is of real work)');

select * from finish();
rollback;
