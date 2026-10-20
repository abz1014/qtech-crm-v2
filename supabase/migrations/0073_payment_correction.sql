-- 0073_payment_correction (learnability and bookkeeping audit): a recorded payment can be voided, corrected and, for a short
-- while, un-voided. Before this a mistyped amount, date or paid-via could not be put right anywhere in the app.
--
-- The approach is a SOFT VOID. The payment row stays where it is and is marked: voided_at, voided_by, void_reason. A
-- correction is a void plus a new row that points at the old one (corrects_payment_id), so history is never overwritten
-- and both rows, with every change, are in audit_log (the 0013 trigger). Why not the alternatives:
--   reversing entry  a negative row dated like the original would net to zero in sums, but payments_in.amount is CHECK > 0
--                    (2.17), money_exceptions_input() flags a payment that is not positive (0066), counts and lists (month
--                    snapshots, the order page, the bank tick) would show two rows for one mistake, and a negative bank line
--                    would have to be ticked against a statement that never carried it.
--   move it out      deleting the row into an archive table would keep every reader correct with no change, but the row
--                    leaves its table (the audit log reads "delete"), a correction cannot reference it with a foreign key,
--                    and Undo would re-insert it.
-- The cost of the soft void is that every reader must leave voided rows out. This migration re-creates each of them with
-- exactly that one change ("and p.voided_at is null"); a pgTAP guard (0073 test) fails if a view or function in public reads
-- payments_in without mentioning voided_at, apart from the four listed there with their reason. Readers changed:
--   v_payment_net            (0015) the base of v_cash_month, v_target_progress, v_month_pnl_live, v_month_pnl, v_month_team
--                            and the month snapshot's payments: all follow it unchanged
--   v_order_money            (0059) settled / receivable / payment state; v_order_state (0016) and money_exceptions_input
--                            read it
--   order_receivables()      (0059) "who owes us", the order page's balance, Today's payment items and reminders
--   my_target_progress_at()  (0018) the Today target tile (my_target_progress() calls it)
--   aging_as_of()            (0068) overdue by age, "who owes us" by invoice, the month snapshot's aging
--   month_end_status()       (0058) bank_unticked and provisional_margins counts
--   month_end_check_details() (0064) the same two checks' figures
--   money_exceptions_input() (0066) the payments it flags
-- Not changed, on purpose: close_month / close_months_through (they look for the earliest month with any money row; a
-- voided row still dates its month and is frozen with it), enforce_month_lock (it locks voided rows like any other: a
-- void, correction or undo in a closed month is refused) and take_month_snapshot (it reads payments through v_payment_net
-- and joins payments_in only for the reference).
--
-- The RPCs (SECURITY INVOKER: row security still applies, and the caller must be an admin):
--   void_payment(p_payment_id, p_reason)                     marks the payment void. Refused for a non-admin (42501), with no
--                                                            reason (22023), when already void, when its month is closed
--                                                            ("<Month> is closed. Reopen it first ..."), and when it is ticked
--                                                            against a bank statement (untick it first): P0001.
--   correct_payment(p_payment_id, p_amount, p_received_on,   void_payment plus a new row on the same order with the new amount,
--                   p_paid_via, p_reference, p_reason,       date, paid via and reference, the same credited person (NULL
--                   p_new_id)                                stays NULL: an unattributed legacy payment stays unattributed) and
--                                                            corrects_payment_id = the old row. Also refused when the new date
--                                                            is in a closed month or nothing changed. p_new_id is the client's
--                                                            id for the new row: a retry with the same id returns it again.
--   restore_payment(p_payment_id)                            Undo. Only the person who voided, within 10 minutes of the void.
--                                                            When the void was a correction, the correction is voided in the
--                                                            same step ("Undo of a correction"), so the money counts once; if
--                                                            that correction has itself been voided or corrected since, Undo
--                                                            is refused.
-- Every refusal carries a HINT naming it (reason_required, not_found, already_voided, month_closed, bank_ticked, unchanged,
-- amount, date, paid_via, not_voided, undo_other_user, undo_expired, changed_since) so the app can word it; the message itself
-- is already a plain sentence.
--
-- A guard trigger (the 0065 pattern: it limits the role `authenticated` only) keeps the void columns and corrects_payment_id
-- for these three functions (they mark their own transaction with set_config, which the API cannot reach) and freezes a
-- voided row: it cannot be changed, ticked or deleted, only restored. The service role (the legacy import) and postgres are
-- not limited. The legacy import refuses to run while an imported payment is voided or corrected (it would bring it back).

