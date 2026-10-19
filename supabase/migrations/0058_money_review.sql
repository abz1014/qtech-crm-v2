-- 0058_money_review: the money review (docs/MONEY_REVIEW.md). Part 1, two bug fixes (MR-6, MR-7): no new object, no signature
-- change. Part 2, the owner decisions of 2026-10-19 (D-MR2 to D-MR4, at the end): the month snapshot table month_snapshots,
-- the views v_month_pnl_live and (new columns) v_month_pnl, and the functions month_pnl_drift and month_pnl_adjusted (S14 rows).
--
-- MR-6  next_invoice_number(): lpad() TRUNCATES a string longer than the width, so after INV-9999 the suggestion was
--       INV-1000 (an existing number). The width is now "at least the old width".
-- MR-7  An exempt invoice (GST 0) has no tax to deposit, so it never "needs FBR attention" and is not "FBR pending" on the
--       month-end checklist. Before, every exempt invoice of a past month was flagged for ever ("tax not deposited") and
--       counted on Today's close-month item. Output GST and input tax are still never netted (A6.3).

-- ---------------------------------------------------------------- MR-6 next_invoice_number
-- 0044 with one change: lpad to greatest(width, length of the new number).
create or replace function public.next_invoice_number()
returns table (next_number text, last_number text, last_date date)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role   text := public.current_user_role();
  v_recent text;
  v_prefix text;
  v_width  integer;
  v_max    bigint;
begin
  if v_role is null or v_role not in ('admin', 'sales') then
    raise exception 'invoice numbers are for admin and sales only' using errcode = '42501';
  end if;

  select i.number into v_recent
  from public.invoices i
  where i.number ~ '[0-9]+$'
  order by i.created_at desc, i.number desc
  limit 1;

  if v_recent is null then
    return query select 'INV-0001'::text, null::text, null::date;
    return;
  end if;

  v_prefix := (regexp_match(v_recent, '^(.*?)([0-9]+)$'))[1];
  v_width  := length((regexp_match(v_recent, '^(.*?)([0-9]+)$'))[2]);

  -- the highest number in this series, and the invoice that carries it
  select s.n, s.number, s.invoice_date
  into v_max, last_number, last_date
  from (
    select i.number, i.invoice_date,
           substr(i.number, length(v_prefix) + 1)::bigint as n
    from public.invoices i
    where left(i.number, length(v_prefix)) = v_prefix
      and substr(i.number, length(v_prefix) + 1) ~ '^[0-9]{1,15}$'
  ) s
  order by s.n desc, s.invoice_date desc nulls last
  limit 1;

  -- lpad() would cut "10000" down to "1000": pad to the old width, never below the number's own length
  next_number := v_prefix || lpad((v_max + 1)::text, greatest(v_width, length((v_max + 1)::text)), '0');
  return next;
end;
$$;

-- ---------------------------------------------------------------- MR-7 v_invoice_state
-- 0014 with one change: needs_fbr_attention also needs GST on the invoice (gst_amount > 0). Same columns, same order, so
-- v_gst_register (built on it) is untouched.
create or replace view public.v_invoice_state with (security_invoker = true) as
select
  i.id as invoice_id,
  i.order_id,
  i.company_id,
  i.number,
  i.invoice_date,
  i.net_amount,
  i.gst_amount,
  i.net_amount + i.gst_amount as gross_amount,
  case
    when i.client_received_on is not null then 'delivered_to_client'
    when i.tcs_sent_on is not null then 'sent'
    when i.copy_received_on is not null then 'copy_received'
    else 'not_started'
  end as courier_state,
  case
    when i.tax_deposited_on is not null then 'deposited'
    when i.wasif_receipt_on is not null then 'receipt_received'
    when g.generated then 'generated'
    else 'pending'
  end as fbr_state,
  ((i.tax_deposited_on is not null and (i.wasif_receipt_on is null or not g.generated))
   or (i.wasif_receipt_on is not null and not g.generated)) as fbr_exception,
  (i.tax_deposited_on is null
   and i.gst_amount > 0
   and i.invoice_date is not null
   and date_trunc('month', i.invoice_date) < date_trunc('month', public.today_pkt())) as needs_fbr_attention,
  i.reminder_count,
  i.last_reminded_on,
  case when i.reminder_count > 0 then 'reminded' else 'not_reminded' end as reminder_state
