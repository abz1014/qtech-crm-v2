/*
 * Date text for DateInput (U07). Dates are shown as "Fri 27 Nov 2026" and typed
 * day-first, the way the team writes them. Everything works on plain
 * year/month/day numbers, never on a local-time Date, so a runtime in another
 * timezone cannot shift a business date by a day.
 */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= dim
}

const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function shift(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** "2026-11-27" -> "Fri 27 Nov 2026". Anything that is not a real date gives "". */
export function formatDateText(isoDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? '')
  if (!m) return ''
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!valid(y, mo, d)) return ''
  const wd = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  return `${wd} ${d} ${MONTH_LABEL[mo - 1]} ${y}`
}

/**
 * What people type, day-first, to YYYY-MM-DD. `today` is the business date
 * (YYYY-MM-DD) that fills in a missing year and anchors "today" and "yesterday".
 * Accepts: today, yesterday, tomorrow; 27 nov; 27 november 2026; 27/11; 27-11-26;
 * 27.11.2026; 2026-11-27; and the display form "Fri 27 Nov 2026".
 * Returns null when it is not a real date.
 */
export function parseDateText(text: string, today: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (!t) return null
  if (t === 'today') return today
  if (t === 'yesterday') return shift(today, -1)
  if (t === 'tomorrow') return shift(today, 1)
  const thisYear = Number(today.slice(0, 4))
  const fullYear = (n: number, digits: number) => (digits <= 2 ? 2000 + n : n)

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t)
  if (m) {
    const y = m[3] ? fullYear(+m[3], m[3].length) : thisYear
    return valid(y, +m[2], +m[1]) ? iso(y, +m[2], +m[1]) : null
  }

  // "[weekday] 27 nov [2026]"; the month is matched on its first three letters
  m = /^(?:[a-z]{3,9} )?(\d{1,2}) ([a-z]{3,9})(?: (\d{2}|\d{4}))?$/.exec(t)
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3)) + 1
    if (mo === 0) return null
    const y = m[3] ? fullYear(+m[3], m[3].length) : thisYear
    return valid(y, mo, +m[1]) ? iso(y, mo, +m[1]) : null
  }
  return null
}
