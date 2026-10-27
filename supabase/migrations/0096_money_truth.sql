-- 0096_money_truth (redesign phase 2 "money truth", owner decision 1b of 2026-10-22, plan D3 and D6): imported orders and
-- invoices whose money or goods are still open stay live after a one-off "Review imported" by the owner; closed, settled or
-- lost records are history. This is the database half. EXPAND-ONLY: two columns, one trigger, new functions, and three money
-- objects replaced with the same signature and columns. Nothing the live app uses is dropped or renamed. It links nothing
-- itself: the owner runs the linking from the app.
--
--   A. orders.legacy_review, invoices.legacy_review   NULL on a row that was not imported; 'to_review' (open, waiting for the
--      owner), 'live' (the owner confirmed it is still open) or 'settled' (history; its open balance reads 0). Backfilled
--      below for the rows already imported.
--   B. link_imported_invoices(p_dry_run), link_imported_invoice(), unlink_imported_invoice(): link imported invoices that have
--      no order to their orders (D3), through the qtech.legacy_link allowance of 0089 so it works inside a locked imported
--      month; admin only.
--   C. set_legacy_review(kind, id, state): the owner's decision on one record; settling an order marks its costs complete (D6).
--   D. order_receivables, v_order_money, aging_as_of: a row reviewed 'settled' has open 0. With legacy_review NULL everywhere
--      every figure is exactly as before (pgTAP 0096 compares them with hand-computed values).
--   E. Helpers in qtech_private to read a PO number the way import/src/transform/money.ts does.

-- ================================================================ A. the review state
alter table public.orders
  add column legacy_review text,
  add constraint orders_legacy_review_check check (legacy_review in ('to_review', 'live', 'settled')),
  add constraint orders_legacy_review_imported check (legacy_review is null or legacy_source is not null);
alter table public.invoices
  add column legacy_review text,
  add constraint invoices_legacy_review_check check (legacy_review in ('to_review', 'live', 'settled')),
  add constraint invoices_legacy_review_imported check (legacy_review is null or legacy_source is not null);

comment on column public.orders.legacy_review is
  '0096: review state of an IMPORTED order (NULL when not imported): to_review = money or goods still open, waiting for the owner; live = the owner confirmed it; settled = history, its open balance reads 0. Set through set_legacy_review (admin).';
comment on column public.invoices.legacy_review is
  '0096: review state of an IMPORTED invoice (NULL when not imported): to_review, live or settled (history, its open balance reads 0). Set through set_legacy_review (admin).';

-- Only an admin changes it, and a new row never arrives with one (the import loads rows without it). Everyone else (the data
-- API roles) is refused; postgres, the service role and definer functions are not limited, as guard_legacy_columns (0078).
create function public.guard_legacy_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'qtech_engineer') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.legacy_review is not null then
      raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.legacy_review is distinct from old.legacy_review and (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_legacy_review() from public, anon, authenticated;

create trigger orders_guard_legacy_review before insert or update on public.orders
  for each row execute function public.guard_legacy_review();
create trigger invoices_guard_legacy_review before insert or update on public.invoices
  for each row execute function public.guard_legacy_review();

-- ---------------------------------------------------------------- backfill (imported rows only; nothing else is touched)
-- Order: money open = it has something to collect (the invoiced gross, else the item gross, as order_receivables reads it; a
-- cancelled order that was never invoiced owes nothing) and the payments are not within Rs 1 of it; goods open = a goods line
-- not yet delivered by its supplier order (a cancelled order has none). Either one: 'to_review'. Otherwise 'settled'.
update public.orders o
set legacy_review = case
  when ((c.invoice_count > 0 or o.cancelled_on is null)
        and c.g > 0 and c.paid < c.g - 1)
    or (o.cancelled_on is null and exists (
          select 1
          from public.order_items i
          left join public.supplier_orders l on l.id = i.supplier_order_id
          where i.order_id = o.id and not i.is_service and (i.supplier_order_id is null or l.delivered_on is null)))
  then 'to_review' else 'settled' end
from (
  select x.id,
         iv.invoice_count,
         case when iv.invoice_count > 0 then iv.invoice_gross else it.items_gross end as g,
         pay.paid
  from public.orders x
  cross join lateral (
    select count(*) as invoice_count, coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross
    from public.invoices v where v.order_id = x.id
  ) iv
  cross join lateral (
    select coalesce(sum(l.line_net + l.line_gst), 0) as items_gross
    from (select round(i.qty * i.unit_price_net, 2) as line_net,
                 round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0) as line_gst
          from public.order_items i where i.order_id = x.id) l
  ) it
  cross join lateral (
    select coalesce(sum(p.amount), 0) as paid from public.payments_in p where p.order_id = x.id and p.voided_at is null
  ) pay
) c
where o.id = c.id and o.legacy_source is not null and o.legacy_review is null;

