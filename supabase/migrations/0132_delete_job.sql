-- 0132_delete_job (owner request 2026-11-05): an admin can delete a job (an enquiry and/or its order). When the job cannot be deleted
-- safely, the screen shows what to clear first, step by step, so the books are never broken.
--
--   job_delete_blockers(p_rfq_id, p_order_id)  one row per thing that stops the delete, in the order to clear them:
--                        1 credit_applied     credit applied to or from the job's orders (take it back, on the customer's page)
--                        2 refund             money paid back to the customer against the job's orders
--                        3 payment            a payment against the job's orders (a voided or corrected one is kept as history)
--                        4 invoice            an invoice (a numbered one is kept for the books: the job is cancelled instead)
--                        5 expense            an expense recorded against the job's orders or their supplier orders
--                        6 purchase_order     an issued purchase order of the job's supplier orders
--                        7 other_order_lines  lines of ANOTHER order that were taken from this enquiry's items
--                      can_clear says whether the person can remove it from the screens; why says what to do, in a plain sentence.
--   delete_job(p_rfq_id, p_order_id)  refuses (P0001, HINT has_blockers) while any blocker remains, else deletes every order of the job
--                      with the existing delete_order (0092, 0127), then the enquiry with delete_rfq (0092). Returns the stored files.
--
-- The job's orders are the one named, plus every order of the enquiry (a cancelled one counts). Both functions are admin only
-- (42501 inside), SECURITY INVOKER like delete_order and delete_rfq, and only read or call what those already read or call.
-- Expand-only: two new functions; nothing else changes.

