-- 0056_import_number_floors (I01 follow-up, owner rule 1): after an import, Q-Tech's own number series continue from the
-- highest number in use, which includes the highest Q-Tech number found in the old data (an old "RFQ-0177" means the next
-- RFQ is RFQ-0178, not RFQ-0001).
--
-- import_reset_numbers (0055) restarted the RFQ and order counters after the highest number in the tables. It now also
-- takes a floor per series (the highest imported Q-Tech number, from the transform) and covers the quotation and
-- supplier PO counters too: each counter is set to max(highest in the table, floor) + 1. Service role only, as before.
drop function public.import_reset_numbers();

create function public.import_reset_numbers(
  p_rfq_min bigint default 0,
  p_order_min bigint default 0,
  p_quotation_min bigint default 0,
  p_po_min bigint default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform setval(pg_get_serial_sequence('public.rfqs', 'number'),
    greatest(coalesce((select max(r.number) from public.rfqs r), 0), coalesce(p_rfq_min, 0)) + 1, false);
  perform setval(pg_get_serial_sequence('public.orders', 'number'),
    greatest(coalesce((select max(o.number) from public.orders o), 0), coalesce(p_order_min, 0)) + 1, false);
  perform setval('public.quotation_number_seq',
    greatest(coalesce((select max(q.number) from public.quotations q), 0), coalesce(p_quotation_min, 0)) + 1, false);
  perform setval('public.po_number_seq',
    greatest(coalesce((select max(p.number) from public.purchase_orders p), 0), coalesce(p_po_min, 0)) + 1, false);
end;
$$;

revoke all on function public.import_reset_numbers(bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.import_reset_numbers(bigint, bigint, bigint, bigint) to service_role;

comment on function public.import_reset_numbers(bigint, bigint, bigint, bigint) is
  'Import cleanup (service role only): sets the RFQ, order, quotation and supplier PO counters to max(highest in use, floor) + 1.';
