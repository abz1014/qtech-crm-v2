begin;
select plan(8);

select has_extension('extensions', 'pg_trgm', 'pg_trgm is installed in schema extensions');

-- today_pkt(ts) takes an explicit instant, so these checks are deterministic: the
-- transaction clock (now()) cannot be set, but a fixed timestamptz can be passed in.
-- Asia/Karachi is UTC+5 all year (no DST). 19:00 UTC is exactly PKT midnight.
select is(public.today_pkt('2026-03-14 18:59:59+00'), '2026-03-14'::date,
  '18:59:59 UTC is still the same PKT day');
select is(public.today_pkt('2026-03-14 19:00:00+00'), '2026-03-15'::date,
  '19:00:00 UTC is PKT midnight: next day');
select is(public.today_pkt('2026-03-14 23:30:00+00'), '2026-03-15'::date,
  '23:30 UTC is already the next day in PKT (UTC current_date would be wrong)');
select is(public.today_pkt('2026-12-31 23:30:00+00'), '2027-01-01'::date,
  '23:30 UTC on 31 Dec rolls the PKT year');
select is(public.today_pkt('2026-03-14 00:00:00+00'), '2026-03-14'::date,
  '00:00 UTC is 05:00 PKT, same day');

set local timezone = 'America/Los_Angeles';
select is(public.today_pkt(), (now() at time zone 'Asia/Karachi')::date,
  'no-argument form uses now() and ignores the session time zone');
reset timezone;

create temp table t_upd (id int, updated_at timestamptz not null default 'epoch');
create trigger t_upd_set_updated_at before update on t_upd
  for each row execute function public.set_updated_at();
insert into t_upd (id) values (1);
update t_upd set id = 2;
select is((select updated_at from t_upd), now(), 'set_updated_at stamps updated_at with now() on update');

select * from finish();
rollback;
