-- 0141_archive_core: the database half of "Archive old data". EXPAND-ONLY: two tables and twenty-seven functions (eighteen of them are archived(), one private helper). No existing
-- table, view or function is changed; no row is deleted; nothing is hidden until an admin switches the setting on.
--
-- WHAT IT IS. Old work clutters the lists. When the setting is ON, a row is ARCHIVED (hidden from lists) if it was imported from the old
-- system (legacy_source is not null) or its document date is before the cutoff (17 Nov 2026 to begin with), whatever its status. The
-- owner's decisions, all of which hold here:
--   - Hiding is for clutter, not security. There is NO row-security hiding and NO deleting: every row stays readable by id, in every table, for
--     everyone who could read it before. A screen asks "archived?" and filters; the database only answers the question.
--   - Fully reversible: switch the setting off, or move the cutoff, and everything is back. One row can be brought back on its own (unhide)
--     and put away again (rehide); that is a row in archive_unhidden, never an UPDATE of the business row.
--   - Every total and number view keeps counting every row. NOTHING in the money side is read or changed here: v_order_money, v_payment_net,
--     v_cash_month, v_month_pnl, v_gst_register, order_receivables, receivables_summary, aging, month-end, price memory and the rest are
--     exactly as 0140 left them. archive_preview READS order_receivables and v_order_state to count what is still open; it changes neither.
--   - Because unhide/rehide write only archive_unhidden, a row in a LOCKED month can be unhidden: the month lock (enforce_month_lock, 0136)
--     is on invoices, payments_in and expenses, and none of them is touched.
--
-- WHAT IS ARCHIVED (a row, by its own document date; a null date falls back to created_at on a row that is not imported, never on an
-- imported one, which is archived anyway). Dates are Karachi days:
--   rfq received_on, order ordered_on, quotation issued_on, purchase_order issued_on, supplier_order placed_on, invoice invoice_date,
--   payment (payments_in) received_on, expense paid_on, claim (expense_claims) spent_on, topup (cash_topups) drawn_on,
--   cash_count counted_on, inquiry (supplier_inquiries) sent_on, clarification first_asked_at.
--   quotations, purchase_orders, expense_claims, cash_topups, cash_counts and clarifications have no legacy_source (they are never imported).
-- A JOB (v_jobs) is archived only when its RFQ is archived and its live (not cancelled) order, if any, is archived too: an old RFQ whose
-- order is dated on or after the cutoff stays visible.
--
-- WHAT IS HERE
--   archive_settings          singleton (id = 1): enabled, cutoff, who and when. Everyone with a role reads it; only archive_set writes it.
--   archive_unhidden          the rows an admin brought back, by (entity, row id). Everyone with a role reads it; only the RPCs write it.
--   archive_hides(date, bool) the rule on its own: true when enabled and (imported or no date or date before the cutoff). NULL for a person
--                             with no role (they cannot read the setting). It reads archive_settings, so Postgres cannot inline it.
--   is_archived(entity, id)   the rule for one row by name (rfq, order, quotation, purchase_order, supplier_order, invoice, payment, expense,
--                             claim, topup, cash_count, inquiry, clarification), overrides included. NULL when the row does not exist.
--   archived(<row>)           PostgREST COMPUTED FIELDS, one per base table (13) and per list view (v_jobs, v_rfq_state, v_order_state,
--                             v_invoice_state, v_inquiry_state). `?select=id,archived&archived=is.false` hides them in a list. They read the row's
--                             own date and legacy_source (a view's function looks its row up by id), so no money column is read.
--   archive_set, archive_unhide, archive_rehide, archive_preview, archive_list
--                             admin only (42501 for everyone else, including a deactivated person), SECURITY DEFINER, search_path pinned.
--   qtech_private.archive_rows(entity)
--                             the one place that lists the thirteen entities for archive_preview and archive_list; not granted to anyone.
-- Every new object is granted to qtech_engineer too (0081's coverage test fails otherwise). The engineer reads the setting, the overrides and
-- the yes/no answers; they cannot call the five admin RPCs, and nothing here returns a price to them.
-- archived(orders|quotations|purchase_orders row) is refused to an engineer (42501). An engineer's lists must use archived(v_jobs) / archived(v_order_state), or is_archived('order', id).
--
-- DROPPING OR REPLACING A VIEW. The five archived(v_...) functions take the view's row type as their argument, so they DEPEND on the views
-- v_jobs, v_rfq_state, v_order_state, v_invoice_state and v_inquiry_state. `create or replace view` that keeps the existing columns (and
-- only appends new ones) is fine. Any future DROP VIEW, or a replace that renames or removes a column, must first drop the matching
-- archived(v_...) function and create it again afterwards (the DROP fails with "other objects depend on it" until then).
--
-- pgTAP: supabase/tests/0141_archive.test.sql. The access matrix (0025), the personas (0901), the engineer money sweep (0902) and the audit
-- count (0013) classify the new objects.

-- ================================================================ archive_settings (one row)
create table public.archive_settings (
  id          integer primary key default 1 check (id = 1),
  enabled     boolean not null default false,
  cutoff      date not null default date '2026-11-17',
  updated_by  uuid references public.users (id) on delete restrict,
  updated_at  timestamptz not null default now()
);

comment on table public.archive_settings is
  'Singleton (id = 1), 0141. enabled = hide old and imported rows from lists; cutoff = the first date that stays visible (a row dated before it is archived). Written only by archive_set (admin).';

insert into public.archive_settings (id) values (1);

create function public.archive_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.archive_settings_touch() from public, anon, authenticated;

create trigger archive_settings_touch before update on public.archive_settings
  for each row execute function public.archive_settings_touch();

alter table public.archive_settings enable row level security;

revoke all on table public.archive_settings from public, anon, authenticated;
grant select on table public.archive_settings to authenticated, qtech_engineer;

create policy archive_settings_select on public.archive_settings for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) is not null);

