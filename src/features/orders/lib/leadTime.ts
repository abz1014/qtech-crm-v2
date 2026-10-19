// Lead time text to days (A3/O03: expected_on is suggested from placed_on plus the UPPER bound of the lead time).
// Pure and framework-free. A supplier writes "2 wks", "4-6 weeks", "10 to 14 days", "1 month", "ex-stock".

import { addDays } from '@/features/rfqs/lib/dateText'

const IN_STOCK = /\b(ex[-\s]?stock|in[-\s]?stock|from stock|stock|immediate(ly)?|ready)\b/i
const UNIT_DAYS: Array<[RegExp, number]> = [
  [/^(w|wk|wks|week|weeks)$/i, 7],
  [/^(m|mo|mos|month|months)$/i, 30],
  [/^(d|day|days|working days|wd)$/i, 1],
]

/** The largest number of days the text promises, or null when it says nothing a date can be made from. */
export function leadTimeUpperDays(text: string | null | undefined): number | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(working days|[a-z]+)?/i.exec(t)
  if (!m) return IN_STOCK.test(t) ? 0 : null
  const upper = Number(m[2] ?? m[1])
  const unit = (m[3] ?? 'days').trim()
  const factor = UNIT_DAYS.find(([re]) => re.test(unit))?.[1]
  if (factor === undefined) return null
  return Math.round(upper * factor)
}

export interface ExpectedSuggestion {
  /** YYYY-MM-DD */
  on: string
  /** The lead-time wording the date came from, as the supplier wrote it ("2 wks"). */
  from: string
  days: number
}

/** placed_on plus the longest lead time among the leg's quote lines. Null when nothing parses. */
export function suggestExpected(placedOn: string | null, leadTimes: ReadonlyArray<string | null | undefined>): ExpectedSuggestion | null {
  if (!placedOn) return null
  let best: { days: number; from: string } | null = null
  for (const t of leadTimes) {
    const days = leadTimeUpperDays(t)
    if (days !== null && (!best || days > best.days)) best = { days, from: (t ?? '').trim() }
  }
  if (!best) return null
  const on = addDays(placedOn, best.days)
  return on ? { on, from: best.from, days: best.days } : null
}

/** What a leg's expected date falls back to when no quoted lead time gives one and the supplier has no delivery record. */
export const FALLBACK_EXPECTED_DAYS = 30

export interface DefaultExpected extends ExpectedSuggestion {
  source: 'lead_time' | 'supplier_median' | 'fallback'
  /** Plain words for the hint under the date: "from lead time 2 wks", "this supplier usually takes 18 days", "30 days assumed". */
  label: string
}

/**
 * The expected date every placed leg should carry, so "goods late" can fire on it: placed_on plus the quoted lead time (the longest on the
 * leg's quote lines), else the supplier's median days from placed to delivered, else 30 days. Always returns a date when placed_on is known.
 * The person can edit it; this is only the starting point.
 */
export function defaultExpected(placedOn: string | null, leadTimes: ReadonlyArray<string | null | undefined>, supplierMedianDays: number | null): DefaultExpected | null {
  if (!placedOn) return null
  const lead = suggestExpected(placedOn, leadTimes)
  if (lead) return { ...lead, source: 'lead_time', label: `from lead time ${lead.from}` }
  const pick =
    supplierMedianDays !== null && supplierMedianDays > 0
      ? { days: Math.round(supplierMedianDays), source: 'supplier_median' as const }
      : { days: FALLBACK_EXPECTED_DAYS, source: 'fallback' as const }
  const on = addDays(placedOn, pick.days)
  if (!on) return null
  return {
    on,
    from: '',
    days: pick.days,
    source: pick.source,
    label: pick.source === 'supplier_median' ? `this supplier usually takes ${pick.days} days` : `${pick.days} days assumed, no lead time quoted`,
  }
}

/** Median days from placed to delivered over a supplier's finished legs; null with fewer than two to go on. */
export function medianDeliveryDays(legs: ReadonlyArray<{ placedOn: string | null; deliveredOn: string | null }>): number | null {
  const days: number[] = []
  for (const l of legs) {
    if (!l.placedOn || !l.deliveredOn) continue
    const d = Math.round((Date.parse(l.deliveredOn) - Date.parse(l.placedOn)) / 86_400_000)
    if (Number.isFinite(d) && d >= 0) days.push(d)
  }
  if (days.length < 2) return null
  days.sort((a, b) => a - b)
  const mid = Math.floor(days.length / 2)
  return days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2)
}
