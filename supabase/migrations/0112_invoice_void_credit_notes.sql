-- 0112_invoice_void_credit_notes (money-integrity audit C1: an invoice with a number is never deleted).
--
-- WHY. delete_invoice (0092) could hard-delete any invoice, so a number FBR had seen could vanish. There was no void and no credit
-- note. This migration:
--   A. Void. An invoice keeps its row and its number. voided_at / voided_by / void_reason say when, who and why; the figures it
--      had move to voided_net / voided_gst and net_amount = gst_amount = 0, so every SUM over invoices anywhere (receivables,
--      aging, the GST month, sales, P&L, snapshots) already leaves it out. Counts of invoices ignore voided rows (patched below).
--      void_invoice() is the only way to void; it refuses while the invoice is filed (PSID, tax deposit or a bank tick), while
--      its GST month is closed, while a payment is applied to it, or when a credit note exists against it. The refusals point to
--      a Credit note.
--   B. Credit notes: credit_notes (CN-0001 series), one invoice each, full or partial, with its own GST, immutable once issued.
--      create_credit_note() is the door. A credit note reduces the order's receivable and the output GST of the month it is
--      ISSUED in (v_gst_month, v_month_profit), shows in the GST register as a negative line, and reduces what aging lists.
--   C. Hard delete stays only for an invoice with no number: delete_invoice and a delete trigger refuse a numbered invoice and
--      point to Void.
--
-- Expand-only: new nullable columns, a new table, new functions; CREATE OR REPLACE of existing views and functions keeps every
-- column and signature (v_invoice_state, v_gst_register and v_gst_month get extra columns at the END). The one behaviour that
-- tightens is deleting a numbered invoice, which is the point of the change.
-- Engineers see no money: credit_notes is granted to qtech_engineer like every table (0081) and its policies admit admin and
-- sales only.

-- ================================================================ A. void columns
alter table public.invoices
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.users (id) on delete restrict,
  add column void_reason text,
  add column voided_net  numeric(14,2),
  add column voided_gst  numeric(14,2);

alter table public.invoices add constraint invoices_void_shape check (
  (voided_at is null and voided_by is null and void_reason is null and voided_net is null and voided_gst is null)
  or (voided_at is not null and net_amount = 0 and gst_amount = 0 and voided_net is not null and voided_gst is not null
      and char_length(btrim(void_reason)) between 1 and 300));

comment on column public.invoices.voided_at is
  '0112: set by void_invoice(). A void invoice keeps its number and row; net_amount and gst_amount are 0 and the figures it had are in voided_net / voided_gst.';

create index invoices_voided_idx on public.invoices (voided_at) where voided_at is not null;

-- ================================================================ B. credit notes
create table public.credit_notes (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references public.users (id) on delete restrict,
  number       text not null,
  invoice_id   uuid not null references public.invoices (id) on delete restrict,
  order_id     uuid references public.orders (id) on delete restrict,
  company_id   uuid references public.companies (id) on delete restrict,
  issued_on    date not null default public.today_pkt(),
  net_amount   numeric(14,2) not null check (net_amount > 0),
  gst_amount   numeric(14,2) not null check (gst_amount >= 0),
  reason       text not null check (char_length(btrim(reason)) between 1 and 300),
  constraint credit_notes_gst_within_net check (gst_amount <= net_amount)
);

comment on table public.credit_notes is
  '0112: a numbered credit note (CN-0001 series) against one invoice, full or partial, with its own GST. Immutable once issued. '
  'It reduces the receivable and the output GST of the month it is issued in. Admin and sales read; created by create_credit_note().';

create unique index credit_notes_number_key on public.credit_notes (lower(btrim(number)));
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);
create index credit_notes_order_idx on public.credit_notes (order_id) where order_id is not null;
create index credit_notes_issued_idx on public.credit_notes (issued_on);

