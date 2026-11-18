-- 0143_archive_search_fast: search_all and search_closed_rfqs keep leaving archived records out (0142), but without a per-row is_archived() call.
--
-- Why: with archiving ON (the production mode) 0142 called is_archived() for every candidate row (for example every RFQ of the top 25 matching
-- companies), a plpgsql call plus two reads each, and the R12 timing only ever ran with archiving OFF. Here the rule of 0141 is written inline and
-- set-based: the enabled flag and cutoff are read ONCE (x.arch_on, x.arch_cut; enabled is coalesced to false, so a missing settings row hides
-- nothing), each row's own date and legacy_source columns are tested directly, and the archive_unhidden override is a NOT EXISTS on its primary key.
-- Same truth table as is_archived(): hidden when enabled and (legacy_source is not null, or the document date is null (a row with no legacy
-- source first falls back to its created_at Karachi day), or the date is before the cutoff) and no archive_unhidden row. Document dates: rfqs.received_on,
-- orders.ordered_on, purchase_orders.issued_on, invoices.invoice_date; an order item follows its order.
-- Privileges: only columns qtech_engineer already reads in each branch (rfqs, orders and purchase_orders keep their 0081 table or column grants; 0133 only
-- withholds orders.customer_po_number), so an engineer still gets no 42501. Signatures, result columns, security invoker, search_path, grants: unchanged
-- from 0142. CREATE OR REPLACE only; expand-only in effect. pgTAP 0143 proves the results equal the is_archived() logic.