from public.invoices i
cross join lateral (
  select (nullif(btrim(i.psid), '') is not null or 'fbr_generated_legacy' = any (i.legacy_flags)) as generated
) g
where public.current_user_role() in ('admin', 'sales');

-- ---------------------------------------------------------------- MR-7 month_end_status
-- 0028 with one change: fbr_pending counts only invoices with GST to deposit (gst_amount > 0).
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
  checks as (
    select 'bank_unticked'::text as check_key,
           ((select count(*) from public.payments_in p, b
             where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end)
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
                   where p.order_id = o.id and p.received_on <= b.m_end) >= ob.g - 1)::int
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
  select c.check_key, c.n from checks c
  where public.current_user_role() = 'admin'
$$;

-- ================================================================ owner decisions of 2026-10-19 (docs/MONEY_REVIEW.md, DECISIONS)
-- D-MR2  A closed month's figures are FROZEN at close (month_snapshots). Later changes that move a closed month's live
--        figures are shown, as "changes to closed months", in the first open month after the last closed one. Reopening
--        discards the snapshot; closing again takes a new one.
-- D-MR3  order_receivables() keeps a cancelled order only when it has an invoice (its balance is real).
-- D-MR4  payables_as_of() ("we owe") is strict: paid is the net cost (amount less recoverable input tax) and a rate older
--        than 30 days is unusable, so the leg reads no_rate ("needs a rate").

-- ---------------------------------------------------------------- D-MR3 order_receivables
-- 0018 with one change: a cancelled order with no invoice is left out (its item total is not owed by anyone).
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
    select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id
  ) s
  cross join lateral (
    select (b.g > 0 and s.settled >= b.g - 1) as settled_ok
  ) ok
  cross join lateral (
    select (iv.first_invoice_date + o.payment_terms_days) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ---------------------------------------------------------------- D-MR4 payables_as_of (strict)
-- 0028 with two changes: paid is the net cost (amount_pkr - input_tax_pkr), and the rate must be at most 30 days older
-- than p_date (the "unusable" band everywhere else); with no such rate the leg is no_rate.
create or replace function public.payables_as_of(p_date date)
returns table (
  supplier_order_id  uuid,
  order_id           uuid,
  order_number       bigint,
  supplier_id        uuid,
  supplier_name      text,
  currency           text,
  committed          numeric,
  fx_rate            numeric,
  committed_pkr      numeric,
  paid_pkr           numeric,
  owed_pkr           numeric,
  state              text,
  flag               text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with legs as (
    select
      l.id as leg_id, l.order_id as ordid, o.number as order_number, l.supplier_id, s.name as supplier_name,
      coalesce(case when po.total is not null then po.currency else l.currency end, 'PKR')::text as cur,
      coalesce(po.total, it.total) as committed,
      coalesce((select sum(e.amount_pkr - e.input_tax_pkr) from public.expenses e
                where e.supplier_order_id = l.id
                  and e.category_id = 'ca7e0000-0000-4000-8000-000000000011'
                  and e.paid_on <= p_date), 0) as paid
    from public.supplier_orders l
    join public.orders o on o.id = l.order_id
    join public.companies s on s.id = l.supplier_id
    left join lateral (
      select p.total, p.currency from public.purchase_orders p
      where p.supplier_order_id = l.id order by p.revision desc limit 1
    ) po on true
    left join lateral (
      select sum(i.qty * i.supplier_unit_price) as total from public.order_items i
      where i.supplier_order_id = l.id and i.supplier_unit_price is not null
    ) it on true
    where l.placed_on <= p_date
      and (o.cancelled_on is null or o.cancelled_on > p_date)
      and public.current_user_role() = 'admin'
  ),
  priced as (
    select g.*,
           case when g.cur = 'PKR' then 1::numeric
                else (select r.rate_pkr from public.fx_rates r
                      where r.currency = g.cur and r.as_of <= p_date and r.as_of >= p_date - 30
                      order by r.as_of desc, (r.source = 'manual') desc limit 1) end as rate
    from legs g
  ),
  calc as (
    select x.*,
           round(x.committed * x.rate, 2) as committed_pkr,
           round(x.committed * x.rate, 2) - x.paid as raw_owed
    from priced x
  )
  select c.leg_id, c.ordid, c.order_number, c.supplier_id, c.supplier_name, c.cur, c.committed, c.rate,
         c.committed_pkr, c.paid,
         case when c.committed_pkr is not null then greatest(c.raw_owed, 0) end,
         case when c.committed is null then 'unpriced'
              when c.rate is null then 'no_rate'
              when c.raw_owed <= 0.03 * c.committed_pkr then 'settled'
              else 'owing' end,
         case when c.raw_owed < 0 then 'overpaid' end
  from calc c
$$;

-- ---------------------------------------------------------------- D-MR2 v_month_pnl_live
-- The live cash P&L per month, exactly as 0028's v_month_pnl computed it. v_month_pnl (below) now serves a closed
-- month from its snapshot; this view keeps the live figures that the snapshot is compared with. Admin only.
create view public.v_month_pnl_live with (security_invoker = true) as
with money_in as (
  select
    date_trunc('month', p.received_on)::date as month,
    coalesce(sum(p.net_portion) filter (where p.counts_in_cash_net), 0)                          as net_in,
    coalesce(sum(p.gst_portion) filter (where p.counts_in_cash_net), 0)                          as gst_in,
    coalesce(sum(p.amount) filter (where p.excluded_reason in ('basis_unknown', 'zero_value')), 0) as unresolved_gross
  from public.v_payment_net p
  group by 1
),
money_out as (
  select
    date_trunc('month', e.paid_on)::date as month,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'order_cost'), 0) as order_costs,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'overhead'), 0)   as overheads,
    coalesce(sum(e.amount_pkr - e.input_tax_pkr) filter (where c.grp = 'non_pnl'), 0)    as non_pnl_out,
    coalesce(sum(e.amount_pkr), 0)                                                       as cash_out_total,
    coalesce(sum(e.input_tax_pkr), 0)                                                    as input_tax
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  group by 1
)
select
  coalesce(i.month, o.month)       as month,
  coalesce(i.net_in, 0)            as net_in,
  coalesce(i.gst_in, 0)            as gst_in,
  coalesce(i.unresolved_gross, 0)  as unresolved_gross,
  coalesce(o.order_costs, 0)       as order_costs,
  coalesce(o.overheads, 0)         as overheads,
  coalesce(o.non_pnl_out, 0)       as non_pnl_out,
  coalesce(o.cash_out_total, 0)    as cash_out_total,
  coalesce(o.input_tax, 0)         as input_tax
