/* Day and time wording for Month-end, in the business timezone (Asia/Karachi). */
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long' })
const STAMP_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' })
const STAMP_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false })
const STAMP_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', year: 'numeric' })

/** "2026-11-06" to "Friday 6 November". */
export const longDay = (iso: string): string => DAY.format(new Date(`${iso}T12:00:00+05:00`))

/** A timestamp to "Fri 6 Nov, 14:05" (the closed-month rows and dialogs). */
export function formatClosedAt(ts: string): string {
  const d = new Date(ts)
  return `${STAMP_DAY.format(d).replace(',', '')}, ${STAMP_TIME.format(d)}`
}

/** "Fri 2 Oct" without the time, with the year when it is not this year. */
export function formatClosedDay(ts: string, today: string): string {
  const d = new Date(ts)
  const year = STAMP_YEAR.format(d)
  return `${STAMP_DAY.format(d).replace(',', '')}${year === today.slice(0, 4) ? '' : ` ${year}`}`
}

/** Day of the close window ("day 6 of the 10-day close window"), or null outside days 1 to 10 of the month after `month`. */
export function closeWindowDay(month: string, today: string): number | null {
  const [y, m] = month.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1))
  const key = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
  if (today.slice(0, 7) !== key) return null
  const day = Number(today.slice(8, 10))
  return day <= 10 ? day : null
}