create or replace function public.search_all(q text, lim integer default 8)
returns table (kind text, id uuid, label text, meta text, company_id uuid, order_id uuid, role text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select regexp_replace(btrim(coalesce(q, '')), '[[:space:]]+', ' ', 'g') as t, least(greatest(coalesce(lim, 8), 1), 25) as n
  ), x as (
    select t, n,
           '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pre,
           regexp_replace(regexp_replace(t, '\D', '', 'g'), '^(0092|92|0)', '') as digits,
           case when t ~* '^(rfq[-[:space:]]*)?[0-9]{1,15}$' then regexp_replace(t, '\D', '', 'g')::bigint end as num,
           case when t ~* '^(ord[-[:space:]]*)?[0-9]{1,9}$' then regexp_replace(t, '\D', '', 'g')::bigint end as ordnum,
           case when t ~* '^po[-[:space:]]*([0-9]{2}[-[:space:]]*)?[0-9]{1,6}$' then (regexp_match(t, '([0-9]+)$'))[1]::integer end as ponum,
           (t ~ '^[0-9+()[:space:]-]+$' and length(regexp_replace(regexp_replace(t, '\D', '', 'g'), '^(0092|92|0)', '')) >= 3) as phoneish,
           public.current_user_role() in ('admin', 'sales') as money_ok,
           coalesce((select a.enabled from public.archive_settings a where a.id = 1), false) as arch_on,
           (select a.cutoff from public.archive_settings a where a.id = 1) as arch_cut
    from p
    where btrim(coalesce(q, '')) <> '' and length(btrim(coalesce(q, ''))) <= 100 and public.current_user_role() is not null
  ), cm as materialized (
    select c.id, c.name, c.country,
           (case when lower(c.name) = lower(x.t) then 3 when c.name ilike x.pre then 2 else 1 end)::real as score
    from public.companies c, x
    where c.name ilike x.pat
  ), co as (
    select id, name, country, score from cm order by score desc, name limit (select n from x)
  ), ct as (
    select k.id, k.name, k.company_id, k.phone, k.email,
           (case when lower(k.name) = lower(x.t) then 3 when k.name ilike x.pre then 2 else 1 end)::real as score
    from public.contacts k, x
    where k.name ilike x.pat
       or k.email ilike x.pat
       or (x.phoneish and regexp_replace(regexp_replace(k.phone, '\D', '', 'g'), '^(0092|92|0)', '') like '%' || x.digits || '%')
    order by score desc, k.name
    limit (select n from x)
  ), rq as (
    select r.id, r.number, r.customer_ref, r.company_id, r.closed_on,
           (case when x.num is not null and r.number = x.num then 3
                 when r.customer_ref is not null and lower(r.customer_ref) = lower(x.t) then 3
                 when r.customer_ref ilike x.pre then 2 else 1 end)::real as score
    from public.rfqs r, x
    where ((x.num is not null and r.number = x.num)
       or r.customer_ref ilike x.pat
       or r.company_id in (select id from (select id from cm order by score desc, name limit 25) top))
      and (not x.arch_on or not ((r.legacy_source is not null or (case when r.legacy_source is null then coalesce(r.received_on, ((r.created_at at time zone 'Asia/Karachi')::date)) else r.received_on end) is null or (case when r.legacy_source is null then coalesce(r.received_on, ((r.created_at at time zone 'Asia/Karachi')::date)) else r.received_on end) < x.arch_cut)
           and not exists (select 1 from public.archive_unhidden u where u.entity = 'rfq' and u.row_id = r.id)))
    order by score desc, r.number desc
    limit (select n from x)
  ), od as (
    -- The customer PO text is searched, matched and shown for admin and sales only. It is read through qtech_private.order_po (0133),
    -- which returns it NULL to anyone else: an engineer's role holds no SELECT on orders.customer_po_number, so naming the column
    -- here would be refused (42501) and the whole search would fail for them.
    select o.id, o.number, o.company_id, case when x.money_ok then op.customer_po_number end as po,
           (case when x.ordnum is not null and o.number = x.ordnum then 3
                 when x.money_ok and op.customer_po_number is not null and lower(op.customer_po_number) = lower(x.t) then 3
                 when x.money_ok and op.customer_po_number ilike x.pre then 2 else 1 end)::real as score
    from public.orders o
    join qtech_private.order_po op on op.order_id = o.id
    cross join x
    where ((x.ordnum is not null and o.number = x.ordnum)
       or (x.money_ok and op.customer_po_number ilike x.pat))
      and (not x.arch_on or not ((o.legacy_source is not null or (case when o.legacy_source is null then coalesce(o.ordered_on, ((o.created_at at time zone 'Asia/Karachi')::date)) else o.ordered_on end) is null or (case when o.legacy_source is null then coalesce(o.ordered_on, ((o.created_at at time zone 'Asia/Karachi')::date)) else o.ordered_on end) < x.arch_cut)
           and not exists (select 1 from public.archive_unhidden u where u.entity = 'order' and u.row_id = o.id)))
    order by score desc, o.number desc
    limit (select n from x)
  ), it as (
    select i.id, i.order_id, i.description,
           (case when lower(i.description) = lower(x.t) then 3 when i.description ilike x.pre then 2 else 1 end)::real as score
    from public.order_items i, x
    where length(x.t) >= 3 and i.description ilike x.pat
      and (not x.arch_on or not exists (select 1 from public.orders io where io.id = i.order_id
           and (io.legacy_source is not null or (case when io.legacy_source is null then coalesce(io.ordered_on, ((io.created_at at time zone 'Asia/Karachi')::date)) else io.ordered_on end) is null or (case when io.legacy_source is null then coalesce(io.ordered_on, ((io.created_at at time zone 'Asia/Karachi')::date)) else io.ordered_on end) < x.arch_cut)
           and not exists (select 1 from public.archive_unhidden u where u.entity = 'order' and u.row_id = io.id)))
    order by score desc, i.created_at desc, i.id
    limit (select n from x)
  ), po as (
    -- Latest revision of the PO with that number; the year in "PO-26-0017" is the year of revision 0.
    select q0.id, q0.number, so.order_id, so.supplier_id, to_char(coalesce(r0.issued_on, q0.issued_on), 'YY') as yy, 3::real as score
    from public.purchase_orders q0
    join public.supplier_orders so on so.id = q0.supplier_order_id
    left join public.purchase_orders r0 on r0.number = q0.number and r0.revision = 0, x
    where x.money_ok and x.ponum is not null and q0.number = x.ponum
      and (not x.arch_on or not (((coalesce(q0.issued_on, ((q0.created_at at time zone 'Asia/Karachi')::date))) is null or (coalesce(q0.issued_on, ((q0.created_at at time zone 'Asia/Karachi')::date))) < x.arch_cut)
           and not exists (select 1 from public.archive_unhidden u where u.entity = 'purchase_order' and u.row_id = q0.id)))
    order by q0.revision desc
    limit 1
  ), iv as (
    select v.id, v.number, v.order_id, v.company_id, v.invoice_date,
           (case when lower(v.number) = lower(x.t) then 3 when v.number ilike x.pre then 2 else 1 end)::real as score
    from public.invoices v, x
    where x.money_ok and v.number ilike x.pat
      and (not x.arch_on or not ((v.legacy_source is not null or (case when v.legacy_source is null then coalesce(v.invoice_date, ((v.created_at at time zone 'Asia/Karachi')::date)) else v.invoice_date end) is null or (case when v.legacy_source is null then coalesce(v.invoice_date, ((v.created_at at time zone 'Asia/Karachi')::date)) else v.invoice_date end) < x.arch_cut)
           and not exists (select 1 from public.archive_unhidden u where u.entity = 'invoice' and u.row_id = v.id)))
    order by score desc, v.invoice_date desc nulls last, v.number desc
    limit (select n from x)
  )
  select 'company'::text, co.id, co.name,
         nullif(co.country, ''), co.id, null::uuid, v.role, co.score
  from co left join public.v_company_roles v on v.company_id = co.id
  union all
  select 'contact'::text, ct.id, ct.name,
         nullif(concat_ws(' · ', ct.phone, ct.email), ''), ct.company_id, null::uuid, null::text, ct.score
  from ct
  union all
  select 'rfq'::text, rq.id, 'RFQ-' || repeat('0', greatest(0, 4 - length(rq.number::text))) || rq.number::text || ' ' || coalesce(cn.name, ''),
         concat_ws(' · ', case when rq.customer_ref is not null then 'Ref ' || rq.customer_ref end,
                   case when rq.closed_on is not null then 'Closed' else 'Open' end),
         rq.company_id, null::uuid, null::text, rq.score
  from rq left join public.companies cn on cn.id = rq.company_id
  union all
  select 'order'::text, od.id, 'ORD-' || repeat('0', greatest(0, 4 - length(od.number::text))) || od.number::text || ' ' || coalesce(cn.name, 'Unknown company'),
         case when od.po is not null then 'Customer PO ' || od.po end,
         od.company_id, od.id, null::text, od.score
  from od left join public.companies cn on cn.id = od.company_id
  union all
  select 'item'::text, it.id, it.description,
         concat_ws(' · ', 'ORD-' || repeat('0', greatest(0, 4 - length(o.number::text))) || o.number::text, cn.name),
         o.company_id, it.order_id, null::text, it.score
  from it join public.orders o on o.id = it.order_id left join public.companies cn on cn.id = o.company_id
  union all
  select 'po'::text, po.id, 'PO-' || po.yy || '-' || repeat('0', greatest(0, 4 - length(po.number::text))) || po.number::text || ' ' || coalesce(sn.name, ''),
         concat_ws(' · ', 'Supplier PO', 'ORD-' || repeat('0', greatest(0, 4 - length(o.number::text))) || o.number::text),
         po.supplier_id, po.order_id, null::text, po.score
  from po join public.orders o on o.id = po.order_id left join public.companies sn on sn.id = po.supplier_id
  union all
  select 'invoice'::text, iv.id, coalesce(iv.number, ''),
         concat_ws(' · ', cn.name, case when o.number is not null then 'ORD-' || repeat('0', greatest(0, 4 - length(o.number::text))) || o.number::text end),
         coalesce(iv.company_id, o.company_id), iv.order_id, null::text, iv.score
  from iv left join public.orders o on o.id = iv.order_id left join public.companies cn on cn.id = coalesce(iv.company_id, o.company_id);
