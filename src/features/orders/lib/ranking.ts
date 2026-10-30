// The supplier quotes of one RFQ, as the convert dialog and the Split line dialog list them. Pure and framework-free.
// The rows come from rank_item_quotes (its prices and PKR figures), but NOTHING here ranks, recommends or explains: a supplier is never
// singled out (owner decision 2026-10-29). The quotes of an item are listed by supplier name.

import { formatAmount } from '@/lib/money'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'

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
  /** supplier_quote_lines.legacy_flags: 'item_guessed' and 'currency_unverified' mark an imported quote that may be misplaced or in the wrong currency. */
  legacyFlags?: readonly string[]
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

/** The quotes of one item, by supplier name (never by price or rank). */
export const forItem = (all: readonly RankedQuote[], itemId: string): RankedQuote[] =>
  all.filter(q => q.itemId === itemId).sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'en', { sensitivity: 'base' }) || a.price - b.price)

/** "USD 412.00" and, under it, "≈ PKR 114,701" or "no conversion". */
export function priceTexts(q: RankedQuote): { price: string; pkr: string } {
  const pkrUnit = q.row.pkr_unit_price
  return {
    price: `${q.currency} ${formatAmount(q.price, 'always')}`,
    pkr: q.currency === 'PKR' ? 'no conversion' : pkrUnit !== null ? `≈ PKR ${formatAmount(Math.round(pkrUnit))}` : 'no rate',
  }
}
