-- 0117_customer_refunds (owner request 2026-10-30): money handed back to a customer, and where it shows.
--
-- Today an overpayment only shows as overpaid_by in the views. This migration adds the refund record and puts it in the cash
-- figures and the books; 0118 adds the customer credit balance and applying credit, 0119 the WHT certificate file and the
-- rule on clearing a filing.
--
--   customer_refunds     one row per refund: company, optional order, amount PKR, refunded_on, paid_via (bank | cash, as payments_in),
--                        reference, reason, bank_month (the bank tick, as payments_in). Admin only. It is cash OUT. Rows are made by
--                        record_refund() (0118), the one door that checks the customer has the credit; the table gives the API no
--                        INSERT. The audit trigger records every row; a refund is removed by deleting it (admin, open month).
--   credit_applications  credit of a customer put against another order of the same customer (0118 makes the rows): not a payment,
--                        no cash moves. It settles the target order the way a payment would (0118).
--   The month lock       enforce_month_lock covers both tables (by refunded_on / applied_on); close_month and close_months_through
--                        lock them (in the 0115 order: credit_applications, credit_notes, customer_refunds, ...) and count them
--                        in the "earlier months first" check.
--   Cash figures         v_cash_month and v_month_cash_flow get refunds_out (and refunds_count) at the END: money_out stays the
--                        expenses, so the expense report's cross-check with In vs out is what it was. cash_in_hand() counts
--                        refunds paid in cash as cash out of the box. The bank tick covers refunds (month end counts them).
--
-- Expand-only: two tables, columns added at the end of two views, longer bodies of cash_in_hand, month_end_status,
-- month_end_check_details, enforce_month_lock, close_month and close_months_through. Nothing existing changes meaning for a
-- month with no refund.

-- ================================================================ tables
create table public.customer_refunds (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users (id) on delete restrict,
  company_id   uuid not null references public.companies (id) on delete restrict,
  order_id     uuid references public.orders (id) on delete restrict,
  refunded_on  date not null default public.today_pkt(),
  amount       numeric(14,2) not null check (amount > 0 and amount < 100000000),
  paid_via     text not null default 'bank' check (paid_via in ('bank', 'cash')),
  reference    text check (char_length(reference) <= 120),
  reason       text check (char_length(reason) <= 300),
  bank_month   date,
  constraint customer_refunds_bank_month_first_day check (bank_month is null or extract(day from bank_month) = 1),
  constraint customer_refunds_bank_month_needs_bank check (bank_month is null or paid_via = 'bank')
);

comment on table public.customer_refunds is
  '0117: money paid back to a customer (cash OUT). Made by record_refund(); bank_month is the bank tick. Admin only.';

create index customer_refunds_company_idx on public.customer_refunds (company_id);
create index customer_refunds_order_idx on public.customer_refunds (order_id) where order_id is not null;
create index customer_refunds_refunded_idx on public.customer_refunds (refunded_on);

create table public.credit_applications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  company_id  uuid not null references public.companies (id) on delete restrict,
  to_order_id uuid not null references public.orders (id) on delete restrict,
  applied_on  date not null default public.today_pkt(),
  amount      numeric(14,2) not null check (amount > 0 and amount < 100000000),
  note        text check (char_length(note) <= 300)
);

comment on table public.credit_applications is
  '0117: credit a customer already holds (overpayments and credit notes not refunded) put against another order of the same customer. '
  'Not a payment: no cash moves. It counts as settled money on to_order_id (0118). Made by apply_credit(). Admin only.';

create index credit_applications_company_idx on public.credit_applications (company_id);
create index credit_applications_order_idx on public.credit_applications (to_order_id);
create index credit_applications_applied_idx on public.credit_applications (applied_on);