-- ---------------------------------------------------------------- columns
alter table public.payments_in
  add column voided_at           timestamptz,
  add column voided_by           uuid references public.users (id) on delete restrict,
  add column void_reason         text,
  add column corrects_payment_id uuid references public.payments_in (id) on delete restrict,
  add constraint payments_in_void_reason_with_void check ((voided_at is null) = (void_reason is null)),
  add constraint payments_in_void_reason_present check (void_reason is null or btrim(void_reason) <> ''),
  add constraint payments_in_voided_by_with_void check (voided_by is null or voided_at is not null),
  add constraint payments_in_voided_not_ticked check (voided_at is null or bank_month is null),
  add constraint payments_in_corrects_another check (corrects_payment_id is distinct from id);

comment on column public.payments_in.voided_at is
  '0073: when the payment was voided (void_payment or correct_payment). A voided row is kept as history and left out of every money figure. NULL = counts.';
comment on column public.payments_in.voided_by is '0073: who voided it.';
comment on column public.payments_in.void_reason is '0073: why it was voided, as typed (required with voided_at).';
comment on column public.payments_in.corrects_payment_id is
  '0073: set on a row made by correct_payment: the voided payment it replaces. Its created_at equals that payment''s voided_at.';

-- At most one live correction per payment; the plain index serves the foreign key.
create unique index payments_in_one_live_correction on public.payments_in (corrects_payment_id)
  where corrects_payment_id is not null and voided_at is null;
create index payments_in_corrects_idx on public.payments_in (corrects_payment_id) where corrects_payment_id is not null;

-- ---------------------------------------------------------------- credited person of a correction
-- 0010 with one change: a correction keeps the credited person of the payment it replaces, including NULL (an unattributed
-- legacy payment stays unattributed). correct_payment copies it; the guard below lets only correct_payment set
-- corrects_payment_id.
create or replace function public.set_payment_credited_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.credited_user_id is null and new.legacy_source is null and new.corrects_payment_id is null then
    select o.owner_id into new.credited_user_id from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- guard
-- Named so it fires after payments_in_month_lock (BEFORE triggers run in name order): a closed month answers first.
create function public.guard_payment_void()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mark text := coalesce(current_setting('qtech.payment_correction', true), '');
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
      raise exception 'a payment is voided only through void_payment or correct_payment' using errcode = '42501';
    end if;
    if new.corrects_payment_id is not null and v_mark is distinct from new.corrects_payment_id::text then
      raise exception 'a correction is recorded only through correct_payment' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.voided_at is not null then
      raise exception 'This payment is voided and kept as history. It cannot be deleted.'
        using errcode = 'P0001', hint = 'voided';
    end if;
    return old;
  end if;

  if new.corrects_payment_id is distinct from old.corrects_payment_id then
    raise exception 'which payment a correction replaces cannot be changed' using errcode = '42501';
  end if;
  if (new.voided_at, new.voided_by, new.void_reason) is distinct from (old.voided_at, old.voided_by, old.void_reason)
     and v_mark is distinct from old.id::text then
    raise exception 'a payment is voided or restored only through void_payment, correct_payment and restore_payment'
      using errcode = '42501';
  end if;
  if old.voided_at is not null and new.voided_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'This payment is voided and kept as history. It cannot be changed.'
      using errcode = 'P0001', hint = 'voided';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payment_void() from public, anon, authenticated;

create trigger payments_in_void_guard before insert or update or delete on public.payments_in
  for each row execute function public.guard_payment_void();

