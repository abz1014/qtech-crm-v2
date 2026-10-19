-- 0065_security_recommendations (P9 security review, round 2): the medium and low findings of docs/SECURITY_REVIEW.md,
-- closed in the database. Each block names its finding. M-3 is accepted by the owner (2026-10-19) and not changed.
--
-- One rule decides who is limited: the database role `authenticated`, that is a signed-in person calling through the
-- API (PostgREST, storage), directly or through a SECURITY INVOKER function. The service role (import, admin-users),
-- postgres (pg_cron, migrations, test fixtures) and SECURITY DEFINER functions are not limited by the triggers below,
-- as with every other trigger in this schema. The month lock (L-6) is the exception: it binds everyone, like 0027.

-- ================================================================ M-1 and M-2: orders
-- M-1: orders.legacy_flags decides whether a payment counts in net income (value_basis_unknown). Changing whether an
--      order carries value_basis_unknown is done by resolve_value_basis only (it marks the transaction, see below);
--      any other change of legacy_flags, and an insert that carries flags, is admin only.
-- M-2: orders.owner_id decides who is credited with the order's next payment (set_payment_credited_user). Changing it
--      is admin only. The one exception: sales may take an order that has no owner (NULL to themselves). The app does
--      not change owners today (it sets them when an order is created); the exception keeps that door open safely.
create function public.guard_order_money_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  v_role := public.current_user_role();

  if tg_op = 'INSERT' then
    if cardinality(new.legacy_flags) > 0 and v_role is distinct from 'admin' then
      raise exception 'only an admin can set legacy flags on an order' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.legacy_flags is distinct from old.legacy_flags then
    if ('value_basis_unknown' = any (new.legacy_flags)) is distinct from ('value_basis_unknown' = any (old.legacy_flags))
       and coalesce(current_setting('qtech.resolving_value_basis', true), '') is distinct from new.id::text then
      raise exception 'the value basis of an order is changed only by resolve_value_basis' using errcode = '42501';
    end if;
    if v_role is distinct from 'admin' then
      raise exception 'only an admin can change the legacy flags of an order' using errcode = '42501';
    end if;
  end if;

  if new.owner_id is distinct from old.owner_id
     and v_role is distinct from 'admin'
     and not (v_role = 'sales' and old.owner_id is null and new.owner_id = auth.uid()) then
    raise exception 'only an admin can change who owns an order' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_money_fields() from public, anon, authenticated;

create trigger orders_guard_money_fields before insert or update on public.orders
  for each row execute function public.guard_order_money_fields();

-- M-2 also for RFQs: convert_rfq_to_order copies rfqs.owner_id into the new order, so an RFQ's owner is the future
-- order's credited person. Same rule: admin, or sales taking an RFQ that has no owner.
create function public.guard_rfq_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if current_user <> 'authenticated' or new.owner_id is not distinct from old.owner_id then
    return new;
  end if;
  v_role := public.current_user_role();
  if v_role is distinct from 'admin' and not (v_role = 'sales' and old.owner_id is null and new.owner_id = auth.uid()) then
    raise exception 'only an admin can change who owns an RFQ' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_rfq_owner() from public, anon, authenticated;

create trigger rfqs_guard_owner before update on public.rfqs
  for each row execute function public.guard_rfq_owner();

-- resolve_value_basis (0019) is unchanged except that it marks its own transaction, so the guard above lets exactly
-- this order's value_basis_unknown flag go. set_config is not reachable through the API, so nothing else can mark it.
create or replace function public.resolve_value_basis(p_order_id uuid, p_basis text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'only an admin can resolve a value basis' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('net', 'gross') then
    raise exception 'basis must be net or gross' using errcode = '22023';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and 'value_basis_unknown' = any (legacy_flags)) then
    raise exception 'the order has no unresolved value basis' using errcode = '22023';
  end if;

  if p_basis = 'gross' then
    update public.order_items
    set unit_price_net = round(unit_price_net / (1 + gst_rate / 100), 2)
    where order_id = p_order_id;
  end if;

  perform set_config('qtech.resolving_value_basis', p_order_id::text, true);
  update public.orders
  set legacy_flags = array_remove(legacy_flags, 'value_basis_unknown')
  where id = p_order_id;
  perform set_config('qtech.resolving_value_basis', '', true);
