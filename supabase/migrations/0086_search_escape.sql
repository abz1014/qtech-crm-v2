-- 0086_search_escape (hunt HW-29): two fixes to the palette's search_all (last defined in 0054); nothing else changes.
--
--   1. A backslash in the typed text is escaped for ILIKE. 0054 wrote replace(t, '\', '\'), which does nothing, so a name
--      with "\" in it could not be found (the lone backslash escaped the next character instead). Now "\" becomes "\\"
--      first, then "%" and "_" become "\%" and "\_" (ILIKE's default escape character is the backslash).
--   2. Runs of spaces inside the text become one space, so "  srch   word  " finds "srch word".
--
-- Same signature, result columns, SECURITY INVOKER, search_path, comment and grants as 0054.

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
           public.current_user_role() in ('admin', 'sales') as money_ok
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
    where (x.num is not null and r.number = x.num)
       or r.customer_ref ilike x.pat
       or r.company_id in (select id from (select id from cm order by score desc, name limit 25) top)
    order by score desc, r.number desc
    limit (select n from x)
  ), od as (
    -- The customer PO text is searched, matched and shown for admin and sales only.
    select o.id, o.number, o.company_id, case when x.money_ok then o.customer_po_number end as po,
           (case when x.ordnum is not null and o.number = x.ordnum then 3
                 when x.money_ok and o.customer_po_number is not null and lower(o.customer_po_number) = lower(x.t) then 3
                 when x.money_ok and o.customer_po_number ilike x.pre then 2 else 1 end)::real as score
    from public.orders o, x
    where (x.ordnum is not null and o.number = x.ordnum)
       or (x.money_ok and o.customer_po_number ilike x.pat)
    order by score desc, o.number desc
    limit (select n from x)
  ), it as (
    select i.id, i.order_id, i.description,
           (case when lower(i.description) = lower(x.t) then 3 when i.description ilike x.pre then 2 else 1 end)::real as score
    from public.order_items i, x
    where length(x.t) >= 3 and i.description ilike x.pat
    order by score desc, i.created_at desc, i.id
    limit (select n from x)
  ), po as (
    -- Latest revision of the PO with that number; the year in "PO-26-0017" is the year of revision 0.
    select q0.id, q0.number, so.order_id, so.supplier_id, to_char(coalesce(r0.issued_on, q0.issued_on), 'YY') as yy, 3::real as score
    from public.purchase_orders q0
    join public.supplier_orders so on so.id = q0.supplier_order_id
    left join public.purchase_orders r0 on r0.number = q0.number and r0.revision = 0, x
    where x.ponum is not null and q0.number = x.ponum
    order by q0.revision desc
    limit 1
  ), iv as (
    select v.id, v.number, v.order_id, v.company_id, v.invoice_date,
           (case when lower(v.number) = lower(x.t) then 3 when v.number ilike x.pre then 2 else 1 end)::real as score
    from public.invoices v, x
    where x.money_ok and v.number ilike x.pat
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
  'Command-palette search (R12, P02): companies, contacts, RFQs, orders, order items, supplier POs and invoices in one call. SECURITY INVOKER, so row security applies; returns no money. Invoice numbers and customer PO text: admin and sales only.';

revoke all on function public.search_all(text, integer) from public, anon, authenticated;
grant execute on function public.search_all(text, integer) to authenticated;
