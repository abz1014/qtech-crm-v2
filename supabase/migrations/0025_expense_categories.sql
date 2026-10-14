-- 0025_expense_categories (S20): Amendment A6.1. Expense categories become a table, expenses and recurring_expenses
-- point at it, paid_via is defaulted from the category, input_tax_pkr is added, and v_order_money uses the net cost.
-- The migration also carries the S14 follow-up hardening (first section).

-- ================================================================ S14 follow-up: revoke default PUBLIC execute
-- The S14 access-matrix run found functions that still carried the default PUBLIC execute privilege.
-- 1. model_tokens, item_text_norm and today_pkt are pure helpers that were granted to authenticated but never revoked
--    from PUBLIC, so anon could run them. Take PUBLIC and anon away; authenticated keeps execute (it needs it for
--    generated columns and column defaults that call them).
-- 2. The SECURITY INVOKER trigger functions below were never revoked from PUBLIC either. A trigger function cannot be
--    called as a function and triggers fire without an execute check, so nothing breaks; this only makes the grants
--    tidy and consistent with the SECURITY DEFINER trigger functions.
-- 3. Deactivated users still run the pure helpers (they are the database role `authenticated` and the helpers read no
--    table). That exposes nothing and DATA_MODEL section 10 is silent on it, so it is left as it is (the S14 test
--    keeps it as a documented TODO).
revoke all on function public.model_tokens(text) from public, anon, authenticated;
grant execute on function public.model_tokens(text) to authenticated;
revoke all on function public.item_text_norm(text) from public, anon, authenticated;
grant execute on function public.item_text_norm(text) to authenticated;
revoke all on function public.today_pkt(timestamptz) from public, anon, authenticated;
grant execute on function public.today_pkt(timestamptz) to authenticated;

revoke all on function public.company_profile_touch() from public, anon, authenticated;
revoke all on function public.lock_issued_document() from public, anon, authenticated;
revoke all on function public.purchase_order_set_total() from public, anon, authenticated;
revoke all on function public.quotation_set_totals() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ================================================================ expense_categories [std]
create table public.expense_categories (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references public.users (id) on delete restrict,
  name             text not null,
  -- overhead and order_cost are in the P&L; non_pnl (drawings, loan principal) is shown below the result.
  grp              text not null check (grp in ('overhead', 'order_cost', 'non_pnl')),
  default_paid_via text not null default 'bank' check (default_paid_via in ('bank', 'cash')),
  sort             smallint not null default 0,
  active           boolean not null default true
);

comment on table public.expense_categories is
  'Amendment A6: expense categories. In use means RESTRICT on delete; deactivate instead. The seed rows have fixed ids so reports and imports can name them.';

create unique index expense_categories_name_key on public.expense_categories (lower(btrim(name)));

-- Seed (A6.1). Fixed ids: ca7e0000-0000-4000-8000-0000000000NN, NN = position in the list.
insert into public.expense_categories (id, name, grp, default_paid_via, sort) values
  ('ca7e0000-0000-4000-8000-000000000001', 'Salaries',                 'overhead',   'bank',  10),
  ('ca7e0000-0000-4000-8000-000000000002', 'Rent',                     'overhead',   'bank',  20),
  ('ca7e0000-0000-4000-8000-000000000003', 'Utilities',                'overhead',   'bank',  30),
  ('ca7e0000-0000-4000-8000-000000000004', 'Fuel & travel',            'overhead',   'cash',  40),
  ('ca7e0000-0000-4000-8000-000000000005', 'Office supplies & snacks', 'overhead',   'cash',  50),
  ('ca7e0000-0000-4000-8000-000000000006', 'Courier & postage',        'overhead',   'cash',  60),
  ('ca7e0000-0000-4000-8000-000000000007', 'Repairs & maintenance',    'overhead',   'cash',  70),
  ('ca7e0000-0000-4000-8000-000000000008', 'Bank charges',             'overhead',   'bank',  80),
  ('ca7e0000-0000-4000-8000-000000000009', 'Taxes & fees',             'overhead',   'bank',  90),
  ('ca7e0000-0000-4000-8000-000000000010', 'Other',                    'overhead',   'bank', 100),
  ('ca7e0000-0000-4000-8000-000000000011', 'Supplier payment',         'order_cost', 'bank', 110),
  ('ca7e0000-0000-4000-8000-000000000012', 'Freight',                  'order_cost', 'bank', 120),
  ('ca7e0000-0000-4000-8000-000000000013', 'Clearing',                 'order_cost', 'bank', 130),
  ('ca7e0000-0000-4000-8000-000000000014', 'Commissioning',            'order_cost', 'cash', 140),
  ('ca7e0000-0000-4000-8000-000000000015', 'Subcontractor',            'order_cost', 'bank', 150),
  ('ca7e0000-0000-4000-8000-000000000016', 'Owner drawings',           'non_pnl',    'bank', 160),
  ('ca7e0000-0000-4000-8000-000000000017', 'Loan repayment',           'non_pnl',    'bank', 170);

