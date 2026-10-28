// R09/R10: the pure side of the clarifications panel and the attachments. No React, no database.
//
//  - splitQuestions: a pasted message becomes one question per line (numbering and bullets stripped).
//  - states and groups: to ask / asked / answered / withdrawn, derived from the timestamps (DATA_MODEL 2.11).
//  - relay text for a supplier; a photo-only answer reads "see attached photo" (BUILD_PLAN A3 R09).
//  - storage path format {parent_id}/{uuid}.{ext} (DATA_MODEL 2.20).

import { parseDay } from './dateText'

// ---------------------------------------------------------------- paste to questions

const LEAD = /^\s*(?:[-*•–—]+|\(?\d{1,2}[.)]|Q\s*\d{0,2}\s*[:.)-])\s+/i

/** One question per line. Leading numbers and bullets go; blank lines and repeats go; "A? B?" on one line becomes two. */
export function splitQuestions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LEAD, '').replace(LEAD, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    for (const part of line.split(/(?<=\?)\s+(?=[A-Z0-9])/)) {
      const q = part.trim()
      const key = q.toLowerCase()
      if (q.length < 2 || seen.has(key)) continue
      seen.add(key)
      out.push(q)
    }
  }
  return out
}

// ---------------------------------------------------------------- state

export interface ClarLike {
  id: string
  question: string
  raisedByInquiryId: string | null
  firstAskedAt: string | null
  lastAskedAt: string | null
  askCount: number
  answer: string | null
  answeredAt: string | null
  withdrawnAt: string | null
  createdAt: string
}

export type ClarState = 'to-ask' | 'asked' | 'answered' | 'withdrawn'

export function clarState(c: Pick<ClarLike, 'answeredAt' | 'withdrawnAt' | 'lastAskedAt' | 'askCount'>): ClarState {
  if (c.withdrawnAt) return 'withdrawn'
  if (c.answeredAt) return 'answered'
  return c.lastAskedAt || c.askCount > 0 ? 'asked' : 'to-ask'
}

export interface ClarGroups<T> {
  toAsk: T[]
  asked: T[]
  answered: T[]
  withdrawn: T[]
}

export function groupClarifications<T extends ClarLike>(rows: readonly T[]): ClarGroups<T> {
  const g: ClarGroups<T> = { toAsk: [], asked: [], answered: [], withdrawn: [] }
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  for (const c of sorted) {
    const s = clarState(c)
    ;(s === 'to-ask' ? g.toAsk : s === 'asked' ? g.asked : s === 'answered' ? g.answered : g.withdrawn).push(c)
  }
  return g
}

function dayNumber(iso: string): number {
  const p = parseDay(iso)
  if (!p) return NaN
  return Date.UTC(p.y, p.m - 1, p.d) / 86_400_000
}

/** Whole calendar days from `fromDay` to `today` (both YYYY-MM-DD in the business timezone). Never negative. */
export function daysBetween(fromDay: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(fromDay))
}

/** "today", "yesterday", "6 days ago". */
export function agoText(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** DATA_MODEL section 5c: a chase is due 3 days after the last ask, or 1 day when the bid is due within 3 days. */
export function chaseDue(daysSinceAsk: number, dueOn: string | null, today: string): boolean {
  const due = dueOn ? dueOn.slice(0, 10) : null
  const soon = due ? dayNumber(due) >= dayNumber(today) && dayNumber(due) - dayNumber(today) <= 3 : false
  return daysSinceAsk >= (soon ? 1 : 3)
}

// ---------------------------------------------------------------- relay

export interface RelayInquiry {
  id: string
  lastRelayedAt: string | null
}

/** Answers that supplier has not been told yet: raised by them, answered after the last relay (v_inquiry_state's rule). */
export function answersToRelay<T extends ClarLike>(rows: readonly T[], inquiry: RelayInquiry): T[] {
  return rows
    .filter(c => c.raisedByInquiryId === inquiry.id && c.answeredAt && !c.withdrawnAt && (!inquiry.lastRelayedAt || c.answeredAt > inquiry.lastRelayedAt))
    .sort((a, b) => (a.answeredAt as string).localeCompare(b.answeredAt as string))
}

export interface RelayLine {
  question: string
  answer: string | null
  hasPhoto: boolean
}

/** The text for one supplier. A photo-only answer reads "see attached photo". */
export function relayText(input: { rfqRef: string; contactName: string | null; lines: readonly RelayLine[]; signature: { name: string; company: string } }): string {
  const { lines } = input
  const out: string[] = [input.contactName ? `Hi ${input.contactName}, hope you are doing well,` : 'Hi hope you are doing well,', '']
  out.push(lines.length === 1 ? `Here is the answer to your question on ${input.rfqRef}:` : `Here are the answers to your questions on ${input.rfqRef}:`, '')
  lines.forEach((l, i) => {
    const a = l.answer?.trim()
    const ans = a ? (l.hasPhoto ? `${a} (see attached photo)` : a) : l.hasPhoto ? 'see attached photo' : 'answered'
    out.push(`${i + 1}. ${l.question}`, `   ${ans}`)
  })
  out.push('', 'Thank you.', 'Regards,', input.signature.name, input.signature.company)
  return out.join('\n')
}

// The customer text (first ask, reminder, bid close, third ask, firm) is generateCustomerChase in ./customerChase: one
// generator for every surface (Today, the clarifications panel).

// ---------------------------------------------------------------- files

/** What an RFQ file may be (R10). HEIC and HEIF are phone photos; they are kept as they are when the browser cannot shrink them. */
// Spreadsheets too (.xlsx, .xls, .csv): a customer's RFQ often comes as one; New RFQ reads it (src/lib/docread/sheetText.ts).
export const RFQ_FILE_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
] as const

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

export function fileExtension(name: string, mime: string): string {
  const fromMime = EXT_BY_MIME[mime]
  if (fromMime) return fromMime
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Storage path: {parent_id}/{uuid}.{ext}. The parent is always the RFQ, also for a photo that answers a question. */
export function attachmentPath(parentId: string, uuid: string, name: string, mime: string): string {
  return `${parentId}/${uuid}.${fileExtension(name, mime)}`
}

export const PATH_FORMAT = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/

/** An image the browser can show in the viewer. HEIC and HEIF cannot be shown by most browsers; they are opened as a download. */
export function canPreview(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/gif'
}
