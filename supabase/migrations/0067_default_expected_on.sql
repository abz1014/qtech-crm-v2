-- 0067_default_expected_on (lifecycle audit G1): every leg that becomes placed gets an expected date, in the database.
--
-- "Goods late" on Today needs supplier_orders.expected_on. Repeat orders, hand-added legs and legs placed by issuing their PO never had one,
-- so late goods were never raised for exactly those orders. The screen used to write the default when a person looked at the leg; this moves
-- it here, so it holds for every route (a stamp, a typed date, issue_purchase_order, an import-free API call) and never on page load.
--
-- When a leg becomes placed (inserted placed, or placed_on goes from NULL to a date) with no expected_on and not delivered:
--   1. the longest lead time the supplier quoted for the RFQ items on this leg (text such as "2 wks", "4-6 weeks", "10 days", "ex-stock"),
--      added to placed_on (the same reading as src/features/orders/lib/leadTime.ts);
--   2. else the supplier's median days from placed to delivered over their finished legs (two or more needed);
--   3. else 30 days.
-- Imported orders (orders.legacy_source is set) and imported legs are left alone. A person who clears the date afterwards keeps it cleared:
-- the trigger acts only on the transition to placed. Nothing else changes.

-- The largest number of days a lead-time text promises; NULL when it says nothing a date can be made from.
create function public.lead_time_upper_days(p_text text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_t      text := btrim(coalesce(p_text, ''));
  v_m      text[];
  v_upper  numeric;
  v_unit   text;
  v_factor integer;
begin
  if v_t = '' then
    return null;
  end if;
  v_m := regexp_match(v_t, '(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(working days|[a-zA-Z]+)?', 'i');
  if v_m is null then
    return case when v_t ~* '\m(ex[-\s]?stock|in[-\s]?stock|from stock|stock|immediate(ly)?|ready)\M' then 0 end;
  end if;
  v_upper := coalesce(v_m[2], v_m[1])::numeric;
  v_unit := lower(btrim(coalesce(v_m[3], 'days')));
  v_factor := case
    when v_unit in ('w', 'wk', 'wks', 'week', 'weeks') then 7
    when v_unit in ('m', 'mo', 'mos', 'month', 'months') then 30
    when v_unit in ('d', 'day', 'days', 'working days', 'wd') then 1
  end;
  if v_factor is null then
    return null;
  end if;
  return round(v_upper * v_factor)::integer;
end;
$$;

-- The supplier's median days from placed to delivered over their latest 50 finished legs; NULL with fewer than two.
create function public.supplier_median_delivery_days(p_supplier_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case when count(*) >= 2 then round(percentile_cont(0.5) within group (order by d))::integer end
  from (
    select (delivered_on - placed_on) as d
    from public.supplier_orders
    where supplier_id = p_supplier_id and placed_on is not null and delivered_on is not null and delivered_on >= placed_on
    order by delivered_on desc
    limit 50
  ) x
$$;

create function public.default_leg_expected_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if new.placed_on is null or new.expected_on is not null or new.delivered_on is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.placed_on is not null then
    return new;   -- already placed: a cleared expected date stays cleared
  end if;
  if new.legacy_source is not null or exists (select 1 from public.orders o where o.id = new.order_id and o.legacy_source is not null) then
    return new;
  end if;

  select max(public.lead_time_upper_days(q.lead_time)) into v_days
  from public.supplier_quote_lines q
  where new.inquiry_id is not null
    and q.inquiry_id = new.inquiry_id
    and q.rfq_item_id in (select i.rfq_item_id from public.order_items i where i.supplier_order_id = new.id and i.rfq_item_id is not null);

  if v_days is null then
    v_days := coalesce(public.supplier_median_delivery_days(new.supplier_id), 30);
  end if;
  new.expected_on := new.placed_on + v_days;
  return new;
end;
$$;

create trigger supplier_orders_default_expected
  before insert or update of placed_on on public.supplier_orders
  for each row execute function public.default_leg_expected_on();

revoke all on function public.default_leg_expected_on() from public, anon, authenticated;
revoke all on function public.lead_time_upper_days(text) from public, anon;
revoke all on function public.supplier_median_delivery_days(uuid) from public, anon;
grant execute on function public.lead_time_upper_days(text) to authenticated;
grant execute on function public.supplier_median_delivery_days(uuid) to authenticated;