end;
$$;

revoke all on function public.resolve_value_basis(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_value_basis(uuid, text) to authenticated;

-- ================================================================ M-1: order lines
-- The item lines are the value basis of an order without an invoice (v_order_basis), the committed cost of a leg
-- (payables_as_of) and the margin estimate. Their money fields (qty, unit_price_net, gst_rate, is_service, order_id,
-- supplier_order_id, supplier_unit_price) are edited by admin and sales: the app's order page edits them for those two
-- roles only (OrderItemsPanel, canEdit && money). An engineer never edits them, with one exception: lines written in
-- the same transaction that created their order, which is what convert_rfq_to_order and create_repeat_order do when an
-- engineer marks an RFQ won or repeats an order (orders.created_at is the transaction's now(), which no later request
-- can reproduce). Descriptions, units and positions stay open to every active role.
create function public.guard_order_item_money_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role  text;
  v_money boolean;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_role := public.current_user_role();
  if v_role in ('admin', 'sales') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_money := case tg_op
    when 'INSERT' then true
    when 'DELETE' then true
    else (new.qty, new.unit_price_net, new.gst_rate, new.is_service, new.order_id, new.supplier_order_id, new.supplier_unit_price)
         is distinct from (old.qty, old.unit_price_net, old.gst_rate, old.is_service, old.order_id, old.supplier_order_id, old.supplier_unit_price)
  end;
  if not v_money then
    return new;
  end if;

  if tg_op <> 'DELETE' and exists (select 1 from public.orders o where o.id = new.order_id and o.created_at = now())
     and (tg_op = 'INSERT' or exists (select 1 from public.orders o where o.id = old.order_id and o.created_at = now())) then
    return new;
  end if;
  raise exception 'prices, quantities and GST on an order are changed by admin and sales only' using errcode = '42501';
end;
$$;

revoke all on function public.guard_order_item_money_fields() from public, anon, authenticated;

create trigger order_items_guard_money_fields before insert or update or delete on public.order_items
  for each row execute function public.guard_order_item_money_fields();

-- ================================================================ L-1: actor columns
-- created_by: a signed-in caller is always the creator (insert) and can never rewrite it (update).
create function public.force_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.force_created_by() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'created_by' and t.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.force_created_by()',
                   r.table_name || '_force_created_by', r.table_name);
  end loop;
end;
$$;

-- order_costs.costs_complete_by (admin only already): whoever marks costs complete is recorded, never a name typed in.
create function public.force_costs_complete_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and (tg_op = 'INSERT' or new.costs_complete_by is distinct from old.costs_complete_by
          or new.costs_complete_at is distinct from old.costs_complete_at) then
    new.costs_complete_by := case when new.costs_complete_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

revoke all on function public.force_costs_complete_by() from public, anon, authenticated;

create trigger order_costs_force_complete_by before insert or update on public.order_costs
  for each row execute function public.force_costs_complete_by();

