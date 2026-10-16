/*
 * Order margins (g2-money "Margins"; DATA_MODEL 5 item 3): whole-life margin per order, from v_order_money. Pure.
 *
 *   Net sale is the invoiced net if any invoice exists, else the net from the items (the row says which).
 *   Margin = net sale less the expenses tagged to the order (net of recoverable input tax). GST is outside both sides.
 *   A margin is PROVISIONAL until costs are marked complete: it is shown, with the dashed mark, but never added up.
 *   An order with an unknown price basis has no margin at all: it is listed and labelled, and left out of every total.
 */
export type MarginState = 'provisional' | 'final' | 'basis_unknown'

export interface MarginRow {
  orderId: string
  orderNumber: number
  companyName: string
  orderedOn: string | null
  /** 'invoice' when an invoice exists, else 'items'. */
  basis: 'invoice' | 'items' | null
  netSale: number | null
  expectedCost: number | null
  actualCost: number
  margin: number | null
  state: MarginState
}

export interface MarginTotals {
  /** Orders with costs marked complete: the only ones added up. */
  orders: number
  netSale: number
  expectedCost: number
  actualCost: number
  margin: number
  provisional: number
  basisUnknown: number
}

export function marginTotals(rows: readonly MarginRow[]): MarginTotals {
  const t: MarginTotals = { orders: 0, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 0, basisUnknown: 0 }
  for (const r of rows) {
    if (r.state === 'basis_unknown') t.basisUnknown += 1
    else if (r.state === 'provisional') t.provisional += 1
    else {
      t.orders += 1
      t.netSale += r.netSale ?? 0
      t.expectedCost += r.expectedCost ?? 0
      t.actualCost += r.actualCost
      t.margin += r.margin ?? 0
    }
  }
  return t
}

/** Newest first (by order date, then number), as the mockup lists them. */
export function sortMargins(rows: readonly MarginRow[]): MarginRow[] {
  return [...rows].sort((a, b) => (b.orderedOn ?? '').localeCompare(a.orderedOn ?? '') || b.orderNumber - a.orderNumber)
}

/** The sentence under the table: what is and is not in the total, in counts. */
export function marginNote(t: MarginTotals): string {
  const parts: string[] = ['Only orders with costs marked complete are totalled.']
  if (t.provisional > 0) {
    parts.push(`The ${t.provisional} provisional ${t.provisional === 1 ? 'margin is' : 'margins are'} shown so you can see the trend, but ${t.provisional === 1 ? 'it is' : 'they are'} not added up`)
  }
  if (t.basisUnknown > 0) {
    const unknown = `the ${t.basisUnknown === 1 ? 'order' : `${t.basisUnknown} orders`} with an unknown price basis ${t.basisUnknown === 1 ? 'is' : 'are'} left out until someone resolves ${t.basisUnknown === 1 ? 'it' : 'them'}`
    parts.push(t.provisional > 0 ? `, and ${unknown}.` : `${unknown[0].toUpperCase()}${unknown.slice(1)}.`)
  } else if (t.provisional > 0) {
    parts.push('.')
  }
  return parts.join(' ').replace(' ,', ',').replace(' .', '.')
}
