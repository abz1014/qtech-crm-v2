-- 0092_fix_mistakes (owner decisions, final): fixing and removing mistakes, in the database.
--
--   * Delete is PERMANENT and admin only. The audit trigger keeps the old row (audit_log.old_value, changed_by); there is no restore.
--   * Sales and engineers may change what THEY entered. Admin may change and delete anything.
--   * A locked month must be reopened first (the 0027/0089 month lock stays as it is).
--   * Issued quotations and POs stay "revise only" (0022 lock); the latest revision may be deleted by an admin. Payments keep
--     correct/void, and an admin may also hard-delete one that was a mistake.
--
-- 1. guard_entered_by()    the "whose is it" rule on rfqs, rfq_items, orders, order_items, invoices (BEFORE UPDATE OR DELETE).
-- 2. Admin-only RPCs       delete_rfq, delete_order, delete_invoice, delete_payment, delete_quotation_revision,
--                          delete_po_revision, delete_company. Each pre-checks, refuses with a plain sentence plus a HINT,
--                          deletes in foreign-key order and RETURNS the storage files it removed (bucket, path) so the app can
--                          call storage.remove(). They are SECURITY INVOKER: row security, the month lock and the audit
--                          triggers all apply to the caller exactly as to a direct delete.
-- 3. rfq_items_guard_linked  an RFQ item an order line is based on cannot be removed (HINT linked_to_order).
-- 4. purge_snoozes()       AFTER DELETE on rfqs, orders, supplier_inquiries, supplier_orders: the work list's snoozes are keyed
--                          to those ids (rules.ts subjectId) and have no foreign key, so they are removed with the record.
-- 5. enforce_month_lock    deleting a recurring expense template turns expenses.recurring_id to NULL (ON DELETE SET NULL, 0010).
--                          That UPDATE touched rows in closed months and the lock refused it, so the template could never be
--                          deleted. Clearing the link alone (nothing else changes) is no longer a "touch" of the month.
--
-- Who is limited (as 0065/0081): the API roles `authenticated` and `qtech_engineer`. The service role, postgres, definer
-- functions and the FK actions (which run as the table owner) are not limited by guard_entered_by.

-- ================================================================ 1. the "whose is it" guard
-- Protected columns are the trigger arguments. A caller who is not an admin may change a protected column of, or delete,
-- only a row they entered (created_by) or own (owner_id). A child row also counts as theirs when the parent RFQ or order is
-- theirs (created_by or owner_id of the parent). Rows with no creator (imported) are an admin's. Everything else (due_on,
-- notes, close and win, stamps, commissioning dates) is not named, so it stays open to all staff.
create function public.guard_entered_by()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_col     text;
  v_touched boolean := false;
  v_uid     uuid;
  v_mine    boolean;
begin
  if current_user not in ('authenticated', 'qtech_engineer') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_old := to_jsonb(old);
  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    foreach v_col in array tg_argv loop
      if (v_new -> v_col) is distinct from (v_old -> v_col) then
        v_touched := true;
        exit;
      end if;
    end loop;
    if not v_touched then
      return new;
    end if;
  end if;

  if public.current_user_role() = 'admin' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_uid := auth.uid();
  v_mine := v_uid is not null
            and ((v_old ->> 'created_by') = v_uid::text or (v_old ->> 'owner_id') = v_uid::text);
  if not v_mine and v_uid is not null and tg_table_name = 'rfq_items' then
    v_mine := exists (select 1 from public.rfqs r
                      where r.id = (v_old ->> 'rfq_id')::uuid and (r.created_by = v_uid or r.owner_id = v_uid));
  elsif not v_mine and v_uid is not null and tg_table_name = 'order_items' then
    v_mine := exists (select 1 from public.orders o
                      where o.id = (v_old ->> 'order_id')::uuid and (o.created_by = v_uid or o.owner_id = v_uid));
  end if;

  if not v_mine then
    raise exception 'Only the person who entered this, or an admin, can change it.' using errcode = '42501', hint = 'not_yours';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_entered_by() from public, anon, authenticated;

create trigger rfqs_guard_entered_by before update or delete on public.rfqs
  for each row execute function public.guard_entered_by('company_id', 'site_id', 'contact_id', 'customer_ref', 'received_on');
create trigger rfq_items_guard_entered_by before update or delete on public.rfq_items
  for each row execute function public.guard_entered_by('description', 'brand_id', 'family_id', 'qty', 'unit', 'gst_rate');