-- The chase actor (0048). For a signed-in caller:
--   insert         the actor is the caller only if they name themselves; otherwise NULL (history has no actor)
--   a chase        (the stamp or the count moves forward) the actor is the caller, whatever the update names
--   an Undo        (the count goes down, or the stamp moves back or is cleared) the actor is NULL: the earlier chaser
--                  cannot be proven, and a missing name is better than a wrong one
--   anything else  the actor cannot be changed
-- Other callers (the stamp RPCs run as the caller, so they are covered above; postgres and the service role) keep 0048.
create or replace function public.stamp_actor_clarification() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.last_asked_by := case when new.last_asked_by = auth.uid() then auth.uid() end;
    elsif new.last_asked_at is distinct from old.last_asked_at or new.ask_count is distinct from old.ask_count then
      new.last_asked_by := case
        when new.last_asked_at is null or new.ask_count < old.ask_count or new.last_asked_at < old.last_asked_at then null
        else auth.uid() end;
    else
      new.last_asked_by := old.last_asked_by;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.last_asked_at is distinct from old.last_asked_at or new.ask_count is distinct from old.ask_count)
     and new.last_asked_by is not distinct from old.last_asked_by then
    new.last_asked_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.stamp_actor_inquiry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.last_chased_by := case when new.last_chased_by = auth.uid() then auth.uid() end;
    elsif new.last_chased_on is distinct from old.last_chased_on or new.chase_count is distinct from old.chase_count then
      new.last_chased_by := case
        when new.last_chased_on is null or new.chase_count < old.chase_count or new.last_chased_on < old.last_chased_on then null
        else auth.uid() end;
    else
      new.last_chased_by := old.last_chased_by;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.last_chased_on is distinct from old.last_chased_on or new.chase_count is distinct from old.chase_count)
     and new.last_chased_by is not distinct from old.last_chased_by then
    new.last_chased_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.stamp_actor_leg() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.last_chased_by := case when new.last_chased_by = auth.uid() then auth.uid() end;
    elsif new.last_chased_on is distinct from old.last_chased_on or new.chase_count is distinct from old.chase_count then
      new.last_chased_by := case
        when new.last_chased_on is null or new.chase_count < old.chase_count or new.last_chased_on < old.last_chased_on then null
        else auth.uid() end;
    else
      new.last_chased_by := old.last_chased_by;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.last_chased_on is distinct from old.last_chased_on or new.chase_count is distinct from old.chase_count)
     and new.last_chased_by is not distinct from old.last_chased_by then
    new.last_chased_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_actor_clarification(), public.stamp_actor_inquiry(), public.stamp_actor_leg() from public, anon, authenticated;

drop trigger clarifications_stamp_actor on public.clarifications;
drop trigger supplier_inquiries_stamp_actor on public.supplier_inquiries;
drop trigger supplier_orders_stamp_actor on public.supplier_orders;
create trigger clarifications_stamp_actor before insert or update on public.clarifications
  for each row execute function public.stamp_actor_clarification();
create trigger supplier_inquiries_stamp_actor before insert or update on public.supplier_inquiries
  for each row execute function public.stamp_actor_inquiry();
create trigger supplier_orders_stamp_actor before insert or update on public.supplier_orders
  for each row execute function public.stamp_actor_leg();

-- ================================================================ L-2: sequences
-- Supabase's default privileges give anon USAGE, SELECT and UPDATE on every new sequence. anon never inserts anything.
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ================================================================ L-3: pg_net
-- Only the nightly FX job (pg_cron, as postgres) calls net.http_get. Supabase's pg_net install grants the HTTP functions
-- to anon and authenticated; take that back. Guarded: a stack without pg_net, or a function this role may not revoke on,
-- is reported and skipped (the pgTAP test then shows the outcome).
do $$
declare
  r record;
begin
  if to_regnamespace('net') is null then
    raise notice 'pg_net is not installed: nothing to revoke';
    return;
  end if;
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'net'::regnamespace loop
    begin
      execute format('revoke all on function %s from anon, authenticated', r.f);
      -- PUBLIC too, but only where postgres (the pg_cron job owner) keeps its own right to run the function.
      if exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = r.f::oid and a.grantee = 'postgres'::regrole and a.privilege_type = 'EXECUTE')
         or exists (select 1 from pg_proc p where p.oid = r.f::oid and p.proowner = 'postgres'::regrole) then
        execute format('revoke all on function %s from public', r.f);
      end if;
    exception when others then
      raise notice 'could not revoke on %: %', r.f, sqlerrm;
    end;
  end loop;