-- The guard: the invoice must be a live numbered one, the credit cannot exceed what is left of it, the GST follows the invoice's
-- own GST (within Rs 1, or exactly the rest when the credit completes the invoice). A credit note is never changed or removed.
create function public.credit_notes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.invoices;
  v_net   numeric;
  v_gst   numeric;
  v_exp   numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'A credit note is kept as it was issued. Issue another credit note to correct it.'
      using errcode = 'P0001', hint = 'credit_note_kept';
  end if;
  new.number := btrim(new.number);
  select * into v from public.invoices i where i.id = new.invoice_id for update;
  if not found then
    raise exception 'That invoice is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v.voided_at is not null then
    raise exception 'Invoice % is void, so it cannot take a credit note.', v.number using errcode = 'P0001', hint = 'invoice_void';
  end if;
  if v.number is null then
    raise exception 'This invoice has no number, so a credit note cannot be issued against it.' using errcode = 'P0001', hint = 'no_number';
  end if;
  new.order_id := v.order_id;
  new.company_id := coalesce(v.company_id, (select o.company_id from public.orders o where o.id = v.order_id));
  select coalesce(sum(c.net_amount), 0), coalesce(sum(c.gst_amount), 0) into v_net, v_gst
  from public.credit_notes c where c.invoice_id = new.invoice_id;
  if v_net + new.net_amount > v.net_amount or v_gst + new.gst_amount > v.gst_amount then
    raise exception 'Credit notes on % would come to more than the invoice itself (net left to credit: Rs %).',
      v.number, to_char(v.net_amount - v_net, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'over_credited';
  end if;
  v_exp := round(v.gst_amount * new.net_amount / v.net_amount, 0);
  if abs(new.gst_amount - v_exp) > 1
     and not (v_net + new.net_amount = v.net_amount and v_gst + new.gst_amount = v.gst_amount) then
    raise exception 'The GST on this credit note (Rs %) does not follow the invoice''s GST. It should be about Rs %.',
      to_char(new.gst_amount, 'FM999,999,999,990.00'), to_char(v_exp, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'gst_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.credit_notes_guard() from public, anon, authenticated;

create trigger credit_notes_guard before insert or update or delete on public.credit_notes
  for each row execute function public.credit_notes_guard();
create trigger credit_notes_force_created_by before insert or update on public.credit_notes
  for each row execute function public.force_created_by();
create trigger credit_notes_audit after insert or update or delete on public.credit_notes
  for each row execute function public.audit_row_change();

alter table public.credit_notes enable row level security;
revoke all on table public.credit_notes from public, anon, authenticated;
grant select, insert on table public.credit_notes to authenticated, qtech_engineer;   -- 0081 mirror; the policies below admit admin and sales only

create policy credit_notes_select on public.credit_notes for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) in ('admin', 'sales'));
create policy credit_notes_insert on public.credit_notes for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');

-- Next number: CN-0001, CN-0002, ... one past the highest. create_credit_note holds an advisory lock, so two never read the same.
create function public.next_credit_note_number()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'CN-' || lpad((coalesce(max(substr(c.number, 4)::bigint), 0) + 1)::text, 4, '0')
  from public.credit_notes c
  where c.number ~ '^CN-[0-9]{1,15}$'
$$;

revoke all on function public.next_credit_note_number() from public, anon, authenticated;
grant execute on function public.next_credit_note_number() to authenticated, qtech_engineer;   -- 0081 mirror; credit_notes has no row for an engineer

