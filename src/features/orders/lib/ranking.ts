// A8: the ranked supplier quotes of one RFQ, as the convert dialog and the Split line dialog show them. Pure and framework-free.
// The database (rank_item_quotes) decides the order and the 2% band; this file only maps its rows and writes the reasons in plain words.
// Selling price and spread arrive only for admin and sales (NULL for engineers): the strings below add them only when they are present.

import { formatAmount } from '@/lib/money'

export interface RankedQuote {
  lineId: string
  itemId: string
  supplierId: string
  supplierName: string
  price: number
  currency: string
  rank: number | null
  comparable: boolean
  withinBand: boolean
  pctAboveBest: number | null
  pkrUnit: number | null
  fxState: string
  fxAgeDays: number | null
  reliabilityBand: number
  deliveries: number
  onTime: number
  late: number
  medianDaysLate: number | null
  ordersCount: number
  inStock: boolean
  /** Admin and sales only. */
  sellUnit: number | null
  spreadUnit: number | null
}

/** One rank_item_quotes row, as the generated types give it. */
export interface RankRow {
  quote_line_id: string
  rfq_item_id: string
  supplier_id: string
  price: number
  currency: string
  rank: number | null
  comparable: boolean
  within_band: boolean
  pct_above_best: number | null
  pkr_unit_price: number | null
  fx_state: string
  fx_age_days: number | null
  reliability_band: number
  deliveries: number
  on_time: number
  late: number
  median_days_late: number | null
  orders_count: number
  in_stock: boolean | null
  sell_unit_net: number | null
  spread_unit: number | null
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
    withinBand: Boolean(r.within_band),
    pctAboveBest: n(r.pct_above_best),
    pkrUnit: n(r.pkr_unit_price),
    fxState: r.fx_state,
    fxAgeDays: n(r.fx_age_days),
    reliabilityBand: Number(r.reliability_band),
    deliveries: Number(r.deliveries),
    onTime: Number(r.on_time),
    late: Number(r.late),
    medianDaysLate: n(r.median_days_late),
    ordersCount: Number(r.orders_count),
    inStock: Boolean(r.in_stock),
    sellUnit: n(r.sell_unit_net),
    spreadUnit: n(r.spread_unit),
  }))
}

export const forItem = (all: readonly RankedQuote[], itemId: string): RankedQuote[] => all.filter(q => q.itemId === itemId)

/** The rank-1 line of an item: what Create order takes when nobody chooses. */
export const rankOne = (quotes: readonly RankedQuote[]): RankedQuote | undefined => quotes.find(q => q.rank === 1)

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** The delivery record in a few words: "on time 5 of 6", "Often late: on time 2 of 6", "Too few to judge: 1 delivery, on time", "No deliveries yet". */
export function recordText(q: Pick<RankedQuote, 'deliveries' | 'onTime' | 'reliabilityBand'>): string {
  if (q.deliveries === 0) return 'No deliveries yet'
  if (q.reliabilityBand === 3) return `Often late: on time ${q.onTime} of ${q.deliveries}`
  if (q.reliabilityBand === 2) return `Too few to judge: ${q.deliveries} ${plural(q.deliveries, 'delivery', 'deliveries')}${q.onTime === q.deliveries ? ', on time' : `, on time ${q.onTime}`}`
  return `on time ${q.onTime} of ${q.deliveries}`
}

/** The short line under a supplier name: why it sits where it does. "Best price · on time 5 of 6". */
export function shortReason(q: RankedQuote, among: readonly RankedQuote[]): string {
  const parts: string[] = []
  if (!q.comparable || q.rank === null) parts.push('Not ranked: no current rate')
  else if (q.rank === 1) parts.push(among.some(o => o.lineId !== q.lineId && o.withinBand) ? 'Within 2%' : 'Best price')
  else if (q.withinBand) parts.push('Within 2%')
  else if (q.inStock) parts.push('Ex-stock')
  else if (q.pctAboveBest !== null) parts.push(`${q.pctAboveBest.toLocaleString('en-GB', { maximumFractionDigits: 1 })}% above the best`)
  parts.push(recordText(q))
  return parts.join(' · ')
}

/** The full line in the picker: every key behind the rank, spread last and only when the caller is allowed to see it. */
export function longReason(q: RankedQuote, among: readonly RankedQuote[]): string {
  const best = among.find(o => o.rank === 1)
  const parts: string[] = []
  if (!q.comparable || q.rank === null) parts.push('Not ranked: no current rate')
  else if (q.rank > 1 && q.pkrUnit !== null && best?.pkrUnit != null && q.pctAboveBest !== null) {
    parts.push(`≈ PKR ${formatAmount(Math.round(q.pkrUnit - best.pkrUnit))} each above the best (${q.pctAboveBest.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%)`)
  } else if (q.rank === 1) parts.push('Best price')
  if (q.rank !== null && q.rank > 1 && q.withinBand) parts.push('Within 2% of the best: by delivery record')
  parts.push(recordText(q))
  if (q.fxState === 'stale' && q.fxAgeDays !== null) parts.push(`Rate ${q.fxAgeDays} days old`)
  if (q.spreadUnit !== null) parts.push(`Spread ≈ PKR ${formatAmount(Math.round(q.spreadUnit))} each`)
  return parts.join(' · ')
}

/** "USD 412.00" and, under it, "≈ PKR 114,701" or "no conversion". */
export function priceTexts(q: RankedQuote): { price: string; pkr: string } {
  return {
    price: `${q.currency} ${formatAmount(q.price, 'always')}`,
    pkr: q.currency === 'PKR' ? 'no conversion' : q.pkrUnit !== null ? `≈ PKR ${formatAmount(Math.round(q.pkrUnit))}` : 'no rate',
  }
}