$$;

comment on function public.search_all(text, integer) is
  'Command-palette search (R12, P02): companies, contacts, RFQs, orders, order items, supplier POs and invoices in one call; archived RFQs, orders (and their items), supplier POs and invoices are left out (0142, set-based since 0143). SECURITY INVOKER, so row security applies; returns no money. Invoice numbers, customer PO text and supplier PO numbers: admin and sales only (the customer PO is read through qtech_private.order_po, 0133; the supplier PO gate is 0139).';

revoke all on function public.search_all(text, integer) from public, anon, authenticated;
grant execute on function public.search_all(text, integer) to authenticated;

create or replace function public.search_closed_rfqs(p_text text, p_limit integer default 25, p_offset integer default 0)
returns table (rfq_id uuid, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with words as (
    select distinct w
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_text, ''))), '\s+')) as w
    where w <> ''
  ),
  closed as (
    select r.id, r.received_on, r.number,
           lower(concat_ws(' ', c.name, r.customer_ref, 'rfq-' || case when length(r.number::text) >= 4 then r.number::text else lpad(r.number::text, 4, '0') end, r.number::text)) as hay
    from public.rfqs r
    join public.companies c on c.id = r.company_id
    where (r.closed_on is not null
       or exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null))
      and (not coalesce((select a.enabled from public.archive_settings a where a.id = 1), false)
           or not ((r.legacy_source is not null or (case when r.legacy_source is null then coalesce(r.received_on, ((r.created_at at time zone 'Asia/Karachi')::date)) else r.received_on end) is null or (case when r.legacy_source is null then coalesce(r.received_on, ((r.created_at at time zone 'Asia/Karachi')::date)) else r.received_on end) < (select a.cutoff from public.archive_settings a where a.id = 1))
                   and not exists (select 1 from public.archive_unhidden u where u.entity = 'rfq' and u.row_id = r.id)))
  ),
  hits as (
    select k.id, k.received_on, k.number
    from closed k
    where not exists (
      select 1 from words
      where position(words.w in k.hay) = 0
        and not exists (select 1 from public.rfq_items i where i.rfq_id = k.id and position(words.w in lower(i.description)) > 0)
    )
  )
  select h.id, count(*) over ()
  from hits h
  order by h.received_on desc, h.number desc
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.search_closed_rfqs(text, integer, integer) is
  'The RFQ list''s Closed search: won and closed RFQs whose company, customer reference, number or item text holds every word, newest first, one page with the total (0070). Archived RFQs are left out (0142, set-based since 0143).';

revoke all on function public.search_closed_rfqs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_closed_rfqs(text, integer, integer) to authenticated;
