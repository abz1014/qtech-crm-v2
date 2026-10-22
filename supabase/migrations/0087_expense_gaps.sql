-- 0087_expense_gaps (redesign phase 1, owner approval 2026-10-22: "expenses are utmost priority"). On top of the 0086 expense book.
--
--   A. Supplier payments have one door (Pay on the supplier order or on We owe suppliers). The Pay dialog records what was paid in
--      the supplier's currency next to the PKR actually debited: expenses.fx_currency and expenses.fx_amount (both or neither,
--      never PKR). payables_as_of() counts a leg as paid in its own currency when the payment says so, so "We owe suppliers" no
--      longer drifts with the rate once a foreign leg is paid. Bank charges are a separate expense (Bank charges), never inside
--      the supplier payment.
--   B. Engineers' "I paid" (owner: yes). A claim is NOT an expense: it lives in expense_claims, so it is in no report and no total
--      until the admin approves it. Engineers add their own (pending only) and read only their own; sales see none. Approving
--      (approve_expense_claim, admin) writes the expense with the category and paid-via the admin picks (cash given back, from
--      petty cash: cash; bank transfer: bank) and links it; deleting that expense puts the claim back to pending. Receipt photos
--      go to the private bucket claim-receipts under <claim id>/, readable by the admin and the engineer who made the claim.
--   C. Cash in hand (DATA_MODEL A9 proposal, owner: yes). cash_topups (cash drawn from the bank into the office box) and
--      cash_counts (an opening balance, then counted amounts). Expected cash = the latest count (or opening) + top-ups since -
--      cash expenses since (cash_in_hand(), admin). A count stores what was expected at that moment and the difference. A top-up
--      is not an expense: it is in no cost, no P&L and no In vs out.
--   D. For-month: a monthly bill paid by the 10th is for last month (expenses.period, which already exists). Expenses recorded
--      from a monthly template (day 1 to 10) on day 1 to 10 under the old rule (period = the month paid) are re-filed to the
--      month before, where nothing else of that template holds it and the month is open (the screenshot 69/70 contradiction).
--
-- Every new table, function and policy is granted to qtech_engineer as 0081 requires; the money columns are classified in 0902.

-- ================================================================ A. supplier payments in the supplier's currency
alter table public.expenses add column fx_currency text;
alter table public.expenses add column fx_amount numeric(14,2);
alter table public.expenses add constraint expenses_fx_currency_check check (fx_currency ~ '^[A-Z]{3}$' and fx_currency <> 'PKR');
alter table public.expenses add constraint expenses_fx_amount_check check (fx_amount > 0);
alter table public.expenses add constraint expenses_fx_both check ((fx_currency is null) = (fx_amount is null));

comment on column public.expenses.fx_currency is '0087: the currency a supplier payment was made in (USD, EUR); NULL for a PKR payment.';
comment on column public.expenses.fx_amount is '0087: the amount in fx_currency; amount_pkr is the PKR actually debited (bank charges are their own expense).';

