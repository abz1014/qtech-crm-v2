-- 0124_claims_owed (process audit 5). Staff "I paid" claims, second round.
--
--   * Approval no longer forces immediate payment. The admin may approve a claim as OWED ("Approved, owed to <person>"): the claim waits
--     with its category and nothing has left the bank or the cash box, so it is in no cost and no cash figure yet. "Mark paid back" later
--     records how it was paid (cash given back, from petty cash, or by bank) and writes the expense on that day, through the same
--     approve_expense_claim that pays at once. Money shows what is owed to each person (the owed claims, one row per person).
--   * Sales staff may claim too (they spend on site visits and customer lunches): the insert, own-read and own-delete rules and the
--     claim-receipts bucket rule that said "engineer" now say "engineer or sales". The admin still decides.
--   * The receipt photo is carried to the expense by the app when the claim is paid (the storage files cannot be copied from SQL); it is
--     not a database rule.
-- Expand-only: one nullable column, one wider status check, replaced policies. No price reaches an engineer: the claim amounts keep
-- the 'own' rule of 0902 (a person reads their own claims only).

alter table public.expense_claims add column category_id uuid references public.expense_categories (id) on delete restrict;
comment on column public.expense_claims.category_id is '0124: the category the admin picked when approving a claim as owed (used when it is paid back).';

alter table public.expense_claims drop constraint expense_claims_status_check;
alter table public.expense_claims add constraint expense_claims_status_check check (status in ('pending', 'approved', 'rejected', 'owed'));

-- Approve as owed: pending -> owed. Admin only.
create function public.owe_expense_claim(p_claim uuid, p_category uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin approves an expense claim.' using errcode = '42501';
  end if;
  if p_category = 'ca7e0000-0000-4000-8000-000000000011' then
    raise exception 'A supplier payment is recorded with Pay on the supplier order.' using errcode = '22023';
  end if;
  select c.status into v_status from public.expense_claims c where c.id = p_claim for update;
  if not found then
    raise exception 'That claim was not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'This claim is already %.', v_status using errcode = 'P0001';
  end if;
  update public.expense_claims set status = 'owed', category_id = p_category where id = p_claim;
end;
$$;

-- Mark paid back: owed -> approved, writing the expense on the day the money left (today unless given). Admin only.
create function public.pay_back_expense_claim(p_claim uuid, p_paid_how text, p_paid_on date default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category uuid;
  v_status text;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin pays back an expense claim.' using errcode = '42501';
  end if;
  select c.status, c.category_id into v_status, v_category from public.expense_claims c where c.id = p_claim for update;
  if not found then
    raise exception 'That claim was not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'owed' then
    raise exception 'This claim is not waiting to be paid back.' using errcode = 'P0001';
  end if;
  update public.expense_claims set status = 'pending' where id = p_claim;
  return public.approve_expense_claim(p_claim, v_category, p_paid_how, coalesce(p_paid_on, public.today_pkt()));
end;
$$;

revoke all on function public.owe_expense_claim(uuid, uuid) from public, anon;
revoke all on function public.pay_back_expense_claim(uuid, text, date) from public, anon;
grant execute on function public.owe_expense_claim(uuid, uuid) to authenticated, qtech_engineer;   -- 0081 mirror; refused inside for anyone but an admin
grant execute on function public.pay_back_expense_claim(uuid, text, date) to authenticated, qtech_engineer;

-- Sales may claim too (admin decides). Replace the engineer-only policies.
drop policy expense_claims_select on public.expense_claims;
drop policy expense_claims_insert_engineer on public.expense_claims;
drop policy expense_claims_delete on public.expense_claims;

create policy expense_claims_select on public.expense_claims for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin'
         or ((select public.current_user_role()) in ('engineer', 'sales') and created_by = (select auth.uid())));
create policy expense_claims_insert_staff on public.expense_claims for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) in ('engineer', 'sales') and created_by = (select auth.uid())
              and status = 'pending' and expense_id is null);
create policy expense_claims_delete on public.expense_claims for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin'
         or ((select public.current_user_role()) in ('engineer', 'sales') and created_by = (select auth.uid()) and status = 'pending'));

-- The claim-receipts bucket follows: a person (engineer or sales) reads and adds photos under a claim of their own, while it is pending to change it.
create or replace function public.claim_object_ok(p_name text, p_write boolean)
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
    when 'sales' then exists (
      select 1 from public.expense_claims c
      where c.id::text = split_part(p_name, '/', 1)
        and c.created_by = (select auth.uid())
        and (not p_write or c.status = 'pending'))
    else false
  end
$$;

-- The insert guard (0087) forces a new claim to pending for the roles `authenticated` and `qtech_engineer`: unchanged, it already covers sales.