alter table public.expense_categories enable row level security;

revoke all on table public.expense_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_categories to authenticated;

-- Section 10 (A6): admin only, all four operations.
create policy expense_categories_select_admin on public.expense_categories for select to authenticated
  using (public.current_user_role() = 'admin');
create policy expense_categories_insert_admin on public.expense_categories for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy expense_categories_update_admin on public.expense_categories for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy expense_categories_delete_admin on public.expense_categories for delete to authenticated
  using (public.current_user_role() = 'admin');

-- Attached after the seed so the audit log stays empty until a person edits a category.
create trigger expense_categories_audit after insert or update or delete on public.expense_categories
  for each row execute function public.audit_row_change();

-- ================================================================ expenses
-- There is no live data yet. The text column is replaced; any rows already present (a local database) are mapped by
-- exact name and otherwise land in "Other" so the NOT NULL can be applied.
alter table public.expenses add column category_id uuid references public.expense_categories (id) on delete restrict;
update public.expenses e
set category_id = coalesce(
  (select c.id from public.expense_categories c where lower(btrim(c.name)) = lower(btrim(e.category))),
  'ca7e0000-0000-4000-8000-000000000010');
alter table public.expenses alter column category_id set not null;
alter table public.expenses drop column category;

alter table public.expenses add column paid_via text;
update public.expenses set paid_via = 'bank';
alter table public.expenses alter column paid_via set not null;
alter table public.expenses add constraint expenses_paid_via_check check (paid_via in ('bank', 'cash'));

-- amount_pkr equals the bank debit; the cost used in the P&L and in margin is amount_pkr - input_tax_pkr.
alter table public.expenses add column input_tax_pkr numeric(14,2) not null default 0;
alter table public.expenses add constraint expenses_input_tax_range check (input_tax_pkr between 0 and amount_pkr);

create index expenses_category_idx on public.expenses (category_id);

-- ================================================================ recurring_expenses
alter table public.recurring_expenses
  add column category_id uuid references public.expense_categories (id) on delete restrict;
update public.recurring_expenses r
set category_id = coalesce(
  (select c.id from public.expense_categories c where lower(btrim(c.name)) = lower(btrim(r.category))),
  'ca7e0000-0000-4000-8000-000000000010');
alter table public.recurring_expenses alter column category_id set not null;
alter table public.recurring_expenses drop column category;

create index recurring_expenses_category_idx on public.recurring_expenses (category_id);

-- ================================================================ expense trigger: paid_via default and active category
-- SECURITY DEFINER so the lookup does not depend on the caller's rights on expense_categories; it writes nothing but NEW.
create function public.expenses_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.expense_categories;
begin
  if new.category_id is null then
    return new;   -- the NOT NULL constraint answers
  end if;
  select * into v_cat from public.expense_categories c where c.id = new.category_id;

  if new.paid_via is null and tg_op = 'INSERT' then
    new.paid_via := v_cat.default_paid_via;
  end if;

  -- An inactive category cannot be chosen; legacy rows (non-empty legacy_flags) are exempt.
  if cardinality(new.legacy_flags) = 0
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and v_cat.id is not null and not v_cat.active then
    raise exception 'category "%" is inactive; pick an active category', v_cat.name using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.expenses_prepare() from public, anon, authenticated;

create trigger expenses_prepare before insert or update on public.expenses
  for each row execute function public.expenses_prepare();

-- ================================================================ v_order_money: cost is the net cost
-- create or replace of the 0015 view: the same columns; actual_cost is now the sum of (amount - input tax).
-- Results are unchanged while input tax is 0.
create or replace view public.v_order_money with (security_invoker = true) as
select
  o.id as order_id,
  o.number as order_number,
  o.company_id,
  o.owner_id,
  b.basis,
  case when b.invoice_count > 0 then b.invoice_net else b.items_net end as net_sale,
  b.g as gross_target,
  s.settled,
  (b.g > 0 and s.settled >= b.g - 1) as settled_ok,
  greatest(b.g - s.settled, 0) as receivable,
  greatest(s.settled - b.g, 0) as overpaid_by,
  d.due_on,
  case
    when d.due_on is not null and d.due_on < public.today_pkt() and not (b.g > 0 and s.settled >= b.g - 1)
      then 'overdue'
    when b.g > 0 and s.settled >= b.g - 1 then 'settled'
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
left join public.order_costs oc on oc.order_id = o.id
cross join lateral (
  select coalesce(sum(p.amount), 0) as settled from public.payments_in p where p.order_id = o.id
) s
cross join lateral (
  select coalesce(sum(x.amount_pkr - x.input_tax_pkr), 0) as actual_cost from public.expenses x where x.order_id = o.id
) e
cross join lateral (
  select (min(v.invoice_date) + o.payment_terms_days) as due_on
  from public.invoices v
  where v.order_id = o.id
) d
where public.current_user_role() = 'admin';
