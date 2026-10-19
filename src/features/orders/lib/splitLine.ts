// A8 (O09): the Split line dialog's check on a supplier chosen by hand. Pure and framework-free.
// split_order_item (migration 0050) looks for the order's leg for the supplier and currency but never the line's own leg, so naming the
// line's own supplier in its own currency would open a second leg for the same supplier and currency. The dialog refuses that choice.

export function supplierTargetProblem(source: { supplierId: string; currency: string | null } | undefined, supplierId: string, currency: string): string | null {
  if (!source || !supplierId) return null
  if (source.supplierId === supplierId && (source.currency ?? '') === currency) return `The line is already with this supplier in ${currency}: choose another supplier or currency.`
  return null
}
