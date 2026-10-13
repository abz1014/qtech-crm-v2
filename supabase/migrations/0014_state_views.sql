-- 0014_state_views (S10, part 1): derived status views from DATA_MODEL section 5 (everything except v_order_state,
-- which needs the money views and lives in 0016).
-- All views run with the caller's rights (security_invoker). Views that expose money also carry an explicit
-- current_user_role() filter, because row security alone makes a view sum only the rows the caller can see.
-- Days are counted in Asia/Karachi through today_pkt().

-- ---------------------------------------------------------------- v_order_items_total (helper, all staff)
-- Net, GST and gross from item prices only. Line net = qty x unit price, 2 decimals; line GST is rounded to
-- whole rupees per line (section 2.13). Item prices are visible to every staff role.
create view public.v_order_items_total with (security_invoker = true) as
select
  o.id as order_id,
  coalesce(sum(l.line_net), 0)::numeric(14,2)                       as net,
  coalesce(sum(l.line_gst), 0)::numeric(14,2)                       as gst,
  (coalesce(sum(l.line_net), 0) + coalesce(sum(l.line_gst), 0))::numeric(14,2) as gross
from public.orders o
left join lateral (
  select round(i.qty * i.unit_price_net, 2)                                   as line_net,
         round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0)      as line_gst
  from public.order_items i
  where i.order_id = o.id
) l on true
group by o.id;

-- ---------------------------------------------------------------- v_company_roles
-- Customer = has an RFQ or an order. Supplier = has an inquiry, a supplier order, a company_brands row, or is a
-- payee on an expense (expenses are admin-only, so a payee-only company shows a role to admin alone).
-- Prospect = customer side with no non-cancelled order.
create view public.v_company_roles with (security_invoker = true) as
select
  c.id as company_id,
  c.name,
  f.is_customer,
  f.is_supplier,
  (f.is_customer and not f.has_active_order) as is_prospect,
  case
    when f.is_customer and f.is_supplier then 'both'
    when f.is_supplier then 'supplier'
    when f.is_customer and f.has_active_order then 'customer'
    when f.is_customer then 'prospect'
  end as role
from public.companies c
cross join lateral (
  select
    (exists (select 1 from public.rfqs r where r.company_id = c.id)
     or exists (select 1 from public.orders o where o.company_id = c.id)) as is_customer,
    exists (select 1 from public.orders o where o.company_id = c.id and o.cancelled_on is null) as has_active_order,
    (exists (select 1 from public.supplier_inquiries si where si.supplier_id = c.id)
     or exists (select 1 from public.supplier_orders so where so.supplier_id = c.id)
     or exists (select 1 from public.company_brands cb where cb.company_id = c.id)
     or exists (select 1 from public.expenses e where e.payee_id = c.id)) as is_supplier
) f;

-- ---------------------------------------------------------------- v_rfq_state
-- outcome:        won (a non-cancelled order references the RFQ; wins over closed_on, clash flagged) / closed / open
-- sourcing_state: not_floated / floated_awaiting / partly_covered / covered / no_offer_anywhere
-- clarification_state, by priority: to_ask / waiting_on_customer / answers_to_relay / none (all counts are exposed)
-- bid_state:      to_bid / bid_sent (quotation_expired arrives with S18, which adds quotations)
create view public.v_rfq_state with (security_invoker = true) as
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
  case when r.quoted_on is null then 'to_bid' else 'bid_sent' end as bid_state,
  case when r.due_on is not null then r.due_on - public.today_pkt() end as days_to_due,
  (r.due_on < public.today_pkt() and r.closed_on is null and not w.has_order) as is_overdue
from public.rfqs r
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

-- ---------------------------------------------------------------- v_inquiry_state
-- contact_state:  shortlisted / sent / chased (chase_count > 0)
-- response_state: quoted (n of m items) / no_offer / awaiting
-- blocked_state:  open_questions / answers_waiting / none
create view public.v_inquiry_state with (security_invoker = true) as
select
  si.id as inquiry_id,
  si.rfq_id,
  si.supplier_id,
  si.sent_on,
  si.last_chased_on,
  si.chase_count,
  case
    when si.sent_on is null then 'shortlisted'
    when si.chase_count > 0 then 'chased'
    else 'sent'
  end as contact_state,
  q.items_quoted,
  m.items_total,
  q.first_quote_on as quote_received_on,
  case
    when q.items_quoted > 0 then 'quoted'
    when si.no_offer_on is not null then 'no_offer'
    else 'awaiting'
  end as response_state,
  b.open_questions,
  b.answers_to_relay,
  case
    when b.open_questions > 0 then 'open_questions'
    when b.answers_to_relay > 0 then 'answers_waiting'
    else 'none'
  end as blocked_state
from public.supplier_inquiries si
cross join lateral (
  select count(*) as items_total from public.rfq_items i where i.rfq_id = si.rfq_id
) m
cross join lateral (
  select count(*) as items_quoted,
         public.today_pkt(min(ql.created_at)) as first_quote_on
  from public.supplier_quote_lines ql
  where ql.inquiry_id = si.id
) q
cross join lateral (
  select
    count(*) filter (where cl.answered_at is null and cl.withdrawn_at is null) as open_questions,
    count(*) filter (where cl.answered_at is not null and cl.withdrawn_at is null
                       and cl.answered_at > coalesce(si.last_relayed_at, '-infinity'::timestamptz)) as answers_to_relay
  from public.clarifications cl
  where cl.raised_by_inquiry_id = si.id
) b;

-- ---------------------------------------------------------------- v_invoice_state (admin and sales)
-- courier_state: not_started / copy_received / sent / delivered_to_client (the furthest step reached).
--   Amendment A3: client_received_on is optional and not in the entry flow, so "sent" is a normal resting
--   state; nothing waits on delivered_to_client.
-- fbr_state: the furthest step reached: deposited / receipt_received / generated / pending.
--   generated = psid is set, or the row carries the legacy flag fbr_generated_legacy.
--   fbr_exception: a later step is set while an earlier one is not (for example deposited with no PSID).
--   needs_fbr_attention: not deposited and the invoice month is before the current month.
create view public.v_invoice_state with (security_invoker = true) as
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

-- ---------------------------------------------------------------- v_gst_register (admin and sales)
-- The only register; every invoice goes to FBR. Uses invoice_date.
create view public.v_gst_register with (security_invoker = true) as
select
  s.invoice_id,
  s.invoice_date,
  date_trunc('month', s.invoice_date)::date as invoice_month,
  s.number,
  s.order_id,
  o.number as order_number,
  coalesce(s.company_id, o.company_id) as company_id,
  c.name as company_name,
  s.net_amount,
  s.gst_amount,
  s.gross_amount,
  s.courier_state,
  s.fbr_state,
  s.fbr_exception,
  s.needs_fbr_attention,
  i.psid,
  i.tax_deposited_on,
  i.tax_deposit_amount
from public.v_invoice_state s
join public.invoices i on i.id = s.invoice_id
left join public.orders o on o.id = s.order_id
left join public.companies c on c.id = coalesce(s.company_id, o.company_id)
where public.current_user_role() in ('admin', 'sales');

-- ---------------------------------------------------------------- grants
-- Read-only for signed-in users; RLS on the underlying tables and the explicit role filters narrow the rows.
revoke all on public.v_order_items_total, public.v_company_roles, public.v_rfq_state, public.v_inquiry_state,
  public.v_invoice_state, public.v_gst_register from public, anon, authenticated;
grant select on public.v_order_items_total, public.v_company_roles, public.v_rfq_state, public.v_inquiry_state,
  public.v_invoice_state, public.v_gst_register to authenticated;
