/*
 * Amount text helpers for NumberInput (U07). PKR amounts are grouped in thousands
 * with commas (1,600,764) exactly as in the mockups, never lakh grouping.
 */
const groupFmt = (fraction: { min: number; max: number }) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: fraction.min, maximumFractionDigits: fraction.max, useGrouping: true })

/** More integer digits than this cannot be held exactly (and no amount in the books is that large). */
export const MAX_INTEGER_DIGITS = 15

type Read = { ok: true; value: number } | { ok: false; reason: 'empty' | 'unreadable' | 'too-large' }

/*
 * HW-1: what a person types is read one way only, or refused. Accepted:
 *   1234.50   1,234.50   1,234,567   1 234 567   1,00,000 (lakh groups)   -> the dot is the decimal point
 *   1.234,50  1.234.567                                                   -> European: dots group, the comma is the decimal
 *   12,5   12,50   0,75                                                   -> a lone comma followed by 1-2 digits is a decimal comma
 * "1,234" is one thousand two hundred thirty-four (the grouping this app prints) and "1.234" is one point two three four.
 * Anything else, such as "12,3456", "1,2,3" or "1.234.5", is refused rather than guessed, and NumberInput says why.
 */
function read(text: string): Read {
  let s = text.trim().replace(/[\s'’]/g, '') // \s also covers no-break and narrow no-break spaces
  if (s === '') return { ok: false, reason: 'empty' }
  let sign = ''
  if (s.startsWith('-')) {
    sign = '-'
    s = s.slice(1)
  }
  let int: string
  let frac = ''
  let m: RegExpExecArray | null
  if ((m = /^(\d*)\.(\d*)$/.exec(s)) && (m[1] || m[2])) {
    int = m[1] ?? ''
    frac = m[2] ?? ''
  } else if (/^\d+$/.test(s)) int = s
  else if ((m = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d*))?$/.exec(s)) || (m = /^(\d{1,2}(?:,\d{2})+,\d{3})(?:\.(\d*))?$/.exec(s))) {
    int = (m[1] ?? '').replace(/,/g, '')
    frac = m[2] ?? ''
  } else if ((m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(s)) && (m[2] !== undefined || (m[1] ?? '').split('.').length > 2)) {
    int = (m[1] ?? '').replace(/\./g, '')
    frac = m[2] ?? ''
  } else if ((m = /^(\d+),(\d{1,2})$/.exec(s))) {
    int = m[1] ?? ''
    frac = m[2] ?? ''
  } else return { ok: false, reason: 'unreadable' }
  if (int.replace(/^0+/, '').length > MAX_INTEGER_DIGITS) return { ok: false, reason: 'too-large' }
  const n = Number(`${sign}${int || '0'}.${frac || '0'}`)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: 'unreadable' }
}

/** "1,600,764", " 1 600 764", "1600764.50", "1.234,50", "12,5" -> number. Empty, unreadable or too large -> null. */
export function parseAmount(text: string): number | null {
  const r = read(text)
  return r.ok ? r.value : null
}

/** Why typed text is not an amount, in words for the person; null when it reads (or is empty). */
export function amountProblem(text: string): string | null {
  const r = read(text)
  if (r.ok || r.reason === 'empty') return null
  if (r.reason === 'too-large') return 'That number is too large.'
  return 'Not a number this can read. Type it like 1,234.50 or 1234.5.'
}

/**
 * Display text for a value. `decimals` fixes the places (278.40); without it up
 * to two places show only when there are any (1,600,764 and 12.5).
 */
export function formatAmount(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return decimals === undefined
    ? groupFmt({ min: 0, max: 2 }).format(value)
    : groupFmt({ min: decimals, max: decimals }).format(value)
}