create or replace function public.payables_as_of(p_date date)
returns table (
  supplier_order_id  uuid,
  order_id           uuid,
  order_number       bigint,
  supplier_id        uuid,
  supplier_name      text,
  currency           text,
  committed          numeric,
  fx_rate            numeric,
  committed_pkr      numeric,
  paid_pkr           numeric,
  owed_pkr           numeric,
  state              text,
  flag               text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with legs as (
    select
      l.id as leg_id, l.order_id as ordid, o.number as order_number, l.supplier_id, s.name as supplier_name,
      coalesce(case when po.total is not null then po.currency else l.currency end, 'PKR')::text as cur,
      coalesce(po.total, it.total) as committed
    from public.supplier_orders l
    join public.orders o on o.id = l.order_id
    join public.companies s on s.id = l.supplier_id
    left join lateral (
      select p.total, p.currency from public.purchase_orders p
      where p.supplier_order_id = l.id order by p.revision desc limit 1
    ) po on true
    left join lateral (
      select sum(i.qty * i.supplier_unit_price) as total from public.order_items i
      where i.supplier_order_id = l.id and i.supplier_unit_price is not null
    ) it on true
    where l.placed_on <= p_date
      and (o.cancelled_on is null or o.cancelled_on > p_date)
      and public.current_user_role() = 'admin'
  ),
  paid as (
    select g.*,
           coalesce(x.paid, 0) as paid,
           coalesce(x.paid_fx, 0) as paid_fx,
           coalesce(x.paid_fx_pkr, 0) as paid_fx_pkr
    from legs g
    left join lateral (
      select sum(e.amount_pkr - e.input_tax_pkr) as paid,
             sum(e.fx_amount) filter (where e.fx_currency = g.cur) as paid_fx,
             sum(e.amount_pkr - e.input_tax_pkr) filter (where e.fx_currency = g.cur) as paid_fx_pkr
      from public.expenses e
      where e.supplier_order_id = g.leg_id
        and e.category_id = 'ca7e0000-0000-4000-8000-000000000011'
        and e.paid_on <= p_date
    ) x on true
  ),
  priced as (
    select g.*,
           case when g.cur = 'PKR' then 1::numeric
                else (select r.rate_pkr from public.fx_rates r
                      where r.currency = g.cur and r.as_of <= p_date and r.as_of >= p_date - 30
                      order by r.as_of desc, (r.source = 'manual') desc limit 1) end as rate
    from paid g
  ),
  calc as (
    select x.*,
           round(x.committed * x.rate, 2) as committed_pkr,
           -- 0087: a payment made in the leg's own currency settles that much of it at any rate; only the rest is converted
           case when x.paid_fx > 0 and x.committed is not null and x.committed - x.paid_fx <= 0 then 0 - (x.paid - x.paid_fx_pkr)
                when x.paid_fx > 0 then round((x.committed - x.paid_fx) * x.rate, 2) - (x.paid - x.paid_fx_pkr)
                else round(x.committed * x.rate, 2) - x.paid end as raw_owed,
           (x.paid_fx > 0 and x.committed is not null and x.paid_fx >= x.committed) as paid_in_full_fx
    from priced x
  )
  select c.leg_id, c.ordid, c.order_number, c.supplier_id, c.supplier_name, c.cur, c.committed, c.rate,
         c.committed_pkr, c.paid,
         case when c.paid_in_full_fx then greatest(coalesce(c.raw_owed, 0), 0)
              when c.committed_pkr is not null then greatest(c.raw_owed, 0) end,
         case when c.committed is null then 'unpriced'
              when c.paid_in_full_fx then 'settled'
              when c.rate is null then 'no_rate'
              when c.raw_owed <= 0.03 * c.committed_pkr then 'settled'
              else 'owing' end,
         case when c.raw_owed < 0 then 'overpaid' end
  from calc c
$$;

-- ================================================================ B. engineers' "I paid" claims
create table public.expense_claims (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.users (id) on delete restrict,
  spent_on       date not null default public.today_pkt(),
  amount_pkr     numeric(14,2) not null check (amount_pkr > 0 and amount_pkr < 10000000),
  note           text check (char_length(note) <= 200),
  order_id       uuid references public.orders (id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at     timestamptz,
  decided_by     uuid references public.users (id) on delete restrict,
  paid_how       text check (paid_how in ('cash_back', 'petty_cash', 'bank')),
  reject_reason  text check (char_length(reject_reason) <= 200),
  expense_id     uuid unique references public.expenses (id) on delete set null,
  constraint expense_claims_approved_has_expense check ((status = 'approved') = (expense_id is not null))
);

comment on table public.expense_claims is
  '0087 (owner decision 2026-10-22): an engineer''s "I paid". Not an expense: in no report or total until the admin approves it '
  '(approve_expense_claim writes the expense). Engineers add and read their own; sales none; the admin all.';

create index expense_claims_pending_idx on public.expense_claims (created_at) where status = 'pending';
create index expense_claims_created_by_idx on public.expense_claims (created_by);
create index expense_claims_order_idx on public.expense_claims (order_id) where order_id is not null;

-- What a person may set: an engineer's new claim is always pending and undecided; a decision stamps who and when; the expense
-- going away (its delete sets expense_id to NULL) puts an approved claim back to pending.
create function public.expense_claims_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'qtech_engineer') then
      new.status := 'pending';
      new.expense_id := null;
      new.decided_at := null;
      new.decided_by := null;
      new.paid_how := null;
      new.reject_reason := null;
    end if;
    return new;
  end if;
  if old.status = 'approved' and old.expense_id is not null and new.expense_id is null then
    new.status := 'pending';
    new.decided_at := null;
    new.decided_by := null;
    new.paid_how := null;
    return new;
  end if;
  if new.status is distinct from old.status then
    new.decided_at := now();
    new.decided_by := auth.uid();
    if new.status <> 'rejected' then
      new.reject_reason := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.expense_claims_guard() from public, anon, authenticated;

create trigger expense_claims_guard before insert or update on public.expense_claims
  for each row execute function public.expense_claims_guard();
create trigger expense_claims_force_created_by before insert or update on public.expense_claims
  for each row execute function public.force_created_by();
create trigger expense_claims_audit after insert or update or delete on public.expense_claims
  for each row execute function public.audit_row_change();

alter table public.expense_claims enable row level security;
revoke all on table public.expense_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_claims to authenticated, qtech_engineer;   -- 0081: the engineer's API role mirrors authenticated

create policy expense_claims_select on public.expense_claims for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin'
         or ((select public.current_user_role()) = 'engineer' and created_by = (select auth.uid())));
