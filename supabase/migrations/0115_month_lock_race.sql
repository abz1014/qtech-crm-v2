-- 0115_month_lock_race (money-integrity audit M2): a closed month is frozen for every table that holds its money, and closing a
-- month cannot race a write.
--
-- Intent (0027, 0086, 0089): once an admin closes a month, nothing dated in it changes: payments in, expenses and invoices (and,
-- since 0073, voided payments too). Three gaps remained:
--   1. close_month / close_months_through read the tables, snapshot them and insert the closed_months row without stopping a
--      concurrent writer, so a payment typed while the month closed could land in the closed month after its snapshot.
--      Both now take SHARE ROW EXCLUSIVE locks on the money tables first (in one fixed order). month_is_closed() becomes VOLATILE
--      so a writer that waited on that lock sees the new closed_months row with a fresh snapshot, not the one it started with.
--   2. enforce_month_lock covered payments_in, expenses and invoices only. It now also covers:
--        credit_notes   by issued_on (a credit note cannot be issued into a closed month)
--        cash_topups    by drawn_on     (cash moved into the office box)
--        cash_counts    by counted_on   (an opening balance or count)
--        order_costs    by the day the costs were marked complete: once that day's month is closed, the expected cost and the
--                       complete mark cannot be changed (they decide the order's margin). Marking complete today is a change in
--                       an open month and works as before. Deleting the row (an order deleted) is not blocked.
--      Extended from the CURRENT function text (the 0092 patch is kept), not re-typed.
--   3. close_month's "earlier months first" check also counts credit notes.
-- The months already closed stay as they are; nothing is rewritten.
--
-- Expand-only: no table or column changes; stricter triggers on four tables, and the lock statements in two functions.

create or replace function public.month_is_closed(d date)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (select 1 from public.closed_months m where m.month = date_trunc('month', d)::date)
$$;

do $do$
declare
  def     text := pg_catalog.pg_get_functiondef('public.enforce_month_lock()'::regprocedure);
  patched text;
  a1      text := 'else  -- invoices';
  a2      text := 'elsif tg_table_name = ''expenses'' and (to_jsonb(old) ->> ''recurring_id'') is not null';
  r1      text := $r$elsif tg_table_name = 'credit_notes' then
    if tg_op <> 'INSERT' then v_old := old.issued_on; end if;
    if tg_op <> 'DELETE' then v_new := new.issued_on; end if;
  elsif tg_table_name = 'cash_topups' then
    if tg_op <> 'INSERT' then v_old := old.drawn_on; end if;
    if tg_op <> 'DELETE' then v_new := new.drawn_on; end if;
  elsif tg_table_name = 'cash_counts' then
    if tg_op <> 'INSERT' then v_old := old.counted_on; end if;
    if tg_op <> 'DELETE' then v_new := new.counted_on; end if;
  elsif tg_table_name = 'order_costs' then
    -- 0115: the day the costs were marked complete (Karachi) decides the month; an order cost never marked complete has none
    if tg_op <> 'INSERT' then v_old := (old.costs_complete_at at time zone 'Asia/Karachi')::date; end if;
    if tg_op <> 'DELETE' then v_new := (new.costs_complete_at at time zone 'Asia/Karachi')::date; end if;
  else  -- invoices$r$;
  r2      text := $r$elsif tg_table_name = 'order_costs' then
      v_touched := (new.expected_cost_pkr, new.costs_complete_at) is distinct from (old.expected_cost_pkr, old.costs_complete_at);
    $r$;
begin
  if strpos(def, a1) = 0 or strpos(def, a2) = 0 then
    raise exception '0115: the month lock function was not in the expected shape';
  end if;
  patched := replace(def, a1, r1);
  patched := replace(patched, a2, r2 || a2);
  -- the imported-invoice allowance reads old.legacy_source; a table without that column (order_costs) must not fail on it
  patched := replace(patched, 'old.legacy_source is not null', '(to_jsonb(old) ->> ''legacy_source'') is not null');
  if patched = def then
    raise exception '0115: the month lock function was not changed';
  end if;
  execute patched;
end
$do$;

create trigger cash_topups_month_lock before insert or update or delete on public.cash_topups
  for each row execute function public.enforce_month_lock();
create trigger cash_counts_month_lock before insert or update or delete on public.cash_counts
  for each row execute function public.enforce_month_lock();
create trigger order_costs_month_lock before update on public.order_costs
  for each row execute function public.enforce_month_lock();
create trigger credit_notes_month_lock before insert on public.credit_notes
  for each row execute function public.enforce_month_lock();

-- ---------------------------------------------------------------- close_month, close_months_through: lock, then read
create or replace function public.close_month(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_open  date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can close a month' using errcode = '42501';
  end if;
  if v_month is null then
    raise exception 'a month is required' using errcode = '22004';
  end if;
  if v_month >= date_trunc('month', public.today_pkt())::date then
    raise exception '% cannot be closed yet: it is the current month or later.', to_char(v_month, 'FMMonth YYYY')
      using errcode = 'P0001';
  end if;
  -- 0115 (M2): no writer may slip a row into a month while it is being closed. SHARE ROW EXCLUSIVE conflicts with every writer
  -- (and with another close), so a row is either committed before the snapshot is taken or waits and meets the closed month.
  -- Taken in one fixed order so two closers or a closer and a writer cannot deadlock.
  lock table public.cash_counts, public.cash_topups, public.credit_notes, public.expenses, public.invoices,
             public.order_costs, public.payments_in in share row exclusive mode;
  if exists (select 1 from public.closed_months m where m.month = v_month) then
    return;   -- already closed: nothing to do
  end if;

  -- Months close in order: an earlier month that still has money rows must be closed first.
  select min(r.m) into v_open
  from (
    select date_trunc('month', received_on)::date as m from public.payments_in
    union
    select date_trunc('month', paid_on)::date from public.expenses
    union
    select date_trunc('month', invoice_date)::date from public.invoices where invoice_date is not null
    union
    select date_trunc('month', issued_on)::date from public.credit_notes
  ) r
  where r.m < v_month
    and not exists (select 1 from public.closed_months c where c.month = r.m);
  if v_open is not null then
    raise exception '% is still open. Close earlier months first (close_months_through closes them all).',
      to_char(v_open, 'FMMonth YYYY') using errcode = 'P0001';
  end if;

  insert into public.closed_months (month, closed_by) values (v_month, auth.uid());
end;
$$;

create or replace function public.close_months_through(p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_through date := date_trunc('month', p_month)::date;
  v_first   date;
  v_m       date;
  v_n       integer := 0;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can close a month' using errcode = '42501';
  end if;
  if v_through is null then
    raise exception 'a month is required' using errcode = '22004';
  end if;
  if v_through >= date_trunc('month', public.today_pkt())::date then
    raise exception '% cannot be closed yet: it is the current month or later.', to_char(v_through, 'FMMonth YYYY')
      using errcode = 'P0001';
  end if;

  -- 0115 (M2): no writer may slip a row into a month while it is being closed. SHARE ROW EXCLUSIVE conflicts with every writer
  -- (and with another close), so a row is either committed before the snapshot is taken or waits and meets the closed month.
  -- Taken in one fixed order so two closers or a closer and a writer cannot deadlock.
  lock table public.cash_counts, public.cash_topups, public.credit_notes, public.expenses, public.invoices,
             public.order_costs, public.payments_in in share row exclusive mode;

  select min(r.m) into v_first
  from (
    select date_trunc('month', received_on)::date as m from public.payments_in
    union
    select date_trunc('month', paid_on)::date from public.expenses
    union
    select date_trunc('month', invoice_date)::date from public.invoices where invoice_date is not null
    union
    select date_trunc('month', issued_on)::date from public.credit_notes
  ) r;
  v_first := least(coalesce(v_first, v_through), v_through);

  for v_m in select g::date from generate_series(v_first::timestamp, v_through::timestamp, interval '1 month') g order by 1 loop
    if not exists (select 1 from public.closed_months c where c.month = v_m) then
      insert into public.closed_months (month, closed_by) values (v_m, auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
