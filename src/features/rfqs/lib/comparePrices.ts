// R15 (built here for R07): which of an item's quote lines is the lowest. Pure and framework-free.
//
// Rules (DATA_MODEL section 5, Amendment A2b; BUILD_PLAN R07, R15):
//  - Live comparison uses TODAY's rate (v_fx_latest), never the rate captured on the line.
//  - A rate up to 7 days old is fresh, 8 to 30 days stale (still used, with a note), over 30 days unusable.
//  - A line whose rate is unusable or missing is not converted and is marked "not compared, no rate". It never blocks anything.
//  - Lines that all share one currency are compared as they are, with no rate needed (PKR is its own rate).
//  - "Lowest" is only marked when at least two lines can be compared. Ties are all marked.

import { convertToPaisa, fxStaleness, type Amount, type FxStaleness } from '@/lib/money'

export interface PriceLine {
  id: string
  amount: Amount
  /** ISO code: PKR, USD, EUR, CNY, AED... */
  currency: string
}

export interface TodaysRate {
  /** PKR per unit, from v_fx_latest. */
  rate: Amount
  /** Days since the rate's date (v_fx_latest.age_days). */
  ageDays: number
  /** v_fx_latest.staleness; derived from ageDays when omitted. */
  staleness?: FxStaleness | null
}

/** Today's rates by currency. A missing key means no rate has ever been set. */
export type RateTable = Readonly<Record<string, TodaysRate | undefined>>

export type NotComparedReason = 'no-rate' | 'unusable'

export interface ComparedLine {
  id: string
  /** The line is part of the comparison (it can be ranked against the others). */
  compared: boolean
  /** PKR at today's rate, in paisa; null when it cannot be converted. */
  pkrPaisa: bigint | null
  /** Why the line has no PKR figure. Null when it was converted (or is PKR). */
  notCompared: NotComparedReason | null
  /** The band of the rate used for this line (null for PKR, or when no rate exists). */
  band: FxStaleness | null
  rateAgeDays: number | null
  lowest: boolean
}

export interface Comparison {
  lines: ComparedLine[]
  /** How lines were ranked: in their one shared currency, or converted to PKR. */
  basis: 'native' | 'pkr'
  comparableCount: number
  lowestIds: string[]
}

export function comparePrices(lines: readonly PriceLine[], rates: RateTable): Comparison {
  const currencies = new Set(lines.map(l => l.currency))
  const native = currencies.size <= 1
  const amountOf = new Map(lines.map(l => [l.id, l.amount]))

  const out: ComparedLine[] = lines.map(l => {
    if (l.currency === 'PKR') {
      return { id: l.id, compared: true, pkrPaisa: convertToPaisa(l.amount, 1), notCompared: null, band: null, rateAgeDays: null, lowest: false }
    }
    const r = rates[l.currency]
    const band = r ? (r.staleness ?? fxStaleness(r.ageDays)) : null
    if (!r || band === 'unusable') {
      return {
        id: l.id,
        // Lines that all share a currency still rank against each other with no rate at all.
        compared: native,
        pkrPaisa: null,
        notCompared: r ? 'unusable' : 'no-rate',
        band,
        rateAgeDays: r?.ageDays ?? null,
        lowest: false,
      }
    }
    return { id: l.id, compared: true, pkrPaisa: convertToPaisa(l.amount, r.rate), notCompared: null, band, rateAgeDays: r.ageDays, lowest: false }
  })

  const comparable = out.filter(l => l.compared)
  const lowestIds: string[] = []
  if (comparable.length >= 2) {
    const key = (l: ComparedLine): number | bigint => (native ? Number(amountOf.get(l.id)) : (l.pkrPaisa as bigint))
    let best = key(comparable[0])
    for (const l of comparable) if (key(l) < best) best = key(l)
    for (const l of comparable) {
      if (key(l) === best) {
        l.lowest = true
        lowestIds.push(l.id)
      }
    }
  }
  return { lines: out, basis: native ? 'native' : 'pkr', comparableCount: comparable.length, lowestIds }
}

/** The rate table from v_fx_latest rows (currency, PKR per unit, age in days, the view's own band). */
export function toRateTable(
  rows: ReadonlyArray<{ currency: string; ratePkr: number; ageDays: number; staleness?: FxStaleness | null }>,
): RateTable {
  return Object.fromEntries(rows.map(r => [r.currency, { rate: r.ratePkr, ageDays: r.ageDays, staleness: r.staleness ?? fxStaleness(r.ageDays) }]))
}
