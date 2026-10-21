import type { FxLatestRow } from '@/features/rfqs/api'
import { formatDay } from '@/lib/formatDay'

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

/**
 * What the rates' one status line says, from the rows themselves (audit 2026-10-22: "Updated every night" sat above five rows that
 * all said "Entered by hand"). Says what actually happened: when the newest automatic rate is from, and how many are by hand.
 *   no rows               "No rates yet."
 *   all automatic         "Last automatic update Thu 26 Nov."
 *   mixed                 "Last automatic update Thu 26 Nov. 2 rates entered by hand."
 *   all by hand           "No automatic update yet. Rates entered by hand."
 */
export function ratesStatusLine(rows: readonly Pick<FxLatestRow, 'asOf' | 'source'>[]): string {
  if (rows.length === 0) return 'No rates yet.'
  const auto = rows.filter(r => r.source === 'auto').map(r => r.asOf).sort()
  const byHand = rows.length - auto.length
  if (auto.length === 0) return 'No automatic update yet. Rates entered by hand.'
  const last = `Last automatic update ${formatDay(auto[auto.length - 1])}.`
  return byHand === 0 ? last : `${last} ${byHand} ${byHand === 1 ? 'rate' : 'rates'} entered by hand.`
}