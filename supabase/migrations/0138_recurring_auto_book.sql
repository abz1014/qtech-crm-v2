-- 0138_recurring_auto_book: an optional "Book it for me" switch on a recurring bill (rent, salaries: fixed amounts), OFF by default.
-- Owner decision (chat, "Approve all"): every bill gets a one-tap reminder in To do (app change); a fixed bill may also be booked
-- by the database itself.
--
--   recurring_expenses.auto_book  boolean default false   the switch (admin only, as the table is)
--   expenses.auto_booked          boolean default false   this row was booked by the daily job and nobody has looked at it yet
--   book_recurring_month()        SECURITY DEFINER; pg_cron runs it every day at 03:00 Karachi time (22:00 UTC)
--
-- What the job books: an active template with auto_book on whose day of the month is today (Karachi). One expense, dated today,
-- for the month the bill is for (0087: a bill paid on day 1 to 10 is for last month; rent is always the month paid, 0106), with
-- the template's name, amount, category and way of paying. `on conflict do nothing` on (recurring_id, period) makes it safe to run
-- twice, and safe next to a hand-recorded or "Record all" row. It skips a closed month (the month lock would refuse it), an
-- inactive category, a template whose start month is later, and a template with no day.
--
-- "Not yet confirmed": an auto-booked row is not counted as cash that has left the box (cash_in_hand ignores it) until somebody
-- confirms it; any change an admin makes to the row, a Confirm tap, or ticking it against the bank statement clears the flag.
-- Bank check needs no change: a bank row is unticked (bank_month null) until it is matched on the statement.
--
-- Who may call it: pg_cron (no signed-in person) and an admin. Anyone else signed in is refused (42501); anon holds no grant.
-- Expand-only: two columns with defaults, one new function and trigger, longer bodies of cash_in_hand and enforce_month_lock.

alter table public.recurring_expenses add column auto_book boolean not null default false;
comment on column public.recurring_expenses.auto_book is
  '0138: book this bill by itself on its day each month (book_recurring_month, 03:00 Karachi). For fixed amounts only. Default off.';

alter table public.expenses add column auto_booked boolean not null default false;
comment on column public.expenses.auto_booked is
  '0138: booked by book_recurring_month and not yet confirmed. cash_in_hand leaves it out until an admin changes or confirms the row.';

-- ================================================================ the daily job
create function public.book_recurring_month(p_today date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today  date := coalesce(p_today, public.today_pkt());
  v_period text;
  v_rows   integer;
  v_n      integer := 0;
  t        record;
begin
  -- pg_cron has no signed-in person; a signed-in caller must be an admin (the grant also reaches deactivated and role-less people)
  if auth.uid() is not null and coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can book the monthly bills.' using errcode = '42501';
  end if;

  for t in
    select r.id, r.label, r.category_id, r.amount, r.paid_via, r.day_of_month, r.start_month
    from public.recurring_expenses r
    join public.expense_categories c on c.id = r.category_id
    where r.auto_book and r.active and c.active
      and r.day_of_month = extract(day from v_today)::int
    order by r.label, r.id
  loop
    v_period := case
      when t.category_id = 'ca7e0000-0000-4000-8000-000000000002' then to_char(v_today, 'YYYY-MM')           -- rent: the month paid (0106)
      when t.day_of_month <= 10 then to_char(v_today - interval '1 month', 'YYYY-MM')                          -- 0087: by the 10th is last month
      else to_char(v_today, 'YYYY-MM')
    end;
    continue when t.start_month is not null and t.start_month > v_period;
    continue when public.month_is_closed(v_today);

    insert into public.expenses (amount_pkr, category_id, paid_on, paid_via, description, recurring_id, period, auto_booked)
    values (t.amount, t.category_id, v_today, t.paid_via, t.label, t.id, v_period, true)
    on conflict (recurring_id, period) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.book_recurring_month(date) from public, anon, authenticated, service_role;
grant execute on function public.book_recurring_month(date) to authenticated, qtech_engineer;   -- 0081 mirror; the engineer is refused inside

comment on function public.book_recurring_month(date) is
  '0138: books each auto_book template whose day is today (Karachi) once: dated today, for the month its bill is for, auto_booked = true; repeat-safe (on conflict do nothing), skips a closed month. pg_cron daily 03:00 Karachi; an admin may also call it. Anyone else signed in gets 42501.';

-- ================================================================ a change by a person confirms an auto-booked row
create function public.expenses_confirm_auto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.auto_booked and new.auto_booked and auth.uid() is not null then
    new.auto_booked := false;
  end if;
  return new;
end;
$$;

revoke all on function public.expenses_confirm_auto() from public, anon, authenticated;

create trigger expenses_confirm_auto before update on public.expenses
  for each row execute function public.expenses_confirm_auto();

-- ================================================================ cash_in_hand: an auto-booked cash row has not left the box yet
do $do$
declare
  def     text := pg_catalog.pg_get_functiondef('public.cash_in_hand()'::regprocedure);
  a1      text := 'e.paid_via = ''cash''';
  patched text;
begin
  if strpos(def, a1) = 0 then
    raise exception '0138: cash_in_hand was not in the expected shape';
  end if;
  patched := replace(def, a1, a1 || ' and not e.auto_booked');
  execute patched;
end
$do$;

-- ================================================================ the month lock: confirming a row is not a change to the month
-- Like the bank tick (0089) and the certificate file (0128): auto_booked alone moving never touches a closed month.
do $do$
declare
  def     text := pg_catalog.pg_get_functiondef('public.enforce_month_lock()'::regprocedure);
  a1      text := '- ''wht_certificate_name''';
  patched text;
begin
  if strpos(def, a1) = 0 then
    raise exception '0138: the month lock function was not in the expected shape';
  end if;
  patched := replace(def, a1, a1 || ' - ''auto_booked''');
  execute patched;
end
$do$;

-- ================================================================ the schedule: 03:00 Karachi (22:00 UTC), when pg_cron is installed
do $do$
begin
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '0138: pg_cron not installed, book_recurring_month() is not scheduled (the To do reminder still works)';
    return;
  end if;
  execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'book-recurring'$q$;
  execute $q$select cron.schedule('book-recurring', '0 22 * * *', 'select public.book_recurring_month()')$q$;
exception when others then
  raise notice '0138: could not schedule book-recurring (%): the To do reminder still works', sqlerrm;
end
$do$;
