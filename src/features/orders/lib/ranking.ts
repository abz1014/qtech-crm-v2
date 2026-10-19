// A8: the ranked supplier quotes of one RFQ, as the convert dialog and the Split line dialog show them. Pure and framework-free.
// The database (rank_item_quotes) decides the order and the 2% band; this file maps its rows and asks reasons.ts (R25, the one module
// that words them) for the reasons. Selling price and spread arrive only for admin and sales (NULL for engineers).

import { formatAmount } from '@/lib/money'
import { bandSizeOf, reasonsFor, type RankRow } from '@/features/rfqs/lib/ranking/reasons'

export interface RankedQuote {
  lineId: string
  itemId: string
  supplierId: string
  supplierName: string
  price: number
  currency: string
  rank: number | null
  comparable: boolean
  inStock: boolean
  /** The database row. Every reason string comes from src/features/rfqs/lib/ranking/reasons.ts, the one module that words them. */
  row: RankRow
}

const n = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))

export function mapRankRows(rows: readonly RankRow[], supplierNames: ReadonlyMap<string, string>): RankedQuote[] {
  return rows.map(r => ({
    lineId: r.quote_line_id,
    itemId: r.rfq_item_id,
    supplierId: r.supplier_id,
    supplierName: supplierNames.get(r.supplier_id) ?? 'Supplier',
    price: Number(r.price),
    currency: String(r.currency).trim(),
    rank: n(r.rank),
    comparable: Boolean(r.comparable),
    inStock: Boolean(r.in_stock),
    row: r,
  }))
}

export const forItem = (all: readonly RankedQuote[], itemId: string): RankedQuote[] => all.filter(q => q.itemId === itemId)

/** The rank-1 line of an item: what Create order takes when nobody chooses. */
export const rankOne = (quotes: readonly RankedQuote[]): RankedQuote | undefined => quotes.find(q => q.rank === 1)

/** The selling price and spread reach the strings only when the database sent them (it sends NULL to an engineer). */
const reasons = (q: RankedQuote, among: readonly RankedQuote[]) =>
  reasonsFor(q.row, { showSell: q.row.sell_source !== null, bandSize: bandSizeOf(among.map(a => a.row)) })

/** The line under a supplier name on the button: the price reason, then the delivery record. "Best price · On time 5 of 6 deliveries". */
export function shortReason(q: RankedQuote, among: readonly RankedQuote[]): string {
  const set = reasons(q, among)
  const price = set.short.find(r => r.id === 'price' || r.id === 'unranked')
  const record = set.short.find(r => r.id === 'record')
  return [price, record].filter(Boolean).map(r => (r as { text: string }).text).join(' · ')
}

/** The full short line in the picker: every key behind the rank, in the words used on the RFQ page. */
export function longReason(q: RankedQuote, among: readonly RankedQuote[]): string {
  return reasons(q, among).short.map(r => r.text).join(' · ')
}

/** "USD 412.00" and, under it, "≈ PKR 114,701" or "no conversion". */
export function priceTexts(q: RankedQuote): { price: string; pkr: string } {
  const pkrUnit = q.row.pkr_unit_price
  return {
    price: `${q.currency} ${formatAmount(q.price, 'always')}`,
    pkr: q.currency === 'PKR' ? 'no conversion' : pkrUnit !== null ? `≈ PKR ${formatAmount(Math.round(pkrUnit))}` : 'no rate',
  }
}