create trigger archive_settings_audit after insert or update or delete on public.archive_settings
  for each row execute function public.audit_row_change();

-- ================================================================ archive_unhidden (rows an admin brought back)
create table public.archive_unhidden (
  entity       text not null check (entity in ('rfq', 'order', 'quotation', 'purchase_order', 'supplier_order', 'invoice', 'payment', 'expense', 'claim', 'topup', 'cash_count', 'inquiry', 'clarification')),
  row_id       uuid not null,
  unhidden_by  uuid default auth.uid() references public.users (id) on delete restrict,
  unhidden_at  timestamptz not null default now(),
  primary key (entity, row_id)
);

comment on table public.archive_unhidden is
  '0141: a row an admin brought back to the lists although the rule would archive it (entity + row id). Written only by archive_unhide / archive_rehide. No foreign key: the row may be in any of thirteen tables.';

alter table public.archive_unhidden enable row level security;

revoke all on table public.archive_unhidden from public, anon, authenticated;
grant select on table public.archive_unhidden to authenticated, qtech_engineer;

create policy archive_unhidden_select on public.archive_unhidden for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) is not null);

create trigger archive_unhidden_audit after insert or update or delete on public.archive_unhidden
  for each row execute function public.audit_row_change('entity', 'row_id');

-- ================================================================ the rule
-- True when archiving is on and the row is imported, has no date, or is dated before the cutoff. NULL when the caller cannot read the setting
-- (no role): such a person sees no row anyway. It reads a table, so it is a plain STABLE function, not inlined.
create function public.archive_hides(p_date date, p_legacy boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select s.enabled and (coalesce(p_legacy, false) or p_date is null or p_date < s.cutoff)
          from public.archive_settings s where s.id = 1)
$$;

comment on function public.archive_hides(date, boolean) is
  '0141: true when archiving is on and (p_legacy or p_date is null or p_date < cutoff). NULL for a caller with no role. The overrides (archive_unhidden) are applied by archived() and is_archived(), not here.';

revoke all on function public.archive_hides(date, boolean) from public, anon, authenticated;
grant execute on function public.archive_hides(date, boolean) to authenticated, qtech_engineer;

