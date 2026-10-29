import { shiftMonth } from '@/features/money/expenses/model'

/*
 * GST deadlines (migration 0110; owner answer to Q8, 2026-10-28). The day GST is paid to FBR and the day the return is filed are NOT
 * fixed, so the admin edits them in Settings > Tax deadlines. Every reminder and every GST screen reads the dates from here.
 * 15 and 18 are only the starting values. FBR sometimes extends one month: a one-off date for that month's GST overrides the day.
 * Pure: the calls are in settings/api.ts, the hooks in settings/hooks.ts.
 */
export const DEFAULT_GST_PAY_DAY = 15
export const DEFAULT_GST_RETURN_DAY = 18
/** Days 1 to 28, so every month has the day. */
export const GST_DAY_MIN = 1
export const GST_DAY_MAX = 28

export interface GstDeadlineOverride {
  /** The first day of the month the GST is for ("2026-10-01": October's GST, due in November). */
  month: string
  payBy: string | null
  returnBy: string | null
}

export interface GstDeadlines {
  payDay: number
  returnDay: number
  overrides: GstDeadlineOverride[]
}

export const DEFAULT_GST_DEADLINES: GstDeadlines = { payDay: DEFAULT_GST_PAY_DAY, returnDay: DEFAULT_GST_RETURN_DAY, overrides: [] }

export interface GstDates {
  payBy: string
  returnBy: string
  /** A one-off date is in force for this date. */
  payOverridden: boolean
  returnOverridden: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The pay-by and file-by dates of the GST of `month` ("2026-10" or "2026-10-01"): the month's one-off dates, else the usual days of the next month. */
export function gstDatesFor(d: GstDeadlines, month: string): GstDates {
  const key = month.slice(0, 7)
  const next = shiftMonth(key, 1)
  const o = d.overrides.find(x => x.month.slice(0, 7) === key)
  return {
    payBy: o?.payBy ?? `${next}-${pad(d.payDay)}`,
    returnBy: o?.returnBy ?? `${next}-${pad(d.returnDay)}`,
    payOverridden: !!o?.payBy,
    returnOverridden: !!o?.returnBy,
  }
}

export const isGstDay = (n: number): boolean => Number.isInteger(n) && n >= GST_DAY_MIN && n <= GST_DAY_MAX

/** A day typed in a box; null when it is not a whole day from 1 to 28. */
export function parseGstDay(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,2}$/.test(t)) return null
  const n = Number(t)
  return isGstDay(n) ? n : null
}

/** "15th", "22nd", "3rd": the day in words for a sentence. */
export function dayWords(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** The rows of the two tables as the app holds them. */
export function deadlinesFromRows(
  settings: { pay_day: number; return_day: number } | null,
  overrides: readonly { month: string; pay_by: string | null; return_by: string | null }[],
): GstDeadlines {
  return {
    payDay: settings?.pay_day ?? DEFAULT_GST_PAY_DAY,
    returnDay: settings?.return_day ?? DEFAULT_GST_RETURN_DAY,
    overrides: overrides.map(o => ({ month: o.month, payBy: o.pay_by, returnBy: o.return_by })).sort((a, b) => (a.month < b.month ? 1 : -1)),
  }
}