-- Invoice: paid before the new system = 'settled'; with no order it cannot be matched to a payment, so it is 'to_review';
-- on an order it follows what the order has collected against everything invoiced on it.
update public.invoices v
set legacy_review = case
  when v.settled_before_cutover then 'settled'
  when v.order_id is null then 'to_review'
  when coalesce((select sum(p.amount) from public.payments_in p where p.order_id = v.order_id and p.voided_at is null), 0)
       >= (select sum(x.net_amount + x.gst_amount) from public.invoices x where x.order_id = v.order_id) - 1
    then 'settled'
  else 'to_review' end
where v.legacy_source is not null and v.legacy_review is null;

-- ================================================================ E. reading a PO number (the import's rules, in SQL)
-- Port of normPoToken / poTokens / poFromNotes in import/src/transform/money.ts: "PO# 253074 & 252993" gives two tokens.
create function qtech_private.po_tokens(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.tok order by t.tok), '{}'::text[])
  from (
    select nullif(
             regexp_replace(
               regexp_replace(
                 regexp_replace(upper(regexp_replace(s, '[\s#]', '', 'g')), '^P\.?O\.?(NO\.?|NUMBER)?:?', ''),
                 '^[:.-]+', ''),
               '[.,;:]+$', ''),
             '') as tok
    from regexp_split_to_table(coalesce(p_text, ''), '\s*(&|,|;|\+|/|\yand\y)\s*', 'i') s
  ) t
  where t.tok is not null
$$;

