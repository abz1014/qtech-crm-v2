-- 0082_close_stale_imported_rfqs (owner decision 2026-10-22): close every IMPORTED RFQ that has had no activity for more
-- than 60 days. Production showed "113 open · 87 overdue" right after the legacy import, some 600 days overdue, flooding
-- Today and the RFQ list with work nobody will do.
--
-- Which RFQs: legacy_source is not null (imported, 0078 marker) AND open exactly as v_rfq_state reads it (closed_on is null
-- and no live order: an order with cancelled_on is null means won) AND the last real activity is more than 60 days before
-- today in Karachi (public.today_pkt()): last activity < today - 60. 60 days exactly stays open.
--
-- Last real activity = the latest of these dates (never the import run's own stamps: rfqs.created_at / updated_at are not
-- read, nor created_at of any imported child row):
--   rfqs                  received_on (old rfq_date), due_on (old quote_deadline or "Due:" in the notes), quoted_on (old
--                         quote_sent_date); any of them a person changed in v2 counts too
--   supplier_inquiries    sent_on (old sent_at), last_chased_on, no_offer_on, last_relayed_at (Karachi date)
--   supplier_quote_lines  imported: the old quote's received_at, else its created_at, from legacy_archive.legacy_rows (read
--                         only when it starts with an ISO date); made in v2: created_at (Karachi date)
--   clarifications        created_at, first_asked_at, last_asked_at, answered_at, withdrawn_at (none are imported, so all
--                         are v2 activity)
--   quotations            issued_on (none are imported)
--   audit_log             a change to the RFQ row made by a signed-in person (changed_by is not null): someone touched it
--                         in v2. The import's own inserts carry no person.
--
-- How they close: the same columns the app's Close RFQ writes (features/rfqs/api.ts setRfqClosed): closed_on = today (PKT),
-- close_reason = 'no_reply_to_clarification' (the existing value closest to "No reply from customer"; the companies page
-- already labels it so, and DATA_MODEL section 7 named it for this clean-up; no new CHECK value), close_note = the sentence
-- below. The rfqs audit trigger records each one as a system change (changed_by null). Reopen in the app sets the three
-- back to null, as for any closed RFQ. Nothing else on the RFQ changes.
--
-- Idempotent: a closed RFQ is no longer open, so a second run closes nothing. A database with no imported RFQs (CI, a fresh
-- project) closes nothing. The work is a function so pgTAP can run it on fixtures with a chosen day:
-- legacy_archive.close_stale_imported_rfqs(p_today, p_days) returns how many it closed. It lives in legacy_archive (not
-- exposed by the API; owner only, like the archive it reads) and runs once below.

create function legacy_archive.iso_date(t text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(t, 10)::date;
exception when others then
  return null;
end;
$$;

revoke all on function legacy_archive.iso_date(text) from public, anon, authenticated, service_role;

create function legacy_archive.rfq_last_activity(p_rfq_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(d) from (
    select r.received_on as d from public.rfqs r where r.id = p_rfq_id
    union all select r.due_on from public.rfqs r where r.id = p_rfq_id
    union all select r.quoted_on from public.rfqs r where r.id = p_rfq_id
    union all
    select greatest(si.sent_on, si.last_chased_on, si.no_offer_on, public.today_pkt(si.last_relayed_at))
    from public.supplier_inquiries si where si.rfq_id = p_rfq_id
    union all
    select case
             when ql.legacy_source is null then public.today_pkt(ql.created_at)
             else coalesce(legacy_archive.iso_date(a.data -> 'row' ->> 'received_at'),
                           legacy_archive.iso_date(a.data -> 'row' ->> 'created_at'))
           end
    from public.supplier_quote_lines ql
    join public.supplier_inquiries si on si.id = ql.inquiry_id
    left join legacy_archive.legacy_rows a on a.table_name = 'supplier_quote_lines' and a.row_id = ql.id
    where si.rfq_id = p_rfq_id
    union all
    select greatest(public.today_pkt(c.created_at), public.today_pkt(c.first_asked_at), public.today_pkt(c.last_asked_at),
                    public.today_pkt(c.answered_at), public.today_pkt(c.withdrawn_at))
    from public.clarifications c where c.rfq_id = p_rfq_id
    union all
    select q.issued_on from public.quotations q where q.rfq_id = p_rfq_id
    union all
    select public.today_pkt(max(al.changed_at)) from public.audit_log al
    where al.table_name = 'rfqs' and al.record_id = p_rfq_id::text and al.changed_by is not null
  ) x
$$;

revoke all on function legacy_archive.rfq_last_activity(uuid) from public, anon, authenticated, service_role;

create function legacy_archive.close_stale_imported_rfqs(p_today date default public.today_pkt(), p_days integer default 60)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.rfqs r
     set closed_on    = p_today,
         close_reason = 'no_reply_to_clarification',
         close_note   = 'Closed automatically: imported, no activity for 60+ days (owner decision 2026-10-22)'
   where r.legacy_source is not null
     and r.closed_on is null
     and not exists (select 1 from public.orders o where o.rfq_id = r.id and o.cancelled_on is null)
     and legacy_archive.rfq_last_activity(r.id) < p_today - p_days;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function legacy_archive.close_stale_imported_rfqs(date, integer) from public, anon, authenticated, service_role;

comment on function legacy_archive.close_stale_imported_rfqs(date, integer) is
  'Owner decision 2026-10-22 (0082): closes imported, open RFQs whose last real activity (legacy_archive.rfq_last_activity) '
  'is more than p_days before p_today, as "no_reply_to_clarification" with an automatic note. Returns the count. Idempotent.';

do $do$
declare
  n integer;
begin
  n := legacy_archive.close_stale_imported_rfqs();
  raise notice '0082: closed % stale imported RFQ(s)', n;
end
$do$;
