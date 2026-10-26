-- 0098_category_admin (redesign L5, tasks C4 and C5): Settings > Product categories is for the admin, and "Fill missing categories"
-- fills rfq_items.family_id and order_items.family_id from the keyword dictionary. EXPAND-ONLY: one new trigger, nothing is altered.
--
-- (1) Who may rename or curate a category. A product category is a brands row of kind family (0006); `curated` (0093) marks the
--     canonical ones that "Ask more suppliers" suggests. brands is writable by every staff role (0006: a brand or family is made
--     on the fly from an item), so without a rule a salesperson could rename "Contactors" or un-curate it from the data API. The
--     screen is admin only; this makes the database say so. guard_category_admin refuses, for anyone who is not an admin:
--       - inserting a row with curated = true,
--       - changing `curated`,
--       - renaming a curated family.
--     Renaming or editing anything else (an uncurated family, a brand) is as before. merge_brands (0019) is already admin only.
--     The functions that run as their owner (merge_brands runs as the admin who calls it; the seed in qtech_private) are not
--     limited: the guard names the API roles only, the 0093 / 0101 shape (an engineer's request is qtech_engineer since 0081).
--
-- (2) Fill missing categories needs NO new rule and NO month-lock allowance, which this file proves in its test rather than assumes:
--     enforce_month_lock (0027, 0086, 0089) is attached to payments_in, expenses and invoices only, so an UPDATE of
--     order_items.family_id (or rfq_items.family_id) in a month that is closed is not blocked; the 0092 "whose is it" guard on
--     rfq_items.family_id lets an admin through, 0065's money guard on order_items does not list family_id, and every changed row
--     is audited by the row's own audit trigger (0013). So the screen updates in batches of 200 as the admin, and the audit_log
--     keeps who changed which item from what to what.

create function public.guard_category_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'qtech_engineer') then
    return new;
  end if;
  if coalesce((select public.current_user_role()), '') = 'admin' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.curated then
      raise exception 'Only an admin can add a curated product category.' using errcode = '42501', hint = 'admin_only';
    end if;
  elsif new.curated is distinct from old.curated
     or (old.curated and new.name is distinct from old.name) then
    raise exception 'Only an admin can rename or curate a product category.' using errcode = '42501', hint = 'admin_only';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_category_admin() from public, anon, authenticated;

create trigger brands_guard_category_admin before insert or update on public.brands
  for each row execute function public.guard_category_admin();