from money_in i
full join money_out o on o.month = i.month
where public.current_user_role() = 'admin';

revoke all on public.v_month_pnl_live from public, anon, authenticated;
grant select on public.v_month_pnl_live to authenticated;

-- ---------------------------------------------------------------- D-MR2 month_snapshots
-- One row per closed month, written by the trigger on closed_months when the month is closed, deleted with it when the
-- month is reopened (cascade). Admin reads; nobody writes directly.
--   pnl       the month's own P&L at close (net_in, gst_in, unresolved_gross, order_costs, overheads, non_pnl_out,
--             cash_out_total, input_tax)
--   adjust    changes to EARLIER closed months found at this close (their live figures less their snapshots, less what
--             earlier closes already showed): shown in this month as "changes to closed months"
--   status    month_end_status rows; categories, team: the v_month_expense_category and v_month_team rows of the month
--   payments  {count, unresolved: [{payment_id, order_id, order_number, amount, reference}]}
--   via       {cash_count, cash_amount, bank_count, bank_amount} of the month's expenses
--   aging, payables: aging_as_of() and payables_as_of() rows as of the month's last day; gst: the v_gst_month row
create table public.month_snapshots (
  month       date primary key references public.closed_months (month) on delete cascade,
  taken_at    timestamptz not null default now(),
  pnl         jsonb not null,
  adjust      jsonb not null,
  status      jsonb not null,
  categories  jsonb not null,
  team        jsonb not null,
  payments    jsonb not null,
  via         jsonb not null,
  aging       jsonb not null,
  payables    jsonb not null,
  gst         jsonb
);

comment on table public.month_snapshots is
  'Owner decision 2026-10-19: the figures of a closed month, frozen when it was closed. Written by the closed_months trigger only; reopening deletes the row.';