create function qtech_private.po_from_notes(p_notes text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim((regexp_match(p_notes,
    '\yP\.?O(?![a-z])\.?\s*(?:#|no\.?|number)?\s*[:.]?\s*([a-z0-9][a-z0-9/-]*(?:\s*(?:&|,|\yand\y)\s*\d[a-z0-9/-]*)*)', 'i'))[1])
$$;

revoke all on function qtech_private.po_tokens(text), qtech_private.po_from_notes(text) from public, anon;
grant execute on function qtech_private.po_tokens(text), qtech_private.po_from_notes(text) to authenticated;

comment on function qtech_private.po_tokens(text) is
  '0096: the PO numbers in a cell ("PO# 253074 & 252993" gives two), normalised as normPoToken in import/src/transform/money.ts.';
comment on function qtech_private.po_from_notes(text) is
  '0096: the PO written in free text ("PO 251809."), as poFromNotes in import/src/transform/money.ts.';

-- ================================================================ B. linking imported invoices to their orders (D3)
-- The proposals. An imported invoice (legacy_source set) with no order, a customer, not paid-before-cutover and not reviewed
-- 'settled', against the imported orders of the SAME customer:
--   amount   the invoice gross is within Rs 1 of the order's gross (an order with no invoice yet) or of what is left to invoice
--            (an order that already has invoices: its gross less theirs);
--   date     the invoice is dated on or after the order (a missing date on either side does not exclude it, but is never 'certain');
--   PO       when both sides carry one (the order's PO field, the PO written in the invoice's notes) they must share a number,
--            otherwise the pair is dropped. When some candidates share it, only those are kept.
-- 'certain' = after that, exactly one order is a candidate for the invoice AND exactly one invoice for the order, both dates
-- are known, and the PO matches or the amount is the order's whole gross. Anything else is 'likely': several orders with the
-- same amount stay 'likely' (every pair is listed), as does an invoice that matches only what is left on an order.
-- Admin only (the caller's own rights read the rows, so a non-admin sees nothing even if the check were removed).
create function qtech_private.invoice_link_proposals()
returns table (invoice_id uuid, order_id uuid, confidence text, reasons text[])
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;

  return query
  with inv as (
    select v.id, v.company_id, v.invoice_date, v.net_amount + v.gst_amount as gross,
           qtech_private.po_tokens(qtech_private.po_from_notes(v.notes)) as po
    from public.invoices v
    where v.legacy_source is not null
      and v.order_id is null
      and v.company_id is not null
      and not v.settled_before_cutover
      and v.legacy_review is distinct from 'settled'
      and v.net_amount + v.gst_amount > 0
  ),
  ord as (
    select o.id, o.company_id, o.ordered_on, qtech_private.po_tokens(o.customer_po_number) as po,
           t.gross as og, l.n as linked_n, l.g as linked_gross
    from public.orders o
    join public.v_order_items_total t on t.order_id = o.id
    cross join lateral (
      select count(*) as n, coalesce(sum(x.net_amount + x.gst_amount), 0) as g from public.invoices x where x.order_id = o.id
    ) l
    where o.legacy_source is not null
  ),
  pair as (
    select i.id as inv_id, o.id as ord_id, i.invoice_date, o.ordered_on,
           (i.po && o.po) as po_match,
           (o.linked_n = 0 and abs(i.gross - o.og) <= 1) as whole_match,
           (o.linked_n > 0 and o.og - o.linked_gross > 0 and abs(i.gross - (o.og - o.linked_gross)) <= 1) as rest_match
    from inv i
    join ord o on o.company_id = i.company_id
    where (i.invoice_date is null or o.ordered_on is null or i.invoice_date >= o.ordered_on)
      and not (cardinality(i.po) > 0 and cardinality(o.po) > 0 and not (i.po && o.po))
  ),
  amount_ok as (
    select p.* from pair p where p.whole_match or p.rest_match
  ),
  narrowed as (
    select a.*
    from (select m.*, bool_or(m.po_match) over (partition by m.inv_id) as any_po from amount_ok m) a
    where a.po_match or not a.any_po
  ),
  counted as (
    select n.*,
           count(*) over (partition by n.inv_id) as n_orders,
           count(*) over (partition by n.ord_id) as n_invoices
    from narrowed n
  )
  select c.inv_id, c.ord_id,
         case when c.n_orders = 1 and c.n_invoices = 1
                   and c.invoice_date is not null and c.ordered_on is not null
                   and (c.po_match or c.whole_match)
              then 'certain' else 'likely' end,
         array_remove(array[
           'same customer',
           case when c.po_match then 'the PO number matches' end,
           case when c.whole_match then 'the amount is the order''s whole value (within Rs 1)'
                when c.rest_match then 'the amount is what is left to invoice on the order (within Rs 1)' end,
           case when c.invoice_date is not null and c.ordered_on is not null then 'dated on or after the order'
                else 'a date is missing' end,
           case when c.n_orders > 1 then c.n_orders::text || ' orders of this customer fit this invoice' end,
           case when c.n_invoices > 1 then c.n_invoices::text || ' invoices fit this order' end
         ], null)
  from counted c
  order by (case when c.n_orders = 1 and c.n_invoices = 1
                      and c.invoice_date is not null and c.ordered_on is not null
                      and (c.po_match or c.whole_match) then 0 else 1 end),
           c.invoice_date nulls last, c.inv_id, c.ord_id;
end;
$$;

revoke all on function qtech_private.invoice_link_proposals() from public, anon;
grant execute on function qtech_private.invoice_link_proposals() to authenticated;

-- link_imported_invoices(p_dry_run): the proposals. With p_dry_run = false it also links the 'certain' ones (one UPDATE of
-- order_id each, inside the qtech.legacy_link allowance of 0089, so an invoice in a locked imported month can be linked and
-- nothing else of it changes). Each link is audited by the invoices audit trigger (who, when, old and new order_id). The rows
-- returned are the proposals as they stood before linking; the 'certain' ones are the ones applied.
create function public.link_imported_invoices(p_dry_run boolean default true)
returns table (invoice_id uuid, order_id uuid, confidence text, reasons text[])
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;

  return query select p.invoice_id, p.order_id, p.confidence, p.reasons from qtech_private.invoice_link_proposals() p;

  if not coalesce(p_dry_run, true) then
    perform set_config('qtech.legacy_link', 'on', true);
    for r in select p.invoice_id as inv_id, p.order_id as ord_id from qtech_private.invoice_link_proposals() p where p.confidence = 'certain' loop
      update public.invoices v set order_id = r.ord_id where v.id = r.inv_id and v.order_id is null;
    end loop;
    perform set_config('qtech.legacy_link', 'off', true);
  end if;
end;
$$;

revoke all on function public.link_imported_invoices(boolean) from public, anon, authenticated;
grant execute on function public.link_imported_invoices(boolean) to authenticated;   -- not qtech_engineer: money. Refused inside for anyone but an admin.

comment on function public.link_imported_invoices(boolean) is
  '0096 (D3): proposes order links for imported invoices with no order (same customer, PO, gross within Rs 1 of the order or what is left to invoice, dated on or after the order): certain or likely, with reasons. p_dry_run = false links the certain ones (admin only, audited, works in a locked imported month).';

-- link_imported_invoice(invoice, order): one link by hand, for a "likely" proposal the owner has checked.
create function public.link_imported_invoice(p_invoice_id uuid, p_order_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_ord public.orders;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;
  select * into v_inv from public.invoices v where v.id = p_invoice_id for update;
  select * into v_ord from public.orders o where o.id = p_order_id;
  if v_inv.id is null or v_ord.id is null then
    raise exception 'Imported record not found' using errcode = 'P0002';
  end if;
  if v_inv.legacy_source is null then
    raise exception 'This invoice was not imported, so it cannot be linked here.' using errcode = '23514';
  end if;
  if v_inv.settled_before_cutover then
    raise exception 'This invoice was paid before the new system started, so it has no order to link to.' using errcode = '23514';
  end if;
  if v_inv.order_id is not null then
    raise exception 'This invoice is already linked to an order. Unlink it first.' using errcode = '23514';
  end if;
  if v_inv.company_id is distinct from v_ord.company_id then
    raise exception 'The invoice and the order belong to different customers.' using errcode = '23514';
  end if;

  perform set_config('qtech.legacy_link', 'on', true);
  update public.invoices v set order_id = p_order_id where v.id = p_invoice_id;
  perform set_config('qtech.legacy_link', 'off', true);
end;
$$;

revoke all on function public.link_imported_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_imported_invoice(uuid, uuid) to authenticated;

comment on function public.link_imported_invoice(uuid, uuid) is
  '0096: links one imported invoice (no order yet) to an order of the same customer. Admin only, audited, works in a locked imported month (order_id is the only column that changes).';

-- unlink_imported_invoice(invoice): undo a link. Only an invoice that carries its own customer can stand without an order (an
-- invoice needs an order or a customer), which is every invoice linked by link_imported_invoice(s).
create function public.unlink_imported_invoice(p_invoice_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;
  select * into v_inv from public.invoices v where v.id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Imported record not found' using errcode = 'P0002';
  end if;
  if v_inv.legacy_source is null then
    raise exception 'This invoice was not imported, so it cannot be unlinked here.' using errcode = '23514';
  end if;
  if v_inv.order_id is null then
    raise exception 'This invoice is not linked to an order.' using errcode = '23514';
  end if;
  if v_inv.company_id is null then
    raise exception 'This invoice has no customer of its own, so it cannot be taken off its order.' using errcode = '23514';
  end if;

  perform set_config('qtech.legacy_link', 'on', true);
  update public.invoices v set order_id = null where v.id = p_invoice_id;
  perform set_config('qtech.legacy_link', 'off', true);
end;
$$;

revoke all on function public.unlink_imported_invoice(uuid) from public, anon, authenticated;
grant execute on function public.unlink_imported_invoice(uuid) to authenticated;

comment on function public.unlink_imported_invoice(uuid) is
  '0096: takes an imported invoice off its order again (its customer stays). Admin only, audited, works in a locked imported month.';

-- ================================================================ C. the owner's decision on one imported record
-- Settling an ORDER also marks its costs complete (plan D6: "Costs not entered yet" must not show on history, and its margin is
-- final). An existing completion date is kept. Moving an order back to to_review or live leaves the costs as they are.
create function public.set_legacy_review(kind text, id uuid, state text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_found boolean;
begin
  if coalesce((select public.current_user_role()), '') <> 'admin' then
    raise exception 'Only an admin can link or review imported records.' using errcode = '42501';
  end if;
  if kind not in ('order', 'invoice') or state not in ('to_review', 'live', 'settled') then
    raise exception 'set_legacy_review needs kind order or invoice, and state to_review, live or settled' using errcode = '22023';
  end if;

  if kind = 'order' then
    select o.legacy_source is not null into v_found from public.orders o where o.id = set_legacy_review.id for update;
  else
    select v.legacy_source is not null into v_found from public.invoices v where v.id = set_legacy_review.id for update;
  end if;
  if v_found is null then
    raise exception 'Imported record not found' using errcode = 'P0002';
  end if;
  if not v_found then
    raise exception 'This record was not imported, so it has no review state.' using errcode = '23514';
  end if;

  if kind = 'order' then
    update public.orders o set legacy_review = state where o.id = set_legacy_review.id;
    if state = 'settled' then
      insert into public.order_costs (order_id, costs_complete_at) values (set_legacy_review.id, now())
      on conflict (order_id) do update set costs_complete_at = coalesce(public.order_costs.costs_complete_at, excluded.costs_complete_at);
    end if;
  else
    update public.invoices v set legacy_review = state where v.id = set_legacy_review.id;
  end if;
end;
$$;

revoke all on function public.set_legacy_review(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_legacy_review(text, uuid, text) to authenticated;

comment on function public.set_legacy_review(text, uuid, text) is
  '0096: the owner''s review of one imported order or invoice (to_review, live or settled). Admin only. Settling an order sets order_costs.costs_complete_at (D6) when it is not set.';

-- ================================================================ D. the money objects: reviewed 'settled' = open 0
-- Each is its previous definition with ONE change: a row reviewed 'settled' (the order itself, or an order whose every invoice
-- is) has no open balance, is not overdue and reads 'settled'. Where legacy_review is NULL or 'to_review' or 'live' every
-- expression is the one it was.

-- ---------------------------------------------------------------- order_receivables (0076)
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
  v_role text := (select public.current_user_role());
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
    case when rv.reviewed then 0::numeric else greatest(b.g - s.settled, 0) end,
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
           count(*) filter (where v.legacy_review = 'settled') as reviewed_invoices,
           coalesce(sum(v.net_amount + v.gst_amount), 0) as invoice_gross,
           min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id
  ) iv
  cross join lateral (
    select case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
  ) b
  cross join lateral (
    select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
  ) s
  cross join lateral (
    -- 0096: the owner reviewed it as settled (the order, or every invoice on it)
    select (coalesce(o.legacy_review = 'settled', false) or (iv.invoice_count > 0 and iv.reviewed_invoices = iv.invoice_count)) as reviewed
  ) rv
  cross join lateral (
    select (rv.reviewed or (b.g > 0 and s.settled >= b.g - 1)) as settled_ok
  ) ok
  cross join lateral (
    select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
  ) cp
  cross join lateral (
    select (iv.first_invoice_date + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  ) d
  where (p_order_id is null or o.id = p_order_id)
    and (o.cancelled_on is null or iv.invoice_count > 0)
  order by o.number;
end;
$$;

-- ---------------------------------------------------------------- v_order_money (0076)
create or replace view public.v_order_money with (security_invoker = true) as
select
  o.id as order_id,
  o.number as order_number,
  o.company_id,
  o.owner_id,
  b.basis,
  case when b.invoice_count > 0 then b.invoice_net else b.items_net end as net_sale,
  gm.g as gross_target,
  s.settled,
  (rv.reviewed or (gm.g > 0 and s.settled >= gm.g - 1)) as settled_ok,
  case when rv.reviewed then 0::numeric else greatest(gm.g - s.settled, 0) end as receivable,
  greatest(s.settled - gm.g, 0) as overpaid_by,
  d.due_on,
  case
    when rv.reviewed then 'settled'
    when d.due_on is not null and d.due_on < public.today_pkt() and not (gm.g > 0 and s.settled >= gm.g - 1)
      then 'overdue'
    when gm.g > 0 and s.settled >= gm.g - 1 then 'settled'
    when s.settled > 0 then 'part'
    else 'unpaid'
  end as payment_state,
  e.actual_cost,
  oc.expected_cost_pkr as expected_cost,
  case when oc.costs_complete_at is not null then 'complete' else 'provisional' end as costs_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then null
       else (case when b.invoice_count > 0 then b.invoice_net else b.items_net end) - e.actual_cost end as margin,
  case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when oc.costs_complete_at is null then 'provisional'
    else 'final'
  end as margin_state,
  case when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
       when o.legacy_flags && array['dates_estimated', 'undated'] then 'estimated_dates'
       else 'ok' end as data_trust
from public.orders o
join public.v_order_basis b on b.order_id = o.id
cross join lateral (
  -- D-MR3: a cancelled order that was never invoiced owes nothing
  select case when o.cancelled_on is not null and b.invoice_count = 0 then 0::numeric else b.g end as g
) gm
cross join lateral (
  -- 0096: the owner reviewed it as settled (the order, or every invoice on it)
  select (coalesce(o.legacy_review = 'settled', false)
          or (b.invoice_count > 0 and not exists (select 1 from public.invoices v
                                                  where v.order_id = o.id and v.legacy_review is distinct from 'settled'))) as reviewed
) rv
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id and p.voided_at is null
) s
cross join lateral (
  select coalesce(sum(x.amount_pkr - x.input_tax_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select p.default_payment_terms_days as days from public.company_profile p where p.id = 1
) cp
cross join lateral (
  select (min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) + coalesce(o.payment_terms_days, cp.days)::int) as due_on
  from public.invoices v
  where v.order_id = o.id

) d
where (select public.current_user_role()) = 'admin';

-- ---------------------------------------------------------------- aging_as_of (0080)
-- An invoice reviewed 'settled', or on an order reviewed 'settled', is left out of the rows (the FIFO still counts it, so the
-- other invoices of the order are applied exactly as before). A settled imported order's advance row is left out too.
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
           v.net_amount + v.gst_amount as gross,
           (v.legacy_review = 'settled' or o.legacy_review = 'settled') as reviewed_settled
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
    and not coalesce(a.reviewed_settled, false)
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
    and o.legacy_review is distinct from 'settled'
$$;

-- receivables_list and receivables_summary read order_receivables, so they follow it with no change.
