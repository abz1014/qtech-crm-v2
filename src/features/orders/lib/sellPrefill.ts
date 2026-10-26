// Mark won: what each line is sold at, and whether it is on the order. Pure and framework-free.
//
// An RFQ marked sent by phone, or imported from the old CRM, has no issued quotation, so rfq_items.quoted_unit_price_net is empty and the
// dialog used to leave every line out ("Create order" stuck). The selling price is now always confirmed in the dialog and sent with every
// ticked line. Nothing here is written back to the RFQ or makes a quotation.
//
// Selling prices come from the owner's costing software; the CRM never computes a sell price. So the pre-fill only ever repeats a price
// the owner already gave, first value wins:
//   1 quotation   the LATEST issued quotation's line (never rfq_items: an item a later revision dropped keeps its old price there)
//   2 draft       the unissued Issue-quotation draft kept in this browser tab
//   3 memory      what we last quoted this customer for the item, else what we last sold it at
//   4 none        empty: "Type the selling price from your costing sheet"

import { formatAmount } from '@/lib/money'
import { orderRef } from '@/lib/refs'

export type SellSource = 'quotation' | 'draft' | 'last_quoted' | 'last_sold' | 'none'

export const NO_PRICE_HINT = 'Type the selling price from your costing sheet'

export interface PrefillItem {
  id: string
  qty: number
}

/** The latest issued revision: its reference ("QT-26-0058 R1") and lines. */
export interface PrefillQuotation {
  ref: string
  lines: ReadonlyArray<{ rfq_item_id: string; unit_price_net: number; qty: number }>
}

/** One item's row of customer_price_memory. `quotedRef` is already worded ("QT-26-0042 R1"). */
export interface PrefillMemory {
  itemId: string
  quotedPrice: number | null
  quotedRef: string | null
  quotedOn: string | null
  soldPrice: number | null
  soldOrderNumber: number | null
  soldOn: string | null
}

/** The supplier quote the line is assigned to. */
export interface PrefillQuote {
  currency: string
  /** The quote's own price, in its own currency. */
  price: number
  /** Today's PKR price: null when the rate is older than 30 days or missing. */
  pkrUnitPrice: number | null
  legacyFlags?: readonly string[]
}

export interface PrefillInput {
  items: readonly PrefillItem[]
  latest: PrefillQuotation | null
  /** Prices typed in the Issue quotation dialog and not issued. */
  draft: Readonly<Record<string, number | null>> | null
  memory: readonly PrefillMemory[]
  quoteOf: (itemId: string) => PrefillQuote | undefined
}

export interface LinePrefill {
  include: boolean
  price: number | null
  source: SellSource
  /** Where the price came from, or the hint to type one. */
  sourceText: string
  /** Why the line starts unticked although a quotation was issued: "Not in QT-26-0058 R1". */
  notIn?: string
  /** Never blocks. */
  warnings: string[]
  qtyNote?: string
}

const isPrice = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** "12 Oct 2026" from an ISO date or timestamp; the day is read from the text so no timezone can move it. */
export function dayText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1] ?? ''} ${y}`
}

/** What the chosen supplier's quote costs us per unit, in PKR; null when it cannot be told (no current rate). */
export function costPkr(q: PrefillQuote | undefined): number | null {
  if (!q) return null
  if (q.currency === 'PKR') return q.price
  return q.pkrUnitPrice
}

const noRate = (q: PrefillQuote | undefined): q is PrefillQuote => Boolean(q && q.currency !== 'PKR' && q.pkrUnitPrice === null)

/** Compares a typed price with the supplier's cost. Never blocks, and only compares: it computes no price. */
export function priceWarnings(price: number | null, q: PrefillQuote | undefined): string[] {
  const cost = costPkr(q)
  if (price !== null && price > 0 && cost !== null && price < cost) return [`Below the supplier's cost of PKR ${formatAmount(Math.round(cost))}.`]
  return []
}

export function prefillLines(input: PrefillInput): Record<string, LinePrefill> {
  const out: Record<string, LinePrefill> = {}
  for (const it of input.items) {
    const q = input.quoteOf(it.id)
    const warnings: string[] = []
    if (q?.legacyFlags?.includes('item_guessed')) warnings.push('Imported: this supplier price may belong to another item. Check it.')
    if (q?.legacyFlags?.includes('currency_unverified')) warnings.push('Imported: the currency of this supplier quote was not confirmed. Check it.')
    if (noRate(q)) warnings.push(`No current ${q.currency} rate: pick the supplier.`)

    const line = input.latest?.lines.find(l => l.rfq_item_id === it.id && isPrice(l.unit_price_net))
    const draft = input.draft?.[it.id]
    const mem = input.memory.find(m => m.itemId === it.id)

    let price: number | null = null
    let source: SellSource = 'none'
    let sourceText = NO_PRICE_HINT
    let qtyNote: string | undefined
    let notIn: string | undefined
    let include = true

    if (line && input.latest) {
      price = line.unit_price_net
      source = 'quotation'
      sourceText = `from ${input.latest.ref}`
      if (line.qty !== it.qty) qtyNote = `The quotation says ${line.qty}, the item says ${it.qty}. The item quantity is used.`
    } else {
      // a line the issued quotation does not have starts unticked; one with no quotation at all starts ticked, priced or not
      if (input.latest) {
        include = false
        notIn = `Not in ${input.latest.ref}`
      }
      if (isPrice(draft)) {
        price = draft
        source = 'draft'
        sourceText = 'typed in Issue quotation, not issued'
      } else if (mem && isPrice(mem.quotedPrice)) {
        price = mem.quotedPrice
        source = 'last_quoted'
        sourceText = `last quoted ${mem.quotedRef ?? 'to this customer'}${mem.quotedOn ? ` on ${dayText(mem.quotedOn)}` : ''}`
      } else if (mem && isPrice(mem.soldPrice)) {
        price = mem.soldPrice
        source = 'last_sold'
        sourceText = `last sold ${mem.soldOrderNumber !== null ? `${orderRef(mem.soldOrderNumber)} ` : ''}${mem.soldOn ? dayText(mem.soldOn) : ''}`.trim()
      }
    }
    out[it.id] = { include, price, source, sourceText, notIn, warnings, qtyNote }
  }
  return out
}
