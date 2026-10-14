/** "2026-11-26" to "Thu 26 Nov". Pure calendar arithmetic on the date parts, so no timezone can shift the day. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return `${DAYS[d.getUTCDay()]} ${+m[3]} ${MONTHS[+m[2] - 1]}`
}

/** "2026-11-26" to "26 Nov". With `year`, or when the date is in another year than `today`, "26 Nov 2025". */
export function formatShortDate(iso: string, today?: string, year = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const base = `${+m[3]} ${MONTHS[+m[2] - 1]}`
  const otherYear = today ? !today.startsWith(m[1]) : false
  return year || otherYear ? `${base} ${m[1]}` : base
}
