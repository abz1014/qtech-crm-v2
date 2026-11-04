-- 0111_quote_line_weight (owner request 2026-10-29): the comparative statement shows, per supplier and item, the unit weight and the
-- country of origin next to the cost and the lead time.
--
--   supplier_quote_lines.origin       already exists (0008), so it is reused: the country the supplier says the item is made in.
--   supplier_quote_lines.weight       new: the weight of ONE unit, in weight_unit. Null: the supplier did not say.
--   supplier_quote_lines.weight_unit  new: kg (default), g or lb. The statement shows the total weight (weight x qty) in the same unit.
--
-- Expand-only: two nullable-or-defaulted columns, no data moved, no policy changed, nothing dropped. The table's row-security
-- policies and admin/sales grants cover the new columns as they cover unit_price. An engineer gets neither: 0081 gave qtech_engineer
-- column grants only (every column but the prices), so a column added later is not granted to it, and the revoke below says so
-- in case a table-level grant is ever added back. supabase/tests/0081_engineer_no_prices.test.sql lists both columns with the prices so
-- its coverage checks agree, and supabase/tests/0111_quote_line_weight.test.sql proves it.

alter table public.supplier_quote_lines
  add column weight numeric(12, 4) check (weight is null or weight > 0),
  add column weight_unit text not null default 'kg' check (weight_unit in ('kg', 'g', 'lb'));

comment on column public.supplier_quote_lines.weight is 'Weight of ONE unit, in weight_unit (0111). Null: not stated. Not shown to engineers.';
comment on column public.supplier_quote_lines.weight_unit is 'kg, g or lb (0111).';

revoke all (weight, weight_unit) on public.supplier_quote_lines from qtech_engineer;