-- Structure only (the credit checks are in record_refund / apply_credit). A refund's order must be the customer's own; an application
-- is stored with the customer of its order. Afterwards only the bank tick (refunds) and the customer (merge_companies) change.
create function public.customer_money_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if tg_op = 'DELETE' then
    -- like a payment (delete_payment, 0092): a refund ticked against a bank statement is unticked first
    if old.bank_month is not null then
      raise exception 'This refund is ticked against the % bank statement. Untick it first, then delete it.', to_char(old.bank_month, 'FMMonth YYYY')
        using errcode = 'P0001', hint = 'bank_ticked';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'customer_refunds' then
      if (to_jsonb(new) - 'company_id' - 'bank_month') is distinct from (to_jsonb(old) - 'company_id' - 'bank_month') then
        raise exception 'A refund is kept as it was recorded. Delete it and record it again to correct it.'
          using errcode = 'P0001', hint = 'refund_kept';
      end if;
    elsif (to_jsonb(new) - 'company_id') is distinct from (to_jsonb(old) - 'company_id') then
      raise exception 'An applied credit is kept as it was recorded. Delete it and apply it again to correct it.'
        using errcode = 'P0001', hint = 'application_kept';
    end if;
    return new;
  end if;
  if tg_table_name = 'customer_refunds' then
    if new.order_id is not null then
      select o.company_id into v_company from public.orders o where o.id = new.order_id;
      if v_company is distinct from new.company_id then
        raise exception 'That order belongs to another customer.' using errcode = 'P0001', hint = 'order_company';
      end if;
    end if;
    new.reference := nullif(btrim(new.reference), '');
    new.reason := nullif(btrim(new.reason), '');
  else
    select o.company_id into v_company from public.orders o where o.id = new.to_order_id;
    if v_company is null then
      raise exception 'This order is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
    end if;
    if new.company_id is not null and new.company_id is distinct from v_company then
      raise exception 'That order belongs to another customer.' using errcode = 'P0001', hint = 'order_company';
    end if;
    new.company_id := v_company;
    new.note := nullif(btrim(new.note), '');
  end if;
  return new;
end;
$$;

revoke all on function public.customer_money_guard() from public, anon, authenticated;

create trigger customer_refunds_guard before insert or update or delete on public.customer_refunds
  for each row execute function public.customer_money_guard();
create trigger credit_applications_guard before insert or update on public.credit_applications
  for each row execute function public.customer_money_guard();
create trigger customer_refunds_force_created_by before insert or update on public.customer_refunds
  for each row execute function public.force_created_by();
create trigger credit_applications_force_created_by before insert or update on public.credit_applications
  for each row execute function public.force_created_by();
create trigger customer_refunds_audit after insert or update or delete on public.customer_refunds
  for each row execute function public.audit_row_change();
create trigger credit_applications_audit after insert or update or delete on public.credit_applications
  for each row execute function public.audit_row_change();

alter table public.customer_refunds enable row level security;
alter table public.credit_applications enable row level security;
revoke all on table public.customer_refunds, public.credit_applications from public, anon, authenticated;
-- 0081 mirror: granted like every table; the policies admit the admin only. No INSERT: the rows are made by the two RPCs (0118).
grant select, delete on table public.customer_refunds, public.credit_applications to authenticated, qtech_engineer;
grant update (bank_month, company_id) on table public.customer_refunds to authenticated, qtech_engineer;   -- the bank tick; merge_companies
grant update (company_id) on table public.credit_applications to authenticated, qtech_engineer;            -- merge_companies only

create policy customer_refunds_select on public.customer_refunds for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy customer_refunds_update on public.customer_refunds for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy customer_refunds_delete on public.customer_refunds for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy credit_applications_select on public.credit_applications for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy credit_applications_update on public.credit_applications for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy credit_applications_delete on public.credit_applications for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');

-- ================================================================ the month lock
do $do$
declare
  def     text;
  patched text;
  a1      text := 'else  -- invoices';
  r1      text := $r$elsif tg_table_name = 'customer_refunds' then
    if tg_op <> 'INSERT' then v_old := old.refunded_on; end if;
    if tg_op <> 'DELETE' then v_new := new.refunded_on; end if;
  elsif tg_table_name = 'credit_applications' then
    if tg_op <> 'INSERT' then v_old := old.applied_on; end if;
    if tg_op <> 'DELETE' then v_new := new.applied_on; end if;
  else  -- invoices$r$;