create policy expense_claims_insert_engineer on public.expense_claims for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'engineer' and created_by = (select auth.uid())
              and status = 'pending' and expense_id is null);
create policy expense_claims_update_admin on public.expense_claims for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy expense_claims_delete on public.expense_claims for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin'
         or ((select public.current_user_role()) = 'engineer' and created_by = (select auth.uid()) and status = 'pending'));

-- Approve: one expense with the admin's category and paid-via, dated the day the cash left (today when cash is given back or a
-- bank transfer is made; the day spent when it came out of petty cash the engineer held), linked to the claim. Admin only.
create function public.approve_expense_claim(p_claim uuid, p_category uuid, p_paid_how text, p_paid_on date default null)
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
  insert into public.expenses (id, amount_pkr, category_id, paid_on, paid_via, description, order_id)
  values (v_id, v_claim.amount_pkr, p_category,
          coalesce(p_paid_on, case when p_paid_how = 'petty_cash' then v_claim.spent_on else public.today_pkt() end),
          case when p_paid_how = 'bank' then 'bank' else 'cash' end,
          nullif(concat_ws(' · ', nullif(btrim(v_claim.note), ''), v_name), ''),
          v_claim.order_id);
  update public.expense_claims set status = 'approved', expense_id = v_id, paid_how = p_paid_how where id = p_claim;
  return v_id;
end;
$$;

revoke all on function public.approve_expense_claim(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.approve_expense_claim(uuid, uuid, text, date) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin

-- ---------------------------------------------------------------- claim receipt photos (private bucket, <claim id>/<file>)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-receipts', 'claim-receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/octet-stream'])
on conflict (id) do nothing;

-- True when the caller may read (p_write false) or add and remove (p_write true) the object named p_name in claim-receipts:
-- the admin always; an engineer only under a claim of their own, and only while it is pending to change it. Row security on
-- expense_claims answers the "own" part. can_access_bucket() stays false for this bucket, so the general policies grant nothing.
create function public.claim_object_ok(p_name text, p_write boolean)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case public.current_user_role()
    when 'admin' then true
    when 'engineer' then exists (
      select 1 from public.expense_claims c
      where c.id::text = split_part(p_name, '/', 1)
        and c.created_by = (select auth.uid())
        and (not p_write or c.status = 'pending'))
    else false
  end
$$;

revoke all on function public.claim_object_ok(text, boolean) from public, anon, authenticated;
grant execute on function public.claim_object_ok(text, boolean) to authenticated, qtech_engineer;

create policy qtech_claim_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'claim-receipts' and public.claim_object_ok(name, false));
create policy qtech_claim_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-receipts' and public.claim_object_ok(name, true));
create policy qtech_claim_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'claim-receipts' and public.claim_object_ok(name, true));

-- ================================================================ C. cash in hand
create table public.cash_topups (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default clock_timestamp(),   -- the moment, not the transaction: "since a count" compares them
  created_by  uuid default auth.uid() references public.users (id) on delete restrict,
  drawn_on    date not null default public.today_pkt(),
  amount_pkr  numeric(14,2) not null check (amount_pkr > 0 and amount_pkr < 100000000),
  note        text check (char_length(note) <= 200)
);

comment on table public.cash_topups is
  '0087: cash drawn from the bank into the office cash box. Not an expense (money moves between our own boxes): in no cost, P&L or In vs out. Admin only.';

create index cash_topups_drawn_idx on public.cash_topups (drawn_on);

create table public.cash_counts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default clock_timestamp(),
  created_by      uuid default auth.uid() references public.users (id) on delete restrict,
  counted_on      date not null default public.today_pkt(),
  counted_pkr     numeric(14,2) not null check (counted_pkr >= 0 and counted_pkr < 100000000),
  expected_pkr    numeric(14,2),
  difference_pkr  numeric(14,2) generated always as (counted_pkr - expected_pkr) stored,
  is_opening      boolean not null default false,
  note            text check (char_length(note) <= 200)
);

comment on table public.cash_counts is
  '0087: the office cash box. The first row (is_opening) is the opening balance at the start of counted_on; later rows are counts '
  'made now, with what the books expected at that moment and the difference. Admin only.';

create index cash_counts_latest_idx on public.cash_counts (counted_on desc, created_at desc);

