-- 0136_costs_on_enquiries_and_visits: an expense, and an engineer's claim, can belong to an enquiry (RFQ) and to a visit, not only to an
-- order. EXPAND-ONLY: four nullable columns, two functions replaced, one view added. No existing row is changed by this migration.
--
-- Why: money spent while an enquiry is still an enquiry (a survey visit, samples, travel to measure) had nowhere to go but "no order".
-- Now it is tied to the RFQ. When the RFQ is won, that cost moves onto the order, so the order's profit counts it. When the RFQ is lost,
-- the cost stays on the RFQ and shows as its own line (v_enquiry_costs). The P&L totals do not change: it is the same expense row, still
-- paid on the same day (cash P&L reads paid_on); only the order it is attributed to changes.
--
--   expenses.rfq_id, expenses.visit_id             nullable; on delete set null (a cost is never lost with its RFQ or visit)
--   expense_claims.rfq_id, expense_claims.visit_id the same pair on an engineer's "I paid"
--   link_cost_prepare (before insert/update)       keeps the links consistent: a visit fills order_id from the visit (a different order is
--                                                  refused); an RFQ that already has a live order fills order_id; an order that belongs to
--                                                  another RFQ than the one given is refused
--   orders_adopt_rfq_costs (after insert on orders) when an order is made from an RFQ, that RFQ's costs and claims with no order get it
--   enforce_month_lock                             recreated whole from its latest definition (0089 + 0092 + 0115 + 0126 + 0128). One new
--                                                  closed-month change is allowed: order_id going from empty to the order of the expense's
--                                                  own RFQ (and nothing else in the row); rfq_id / visit_id going empty when the RFQ or visit
--                                                  is removed. Every other closed-month edit is refused as before.
--   rfqs_costs_guard (before delete on rfqs)       an RFQ that has costs cannot be deleted (it would orphan real money); delete the costs first
--   approve_expense_claim                          replaced: the expense gets the claim's RFQ and visit
--   v_enquiry_costs                                admin only: per RFQ with costs, its customer, state (open / lost / ordered) and net spent

-- ================================================================ the columns
alter table public.expenses
  add column rfq_id   uuid references public.rfqs (id) on delete set null,
  add column visit_id uuid references public.order_visits (id) on delete set null;
alter table public.expense_claims
  add column rfq_id   uuid references public.rfqs (id) on delete set null,
  add column visit_id uuid references public.order_visits (id) on delete set null;

create index expenses_rfq_idx on public.expenses (rfq_id) where rfq_id is not null;
create index expenses_visit_idx on public.expenses (visit_id) where visit_id is not null;
create index expense_claims_rfq_idx on public.expense_claims (rfq_id) where rfq_id is not null;
create index expense_claims_visit_idx on public.expense_claims (visit_id) where visit_id is not null;

comment on column public.expenses.rfq_id is '0136: the enquiry this cost was spent on. When the RFQ becomes an order the cost gets that order_id too.';
comment on column public.expenses.visit_id is '0136: the visit this cost was spent on; its order is the cost''s order.';
comment on column public.expense_claims.rfq_id is '0136: the enquiry the engineer spent on.';
comment on column public.expense_claims.visit_id is '0136: the visit the engineer spent on (their own visit today by default in the app).';

-- ================================================================ keep the links consistent
-- SECURITY DEFINER so it reads visits and orders whatever the caller may see; it writes nothing but NEW.
create function public.link_cost_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_order uuid;
  v_order_rfq   uuid;
  v_live        uuid;
begin
  if new.visit_id is not null then
    select v.order_id into v_visit_order from public.order_visits v where v.id = new.visit_id;
    if found then
      if new.order_id is null then
        new.order_id := v_visit_order;
      elsif new.order_id <> v_visit_order then
        raise exception 'That visit belongs to a different order.' using errcode = 'P0001', hint = 'visit_order_mismatch';
      end if;
    end if;
  end if;

  if new.rfq_id is not null then
    if new.order_id is null then
      select o.id into v_live from public.orders o
      where o.rfq_id = new.rfq_id and o.cancelled_on is null
      order by o.created_at
      limit 1;
      new.order_id := v_live;
    else
      select o.rfq_id into v_order_rfq from public.orders o where o.id = new.order_id;
      if v_order_rfq is not null and v_order_rfq <> new.rfq_id then
        raise exception 'That order was made from a different enquiry.' using errcode = 'P0001', hint = 'rfq_order_mismatch';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.link_cost_prepare() from public, anon, authenticated;

create trigger expenses_link_prepare before insert or update on public.expenses
  for each row execute function public.link_cost_prepare();
create trigger expense_claims_link_prepare before insert or update on public.expense_claims
  for each row execute function public.link_cost_prepare();

-- ================================================================ an order made from an RFQ takes that RFQ's costs
create function public.orders_adopt_rfq_costs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rfq_id is not null and new.cancelled_on is null then
    update public.expenses x set order_id = new.id where x.rfq_id = new.rfq_id and x.order_id is null;
    update public.expense_claims c set order_id = new.id where c.rfq_id = new.rfq_id and c.order_id is null;
  end if;
  return new;
