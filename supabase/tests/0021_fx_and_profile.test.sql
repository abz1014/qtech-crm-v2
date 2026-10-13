begin;
select plan(63);

-- Fixture users come from supabase/seed.sql.
-- admin a0..01, sales a0..02, engineer a0..03, deactivated a0..04
-- Logic is checked as the table owner with the admin's claims; role checks switch to `authenticated` below.
-- Dates are relative to today_pkt() so the bands are tested at exact ages.

-- Counts the rows a DML statement touches, running with the caller's own privileges.
create function public.t_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ------------------------------------------------------------------ structure
select columns_are('public', 'fx_rates',
  array['id', 'created_at', 'created_by', 'currency', 'rate_pkr', 'as_of', 'source'],
  'fx_rates has the section 2.24 columns');
select ok((select relrowsecurity from pg_class where oid = 'public.fx_rates'::regclass), 'RLS is enabled on fx_rates');
select is((select array_agg(policyname::text order by policyname) from pg_policies
           where schemaname = 'public' and tablename = 'fx_rates'),
  array['fx_rates_delete_admin', 'fx_rates_insert_staff', 'fx_rates_select_staff', 'fx_rates_update_staff'],
  'fx_rates policies');
select ok(not (has_table_privilege('anon', 'public.fx_rates', 'SELECT')
            or has_table_privilege('anon', 'public.company_profile', 'SELECT')
            or has_table_privilege('anon', 'public.company_profile', 'UPDATE')),
  'anon has no privileges on fx_rates or company_profile');
select ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                      where c.oid = 'public.v_fx_latest'::regclass and a.grantee in (0, 'anon'::regrole::oid)),
  'anon and PUBLIC have no privileges on v_fx_latest');
select ok((select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
           where oid = 'public.v_fx_latest'::regclass), 'v_fx_latest is security_invoker');
select is((select count(*)::int from pg_trigger t
           where t.tgfoid = 'public.audit_row_change()'::regprocedure and not t.tgisinternal
             and t.tgrelid in ('public.fx_rates'::regclass, 'public.company_profile'::regclass)), 2,
  'fx_rates and company_profile carry the audit trigger');
select columns_are('public', 'company_profile',
  array['id', 'legal_name', 'address', 'phone', 'email', 'website', 'ntn', 'strn', 'bank_name', 'bank_account_title',
        'bank_iban', 'quotation_validity_days', 'quotation_terms', 'po_terms', 'updated_at', 'updated_by'],
  'company_profile has the section 2.27 columns');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ fx_rates constraints
select throws_ok($$insert into public.fx_rates (currency, rate_pkr) values ('PKR', 1)$$, '23514', null, 'PKR has no rate');
select throws_ok($$insert into public.fx_rates (currency, rate_pkr) values ('us', 1)$$, '23514', null, 'the currency must be 3 capitals');
select throws_ok($$insert into public.fx_rates (currency, rate_pkr) values ('USD', 0)$$, '23514', null, 'the rate must be positive');
select throws_ok($$insert into public.fx_rates (currency, rate_pkr, source) values ('USD', 1, 'bank')$$, '23514', null,
  'the source is auto or manual');
insert into public.fx_rates (currency, rate_pkr) values ('QQQ', 1);
select ok((select source = 'manual' and as_of = public.today_pkt() from public.fx_rates where currency = 'QQQ'),
  'source defaults to manual and as_of to today');

-- Manual beats auto on the same day; the next day's auto beats yesterday's manual.
insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('USD', 280, public.today_pkt(), 'auto'),
  ('USD', 281, public.today_pkt(), 'manual'),
  ('EUR', 300, public.today_pkt() - 1, 'manual'),
  ('EUR', 310, public.today_pkt(), 'auto'),
  ('GBP', 360, public.today_pkt() - 3, 'auto'),
  ('GBP', 365, public.today_pkt() - 3, 'manual');
select throws_ok($$insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('USD', 1, public.today_pkt(), 'auto')$$,
  '23505', null, 'UNIQUE(currency, as_of, source)');
select lives_ok($$insert into public.fx_rates (currency, rate_pkr, as_of, source) values ('USD', 279, public.today_pkt() - 1, 'auto')$$,
  'the same currency on another day is fine');

