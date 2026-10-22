// Order item arithmetic for display (O03). The database view v_order_items_total is the authority; these mirror its rounding
// (line net = qty x unit price to 2 decimals, line GST rounded to whole rupees per line) so the table adds up the same way.
// Money is held in paisa as plain integers: order lines are far inside the safe-integer range. The products are exact decimals
// (lib/money), never floats: 0.1 x 0.35 is 0.035 and rounds to 0.04 in the database, while a float product gives 0.03.
import { gstWholeRupeesPaisa, productPaisa } from '@/lib/money'

export interface PricedLine {
  qty: number
  unitPriceNet: number
  gstRate: number
}

export function lineNetPaisa(l: Pick<PricedLine, 'qty' | 'unitPriceNet'>): number {
  return Number(productPaisa(l.qty, l.unitPriceNet))
}

/** GST on one line, to whole rupees (DATA_MODEL 2.13), in paisa. */
export function lineGstPaisa(l: PricedLine): number {
  return Number(gstWholeRupeesPaisa(BigInt(lineNetPaisa(l)), l.gstRate))
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

/**
 * The GST choices a line offers (DECISIONS 2026-10-15: 18% or exempt, nothing else). A legacy line already at another rate keeps it
 * on show as "<n>% (old rate)", so the select does not silently change it; picking a choice moves it to 18% or exempt.
 */
export function gstOptions(current?: number | null): { value: string; label: string }[] {
  const opts = [
    { value: String(STANDARD_GST), label: `${STANDARD_GST}%` },
    { value: '0', label: 'Exempt' },
  ]
  if (current != null && current !== STANDARD_GST && current !== 0) opts.push({ value: String(current), label: `${current}% (old rate)` })
  return opts
}

/** True when every line is at 0 %: the "exempt all" toggle shows on. An order with no lines is not exempt. */
export function isExemptAll(lines: ReadonlyArray<{ gstRate: number }>): boolean {
  return lines.length > 0 && lines.every(l => l.gstRate === 0)
}

/** The unit beside a quantity: "1 no", "2 nos" (the stored unit is "nos" whatever the count). Other units are shown as stored. */
export function unitWord(qty: number, unit: string | null | undefined): string {
  const u = (unit ?? '').trim()
  if (/^nos?$/i.test(u)) return qty === 1 ? 'no' : 'nos'
  return u
}
