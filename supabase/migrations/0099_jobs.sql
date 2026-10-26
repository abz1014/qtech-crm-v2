-- 0099_jobs (redesign phase 5, lane L2: the database half of "Jobs"; owner approval 2026-10-22, DECISIONS decision 4, plan section (d),
-- review 3.1). EXPAND-ONLY: adds a column, two indexes, a helper function and a view; nothing the live app uses is dropped,
-- renamed or changed in meaning (create_repeat_order is replaced with the same signature, the same behaviour and one extra column
-- written).
--
-- A JOB is what the owner thinks in: one customer request from enquiry to payment. The database keeps `rfqs` and `orders`; the job
-- is a read-only VIEW over them, with no fake rows and no data migration (rollback is `drop view public.v_jobs`):
--   (a) every RFQ, together with its live (not cancelled) order if it has one  -> job_key '139' (the RFQ number), kind 'enquiry'
--   (b) every order with no RFQ (repeat, WhatsApp or direct PO)                -> job_key 'O-45' ('O-' + the order number), kind 'direct'
-- 0077 allows one live order per RFQ (legacy imports may hold two: the newest by order number is the job's order); a cancelled order
-- stays inside its job (cancelled_orders counts them), so a cancel followed by a reorder is ONE job. A second PO against the same
-- quotation is an order with no RFQ, hence a new job "O-n" that says repeat_of_job_key = the job it repeats.
--
-- No price, amount, total or rate is in the view. The stage needs money tables an engineer cannot read (invoices, payments), so it is
-- worked out by public.job_stage(), SECURITY DEFINER with an empty search_path, which returns only the stage word, a words-only
-- detail ("2 of 3 delivered", "advance received", "partly invoiced"), a yes/no is_history and the date of the last activity. It
-- answers nobody without a role, and the view (security_invoker) only hands it ids of rows the caller may read (rfqs and orders are
-- readable by every active role, so an engineer sees every job, as they see every RFQ and order today).
--
-- Stage (the earliest stop not finished, plan "Stage bar"), one of
--   enquiry | asking_suppliers | prices_in | quoted | ordered | supplier_ordered | delivered | invoiced | paid | lost | cancelled
--   RFQ, no order:  enquiry (suppliers not asked) / asking_suppliers (asked, none priced) / prices_in (some item priced) /
--                   quoted (quotation sent) / lost (closed without an order)
--   order, goods:   ordered (an item still to source, or a supplier order still to place) / supplier_ordered (placed, not all delivered)
--   delivered:      goods delivered (or none), not yet fully invoiced. Installation is a detail under it, not a stage
--   invoiced:       fully invoiced, not yet paid (Rs 1 allowance, as order_receivables)
--   paid:           settled
--   cancelled:      the job's order is cancelled and no live order replaced it
-- is_history (owner decision 1b, DECISIONS 2026-10-22): closed, settled or lost only. Lost; paid with installation done or not
-- needed; cancelled with no money still open (an unpaid invoice, or an advance still held). An imported order or invoice with money
-- or goods still open is NOT history: it is a live job until it is paid or reviewed. The rule is the same for every row.
--
-- Also here:
--   orders.repeat_of_order_id   the order a repeat order was copied from (create_repeat_order sets it; nothing stored it before)
--   two expression indexes      so "job 139" / "job O-45" is found by index (rfqs (number::text), orders ('O-' || number::text))
--
-- Every new object is granted to qtech_engineer too (0081's coverage test fails otherwise). pgTAP: 0099_jobs.test.sql; the access
-- matrix (0025), the personas (0901) and the engineer money sweep (0902) classify the view and the function.

-- ================================================================ orders.repeat_of_order_id
alter table public.orders
  add column repeat_of_order_id uuid references public.orders (id) on delete set null,
  add constraint orders_repeat_not_self check (repeat_of_order_id is null or repeat_of_order_id <> id);
create index orders_repeat_of_idx on public.orders (repeat_of_order_id) where repeat_of_order_id is not null;
comment on column public.orders.repeat_of_order_id is
  '0099: the order this one was copied from by create_repeat_order ("Repeat of Job 139"). NULL for every other order. SET NULL when the source is deleted.';

-- create_repeat_order (0019, then 0095: the p_repeat_cancelled argument) now stores its source. Same signature, same body: the column list and the value list
-- of its one `insert into public.orders` each gain one entry. Patched from the CURRENT definition, so a later or parallel change to
-- the function is kept; a definition this cannot patch stops the migration instead of being replaced blind.
do $$
declare
  def     text := pg_catalog.pg_get_functiondef('public.create_repeat_order(uuid, uuid, text, date, boolean)'::regprocedure);
  patched text;
begin
  if def ~ 'repeat_of_order_id' then
    return;
  end if;
  patched := regexp_replace(def, '(insert\s+into\s+public\.orders\s*\(\s*id\s*,)', '\1 repeat_of_order_id,', 'i');
  patched := regexp_replace(patched, '(\)\s*values\s*\(\s*p_order_id\s*,)', '\1 p_from_order_id,', 'i');
  if patched !~* 'public\.orders\s*\(\s*id\s*,\s*repeat_of_order_id\s*,'
     or patched !~* 'values\s*\(\s*p_order_id\s*,\s*p_from_order_id\s*,' then
    raise exception 'create_repeat_order could not be patched for repeat_of_order_id';
  end if;
  execute patched;
end
$$;

-- ================================================================ find a job by its key
create index rfqs_job_key_idx on public.rfqs ((number::text));
create index orders_job_key_idx on public.orders (('O-' || number::text));

-- ================================================================ job_stage: stage, detail, history, last activity (words and dates only)
-- p_rfq_id: the job's RFQ, or NULL for a direct order. p_order_id: the job's live order, or for a direct order the order itself.
-- A job whose RFQ has no live order but a cancelled one reads that cancelled order (the newest).
create function public.job_stage(p_rfq_id uuid, p_order_id uuid)
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
             coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross,
             max(v.invoice_date) as last_invoice_on
      from public.invoices v
      where v.order_id = o.id
    ) iv
    cross join lateral (
      select coalesce(sum(p.amount), 0) as settled, max(p.received_on) as last_paid_on
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
      when 'prices_in' then st.items_priced::text || ' of ' || st.items_total::text || ' items priced'
      when 'asking_suppliers' then st.replied::text || ' of ' || st.asked::text || ' suppliers replied'
      when 'enquiry' then 'suppliers not asked yet'
      when 'ordered' then concat_ws(', ',
        case st.goods when 'to_source' then 'to source' else 'supplier order to place' end,
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

comment on function public.job_stage(uuid, uuid) is
  '0099: the stage, a words-only detail, is_history and the last activity date of one job. SECURITY DEFINER because the money tables are closed to an engineer; returns no amount. Called by v_jobs with ids the caller already reads.';

revoke all on function public.job_stage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_stage(uuid, uuid) to authenticated, qtech_engineer;

-- ================================================================ v_jobs
create view public.v_jobs with (security_invoker = true) as
select
  r.number::text as job_key,
  'enquiry'::text as kind,
  r.id as rfq_id,
  lo.id as order_id,
  r.company_id,
  coalesce(r.site_id, lo.site_id) as site_id,
  r.owner_id,
  coalesce(oi.items_summary, ri.items_summary) as items_summary,
  js.stage,
  js.stage_detail,
  js.is_history,
  js.last_activity_on,
  rk.repeat_of_job_key,
  co.cancelled_orders
from public.rfqs r
left join lateral (
  select o.id, o.site_id, o.repeat_of_order_id
  from public.orders o
  where o.rfq_id = r.id and o.cancelled_on is null
  order by o.number desc
  limit 1
) lo on true
left join lateral (
  select d.description || case when d.n > 1 then ' +' || (d.n - 1)::text || ' more' else '' end as items_summary
  from (select i.description, count(*) over () as n
        from public.order_items i
        where i.order_id = lo.id
        order by i.position, i.created_at
        limit 1) d
) oi on true
left join lateral (
  select d.description || case when d.n > 1 then ' +' || (d.n - 1)::text || ' more' else '' end as items_summary
  from (select i.description, count(*) over () as n
        from public.rfq_items i
        where i.rfq_id = r.id
        order by i.position, i.created_at
        limit 1) d
) ri on true
left join lateral (
  select coalesce(sr.number::text, 'O-' || s.number::text) as repeat_of_job_key
  from public.orders s
  left join public.rfqs sr on sr.id = s.rfq_id
  where s.id = lo.repeat_of_order_id
) rk on true
left join lateral (
  select count(*) as cancelled_orders
  from public.orders c
  where c.rfq_id = r.id and c.cancelled_on is not null
) co on true
left join lateral public.job_stage(r.id, lo.id) js on true
union all
select
  'O-' || o.number::text as job_key,
  'direct'::text as kind,
  null::uuid as rfq_id,
  o.id as order_id,
  o.company_id,
  o.site_id,
  o.owner_id,
  oi.items_summary,
  js.stage,
  js.stage_detail,
  js.is_history,
  js.last_activity_on,
  rk.repeat_of_job_key,
  (case when o.cancelled_on is not null then 1 else 0 end)::bigint as cancelled_orders
from public.orders o
left join lateral (
  select d.description || case when d.n > 1 then ' +' || (d.n - 1)::text || ' more' else '' end as items_summary
  from (select i.description, count(*) over () as n
        from public.order_items i
        where i.order_id = o.id
        order by i.position, i.created_at
        limit 1) d
) oi on true
left join lateral (
  select coalesce(sr.number::text, 'O-' || s.number::text) as repeat_of_job_key
  from public.orders s
  left join public.rfqs sr on sr.id = s.rfq_id
  where s.id = o.repeat_of_order_id
) rk on true
left join lateral public.job_stage(null::uuid, o.id) js on true
where o.rfq_id is null;

comment on view public.v_jobs is
  '0099: one row per job. An RFQ with its live order (job_key = the RFQ number) or an order with no RFQ (job_key = O-<order number>). Read-only, no price, amount or rate; stage and is_history come from job_stage().';

revoke all on public.v_jobs from public, anon, authenticated;
grant select on public.v_jobs to authenticated, qtech_engineer;
