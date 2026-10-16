-- 0044_invoice_number_series (M01): the next invoice number in Q-Tech's series, so "Create invoice" opens with the number
-- already filled in (BUILD_PLAN M01, DATA_MODEL A3 "Invoice number pre-fills as the next number in the series").
--
-- The series is read from the data, not configured: take the most recently created invoice that ends in digits, keep
-- everything before the digits as the prefix ("INV-"), find the highest number that has that same prefix, and add one,
-- keeping the digit width ("INV-0009" -> "INV-0010"; "INV-2311" -> "INV-2312"; "2311" -> "2312"). With no invoice that
-- ends in digits the series starts at INV-0001. The answer is a suggestion: the unique index on invoices (number) still
-- decides, and the app shows "this number is already used" if two people ask at the same moment.
--
-- SECURITY INVOKER with a fixed search_path: the caller's row security decides which invoices are visible, and the
-- role is checked inside as well (an engineer would otherwise get "no invoices" and a misleading INV-0001).
-- Returns one row: next_number, and the invoice it follows (last_number, last_date) for the line under the field.
create function public.next_invoice_number()
returns table (next_number text, last_number text, last_date date)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role   text := public.current_user_role();
  v_recent text;
  v_prefix text;
  v_width  integer;
  v_max    bigint;
begin
  if v_role is null or v_role not in ('admin', 'sales') then
    raise exception 'invoice numbers are for admin and sales only' using errcode = '42501';
  end if;

  select i.number into v_recent
  from public.invoices i
  where i.number ~ '[0-9]+$'
  order by i.created_at desc, i.number desc
  limit 1;

  if v_recent is null then
    return query select 'INV-0001'::text, null::text, null::date;
    return;
  end if;

  v_prefix := (regexp_match(v_recent, '^(.*?)([0-9]+)$'))[1];
  v_width  := length((regexp_match(v_recent, '^(.*?)([0-9]+)$'))[2]);

  -- the highest number in this series, and the invoice that carries it
  select s.n, s.number, s.invoice_date
  into v_max, last_number, last_date
  from (
    select i.number, i.invoice_date,
           substr(i.number, length(v_prefix) + 1)::bigint as n
    from public.invoices i
    where left(i.number, length(v_prefix)) = v_prefix
      and substr(i.number, length(v_prefix) + 1) ~ '^[0-9]{1,15}$'
  ) s
  order by s.n desc, s.invoice_date desc nulls last
  limit 1;

  next_number := v_prefix || lpad((v_max + 1)::text, v_width, '0');
  return next;
end;
$$;

revoke all on function public.next_invoice_number() from public, anon, authenticated;
grant execute on function public.next_invoice_number() to authenticated;

comment on function public.next_invoice_number() is
  'M01: the next number in the invoice series (prefix and digit width of the most recent invoice, highest number plus one). Admin and sales.';
