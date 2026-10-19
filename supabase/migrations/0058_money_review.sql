-- 0058_money_review: two fixes from the money review (docs/MONEY_REVIEW.md). No new object, no new column, no signature
-- change: every object keeps its grants, so the access matrix (S14) and the generated types are unchanged.
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
