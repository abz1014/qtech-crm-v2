import type { FxLatestRow } from '@/features/rfqs/api'

/* Pure helpers for the exchange-rate table (kept apart from the component so they test without a DOM). */

const FIRST = ['USD', 'EUR', 'CNY', 'AED']

/** The common currencies first, in the usual order, then the rest A to Z. */
export function sortRates(rows: readonly FxLatestRow[]): FxLatestRow[] {
  const rank = (c: string) => {
    const i = FIRST.indexOf(c)
    return i === -1 ? FIRST.length : i
  }
  return [...rows].sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
}

export function sourceLabel(source: string): string {
  return source === 'auto' ? 'Automatic' : 'Entered by hand'
}

/** "Today", "1 day old", "14 days old", "52 days old, not compared". */
export function rateAgeLabel(row: Pick<FxLatestRow, 'ageDays' | 'staleness'>): string {
  const n = row.ageDays
  if (n <= 0) return 'Today'
  const base = `${n} ${n === 1 ? 'day' : 'days'} old`
  return row.staleness === 'unusable' ? `${base}, not compared` : base
}