-- Expected cash in hand now: the latest count (or opening) + cash drawn since - cash expenses since. "Since" an opening is from
-- the start of its day; since a count, after the moment it was made (same day: entered after it). Admin only (no row otherwise).
create function public.cash_in_hand()
returns table (
  base_kind            text,
  base_on              date,
  base_at              timestamptz,
  base_pkr             numeric,
  topups_pkr           numeric,
  topup_count          integer,
  cash_out_pkr         numeric,
  cash_out_count       integer,
  expected_pkr         numeric,
  last_difference_pkr  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select c.counted_on, c.created_at, c.counted_pkr, c.is_opening, c.difference_pkr
    from public.cash_counts c
    order by c.counted_on desc, c.created_at desc
    limit 1
  ),
  t as (
    select coalesce(sum(x.amount_pkr), 0) as amt, count(*)::int as n
    from public.cash_topups x, b
    where x.drawn_on > b.counted_on or (x.drawn_on = b.counted_on and (b.is_opening or x.created_at > b.created_at))
  ),
  o as (
    select coalesce(sum(e.amount_pkr), 0) as amt, count(*)::int as n
    from public.expenses e, b
    where e.paid_via = 'cash'
      and (e.paid_on > b.counted_on or (e.paid_on = b.counted_on and (b.is_opening or e.created_at > b.created_at)))
  )
  select case when b.counted_on is null then 'none' when b.is_opening then 'opening' else 'count' end,
         b.counted_on, b.created_at, b.counted_pkr, t.amt, t.n, o.amt, o.n,
         case when b.counted_on is null then null else b.counted_pkr + t.amt - o.amt end,
         b.difference_pkr
  from (select 1) one
  left join b on true
  cross join t
  cross join o
  where public.current_user_role() = 'admin'
$$;

revoke all on function public.cash_in_hand() from public, anon, authenticated;
grant execute on function public.cash_in_hand() to authenticated, qtech_engineer;   -- 0081 mirror; no row for anyone but an admin

-- A count stores what the books expected at that moment (never what the client sends) and is dated today. The first row ever
-- is the opening balance, whatever the client says; an opening may be dated earlier (cash at the start of that day).
create function public.cash_counts_prepare()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.cash_in_hand();
  if not new.is_opening and (v.base_kind is null or v.base_kind = 'none') then
    new.is_opening := true;
  end if;
  if new.is_opening then
    new.expected_pkr := null;
  else
    new.counted_on := public.today_pkt();
    new.expected_pkr := v.expected_pkr;
  end if;
  return new;
end;
$$;

revoke all on function public.cash_counts_prepare() from public, anon, authenticated;

create trigger cash_counts_prepare before insert on public.cash_counts
  for each row execute function public.cash_counts_prepare();

create trigger cash_topups_force_created_by before insert or update on public.cash_topups
  for each row execute function public.force_created_by();
create trigger cash_counts_force_created_by before insert or update on public.cash_counts
  for each row execute function public.force_created_by();
create trigger cash_topups_audit after insert or update or delete on public.cash_topups
  for each row execute function public.audit_row_change();
create trigger cash_counts_audit after insert or update or delete on public.cash_counts
  for each row execute function public.audit_row_change();

alter table public.cash_topups enable row level security;
alter table public.cash_counts enable row level security;
revoke all on table public.cash_topups, public.cash_counts from public, anon, authenticated;
grant select, insert, update, delete on table public.cash_topups to authenticated, qtech_engineer;
grant select, insert, delete on table public.cash_counts to authenticated, qtech_engineer;   -- a count is never edited: delete it and count again

create policy cash_topups_select_admin on public.cash_topups for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy cash_topups_insert_admin on public.cash_topups for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');
create policy cash_topups_update_admin on public.cash_topups for update to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy cash_topups_delete_admin on public.cash_topups for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy cash_counts_select_admin on public.cash_counts for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');
create policy cash_counts_insert_admin on public.cash_counts for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) = 'admin');
create policy cash_counts_delete_admin on public.cash_counts for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');

-- ================================================================ D. for-month: monthly bills paid by the 10th are for last month
-- Only rows the old rule filed under the month they were paid in; never into a month the same template already holds; never in
-- a closed month (the lock would refuse it anyway). Audited as a system change, like 0082.
update public.expenses e
set period = to_char(date_trunc('month', e.paid_on) - interval '1 month', 'YYYY-MM')
from public.recurring_expenses r
where e.recurring_id = r.id
  and r.day_of_month between 1 and 10
  and extract(day from e.paid_on) <= 10
  and e.period = to_char(e.paid_on, 'YYYY-MM')
  and not public.month_is_closed(e.paid_on)
  and not exists (
    select 1 from public.expenses x
    where x.recurring_id = e.recurring_id
      and x.period = to_char(date_trunc('month', e.paid_on) - interval '1 month', 'YYYY-MM'));
