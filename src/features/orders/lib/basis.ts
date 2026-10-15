// What "resolve price basis" would do (admin, legacy orders). Pure and framework-free. The database function resolve_value_basis is the
// authority: 'net' keeps the typed prices; 'gross' divides each unit price by 1 + rate / 100 to 2 decimals. These numbers only preview it.

import { orderTotals, type PricedLine } from '@/features/orders/lib/orderMath'

export interface BasisOutcome {
  net: number
  gst: number
  gross: number
  /** Net sale less the costs on file; null when no cost is on file. */
  margin: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function basisChoices(lines: readonly PricedLine[], actualCost: number | null): { net: BasisOutcome; gross: BasisOutcome } {
  const asNet = orderTotals(lines)
  const asGross = orderTotals(lines.map(l => ({ ...l, unitPriceNet: round2(l.unitPriceNet / (1 + l.gstRate / 100)) })))
  const margin = (net: number) => (actualCost === null ? null : round2(net - actualCost))
  return {
    net: { ...asNet, margin: margin(asNet.net) },
    gross: { ...asGross, margin: margin(asGross.net) },
  }
}
