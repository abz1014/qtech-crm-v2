-- 0020_stamp_rpcs (S13, part 2): the stamp functions behind the "Copy ..." actions and the monthly batch
-- steps. DATA_MODEL section 4 (Amendment A2) and Amendment A3-4.
--
-- All SECURITY INVOKER with search_path = '': the caller's row security decides which rows can change.
-- Money-role checks are repeated inside the functions that touch invoices, because row security would
-- otherwise answer an engineer with a silent "0 rows" instead of a refusal.
--
-- Entry burden: dates are today in Karachi. Batch functions take a set of invoice ids and return how many rows
-- they changed; with one id they are the single-invoice stamp. Date stamps never overwrite a date that is
-- already set, so a double tap or a re-run of a month's batch changes nothing.

-- ---------------------------------------------------------------- stamp_clarification_ask
-- "Copy questions for customer": first_asked_at if empty, last_asked_at = now, ask_count + 1. Only open
-- questions are stamped; answered or withdrawn ones in the set are skipped. Returns the number stamped.
create function public.stamp_clarification_ask(p_clarification_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.clarifications c
  set first_asked_at = coalesce(c.first_asked_at, now()),
      last_asked_at  = now(),
      ask_count      = c.ask_count + 1
  where c.id = any (coalesce(p_clarification_ids, '{}'::uuid[]))
    and c.answered_at is null
    and c.withdrawn_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.stamp_clarification_ask(uuid[]) from public, anon, authenticated;
grant execute on function public.stamp_clarification_ask(uuid[]) to authenticated;

-- ---------------------------------------------------------------- stamp_supplier_chase
-- "Copy chase text": last_chased_on = today, chase_count + 1. Returns the new count (Today suggests floating
-- elsewhere after 2). An unknown or invisible inquiry is an error, not a silent no-op.
create function public.stamp_supplier_chase(p_inquiry_id uuid)
returns smallint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count smallint;
begin
  update public.supplier_inquiries i
  set last_chased_on = public.today_pkt(),
      chase_count    = i.chase_count + 1
  where i.id = p_inquiry_id
  returning i.chase_count into v_count;
  if not found then
    raise exception 'inquiry % not found', p_inquiry_id using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

revoke all on function public.stamp_supplier_chase(uuid) from public, anon, authenticated;
grant execute on function public.stamp_supplier_chase(uuid) to authenticated;

-- ---------------------------------------------------------------- stamp_payment_reminder (admin, sales)
-- "Copy payment reminder": last_reminded_on = today, reminder_count + 1 on each invoice listed.
create function public.stamp_payment_reminder(p_invoice_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('admin', 'sales') then
    raise exception 'payment reminders are for admin and sales only' using errcode = '42501';
  end if;
  update public.invoices v
  set last_reminded_on = public.today_pkt(),
      reminder_count   = v.reminder_count + 1
  where v.id = any (coalesce(p_invoice_ids, '{}'::uuid[]));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.stamp_payment_reminder(uuid[]) from public, anon, authenticated;
grant execute on function public.stamp_payment_reminder(uuid[]) to authenticated;

-- ---------------------------------------------------------------- stamp_tcs_sent (admin, sales)
-- TCS track "sent by TCS today" for a set of invoices. p_tcs_number (optional) is the consignment number, set on
-- the same invoices when given. Invoices already stamped keep their date. p_on is for a catch-up; it defaults to today.
create function public.stamp_tcs_sent(p_invoice_ids uuid[], p_tcs_number text default null, p_on date default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('admin', 'sales') then
    raise exception 'TCS stamping is for admin and sales only' using errcode = '42501';
  end if;
  update public.invoices v
  set tcs_sent_on = coalesce(p_on, public.today_pkt()),
      tcs_number  = coalesce(nullif(btrim(p_tcs_number), ''), v.tcs_number)
  where v.id = any (coalesce(p_invoice_ids, '{}'::uuid[]))
    and v.tcs_sent_on is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.stamp_tcs_sent(uuid[], text, date) from public, anon, authenticated;
grant execute on function public.stamp_tcs_sent(uuid[], text, date) to authenticated;

-- ---------------------------------------------------------------- stamp_fbr_psid (admin, sales)
-- FBR track: one pasted PSID for the whole batch. The PSID is an explicit value, so it replaces an earlier one
-- (the way to fix a typo); a blank PSID is refused.
create function public.stamp_fbr_psid(p_invoice_ids uuid[], p_psid text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('admin', 'sales') then
    raise exception 'FBR stamping is for admin and sales only' using errcode = '42501';
  end if;
  if nullif(btrim(p_psid), '') is null then
    raise exception 'a PSID is required' using errcode = '22023';
  end if;
  update public.invoices v
  set psid = btrim(p_psid)
  where v.id = any (coalesce(p_invoice_ids, '{}'::uuid[]));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.stamp_fbr_psid(uuid[], text) from public, anon, authenticated;
grant execute on function public.stamp_fbr_psid(uuid[], text) to authenticated;

-- ---------------------------------------------------------------- stamp_tax_deposited (admin, sales)
-- FBR track "deposited today": tax_deposited_on = today (or p_on), and tax_deposit_amount = gst_amount when it
-- is still empty (Amendment A3-4). An invoice already stamped as deposited is left untouched.
create function public.stamp_tax_deposited(p_invoice_ids uuid[], p_on date default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('admin', 'sales') then
    raise exception 'FBR stamping is for admin and sales only' using errcode = '42501';
  end if;
  update public.invoices v
  set tax_deposited_on   = coalesce(p_on, public.today_pkt()),
      tax_deposit_amount = coalesce(v.tax_deposit_amount, v.gst_amount)
  where v.id = any (coalesce(p_invoice_ids, '{}'::uuid[]))
    and v.tax_deposited_on is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.stamp_tax_deposited(uuid[], date) from public, anon, authenticated;
grant execute on function public.stamp_tax_deposited(uuid[], date) to authenticated;