create function public.job_delete_blockers(p_rfq_id uuid default null, p_order_id uuid default null)
returns table (step int, kind text, order_id uuid, order_number bigint, ref_id uuid, ref_label text, ref_on date, can_clear boolean, why text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_rfq_id is null and p_order_id is null then
    raise exception 'Say which job to check.' using errcode = '22023', hint = 'job';
  end if;

  return query
  with jo as (
    select o.id, o.number
    from public.orders o
    where o.id = p_order_id or (p_rfq_id is not null and o.rfq_id = p_rfq_id)
  )
  -- 1. credit applied to, or taken from, one of the orders
  select 1, 'credit_applied'::text, o.id, o.number::bigint, a.id,
         ('Rs ' || to_char(a.amount, 'FM999,999,999,990.00') || ' of credit applied')::text,
         a.applied_on, true,
         'Take the applied credit back (the customer''s page, Credit).'::text
  from public.credit_applications a
  join jo o on o.id = case when a.to_order_id in (select j.id from jo j) then a.to_order_id else a.from_order_id end
  union all
  -- 2. a refund against one of the orders
  select 2, 'refund', o.id, o.number::bigint, r.id,
         'Rs ' || to_char(r.amount, 'FM999,999,999,990.00') || ' refunded',
         r.refunded_on, r.bank_month is null,
         case when r.bank_month is null then 'Remove the refund (the customer''s page, Credit).'
              else 'Untick the refund on the bank statement first, then remove it (the customer''s page, Credit).' end
  from public.customer_refunds r
  join jo o on o.id = r.order_id
  union all
  -- 3. a payment (a voided one and one in a correction are kept as history, so they cannot be cleared)
  select 3, 'payment', o.id, o.number::bigint, p.id,
         'Rs ' || to_char(p.amount, 'FM999,999,999,990.00') || ' payment' || case when p.voided_at is not null then ' (voided)' else '' end,
         p.received_on,
         p.voided_at is null and p.corrects_payment_id is null
           and not exists (select 1 from public.payments_in c where c.corrects_payment_id = p.id),
         case when p.voided_at is not null then 'A voided payment is kept as history and cannot be deleted. Cancel the job instead.'
              when p.corrects_payment_id is not null
                   or exists (select 1 from public.payments_in c where c.corrects_payment_id = p.id)
                then 'This payment is part of a correction, so it is kept as history. Cancel the job instead.'
              when p.bank_month is not null then 'Untick the payment on the bank statement first, then delete it.'
              else 'Delete the payment.' end
  from public.payments_in p
  join jo o on o.id = p.order_id
  union all
  -- 4. an invoice (a numbered one stays in the register for the books)
  select 4, 'invoice', o.id, o.number::bigint, i.id,
         case when i.number is null then 'Invoice with no number yet' else 'Invoice ' || i.number end,
         i.invoice_date, i.number is null,
         case when i.number is not null then 'A numbered invoice is kept for the books. Cancel the job instead.'
              when i.tax_bank_month is not null then 'Untick the tax deposit on the bank statement first, then delete the invoice.'
              else 'Delete the invoice (Money, Invoices).' end
  from public.invoices i
  join jo o on o.id = i.order_id
  union all
  -- 5. an expense against the order, or against one of its supplier orders
  select 5, 'expense', o.id, o.number::bigint, e.id,
         coalesce(nullif(btrim(e.description), ''), e.category) || ', Rs ' || to_char(e.amount_pkr, 'FM999,999,999,990.00'),
         e.paid_on, true,
         'Remove the expense, or keep the job.'
  from public.expenses e
  join jo o on o.id = coalesce(e.order_id, (select s.order_id from public.supplier_orders s where s.id = e.supplier_order_id))
  union all
  -- 6. an issued purchase order (only the latest revision of each can be deleted, so the later ones go first)
  select 6, 'purchase_order', o.id, o.number::bigint, po.id,
         'PO-' || to_char(po.issued_on, 'YY') || '-' || lpad(po.number::text, 4, '0') || ' revision ' || po.revision::text,
         po.issued_on, true,
         case when exists (select 1 from public.purchase_orders n where n.supplier_order_id = po.supplier_order_id and n.revision > po.revision)
              then 'Delete the later revision of this purchase order first.'
              else 'Delete the purchase order (the supplier order, Purchase order).' end
  from public.purchase_orders po
  join public.supplier_orders s on s.id = po.supplier_order_id
  join jo o on o.id = s.order_id
  union all
  -- 7. lines of another order that were taken from this enquiry's items
  select 7, 'other_order_lines', x.id, x.number::bigint, x.id,
         x.n::text || case when x.n = 1 then ' line' else ' lines' end || ' of ORD-' || lpad(x.number::text, 4, '0') || ' come from this enquiry',
         null::date, true,
         'Remove those lines from that order, or delete that order first.'
  from (
    select o2.id, o2.number, count(*) as n
    from public.order_items oi
    join public.rfq_items ri on ri.id = oi.rfq_item_id
    join public.orders o2 on o2.id = oi.order_id
    where p_rfq_id is not null and ri.rfq_id = p_rfq_id
      and not exists (select 1 from jo j where j.id = oi.order_id)
    group by o2.id, o2.number
  ) x
  order by 1, 7, 6, 5;
end;
$$;

create function public.delete_job(p_rfq_id uuid default null, p_order_id uuid default null)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order uuid;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_rfq_id is null and p_order_id is null then
    raise exception 'Say which job to delete.' using errcode = '22023', hint = 'job';
  end if;
  if p_rfq_id is not null then
    perform 1 from public.rfqs r where r.id = p_rfq_id for update;
    if not found then
      raise exception 'This job is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
    end if;
  end if;
  if exists (select 1 from public.job_delete_blockers(p_rfq_id, p_order_id)) then
    raise exception 'This job still has things that must be cleared first, so nothing was deleted.' using errcode = 'P0001', hint = 'has_blockers';
  end if;

  -- the orders first (delete_order refuses an order the books still lean on), then the enquiry (delete_rfq refuses one with an order)
  for v_order in
    select o.id from public.orders o where o.id = p_order_id or (p_rfq_id is not null and o.rfq_id = p_rfq_id) order by o.number
  loop
    return query select d.storage_bucket, d.storage_path from public.delete_order(v_order) d;
  end loop;
  if p_rfq_id is not null then
    return query select d.storage_bucket, d.storage_path from public.delete_rfq(p_rfq_id) d;
  end if;
end;
$$;

-- authenticated, and qtech_engineer too (the 0081 coverage test); each function refuses a non-admin inside.
revoke all on function public.job_delete_blockers(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_delete_blockers(uuid, uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_job(uuid, uuid) to authenticated, qtech_engineer;

comment on function public.job_delete_blockers(uuid, uuid) is '0132: admin only. What stops a job (enquiry and/or order) being deleted, one row each, in the order to clear them (step). can_clear false: kept for the books, cancel the job instead.';
comment on function public.delete_job(uuid, uuid) is '0132: admin only. Permanent. Refuses (has_blockers) while job_delete_blockers has a row; else delete_order for each order of the job, then delete_rfq. Returns the storage files.';