-- create_credit_note: admin only. p_gst NULL = the invoice's GST in proportion (the whole of what is left when the credit
-- completes the invoice).
create function public.create_credit_note(p_invoice_id uuid, p_net numeric, p_reason text, p_gst numeric default null, p_issued_on date default null)
returns table (credit_note_id uuid, number text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v      public.invoices;
  v_net  numeric;
  v_gst  numeric;
  v_use  numeric;
  v_id   uuid := gen_random_uuid();
  v_no   text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can issue a credit note.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_net is null or p_net <= 0 then
    raise exception 'Enter the amount to credit (without GST).' using errcode = '22023', hint = 'amount';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the credit note is issued.' using errcode = '22023', hint = 'reason';
  end if;
  select * into v from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'That invoice is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  select coalesce(sum(c.net_amount), 0), coalesce(sum(c.gst_amount), 0) into v_net, v_gst
  from public.credit_notes c where c.invoice_id = p_invoice_id;
  if p_gst is not null then
    v_use := p_gst;
  elsif v_net + p_net >= v.net_amount then
    v_use := v.gst_amount - v_gst;
  else
    v_use := least(round(v.gst_amount * p_net / nullif(v.net_amount, 0), 0), v.gst_amount - v_gst);
  end if;
  perform pg_advisory_xact_lock(hashtext('qtech.credit_note_number'));
  v_no := public.next_credit_note_number();
  insert into public.credit_notes (id, number, invoice_id, issued_on, net_amount, gst_amount, reason)
  values (v_id, v_no, p_invoice_id, coalesce(p_issued_on, public.today_pkt()), p_net, greatest(coalesce(v_use, 0), 0), btrim(p_reason));
  return query select v_id, v_no;
end;
$$;

revoke all on function public.create_credit_note(uuid, numeric, text, numeric, date) from public, anon, authenticated;
grant execute on function public.create_credit_note(uuid, numeric, text, numeric, date) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ================================================================ void_invoice
create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v        public.invoices;
  v_paid   numeric;
  v_before numeric;
  v_gross  numeric;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can void an invoice.' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the invoice is voided.' using errcode = '22023', hint = 'reason';
  end if;
  select * into v from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'This invoice is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v.voided_at is not null then
    raise exception 'Invoice % is already void.', v.number using errcode = 'P0001', hint = 'already_void';
  end if;
  if v.number is null then
    raise exception 'This invoice has no number. Delete it instead of voiding it.' using errcode = 'P0001', hint = 'use_delete';
  end if;
  if nullif(btrim(v.psid), '') is not null or v.tax_deposited_on is not null or v.tax_bank_month is not null then
    raise exception 'Invoice % has a PSID or a tax deposit recorded, so it cannot be voided. Issue a credit note instead.', v.number
      using errcode = 'P0001', hint = 'filed';
  end if;
  if exists (select 1 from public.credit_notes c where c.invoice_id = v.id) then
    raise exception 'Invoice % already has a credit note, so it cannot be voided.', v.number using errcode = 'P0001', hint = 'has_credit_note';
  end if;
  if v.invoice_date is not null and public.month_is_closed(v.invoice_date) then
    raise exception '% is closed, so invoice % cannot be voided. Issue a credit note instead.',
      to_char(v.invoice_date, 'FMMonth YYYY'), v.number using errcode = 'P0001', hint = 'month_closed';
  end if;
  if v.order_id is not null then
    -- the payments on the order are applied oldest invoice first (as aging_as_of does): is any of them on this invoice?
    select coalesce(sum(p.amount), 0) into v_paid from public.payments_in p where p.order_id = v.order_id and p.voided_at is null;
    select coalesce(sum(o.net_amount + o.gst_amount
                        - coalesce((select sum(c.net_amount + c.gst_amount) from public.credit_notes c where c.invoice_id = o.id), 0)), 0)
      into v_before
    from public.invoices o
    where o.order_id = v.order_id and o.voided_at is null and o.id <> v.id
      and (coalesce(o.invoice_date, 'infinity'::date), o.number, o.id) < (coalesce(v.invoice_date, 'infinity'::date), v.number, v.id);
    v_gross := v.net_amount + v.gst_amount;
    if least(v_gross, greatest(v_paid - v_before, 0)) > 0 then
      raise exception 'A payment is already applied to invoice %, so it cannot be voided. Issue a credit note instead.', v.number
        using errcode = 'P0001', hint = 'paid';
    end if;
  end if;

  perform set_config('qtech.void_invoice', 'on', true);
  update public.invoices i
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason),
      voided_net = i.net_amount, voided_gst = i.gst_amount, net_amount = 0, gst_amount = 0
  where i.id = v.id;
  perform set_config('qtech.void_invoice', '', true);
end;
$$;

revoke all on function public.void_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ================================================================ C. hard delete only for an unnumbered invoice
create or replace function public.delete_invoice(p_invoice_id uuid)
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
  select i.id, i.number, i.tax_bank_month into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'This invoice is no longer there. Reload the page.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_inv.number is not null then
    raise exception 'Invoice % has a number, so it is kept. Void it instead: the number stays in the register.', v_inv.number
      using errcode = 'P0001', hint = 'use_void';
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

create function public.invoices_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.number is not null then
    raise exception 'Invoice % has a number, so it is kept. Void it instead: the number stays in the register.', old.number
      using errcode = 'P0001', hint = 'use_void';
  end if;
  return old;
end;
$$;

revoke all on function public.invoices_no_delete() from public, anon, authenticated;
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function public.invoices_no_delete();

-- ================================================================ D. views and functions that count invoices
-- Each is its previous definition with a voided-invoice filter and, where it adds up what an order is invoiced, the order's credit
-- notes taken off. Generated from the current definitions (the text below is exactly them plus those lines).