alter table public.month_snapshots enable row level security;
revoke all on table public.month_snapshots from public, anon, authenticated;
grant select on table public.month_snapshots to authenticated;
create policy month_snapshots_select_admin on public.month_snapshots for select to authenticated
  using (public.current_user_role() = 'admin');

-- Live less frozen, summed over every snapshotted month, for the P&L fields a later change can move (expense amounts are
-- locked in a closed month, so the cash lines cannot move). NULL for anyone but an admin.
create function public.month_pnl_drift()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.current_user_role() = 'admin' then jsonb_build_object(
    'net_in',           coalesce(sum(coalesce(l.net_in, 0)           - (s.pnl ->> 'net_in')::numeric), 0),
    'gst_in',           coalesce(sum(coalesce(l.gst_in, 0)           - (s.pnl ->> 'gst_in')::numeric), 0),
    'unresolved_gross', coalesce(sum(coalesce(l.unresolved_gross, 0) - (s.pnl ->> 'unresolved_gross')::numeric), 0),
    'order_costs',      coalesce(sum(coalesce(l.order_costs, 0)      - (s.pnl ->> 'order_costs')::numeric), 0),
    'overheads',        coalesce(sum(coalesce(l.overheads, 0)        - (s.pnl ->> 'overheads')::numeric), 0),
    'non_pnl_out',      coalesce(sum(coalesce(l.non_pnl_out, 0)      - (s.pnl ->> 'non_pnl_out')::numeric), 0)) end
  from public.month_snapshots s
  left join public.v_month_pnl_live l on l.month = s.month
$$;

-- What the snapshots already show as adjustments, summed, in the same shape. NULL for anyone but an admin.
create function public.month_pnl_adjusted()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.current_user_role() = 'admin' then jsonb_build_object(
    'net_in',           coalesce(sum((s.adjust ->> 'net_in')::numeric), 0),
    'gst_in',           coalesce(sum((s.adjust ->> 'gst_in')::numeric), 0),
    'unresolved_gross', coalesce(sum((s.adjust ->> 'unresolved_gross')::numeric), 0),
    'order_costs',      coalesce(sum((s.adjust ->> 'order_costs')::numeric), 0),
    'overheads',        coalesce(sum((s.adjust ->> 'overheads')::numeric), 0),
    'non_pnl_out',      coalesce(sum((s.adjust ->> 'non_pnl_out')::numeric), 0)) end
  from public.month_snapshots s
$$;

revoke all on function public.month_pnl_drift() from public, anon, authenticated;
grant execute on function public.month_pnl_drift() to authenticated;
revoke all on function public.month_pnl_adjusted() from public, anon, authenticated;
grant execute on function public.month_pnl_adjusted() to authenticated;

-- The snapshot, taken when a closed_months row is inserted (close_month, close_months_through). SECURITY DEFINER so it may
-- write month_snapshots; the figures come from the admin-only views (the caller of the close RPCs is an admin).
create function public.take_month_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     date := new.month;
  v_end   date := (new.month + interval '1 month')::date - 1;
  v_l     record;
  v_drift jsonb;
  v_done  jsonb;
