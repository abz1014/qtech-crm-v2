-- 0027_month_close (S22): Amendment A6.1 and A6.2. closed_months, month_is_closed(), the lock triggers on payments_in,
-- expenses and invoices, and the admin RPCs close_month, close_months_through and reopen_month.
--
-- A closed month freezes payments (received_on), expenses (paid_on) and invoices (invoice_date) dated in it. Ticks and
-- filing stamps stay editable: October's filing happens in November. There is deliberately NO service-role bypass.
-- Cutover runbook line (I11): close no month before the final import; after sign-off run close_months_through(last month).

-- ---------------------------------------------------------------- closed_months
create table public.closed_months (
  month      date primary key check (extract(day from month) = 1),
  closed_at  timestamptz not null default now(),
  closed_by  uuid not null default auth.uid() references public.users (id) on delete restrict,
  note       text
);

comment on table public.closed_months is
  'Amendment A6: one row per closed month. Written only by close_month, close_months_through and reopen_month. Reopening deletes the row; audit_log keeps the history.';

alter table public.closed_months enable row level security;

-- Section 10 (A6): admin reads; nobody writes directly.
revoke all on table public.closed_months from public, anon, authenticated;
grant select on table public.closed_months to authenticated;

create policy closed_months_select_admin on public.closed_months for select to authenticated
  using (public.current_user_role() = 'admin');

-- The table has no id column; its key is the month.
create trigger closed_months_audit after insert or update or delete on public.closed_months
  for each row execute function public.audit_row_change('month');

-- ---------------------------------------------------------------- month_is_closed
-- SECURITY DEFINER so the lock triggers work for sales (who edit invoices) without any right on closed_months.
-- Not granted to clients: the lock triggers and the RPCs below are its only callers.
create function public.month_is_closed(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.closed_months m where m.month = date_trunc('month', d)::date)
$$;

revoke all on function public.month_is_closed(date) from public, anon, authenticated;

-- ---------------------------------------------------------------- lock trigger
-- Checks both the OLD and the NEW date. What may still change in a closed month:
--   payments_in, expenses : bank_month only
--   invoices              : everything except number, invoice_date, net_amount, gst_amount, order_id, company_id
-- Errors use errcode P0001 so the app (U07) can recognise them: "September 2026 is closed. An admin can reopen it."
create function public.enforce_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
  v_new date;
  v_touched boolean;
  v_month date;
begin
  if tg_table_name = 'payments_in' then
    if tg_op <> 'INSERT' then v_old := old.received_on; end if;
    if tg_op <> 'DELETE' then v_new := new.received_on; end if;
  elsif tg_table_name = 'expenses' then
    if tg_op <> 'INSERT' then v_old := old.paid_on; end if;
    if tg_op <> 'DELETE' then v_new := new.paid_on; end if;
  else  -- invoices
    if tg_op <> 'INSERT' then v_old := old.invoice_date; end if;
    if tg_op <> 'DELETE' then v_new := new.invoice_date; end if;
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'invoices' then
      v_touched := (new.number, new.invoice_date, new.net_amount, new.gst_amount, new.order_id, new.company_id)
        is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount, old.order_id, old.company_id);
    else
      v_touched := (to_jsonb(new) - 'bank_month') is distinct from (to_jsonb(old) - 'bank_month');
    end if;
    if not v_touched then
      return new;
    end if;
  end if;

  if public.month_is_closed(v_old) then
    v_month := date_trunc('month', v_old)::date;
  elsif public.month_is_closed(v_new) then
    v_month := date_trunc('month', v_new)::date;
  end if;
  if v_month is not null then
    raise exception '% is closed. An admin can reopen it.', to_char(v_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_month_lock() from public, anon, authenticated;

create trigger payments_in_month_lock before insert or update or delete on public.payments_in
  for each row execute function public.enforce_month_lock();
create trigger expenses_month_lock before insert or update or delete on public.expenses
  for each row execute function public.enforce_month_lock();
create trigger invoices_month_lock before insert or update or delete on public.invoices
  for each row execute function public.enforce_month_lock();

-- ---------------------------------------------------------------- RPCs
-- SECURITY DEFINER with an explicit admin check inside: closed_months has no client write grant, so these three
-- functions are the only way to change it. Sales, engineers, deactivated and unknown callers get 42501.

-- Closes one month. Refuses the current or a future month, and refuses while an earlier month that has money rows is
-- still open (the app then offers close_months_through). Closing a closed month does nothing.
create function public.close_month(p_month date)
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

revoke all on function public.close_month(date) from public, anon, authenticated;
grant execute on function public.close_month(date) to authenticated;

-- Closes every open month from the earliest month that has money rows up to and including p_month. Returns the number
-- of months it closed (0 when everything was already closed).
create function public.close_months_through(p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_through date := date_trunc('month', p_month)::date;
  v_first   date;
  v_n       integer;
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

  select min(r.m) into v_first
  from (
    select date_trunc('month', received_on)::date as m from public.payments_in
    union
    select date_trunc('month', paid_on)::date from public.expenses
    union
    select date_trunc('month', invoice_date)::date from public.invoices where invoice_date is not null
  ) r;
  v_first := least(coalesce(v_first, v_through), v_through);

  insert into public.closed_months (month, closed_by)
  select g::date, auth.uid()
  from generate_series(v_first::timestamp, v_through::timestamp, interval '1 month') g
  where not exists (select 1 from public.closed_months c where c.month = g::date);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.close_months_through(date) from public, anon, authenticated;
grant execute on function public.close_months_through(date) to authenticated;

-- Reopens one month by deleting its row (audited by the trigger). The optional note is written to the row first, so the
-- audit log carries it. Reopening a month that is not closed does nothing.
create function public.reopen_month(p_month date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can reopen a month' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is not null then
    update public.closed_months m
    set note = coalesce(m.note || E'\n', '') || 'Reopened: ' || btrim(p_note)
    where m.month = v_month;
  end if;
  delete from public.closed_months m where m.month = v_month;
end;
$$;

revoke all on function public.reopen_month(date, text) from public, anon, authenticated;
grant execute on function public.reopen_month(date, text) to authenticated;