begin
  def := pg_catalog.pg_get_functiondef('public.enforce_month_lock()'::regprocedure);
  if strpos(def, a1) = 0 then
    raise exception '0117: the month lock function was not in the expected shape';
  end if;
  patched := replace(def, a1, r1);
  execute patched;

  -- close_month and close_months_through: the lock list (same fixed order, alphabetical) and the "earlier months" union
  foreach def in array array[
    pg_catalog.pg_get_functiondef('public.close_month(date)'::regprocedure),
    pg_catalog.pg_get_functiondef('public.close_months_through(date)'::regprocedure)] loop
    if strpos(def, 'public.credit_notes, public.expenses,') = 0
       or strpos(def, 'select date_trunc(''month'', issued_on)::date from public.credit_notes') = 0 then
      raise exception '0117: a close function was not in the expected shape';
    end if;
    patched := replace(def, 'public.credit_notes, public.expenses,', 'public.credit_applications, public.credit_notes, public.customer_refunds, public.expenses,');
    patched := replace(patched, 'select date_trunc(''month'', issued_on)::date from public.credit_notes',
      'select date_trunc(''month'', issued_on)::date from public.credit_notes
    union
    select date_trunc(''month'', refunded_on)::date from public.customer_refunds
    union
    select date_trunc(''month'', applied_on)::date from public.credit_applications');
    execute patched;
  end loop;
end
$do$;

create trigger customer_refunds_month_lock before insert or delete on public.customer_refunds
  for each row execute function public.enforce_month_lock();
create trigger credit_applications_month_lock before insert or delete on public.credit_applications
  for each row execute function public.enforce_month_lock();

-- ================================================================ cash figures
-- v_cash_month: refunds_out at the end. money_out stays the expenses.
create or replace view public.v_cash_month with (security_invoker = true) as
with money_in as (
  select
    date_trunc('month', received_on)::date as month,
    sum(amount)                                                        as gross_received,
    sum(gst_portion) filter (where counts_in_cash_net)                 as gst_received,
    sum(net_portion) filter (where counts_in_cash_net)                 as net_received,
    sum(amount) filter (where excluded_reason in ('basis_unknown', 'zero_value')) as unresolved_gross,
    count(*) filter (where excluded_reason in ('basis_unknown', 'zero_value'))    as unresolved_count
  from public.v_payment_net
  group by 1
),
money_out as (
  select date_trunc('month', paid_on)::date as month, sum(amount_pkr) as money_out
  from public.expenses
  group by 1
),
refunds as (
  select date_trunc('month', refunded_on)::date as month, sum(amount) as refunds_out
  from public.customer_refunds
  group by 1
),
months as (
  select i.month from money_in i union select o.month from money_out o union select f.month from refunds f
)
select
  m.month,
  coalesce(i.gross_received, 0)    as gross_received,
  coalesce(i.gst_received, 0)      as gst_received,
  coalesce(i.net_received, 0)      as net_received,
  coalesce(i.unresolved_gross, 0)  as unresolved_gross,
  coalesce(i.unresolved_count, 0)  as unresolved_count,
  coalesce(o.money_out, 0)         as money_out,
  coalesce(f.refunds_out, 0)       as refunds_out
from months m
left join money_in i on i.month = m.month
left join money_out o on o.month = m.month
left join refunds f on f.month = m.month
where (select public.current_user_role()) = 'admin';

comment on view public.v_cash_month is
  '0015, 0117: cash clocks per month: money in (payments by received_on), money out (expenses by paid_on) and refunds_out (customer refunds by refunded_on, cash out too). Admin only.';

-- v_month_cash_flow: refunds_out and refunds_count at the end. money_out stays the expenses (a closed month answers from its
-- snapshot); a refund is locked in a closed month, so refunds are always read live.
create or replace view public.v_month_cash_flow with (security_invoker = true) as
with live_in as (
  select date_trunc('month', p.received_on)::date as month, sum(p.amount) as money_in, count(*)::int as payments_count
  from public.payments_in p
  where p.voided_at is null
  group by 1
),
live_out as (
  select date_trunc('month', e.paid_on)::date as month, sum(e.amount_pkr) as money_out, count(*)::int as expenses_count
  from public.expenses e
  group by 1
),
live_refunds as (
  select date_trunc('month', r.refunded_on)::date as month, sum(r.amount) as refunds_out, count(*)::int as refunds_count
  from public.customer_refunds r
  group by 1
),
months as (
  select i.month from live_in i
  union
  select o.month from live_out o
  union
  select s.month from public.month_snapshots s
  union
  select f.month from live_refunds f
)
select
  k.month,
  case when s.month is not null
       then (s.pnl ->> 'net_in')::numeric + (s.pnl ->> 'gst_in')::numeric + (s.pnl ->> 'unresolved_gross')::numeric
       else coalesce(i.money_in, 0) end                                                         as money_in,
  case when s.month is not null then (s.payments ->> 'count')::int
       else coalesce(i.payments_count, 0) end                                                   as payments_count,
  case when s.month is not null then (s.pnl ->> 'cash_out_total')::numeric
       else coalesce(o.money_out, 0) end                                                        as money_out,
  case when s.month is not null then (s.via ->> 'cash_count')::int + (s.via ->> 'bank_count')::int
       else coalesce(o.expenses_count, 0) end                                                   as expenses_count,
  (s.month is not null)                                                                         as frozen,
  coalesce(f.refunds_out, 0)                                                                    as refunds_out,
  coalesce(f.refunds_count, 0)                                                                  as refunds_count
from months k
left join public.month_snapshots s on s.month = k.month
left join live_in i on i.month = k.month
left join live_out o on o.month = k.month
left join live_refunds f on f.month = k.month
where (select public.current_user_role()) = 'admin';

comment on view public.v_month_cash_flow is
  '0079, 0117: cash in vs out per month, gross, voided payments left out, every expense category; refunds_out is what was paid back to customers (not in money_out). A closed month answers from its snapshot. Admin only.';

-- cash_in_hand: refunds paid in cash leave the box like a cash expense (latest count + top-ups - cash expenses - cash refunds, since the count).
create or replace function public.cash_in_hand()
returns table (
  base_kind            text,
  base_on              date,
  base_at              timestamptz,
  base_pkr             numeric,
  topups_pkr           numeric,
  topup_count          integer,
  cash_out_pkr         numeric,
  cash_out_count       integer,
  expected_pkr         numeric,
  last_difference_pkr  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select c.counted_on, c.created_at, c.counted_pkr, c.is_opening, c.difference_pkr
    from public.cash_counts c
    order by c.counted_on desc, c.created_at desc
    limit 1
  ),
  t as (
    select coalesce(sum(x.amount_pkr), 0) as amt, count(*)::int as n
    from public.cash_topups x, b
    where x.drawn_on > b.counted_on or (x.drawn_on = b.counted_on and (b.is_opening or x.created_at > b.created_at))
  ),
  o as (
    select coalesce(sum(y.amt), 0) as amt, count(*)::int as n
    from (
      select e.amount_pkr as amt, e.paid_on as d, e.created_at as c from public.expenses e where e.paid_via = 'cash'
      union all
      select r.amount, r.refunded_on, r.created_at from public.customer_refunds r where r.paid_via = 'cash'
    ) y, b
    where y.d > b.counted_on or (y.d = b.counted_on and (b.is_opening or y.c > b.created_at))
  )
  select case when b.counted_on is null then 'none' when b.is_opening then 'opening' else 'count' end,
         b.counted_on, b.created_at, b.counted_pkr, t.amt, t.n, o.amt, o.n,
         case when b.counted_on is null then null else b.counted_pkr + t.amt - o.amt end,
         b.difference_pkr
  from (select 1) one
  left join b on true
  cross join t
  cross join o
  where public.current_user_role() = 'admin'
$$;

-- ================================================================ month end: the bank tick covers refunds

-- ---------------------------------------------------------------- public.month_end_status
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
             where e.paid_via = 'bank' and e.bank_month is null and e.paid_on <= b.m_end)
          + (select count(*) from public.customer_refunds r, b   -- 0117: a refund paid by bank is ticked too
             where r.paid_via = 'bank' and r.bank_month is null and r.refunded_on <= b.m_end))::int as n
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
              and (select coalesce(sum(p.amount + p.wht_amount), 0) from public.payments_in p
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

-- ---------------------------------------------------------------- public.month_end_check_details
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
    union all
    select r.amount, r.refunded_on from public.customer_refunds r, b   -- 0117: a refund paid by bank is money out on the statement
    where r.paid_via = 'bank' and r.bank_month is null and r.refunded_on <= b.m_end
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
      and (select coalesce(sum(p.amount + p.wht_amount), 0) from public.payments_in p
           where p.order_id = o.id and p.received_on <= b.m_end and p.voided_at is null) >= ob.g - 1
  ),
  pending as (
    select r.number, r.invoice_date, r.gst_amount
    from public.v_gst_register r, b
    where r.invoice_date <= b.m_end and r.tax_deposited_on is null and r.gst_amount > 0   -- 0074: the same predicate as month_end_status
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
  ),
  -- M11: a closed month answers with the details frozen at its close (the same moment as its counts). A month closed before
  -- 0076 has no frozen details: the live ones are returned marked "live": true so the screen can say so.
  frozen as (
    select (e ->> 'check_key')::text as check_key, e -> 'detail' as detail
    from public.month_snapshots s
    cross join b
    cross join lateral jsonb_array_elements(s.details) e
    where s.month = b.m_start and s.details is not null
  ),
  closed as (
    select exists (select 1 from public.closed_months c, b where c.month = b.m_start) as is_closed
  )
  select f.check_key, f.detail from frozen f
  where (select public.current_user_role()) = 'admin'
  union all
  select d.check_key, case when (select is_closed from closed) then d.detail || '{"live": true}'::jsonb else d.detail end
  from details d
  where (select public.current_user_role()) = 'admin'
    and not exists (select 1 from frozen)
$$;
