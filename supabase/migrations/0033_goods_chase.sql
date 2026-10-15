-- 0033_goods_chase (R16): the goods-chase stamp. A late supplier leg is chased from Today, and that chase has to be
-- remembered the way the customer and supplier-quote chases are, so the item moves to the Waiting group and comes
-- back on its threshold date instead of nagging. DATA_MODEL section 4 (stamps) and decision L.
--
--   supplier_orders.last_chased_on  date, set by stamp_goods_chase to today (Karachi)
--   supplier_orders.chase_count     smallint, not null, default 0, check >= 0; incremented by the same call
--
--   stamp_goods_chase(p_leg_id) returns the new count. SECURITY INVOKER with a fixed search_path, like the other
--   stamp functions: the caller's row security decides who may update a leg (all staff, section 10). An unknown or
--   invisible leg is an error, not a silent no-op. Executable by authenticated only.

alter table public.supplier_orders
  add column last_chased_on date,
  add column chase_count smallint not null default 0 check (chase_count >= 0);

comment on column public.supplier_orders.last_chased_on is
  'Stamped by stamp_goods_chase when the goods-chase text is copied. Drives the Waiting group on Today.';
comment on column public.supplier_orders.chase_count is
  'Incremented by stamp_goods_chase. Chases of the supplier for late goods, not quote chases (those are on supplier_inquiries).';

create function public.stamp_goods_chase(p_leg_id uuid)
returns smallint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count smallint;
begin
  update public.supplier_orders l
  set last_chased_on = public.today_pkt(),
      chase_count    = l.chase_count + 1
  where l.id = p_leg_id
  returning l.chase_count into v_count;
  if not found then
    raise exception 'supplier order % not found', p_leg_id using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

revoke all on function public.stamp_goods_chase(uuid) from public, anon, authenticated;
grant execute on function public.stamp_goods_chase(uuid) to authenticated;