create trigger orders_guard_entered_by before update or delete on public.orders
  for each row execute function public.guard_entered_by('company_id', 'site_id', 'contact_id', 'customer_po_number', 'ordered_on', 'payment_terms_days');
-- the money fields of 0065's guard_order_item_money_fields
create trigger order_items_guard_entered_by before update or delete on public.order_items
  for each row execute function public.guard_entered_by('qty', 'unit_price_net', 'gst_rate', 'is_service', 'order_id', 'supplier_order_id', 'supplier_unit_price');
-- BEFORE triggers fire in name order: invoices_month_lock first, so a closed month answers before this guard does
create trigger invoices_zguard_entered_by before update or delete on public.invoices
  for each row execute function public.guard_entered_by('number', 'invoice_date', 'net_amount', 'gst_amount');

-- ================================================================ 2. an RFQ item an order line is based on stays
create function public.guard_rfq_item_linked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.order_items i where i.rfq_item_id = old.id) then
    raise exception 'An order line is based on this item, so it cannot be removed. Change or remove the order line first.'
      using errcode = 'P0001', hint = 'linked_to_order';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_rfq_item_linked() from public, anon, authenticated;

create trigger rfq_items_guard_linked before delete on public.rfq_items
  for each row execute function public.guard_rfq_item_linked();

-- ================================================================ 3. snoozes go with their record
-- subject_id of a snooze is polymorphic (no foreign key). The rules name an RFQ, an inquiry, an order or a supplier order.
-- Snoozes belong to the person who set them (row security: own rows only), so the cleanup is a definer trigger function; it
-- is not callable by a client (a trigger function) and deletes only the rows keyed to the deleted record.
create function public.purge_snoozes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.snoozes where subject_id = old.id;
  return old;
end;
$$;

revoke all on function public.purge_snoozes() from public, anon, authenticated;

create trigger rfqs_purge_snoozes after delete on public.rfqs
  for each row execute function public.purge_snoozes();
create trigger orders_purge_snoozes after delete on public.orders
  for each row execute function public.purge_snoozes();
create trigger supplier_inquiries_purge_snoozes after delete on public.supplier_inquiries
  for each row execute function public.purge_snoozes();
create trigger supplier_orders_purge_snoozes after delete on public.supplier_orders
  for each row execute function public.purge_snoozes();

-- ================================================================ 4. the month lock lets a recurring template go
-- 0089's function with one more branch in the expenses case: expenses.recurring_id turning to NULL, and nothing else in the
-- row changing, does not touch the month (it is the ON DELETE SET NULL of recurring_expenses, 0010). Patched from the current
-- definition, so whatever an earlier migration put in the function stays.
do $$
declare
  def text := pg_catalog.pg_get_functiondef('public.enforce_month_lock()'::regprocedure);
  patched text;
begin
  patched := regexp_replace(
    def,
    '(elsif\s+tg_table_name\s*=\s*''expenses''\s+and\s+coalesce\(current_setting\(''qtech\.category_merge'')',
    'elsif tg_table_name = ''expenses'' and (to_jsonb(old) ->> ''recurring_id'') is not null and (to_jsonb(new) ->> ''recurring_id'') is null
          and (to_jsonb(new) - ''bank_month'' - ''recurring_id'') = (to_jsonb(old) - ''bank_month'' - ''recurring_id'') then
      -- 0092: deleting a recurring template clears the link (ON DELETE SET NULL); the expense itself is unchanged
      v_touched := false;
    \1');
  if patched = def then
    raise exception '0092: the month lock function was not in the expected shape';
  end if;
  execute patched;
end
$$;

-- ================================================================ 5. the admin-only deletes
-- Each function: admin only (refused inside, whatever the grant), the record must exist, pre-checks refuse with a plain
-- sentence and a HINT, the delete runs in FK order, and the stored files of what was removed are returned.

-- ---------------------------------------------------------------- delete_rfq
create function public.delete_rfq(p_rfq_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_files jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  perform 1 from public.rfqs r where r.id = p_rfq_id for update;
  if not found then
    raise exception 'This RFQ is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.orders o where o.rfq_id = p_rfq_id)
     or exists (select 1 from public.order_items oi join public.rfq_items ri on ri.id = oi.rfq_item_id where ri.rfq_id = p_rfq_id) then
    raise exception 'This RFQ has an order. Delete the order first, then delete the RFQ.' using errcode = 'P0001', hint = 'has_order';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('b', x.b, 'p', x.p)), '[]'::jsonb) into v_files
  from (
    select a.bucket as b, a.path as p from public.attachments a where a.rfq_id = p_rfq_id
    union all
    select 'generated-docs', q.pdf_path from public.quotations q where q.rfq_id = p_rfq_id and q.pdf_path is not null
  ) x;

  -- issued quotations block the RFQ (RESTRICT); items, inquiries, quote lines, clarifications and attachments cascade
  delete from public.quotations where rfq_id = p_rfq_id;
  delete from public.rfqs where id = p_rfq_id;

  return query select f ->> 'b', f ->> 'p' from jsonb_array_elements(v_files) f;