begin
  select l.* into v_l from public.v_month_pnl_live l where l.month = v_m;

  insert into public.month_snapshots (month, pnl, adjust, status, categories, team, payments, via, aging, payables, gst)
  values (
    v_m,
    jsonb_build_object(
      'net_in', coalesce(v_l.net_in, 0), 'gst_in', coalesce(v_l.gst_in, 0), 'unresolved_gross', coalesce(v_l.unresolved_gross, 0),
      'order_costs', coalesce(v_l.order_costs, 0), 'overheads', coalesce(v_l.overheads, 0), 'non_pnl_out', coalesce(v_l.non_pnl_out, 0),
      'cash_out_total', coalesce(v_l.cash_out_total, 0), 'input_tax', coalesce(v_l.input_tax, 0)),
    '{"net_in":0,"gst_in":0,"unresolved_gross":0,"order_costs":0,"overheads":0,"non_pnl_out":0}'::jsonb,
    (select coalesce(jsonb_agg(jsonb_build_object('check_key', s.check_key, 'n', s.n)), '[]'::jsonb)
     from public.month_end_status(v_m) s),
    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.v_month_expense_category c where c.month = v_m),
    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.v_month_team t where t.month = v_m),
    jsonb_build_object(
      'count', (select count(*) from public.v_payment_net p where p.received_on between v_m and v_end),
      'unresolved', (select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.payment_id, 'order_id', p.order_id,
                                                                  'order_number', o.number, 'amount', p.amount,
                                                                  'reference', pi.reference)), '[]'::jsonb)
                     from public.v_payment_net p
                     join public.orders o on o.id = p.order_id
                     join public.payments_in pi on pi.id = p.payment_id
                     where p.received_on between v_m and v_end
                       and p.excluded_reason in ('basis_unknown', 'zero_value'))),
    (select jsonb_build_object(
              'cash_count', count(*) filter (where e.paid_via = 'cash'),
              'cash_amount', coalesce(sum(e.amount_pkr) filter (where e.paid_via = 'cash'), 0),
              'bank_count', count(*) filter (where e.paid_via <> 'cash'),
              'bank_amount', coalesce(sum(e.amount_pkr) filter (where e.paid_via <> 'cash'), 0))
     from public.expenses e where e.paid_on between v_m and v_end),
    (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.aging_as_of(v_end) a),
    (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.payables_as_of(v_end) p),
    (select to_jsonb(g) from public.v_gst_month g where g.month = v_m)
  );

  -- This month's own drift is 0 now; every other change since the last close is shown in this month.
  v_drift := public.month_pnl_drift();
  v_done  := public.month_pnl_adjusted();
  update public.month_snapshots s
  set adjust = jsonb_build_object(
    'net_in',           (v_drift ->> 'net_in')::numeric           - (v_done ->> 'net_in')::numeric,
    'gst_in',           (v_drift ->> 'gst_in')::numeric           - (v_done ->> 'gst_in')::numeric,
    'unresolved_gross', (v_drift ->> 'unresolved_gross')::numeric - (v_done ->> 'unresolved_gross')::numeric,
    'order_costs',      (v_drift ->> 'order_costs')::numeric      - (v_done ->> 'order_costs')::numeric,
    'overheads',        (v_drift ->> 'overheads')::numeric        - (v_done ->> 'overheads')::numeric,
    'non_pnl_out',      (v_drift ->> 'non_pnl_out')::numeric      - (v_done ->> 'non_pnl_out')::numeric)
  where s.month = v_m;
  return null;
end;
$$;

revoke all on function public.take_month_snapshot() from public, anon, authenticated;

create trigger closed_months_snapshot after insert on public.closed_months
  for each row execute function public.take_month_snapshot();

