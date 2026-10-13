-- 0002_helpers (S01, part 1): extension and pure helper functions.
-- No dependency on any table, so this file comes first.

create extension if not exists pg_trgm with schema extensions;

-- Calendar date in Asia/Karachi (DATA_MODEL section 2, Dates). current_date would be UTC.
-- The optional argument exists so tests can pass a fixed instant; callers use today_pkt().
create function public.today_pkt(ts timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (ts at time zone 'Asia/Karachi')::date
$$;

-- [upd] trigger: keeps updated_at current on roots where staleness matters.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
