/*
 * Capture, the pure part: the small text rules the Add to job card and the share target use (price-reply check, the note
 * stamp and append, the counts line, the short day). The old destination tiles (answer / questions / notes / reply) are gone.
 */

/** A supplier's price reply: at least two amounts written with a currency ("GBP 1,840", "USD 2,395.00", "Rs. 45,000"). */
const CURRENCY_AMOUNT = /\b(?:USD|EUR|GBP|AED|CNY|RMB|JPY|CHF|SAR|PKR|Rs\.?)\s?\d[\d,]*(?:\.\d+)?/gi
export const looksLikePriceReply = (text: string) => (text.match(CURRENCY_AMOUNT) ?? []).length >= 2

/** The line that names the author and time in front of an appended note: "Ayesha Rana, Fri 27 Nov, 09:41". */
export function noteStamp(name: string, when: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(when)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${name}, ${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`
}

/** Notes are appended as written, never rewritten. */
export function appendNote(existing: string | null, text: string, stamp: string): string {
  const entry = `${stamp}\n${text.trim()}`
  return existing && existing.trim() ? `${existing.trimEnd()}\n\n${entry}` : entry
}

/** "1 message · 1 photo", "1 text", "1 photo", "1 text · 2 files" (g2-capture.html). A shared text is a message; pasted or typed is text. */
export function countsText(source: string, text: string, files: readonly { type: string }[]): string {
  const parts: string[] = []
  if (text.trim()) parts.push(source === 'share' ? '1 message' : '1 text')
  if (files.length > 0) {
    const photos = files.every(f => f.type.startsWith('image/'))
    const word = photos ? 'photo' : 'file'
    parts.push(`${files.length} ${word}${files.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

/** "Sat 21 Nov" in Karachi time. */
export function shortDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`
}

/** One more line under the notes, on a line of its own (the engineer's note: "Fri 27 Nov, Ali Raza: valve was leaking"). */
export function appendLine(existing: string | null, line: string): string {
  return existing && existing.trim() ? `${existing.trimEnd()}\n${line}` : line
}
