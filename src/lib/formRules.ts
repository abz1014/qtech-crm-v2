/*
 * Shared field rules for money forms and contact details (edge-case hunt HE-3, 4, 5, 7, 8, 9, 10, 17).
 * Each rule says in plain words what is wrong, so the form summary can repeat it (HE-6), and catches in the form what
 * the database would otherwise refuse with a sentence that cannot help (numeric overflow, the paisa check).
 */
import { z } from 'zod'
import { formatDateText } from '@/lib/dateInput'
import { businessToday } from '@/lib/dates'
import { formatPaisa, formatRate } from '@/lib/money'

/** numeric(14,2): the largest amount a money column holds. */
export const MAX_AMOUNT = 999_999_999_999.99
/** numeric(14,6): the largest exchange rate. */
export const MAX_RATE = 99_999_999.999999
/** The earliest business date a payment, expense or rate may carry. */
export const EARLIEST_DATE = '2000-01-01'

/**
 * A PKR amount field: above zero, at least one paisa, and small enough for numeric(14,2).
 * `missing` is the sentence for an empty or unreadable field ("Enter the amount received").
 */
export function amountSchema(missing: string) {
  return z
    .number({ invalid_type_error: missing, required_error: missing })
    .positive('The amount must be above zero')
    .min(0.01, 'The smallest amount is 0.01 (one paisa)')
    .max(MAX_AMOUNT, 'That amount is too large. Check it for an extra digit')
}

/** An amount rounded to the paisa as Postgres numeric(14,2) does (half away from zero on the decimal typed). */
export function amountPaisa(value: number): bigint {
  // two spare digits: 100.555 is 100.55499999… in binary; toFixed(4) gives back the "100.5550" that was typed
  const [w, f = ''] = Math.abs(value).toFixed(4).split('.')
  let p = BigInt(w + f.slice(0, 2))
  if (f.charCodeAt(2) >= 53) p += 1n
  return value < 0 ? -p : p
}

/**
 * "PKR 12,345.50" / "PKR 5,900": the amount exactly as it is stored (rounded to the paisa as numeric(14,2) does), the
 * paisa shown as two digits whenever there are any, like the lists and the payment-correction toasts. For toasts.
 */
export function pkr(value: number | string): string {
  return `PKR ${formatPaisa(amountPaisa(Number(value)))}`
}

/** A rate as numeric(14,6) stores it, for display ("281.123457"). */
export function storedRate(value: number): string {
  return formatRate(value.toFixed(6))
}

function addYears(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y + years, m - 1, d))
  // 29 Feb plus a year is 1 Mar; keep it on the last day of February instead
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0)
  return t.toISOString().slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export interface DateRange {
  earliest: string
  latest: string
}

/** Payments and expenses: 1 Jan 2000 to a year from today (a post-dated cheque is fine; 2200 is a typo). */
export function businessDateRange(today: string = businessToday()): DateRange {
  return { earliest: EARLIEST_DATE, latest: addYears(today, 1) }
}

/** Exchange rates: a rate counts only from its date, so a future one would silently do nothing. Up to a week ahead. */
export function rateDateRange(today: string = businessToday()): DateRange {
  return { earliest: EARLIEST_DATE, latest: addDays(today, 7) }
}

/** The plain sentence when `isoDate` is outside the range, else null. Empty text is left to the "required" rule. */
export function dateRangeProblem(isoDate: string, range: DateRange): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  if (isoDate >= range.earliest && isoDate <= range.latest) return null
  return `Use a date between ${formatDateText(range.earliest)} and ${formatDateText(range.latest)}. Check the year`
}

/** A zod refinement for a YYYY-MM-DD field. The range is read when the form is checked, so "today" is never stale. */
export function inDateRange(range: () => DateRange) {
  return (value: string, ctx: z.RefinementCtx) => {
    const problem = dateRangeProblem(value, range())
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
  }
}

const EASTERN_DIGITS = /[٠-٩۰-۹]/g

/** Arabic-Indic and Urdu (Extended) digits to 0-9, and the space trimmed; anything else is left for the check. */
export function normalisePhone(text: string): string {
  return text
    .replace(EASTERN_DIGITS, ch => {
      const c = ch.charCodeAt(0)
      return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660)
    })
    .trim()
}

/** Why a phone number cannot be saved, or null when it is fine (an empty value is fine: phones are optional). */
export function phoneProblem(text: string): string | null {
  const v = normalisePhone(text)
  if (!v) return null
  if (!/^\+?[\d\s().-]+$/.test(v)) return 'Use digits only, with + ( ) - or spaces if you like'
  const digits = v.replace(/\D/g, '').length
  if (digits < 7) return 'That number is too short'
  if (digits > 20) return 'That number is too long'
  return null
}

/** An optional phone field: digits normalised, letters and emoji refused with a plain sentence. */
export const phoneText = z
  .string()
  .transform(normalisePhone)
  .superRefine((v, ctx) => {
    const problem = phoneProblem(v)
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
  })