-- ================================================================ is_archived(entity, id)
-- The rule for one row by name, the override included. An unknown entity, a missing row or a caller with no role gives NULL. It reads the row's
-- date and legacy_source only (columns, never the whole row). It is plpgsql on purpose: only the branch for the asked kind runs, so only that
-- table's privilege is checked. An engineer asking about an invoice, payment or expense gets NULL, because row security shows them nothing.
create function public.is_archived(p_entity text, p_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v boolean;
begin
  case p_entity
    when 'rfq' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.received_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.received_on end, x.legacy_source is not null) into v from public.rfqs x where x.id = p_id;
    when 'order' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.ordered_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.ordered_on end, x.legacy_source is not null) into v from public.orders x where x.id = p_id;
    when 'quotation' then
      select public.archive_hides(coalesce(x.issued_on, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.quotations x where x.id = p_id;
    when 'purchase_order' then
      select public.archive_hides(coalesce(x.issued_on, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.purchase_orders x where x.id = p_id;
    when 'supplier_order' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.placed_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.placed_on end, x.legacy_source is not null) into v from public.supplier_orders x where x.id = p_id;
    when 'invoice' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.invoice_date, (x.created_at at time zone 'Asia/Karachi')::date) else x.invoice_date end, x.legacy_source is not null) into v from public.invoices x where x.id = p_id;
    when 'payment' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.received_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.received_on end, x.legacy_source is not null) into v from public.payments_in x where x.id = p_id;
    when 'expense' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.paid_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.paid_on end, x.legacy_source is not null) into v from public.expenses x where x.id = p_id;
    when 'claim' then
      select public.archive_hides(coalesce(x.spent_on, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.expense_claims x where x.id = p_id;
    when 'topup' then
      select public.archive_hides(coalesce(x.drawn_on, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.cash_topups x where x.id = p_id;
    when 'cash_count' then
      select public.archive_hides(coalesce(x.counted_on, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.cash_counts x where x.id = p_id;
    when 'inquiry' then
      select public.archive_hides(case when x.legacy_source is null then coalesce(x.sent_on, (x.created_at at time zone 'Asia/Karachi')::date) else x.sent_on end, x.legacy_source is not null) into v from public.supplier_inquiries x where x.id = p_id;
    when 'clarification' then
      select public.archive_hides(coalesce((x.first_asked_at at time zone 'Asia/Karachi')::date, (x.created_at at time zone 'Asia/Karachi')::date), false) into v from public.clarifications x where x.id = p_id;
    else
      return null;
  end case;
  return v and not exists (select 1 from public.archive_unhidden u where u.entity = p_entity and u.row_id = p_id);
end;
$$;

comment on function public.is_archived(text, uuid) is
  '0141: is this row archived (hidden from lists) now? NULL for an unknown entity, a row that does not exist, or a caller with no role.';

revoke all on function public.is_archived(text, uuid) from public, anon, authenticated;
grant execute on function public.is_archived(text, uuid) to authenticated, qtech_engineer;

-- ================================================================ archived(<row>): computed fields, one per base table
create function public.archived(a public.rfqs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.received_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.received_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'rfq' and u.row_id = a.id)
$$;

create function public.archived(a public.orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.ordered_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.ordered_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'order' and u.row_id = a.id)
$$;

create function public.archived(a public.quotations)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce(a.issued_on, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'quotation' and u.row_id = a.id)
$$;

create function public.archived(a public.purchase_orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce(a.issued_on, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'purchase_order' and u.row_id = a.id)
$$;

create function public.archived(a public.supplier_orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.placed_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.placed_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'supplier_order' and u.row_id = a.id)
$$;

create function public.archived(a public.invoices)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.invoice_date, (a.created_at at time zone 'Asia/Karachi')::date) else a.invoice_date end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'invoice' and u.row_id = a.id)
$$;

create function public.archived(a public.payments_in)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.received_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.received_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'payment' and u.row_id = a.id)
$$;

create function public.archived(a public.expenses)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.paid_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.paid_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'expense' and u.row_id = a.id)
$$;

create function public.archived(a public.expense_claims)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce(a.spent_on, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'claim' and u.row_id = a.id)
$$;

create function public.archived(a public.cash_topups)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce(a.drawn_on, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'topup' and u.row_id = a.id)
$$;

create function public.archived(a public.cash_counts)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce(a.counted_on, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'cash_count' and u.row_id = a.id)
$$;

create function public.archived(a public.supplier_inquiries)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(case when a.legacy_source is null then coalesce(a.sent_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.sent_on end, a.legacy_source is not null)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'inquiry' and u.row_id = a.id)
$$;

create function public.archived(a public.clarifications)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.archive_hides(coalesce((a.first_asked_at at time zone 'Asia/Karachi')::date, (a.created_at at time zone 'Asia/Karachi')::date), false)
     and not exists (select 1 from public.archive_unhidden u where u.entity = 'clarification' and u.row_id = a.id)
$$;

revoke all on function public.archived(public.rfqs) from public, anon, authenticated;
grant execute on function public.archived(public.rfqs) to authenticated, qtech_engineer;
revoke all on function public.archived(public.orders) from public, anon, authenticated;
grant execute on function public.archived(public.orders) to authenticated, qtech_engineer;
revoke all on function public.archived(public.quotations) from public, anon, authenticated;
grant execute on function public.archived(public.quotations) to authenticated, qtech_engineer;
revoke all on function public.archived(public.purchase_orders) from public, anon, authenticated;
grant execute on function public.archived(public.purchase_orders) to authenticated, qtech_engineer;
revoke all on function public.archived(public.supplier_orders) from public, anon, authenticated;
grant execute on function public.archived(public.supplier_orders) to authenticated, qtech_engineer;
revoke all on function public.archived(public.invoices) from public, anon, authenticated;
grant execute on function public.archived(public.invoices) to authenticated, qtech_engineer;
revoke all on function public.archived(public.payments_in) from public, anon, authenticated;
grant execute on function public.archived(public.payments_in) to authenticated, qtech_engineer;
revoke all on function public.archived(public.expenses) from public, anon, authenticated;
grant execute on function public.archived(public.expenses) to authenticated, qtech_engineer;
revoke all on function public.archived(public.expense_claims) from public, anon, authenticated;
grant execute on function public.archived(public.expense_claims) to authenticated, qtech_engineer;
revoke all on function public.archived(public.cash_topups) from public, anon, authenticated;
grant execute on function public.archived(public.cash_topups) to authenticated, qtech_engineer;
revoke all on function public.archived(public.cash_counts) from public, anon, authenticated;
grant execute on function public.archived(public.cash_counts) to authenticated, qtech_engineer;
revoke all on function public.archived(public.supplier_inquiries) from public, anon, authenticated;
grant execute on function public.archived(public.supplier_inquiries) to authenticated, qtech_engineer;
revoke all on function public.archived(public.clarifications) from public, anon, authenticated;
grant execute on function public.archived(public.clarifications) to authenticated, qtech_engineer;

-- ================================================================ archived(<view row>): computed fields for the list views
-- v_jobs: a job is archived only when its RFQ is archived AND its live (not cancelled) order, if it has one, is archived too. An old RFQ
-- whose order is dated on or after the cutoff stays visible. A direct job (no RFQ) follows its order. v_jobs.order_id is the live order
-- of an enquiry job, and the order itself for a direct job.
create function public.archived(v public.v_jobs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when v.rfq_id is not null
      then public.is_archived('rfq', v.rfq_id) and (v.order_id is null or public.is_archived('order', v.order_id))
    else public.is_archived('order', v.order_id)
  end
$$;

create function public.archived(v public.v_rfq_state)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_archived('rfq', v.rfq_id)
$$;

create function public.archived(v public.v_order_state)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_archived('order', v.order_id)
$$;

create function public.archived(v public.v_invoice_state)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_archived('invoice', v.invoice_id)
$$;

create function public.archived(v public.v_inquiry_state)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_archived('inquiry', v.inquiry_id)
$$;

revoke all on function public.archived(public.v_jobs) from public, anon, authenticated;
grant execute on function public.archived(public.v_jobs) to authenticated, qtech_engineer;
revoke all on function public.archived(public.v_rfq_state) from public, anon, authenticated;
grant execute on function public.archived(public.v_rfq_state) to authenticated, qtech_engineer;
revoke all on function public.archived(public.v_order_state) from public, anon, authenticated;
grant execute on function public.archived(public.v_order_state) to authenticated, qtech_engineer;
revoke all on function public.archived(public.v_invoice_state) from public, anon, authenticated;
grant execute on function public.archived(public.v_invoice_state) to authenticated, qtech_engineer;
revoke all on function public.archived(public.v_inquiry_state) from public, anon, authenticated;
grant execute on function public.archived(public.v_inquiry_state) to authenticated, qtech_engineer;

-- ================================================================ one list of the thirteen entities (private)
-- id, the Karachi document date (null only for an imported row with no date), whether it is imported, its customer (or supplier) company,
-- a short reference, an amount where there is one, the order it belongs to, whether it is still open, and the money still open on it.
--   open: an RFQ with no order and not closed; an order that is active (v_order_state); an invoice that is not void and whose order still has a
--         balance (order_receivables: unpaid, part-paid or overdue); a claim that is pending. Nothing else is "open".
--   open_amount: for an invoice the balance of its order (the caller counts each order once); for a claim its amount.
-- Not granted to anyone: the admin-only RPCs below call it as their owner.
create function qtech_private.archive_rows(p_entity text default null)
returns table (
  entity       text,
  id           uuid,
  doc_date     date,
  is_legacy    boolean,
  company_id   uuid,
  ref          text,
  amount       numeric,
  order_id     uuid,
  is_open      boolean,
  open_amount  numeric
)
language sql
stable
set search_path = ''
as $$
  with rcv as materialized (
    select r.order_id, r.balance, r.payment_state from public.order_receivables() r
  )
  select 'rfq'::text, a.id, case when a.legacy_source is null then coalesce(a.received_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.received_on end, a.legacy_source is not null, a.company_id, a.number::text, null::numeric, null::uuid,
         (a.closed_on is null and not exists (select 1 from public.orders o where o.rfq_id = a.id and o.cancelled_on is null)),
         null::numeric
  from public.rfqs a
  where (p_entity is null or p_entity = 'rfq')
  union all
  select 'order'::text, a.id, case when a.legacy_source is null then coalesce(a.ordered_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.ordered_on end, a.legacy_source is not null, a.company_id, a.number::text, t.gross::numeric, null::uuid,
         coalesce((select os.lifecycle = 'active' from public.v_order_state os where os.order_id = a.id), false),
         null::numeric
  from public.orders a
  left join public.v_order_items_total t on t.order_id = a.id
  where (p_entity is null or p_entity = 'order')
  union all
  select 'quotation'::text, a.id, coalesce(a.issued_on, (a.created_at at time zone 'Asia/Karachi')::date), false, r.company_id,
         a.number::text || case when a.revision > 0 then '/' || a.revision::text else '' end, (a.net_total + a.gst_total)::numeric, null::uuid,
         false, null::numeric
  from public.quotations a
  join public.rfqs r on r.id = a.rfq_id
  where (p_entity is null or p_entity = 'quotation')
  union all
  select 'purchase_order'::text, a.id, coalesce(a.issued_on, (a.created_at at time zone 'Asia/Karachi')::date), false, so.supplier_id,
         a.number::text || case when a.revision > 0 then '/' || a.revision::text else '' end, a.total::numeric, so.order_id,
         false, null::numeric
  from public.purchase_orders a
  join public.supplier_orders so on so.id = a.supplier_order_id
  where (p_entity is null or p_entity = 'purchase_order')
  union all
  select 'supplier_order'::text, a.id, case when a.legacy_source is null then coalesce(a.placed_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.placed_on end, a.legacy_source is not null, a.supplier_id,
         coalesce(nullif(btrim(a.reference), ''), 'Order ' || o.number::text), null::numeric, a.order_id,
         false, null::numeric
  from public.supplier_orders a
  join public.orders o on o.id = a.order_id
  where (p_entity is null or p_entity = 'supplier_order')
  union all
  select 'invoice'::text, a.id, case when a.legacy_source is null then coalesce(a.invoice_date, (a.created_at at time zone 'Asia/Karachi')::date) else a.invoice_date end, a.legacy_source is not null, coalesce(a.company_id, o.company_id), a.number,
         (a.net_amount + a.gst_amount)::numeric, a.order_id,
         (a.voided_at is null and ob.balance is not null),
         case when a.voided_at is null then ob.balance end
  from public.invoices a
  left join public.orders o on o.id = a.order_id
  left join lateral (
    select r2.balance from rcv r2
    where r2.order_id = a.order_id and r2.payment_state <> 'settled' and r2.balance > 0
    limit 1
  ) ob on true
  where (p_entity is null or p_entity = 'invoice')
  union all
  select 'payment'::text, a.id, case when a.legacy_source is null then coalesce(a.received_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.received_on end, a.legacy_source is not null, o.company_id, a.reference, a.amount::numeric, a.order_id,
         false, null::numeric
  from public.payments_in a
  join public.orders o on o.id = a.order_id
  where (p_entity is null or p_entity = 'payment')
  union all
  select 'expense'::text, a.id, case when a.legacy_source is null then coalesce(a.paid_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.paid_on end, a.legacy_source is not null, a.payee_id,
         coalesce(nullif(btrim(a.description), ''), a.reference), a.amount_pkr::numeric, a.order_id,
         false, null::numeric
  from public.expenses a
  where (p_entity is null or p_entity = 'expense')
  union all
  select 'claim'::text, a.id, coalesce(a.spent_on, (a.created_at at time zone 'Asia/Karachi')::date), false, o.company_id, a.note, a.amount_pkr::numeric, a.order_id,
         (a.status = 'pending'), case when a.status = 'pending' then a.amount_pkr::numeric end
  from public.expense_claims a
  left join public.orders o on o.id = a.order_id
  where (p_entity is null or p_entity = 'claim')
  union all
  select 'topup'::text, a.id, coalesce(a.drawn_on, (a.created_at at time zone 'Asia/Karachi')::date), false, null::uuid, a.note, a.amount_pkr::numeric, null::uuid,
         false, null::numeric
  from public.cash_topups a
  where (p_entity is null or p_entity = 'topup')
  union all
  select 'cash_count'::text, a.id, coalesce(a.counted_on, (a.created_at at time zone 'Asia/Karachi')::date), false, null::uuid, a.note, a.counted_pkr::numeric, null::uuid,
         false, null::numeric
  from public.cash_counts a
  where (p_entity is null or p_entity = 'cash_count')
  union all
  select 'inquiry'::text, a.id, case when a.legacy_source is null then coalesce(a.sent_on, (a.created_at at time zone 'Asia/Karachi')::date) else a.sent_on end, a.legacy_source is not null, r.company_id, s.name, null::numeric, null::uuid,
         false, null::numeric
  from public.supplier_inquiries a
  join public.rfqs r on r.id = a.rfq_id
  join public.companies s on s.id = a.supplier_id
  where (p_entity is null or p_entity = 'inquiry')
  union all
  select 'clarification'::text, a.id, coalesce((a.first_asked_at at time zone 'Asia/Karachi')::date, (a.created_at at time zone 'Asia/Karachi')::date), false, r.company_id, left(a.question, 80), null::numeric, null::uuid,
         false, null::numeric
  from public.clarifications a
  join public.rfqs r on r.id = a.rfq_id
  where (p_entity is null or p_entity = 'clarification')
$$;

revoke all on function qtech_private.archive_rows(text) from public, anon, authenticated;

-- ================================================================ archive_set
create function public.archive_set(p_enabled boolean, p_cutoff date default null)
returns public.archive_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.archive_settings;
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can change the archive setting.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Say whether archiving is on or off.' using errcode = '22023';
  end if;

  update public.archive_settings s
     set enabled = p_enabled,
         cutoff = coalesce(p_cutoff, s.cutoff)
   where s.id = 1
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.archive_set(boolean, date) is
  '0141: admin only. Switches archiving on or off and, when p_cutoff is given, moves the cutoff. Returns the setting.';

revoke all on function public.archive_set(boolean, date) from public, anon, authenticated;
grant execute on function public.archive_set(boolean, date) to authenticated, qtech_engineer;

-- ================================================================ archive_unhide / archive_rehide
-- Only archive_unhidden is written: the business row is never updated, so a row in a closed month can be brought back.
create function public.archive_unhide(p_entity text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table  text;
  v_exists boolean;
  v_n      integer;
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can bring an archived row back.' using errcode = '42501';
  end if;
  v_table := case p_entity
    when 'rfq' then 'rfqs' when 'order' then 'orders' when 'quotation' then 'quotations' when 'purchase_order' then 'purchase_orders'
    when 'supplier_order' then 'supplier_orders' when 'invoice' then 'invoices' when 'payment' then 'payments_in'
    when 'expense' then 'expenses' when 'claim' then 'expense_claims' when 'topup' then 'cash_topups' when 'cash_count' then 'cash_counts'
    when 'inquiry' then 'supplier_inquiries' when 'clarification' then 'clarifications' end;
  if v_table is null then
    raise exception 'Unknown kind of record: %.', p_entity using errcode = '22023';
  end if;
  execute format('select exists (select 1 from public.%I t where t.id = $1)', v_table) into v_exists using p_id;
  if not v_exists then
    raise exception 'That record could not be found.' using errcode = 'P0002';
  end if;

  insert into public.archive_unhidden (entity, row_id, unhidden_by)
  values (p_entity, p_id, auth.uid())
  on conflict (entity, row_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.archive_unhide(text, uuid) is
  '0141: admin only. Brings one archived row back to the lists (writes archive_unhidden only). True when it was newly unhidden.';

revoke all on function public.archive_unhide(text, uuid) from public, anon, authenticated;
grant execute on function public.archive_unhide(text, uuid) to authenticated, qtech_engineer;

create function public.archive_rehide(p_entity text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can put an archived row away again.' using errcode = '42501';
  end if;
  if p_entity is null or p_entity not in ('rfq', 'order', 'quotation', 'purchase_order', 'supplier_order', 'invoice', 'payment', 'expense', 'claim', 'topup', 'cash_count', 'inquiry', 'clarification') then
    raise exception 'Unknown kind of record: %.', p_entity using errcode = '22023';
  end if;

  delete from public.archive_unhidden u where u.entity = p_entity and u.row_id = p_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.archive_rehide(text, uuid) is
  '0141: admin only. Undoes archive_unhide for one row. True when an override was removed.';

revoke all on function public.archive_rehide(text, uuid) from public, anon, authenticated;
grant execute on function public.archive_rehide(text, uuid) to authenticated, qtech_engineer;

-- ================================================================ archive_preview
-- One row per entity, for a cutoff (default: the saved one), whether archiving is on or off. would_hide counts the rows the rule would hide
-- now (imported, undated or dated before the cutoff) that are not unhidden; of_which_imported and of_which_open are parts of it;
-- already_unhidden counts the rows the rule matches that an admin brought back. open_amount_pkr: for invoices the balance still owed on their
-- orders (each order once), for claims the pending amounts; 0 elsewhere. Admin only.
create function public.archive_preview(p_cutoff date default null)
returns table (
  entity             text,
  would_hide         bigint,
  of_which_imported  bigint,
  of_which_open      bigint,
  open_amount_pkr    numeric,
  already_unhidden   bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cut date;
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can preview the archive.' using errcode = '42501';
  end if;
  v_cut := coalesce(p_cutoff, (select s.cutoff from public.archive_settings s where s.id = 1));

  return query
  with src as (
    select a.entity as k_entity, a.id as k_id, a.is_legacy as k_legacy, a.is_open as k_open, a.order_id as k_order, a.open_amount as k_amount,
           (a.is_legacy or a.doc_date is null or a.doc_date < v_cut) as k_match,
           exists (select 1 from public.archive_unhidden u where u.entity = a.entity and u.row_id = a.id) as k_unhid
    from qtech_private.archive_rows() a
  ),
  ents (e_name, e_ord) as (values ('rfq', 1), ('order', 2), ('quotation', 3), ('purchase_order', 4), ('supplier_order', 5), ('invoice', 6), ('payment', 7), ('expense', 8), ('claim', 9), ('topup', 10), ('cash_count', 11), ('inquiry', 12), ('clarification', 13))
  select e.e_name,
         count(*) filter (where s.k_match and not s.k_unhid),
         count(*) filter (where s.k_match and not s.k_unhid and s.k_legacy),
         count(*) filter (where s.k_match and not s.k_unhid and s.k_open),
         case e.e_name
           when 'invoice' then coalesce((select sum(z.bal) from (
                select distinct on (x.k_order) x.k_amount as bal
                from src x
                where x.k_entity = 'invoice' and x.k_match and not x.k_unhid and x.k_open and x.k_order is not null
                order by x.k_order) z), 0)
           when 'claim' then coalesce(sum(s.k_amount) filter (where s.k_match and not s.k_unhid and s.k_open), 0)
           else 0
         end::numeric,
         count(*) filter (where s.k_match and s.k_unhid)
  from ents e
  left join src s on s.k_entity = e.e_name
  group by e.e_name, e.e_ord
  order by e.e_ord;
end;
$$;

comment on function public.archive_preview(date) is
  '0141: admin only. Per entity: how many rows the rule would hide for this cutoff (on or off), how many are imported, how many are still open, the money open on them, and how many are already unhidden.';

revoke all on function public.archive_preview(date) from public, anon, authenticated;
grant execute on function public.archive_preview(date) to authenticated, qtech_engineer;

-- ================================================================ archive_list
-- The browse screen: the rows the rule matches at the saved cutoff (imported, undated or dated before it), including the ones an admin brought back
-- (is_unhidden) so they can be put away again. It lists them whether archiving is on or off, so the screen can be opened before the switch is turned on;
-- the screen says which. Newest document first. p_entity null = every kind. p_search matches the reference or the company name.
create function public.archive_list(
  p_entity     text default null,
  p_company_id uuid default null,
  p_search     text default null,
  p_limit      integer default 50,
  p_offset     integer default 0
)
returns table (
  id            uuid,
  entity        text,
  ref           text,
  company_id    uuid,
  company_name  text,
  doc_date      date,
  amount        numeric,
  is_imported   boolean,
  is_unhidden   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cut date;
  v_q   text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select public.current_user_role()) is distinct from 'admin' then
    raise exception 'Only an admin can browse the archive.' using errcode = '42501';
  end if;
  if p_entity is not null and p_entity not in ('rfq', 'order', 'quotation', 'purchase_order', 'supplier_order', 'invoice', 'payment', 'expense', 'claim', 'topup', 'cash_count', 'inquiry', 'clarification') then
    raise exception 'Unknown kind of record: %.', p_entity using errcode = '22023';
  end if;
  select s.cutoff into v_cut from public.archive_settings s where s.id = 1;

  return query
  select a.id, a.entity, a.ref, a.company_id, c.name, a.doc_date, a.amount, a.is_legacy,
         exists (select 1 from public.archive_unhidden u where u.entity = a.entity and u.row_id = a.id)
  from qtech_private.archive_rows(p_entity) a
  left join public.companies c on c.id = a.company_id
  where (p_company_id is null or a.company_id = p_company_id)
    and (a.is_legacy or a.doc_date is null or a.doc_date < v_cut)
    and (v_q is null or strpos(lower(coalesce(a.ref, '')), v_q) > 0 or strpos(lower(coalesce(c.name, '')), v_q) > 0)
  order by a.doc_date desc nulls last, a.id
  limit v_lim offset v_off;
end;
$$;

comment on function public.archive_list(text, uuid, text, integer, integer) is
  '0141: admin only. The rows the rule matches at the saved cutoff, archiving on or off: id, kind, reference, company, document date, amount, imported flag, unhidden flag.';

revoke all on function public.archive_list(text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.archive_list(text, uuid, text, integer, integer) to authenticated, qtech_engineer;