end;
$$;

-- ---------------------------------------------------------------- delete_order
create function public.delete_order(p_order_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_files jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  perform 1 from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'This order is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.invoices i where i.order_id = p_order_id) then
    raise exception 'This order has an invoice. Delete the invoice first (Money, Invoices), then delete the order.'
      using errcode = 'P0001', hint = 'has_invoice';
  end if;
  -- voided payments count too (they are kept as history and cannot be deleted): there is no voided_at filter here on purpose
  if exists (select 1 from public.payments_in p where p.order_id = p_order_id) then
    raise exception 'This order has a payment recorded against it, a voided one included, so it is kept. Cancel the order instead of deleting it.'
      using errcode = 'P0001', hint = 'has_payment';
  end if;
  if exists (select 1 from public.expenses e where e.order_id = p_order_id) then
    raise exception 'This order has an expense recorded against it. Remove the expense first, or keep the order.'
      using errcode = 'P0001', hint = 'has_expense';
  end if;
  if exists (select 1 from public.purchase_orders po join public.supplier_orders s on s.id = po.supplier_order_id
             where s.order_id = p_order_id) then
    raise exception 'This order has an issued purchase order. Issued purchase orders are kept, so cancel the order instead of deleting it.'
      using errcode = 'P0001', hint = 'has_po';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('b', a.bucket, 'p', a.path)), '[]'::jsonb) into v_files
  from public.attachments a where a.order_id = p_order_id;

  -- lines, supplier orders, costs, engineers and attachments cascade; expense claims keep their row and lose the link
  delete from public.orders where id = p_order_id;

  return query select f ->> 'b', f ->> 'p' from jsonb_array_elements(v_files) f;
end;
$$;

-- ---------------------------------------------------------------- delete_invoice
create function public.delete_invoice(p_invoice_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inv   record;
  v_files jsonb;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  select i.id, i.tax_bank_month into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'This invoice is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_inv.tax_bank_month is not null then
    raise exception 'This invoice has its tax deposit ticked against the % bank statement. Untick it first (Money, Match bank statement), then delete it.',
      to_char(v_inv.tax_bank_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'bank_ticked';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('b', a.bucket, 'p', a.path)), '[]'::jsonb) into v_files
  from public.attachments a where a.invoice_id = p_invoice_id;

  -- a closed month refuses here (the month lock); the receipts cascade
  delete from public.invoices where id = p_invoice_id;

  return query select f ->> 'b', f ->> 'p' from jsonb_array_elements(v_files) f;
end;
$$;

-- ---------------------------------------------------------------- delete_payment
create function public.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p record;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  select p.id, p.bank_month, p.voided_at, p.corrects_payment_id into v_p
  from public.payments_in p where p.id = p_payment_id for update;
  if not found then
    raise exception 'This payment is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_p.voided_at is not null then
    raise exception 'This payment is voided and kept as history. It cannot be deleted.' using errcode = 'P0001', hint = 'voided';
  end if;
  if v_p.corrects_payment_id is not null
     or exists (select 1 from public.payments_in c where c.corrects_payment_id = p_payment_id) then
    raise exception 'This payment is part of a correction, so it is kept as history. It cannot be deleted.'
      using errcode = 'P0001', hint = 'correction_chain';
  end if;
  if v_p.bank_month is not null then
    raise exception 'This payment is ticked against the % bank statement. Untick it first (Money, Match bank statement), then delete it.',
      to_char(v_p.bank_month, 'FMMonth YYYY')
      using errcode = 'P0001', hint = 'bank_ticked';
  end if;

  -- a closed month refuses here (the month lock)
  delete from public.payments_in where id = p_payment_id;
end;
$$;

