-- 0122_reassign_owner (process audit 1). When a salesperson leaves, their open RFQs, jobs and orders must be movable, one at a time or all
-- at once, by an admin.
--
--   reassign_owner(kind, id, to)       'rfq' | 'order' | 'job' (an enquiry and the orders that came from it). Returns how many rows moved.
--   reassign_open_work(from, to)       "move all of X's open work to Y": every open RFQ (not closed) and every live order (not cancelled,
--                                      not done) of X. Returns the number of RFQs and of orders moved.
--   open_work_of(user)                 the same two counts without moving anything, for the Deactivate dialog.
--
-- Credit: payments_in.credited_user_id is stamped when a payment is recorded (from orders.owner_id, 0010/0073). Past payments keep their
-- credit (their column is never touched here), so targets already earned stay with the person who earned them; a payment recorded after
-- the move is credited to the new owner. Every move is audited by the audit triggers on rfqs and orders (who, when, old and new owner).
-- Admin only; the new owner must be an active admin or salesperson.

create function public.reassign_owner_check(p_to uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change who owns an enquiry, job or order.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = p_to and u.deactivated_at is null and u.role in ('admin', 'sales')) then
    raise exception 'Choose a current salesperson or admin as the new owner.' using errcode = '22023';
  end if;
end;
$$;

create function public.reassign_owner(p_kind text, p_id uuid, p_to uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_k integer;
begin
  perform public.reassign_owner_check(p_to);
  if p_kind = 'rfq' then
    update public.rfqs set owner_id = p_to where id = p_id and owner_id is distinct from p_to;
    get diagnostics v_n = row_count;
  elsif p_kind = 'order' then
    update public.orders set owner_id = p_to where id = p_id and owner_id is distinct from p_to;
    get diagnostics v_n = row_count;
  elsif p_kind = 'job' then
    update public.rfqs set owner_id = p_to where id = p_id and owner_id is distinct from p_to;
    get diagnostics v_n = row_count;
    update public.orders set owner_id = p_to where rfq_id = p_id and owner_id is distinct from p_to;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  else
    raise exception 'Unknown kind %.', p_kind using errcode = '22023';
  end if;
  return v_n;
end;
$$;

create function public.open_work_of(p_user uuid)
returns table (rfqs integer, orders integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can see a person''s open work.' using errcode = '42501';
  end if;
  return query
  select (select count(*)::integer from public.rfqs r where r.owner_id = p_user and r.closed_on is null),
         (select count(*)::integer from public.v_order_state s where s.owner_id = p_user and s.lifecycle = 'active');
end;
$$;

create function public.reassign_open_work(p_from uuid, p_to uuid)
returns table (rfqs integer, orders integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_r integer;
  v_o integer;
begin
  perform public.reassign_owner_check(p_to);
  if p_from = p_to then
    raise exception 'Choose someone else to take the work over.' using errcode = '22023';
  end if;
  update public.rfqs set owner_id = p_to where owner_id = p_from and closed_on is null;
  get diagnostics v_r = row_count;
  update public.orders o set owner_id = p_to
   where o.owner_id = p_from
     and exists (select 1 from public.v_order_state s where s.order_id = o.id and s.lifecycle = 'active');
  get diagnostics v_o = row_count;
  return query select v_r, v_o;
end;
$$;

revoke all on function public.reassign_owner_check(uuid) from public, anon;
revoke all on function public.reassign_owner(text, uuid, uuid) from public, anon;
revoke all on function public.open_work_of(uuid) from public, anon;
revoke all on function public.reassign_open_work(uuid, uuid) from public, anon;
-- 0081 mirror: the engineer's API role holds what authenticated holds; every one of these refuses inside for anyone but an admin
grant execute on function public.reassign_owner_check(uuid) to authenticated, qtech_engineer;
grant execute on function public.reassign_owner(text, uuid, uuid) to authenticated, qtech_engineer;
grant execute on function public.open_work_of(uuid) to authenticated, qtech_engineer;
grant execute on function public.reassign_open_work(uuid, uuid) to authenticated, qtech_engineer;