-- ---------------------------------------------------------------- v_order_basis
create or replace view public.v_order_basis with (security_invoker = true) as
select
  o.id as order_id,
  i.invoice_count,
  i.invoice_net,
  i.invoice_gross,
  t.net   as items_net,
  t.gross as items_gross,
  case when i.invoice_count > 0 then 'invoice' else 'items' end as basis,
  case when i.invoice_count > 0 then i.invoice_net   else t.net   end as n,
  case when i.invoice_count > 0 then i.invoice_gross else t.gross end as g
from public.orders o
join public.v_order_items_total t on t.order_id = o.id
cross join lateral (
  select count(*) as invoice_count,
         coalesce(sum(v.net_amount), 0) - (select coalesce(sum(c.net_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_net,
         coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross
  from public.invoices v
  where v.order_id = o.id and v.voided_at is null
) i
where public.current_user_role() = 'admin';

-- ---------------------------------------------------------------- order_receivables
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
           coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross,
           min(coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)) as first_invoice_date,
           max(v.last_reminded_on) as last_reminded_on,
           coalesce(max(v.reminder_count), 0)::smallint as reminder_count
    from public.invoices v
    where v.order_id = o.id and v.voided_at is null
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

-- ---------------------------------------------------------------- v_order_money
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
                                                  where v.order_id = o.id and v.voided_at is null and v.legacy_review is distinct from 'settled'))) as reviewed
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
  where v.order_id = o.id and v.voided_at is null
) d
where (select public.current_user_role()) = 'admin';

-- ---------------------------------------------------------------- aging_as_of
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
           v.net_amount + v.gst_amount
             - coalesce((select sum(c.net_amount + c.gst_amount) from public.credit_notes c
                         where c.invoice_id = v.id and c.issued_on <= p_date), 0) as gross,
           (v.legacy_review = 'settled' or o.legacy_review = 'settled') as reviewed_settled
    from public.invoices v
    left join public.orders o on o.id = v.order_id
    where coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= p_date
      and not v.settled_before_cutover
      and v.voided_at is null
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

-- ---------------------------------------------------------------- v_order_state
create or replace view public.v_order_state with (security_invoker = true) as
select
  o.id as order_id,
  o.number,
  o.company_id,
  o.site_id,
  o.rfq_id,
  o.owner_id,
  case
    when o.cancelled_on is not null then 'cancelled'
    when dn.is_done then 'done'
    else 'active'
  end as lifecycle,
  dn.is_done,
  t.net,
  t.gst,
  t.gross,
  case when r.role in ('admin', 'sales') then iv.invoiced_gross end as invoiced,
  gs.goods_state,
  cs.commissioning_state,
  case when r.role in ('admin', 'sales') then ivs.invoicing_state end as invoicing_state,
  case
    when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
    when o.legacy_flags && array['dates_estimated', 'undated'] or gs.legs_estimated then 'estimated_dates'
    else 'ok'
  end as data_trust
from public.orders o
join public.v_order_items_total t on t.order_id = o.id
cross join lateral (select public.current_user_role() as role) r
cross join lateral (
  select
    count(*) filter (where not i.is_service) as goods_items,
    count(*) filter (where not i.is_service and i.supplier_order_id is null) as unsourced
  from public.order_items i
  where i.order_id = o.id
) gi
cross join lateral (
  select
    count(*)                                                            as n_legs,
    count(*) filter (where l.placed_on is null)                         as n_unplaced,
    count(*) filter (where l.delivered_on is not null)                  as n_delivered,
    count(*) filter (where l.received_on is not null or l.delivered_on is not null) as n_received,
    count(*) filter (where l.expected_on < public.today_pkt()
                       and l.received_on is null and l.delivered_on is null)       as n_late,
    coalesce(bool_or('dates_estimated' = any (l.legacy_flags)), false)  as legs_estimated
  from public.supplier_orders l
  where l.id in (select i.supplier_order_id from public.order_items i
                 where i.order_id = o.id and not i.is_service and i.supplier_order_id is not null)
) lg
cross join lateral (
  select
    case
      when gi.goods_items = 0 then 'n_a'
      when gi.unsourced > 0 then 'to_source'
      when lg.n_unplaced > 0 then 'to_place'
      when lg.n_delivered = lg.n_legs then 'delivered'
      when lg.n_received = lg.n_legs then 'received'
      when lg.n_late > 0 then 'late'
      when lg.n_delivered > 0 then 'partly_delivered'
      else 'on_order'
    end as goods_state,
    lg.legs_estimated
) gs
cross join lateral (
  select case
    when not o.needs_commissioning then 'n_a'
    when o.commissioning_done_on is not null then 'done'
    when o.commissioning_planned_on is not null then 'planned'
    else 'to_plan'
  end as commissioning_state
) cs
cross join lateral (
  select count(*) as invoice_count,
         coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoiced_gross
  from public.invoices v
  where v.order_id = o.id and v.voided_at is null
) iv
cross join lateral (
  select case
    when iv.invoice_count = 0 then 'not_invoiced'
    when iv.invoiced_gross >= t.gross - 1 then 'fully_invoiced'
    else 'part'
  end as invoicing_state
) ivs
left join public.v_order_money m on m.order_id = o.id
cross join lateral (
  select
    o.cancelled_on is null
    and gs.goods_state in ('n_a', 'delivered')
    and cs.commissioning_state in ('n_a', 'done')
    and case r.role
          when 'admin' then ivs.invoicing_state = 'fully_invoiced'
                            and coalesce(m.payment_state = 'settled', false)
                            and coalesce(m.costs_state = 'complete', false)
          when 'sales' then ivs.invoicing_state = 'fully_invoiced'
          else true
        end as is_done
) dn
where r.role is not null;