end;
$$;

revoke all on function public.orders_adopt_rfq_costs() from public, anon, authenticated;

create trigger orders_adopt_rfq_costs after insert on public.orders
  for each row execute function public.orders_adopt_rfq_costs();

-- ================================================================ an RFQ with costs is not deleted
create function public.rfqs_costs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.expenses x where x.rfq_id = old.id) then
    raise exception 'This RFQ has costs recorded on it. Delete or move the costs first.' using errcode = 'P0001', hint = 'rfq_has_costs';
  end if;
  return old;
end;
$$;

revoke all on function public.rfqs_costs_guard() from public, anon, authenticated;

create trigger rfqs_costs_guard before delete on public.rfqs
  for each row execute function public.rfqs_costs_guard();

-- ================================================================ the month lock, recreated whole
-- The definition after 0089, 0092, 0115, 0126 and 0128, with one new branch in the UPDATE case (marked 0136). Written out here, not
-- patched, so what it does can be read in one place.
create or replace function public.enforce_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
  v_new date;
  v_touched boolean;
  v_month date;
begin
  if tg_table_name = 'payments_in' then
    if tg_op <> 'INSERT' then v_old := old.received_on; end if;
    if tg_op <> 'DELETE' then v_new := new.received_on; end if;
  elsif tg_table_name = 'expenses' then
    if tg_op <> 'INSERT' then v_old := old.paid_on; end if;
    if tg_op <> 'DELETE' then v_new := new.paid_on; end if;
  elsif tg_table_name = 'credit_notes' then
    if tg_op <> 'INSERT' then v_old := old.issued_on; end if;
    if tg_op <> 'DELETE' then v_new := new.issued_on; end if;
  elsif tg_table_name = 'cash_topups' then
    if tg_op <> 'INSERT' then v_old := old.drawn_on; end if;
    if tg_op <> 'DELETE' then v_new := new.drawn_on; end if;
  elsif tg_table_name = 'cash_counts' then
    if tg_op <> 'INSERT' then v_old := old.counted_on; end if;
    if tg_op <> 'DELETE' then v_new := new.counted_on; end if;
  elsif tg_table_name = 'order_costs' then
    -- 0115: the day the costs were marked complete (Karachi) decides the month; an order cost never marked complete has none
    if tg_op <> 'INSERT' then v_old := (old.costs_complete_at at time zone 'Asia/Karachi')::date; end if;
    if tg_op <> 'DELETE' then v_new := (new.costs_complete_at at time zone 'Asia/Karachi')::date; end if;
  elsif tg_table_name = 'customer_refunds' then
    if tg_op <> 'INSERT' then v_old := old.refunded_on; end if;
    if tg_op <> 'DELETE' then v_new := new.refunded_on; end if;
  elsif tg_table_name = 'credit_applications' then
    if tg_op <> 'INSERT' then v_old := old.applied_on; end if;
    if tg_op <> 'DELETE' then v_new := new.applied_on; end if;
  else  -- invoices
    if tg_op <> 'INSERT' then v_old := old.invoice_date; end if;
    if tg_op <> 'DELETE' then v_new := new.invoice_date; end if;
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'invoices' and (to_jsonb(old) ->> 'legacy_source') is not null
       and coalesce(current_setting('qtech.legacy_link', true), '') = 'on' then
      -- 0089: linking an imported invoice to an order: only order_id may change (not even a filing stamp in the same UPDATE)
      v_touched := (to_jsonb(new) - 'order_id') is distinct from (to_jsonb(old) - 'order_id');
    elsif tg_table_name = 'invoices' then
      v_touched := (new.number, new.invoice_date, new.net_amount, new.gst_amount, new.order_id, new.company_id)
        is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount, old.order_id, old.company_id);
    elsif tg_table_name = 'order_costs' then
      v_touched := (new.expected_cost_pkr, new.costs_complete_at) is distinct from (old.expected_cost_pkr, old.costs_complete_at);
    elsif tg_table_name = 'expenses' and (to_jsonb(old) ->> 'recurring_id') is not null and (to_jsonb(new) ->> 'recurring_id') is null
          and (to_jsonb(new) - 'bank_month' - 'recurring_id') = (to_jsonb(old) - 'bank_month' - 'recurring_id') then
      -- 0092: deleting a recurring template clears the link (ON DELETE SET NULL); the expense itself is unchanged
      v_touched := false;
    elsif tg_table_name = 'expenses'
          and (to_jsonb(new) - 'bank_month' - 'rfq_id' - 'visit_id' - 'order_id') = (to_jsonb(old) - 'bank_month' - 'rfq_id' - 'visit_id' - 'order_id')
          and ((to_jsonb(new) ->> 'rfq_id') is not distinct from (to_jsonb(old) ->> 'rfq_id')
               or ((to_jsonb(old) ->> 'rfq_id') is not null and (to_jsonb(new) ->> 'rfq_id') is null))
          and ((to_jsonb(new) ->> 'visit_id') is not distinct from (to_jsonb(old) ->> 'visit_id')
               or ((to_jsonb(old) ->> 'visit_id') is not null and (to_jsonb(new) ->> 'visit_id') is null))
          and ((to_jsonb(new) ->> 'order_id') is not distinct from (to_jsonb(old) ->> 'order_id')
               or ((to_jsonb(old) ->> 'order_id') is null and (to_jsonb(old) ->> 'rfq_id') is not null
                   and exists (select 1 from public.orders o
                               where o.id::text = (to_jsonb(new) ->> 'order_id') and o.rfq_id::text = (to_jsonb(old) ->> 'rfq_id')))) then
      -- 0136: an enquiry's cost moves to its order when the enquiry is won (order_id empty -> the order of its own RFQ); a removed RFQ or
      -- visit empties its link. Nothing else in the row changes, and the paid date (the cash month) is the same.
      v_touched := false;
    elsif tg_table_name = 'expenses' and coalesce(current_setting('qtech.category_merge', true), '') = 'on' then
      -- 0086: inside merge_expense_categories only the category may change
      v_touched := (to_jsonb(new) - 'bank_month' - 'category_id') is distinct from (to_jsonb(old) - 'bank_month' - 'category_id');
    else
      v_touched := (to_jsonb(new) - 'bank_month' - 'wht_certificate_path' - 'wht_certificate_name')
        is distinct from (to_jsonb(old) - 'bank_month' - 'wht_certificate_path' - 'wht_certificate_name');
    end if;
    if not v_touched then
      return new;
    end if;
  end if;

  if public.month_is_closed(v_old) then
    v_month := date_trunc('month', v_old)::date;
  elsif public.month_is_closed(v_new) then
    v_month := date_trunc('month', v_new)::date;
  end if;
  if v_month is not null then
    raise exception '% is closed. An admin can reopen it.', to_char(v_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_month_lock() from public, anon, authenticated;

-- ================================================================ approve_expense_claim: the expense keeps the claim's links
create or replace function public.approve_expense_claim(p_claim uuid, p_category uuid, p_paid_how text, p_paid_on date default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.expense_claims;
  v_id uuid := gen_random_uuid();
  v_name text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin approves an expense claim.' using errcode = '42501';
  end if;
  if p_paid_how is null or p_paid_how not in ('cash_back', 'petty_cash', 'bank') then
    raise exception 'Choose how it was paid: cash given back, from petty cash, or by bank.' using errcode = '22023';
  end if;
  if p_category = 'ca7e0000-0000-4000-8000-000000000011' then
    raise exception 'A supplier payment is recorded with Pay on the supplier order.' using errcode = '22023';
  end if;
  select * into v_claim from public.expense_claims c where c.id = p_claim for update;
  if not found then
    raise exception 'That claim was not found.' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'This claim is already %.', v_claim.status using errcode = 'P0001';
  end if;
  select u.name into v_name from public.users u where u.id = v_claim.created_by;
  insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via, description, order_id, rfq_id, visit_id)
  values (v_id, v_claim.amount_pkr, p_category,
          coalesce(p_paid_on, case when p_paid_how = 'petty_cash' then v_claim.spent_on else public.today_pkt() end),
          case when p_paid_how = 'bank' then 'bank' else 'cash' end,
          nullif(concat_ws(' · ', nullif(btrim(v_claim.note), ''), v_name), ''),
          v_claim.order_id, v_claim.rfq_id, v_claim.visit_id);
  update public.expense_claims set status = 'approved', expense_id = v_id, paid_how = p_paid_how where id = p_claim;
  return v_id;
end;
$$;

-- ================================================================ v_enquiry_costs: what was spent on enquiries (admin only)
-- One row per RFQ that has at least one cost. spent_net is amount less input tax, as v_order_money's actual_cost is. state: ordered (a
-- live order exists, so the cost is also in that order's profit), lost (closed with no order) or open. Pending claims are not costs yet.
create view public.v_enquiry_costs with (security_invoker = true) as
select
  r.id::text    as rfq_id,   -- text on purpose: a plain r.id would make every table that points at rfqs list this view in the generated types
  r.number      as rfq_number,
  c.name        as company_name,
  case when exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null) then 'ordered'
       when r.closed_on is not null then 'lost'
       else 'open' end as state,
  sum(e.amount_pkr - e.input_tax_pkr)::numeric(14,2) as spent_net,
  count(*)::int as cost_count,
  max(e.paid_on) as last_paid_on
from public.expenses e
join public.rfqs r on r.id = e.rfq_id
left join public.companies c on c.id = r.company_id
where (select public.current_user_role()) = 'admin'
group by r.id, r.number, c.name, r.closed_on;

comment on view public.v_enquiry_costs is
  '0136: money spent on an enquiry (net of input tax), per RFQ: open, lost or ordered. Admin only. Used for "Spent on enquiries we did not win" (state <> ordered).';

revoke all on public.v_enquiry_costs from public, anon, authenticated;
grant select on public.v_enquiry_costs to authenticated;
grant select on public.v_enquiry_costs to qtech_engineer;   -- 0081 mirror; the view has no row for anyone but an admin