select ok((select rate_pkr = 281 and source = 'manual' and age_days = 0 from public.v_fx_latest where currency = 'USD'),
  'same day: manual beats auto');
select ok((select rate_pkr = 310 and source = 'auto' and as_of = public.today_pkt() from public.v_fx_latest where currency = 'EUR'),
  'a newer auto rate beats yesterday''s manual one');
select ok((select rate_pkr = 365 and source = 'manual' and age_days = 3 from public.v_fx_latest where currency = 'GBP'),
  'manual beats auto on an older day too');
select is((select count(*)::int from public.v_fx_latest where currency in ('USD', 'EUR', 'GBP')), 3, 'one row per currency');

-- Staleness bands at 7, 8, 30 and 31 days.
insert into public.fx_rates (currency, rate_pkr, as_of, source) values
  ('AAA', 1, public.today_pkt() - 7, 'auto'),
  ('BBB', 1, public.today_pkt() - 8, 'auto'),
  ('CCC', 1, public.today_pkt() - 30, 'auto'),
  ('DDD', 1, public.today_pkt() - 31, 'auto'),
  ('FFF', 5, public.today_pkt() - 2, 'auto'),
  ('FFF', 9, public.today_pkt() + 3, 'auto');
select is((select staleness from public.v_fx_latest where currency = 'USD'), 'fresh', 'today is fresh');
select ok((select staleness = 'fresh' and age_days = 7 from public.v_fx_latest where currency = 'AAA'), '7 days old is fresh');
select ok((select staleness = 'stale' and age_days = 8 from public.v_fx_latest where currency = 'BBB'), '8 days old is stale');
select ok((select staleness = 'stale' and age_days = 30 from public.v_fx_latest where currency = 'CCC'), '30 days old is stale');
select ok((select staleness = 'unusable' and age_days = 31 from public.v_fx_latest where currency = 'DDD'), '31 days old is unusable');
select is((select rate_pkr from public.v_fx_latest where currency = 'FFF'), 5.000000::numeric,
  'a future-dated row is ignored');

-- ------------------------------------------------------------------ quote-line FX capture
insert into public.companies (id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'Customer'),
  ('c0000000-0000-4000-8000-000000000002', 'Supplier');
insert into public.rfqs (id, company_id, owner_id) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
insert into public.rfq_items (id, rfq_id, description) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'i1'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'i2'),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'i3'),
  ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'i4'),
  ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', 'i5'),
  ('d1000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001', 'i6'),
  ('d1000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001', 'i7');