end;
$$;

-- ================================================================ L-6: receipts of a closed month
-- A receipt is evidence for a closed month once its invoice (invoice_date) or expense (paid_on) is in one. It can still
-- be ADDED (the tax agent's receipt for October arrives in November), but not changed, moved or removed, and its stored
-- file cannot be overwritten or deleted. Like the 0027 lock this binds every role; an admin reopens the month first.
create function public.enforce_receipt_month_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old date;
  v_new date;
  v_month date;
begin
  select coalesce((select i.invoice_date from public.invoices i where i.id = old.invoice_id),
                  (select e.paid_on from public.expenses e where e.id = old.expense_id))
  into v_old;
  if tg_op = 'UPDATE' then
    select coalesce((select i.invoice_date from public.invoices i where i.id = new.invoice_id),
                    (select e.paid_on from public.expenses e where e.id = new.expense_id))
    into v_new;
  end if;
  if public.month_is_closed(v_old) then
    v_month := date_trunc('month', v_old)::date;
  elsif public.month_is_closed(v_new) then
    v_month := date_trunc('month', v_new)::date;
  end if;
  if v_month is not null then
    raise exception '% is closed. An admin can reopen it.', to_char(v_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_receipt_month_lock() from public, anon, authenticated;

create trigger attachments_receipt_month_lock before update or delete on public.attachments
  for each row execute function public.enforce_receipt_month_lock();

-- The storage side: true when the object is the file of a receipt whose invoice or expense is in a closed month.
-- Used by the storage policies below, so it is executable by authenticated; it answers NULL to anyone who cannot use
-- the bucket (deactivated, or an engineer for these two buckets), so it tells nobody anything new.
create function public.receipt_locked(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_bucket not in ('gst-receipts', 'expense-receipts') then false
    when not coalesce(public.can_access_bucket(p_bucket), false) then null
    else exists (
      select 1 from public.attachments a
      left join public.invoices i on i.id = a.invoice_id
      left join public.expenses e on e.id = a.expense_id
      where a.bucket = p_bucket and a.path = p_name
        and public.month_is_closed(coalesce(i.invoice_date, e.paid_on))
    )
  end
$$;

revoke all on function public.receipt_locked(text, text) from public, anon, authenticated;
grant execute on function public.receipt_locked(text, text) to authenticated;

drop policy qtech_objects_update on storage.objects;
create policy qtech_objects_update on storage.objects for update to authenticated
  using (
    public.can_access_bucket(bucket_id)
    and (
      bucket_id <> 'generated-docs'
      or public.current_user_role() = 'admin'
      or not (
        exists (select 1 from public.quotations q where q.pdf_path = objects.name)
        or exists (select 1 from public.purchase_orders p where p.pdf_path = objects.name)
      )
    )
    and not coalesce(public.receipt_locked(bucket_id, objects.name), false)
  )
  with check (public.can_access_bucket(bucket_id));

drop policy qtech_objects_delete on storage.objects;
create policy qtech_objects_delete on storage.objects for delete to authenticated
  using (
    public.can_access_bucket(bucket_id)
    and (bucket_id <> 'generated-docs' or public.current_user_role() = 'admin')
    and not coalesce(public.receipt_locked(bucket_id, objects.name), false)
  );

-- ================================================================ L-7: content types
-- generated-docs is PDF only since 0057. The other three buckets take what the intake and Capture accept (photos
-- including HEIC, PDF), plus office documents and plain text. application/octet-stream stays allowed: a phone often
-- sends a HEIC photo with no type, legacy receipts may have none, and a browser downloads such a file rather than
-- rendering it. HTML, SVG and script types are refused.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/octet-stream'
]
where id in ('rfq-files', 'gst-receipts', 'expense-receipts');
