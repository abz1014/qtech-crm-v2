import { clean } from './text'

export type DateStatus = 'ok' | 'empty' | 'invalid'
export interface ParsedDate {
  date: string | null
  status: DateStatus
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= last
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The Asia/Karachi calendar date of a timestamp (Pakistan has no daylight saving: always UTC+5). */
export function pktDate(ts: Date): string {
  return new Date(ts.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Old date columns are text and were typed by people. Accepted:
 *   YYYY-MM-DD, an ISO timestamp (a zone is read as an instant and shown as Karachi time), DD/MM/YYYY, DD-MM-YYYY,
 *   DD.MM.YYYY (day first, as in Pakistan). Two-digit years mean 20YY.
 * Anything else, or a day that does not exist, is 'invalid'.
 */
export function parseLegacyDate(raw: unknown): ParsedDate {
  const s = clean(raw)
  if (s === null) return { date: null, status: 'empty' }

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validYmd(y, mo, d) ? { date: ymd(y, mo, d), status: 'ok' } : { date: null, status: 'invalid' }
  }

  m = /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.exec(s)
  if (m) {
    const hasZone = m[6] !== undefined
    const t = new Date(hasZone ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`)
    if (Number.isNaN(t.getTime())) return { date: null, status: 'invalid' }
    // A timestamp without a zone is already a wall-clock time: read its date part as it is.
    const date = hasZone ? pktDate(t) : t.toISOString().slice(0, 10)
    const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
    return validYmd(y, mo, d) ? { date, status: 'ok' } : { date: null, status: 'invalid' }
  }

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const d = Number(m[1])
    const mo = Number(m[2])
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return validYmd(y, mo, d) ? { date: ymd(y, mo, d), status: 'ok' } : { date: null, status: 'invalid' }
  }

  return { date: null, status: 'invalid' }
}

/** "Due: 31/01/2024" in free-text notes. Returns the raw dd/mm/yyyy text found, or null. */
export function dueTextFromNotes(notes: unknown): string | null {
  const s = clean(notes)
  if (s === null) return null
  const m = /\bdue(?:\s*date)?\s*[:-]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(s)
  return m ? m[1]! : null
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
