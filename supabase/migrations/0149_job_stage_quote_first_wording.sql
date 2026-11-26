-- 0149_job_stage_quote_first_wording (owner 26 Nov 2026, and screen review 24 Nov 2026 Low 25): quote first is the agreed flow (PR 91,
-- PR 92): sales pick the supplier and type the final price, and logging supplier replies is optional. The job stage note still said
-- "suppliers not asked yet" on every new RFQ, on the job page, the Jobs list, Home and the team view. It now says what is next.
--   enquiry            "suppliers not asked yet"       -> "quotation not sent yet"
--   asking_suppliers   "0 of 1 suppliers replied"      -> "quotation not sent yet" (replies are optional, so the count is noise)
--   prices_in          "1 of 1 items priced"           -> "item priced" / "all 3 items priced" / "1 of 2 items priced"
--   ordered, to place  "supplier order to place"       -> "not placed yet" (the stop is already named Supplier order)
-- Only stage_detail text changes. Stages, is_history and last_activity_on are exactly as in 0127 (the latest definition: no later
-- migration redefines job_stage). CREATE OR REPLACE keeps the grants and the comment.
-- Rollback: re-run the job_stage definition from 0127.

create or replace function public.job_stage(p_rfq_id uuid, p_order_id uuid)
returns table (stage text, stage_detail text, is_history boolean, last_activity_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with
  r as (
    select x.id, x.received_on, x.quoted_on, x.closed_on, x.close_reason
    from public.rfqs x
    where x.id = p_rfq_id
  ),
  rf as (
    select
      (select count(*) from public.supplier_inquiries i
        where i.rfq_id = p_rfq_id and (i.sent_on is not null or i.no_offer_on is not null)) as asked,
      (select count(*) from public.supplier_inquiries i
        where i.rfq_id = p_rfq_id
          and (i.no_offer_on is not null or exists (select 1 from public.supplier_quote_lines l where l.inquiry_id = i.id))) as replied,
      (select count(*) from public.rfq_items i where i.rfq_id = p_rfq_id) as items_total,
      (select count(*) from public.rfq_items i
        where i.rfq_id = p_rfq_id
          and exists (select 1 from public.supplier_quote_lines l where l.rfq_item_id = i.id)) as items_priced,
      (select q.valid_until from public.quotations q where q.rfq_id = p_rfq_id order by q.revision desc limit 1) as valid_until
    where p_rfq_id is not null
  ),
  ord as (
    select o.id, o.cancelled_on, o.ordered_on, o.needs_commissioning, o.commissioning_planned_on, o.commissioning_done_on
    from public.orders o
    where o.id = coalesce(p_order_id,
                          (select c.id from public.orders c
                           where c.rfq_id = p_rfq_id and c.cancelled_on is not null
                           order by c.number desc limit 1))
  ),
  ob as (
    select
      o.*,
      gi.goods_items, gi.unsourced,
      lg.n_legs, lg.n_unplaced, lg.n_delivered, lg.n_received, lg.n_late, lg.last_leg_on,
      iv.invoice_count, iv.invoice_gross, iv.last_invoice_on,
      py.settled, py.last_paid_on,
      it.items_gross
    from ord o
    cross join lateral (
      select
        count(*) filter (where not i.is_service) as goods_items,
        count(*) filter (where not i.is_service and i.supplier_order_id is null) as unsourced
      from public.order_items i
      where i.order_id = o.id
    ) gi
    cross join lateral (
      select
        count(*)                                                                         as n_legs,
        count(*) filter (where l.placed_on is null)                                      as n_unplaced,
        count(*) filter (where l.delivered_on is not null)                               as n_delivered,
        count(*) filter (where l.received_on is not null or l.delivered_on is not null)  as n_received,
        count(*) filter (where l.expected_on < public.today_pkt()
                           and l.received_on is null and l.delivered_on is null)         as n_late,
        max(greatest(l.placed_on, l.received_on, l.delivered_on, l.last_chased_on))      as last_leg_on
      from public.supplier_orders l
      where l.id in (select i.supplier_order_id from public.order_items i
                     where i.order_id = o.id and not i.is_service and i.supplier_order_id is not null)
    ) lg
    cross join lateral (
      select count(*) as invoice_count,
             coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross,
             max(v.invoice_date) as last_invoice_on
      from public.invoices v
      where v.order_id = o.id and v.voided_at is null
    ) iv
    cross join lateral (
      select coalesce(sum(p.amount + p.wht_amount), 0) + (select coalesce(sum(a.amount), 0) from public.credit_applications a where a.to_order_id = o.id) as settled, max(p.received_on) as last_paid_on   -- 0127: plus applied credit
      from public.payments_in p
      where p.order_id = o.id and p.voided_at is null
    ) py
    cross join lateral (
      -- the order lines' gross, line by line as qtech_private.order_item_totals (0081) rounds it
      select coalesce(sum(round(i.qty * i.unit_price_net, 2) + round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0)), 0) as items_gross
      from public.order_items i
      where i.order_id = o.id
    ) it
  ),
  ox as (
    select
      b.*,
      case
        when b.goods_items = 0 then 'n_a'
        when b.unsourced > 0 then 'to_source'
        when b.n_unplaced > 0 then 'to_place'
        when b.n_delivered = b.n_legs then 'delivered'
        when b.n_received = b.n_legs then 'received'
        when b.n_late > 0 then 'late'
        when b.n_delivered > 0 then 'partly_delivered'
        else 'on_order'
      end as goods,
      case
        when not b.needs_commissioning then 'n_a'
        when b.commissioning_done_on is not null then 'done'
        when b.commissioning_planned_on is not null then 'planned'
        else 'to_plan'
      end as comm,
      case
        when b.invoice_count = 0 then 'not_invoiced'
        when b.invoice_gross >= b.items_gross - 1 then 'full'
        else 'part'
      end as inv,
      (case when b.invoice_count > 0 then b.invoice_gross else b.items_gross end) as g
    from ob b
  ),
  oy as (
    select x.*, (x.g > 0 and x.settled >= x.g - 1) as settled_ok from ox x
  ),
  b as (
    select
      r.id as rfq_id, r.received_on, r.quoted_on, r.closed_on, r.close_reason,
      rf.asked, rf.replied, rf.items_total, rf.items_priced, rf.valid_until,
      oy.id as order_id, oy.cancelled_on, oy.ordered_on, oy.commissioning_done_on, oy.commissioning_planned_on,
      oy.goods, oy.comm, oy.inv, oy.settled, oy.settled_ok, oy.n_legs, oy.n_delivered, oy.invoice_count, oy.invoice_gross,
      oy.last_leg_on, oy.last_invoice_on, oy.last_paid_on
    from (select 1) d
    left join r on true
    left join rf on true
    left join oy on true
  ),
  st as (
    select
      b.*,
      case
        when b.order_id is not null and b.cancelled_on is not null then 'cancelled'
        when b.order_id is not null then
          case
            when b.goods not in ('n_a', 'delivered') then
              case when b.goods in ('to_source', 'to_place') then 'ordered' else 'supplier_ordered' end
            when b.inv <> 'full' then 'delivered'
            when not b.settled_ok then 'invoiced'
            else 'paid'
          end
        when b.rfq_id is null then null
        when b.closed_on is not null then 'lost'
        when b.quoted_on is not null then 'quoted'
        when b.items_priced > 0 then 'prices_in'
        when b.asked > 0 then 'asking_suppliers'
        else 'enquiry'
      end as stage,
      -- money still open on a cancelled order: an invoice not paid, or an advance still held
      coalesce((b.invoice_count > 0 and b.settled < b.invoice_gross - 1) or (b.invoice_count = 0 and b.settled > 0), false) as money_open
    from b
  )
  select
    st.stage,
    case st.stage
      when 'cancelled' then concat_ws(', ', 'order cancelled', case when st.money_open then 'money still open' end)
      when 'lost' then case st.close_reason
        when 'price' then 'price too high'
        when 'competitor' then 'went to a competitor'
        when 'no_reply_to_clarification' then 'no reply from the customer'
        when 'customer_cancelled' then 'customer cancelled'
        when 'could_not_source' then 'could not source'
        when 'we_were_late' then 'we were late'
        else 'closed' end
      when 'quoted' then case when st.valid_until < public.today_pkt() then 'quotation expired' else 'waiting for the customer' end
      when 'prices_in' then case
        when st.items_priced < st.items_total then st.items_priced::text || ' of ' || st.items_total::text || ' items priced'
        when st.items_total = 1 then 'item priced'
        else 'all ' || st.items_total::text || ' items priced' end
      when 'asking_suppliers' then 'quotation not sent yet'
      when 'enquiry' then 'quotation not sent yet'
      when 'ordered' then concat_ws(', ',
        case st.goods when 'to_source' then 'to source' else 'not placed yet' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end)
      when 'supplier_ordered' then concat_ws(', ',
        case st.goods
          when 'on_order' then 'with the supplier'
          when 'late' then 'supplier late'
          when 'received' then 'arrived, not delivered'
          when 'partly_delivered' then st.n_delivered::text || ' of ' || st.n_legs::text || ' delivered'
        end,
        case when st.inv <> 'not_invoiced' then 'invoiced' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end)
      when 'delivered' then concat_ws(', ',
        case st.inv when 'not_invoiced' then 'not invoiced yet' else 'partly invoiced' end,
        case when st.settled > 0 and not st.settled_ok then 'advance received' end,
        case st.comm when 'to_plan' then 'installation to plan'
                     when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end)
      when 'invoiced' then concat_ws(', ',
        case when st.settled > 0 then 'part paid' else 'not paid yet' end,
        case st.comm when 'to_plan' then 'installation to plan'
                     when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end)
      when 'paid' then case st.comm when 'to_plan' then 'installation to plan'
                                    when 'planned' then 'installation planned ' || to_char(st.commissioning_planned_on, 'FMDD Mon') end
    end as stage_detail,
    case
      when st.stage = 'lost' then true
      when st.stage = 'cancelled' then not st.money_open
      when st.stage = 'paid' then st.comm in ('n_a', 'done')
      else false
    end as is_history,
    greatest(
      st.received_on, st.quoted_on, st.closed_on,
      (select max(greatest(i.sent_on, i.last_chased_on, i.no_offer_on)) from public.supplier_inquiries i where i.rfq_id = st.rfq_id),
      -- a person's own entries only: an imported line carries the import run's date
      (select max((l.created_at at time zone 'Asia/Karachi')::date)
         from public.supplier_quote_lines l join public.supplier_inquiries i on i.id = l.inquiry_id
         where i.rfq_id = st.rfq_id and l.legacy_source is null),
      (select max(q.issued_on) from public.quotations q where q.rfq_id = st.rfq_id),
      (select max(greatest((c.first_asked_at at time zone 'Asia/Karachi')::date,
                           (c.last_asked_at at time zone 'Asia/Karachi')::date,
                           (c.answered_at at time zone 'Asia/Karachi')::date))
         from public.clarifications c where c.rfq_id = st.rfq_id),
      st.ordered_on, st.commissioning_done_on, st.last_leg_on, st.last_invoice_on, st.last_paid_on
    ) as last_activity_on
  from st
  where (select public.current_user_role()) is not null
$$;