-- close_months_through (0027) now closes the months one by one, oldest first, so each snapshot sees the ones before it.
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

  select min(r.m) into v_first
  from (
    select date_trunc('month', received_on)::date as m from public.payments_in
    union
    select date_trunc('month', paid_on)::date from public.expenses
    union
    select date_trunc('month', invoice_date)::date from public.invoices where invoice_date is not null
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

-- ---------------------------------------------------------------- D-MR2 v_month_pnl (frozen for closed months)
-- Same first eleven columns as 0028, then the new ones. A closed month shows its snapshot plus the adjustments found when it
-- was closed; an open month shows its live figures, and the first open month after the last closed one also carries every
-- change to a closed month found since (adj_* columns; included in result and after_drawings, not in the own columns).
-- Summed over all months, result still equals the live books.
create or replace view public.v_month_pnl with (security_invoker = true) as
with
snap as (select s.month, s.pnl, s.adjust, s.taken_at from public.month_snapshots s),
target as (select (max(s.month) + interval '1 month')::date as month from public.month_snapshots s),
open_adj as (
  select
    (x.d ->> 'net_in')::numeric           - (x.a ->> 'net_in')::numeric           as net_in,
    (x.d ->> 'gst_in')::numeric           - (x.a ->> 'gst_in')::numeric           as gst_in,
    (x.d ->> 'unresolved_gross')::numeric - (x.a ->> 'unresolved_gross')::numeric as unresolved_gross,
    (x.d ->> 'order_costs')::numeric      - (x.a ->> 'order_costs')::numeric      as order_costs,
    (x.d ->> 'overheads')::numeric        - (x.a ->> 'overheads')::numeric        as overheads,
    (x.d ->> 'non_pnl_out')::numeric      - (x.a ->> 'non_pnl_out')::numeric      as non_pnl_out
  from (select public.month_pnl_drift() as d, public.month_pnl_adjusted() as a) x
),
months as (
  select l.month from public.v_month_pnl_live l
  union
  select s.month from snap s
  union
  select t.month from target t, open_adj o
  where t.month is not null
    and (o.net_in, o.gst_in, o.unresolved_gross, o.order_costs, o.overheads, o.non_pnl_out) <> (0, 0, 0, 0, 0, 0)
),
m as (
  select
    k.month,
    s.taken_at,
    case when s.month is not null then (s.pnl ->> 'net_in')::numeric           else coalesce(l.net_in, 0) end           as net_in,
    case when s.month is not null then (s.pnl ->> 'gst_in')::numeric           else coalesce(l.gst_in, 0) end           as gst_in,
    case when s.month is not null then (s.pnl ->> 'unresolved_gross')::numeric else coalesce(l.unresolved_gross, 0) end as unresolved_gross,
    case when s.month is not null then (s.pnl ->> 'order_costs')::numeric      else coalesce(l.order_costs, 0) end      as order_costs,
    case when s.month is not null then (s.pnl ->> 'overheads')::numeric        else coalesce(l.overheads, 0) end        as overheads,
    case when s.month is not null then (s.pnl ->> 'non_pnl_out')::numeric      else coalesce(l.non_pnl_out, 0) end      as non_pnl_out,
    case when s.month is not null then (s.pnl ->> 'cash_out_total')::numeric   else coalesce(l.cash_out_total, 0) end   as cash_out_total,
    case when s.month is not null then (s.pnl ->> 'input_tax')::numeric        else coalesce(l.input_tax, 0) end        as input_tax,
    case when s.month is not null then (s.adjust ->> 'net_in')::numeric           when k.month = t.month then o.net_in           else 0 end as adj_net_in,
    case when s.month is not null then (s.adjust ->> 'gst_in')::numeric           when k.month = t.month then o.gst_in           else 0 end as adj_gst_in,
    case when s.month is not null then (s.adjust ->> 'unresolved_gross')::numeric when k.month = t.month then o.unresolved_gross else 0 end as adj_unresolved_gross,
    case when s.month is not null then (s.adjust ->> 'order_costs')::numeric      when k.month = t.month then o.order_costs      else 0 end as adj_order_costs,
    case when s.month is not null then (s.adjust ->> 'overheads')::numeric        when k.month = t.month then o.overheads        else 0 end as adj_overheads,
    case when s.month is not null then (s.adjust ->> 'non_pnl_out')::numeric      when k.month = t.month then o.non_pnl_out      else 0 end as adj_non_pnl_out
  from months k
  left join snap s on s.month = k.month
  left join public.v_month_pnl_live l on l.month = k.month
  cross join target t
  cross join open_adj o
)
select
  m.month,
  m.net_in,
  m.gst_in,
  m.unresolved_gross,
  m.order_costs,
  m.overheads,
  (m.net_in + m.adj_net_in) - (m.order_costs + m.adj_order_costs) - (m.overheads + m.adj_overheads) as result,
  m.non_pnl_out,
  (m.net_in + m.adj_net_in) - (m.order_costs + m.adj_order_costs) - (m.overheads + m.adj_overheads)
    - (m.non_pnl_out + m.adj_non_pnl_out) as after_drawings,
  m.cash_out_total,
  m.input_tax,
  (m.taken_at is not null) as frozen,
  m.taken_at as frozen_at,
  m.adj_net_in,
  m.adj_gst_in,
  m.adj_unresolved_gross,
  m.adj_order_costs,
  m.adj_overheads,
  m.adj_non_pnl_out,
  m.adj_net_in - m.adj_order_costs - m.adj_overheads as adjust_result
from m
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- D-MR2 month_end_status (frozen for closed months)
-- The MR-7 version above, plus: a closed month answers with the counts saved when it was closed.
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
             where p.paid_via = 'bank' and p.bank_month is null and p.received_on <= b.m_end)
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
                   where p.order_id = o.id and p.received_on <= b.m_end) >= ob.g - 1)::int
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
