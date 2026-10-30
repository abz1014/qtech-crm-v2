-- 0113_invoice_integrity (money-integrity audit H1, H2, H3): the invoice rules that lived only in the browser now live in the database.
--
--   H1. GST, net and over-invoicing. A BEFORE INSERT/UPDATE trigger on invoices:
--         - takes `select ... for update` on the ORDER row, so two people invoicing the same order one after the other cannot both
--           pass (the second waits, then sees the first invoice);
--         - refuses a net above what is left to invoice on the order (the order's lines less the other live invoices, net of
--           their credit notes), with the browser's Rs 1 allowance (src/features/money/invoices/model.ts overInvoiced);
--         - refuses a GST that is not within Rs 1 of what the browser would have worked out (model.ts gstForNet): the GST left
--           on the lines shared out in proportion to the net, 18% of the net, nothing (exempt lines), or the GST of a set of
--           whole order lines whose nets add up to the net (up to 12 priced lines are searched; the lines' own GST uses the
--           per-line rounding of v_order_items_total).
--       Only rows the API roles write are checked (authenticated, qtech_engineer: a migration, the importer and the table owner are not); an imported row (legacy source or flags), an invoice with no
--       order, an order with no priced lines, and an UPDATE that leaves order, net and GST alone (a stamp, a PSID, a reminder)
--       are not.
--   H2. Filed invoices. Once an invoice has a PSID or a tax deposit, its number, date, net and GST cannot change; the correction is
--       a credit note (0112). An invoice with credit notes cannot change its amounts either. A void invoice cannot change at all.
--       Only void_invoice() can void (it sets a transaction-local marker the API cannot set).
--   H3. Invoice numbers are trimmed by the trigger and unique ignoring case and surrounding spaces. The migration stops with the
--       list of clashes if the data already holds any, before it changes anything.
--
-- Not expand-only in one respect, on purpose: the unique index on number is replaced by a stricter one with the same name
-- (invoices_number_key), so a client that maps that name keeps working. It fails safely (nothing changed) when data clashes.

-- ================================================================ H3. numbers
do $$
declare
  v_clash text;
begin
  select string_agg(x.k || ' (' || x.n || ' invoices)', ', ' order by x.k) into v_clash
  from (
    select lower(btrim(i.number)) as k, count(*) as n
    from public.invoices i
    where i.number is not null
    group by 1
    having count(*) > 1
    limit 20
  ) x;
  if v_clash is not null then
    raise exception '0113 stopped: these invoice numbers are used more than once when capitals and spaces are ignored: %. Renumber or merge them, then run this migration again.', v_clash
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices i where i.number is not null and btrim(i.number) = '') then
    raise exception '0113 stopped: an invoice has a blank number (spaces only). Give it a number or clear it, then run this migration again.'
      using errcode = 'P0001';
  end if;
end
$$;

update public.invoices set number = btrim(number) where number is not null and number <> btrim(number);

drop index public.invoices_number_key;
create unique index invoices_number_key on public.invoices (lower(btrim(number))) where number is not null;

-- ================================================================ H1, H2, H3: the trigger
create function public.invoices_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items_net numeric;
  v_items_gst numeric;
  v_n18       integer;
  v_n0        integer;
  v_inv_net   numeric;
  v_inv_gst   numeric;
  v_cr_net    numeric;
  v_cr_gst    numeric;
  v_rem_n     numeric;
  v_rem_g     numeric;
  v_nets      numeric[];
  v_gsts      numeric[];
  v_cand      numeric[] := '{}';
  v_c         numeric;
  v_ok        boolean := false;
  v_mask      integer;
  v_j         integer;
  v_sn        numeric;
  v_sg        numeric;
  v_show      numeric;