-- ---------------------------------------------------------------- delete_quotation_revision
create function public.delete_quotation_revision(p_quotation_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q record;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  select q.id, q.rfq_id, q.revision, q.pdf_path into v_q from public.quotations q where q.id = p_quotation_id for update;
  if not found then
    raise exception 'This quotation is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.quotations n where n.rfq_id = v_q.rfq_id and n.revision > v_q.revision) then
    raise exception 'Only the latest revision can be deleted. Delete the newer revision first.' using errcode = 'P0001', hint = 'not_latest';
  end if;

  delete from public.quotations where id = p_quotation_id;
  -- issue_quotation (0083) sets rfqs.quoted_on to the issued_on of the revision it creates: back to the previous one, or none
  update public.rfqs r
  set quoted_on = (select q.issued_on from public.quotations q where q.rfq_id = v_q.rfq_id order by q.revision desc limit 1)
  where r.id = v_q.rfq_id;

  if v_q.pdf_path is not null then
    return query select 'generated-docs'::text, v_q.pdf_path;
  end if;
end;
$$;

-- ---------------------------------------------------------------- delete_po_revision
create function public.delete_po_revision(p_po_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_po record;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  select p.id, p.supplier_order_id, p.revision, p.pdf_path into v_po from public.purchase_orders p where p.id = p_po_id for update;
  if not found then
    raise exception 'This purchase order is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.purchase_orders n where n.supplier_order_id = v_po.supplier_order_id and n.revision > v_po.revision) then
    raise exception 'Only the latest revision can be deleted. Delete the newer revision first.' using errcode = 'P0001', hint = 'not_latest';
  end if;

  delete from public.purchase_orders where id = p_po_id;

  if v_po.pdf_path is not null then
    return query select 'generated-docs'::text, v_po.pdf_path;
  end if;
end;
$$;

-- ---------------------------------------------------------------- delete_company
create function public.delete_company(p_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can delete this. Nothing was deleted.' using errcode = '42501', hint = 'admin_only';
  end if;
  perform 1 from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'This company is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.rfqs r where r.company_id = p_company_id)
     or exists (select 1 from public.orders o where o.company_id = p_company_id)
     or exists (select 1 from public.invoices i where i.company_id = p_company_id)
     or exists (select 1 from public.expenses e where e.payee_id = p_company_id)
     or exists (select 1 from public.supplier_inquiries s where s.supplier_id = p_company_id)
     or exists (select 1 from public.supplier_orders so where so.supplier_id = p_company_id) then
    raise exception 'This company is used by RFQs, orders, invoices or expenses, so it cannot be deleted. Merge it into another company instead.'
      using errcode = 'P0001', hint = 'in_use';
  end if;

  delete from public.companies where id = p_company_id;
exception
  when foreign_key_violation then
    raise exception 'This company is used by RFQs, orders, invoices or expenses, so it cannot be deleted. Merge it into another company instead.'
      using errcode = 'P0001', hint = 'in_use';
end;
$$;

-- ================================================================ grants
-- authenticated, and qtech_engineer too: the 0081 coverage test requires an engineer to hold every function authenticated
-- holds, apart from the price RPCs. Each function refuses a non-admin inside.
revoke all on function public.delete_rfq(uuid) from public, anon, authenticated;
revoke all on function public.delete_order(uuid) from public, anon, authenticated;
revoke all on function public.delete_invoice(uuid) from public, anon, authenticated;
revoke all on function public.delete_payment(uuid) from public, anon, authenticated;
revoke all on function public.delete_quotation_revision(uuid) from public, anon, authenticated;
revoke all on function public.delete_po_revision(uuid) from public, anon, authenticated;
revoke all on function public.delete_company(uuid) from public, anon, authenticated;
grant execute on function public.delete_rfq(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_order(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_invoice(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_payment(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_quotation_revision(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_po_revision(uuid) to authenticated, qtech_engineer;
grant execute on function public.delete_company(uuid) to authenticated, qtech_engineer;

comment on function public.delete_rfq(uuid) is '0092: admin only. Permanent; the audit log keeps the old rows. Refuses when an order exists (has_order). Returns the storage files to remove.';
comment on function public.delete_order(uuid) is '0092: admin only. Permanent. Refuses while an invoice, payment (voided too), expense or issued PO exists. Returns the storage files to remove.';
comment on function public.delete_invoice(uuid) is '0092: admin only. Open month only (month lock); refuses when the tax deposit is bank-ticked. Returns the storage files to remove.';
comment on function public.delete_payment(uuid) is '0092: admin only. Open month only (month lock); refuses when voided, bank-ticked or part of a correction.';
comment on function public.delete_quotation_revision(uuid) is '0092: admin only. Latest revision only; rfqs.quoted_on goes back to the previous revision. Returns the PDF to remove.';
comment on function public.delete_po_revision(uuid) is '0092: admin only. Latest revision only. Returns the PDF to remove.';
comment on function public.delete_company(uuid) is '0092: admin only. Only a company nothing refers to.';
