-- 0088_stop_the_noise (redesign phase 0 "stop the noise", owner approval 2026-10-22, DECISIONS): the database half of ONE
-- definition of "needs you". The app half is src/features/today/needsYou.ts. Four changes, each one a view or function
-- replaced with the same columns in the same order (so no grant changes, no generated-type changes, and the 0081 engineer grants
-- test is untouched), plus one data fix for imported RFQs.
--
-- 1. v_rfq_state.is_overdue (plan D4): an RFQ whose quotation was sent is never overdue. The due date was the date to send the
--    quotation by, and it was met; what is still open is the customer's decision, which is not ours to be late on. 0014 and 0023
--    read "due_on < today, not closed, no live order", so "Quotation sent ... 458 days overdue" stayed red on the RFQ list.
--    r3/rfq-orders fixed this in the app only (board isLate, the RFQ header's "sent" check); this makes the database say it too,
--    so every reader (Today's facts, reports, close defaults, the RFQ header chip) agrees. Body as 0023 plus "r.quoted_on is null".
-- 2. v_invoice_state.fbr_exception (plan D8): an imported invoice (legacy_source set) is history, and the old CRM's FBR trail
--    ("deposit recorded without a receipt") is not a step out of order in this one. It raised about 26 of the 29 "Invoices & GST"
--    flags after the import (DECISIONS 2026-10-13 already called this rule unverified). needs_fbr_attention (tax not deposited
--    after the month) is unchanged: it is money owed to FBR. Body as 0058 plus "i.legacy_source is null".
-- 3. money_exceptions_input() (plan D10): each order carries "legacy" (orders.legacy_source is set), and an invoice is legacy when
--    it was imported (legacy_source) or carries legacy flags (as before). src/lib/reconciliation.ts drops every finding about an
--    imported order or invoice: "Things to check" lists real mistakes in live data only. Body as 0073 plus the two keys.
-- 4. Imported RFQs whose due date is before the day they were received (plan D5: "Quotation due" a year before "received"; the
--    import flagged them due_before_received with "check the year"). The year was mistyped in the old CRM: the due date takes
--    the received year, or the next one when that is still before the day received. Flagged due_year_fixed. Audited by the rfqs
--    trigger as a system change. Only rows with legacy_source set are touched; a v2 RFQ is never changed. Idempotent: a fixed
--    row is no longer before its received date. legacy_archive.fix_imported_due_years() returns how many it fixed (pgTAP 0088).

-- ---------------------------------------------------------------- 1. v_rfq_state: a sent quotation is never overdue (D4)
create or replace view public.v_rfq_state with (security_invoker = true) as
select
  r.id as rfq_id,
  r.number,
  r.company_id,
  r.owner_id,
  r.received_on,
  r.due_on,
  r.is_priority,
  r.quoted_on,
  r.closed_on,
  r.close_reason,
  case when w.has_order then 'won' when r.closed_on is not null then 'closed' else 'open' end as outcome,
  (w.has_order and r.closed_on is not null) as outcome_clash,
  s.items_total,
  s.items_quoted,
  case when s.responders > 0 then s.items_total - s.items_quoted else 0 end as items_uncovered,
  s.floated,
  s.responders,
  case
    when s.floated = 0 then 'not_floated'
    when s.responders = 0 and s.no_offer = s.floated then 'no_offer_anywhere'
    when s.items_total > 0 and s.items_quoted = s.items_total then 'covered'
    when s.items_quoted > 0 then 'partly_covered'
    else 'floated_awaiting'
  end as sourcing_state,
  c.to_ask,
  c.waiting,
  case when c.waiting > 0 then public.today_pkt() - public.today_pkt(c.last_asked_at) end as waiting_days,
  c.to_relay,
  case
    when c.to_ask > 0 then 'to_ask'
    when c.waiting > 0 then 'waiting_on_customer'
    when c.to_relay > 0 then 'answers_to_relay'
    else 'none'
  end as clarification_state,
  case
    when r.quoted_on is null then 'to_bid'
    when qt.valid_until < public.today_pkt() and not w.has_order and r.closed_on is null then 'quotation_expired'
    else 'bid_sent'
  end as bid_state,
  case when r.due_on is not null then r.due_on - public.today_pkt() end as days_to_due,
  (r.due_on < public.today_pkt() and r.closed_on is null and not w.has_order and r.quoted_on is null) as is_overdue,
  qt.valid_until as quotation_valid_until
from public.rfqs r
left join lateral (
  select q.valid_until
  from public.quotations q
  where q.rfq_id = r.id
  order by q.revision desc
  limit 1
) qt on true
cross join lateral (
  select exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null) as has_order
) w
cross join lateral (
  select
    (select count(*) from public.rfq_items i where i.rfq_id = r.id) as items_total,
    (select count(*) from public.rfq_items i
      where i.rfq_id = r.id
        and exists (select 1 from public.supplier_quote_lines q where q.rfq_item_id = i.id)) as items_quoted,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id and (si.sent_on is not null or si.no_offer_on is not null)) as floated,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id and si.no_offer_on is not null
        and not exists (select 1 from public.supplier_quote_lines q where q.inquiry_id = si.id)) as no_offer,
    (select count(*) from public.supplier_inquiries si
      where si.rfq_id = r.id
        and exists (select 1 from public.supplier_quote_lines q where q.inquiry_id = si.id)) as responders
) s
cross join lateral (
  select
    count(*) filter (where cl.answered_at is null and cl.withdrawn_at is null and cl.first_asked_at is null) as to_ask,
    count(*) filter (where cl.answered_at is null and cl.withdrawn_at is null and cl.first_asked_at is not null) as waiting,
    max(cl.last_asked_at) filter (where cl.answered_at is null and cl.withdrawn_at is null
                                    and cl.first_asked_at is not null) as last_asked_at,
    count(*) filter (where cl.answered_at is not null and cl.withdrawn_at is null
                       and cl.raised_by_inquiry_id is not null
                       and cl.answered_at > coalesce(ri.last_relayed_at, '-infinity'::timestamptz)) as to_relay
  from public.clarifications cl
  left join public.supplier_inquiries ri on ri.id = cl.raised_by_inquiry_id
  where cl.rfq_id = r.id
) c;

