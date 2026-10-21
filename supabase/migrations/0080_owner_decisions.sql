-- 0080_owner_decisions (owner decisions of 2026-10-22, docs/DECISIONS.md).
--
--   aging_as_of     Decision 1: an advance on a CANCELLED order (paid, never invoiced, cancelled on or before the date) is still
--                   an 'advance' row (money we hold, never negative aging), now with bucket 'cancelled' so the aging report can
--                   say "Advance held — refund or keep" instead of "not invoiced yet". Same columns, so month_snapshots.aging and
--                   every reader keep their shape. Otherwise the 0076 definition, unchanged.
--   held_advances   Decision 1: the admin's "Advance held — refund or keep" list: one row per cancelled, never-invoiced order that
--                   still holds money (unvoided payments above 0), with the amount. Never owed and never overdue: such an order
--                   is already left out of order_receivables (D-MR3), so Who owes us, its summary and Today's reminders do not
--                   count it. Admin only; anyone else gets no rows.
--   po_line_prefill a quote's source_on is its Karachi day, not the UTC date (pgTAP 0043 failed after 19:00 UTC).
--   reopen_month    Decision 2: only the LATEST closed month can be reopened. Reopening an earlier one while a later month is
--                   closed is refused with a plain sentence naming the month to reopen first (newest first). Reopening a month
--                   that is not closed still does nothing.

