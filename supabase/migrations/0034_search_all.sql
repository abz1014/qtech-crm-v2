-- 0034_search_all (R12): one round trip for the command palette. Companies, contacts (name, phone, email), RFQ numbers,
-- customer references and the company name on an RFQ, in one call, each kind capped at `lim` rows.
--
--   search_all(q text, lim int default 8) returns (kind, id, label, meta, company_id, role, score)
--
-- SECURITY INVOKER with a fixed search_path: the caller's row security decides what is visible, so a deactivated user
-- (current_user_role() is NULL, every staff policy fails) gets nothing, and the function says so itself with a guard
-- on top. The result carries names, phones, e-mails, RFQ numbers and references only: no amounts, invoice numbers,
-- prices or margins are read, so an engineer sees nothing money-related. P02 (PO and invoice numbers) adds those
-- kinds later, with its own role check.
--
-- Matching is a case-insensitive substring (ILIKE) so every word fragment works, served by pg_trgm GIN indexes:
--   companies.name, contacts.name, contacts.email, rfqs.customer_ref (gin_trgm_ops) and the digits of contacts.phone.
-- LIKE wildcards typed by the person are escaped. Phones are matched on digits only ("0300 1234" finds "+92 300 1234"
-- when 3 or more digits are typed and the text has no letters). An RFQ number is matched exactly: "177" or "RFQ-0177".
-- Ranking inside a kind: exact, then starts-with, then contains; ties by name (RFQs: newest number first).

create index companies_name_trgm_idx on public.companies using gin (name extensions.gin_trgm_ops);
create index contacts_name_trgm_idx on public.contacts using gin (name extensions.gin_trgm_ops);
create index contacts_email_trgm_idx on public.contacts using gin (email extensions.gin_trgm_ops);
create index contacts_phone_digits_trgm_idx on public.contacts
  using gin ((regexp_replace(phone, '\D', '', 'g')) extensions.gin_trgm_ops);
create index rfqs_customer_ref_trgm_idx on public.rfqs using gin (customer_ref extensions.gin_trgm_ops);
create index rfqs_company_number_idx on public.rfqs (company_id, number desc);

create function public.search_all(q text, lim integer default 8)
returns table (kind text, id uuid, label text, meta text, company_id uuid, role text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select btrim(coalesce(q, '')) as t, least(greatest(coalesce(lim, 8), 1), 25) as n
  ), x as (
    select t, n,
           '%' || replace(replace(replace(t, '\', '\'), '%', '\%'), '_', '\_') || '%' as pat,
           replace(replace(replace(t, '\', '\'), '%', '\%'), '_', '\_') || '%' as pre,
           regexp_replace(t, '\D', '', 'g') as digits,
           case when t ~* '^(rfq[-[:space:]]*)?[0-9]{1,15}$' then regexp_replace(t, '\D', '', 'g')::bigint end as num,
           (t ~ '^[0-9+()[:space:]-]+$' and length(regexp_replace(t, '\D', '', 'g')) >= 3) as phoneish
    from p
    where btrim(coalesce(q, '')) <> '' and length(btrim(coalesce(q, ''))) <= 100 and public.current_user_role() is not null
  ), co as (
    select c.id, c.name, c.country,
           (case when lower(c.name) = lower(x.t) then 3 when c.name ilike x.pre then 2 else 1 end)::real as score
    from public.companies c, x
    where c.name ilike x.pat
    order by score desc, c.name
    limit (select n from x)
  ), ct as (
    select k.id, k.name, k.company_id, k.phone, k.email,
           (case when lower(k.name) = lower(x.t) then 3 when k.name ilike x.pre then 2 else 1 end)::real as score
    from public.contacts k, x
    where k.name ilike x.pat
       or k.email ilike x.pat
       or (x.phoneish and regexp_replace(k.phone, '\D', '', 'g') like '%' || x.digits || '%')
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
       or r.company_id in (select c2.id from public.companies c2 where c2.name ilike x.pat limit 25)
    order by score desc, r.number desc
    limit (select n from x)
  )
  select 'company'::text, co.id, co.name,
         nullif(co.country, ''), co.id, v.role, co.score
  from co left join public.v_company_roles v on v.company_id = co.id
  union all
  select 'contact'::text, ct.id, ct.name,
         nullif(concat_ws(' · ', ct.phone, ct.email), ''), ct.company_id, null::text, ct.score
  from ct
  union all
  select 'rfq'::text, rq.id, 'RFQ-' || lpad(rq.number::text, 4, '0') || ' ' || coalesce(cn.name, ''),
         concat_ws(' · ', case when rq.customer_ref is not null then 'Ref ' || rq.customer_ref end,
                   case when rq.closed_on is not null then 'Closed' else 'Open' end),
         rq.company_id, null::text, rq.score
  from rq left join public.companies cn on cn.id = rq.company_id;
$$;

comment on function public.search_all(text, integer) is
  'Command-palette search (R12): companies, contacts, RFQ numbers and customer refs in one call. SECURITY INVOKER, so row security applies; returns no money.';

revoke all on function public.search_all(text, integer) from public, anon, authenticated;
grant execute on function public.search_all(text, integer) to authenticated;
