-- 0048_chase_actor (O-3, the Today collision line): who made the last chase, so nobody chases the same customer or supplier twice.
-- Today shows "Ali chased this 1h ago" on an item someone else has already chased. The stamps (last_asked_at, last_chased_on) are
-- shared, so the item already waits for everyone; what was missing is the name. audit_log has it but is admin-only.
--
--   clarifications.last_asked_by      users.id of whoever last stamped an ask (stamp_clarification_ask, or a direct update)
--   supplier_inquiries.last_chased_by the same for a supplier quote chase
--   supplier_orders.last_chased_by    the same for a goods chase
--
-- Set by a BEFORE UPDATE trigger whenever the stamp column changes and the update did not name the actor itself, so the stamp RPCs
-- need no change and an Undo that restores the old stamp can restore the old actor with it (it names the column). All nullable, no
-- default: history has no actor. ON DELETE SET NULL, like created_by.

alter table public.clarifications
  add column last_asked_by uuid references public.users (id) on delete set null;
alter table public.supplier_inquiries
  add column last_chased_by uuid references public.users (id) on delete set null;
alter table public.supplier_orders
  add column last_chased_by uuid references public.users (id) on delete set null;

create function public.stamp_actor_clarification() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.last_asked_at is distinct from old.last_asked_at and new.last_asked_by is not distinct from old.last_asked_by then
    new.last_asked_by := auth.uid();
  end if;
  return new;
end;
$$;

create function public.stamp_actor_inquiry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.last_chased_on is distinct from old.last_chased_on and new.last_chased_by is not distinct from old.last_chased_by then
    new.last_chased_by := auth.uid();
  end if;
  return new;
end;
$$;

create function public.stamp_actor_leg() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.last_chased_on is distinct from old.last_chased_on and new.last_chased_by is not distinct from old.last_chased_by then
    new.last_chased_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger clarifications_stamp_actor before update on public.clarifications
  for each row execute function public.stamp_actor_clarification();
create trigger supplier_inquiries_stamp_actor before update on public.supplier_inquiries
  for each row execute function public.stamp_actor_inquiry();
create trigger supplier_orders_stamp_actor before update on public.supplier_orders
  for each row execute function public.stamp_actor_leg();

revoke all on function public.stamp_actor_clarification(), public.stamp_actor_inquiry(), public.stamp_actor_leg() from public, anon, authenticated;