-- ================================================================ aging_as_of (decision 1)
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
           v.number, coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) as invoice_date,
           v.net_amount + v.gst_amount as gross
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= p_date
      and not v.settled_before_cutover
      and (select public.current_user_role()) = 'admin'
  ),
  paid as (
    select p.order_id as ordid, sum(p.amount) as paid
    from public.payments_in p
    where p.received_on <= p_date
      and p.voided_at is null
      and (select public.current_user_role()) = 'admin'
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
    select f.*, least(f.gross, greatest(f.paid - f.before_gross, 0)) as applied_amt,
           -- the Rs 1 allowance of order_receivables: an order paid to within Rs 1 of what it is invoiced is settled
           (f.ordid is not null
            and sum(f.gross) over (partition by f.ordid) > 0
            and f.paid >= sum(f.gross) over (partition by f.ordid) - 1) as order_settled
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
    and not a.order_settled
  union all
  select 'advance'::text, o.id, o.number, o.company_id, null::uuid, null::text, null::date, null::numeric,
         null::numeric, null::numeric, null::int,
         -- decision 1: an advance on an order cancelled by the date is held for a refund or kept, not waiting for an invoice
         case when o.cancelled_on is not null and o.cancelled_on <= p_date then 'cancelled' end,
         pd.paid
  from paid pd
  join public.orders o on o.id = pd.ordid
  where pd.paid > 0
    and not exists (select 1 from inv i where i.ordid = pd.ordid)
$$;

-- ================================================================ held_advances (decision 1)
create function public.held_advances()
returns table (
  order_id      uuid,
  order_number  bigint,
  company_id    uuid,
  company_name  text,
  cancelled_on  date,
  held          numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.number, o.company_id, c.name, o.cancelled_on, s.held
  from public.orders o
  left join public.companies c on c.id = o.company_id
  cross join lateral (
    select coalesce(sum(p.amount), 0) as held from public.payments_in p where p.order_id = o.id and p.voided_at is null
  ) s
  where o.cancelled_on is not null
    and s.held > 0
    and not exists (select 1 from public.invoices v where v.order_id = o.id)
    and (select public.current_user_role()) = 'admin'
  order by o.cancelled_on desc, o.number desc
$$;

revoke all on function public.held_advances() from public, anon, authenticated;
grant execute on function public.held_advances() to authenticated;

comment on function public.held_advances() is
  'Owner decision 2026-10-22: money held on cancelled, never-invoiced orders ("Advance held — refund or keep"). Admin only. 0080.';

-- ================================================================ reopen_month (decision 2)
create or replace function public.reopen_month(p_month date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_latest date;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can reopen a month' using errcode = '42501';
  end if;
  if not exists (select 1 from public.closed_months m where m.month = v_month) then
    return;
  end if;
  select max(m.month) into v_latest from public.closed_months m;
  if v_latest > v_month then
    raise exception '% cannot be reopened while % is closed. Reopen % first.',
      to_char(v_month, 'FMMonth YYYY'), to_char(v_latest, 'FMMonth YYYY'), to_char(v_latest, 'FMMonth YYYY')
      using errcode = 'P0001',
            hint = 'Months reopen newest first: reopen the latest closed month, then the one before it.';
  end if;
  if nullif(btrim(p_note), '') is not null then
    update public.closed_months m
    set note = coalesce(m.note || E'\n', '') || 'Reopened: ' || btrim(p_note)
    where m.month = v_month;
  end if;
  delete from public.closed_months m where m.month = v_month;
end;
$$;

revoke all on function public.reopen_month(date, text) from public, anon, authenticated;
grant execute on function public.reopen_month(date, text) to authenticated;

-- ================================================================ po_line_prefill (Karachi day)
-- 0074's definition with one change: a quote is dated by its Karachi day, (created_at at time zone 'Asia/Karachi')::date,
-- not by the session's UTC date. A quote saved after 19:00 UTC (00:00 to 05:00 in Karachi) was dated the day before.
-- No other function in public casts a timestamp to a date without the Karachi zone (0018: dates come from today_pkt()).
create or replace function public.po_line_prefill(p_supplier_order_id uuid)
returns table (
  order_item_id   uuid,
  "position"      smallint,
  description     text,
  qty             numeric,
  unit            text,
  unit_price      numeric,
  price_source    text,
  source_number   integer,
  source_revision smallint,
  source_on       date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_leg public.supplier_orders;
  v_bt  text[] := public.brand_tokens();
  v_bw  text[] := public.brand_words();
begin
  select * into v_leg from public.supplier_orders where id = p_supplier_order_id;
  if not found then
    return;
  end if;

  return query
  select
    oi.id,
    oi.position,
    oi.description,
    oi.qty,
    oi.unit,
    p.price,
    coalesce(p.source, 'typed'),
    p.src_no,
    p.src_rev,
    p.src_on
  from public.order_items oi
  -- 0074: the line's own tokens (brand tokens stripped) and normalised text, worked out once per line instead of once per
  -- past PO line. tokens_without(poi, bt) && tokens_without(oi, bt) is the same test as poi && tokens_without(oi, bt),
  -- because the right-hand side already holds no brand token. OFFSET 0 keeps the planner from inlining it back.
  cross join lateral (
    select public.tokens_without(oi.model_tokens, v_bt) as tok,
           public.strip_words(public.item_text_norm(oi.description), v_bw) as nrm
    offset 0
  ) ot
  left join lateral (
    select c.price, c.source, c.src_no, c.src_rev, c.src_on
    from (
      select oi.supplier_unit_price as price, 'order'::text as source, 1 as pri,
             null::integer as src_no, null::smallint as src_rev, null::date as src_on
      where oi.supplier_unit_price is not null
      union all
      (select q.unit_price, 'quote'::text, 2, r.number::integer, null::smallint, (q.created_at at time zone 'Asia/Karachi')::date
       from public.supplier_quote_lines q
       join public.supplier_inquiries si on si.id = q.inquiry_id
       join public.rfqs r on r.id = si.rfq_id
       where oi.rfq_item_id is not null
         and q.rfq_item_id = oi.rfq_item_id
         and si.supplier_id = v_leg.supplier_id
         and q.currency = v_leg.currency
       order by q.created_at desc
       limit 1)
      union all
      (select (l.e ->> 'unit_price')::numeric, 'last_po'::text, 3, po.number, po.revision, po.issued_on
       from public.purchase_orders po
       join public.supplier_orders so on so.id = po.supplier_order_id and so.supplier_id = v_leg.supplier_id
       cross join lateral jsonb_array_elements(po.lines) as l (e)
       join public.order_items poi on poi.id = (l.e ->> 'order_item_id')::uuid
       where po.currency = v_leg.currency
         and nullif(l.e ->> 'unit_price', '') is not null
         and (
           poi.id = oi.id
           or (poi.model_tokens && ot.tok
               and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id))
           or (oi.brand_id is not null and poi.brand_id = oi.brand_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), ot.nrm, 0.45))
           or (oi.brand_id is null and oi.family_id is not null and poi.family_id = oi.family_id
               and public.similar_enough(public.strip_words(public.item_text_norm(poi.description), v_bw), ot.nrm, 0.60))
         )
       order by (poi.id = oi.id) desc,
                (poi.model_tokens && ot.tok
                 and (poi.brand_id is null or oi.brand_id is null or poi.brand_id = oi.brand_id)) desc,
                po.created_at desc
       limit 1)
    ) c
    order by c.pri
    limit 1
  ) p on true
  where oi.supplier_order_id = p_supplier_order_id
    and not oi.is_service
  order by oi.position, oi.id;
end;
$$;
