-- 0125_customer_statement (process audit 7). A customer's statement of account: every invoice, payment and credit note of one company up to a
-- date, so the app can print opening balance, the lines of a date range with a running balance, and the closing balance.
--
-- customer_statement(company, to) returns the lines (one row each); the app picks the date range, works out the opening balance (the
-- lines before the range), the running balance and the closing balance. Admin only (it reads payments, which sales cannot); everyone else
-- gets no rows. Settled-before-cutover invoices (paid before this system) are not listed; a voided invoice has no figures and is not listed.
--
-- Credit notes and refunds are being built on branch fix/money-integrity (0112 credit_notes; refunds not yet). This function is written so
-- that branch and this one merge without touching each other: credit notes are read only when the table exists (to_regclass), through
-- dynamic SQL, and the place for refunds is marked below. Nothing here references an object that only the other branch creates.
--
-- Expand-only: one new function. No price reaches an engineer: the function is admin-only and returns nothing to anyone else.

create function public.customer_statement(p_company uuid, p_to date default null)
returns table (
  line_on       date,
  kind          text,      -- 'invoice' | 'payment' | 'credit_note' | 'refund'
  ref           text,      -- the invoice or credit note number, or the payment reference
  order_number  bigint,
  note          text,
  debit         numeric,   -- what the customer owes more (invoice, refund paid out)
  credit        numeric,   -- what the customer owes less (payment, credit note)
  seq           integer    -- the order inside one day: invoices, then credit notes, then payments, then refunds
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, public.today_pkt());
begin
  if public.current_user_role() is distinct from 'admin' then
    return;
  end if;

  return query
  select coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date)::date,
         'invoice'::text, v.number::text, o.number::bigint, null::text,
         (v.net_amount + v.gst_amount)::numeric, 0::numeric, 1
  from public.invoices v
  left join public.orders o on o.id = v.order_id
  where coalesce(v.company_id, o.company_id) = p_company
    and not v.settled_before_cutover
    and (v.net_amount + v.gst_amount) <> 0
    and coalesce(v.invoice_date, o.ordered_on, (v.created_at at time zone 'Asia/Karachi')::date) <= v_to;

  return query
  select p.received_on::date, 'payment'::text, p.reference::text, o.number::bigint, null::text,
         0::numeric, p.amount::numeric, 3
  from public.payments_in p
  join public.orders o on o.id = p.order_id
  where o.company_id = p_company
    and p.voided_at is null
    and p.received_on <= v_to;

  -- credit notes (fix/money-integrity, 0112): read only once that table exists
  if to_regclass('public.credit_notes') is not null then
    return query execute
      'select c.issued_on::date, ''credit_note''::text, c.number::text, o.number::bigint, c.reason::text, '
      '0::numeric, (c.net_amount + c.gst_amount)::numeric, 2 '
      'from public.credit_notes c left join public.orders o on o.id = c.order_id '
      'where coalesce(c.company_id, o.company_id) = $1 and c.issued_on <= $2'
    using p_company, v_to;
  end if;

  -- refunds: when money paid back to a customer is recorded, return it here as kind 'refund' with a DEBIT (it raises what they owe), seq 4.
end;
$$;

revoke all on function public.customer_statement(uuid, date) from public, anon;
grant execute on function public.customer_statement(uuid, date) to authenticated, qtech_engineer;   -- 0081 mirror; returns no row for anyone but an admin
