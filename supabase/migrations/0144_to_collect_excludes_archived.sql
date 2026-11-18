-- 0144: "To collect" leaves out archived orders (owner decision, 18 Nov 2026).
--
-- receivables_summary() feeds the Home "To collect" card, the Money home hero and the To collect page totals and tiles. With archiving ON
-- it now skips every order that is_archived('order', id) says is archived (the rule plus the unhide overrides). With archiving OFF it is
-- exactly what it was: the whole book.
--
-- This SUPERSEDES the sentence in 0141_archive_core.sql that lists receivables_summary among the functions that "stay unchanged".
-- Everything else is still unchanged on purpose: receivables_list, order_receivables, v_order_money, P&L, GST, month-end, aging, reports,
-- KPIs, the company page totals and the pickers. Only this one function reads the archive.
--
-- The body is 0076's, with one change: the r CTE. Same signature, same columns, SECURITY INVOKER as before.
-- is_archived() gives NULL for a caller with no role (the outer where already returns no row for them) and is read per order id.

create or replace function public.receivables_summary(p_today date default null)
returns table (
  open_count          integer,
  outstanding         numeric,
  overdue_count       integer,
  overdue             numeric,
  reminder_due_count  integer,
  not_yet_due_count   integer,
  not_yet_due         numeric,
  not_invoiced_count  integer,
  not_invoiced        numeric,
  gross               numeric,
  settled             numeric,
  settled_count       integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  r as (
    select l.*, cardinality(l.invoice_numbers) > 0 as invoiced
    from public.receivables_list(null, null, null, true) l
    cross join (select coalesce((select s.enabled from public.archive_settings s where s.id = 1), false) as arch_on) x
    where not x.arch_on or not coalesce(public.is_archived('order', l.order_id), false)
  ),
  o as (
    select * from r where r.payment_state <> 'settled'
  )
  select
    (select count(*) from o)::int,
    (select coalesce(sum(o.balance), 0) from o),
    (select count(*) from o where o.payment_state = 'overdue')::int,
    (select coalesce(sum(o.balance), 0) from o where o.payment_state = 'overdue'),
    (select count(*) from o
     where o.payment_state = 'overdue'
       and (o.last_reminded_on is null
            or (select count(*) from generate_series(o.last_reminded_on + 1, coalesce(p_today, public.today_pkt()), interval '1 day') g(d)
                where extract(isodow from g.d) < 6) >= 7))::int,
    (select count(*) from o where o.invoiced and o.payment_state <> 'overdue')::int,
    (select coalesce(sum(o.balance), 0) from o where o.invoiced and o.payment_state <> 'overdue'),
    (select count(*) from o where not o.invoiced)::int,
    (select coalesce(sum(o.balance), 0) from o where not o.invoiced),
    (select coalesce(sum(o.gross_target), 0) from o),
    (select coalesce(sum(o.settled), 0) from o),
    (select count(*) from r where r.payment_state = 'settled')::int
  where (select public.current_user_role()) is not null
$$;

revoke all on function public.receivables_summary(date) from public, anon, authenticated;
grant execute on function public.receivables_summary(date) to authenticated;

comment on function public.receivables_summary(date) is
  'Who-owes-us counts and sums in one row (the rules of receivableTotals in the client), over receivables_list(p_with_value => true). 0144 (owner decision 2026-11-18): with archiving on, archived orders are left out, so To collect shows live orders only; with it off, the whole book.';