-- ---------------------------------------------------------------- held_advances
create or replace function public.held_advances()
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
    and not exists (select 1 from public.invoices v where v.order_id = o.id and v.voided_at is null)
    and (select public.current_user_role()) = 'admin'
  order by o.cancelled_on desc, o.number desc
$$;

-- ---------------------------------------------------------------- job_stage
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

-- ---------------------------------------------------------------- my_target_progress_at
create or replace function public.my_target_progress_at(p_at timestamptz)
returns table (
  year            smallint,
  quarter         smallint,
  quarter_end     date,
  target_net      numeric,
  achieved_net    numeric,
  gap             numeric,
  on_pace_net     numeric,
  behind_pace     numeric,
  excluded_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := public.today_pkt(p_at);
  v_year    smallint := extract(year from public.today_pkt(p_at))::smallint;
  v_quarter smallint := extract(quarter from public.today_pkt(p_at))::smallint;
  v_start   date;
  v_next    date;
  v_total   integer;
  v_elapsed integer;
  v_target  numeric;
  v_ach     numeric;
  v_excl    integer;
  v_pace    numeric;
begin
  if public.current_user_role() is null then
    return;
  end if;

  v_start := make_date(v_year, (v_quarter - 1) * 3 + 1, 1);
  v_next := (v_start + interval '3 months')::date;
  v_total := v_next - v_start;
  v_elapsed := least(greatest(v_today - v_start + 1, 0), v_total);

  select t.target_net_pkr into v_target
  from public.targets t
  where t.user_id = v_uid and t.year = v_year and t.quarter = v_quarter;

  select
    coalesce(sum(x.net) filter (where x.reason is null), 0),
    count(*) filter (where x.reason is not null)
  into v_ach, v_excl
  from (
    select
      case
        when 'value_basis_unknown' = any (o.legacy_flags) then 'basis_unknown'
        when b.g = 0 then 'zero_value'
      end as reason,
      case
        when 'value_basis_unknown' = any (o.legacy_flags) or b.g = 0 then null
        else round(p.amount * b.n / b.g, 2)
      end as net
    from public.payments_in p
    join public.orders o on o.id = p.order_id
    join public.v_order_items_total t on t.order_id = o.id
    cross join lateral (
      select count(*) as invoice_count,
             coalesce(sum(v.net_amount), 0) - (select coalesce(sum(c.net_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_net,
             coalesce(sum(v.net_amount + v.gst_amount), 0) - (select coalesce(sum(c.net_amount + c.gst_amount), 0) from public.credit_notes c where c.order_id = o.id) as invoice_gross
      from public.invoices v
      where v.order_id = o.id and v.voided_at is null
    ) iv
    cross join lateral (
      select case when iv.invoice_count > 0 then iv.invoice_net else t.net end as n,
             case when iv.invoice_count > 0 then iv.invoice_gross else t.gross end as g
    ) b
    where p.credited_user_id = v_uid
      and p.voided_at is null
      and p.received_on >= v_start
      and p.received_on < v_next
  ) x;

  if v_target is not null then
    v_pace := round(v_target * v_elapsed / v_total, 2);
  end if;

  return query select
    v_year,
    v_quarter,
    (v_next - 1),
    v_target,
    v_ach::numeric(14,2),
    case when v_target is not null then greatest(v_target - v_ach, 0) end,
    v_pace,
    case when v_target is not null then greatest(v_pace - v_ach, 0) end,
    v_excl;
end;
$$;

-- ---------------------------------------------------------------- v_invoice_state
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
  case when i.reminder_count > 0 then 'reminded' else 'not_reminded' end as reminder_state,
  i.voided_at,
  i.void_reason
from public.invoices i
cross join lateral (
  select (nullif(btrim(i.psid), '') is not null or 'fbr_generated_legacy' = any (i.legacy_flags)) as generated
) g
where (select public.current_user_role()) in ('admin', 'sales');

-- ---------------------------------------------------------------- v_month_profit
create or replace view public.v_month_profit with (security_invoker = true) as
with
inv as (
  -- 0112: a void invoice carries 0 and is not counted; a credit note is a negative line in the month it is issued
  select u.month, sum(u.net) as sales_net, sum(u.gst) as sales_gst, sum(u.n)::int as invoice_count
  from (
    select date_trunc('month', v.invoice_date)::date as month, v.net_amount as net, v.gst_amount as gst, 1 as n
    from public.invoices v
    where v.invoice_date is not null and v.voided_at is null
    union all
    select date_trunc('month', c.issued_on)::date, - c.net_amount, - c.gst_amount, 0
    from public.credit_notes c
  ) u
  group by 1
),
first_inv as (
  select v.order_id, date_trunc('month', min(v.invoice_date))::date as month
  from public.invoices v
  where v.order_id is not null and v.invoice_date is not null and v.voided_at is null
  group by 1
),
ex as (
  select
    date_trunc('month', e.paid_on)::date                                                   as paid_month,
    c.grp,
    e.amount_pkr - e.input_tax_pkr                                                         as net,
    e.input_tax_pkr                                                                        as tax,
    case
      when c.grp = 'overhead' then date_trunc('month', e.paid_on)::date
      when c.grp <> 'order_cost' then null
      when e.order_id is null then date_trunc('month', e.paid_on)::date
      when f.month is not null then greatest(f.month, date_trunc('month', e.paid_on)::date)
      when o.cancelled_on is not null then greatest(date_trunc('month', o.cancelled_on)::date, date_trunc('month', e.paid_on)::date)
    end                                                                                    as cost_month
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  left join first_inv f on f.order_id = e.order_id
  left join public.orders o on o.id = e.order_id
),
matched as (
  select x.cost_month as month,
         sum(x.net) filter (where x.grp = 'order_cost') as order_costs_matched,
         sum(x.net) filter (where x.grp = 'overhead')   as overheads
  from ex x where x.cost_month is not null
  group by 1
),
paid as (
  select x.paid_month as month,
         sum(x.net) filter (where x.grp = 'order_cost') as order_costs_paid,
         sum(x.net) filter (where x.grp = 'non_pnl')    as non_pnl_paid,
         sum(x.tax)                                     as input_tax_paid
  from ex x
  group by 1
),
months as (
  select i.month from inv i union select m.month from matched m union select p.month from paid p
)
select
  k.month,
  coalesce(i.sales_net, 0)                                                                    as sales_net,
  coalesce(i.sales_gst, 0)                                                                    as sales_gst,
  coalesce(i.invoice_count, 0)                                                                as invoice_count,
  coalesce(m.order_costs_matched, 0)                                                          as order_costs_matched,
  coalesce(m.overheads, 0)                                                                    as overheads,
  coalesce(i.sales_net, 0) - coalesce(m.order_costs_matched, 0) - coalesce(m.overheads, 0)    as profit,
  coalesce(p.order_costs_paid, 0)                                                             as order_costs_paid,
  coalesce(p.non_pnl_paid, 0)                                                                 as non_pnl_paid,
  coalesce(p.input_tax_paid, 0)                                                               as input_tax_paid
from months k
left join inv i on i.month = k.month
left join matched m on m.month = k.month
left join paid p on p.month = k.month
where (select public.current_user_role()) = 'admin';


-- ---------------------------------------------------------------- v_gst_register: void flag, and credit notes as negative lines
-- The invoice rows are 0014's (a void invoice is listed with its number and 0 / 0). Credit notes follow as rows of their own:
-- row_kind = 'credit_note', invoice_id = the credit note's id, against_invoice_id = the invoice it credits, net / GST / gross
-- negative, dated on the day issued, so the register adds up to the month's GST. No other view reads them as invoices.
create or replace view public.v_gst_register with (security_invoker = true) as
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
  i.tax_deposit_amount,
  s.voided_at,
  s.void_reason,
  'invoice'::text as row_kind,
  null::uuid as against_invoice_id,
  null::text as against_number
from public.v_invoice_state s
join public.invoices i on i.id = s.invoice_id
left join public.orders o on o.id = s.order_id
left join public.companies c on c.id = coalesce(s.company_id, o.company_id)
where (select public.current_user_role()) in ('admin', 'sales')
union all
select
  cn.id,
  cn.issued_on,
  date_trunc('month', cn.issued_on)::date,
  cn.number,
  cn.order_id,
  o.number,
  coalesce(cn.company_id, o.company_id),
  c.name,
  (- cn.net_amount)::numeric(14,2),
  (- cn.gst_amount)::numeric(14,2),
  - (cn.net_amount + cn.gst_amount),
  'not_started'::text,
  'credit_note'::text,
  false,
  false,
  null::text,
  null::date,
  null::numeric(14,2),
  null::timestamptz,
  null::text,
  'credit_note'::text,
  cn.invoice_id,
  iv.number
from public.credit_notes cn
join public.invoices iv on iv.id = cn.invoice_id
left join public.orders o on o.id = cn.order_id
left join public.companies c on c.id = coalesce(cn.company_id, o.company_id)
where (select public.current_user_role()) in ('admin', 'sales');

-- ---------------------------------------------------------------- v_gst_month: output GST net of the credit notes of the month
-- 0028's columns, then: net and gst are the month's invoices less its credit notes (by the day the credit note is issued);
-- invoice_count and the deposit counts are invoices only (a void invoice is not counted); gst_to_deposit is the GST of invoices
-- not yet deposited less the credit notes' GST. The credit notes themselves are the three columns added at the end.
create or replace view public.v_gst_month with (security_invoker = true) as
with inv as (
  select
    date_trunc('month', v.invoice_date)::date as month,
    count(*)::int                                                          as invoice_count,
    sum(v.net_amount)                                                      as net,
    sum(v.gst_amount)                                                      as gst,
    (count(*) filter (where v.psid is not null))::int                      as psid_set_count,
    (count(*) filter (where v.tax_deposited_on is not null))::int          as deposited_count,
    coalesce(sum(v.tax_deposit_amount) filter (where v.tax_deposited_on is not null), 0) as deposited_amount,
    coalesce(sum(v.gst_amount) filter (where v.tax_deposited_on is null), 0)             as gst_to_deposit
  from public.invoices v
  where v.invoice_date is not null and v.voided_at is null
  group by 1
),
cn as (
  select date_trunc('month', c.issued_on)::date as month,
         count(*)::int as credit_note_count, sum(c.net_amount) as credit_net, sum(c.gst_amount) as credit_gst
  from public.credit_notes c
  group by 1
),
itx as (
  select date_trunc('month', e.paid_on)::date as month, sum(e.input_tax_pkr) as input_tax
  from public.expenses e
  group by 1
  having sum(e.input_tax_pkr) > 0
),
months as (
  select i.month from inv i union select c.month from cn c union select x.month from itx x
)
select
  m.month                                                          as month,
  coalesce(i.invoice_count, 0)                                     as invoice_count,
  coalesce(i.net, 0) - coalesce(c.credit_net, 0)                   as net,
  coalesce(i.gst, 0) - coalesce(c.credit_gst, 0)                   as gst,
  coalesce(i.psid_set_count, 0)                                    as psid_set_count,
  coalesce(i.deposited_count, 0)                                   as deposited_count,
  coalesce(i.deposited_amount, 0)                                  as deposited_amount,
  coalesce(i.gst_to_deposit, 0) - coalesce(c.credit_gst, 0)        as gst_to_deposit,
  case when public.current_user_role() = 'admin' then coalesce(x.input_tax, 0) end as input_tax,
  coalesce(c.credit_note_count, 0)                                 as credit_note_count,
  coalesce(c.credit_net, 0)                                        as credit_net,
  coalesce(c.credit_gst, 0)                                        as credit_gst
from months m
left join inv i on i.month = m.month
left join cn c on c.month = m.month
left join itx x on x.month = m.month
where public.current_user_role() in ('admin', 'sales');
