-- 0131_delivery_challans (process gaps, item 3): a delivery challan (the paper that travels with the goods) for an order. EXPAND-ONLY: one new
-- table and two functions; nothing existing changes.
--
-- The data model has no customer deliveries (supplier_orders.delivered_on is goods arriving AT Q-Tech), so a challan belongs to the ORDER, and an
-- order can have several (a part delivery, then the rest): each challan keeps the lines and quantities it was issued with. Items and quantities
-- only: no price is read, stored or printed (the lines are copied from order_items' description, unit and qty).
--
-- Number: its own series, "DC-0001", "DC-0002"... handed out by create_delivery_challan under an advisory lock (so two people issuing at the same
-- moment get two numbers), and unique ignoring case (the unique index on lower(number), the invoice series' rule).
--
-- Who: every active role reads and issues a challan (an engineer takes the goods to site; the lines carry no price); only an admin deletes one.
-- A challan is not edited once issued. As 0087, 0102, 0110 and 0130 do, the grants mirror authenticated's to qtech_engineer (0081's coverage
-- test) and ROW SECURITY says who.

create table public.delivery_challans (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  number      text not null check (number ~* '^DC-[0-9A-Z-]+$'),
  issued_on   date not null default public.today_pkt(),
  deliver_to  text check (deliver_to is null or char_length(deliver_to) <= 500),
  lines       jsonb not null check (case when jsonb_typeof(lines) = 'array' then jsonb_array_length(lines) > 0 else false end),
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.users (id) on delete restrict
);

create unique index delivery_challans_number_key on public.delivery_challans (lower(number));
create index delivery_challans_order_idx on public.delivery_challans (order_id, issued_on desc);
create index delivery_challans_created_by_idx on public.delivery_challans (created_by) where created_by is not null;

comment on table public.delivery_challans is
  'A delivery challan for an order: its own DC- number series, the delivery address, and the lines and quantities delivered (description, unit, qty; never a price). Issued with create_delivery_challan (0131).';
comment on column public.delivery_challans.lines is
  'JSON array of {item_id, position, description, unit, qty}: a copy taken when the challan was issued, so it reads the same later.';

alter table public.delivery_challans enable row level security;

revoke all on table public.delivery_challans from public, anon, authenticated;
grant select, insert, delete on table public.delivery_challans to authenticated, qtech_engineer;

create policy delivery_challans_select_staff on public.delivery_challans for select to authenticated, qtech_engineer
  using ((select public.current_user_role()) is not null);
create policy delivery_challans_insert_staff on public.delivery_challans for insert to authenticated, qtech_engineer
  with check ((select public.current_user_role()) is not null);
create policy delivery_challans_delete_admin on public.delivery_challans for delete to authenticated, qtech_engineer
  using ((select public.current_user_role()) = 'admin');

create trigger delivery_challans_audit after insert or update or delete on public.delivery_challans
  for each row execute function public.audit_row_change();

-- ================================================================ the next number
-- "DC-" and the highest number in the series plus one, four digits at least ("DC-0007" -> "DC-0008"). A suggestion for the screen; the
-- unique index decides.
create function public.next_challan_number()
returns text
language sql
stable
set search_path = ''
as $$
  select 'DC-' || lpad((coalesce(max(substr(c.number, 4)::bigint), 0) + 1)::text, 4, '0')
  from public.delivery_challans c
  where c.number ~* '^DC-[0-9]{1,15}$'
$$;

revoke all on function public.next_challan_number() from public, anon, authenticated;
grant execute on function public.next_challan_number() to authenticated, qtech_engineer;

-- ================================================================ issue one
-- p_lines: [{"item_id": uuid, "qty": number}] (a part delivery lists some lines, or fewer units); NULL = every goods line of the order at its
-- ordered quantity. The description, unit and position come from the order's own lines; a service line is never on a challan.
create function public.create_delivery_challan(p_order_id uuid, p_lines jsonb default null, p_deliver_to text default null, p_notes text default null)
returns public.delivery_challans
language plpgsql
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_row public.delivery_challans;
begin
  if public.current_user_role() is null then
    raise exception 'Sign in to issue a challan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'That order could not be found.' using errcode = 'P0002';
  end if;

  if p_lines is null then
    select jsonb_agg(jsonb_build_object('item_id', i.id, 'position', i.position, 'description', i.description, 'unit', i.unit, 'qty', i.qty) order by i.position, i.created_at)
      into v_lines
      from public.order_items i
     where i.order_id = p_order_id and not i.is_service;
  else
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'The challan lines must be a list.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(p_lines) as x(item_id uuid, qty numeric)
      join public.order_items i on i.id = x.item_id and i.order_id = p_order_id
      where x.qty > i.qty
    ) then
      raise exception 'A challan cannot list more than the order has.' using errcode = '22023', hint = 'qty_over';
    end if;
    select jsonb_agg(jsonb_build_object('item_id', i.id, 'position', i.position, 'description', i.description, 'unit', i.unit, 'qty', x.qty) order by i.position, i.created_at)
      into v_lines
      from jsonb_to_recordset(p_lines) as x(item_id uuid, qty numeric)
      join public.order_items i on i.id = x.item_id and i.order_id = p_order_id and not i.is_service
     where x.qty > 0;
  end if;
  if v_lines is null then
    raise exception 'Add at least one line to the challan.' using errcode = '22023', hint = 'no_lines';
  end if;

  -- two people issuing at the same moment get two numbers
  perform pg_advisory_xact_lock(hashtextextended('delivery_challan_number', 0));
  insert into public.delivery_challans (order_id, number, deliver_to, lines, notes)
  values (p_order_id, public.next_challan_number(), nullif(btrim(p_deliver_to), ''), v_lines, nullif(btrim(p_notes), ''))
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_delivery_challan(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_delivery_challan(uuid, jsonb, text, text) to authenticated, qtech_engineer;