begin
  -- H3: the number is stored trimmed
  if new.number is not null then
    new.number := btrim(new.number);
    if new.number = '' then
      raise exception 'Enter the invoice number.' using errcode = 'P0001', hint = 'number';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.voided_at is not null then
      raise exception 'An invoice is voided from its own screen, not created void.' using errcode = 'P0001', hint = 'use_void';
    end if;
  else
    -- a void invoice is frozen
    if old.voided_at is not null then
      if new.voided_at is distinct from old.voided_at
         or (new.number, new.invoice_date, new.net_amount, new.gst_amount, new.order_id, new.company_id)
            is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount, old.order_id, old.company_id) then
        raise exception 'Invoice % is void and cannot be changed.', old.number using errcode = 'P0001', hint = 'invoice_void';
      end if;
      return new;
    end if;
    -- the void itself: only void_invoice() sets the marker
    if new.voided_at is not null then
      if coalesce(current_setting('qtech.void_invoice', true), '') <> 'on' then
        raise exception 'An invoice is voided with Void on the invoice screen.' using errcode = 'P0001', hint = 'use_void';
      end if;
      return new;
    end if;
    -- H2: filed (PSID or tax deposit): number, date, net and GST are fixed
    if (nullif(btrim(old.psid), '') is not null or old.tax_deposited_on is not null)
       and (new.number, new.invoice_date, new.net_amount, new.gst_amount)
           is distinct from (old.number, old.invoice_date, old.net_amount, old.gst_amount) then
      raise exception 'Invoice % has a PSID or a tax deposit recorded, so its number, date and amounts are fixed. Issue a credit note to correct it.', old.number
        using errcode = 'P0001', hint = 'invoice_filed';
    end if;
    if (new.net_amount, new.gst_amount) is distinct from (old.net_amount, old.gst_amount)
       and exists (select 1 from public.credit_notes c where c.invoice_id = old.id) then
      raise exception 'Invoice % has a credit note, so its amounts are fixed. Issue another credit note to correct it.', old.number
        using errcode = 'P0001', hint = 'has_credit_note';
    end if;
  end if;

  -- H1: only what the API writes, and only when order, net or GST is new
  if coalesce(current_setting('role', true), '') not in ('authenticated', 'qtech_engineer')
     or new.order_id is null or new.legacy_source is not null or cardinality(new.legacy_flags) > 0 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.order_id, new.net_amount, new.gst_amount) is not distinct from (old.order_id, old.net_amount, old.gst_amount) then
    return new;
  end if;

  perform 1 from public.orders o where o.id = new.order_id for update;

  select coalesce(sum(round(i.qty * i.unit_price_net, 2)), 0),
         coalesce(sum(round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0)), 0),
         count(*) filter (where i.gst_rate > 0 and round(i.qty * i.unit_price_net, 2) > 0),
         count(*) filter (where i.gst_rate = 0 and round(i.qty * i.unit_price_net, 2) > 0),
         coalesce(array_agg(round(i.qty * i.unit_price_net, 2) order by i.id) filter (where round(i.qty * i.unit_price_net, 2) > 0), '{}'),
         coalesce(array_agg(round(round(i.qty * i.unit_price_net, 2) * i.gst_rate / 100, 0) order by i.id) filter (where round(i.qty * i.unit_price_net, 2) > 0), '{}')
    into v_items_net, v_items_gst, v_n18, v_n0, v_nets, v_gsts
  from public.order_items i
  where i.order_id = new.order_id;

  if not (v_items_net > 0) or not (new.net_amount > 0) then
    return new;   -- nothing priced to check against, or nothing to check
  end if;

  select coalesce(sum(v.net_amount), 0), coalesce(sum(v.gst_amount), 0) into v_inv_net, v_inv_gst
  from public.invoices v
  where v.order_id = new.order_id and v.voided_at is null and v.id is distinct from new.id;
  select coalesce(sum(c.net_amount), 0), coalesce(sum(c.gst_amount), 0) into v_cr_net, v_cr_gst
  from public.credit_notes c
  where c.order_id = new.order_id and c.invoice_id is distinct from new.id;

  v_rem_n := greatest(v_items_net - (v_inv_net - v_cr_net), 0);
  v_rem_g := greatest(v_items_gst - (v_inv_gst - v_cr_gst), 0);

  if new.net_amount > v_rem_n + 1 then
    raise exception 'This invoice is for Rs % but only Rs % is left to invoice on this order. Lower the amount, or check the order''s items.',
      to_char(new.net_amount, 'FM999,999,999,990.00'), to_char(v_rem_n, 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'over_invoiced';
  end if;

  -- GST: within Rs 1 of any figure the invoice screen would have offered
  if v_n18 > 0 then v_cand := v_cand || round(new.net_amount * 18 / 100, 0); end if;
  if v_n0 > 0 or v_n18 = 0 then v_cand := v_cand || 0::numeric; end if;
  if v_rem_n > 0 then v_cand := v_cand || round(v_rem_g * new.net_amount / v_rem_n, 0); end if;
  if coalesce(array_length(v_nets, 1), 0) between 1 and 12 then
    for v_mask in 1 .. (power(2, array_length(v_nets, 1))::integer - 1) loop
      v_sn := 0; v_sg := 0;
      for v_j in 1 .. array_length(v_nets, 1) loop
        if (v_mask >> (v_j - 1)) & 1 = 1 then
          v_sn := v_sn + v_nets[v_j];
          v_sg := v_sg + v_gsts[v_j];
        end if;
      end loop;
      if v_sn = new.net_amount then v_cand := v_cand || v_sg; end if;
    end loop;
  end if;
  foreach v_c in array v_cand loop
    if abs(new.gst_amount - v_c) <= 1 then v_ok := true; end if;
  end loop;
  if not v_ok then
    v_show := case when v_rem_n > 0 then round(v_rem_g * new.net_amount / v_rem_n, 0) else v_cand[1] end;
    raise exception 'The GST on this invoice (Rs %) does not match the order''s items. For Rs % it should be about Rs %.',
      to_char(new.gst_amount, 'FM999,999,999,990.00'), to_char(new.net_amount, 'FM999,999,999,990.00'),
      to_char(coalesce(v_show, 0), 'FM999,999,999,990.00')
      using errcode = 'P0001', hint = 'gst_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_integrity() from public, anon, authenticated;

create trigger invoices_zintegrity before insert or update on public.invoices
  for each row execute function public.invoices_integrity();
