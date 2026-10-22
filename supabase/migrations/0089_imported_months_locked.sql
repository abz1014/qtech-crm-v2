-- 0089_imported_months_locked (owner decision 2026-10-22, redesign decision 5: "months lock one at a time; months before
-- go-live are locked as Imported").
--
-- >>> THE ONE CONSTANT. The last pre-go-live month to lock (the first day of that month). The owner may move it to
-- >>> '2026-09-01' to lock September 2026 as Imported too. Nothing else in this file names a month.
select set_config('qtech.imported_through', '2026-08-01', false);
--
-- Why: close_month (0027) refuses while any earlier month with money in it is still open, and the imported history goes back
-- to September 2024, so without this the owner could not close September 2026 (the app closes one month per tap and never
-- calls close_months_through). This file:
--   (a) closes every month from the earliest month with money in it through the constant above, oldest first, each with its
--       snapshot (the 0058/0076 triggers) and the note 'Imported'. Only on a database that holds imported money rows
--       (legacy_source set on payments_in, expenses or invoices); elsewhere (CI, a fresh project) it does nothing. Idempotent:
--       a month already closed is left as it is, and nothing is done when a later month is already closed.
--   (b) adds one narrow, transaction-local allowance to the month lock, `qtech.legacy_link`, on the pattern of 0086's
--       `qtech.category_merge`: while it is 'on', an IMPORTED invoice (legacy_source set) in a closed month may change its
--       order_id and nothing else (linking imported invoices to orders, redesign phase 2). Any other column, and any
--       non-imported row, is refused as before. Clients cannot set it (set_config is not exposed by the data API); it is for
--       a future admin linking function, which sets it around its one UPDATE as merge_expense_categories does.

-- ================================================================ (b) the month lock, with the qtech.legacy_link allowance
-- 0086's function with one change in the invoices branch.
create or replace function public.enforce_month_lock()
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
    if tg_table_name = 'invoices' and old.legacy_source is not null
       and coalesce(current_setting('qtech.legacy_link', true), '') = 'on' then
      -- 0089: linking an imported invoice to an order: only order_id may change (not even a filing stamp in the same UPDATE)
      v_touched := (to_jsonb(new) - 'order_id') is distinct from (to_jsonb(old) - 'order_id');
    elsif tg_table_name = 'invoices' then
      v_touched := (new.number, new.invoice_date, new.net_amount, new.gst_amount, new.order_id, new.company_id)
        is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount, old.order_id, old.company_id);
    elsif tg_table_name = 'expenses' and coalesce(current_setting('qtech.category_merge', true), '') = 'on' then
      -- 0086: inside merge_expense_categories only the category may change
      v_touched := (to_jsonb(new) - 'bank_month' - 'category_id') is distinct from (to_jsonb(old) - 'bank_month' - 'category_id');
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

-- ================================================================ (a) lock the imported months
-- Closes every open month from the earliest month with money in it through p_through, oldest first, with the note 'Imported'.
-- Returns how many months it closed. Does nothing (0) when no money row is imported, or when a month after p_through is
-- already closed (the books have moved on; closing earlier months now would be out of order). The snapshot triggers read the
-- admin-only views, so the inserts run as the first active admin (the claims are set for this transaction only and put back);
-- that admin is closed_by and the audit actor, and the note says the months were imported.
-- SECURITY INVOKER (nothing in qtech_private is a definer, 0081) and executable by nobody but its owner: the migration calls it.
create function qtech_private.lock_imported_months(p_through date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_through date := date_trunc('month', p_through)::date;
  v_from    date;
  v_admin   uuid;
  v_claims  text := current_setting('request.jwt.claims', true);
  v_m       date;
  v_n       integer := 0;
begin
  if v_through is null then
    raise exception 'a month is required' using errcode = '22004';
  end if;
  if v_through >= date_trunc('month', public.today_pkt())::date then
    raise exception '% has not ended: only months that have ended can be locked as Imported.', to_char(v_through, 'FMMonth YYYY')
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.payments_in p where p.legacy_source is not null)
     and not exists (select 1 from public.expenses e where e.legacy_source is not null)
     and not exists (select 1 from public.invoices i where i.legacy_source is not null) then
    return 0;   -- nothing imported: nothing to lock
  end if;
  if exists (select 1 from public.closed_months c where c.month > v_through) then
    return 0;   -- a later month is closed already
  end if;

  select min(r.m) into v_from
  from (
    select date_trunc('month', received_on)::date as m from public.payments_in
    union
    select date_trunc('month', paid_on)::date from public.expenses
    union
    select date_trunc('month', invoice_date)::date from public.invoices where invoice_date is not null
  ) r
  where r.m <= v_through;
  if v_from is null then
    return 0;
  end if;

  select u.id into v_admin from public.users u
  where u.role = 'admin' and u.deactivated_at is null
  order by u.created_at, u.id
  limit 1;
  if v_admin is null then
    raise exception 'No active admin: the imported months cannot be locked.' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  for v_m in select g::date from generate_series(v_from, v_through, interval '1 month') g loop
    if not exists (select 1 from public.closed_months c where c.month = v_m) then
      insert into public.closed_months (month, closed_by, note) values (v_m, v_admin, 'Imported');
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_n;
end;
$$;

revoke all on function qtech_private.lock_imported_months(date) from public, anon, authenticated, service_role;

comment on function qtech_private.lock_imported_months(date) is
  '0089: closes the pre-go-live months (earliest money month through p_through) with the note Imported, oldest first, with snapshots. No-op without imported money rows. Called by migration 0089 only.';

select qtech_private.lock_imported_months(current_setting('qtech.imported_through')::date);
select set_config('qtech.imported_through', '', false);
