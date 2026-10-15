// Order item arithmetic for display (O03). The database view v_order_items_total is the authority; these mirror its rounding
// (line net = qty x unit price to 2 decimals, line GST rounded to whole rupees per line) so the table adds up the same way.
// Money is held in paisa as plain integers: order lines are far inside the safe-integer range.

export interface PricedLine {
  qty: number
  unitPriceNet: number
  gstRate: number
}

export function lineNetPaisa(l: Pick<PricedLine, 'qty' | 'unitPriceNet'>): number {
  return Math.round(l.qty * l.unitPriceNet * 100)
}

/** GST on one line, to whole rupees (DATA_MODEL 2.13), in paisa. */
export function lineGstPaisa(l: PricedLine): number {
  const netRupees = lineNetPaisa(l) / 100
  return Math.round((netRupees * l.gstRate) / 100) * 100
}

export function orderTotals(lines: readonly PricedLine[]): { net: number; gst: number; gross: number } {
  let net = 0
  let gst = 0
  for (const l of lines) {
    net += lineNetPaisa(l)
    gst += lineGstPaisa(l)
  }
  return { net: net / 100, gst: gst / 100, gross: (net + gst) / 100 }
}

export const STANDARD_GST = 18

/** True when every line is at 0 %: the "exempt all" toggle shows on. An order with no lines is not exempt. */
export function isExemptAll(lines: ReadonlyArray<{ gstRate: number }>): boolean {
  return lines.length > 0 && lines.every(l => l.gstRate === 0)
}