insert into public.supplier_inquiries (id, rfq_id, supplier_id) values
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
insert into public.supplier_quote_lines (id, inquiry_id, rfq_item_id, unit_price, currency, fx_rate_pkr, fx_rate_on, legacy_source) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 10, 'USD', null, null, null),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 10, 'PKR', null, null, null),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 10, 'ZZZ', null, null, null),
  ('e1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 10, 'USD', 275.5, null, null),
  ('e1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 10, 'USD', 270, date '2026-01-01', null),
  ('e1000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006', 10, 'USD', null, null, '{"row": 1}'),
  ('e1000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000007', 10, 'DDD', null, null, null);
select ok((select fx_rate_pkr = 281 and fx_rate_on = public.today_pkt()
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000001'),
  'an empty rate is filled from v_fx_latest, with its date');
select ok((select fx_rate_pkr = 1 and fx_rate_on = public.today_pkt()
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000002'),
  'PKR gives 1');
select ok((select fx_rate_pkr is null and fx_rate_on is null
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000003'),
  'no known rate gives NULL, and the insert still succeeded');
select ok((select fx_rate_pkr = 275.5 and fx_rate_on = public.today_pkt()
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000004'),
  'a typed rate is kept and gets today''s date');
select ok((select fx_rate_pkr = 270 and fx_rate_on = date '2026-01-01'
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000005'),
  'a typed rate and date are kept');
select ok((select fx_rate_pkr is null and fx_rate_on is null
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000006'),
  'imported rows (legacy_source set) are skipped');
select ok((select fx_rate_pkr = 1 and fx_rate_on = public.today_pkt() - 31
           from public.supplier_quote_lines where id = 'e1000000-0000-4000-8000-000000000007'),
  'an unusable rate is still captured, with its date showing how old it was');
select throws_ok($$update public.supplier_quote_lines set fx_rate_pkr = 0 where id = 'e1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a captured rate must be positive');

-- ------------------------------------------------------------------ fx_rates by role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.fx_rates where currency = 'USD'), 3, 'sales can read all rates');
select lives_ok($$select public.set_fx_rate(' jpy ', 1.8)$$, 'set_fx_rate trims and upper-cases the currency');
select is(public.set_fx_rate('JPY', 1.9), (select id from public.fx_rates where currency = 'JPY'),
  'same-day re-entry updates the same row');
select ok((select count(*) = 1 and max(rate_pkr) = 1.9 and max(source) = 'manual' and max(as_of) = public.today_pkt()
           from public.fx_rates where currency = 'JPY'), 'one manual row for today, holding the new rate');
select ok((select created_by = 'a0000000-0000-4000-8000-000000000002' from public.fx_rates where currency = 'JPY'),
  'created_by is the person who first entered it');
select throws_ok($$insert into public.fx_rates (currency, rate_pkr, source) values ('SEK', 27, 'auto')$$,
  '42501', null, 'sales cannot write an auto rate');
select throws_ok($$select public.set_fx_rate('PKR', 1)$$, '23514', null, 'set_fx_rate refuses PKR');
select is(public.t_rows($q$update public.fx_rates set rate_pkr = 1 where currency = 'USD' and source = 'auto'$q$), 0,
  'sales cannot update an auto rate');
select is(public.t_rows($q$delete from public.fx_rates where currency = 'JPY'$q$), 0, 'sales cannot delete rates');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok($$select public.set_fx_rate('SEK', 27)$$, 'an engineer can enter a manual rate');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.fx_rates), 0, 'a deactivated user sees no rates');
select is((select count(*)::int from public.v_fx_latest), 0, 'and no latest rates');
select throws_ok($$select public.set_fx_rate('SEK', 28)$$, '42501', null, 'and cannot enter one');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$insert into public.fx_rates (currency, rate_pkr, source) values ('SEK', 27.5, 'auto')$$, 'admin can write an auto rate');
select is(public.t_rows($q$delete from public.fx_rates where currency = 'SEK'$q$), 2, 'admin can delete rates');

-- ------------------------------------------------------------------ company_profile
select is((select count(*)::int from public.company_profile), 1, 'the profile row exists');
select ok((select quotation_validity_days = 30 and legal_name is null from public.company_profile), 'defaults: 30 days, nothing filled in');
select throws_ok($$update public.company_profile set quotation_validity_days = 0$$, '23514', null, 'validity must be positive');
select throws_ok($$insert into public.company_profile (id) values (2)$$, '42501', null, 'admin cannot insert a second profile row');
select throws_ok($$delete from public.company_profile$$, '42501', null, 'admin cannot delete the profile');
select is(public.t_rows($q$update public.company_profile set legal_name = 'Q-Tech Pvt Ltd', address = 'Lahore'$q$), 1,
  'admin updates the profile');
select ok((select updated_by = 'a0000000-0000-4000-8000-000000000001' and updated_at > now() - interval '1 minute'
           from public.company_profile), 'updated_by and updated_at are stamped');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select legal_name from public.company_profile), 'Q-Tech Pvt Ltd', 'sales can read the profile');
select is(public.t_rows($q$update public.company_profile set legal_name = 'Hacked'$q$), 0, 'sales cannot update it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select address from public.company_profile), 'Lahore', 'an engineer can read the profile');
select is(public.t_rows($q$update public.company_profile set legal_name = 'Hacked'$q$), 0, 'an engineer cannot update it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.company_profile), 0, 'a deactivated user sees nothing');

-- ------------------------------------------------------------------ anon
reset role;
set local role anon;
select throws_ok($$select * from public.fx_rates$$, '42501', null, 'anon cannot read fx_rates');
select throws_ok($$select * from public.v_fx_latest$$, '42501', null, 'anon cannot read v_fx_latest');
select throws_ok($$select * from public.company_profile$$, '42501', null, 'anon cannot read the profile');
reset role;

select * from finish();
rollback;
