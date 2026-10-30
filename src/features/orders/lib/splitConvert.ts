// A8 (O08): splitting an RFQ item's quantity across suppliers in the convert dialog. Pure and framework-free.
// A split is two or more parts of one item, each with its own quote line (a supplier) and quantity. The first part takes the remainder
// until the person types its quantity; the others are typed. The backend lets the parts add up to anything (a partial order is allowed):
// the dialog warns when they do not add up to the RFQ quantity and never blocks on it.

import type { ConvertItem, ConvertPayloadLine, SupplierChoice } from '@/features/orders/lib/convert'
import type { RankedQuote } from '@/features/orders/lib/ranking'

export interface Part {
  key: string
  /** supplier_quote_lines.id */
  lineId: string
  /** null = the remainder (only ever the first part); a number = typed. A typed part with no number yet is `undefined`. */
  qty: number | null | undefined
}

export type Splits = Readonly<Record<string, readonly Part[]>>

const EPS = 1e-9
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/** The quantity each part will be ordered at. The remainder part gets what the typed ones leave, never below 0. */
export function partQuantities(itemQty: number, parts: readonly Part[]): number[] {
  const typed = sum(parts.map(p => (typeof p.qty === 'number' ? p.qty : 0)))
  return parts.map(p => (p.qty === null ? Math.max(0, itemQty - typed) : typeof p.qty === 'number' ? p.qty : 0))
}

export interface SplitCheck {
  /** Quantities as they will be ordered. */
  qtys: number[]
  total: number
  /** A part has no quantity yet (or the typed parts leave nothing for the remainder): it cannot be ordered at 0. */
  incomplete: boolean
  /** The parts do not add up to the RFQ quantity: a warning, never a block. */
  mismatch: boolean
}

export function checkSplit(itemQty: number, parts: readonly Part[]): SplitCheck {
  const qtys = partQuantities(itemQty, parts)
  const total = sum(qtys)
  return {
    qtys,
    total,
    incomplete: qtys.some(x => x <= 0),
    mismatch: Math.abs(total - itemQty) > EPS,
  }
}

/** Whether another quote is still free for a new part (a quote line can be used once). Nothing is offered or chosen for the person. */
export function hasFreeQuote(quotes: readonly RankedQuote[], usedLineIds: ReadonlySet<string>): boolean {
  return quotes.some(q => !usedLineIds.has(q.lineId))
}

export function isSplit(parts: readonly Part[] | undefined): parts is readonly Part[] {
  return Boolean(parts && parts.length >= 2)
}

/**
 * The p_items of convert_rfq_to_order with splits. `typedPrices` holds the confirmed selling price of every item. An item that is not split is exactly what buildPayload sends today, except that an
 * item left on its rank-1 line may name it: the database would infer the same line, but naming it keeps what the person saw and what
 * is written the same. Every part of a split names its quote line and its quantity.
 */
export function buildSplitPayload(
  items: readonly ConvertItem[],
  choices: Readonly<Record<string, SupplierChoice>>,
  typedPrices: Readonly<Record<string, number | null>>,
  splits: Splits,
): ConvertPayloadLine[] {
  const out: ConvertPayloadLine[] = []
  for (const it of items) {
    const price: Pick<ConvertPayloadLine, 'unit_price_net'> = {}
    // The price the person confirmed in the dialog is always sent, for an unsplit item and for every part of a split one:
    // never the RFQ item's working price, which a later quotation revision may have dropped or changed.
    const typed = typedPrices[it.id]
    if (typed !== null && typed !== undefined && typed > 0) price.unit_price_net = typed
    const parts = splits[it.id]
    if (isSplit(parts)) {
      const qtys = partQuantities(it.qty, parts)
      parts.forEach((p, i) => out.push({ rfq_item_id: it.id, quote_line_id: p.lineId, qty: qtys[i], ...price }))
      continue
    }
    const line: ConvertPayloadLine = { rfq_item_id: it.id, ...price }
    const c = choices[it.id] ?? 'none'
    if (c === 'service') line.is_service = true
    else if (c !== 'none') line.quote_line_id = c
    out.push(line)
  }
  return out
}

/** How many order lines the dialog will create ("Creates 4 order lines."): one per part, and one per ordinary item. */
export function orderLineCount(items: readonly ConvertItem[], splits: Splits): number {
  return items.reduce((n, it) => n + (isSplit(splits[it.id]) ? (splits[it.id] as readonly Part[]).length : 1), 0)
}