-- ---------------------------------------------------------------- void_payment
-- voided_at is clock_timestamp(), not now(): two steps in one transaction (a correction, then its Undo) get distinct times,
-- which restore_payment relies on to tell the latest correction from an older, already undone one.
create function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_p      record;
  v_month  date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can void or correct a payment' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for voiding this payment (a few words).' using errcode = '22023', hint = 'reason_required';
  end if;

  select p.id, p.received_on, p.bank_month, p.voided_at into v_p
  from public.payments_in p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'This payment is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_p.voided_at is not null then
    raise exception 'This payment is already voided. Nothing was changed.' using errcode = 'P0001', hint = 'already_voided';
  end if;
  v_month := date_trunc('month', v_p.received_on)::date;
  if exists (select 1 from public.closed_months m where m.month = v_month) then
    raise exception '% is closed. Reopen it first (Money, Month-end), then change this payment.', to_char(v_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'month_closed';
  end if;
  if v_p.bank_month is not null then
    raise exception 'This payment is ticked against the % bank statement. Untick it first (Money, Match bank statement), then change it.',
      to_char(v_p.bank_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'bank_ticked';
  end if;

  perform set_config('qtech.payment_correction', p_payment_id::text, true);
  update public.payments_in
  set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_payment_id;
  perform set_config('qtech.payment_correction', '', true);
end;
$$;

revoke all on function public.void_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------- correct_payment
create function public.correct_payment(
  p_payment_id  uuid,
  p_amount      numeric,
  p_received_on date,
  p_paid_via    text,
  p_reference   text,
  p_reason      text,
  p_new_id      uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref    text := nullif(btrim(coalesce(p_reference, '')), '');
  v_new    uuid := coalesce(p_new_id, gen_random_uuid());
  v_p      record;
  v_month  date;
  v_at     timestamptz;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can void or correct a payment' using errcode = '42501';
  end if;
  -- A retry of a correction that went through (same new id) answers with that id and changes nothing.
  if p_new_id is not null
     and exists (select 1 from public.payments_in x where x.id = p_new_id and x.corrects_payment_id = p_payment_id) then
    return p_new_id;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be above zero.' using errcode = '22023', hint = 'amount';
  end if;
  if p_received_on is null then
    raise exception 'The date received is required.' using errcode = '22023', hint = 'date';
  end if;
  if p_paid_via is null or p_paid_via not in ('bank', 'cash') then
    raise exception 'Paid via must be bank or cash.' using errcode = '22023', hint = 'paid_via';
  end if;

  select p.order_id, p.amount, p.received_on, p.paid_via, p.reference, p.credited_user_id, p.voided_at into v_p
  from public.payments_in p
  where p.id = p_payment_id;
  if not found then
    raise exception 'This payment is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_p.voided_at is not null then
    raise exception 'This payment is already voided. Nothing was changed.' using errcode = 'P0001', hint = 'already_voided';
  end if;
  if (v_p.amount, v_p.received_on, v_p.paid_via, v_p.reference) is not distinct from (p_amount, p_received_on, p_paid_via, v_ref) then
    raise exception 'Nothing to correct: the amount, date, paid via and reference are all the same.'
      using errcode = '22023', hint = 'unchanged';
  end if;
  v_month := date_trunc('month', p_received_on)::date;
  if exists (select 1 from public.closed_months m where m.month = v_month) then
    raise exception 'The new date is in %, which is closed. Reopen it first (Money, Month-end), or choose a date in an open month.',
      to_char(v_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'month_closed';
  end if;

  -- Every check on the payment itself (reason, closed month, bank tick) and the row lock happen here.
  perform public.void_payment(p_payment_id, p_reason);
  select p.voided_at into v_at from public.payments_in p where p.id = p_payment_id;

  perform set_config('qtech.payment_correction', p_payment_id::text, true);
  insert into public.payments_in (id, created_at, order_id, received_on, amount, credited_user_id, reference, paid_via,
                                  corrects_payment_id)
  values (v_new, v_at, v_p.order_id, p_received_on, p_amount, v_p.credited_user_id, v_ref, p_paid_via, p_payment_id);
  perform set_config('qtech.payment_correction', '', true);
  return v_new;
end;
$$;

revoke all on function public.correct_payment(uuid, numeric, date, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.correct_payment(uuid, numeric, date, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------- restore_payment (Undo)
-- The correction made together with this payment's latest void is the one whose created_at equals voided_at (see
-- correct_payment). Older corrections of the same payment were undone before and are already void.
create function public.restore_payment(p_payment_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p      record;
  v_c      record;
  v_month  date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can undo a void' using errcode = '42501';
  end if;

  select p.id, p.received_on, p.voided_at, p.voided_by into v_p
  from public.payments_in p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'This payment is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_p.voided_at is null then
    raise exception 'This payment is not voided. Nothing to undo.' using errcode = 'P0001', hint = 'not_voided';
  end if;
  if v_p.voided_by is distinct from auth.uid() then
    raise exception 'Only the person who voided this payment can undo it. Record the payment again instead.'
      using errcode = 'P0001', hint = 'undo_other_user';
  end if;
  if v_p.voided_at < now() - interval '10 minutes' then
    raise exception 'Undo works for 10 minutes after a void. Record the payment again instead.'
      using errcode = 'P0001', hint = 'undo_expired';
  end if;
  v_month := date_trunc('month', v_p.received_on)::date;
  if exists (select 1 from public.closed_months m where m.month = v_month) then
    raise exception '% is closed. Reopen it first (Money, Month-end), then change this payment.', to_char(v_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'month_closed';
  end if;

  select c.id, c.voided_at into v_c
  from public.payments_in c
  where c.corrects_payment_id = p_payment_id and c.created_at = v_p.voided_at;
  if found then
    if v_c.voided_at is not null then
      raise exception 'The correction of this payment has been changed since. Undo is no longer possible; record the payment again if it is missing.'
        using errcode = 'P0001', hint = 'changed_since';
    end if;
    perform public.void_payment(v_c.id, 'Undo of a correction');
  end if;

  perform set_config('qtech.payment_correction', p_payment_id::text, true);
  update public.payments_in
  set voided_at = null, voided_by = null, void_reason = null
  where id = p_payment_id;
  perform set_config('qtech.payment_correction', '', true);
end;
$$;

revoke all on function public.restore_payment(uuid) from public, anon, authenticated;
grant execute on function public.restore_payment(uuid) to authenticated;

-- ================================================================ readers: voided payments are left out
-- Each block is the latest definition (migration named) with that one change. Same columns and signatures, so grants, the
-- access matrix rows and the generated types of these objects are unchanged.

-- ---------------------------------------------------------------- v_payment_net (0015)
create or replace view public.v_payment_net with (security_invoker = true) as
select
  p.id as payment_id,
  p.order_id,
  p.received_on,
  p.amount,
  p.credited_user_id,
  b.basis,
  b.n,
  b.g,
  x.excluded_reason,
  case when x.excluded_reason in ('basis_unknown', 'zero_value') then null
       else round(p.amount * b.n / b.g, 2) end as net_portion,
  case when x.excluded_reason in ('basis_unknown', 'zero_value') then null
       else p.amount - round(p.amount * b.n / b.g, 2) end as gst_portion,
  (x.excluded_reason is null or x.excluded_reason = 'unattributed') as counts_in_cash_net,
  (x.excluded_reason is null) as counts_in_target
from public.payments_in p
join public.orders o on o.id = p.order_id
join public.v_order_basis b on b.order_id = p.order_id
cross join lateral (
  select case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when b.g = 0 then 'zero_value'
    when p.credited_user_id is null then 'unattributed'
  end as excluded_reason
) x
where public.current_user_role() = 'admin'
  and p.voided_at is null;

-- ---------------------------------------------------------------- order_receivables (0059)
create or replace function public.order_receivables(p_order_id uuid default null)
returns table (
  order_id          uuid,
  order_number      bigint,
  company_id        uuid,
  owner_id          uuid,
  gross_target      numeric,
  settled           numeric,
  balance           numeric,
  overpaid_by       numeric,
  due_on            date,
  is_overdue        boolean,
  payment_state     text,
  last_reminded_on  date,
  reminder_count    smallint,
  data_trust        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.current_user_role();
begin
  if v_role is null then
    return;
  end if;
  if v_role not in ('admin', 'sales') then
    raise exception 'order_receivables is not available to the % role', v_role
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.number,
    o.company_id,
    o.owner_id,
    b.g,
    s.settled,
    greatest(b.g - s.settled, 0),
    greatest(s.settled - b.g, 0),
    d.due_on,
    (d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok),
    case
      when d.due_on is not null and d.due_on < public.today_pkt() and not ok.settled_ok then 'overdue'
      when ok.settled_ok then 'settled'
      when s.settled > 0 then 'part'
      else 'unpaid'
    end,
    iv.last_reminded_on,
    iv.reminder_count,
    case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
         when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
         else 'ok' end
  from public.orders o
  join public.v_order_items_total t on t.order_id = o.id
  cross join lateral (
    select count(*) as invoice_count,
           coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross,
           min(v.invoice_date) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id
  ) iv
  cross join lateral (
    select case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
  ) b
  cross join lateral (
    select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
  ) s
  cross join lateral (
    select (b.g > 0 and s.settled >= b.g - 1) as settled_ok
  ) ok
  cross join lateral (
    select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
  ) cp
  cross join lateral (
    select (iv.first_invoice_date + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ---------------------------------------------------------------- v_order_money (0059)
create or replace view public.v_order_money with (security_invoker = true) as
select
  o.id as order_id,
  o.number as order_number,
  o.company_id,
  o.owner_id,
  b.basis,
  case when b.invoice_count > 0 then b.invoice_net else b.items_net end as net_sale,
  b.g as gross_target,
  s.settled,
  (b.g > 0 and s.settled >= b.g - 1) as settled_ok,
  greatest(b.g - s.settled, 0) as receivable,
  greatest(s.settled - b.g, 0) as overpaid_by,
  d.due_on,
  case
    when d.due_on is not null and d.due_on < public.today_pkt() and not (b.g > 0 and s.settled >= b.g - 1)
      then 'overdue'
    when b.g > 0 and s.settled >= b.g - 1 then 'settled'
    when s.settled > 0 then 'part'
    else 'unpaid'
  end as payment_state,
  e.actual_cost,
  oc.expected_cost_pkr as expected_cost,
  case when oc.costs_complete_at is not null then 'complete' else 'provisional' end as costs_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then null
       else (case when b.invoice_count > 0 then b.invoice_net else b.items_net end) - e.actual_cost end as margin,
  case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when oc.costs_complete_at is null then 'provisional'
    else 'final'
  end as margin_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
       when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
       else 'ok' end as data_trust
from public.orders o
join public.v_order_basis b on b.order_id = o.id
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
) s
cross join lateral (
  select coalesce(sum(x.amount_pkr - x.input_tax_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
) cp
cross join lateral (
  select (min(v.invoice_date) + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  from public.invoices v
  where v.order_id = o.id

) d
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- my_target_progress_at (0018)
create or replace function public.my_target_progress_at(p_at timestamptz)
returns table (
  year            smallint,
  quarter         smallint,
  quarter_end     date,
  target_net      numeric,
  achieved_net    numeric,
  gap             numeric,
  on_pace_net     numeric,
  behind_pace     numeric,
  excluded_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_pkt(p_at);
  v_year    smallint := extract(year from public.today_pkt(p_at))::smallint;
  v_quarter smallint := extract(quarter from public.today_pkt(p_at))::smallint;
  v_start   date;
  v_next    date;
  v_total   integer;
  v_elapsed integer;
  v_target  numeric;
  v_ach     numeric;
  v_excl    integer;
  v_pace    numeric;
begin
  if public.current_user_role() is null then
    return;
  end if;

  v_start := make_date(v_year, (v_quarter - 1) * 3 + 1, 1);
  v_next := (v_start + interval '3 months')::date;
  v_total := v_next - v_start;
  v_elapsed := least(greatest(v_today - v_start + 1, 0), v_total);

  select t.target_net_pkr into v_target
  from public.targets t
  where t.user_id = v_uid and t.year = v_year and t.quarter = v_quarter;

  select
    coalesce(sum(x.net) filter (where x.reason is null), 0),
    count(*) filter (where x.reason is not null)
  into v_ach, v_excl
  from (
    select
      case
        when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
        when b.g = 0 then 'zero_value'
      end as reason,
      case
        when 'value_basis_unknown' = any (o.legacy_flags) or b.g = 0 then null
        else round(p.amount * b.n / b.g, 2)
      end as net
    from public.payments_in p
    join public.orders o on o.id = p.order_id
    join public.v_order_items_total t on t.order_id = o.id
    cross join lateral (
      select count(*) as invoice_count,
             coalesce(sum(v.net_amount), 0) as invoice_net,
             coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross
      from public.invoices v
      where v.order_id = o.id
    ) iv
    cross join lateral (
      select case when iv.invoice_count > 0 then iv.invoice_net else t.net end as n,
             case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
    ) b
    where p.credited_user_id = v_uid
      and p.voided_at is null
      and p.received_on >= v_start
      and p.received_on < v_next
  ) x;

  if v_target is not null then
    v_pace := round(v_target * v_elapsed / v_total, 2);
  end if;

  return query select
    v_year,
    v_quarter,
    (v_next - 1),
    v_target,
    v_ach::numeric(14,2),
    case when v_target is not null then greatest(v_target - v_ach, 0) end,
    v_pace,
    case when v_target is not null then greatest(v_pace - v_ach, 0) end,
    v_excl;
end;
$$;

-- ---------------------------------------------------------------- aging_as_of (0068)
create or replace function public.aging_as_of(p_date date)
returns table (
  kind            text,
  order_id        uuid,
  order_number    bigint,
  company_id      uuid,
  invoice_id      uuid,
  invoice_number  text,
  invoice_date    date,
  gross           numeric,
  applied         numeric,
  remaining       numeric,
  age_days        integer,
  bucket          text,
  advance_held    numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with inv as (
    select v.id, v.order_id as ordid, o.number as order_number, coalesce(v.company_id, o.company_id) as company_id,
           v.number, v.invoice_date, v.net_amount + v.gst_amount as gross
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where v.invoice_date <= p_date
      and not v.settled_before_cutover
      and public.current_user_role() = 'admin'
  ),
  paid as (
    select p.order_id as ordid, sum(p.amount) as paid
    from public.payments_in p
    where p.received_on <= p_date
      and p.voided_at is null
      and public.current_user_role() = 'admin'
    group by p.order_id
  ),
  fifo as (
    select i.*,
           coalesce(pd.paid, 0) as paid,
           coalesce(sum(i.gross) over (partition by i.ordid order by i.invoice_date, i.number, i.id
                                       rows between unbounded preceding and 1 preceding), 0) as before_gross
    from inv i
    left join paid pd on pd.ordid = i.ordid
  ),
  fa as (
    select f.*, least(f.gross, greatest(f.paid - f.before_gross, 0)) as applied_amt
    from fifo f
  )
  select 'invoice'::text, a.ordid, a.order_number, a.company_id, a.id, a.number, a.invoice_date, a.gross,
         a.applied_amt, a.gross - a.applied_amt,
         (p_date - a.invoice_date)::int,
         case when p_date - a.invoice_date <= 30 then '0-30'
              when p_date - a.invoice_date <= 60 then '31-60'
              when p_date - a.invoice_date <= 90 then '61-90'
              else '90+' end,
         null::numeric
  from fa a
  where a.gross - a.applied_amt > 0
  union all
  select 'advance'::text, o.id, o.number, o.company_id, null::uuid, null::text, null::date, null::numeric,
         null::numeric, null::numeric, null::int, null::text, pd.paid
  from paid pd
  join public.orders o on o.id = pd.ordid
  where pd.paid > 0
    and not exists (select 1 from inv i where i.ordid = pd.ordid)
$$;

-- ---------------------------------------------------------------- month_end_status (0058)
create or replace function public.month_end_status(p_month date)
returns table (check_key text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month)::date + interval '1 month')::date - 1 as m_end,
           to_char(p_month, 'YYYY-MM') as period
  ),
  frozen as (
    select (e ->> 'check_key')::text as check_key, (e ->> 'n')::int as n
    from public.month_snapshots s
    cross join b
    cross join lateral jsonb_array_elements(s.status) e
    where s.month = b.m_start
  ),
  checks as (
    select 'bank_unticked'::text as check_key,
           ((select count(*) from public.payments_in p, b
             where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end
               and p.voided_at is null)
          + (select count(*) from public.expenses e, b
             where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end))::int as n
    union all
    select 'fbr_deposits_unticked',
           (select count(*) from public.invoices v, b
            where v.tax_deposited_on <= b.m_end and v.tax_bank_month is null)::int
    union all
    select 'uncategorised',
           (select count(*) from public.expenses e
            join public.expense_categories c on c.id = e.category_id, b
            where e.paid_on between b.m_start and b.m_end
              and ((c.id = 'ca7e0000-0000-4000-8000-000000000010' and nullif(btrim(e.description), '') is null)
                or (c.grp = 'order_cost' and e.order_id is null)
                or 'category_unmapped' = any (e.legacy_flags)))::int
    union all
    select 'recurring_not_recorded',
           (select count(*) from public.recurring_expenses r, b
            where r.active
              and (r.start_month is null or r.start_month <= b.period)
              and not exists (select 1 from public.expenses e where e.recurring_id = r.id and e.period = b.period))::int
    union all
    select 'provisional_margins',
           (select count(*) from public.orders o
            join public.v_order_basis ob on ob.order_id = o.id
            left join public.order_costs oc on oc.order_id = o.id, b
            where o.cancelled_on is null
              and oc.costs_complete_at is null
              and ob.g > 0
              and (select coalesce(sum(p.amount), 0) from public.payments_in p
                   where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null) >= ob.g - 1)::int
    union all
    select 'fbr_pending',
           (select count(*) from public.invoices v, b
            where v.invoice_date <= b.m_end and v.tax_deposited_on is null and v.gst_amount > 0)::int
    union all
    select 'unresolved_payments',
           (select count(*) from public.v_payment_net p, b
            where p.received_on between b.m_start and b.m_end
              and p.excluded_reason in ('basis_unknown', 'zero_value'))::int
  )
  select f.check_key, f.n from frozen f
  where public.current_user_role() = 'admin'
  union all
  select c.check_key, c.n from checks c
  where public.current_user_role() = 'admin'
    and not exists (select 1 from frozen)
$$;

-- ---------------------------------------------------------------- month_end_check_details (0064)
create or replace function public.month_end_check_details(p_month date)
returns table (check_key text, detail jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month)::date + interval '1 month')::date - 1 as m_end,
           to_char(p_month, 'YYYY-MM') as period
  ),
  bank_in as (
    select p.amount, p.received_on from public.payments_in p, b
    where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end
      and p.voided_at is null
  ),
  bank_out as (
    select e.amount_pkr as amount, e.paid_on from public.expenses e, b
    where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end
  ),
  prior as (
    select bi.received_on as d from bank_in bi, b where bi.received_on < b.m_start
    union all
    select bo.paid_on from bank_out bo, b where bo.paid_on < b.m_start
  ),
  deposits as (
    select r.invoice_id, coalesce(r.tax_deposit_amount, r.gst_amount) as amount, coalesce(r.psid, r.invoice_id::text) as grp
    from public.v_gst_register r, b
    where r.tax_deposited_on <= b.m_end
      and exists (select 1 from public.invoices v where v.id = r.invoice_id and v.tax_bank_month is null)
  ),
  uncat as (
    select e.amount_pkr as amount
    from public.expenses e
    join public.expense_categories c on c.id = e.category_id, b
    where e.paid_on between b.m_start and b.m_end
      and ((c.id = 'ca7e0000-0000-4000-8000-000000000010' and nullif(btrim(e.description), '') is null)
        or (c.grp = 'order_cost' and e.order_id is null)
        or 'category_unmapped' = any (e.legacy_flags))
  ),
  rec_all as (
    select r.id, r.label from public.recurring_expenses r, b
    where r.active and (r.start_month is null or r.start_month <= b.period)
  ),
  rec_missing as (
    select ra.label from rec_all ra, b
    where not exists (select 1 from public.expenses e where e.recurring_id = ra.id and e.period = b.period)
  ),
  prov as (
    select o.number
    from public.orders o
    join public.v_order_basis ob on ob.order_id = o.id
    left join public.order_costs oc on oc.order_id = o.id, b
    where o.cancelled_on is null
      and oc.costs_complete_at is null
      and ob.g > 0
      and (select coalesce(sum(p.amount), 0) from public.payments_in p
           where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null) >= ob.g - 1
  ),
  pending as (
    select r.number, r.invoice_date, r.gst_amount
    from public.v_gst_register r, b
    where r.invoice_date <= b.m_end and r.tax_deposited_on is null
  ),
  unres as (
    select p.payment_id, p.order_id, o.number as order_number, p.amount, pi.reference
    from public.v_payment_net p
    join public.orders o on o.id = p.order_id
    join public.payments_in pi on pi.id = p.payment_id, b
    where p.received_on between b.m_start and b.m_end
      and p.excluded_reason in ('basis_unknown', 'zero_value')
  ),
  details as (
    select 'bank_unticked'::text as check_key,
           jsonb_build_object(
             'in_n', (select count(*) from bank_in),
             'in_amount', (select coalesce(sum(amount), 0) from bank_in),
             'out_n', (select count(*) from bank_out),
             'out_amount', (select coalesce(sum(amount), 0) from bank_out),
             'prior_n', (select count(*) from prior),
             'prior_first', (select to_char(min(d), 'YYYY-MM') from prior),
             'prior_last', (select to_char(max(d), 'YYYY-MM') from prior)) as detail
    union all
    select 'fbr_deposits_unticked',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from deposits),
             'groups', (select count(distinct grp) from deposits))
    union all
    select 'uncategorised',
           jsonb_build_object('amount', (select coalesce(sum(amount), 0) from uncat))
    union all
    select 'recurring_not_recorded',
           jsonb_build_object(
             'total', (select count(*) from rec_all),
             'names', coalesce((select jsonb_agg(label) from (select label from rec_missing order by label limit 3) x), '[]'::jsonb))
    union all
    select 'provisional_margins',
           jsonb_build_object(
             'numbers', coalesce((select jsonb_agg(number) from (select number from prov order by number desc limit 3) x), '[]'::jsonb))
    union all
    select 'fbr_pending',
           jsonb_build_object(
             'amount', (select coalesce(sum(gst_amount), 0) from pending),
             'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'month', to_char(invoice_date, 'YYYY-MM')))
                                   from (select number, invoice_date from pending order by invoice_date desc, number limit 3) x), '[]'::jsonb))
    union all
    select 'unresolved_payments',
           jsonb_build_object(
             'amount', (select coalesce(sum(amount), 0) from unres),
             'orders', (select count(distinct order_id) from unres),
             'first', (select jsonb_build_object('order_id', order_id, 'order_number', order_number, 'reference', reference)
                       from unres order by amount desc, payment_id limit 1))
  )
  select d.check_key, d.detail from details d
  where public.current_user_role() = 'admin'
$$;

-- ---------------------------------------------------------------- money_exceptions_input (0066)
create or replace function public.money_exceptions_input()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    return null;
  end if;
  return (
    with
    ord as (
      select o.id, o.number, o.ordered_on, o.cancelled_on,
             ('value_basis_unknown' = any (coalesce(o.legacy_flags, '{}'))) as basis_unknown
      from public.orders o
    ),
    mon as (
      select m.order_id, m.gross_target, m.settled, m.expected_cost, m.actual_cost,
             (coalesce(m.costs_state, '') = 'complete') as costs_complete,
             b.invoice_count, b.invoice_gross, b.items_net, b.items_gross
      from public.v_order_money m
      left join public.v_order_basis b on b.order_id = m.order_id
      where m.order_id is not null
    ),
    fo as (
      select o.id
      from ord o
      left join mon m on m.order_id = o.id
      where o.basis_unknown
         or (o.cancelled_on is null and m.order_id is not null and (
               coalesce(m.settled, 0) - coalesce(m.gross_target, 0) > 0.5
            or (coalesce(m.invoice_count, 0) > 0 and coalesce(m.invoice_gross, 0) - coalesce(m.items_gross, 0) > 0.5)
            or (m.expected_cost is not null and coalesce(m.actual_cost, 0) - m.expected_cost > 0.5)
            or (not m.costs_complete and coalesce(m.gross_target, 0) > 0
                and coalesce(m.settled, 0) >= coalesce(m.gross_target, 0) - 1.5)))
    ),
    fp as (
      select p.id, p.order_id, p.amount, p.received_on
      from public.payments_in p
      left join ord o on o.id = p.order_id
      where p.voided_at is null
        and (p.amount <= 0 or o.cancelled_on is not null or p.received_on < o.ordered_on)
    ),
    fe as (
      select e.id, e.order_id, e.supplier_order_id, e.paid_on,
             coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0) as cost
      from public.expenses e
      left join ord o on o.id = e.order_id
      where coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0) < 0 or e.paid_on < o.ordered_on
    ),
    lp as (
      select e.supplier_order_id as leg_id, sum(coalesce(e.amount_pkr, 0) - coalesce(e.input_tax_pkr, 0)) as paid
      from public.expenses e
      where e.supplier_order_id is not null
      group by e.supplier_order_id
    ),
    po as (
      select distinct on (p.supplier_order_id) p.supplier_order_id as leg_id, coalesce(p.total, 0) as total, btrim(p.currency) as currency
      from public.purchase_orders p
      order by p.supplier_order_id, p.revision desc
    ),
    fpo as (
      select po.leg_id, po.total, po.currency, coalesce(lp.paid, 0) as paid
      from po
      left join lp on lp.leg_id = po.leg_id
      where po.currency = 'PKR' and coalesce(lp.paid, 0) - po.total > 0.5
    ),
    legs as (
      select so.id, so.order_id, so.placed_on, so.expected_on, so.received_on, so.delivered_on, btrim(so.currency) as currency,
             'leg ' || chr(64 + (row_number() over (partition by so.order_id order by so.created_at, so.id))::int) as label
      from public.supplier_orders so
    ),
    fl as (
      select l.*
      from legs l
      where l.expected_on < l.placed_on or l.delivered_on < l.placed_on
         or l.id in (select f.leg_id from fpo f)
    ),
    fi as (
      select g.id, g.number, g.order_id, g.invoice_date, g.net_amount, g.gst_amount, g.copy_received_on, g.tcs_sent_on,
             g.client_received_on, g.tax_deposited_on, (cardinality(coalesce(g.legacy_flags, '{}')) > 0) as legacy
      from public.invoices g
      left join ord o on o.id = g.order_id
      left join mon m on m.order_id = g.order_id
      where g.net_amount < 0 or g.gst_amount < 0
         or g.gst_amount > g.net_amount + 0.5
         or (g.net_amount > 0 and (
               case
                 when coalesce(m.items_net, 0) > 0 then
                   (g.net_amount * (m.items_gross - m.items_net) / m.items_net > 0
                    and abs(g.gst_amount - g.net_amount * (m.items_gross - m.items_net) / m.items_net)
                        / (g.net_amount * (m.items_gross - m.items_net) / m.items_net) > 0.01)
                   or (g.net_amount * (m.items_gross - m.items_net) / m.items_net <= 0 and g.gst_amount > 0.5)
                 else abs(g.gst_amount - g.net_amount * 0.18) / (g.net_amount * 0.18) > 0.01
               end))
         or (g.order_id is not null and o.id is null)
         or g.invoice_date < o.ordered_on
         or g.copy_received_on > g.tcs_sent_on
         or g.tcs_sent_on > g.client_received_on
         or g.copy_received_on > g.client_received_on
         or g.tax_deposited_on < g.invoice_date
    ),
    need as (
      select id from fo
      union select order_id from fp
      union select order_id from fe where order_id is not null
      union select order_id from fl
      union select order_id from fi where order_id is not null
    ),
    out_orders as (select o.* from ord o where o.id in (select n.id from need n))
    select jsonb_build_object(
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', o.id, 'number', o.number, 'orderedOn', o.ordered_on, 'cancelled', o.cancelled_on is not null,
          'basisUnknown', o.basis_unknown)) from out_orders o), '[]'::jsonb),
      'money', coalesce((select jsonb_agg(jsonb_build_object(
          'orderId', m.order_id, 'grossTarget', coalesce(m.gross_target, 0), 'settled', coalesce(m.settled, 0),
          'itemsNet', coalesce(m.items_net, 0), 'itemsGross', coalesce(m.items_gross, 0),
          'invoiceCount', coalesce(m.invoice_count, 0), 'invoiceGross', coalesce(m.invoice_gross, 0),
          'expectedCost', m.expected_cost, 'actualCost', coalesce(m.actual_cost, 0), 'costsComplete', m.costs_complete))
        from mon m where m.order_id in (select oo.id from out_orders oo)), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'orderId', p.order_id, 'amount', p.amount, 'receivedOn', p.received_on)) from fp p), '[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object(
          'id', e.id, 'orderId', e.order_id, 'legId', e.supplier_order_id, 'cost', e.cost, 'paidOn', e.paid_on)) from fe e), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'number', g.number, 'orderId', g.order_id, 'invoiceDate', g.invoice_date,
          'net', g.net_amount, 'gst', g.gst_amount, 'copyReceivedOn', g.copy_received_on, 'tcsSentOn', g.tcs_sent_on,
          'clientReceivedOn', g.client_received_on, 'taxDepositedOn', g.tax_deposited_on, 'legacy', g.legacy)) from fi g), '[]'::jsonb),
      'legs', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'orderId', l.order_id, 'label', l.label, 'placedOn', l.placed_on, 'expectedOn', l.expected_on,
          'receivedOn', l.received_on, 'deliveredOn', l.delivered_on, 'currency', l.currency)) from fl l), '[]'::jsonb),
      'pos', coalesce((select jsonb_agg(jsonb_build_object(
          'legId', p.leg_id, 'total', p.total, 'currency', p.currency)) from fpo p), '[]'::jsonb),
      'legPaid', coalesce((select jsonb_agg(jsonb_build_object('legId', p.leg_id, 'paid', p.paid)) from fpo p), '[]'::jsonb)
    )
  );
end;
$$;
