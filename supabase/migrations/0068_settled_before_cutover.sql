-- 0068_settled_before_cutover (owner decision 2026-10-19, import): an old invoice that was paid before the new system but
-- has no order is "settled before cutover".
--
-- The legacy import turns the old paid status into payments_in rows. A payment needs an order (payments_in.order_id is
-- NOT NULL), and most old GST-register invoices have only a company (invoices_order_or_company, 0010). Those paid
-- invoices used to stay open for ever in "who owes us". The decision: no fake orders, no fake bank payments. The invoice
-- carries settled_before_cutover = true and every money figure that asks "what is still open on this invoice" treats it as
-- fully received: open balance 0, never overdue, never reminded.
--
--   invoices.settled_before_cutover   boolean, default false. True only on an imported row (legacy_source set) with no
--                                     order (order_id NULL), by CHECK. Written by the import (service role) only: a
--                                     signed-in person can neither insert it true nor change it (trigger below, the
--                                     0065 pattern: current_user = 'authenticated' is limited, the service role is not).
--   aging_as_of()                     same columns; a settled invoice is fully applied, so it is never a row ("who owes us",
--                                     the month-end aging report and its snapshot).
--   stamp_payment_reminder()          same signature; skips a settled invoice (nothing to remind).
--
-- Unchanged on purpose: the GST register, v_gst_month and every FBR/tax view (the invoice is still a sale and its GST is
-- output tax), bank and cash figures (no cash row exists), order_receivables() and v_order_money (they work per order,
-- and a settled invoice has no order, by the CHECK; linking one to an order is refused by that CHECK).

-- ---------------------------------------------------------------- the column
alter table public.invoices
  add column settled_before_cutover boolean not null default false,
  add constraint invoices_settled_before_cutover_legacy check (
    not settled_before_cutover or (legacy_source is not null and order_id is null)
  );

comment on column public.invoices.settled_before_cutover is
  'Owner decision 2026-10-19: an imported invoice with no order that the old system (or the owner) marks paid. Fully received '
  'before the new system: open balance 0, not overdue, not remindable. Still a sale and output GST. Import (service role) only.';

-- ---------------------------------------------------------------- only the import may set it
create function public.guard_invoice_settled_before_cutover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.settled_before_cutover then
      raise exception 'settled before cutover is set by the legacy import only' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.settled_before_cutover is distinct from old.settled_before_cutover then
    raise exception 'settled before cutover is set by the legacy import only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_settled_before_cutover() from public, anon, authenticated;

create trigger invoices_guard_settled_before_cutover before insert or update on public.invoices
  for each row execute function public.guard_invoice_settled_before_cutover();

-- ---------------------------------------------------------------- aging_as_of
-- 0028 with one change: a settled-before-cutover invoice is left out (fully applied, nothing remains). It has no order,
-- so the FIFO of every order is untouched.
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

-- ---------------------------------------------------------------- stamp_payment_reminder
-- 0020 with one change: a settled-before-cutover invoice is never stamped (it is not remindable).
create or replace function public.stamp_payment_reminder(p_invoice_ids uuid[])
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
  where v.id = any (coalesce(p_invoice_ids, '{}'::uuid[]))
    and not v.settled_before_cutover;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- (grants of 0020 and 0028 are kept by create or replace)
