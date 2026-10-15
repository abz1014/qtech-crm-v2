// Calendar-date helpers for the RFQ text modules. Pure arithmetic on YYYY-MM-DD strings (UTC date parts), so no
// machine timezone can shift a day. The caller supplies "today" in the business timezone (src/lib/dates.ts).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface DayParts {
  y: number
  m: number
  d: number
}

/** Parses the date part of "YYYY-MM-DD" (a longer ISO timestamp is cut to its first ten characters). Null if invalid. */
export function parseDay(iso: string | null | undefined): DayParts | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const y = +m[1]
  const mo = +m[2]
  const d = +m[3]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return { y, m: mo, d }
}

export function toIso(t: Date): string {
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

function asDate(p: DayParts): Date {
  return new Date(Date.UTC(p.y, p.m - 1, p.d))
}

/** Adds (or subtracts) whole calendar days. Returns null for an invalid input date. */
export function addDays(iso: string, days: number): string | null {
  const p = parseDay(iso)
  if (!p) return null
  const t = asDate(p)
  t.setUTCDate(t.getUTCDate() + days)
  return toIso(t)
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const p = parseDay(iso)
  if (!p) throw new RangeError(`not a date: ${iso}`)
  return asDate(p).getUTCDay()
}

export function isWeekend(iso: string): boolean {
  const w = weekdayOf(iso)
  return w === 0 || w === 6
}

/** "Tuesday 1 December" (the form used in the approved texts). */
export function longDay(iso: string): string {
  const p = parseDay(iso)
  if (!p) return iso
  return `${WEEKDAYS[asDate(p).getUTCDay()]} ${p.d} ${MONTHS[p.m - 1]}`
}

/** "3 Nov", or "3 Nov 2025" when the year differs from `today`'s (so an old date is never ambiguous). */
export function shortDay(iso: string, today?: string | null): string {
  const p = parseDay(iso)
  if (!p) return iso
  const t = parseDay(today)
  const base = `${p.d} ${MONTHS[p.m - 1].slice(0, 3)}`
  return t && t.y !== p.y ? `${base} ${p.y}` : base
}

/** "Mar 2026". */
export function monthYear(iso: string): string {
  const p = parseDay(iso)
  if (!p) return iso
  return `${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`
}

/** The working day `n` working days after `iso`, stepping over Saturdays and Sundays. `n` of 0 returns `iso` itself. */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso
  for (let i = 0; i < n; i++) {
    d = addDays(d, 1) as string
    while (isWeekend(d)) d = addDays(d, 1) as string
  }
  return d
}

/** The working day `n` working days before `iso`. */
export function subtractBusinessDays(iso: string, n: number): string {
  let d = iso
  for (let i = 0; i < n; i++) {
    d = addDays(d, -1) as string
    while (isWeekend(d)) d = addDays(d, -1) as string
  }
  return d
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return 0
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** Working days elapsed from `from` to `to`: how many Monday-to-Friday days lie after `from` up to and including `to`. Zero when `to` is not after `from`. */
export function businessDaysBetween(from: string, to: string): number {
  let n = 0
  let d = from
  while (d < to) {
    d = addDays(d, 1) as string
    if (!isWeekend(d)) n++
  }
  return n
}

/** The next Monday strictly after `iso`. */
export function nextMonday(iso: string): string {
  let d = addDays(iso, 1) as string
  while (weekdayOf(d) !== 1) d = addDays(d, 1) as string
  return d
}

/** "20 October 2026". */
export function dayMonthYear(iso: string): string {
  const p = parseDay(iso)
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : iso
}

/** "14 November". */
export function dayMonth(iso: string): string {
  const p = parseDay(iso)
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : iso
}
