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