-- ---------------------------------------------------------------- 2. v_invoice_state: no FBR exception on an imported invoice (D8)
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
  (i.legacy_source is null
   and ((i.tax_deposited_on is not null and (i.wasif_receipt_on is null or not g.generated))
        or (i.wasif_receipt_on is not null and not g.generated))) as fbr_exception,
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
where (select public.current_user_role()) in ('admin', 'sales');

-- ---------------------------------------------------------------- 3. money_exceptions_input(): which records are imported (D10)
create or replace function public.money_exceptions_input()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    return null;
  end if;
  return (
    with
    ord as (
      select o.id, o.number, o.ordered_on, o.cancelled_on,
             ('value_basis_unknown' = any (coalesce(o.legacy_flags, '{}'))) as basis_unknown,
             (o.legacy_source is not null) as legacy
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
             g.client_received_on, g.tax_deposited_on,
             (g.legacy_source is not null or cardinality(coalesce(g.legacy_flags, '{}')) > 0) as legacy
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
          'basisUnknown', o.basis_unknown, 'legacy', o.legacy)) from out_orders o), '[]'::jsonb),
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

-- ---------------------------------------------------------------- 4. imported due dates a year early (D5)
create function legacy_archive.fix_imported_due_years()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with fix as (
    select r.id,
           (r.due_on + make_interval(years => (extract(year from r.received_on) - extract(year from r.due_on))::int))::date as d1,
           r.received_on
    from public.rfqs r
    where r.legacy_source is not null
      and r.due_on is not null
      and r.due_on < r.received_on
  )
  update public.rfqs r
     set due_on       = case when f.d1 >= f.received_on then f.d1 else (f.d1 + interval '1 year')::date end,
         legacy_flags = array_append(array_remove(r.legacy_flags, 'due_year_fixed'), 'due_year_fixed')
    from fix f
   where r.id = f.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function legacy_archive.fix_imported_due_years() from public, anon, authenticated, service_role;

comment on function legacy_archive.fix_imported_due_years() is
  'Redesign phase 0 (0088, plan D5): an imported RFQ due before the day it was received takes the received year (or the next '
  'one) for its due date and the flag due_year_fixed. Returns the count. Idempotent.';

do $do$
declare
  n integer;
begin
  n := legacy_archive.fix_imported_due_years();
  raise notice '0088: fixed the due year of % imported RFQ(s)', n;
end
$do$;
