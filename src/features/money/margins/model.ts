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
  /** v_order_money.payment_state (unpaid, part, settled, overdue); lets the list show "paid, costs provisional". */
  paymentState?: string
}

/**
 * No cost has been entered and the costs are not marked complete (P2-C, plan D6): the margin would be the whole sale, so the screens say
 * "Costs not entered yet" instead. An order reviewed as settled has its costs marked complete (set_legacy_review, 0096), so it is final and never matches.
 */
export const noCostsYet = (r: Pick<MarginRow, 'state' | 'actualCost'>): boolean => r.state === 'provisional' && !(r.actualCost > 0)

/** An order paid in full whose costs are still provisional (the Today item "Costs not marked complete" lists these). */
export const isPaidProvisional = (r: Pick<MarginRow, 'state' | 'paymentState'>): boolean => r.state === 'provisional' && r.paymentState === 'settled'

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

/** Problems first (round 3): a negative margin, then no margin at all (is GST included?), then not final, then final. */
export function marginRank(r: Pick<MarginRow, 'state' | 'margin'>): number {
  if (r.state !== 'basis_unknown' && r.margin !== null && r.margin < 0) return 0
  if (r.state === 'basis_unknown') return 1
  return r.state === 'provisional' ? 2 : 3
}

/** Problems first (marginRank); inside each, newest first (by order date, then number). */
export function sortMargins(rows: readonly MarginRow[]): MarginRow[] {
  return [...rows].sort((a, b) => marginRank(a) - marginRank(b) || (b.orderedOn ?? '').localeCompare(a.orderedOn ?? '') || b.orderNumber - a.orderNumber)
}

/** Margin as a share of the net sale, one decimal ("27.4%"); null with no margin or no sale to compare it with. */
export function marginPct(r: Pick<MarginRow, 'margin' | 'netSale'>): string | null {
  if (r.margin === null || r.netSale === null || r.netSale <= 0) return null
  const tenths = Math.round((r.margin / r.netSale) * 1000)
  return `${(tenths / 10).toFixed(1)}%`
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
