-- 0114_duplicate_payment_fx_typo (money-integrity audit M4, M7): two typing slips caught on the server, each answered with a
-- specific error the screen turns into a "Record it anyway?" / "Use this rate?" confirm.
--
--   M4. record_payment(): the one door for a new customer payment. When the same customer already has a live (not voided) payment
--       with the same amount on the same day, or the same non-empty reference (ignoring capitals and spaces), it raises P0001
--       with HINT 'duplicate_payment' and the earlier date in DETAIL ("Looks like a payment already recorded on 3 Oct 2026.")
--       unless p_confirm_duplicate is true. The screen asks, and calls again with the confirm.
--   M7. set_fx_rate() gets p_confirm. A manual rate more than 20% away from the latest rate of that currency raises P0001 with
--       HINT 'fx_rate_far' and the latest rate in DETAIL unless p_confirm is true. Nothing is checked when the currency has no
--       rate yet.
--
-- Expand-only: record_payment is new (the table insert still works for the importer and fixtures); set_fx_rate gains a last
-- parameter with a default, so a call without it is the call it was (the old three-argument function is replaced, not kept,
-- or the two would be ambiguous). Both stay admin only / staff as before.

-- ================================================================ M4
create function public.record_payment(
  p_id uuid, p_order_id uuid, p_received_on date, p_amount numeric,
  p_reference text default null, p_paid_via text default 'bank', p_confirm_duplicate boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company uuid;
  v_dup     date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin records a payment.' using errcode = '42501', hint = 'admin_only';
  end if;
  select o.company_id into v_company from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'This order is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if not coalesce(p_confirm_duplicate, false) then
    select p.received_on into v_dup
    from public.payments_in p
    join public.orders o on o.id = p.order_id
    where p.voided_at is null
      and o.company_id = v_company
      and p.id <> p_id
      and ((p.amount = p_amount and p.received_on = p_received_on)
           or (nullif(btrim(p_reference), '') is not null and lower(btrim(p.reference)) = lower(btrim(p_reference))))
    order by (p.amount = p_amount and p.received_on = p_received_on) desc, p.received_on desc
    limit 1;
    if found then
      raise exception 'Looks like a payment already recorded on %.', to_char(v_dup, 'FMDD Mon YYYY')
        using errcode = 'P0001', hint = 'duplicate_payment', detail = v_dup::text;
    end if;
  end if;
  insert into public.payments_in (id, order_id, received_on, amount, reference, paid_via)
  values (p_id, p_order_id, p_received_on, p_amount, nullif(btrim(p_reference), ''), coalesce(p_paid_via, 'bank'));
end;
$$;

revoke all on function public.record_payment(uuid, uuid, date, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_payment(uuid, uuid, date, numeric, text, text, boolean) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ================================================================ M7
drop function public.set_fx_rate(text, numeric, date);

create function public.set_fx_rate(p_currency text, p_rate_pkr numeric, p_as_of date default null, p_confirm boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id     uuid;
  v_cur    text := upper(btrim(p_currency));
  v_latest numeric;
begin
  if not coalesce(p_confirm, false) and p_rate_pkr > 0 then
    select r.rate_pkr into v_latest
    from public.fx_rates r
    where r.currency = v_cur and r.as_of <= public.today_pkt()
    order by r.as_of desc, (r.source = 'manual') desc
    limit 1;
    if v_latest is not null and v_latest > 0 and abs(p_rate_pkr - v_latest) / v_latest > 0.20 then
      raise exception 'Rs % for 1 % is more than 20 percent away from the latest rate (Rs %). Check it for a typing slip.',
        to_char(p_rate_pkr, 'FM999,999,990.00####'), v_cur, to_char(v_latest, 'FM999,999,990.00####')
        using errcode = 'P0001', hint = 'fx_rate_far', detail = v_latest::text;
    end if;
  end if;
  insert into public.fx_rates (currency, rate_pkr, as_of, source)
  values (v_cur, p_rate_pkr, coalesce(p_as_of, public.today_pkt()), 'manual')
  on conflict (currency, as_of, source) do update set rate_pkr = excluded.rate_pkr
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.set_fx_rate(text, numeric, date, boolean) from public, anon, authenticated;
grant execute on function public.set_fx_rate(text, numeric, date, boolean) to authenticated;
