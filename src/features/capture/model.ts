import { splitQuestions } from '@/features/rfqs/lib/clarifications'

/*
 * Capture, the pure part (R22; docs/design/mockups/g2-capture.html). What was captured, where it most likely goes, which
 * RFQ and which questions are pre-selected, and the words on the primary button. No React and no database, so the
 * "one tap confirms" rule is testable.
 *
 * Decisions (DECISIONS 2026-10-14, Gate 2 question 3): Capture pre-selects the most likely destination, and one tap confirms it.
 */
export type Dest = 'answer' | 'questions' | 'notes' | 'new-rfq' | 'reply'

export const DESTS: readonly Dest[] = ['answer', 'questions', 'notes', 'new-rfq', 'reply']

export type PayloadKind = 'empty' | 'text' | 'files' | 'both'

export function payloadKind(text: string, fileCount: number): PayloadKind {
  const t = text.trim().length > 0
  if (t && fileCount > 0) return 'both'
  if (t) return 'text'
  return fileCount > 0 ? 'files' : 'empty'
}

export interface OpenQuestion {
  id: string
  question: string
  asked: boolean
  /** When it was last put to the customer (ISO), for the "Asked Sat 21 Nov" line. */
  askedAt: string | null
  createdAt: string
}

export interface Candidate {
  id: string
  number: number
  companyName: string
  ownerId: string | null
  /** The site the RFQ is for ("Faisalabad"), shown after the company name. */
  site: string | null
  /** When this person last opened the RFQ on this device, if ever. */
  openedAt: number | null
  /** Unanswered, not withdrawn; asked ones first, then by creation. */
  open: OpenQuestion[]
}

export const RECENT_MS = 24 * 60 * 60 * 1000

/** Recently opened first (newest first), then the person's own RFQs with the most open questions, newest number first. */
export function orderCandidates(list: readonly Candidate[], now: number): Candidate[] {
  const recent = (c: Candidate) => c.openedAt !== null && now - c.openedAt <= RECENT_MS
  const a = list.filter(recent).sort((x, y) => (y.openedAt ?? 0) - (x.openedAt ?? 0))
  const b = list.filter(c => !recent(c)).sort((x, y) => y.open.length - x.open.length || y.number - x.number)
  return [...a, ...b]
}

export function sortOpenQuestions<T extends { asked: boolean; createdAt: string; id: string }>(qs: readonly T[]): T[] {
  return [...qs].sort((x, y) => Number(y.asked) - Number(x.asked) || x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))
}

const looksLikeQuestionLines = (text: string) => {
  const lines = splitQuestions(text)
  return lines.length >= 2 && lines.filter(l => l.endsWith('?')).length >= Math.ceil(lines.length / 2)
}

/** The destination to pre-select. A reply to what we asked is by far the commonest capture, so it wins when a question is waiting. */
export function guessDestination(kind: PayloadKind, text: string, ordered: readonly Candidate[]): Dest {
  const waiting = ordered.some(c => c.open.length > 0)
  if (kind === 'empty') return waiting ? 'answer' : 'notes'
  if (waiting) return 'answer'
  if (kind === 'files') return 'notes'
  if (looksLikeQuestionLines(text)) return 'questions'
  return ordered.length > 0 && text.trim().length < 400 ? 'notes' : 'new-rfq'
}

/** The RFQ to pre-select for a destination: for an answer, the first one with something waiting; otherwise the most recent. */
export function defaultRfq(dest: Dest, ordered: readonly Candidate[]): Candidate | null {
  if (dest === 'new-rfq') return null
  if (dest === 'answer') return ordered.find(c => c.open.length > 0) ?? null
  return ordered[0] ?? null
}

/** Questions ticked at the start: a text answers all open questions (untick the ones it does not); a photo alone answers the first. */
export function defaultTicks(kind: PayloadKind, open: readonly OpenQuestion[]): string[] {
  if (open.length === 0) return []
  return kind === 'files' ? [open[0].id] : open.map(q => q.id)
}

export interface Availability {
  ok: boolean
  /** Why a destination cannot be used yet, in the words the tile shows. */
  reason?: string
}

export function availability(dest: Dest, kind: PayloadKind, rfq: Candidate | null): Availability {
  if (kind === 'empty') return { ok: false, reason: 'Add something first' }
  const hasText = kind === 'text' || kind === 'both'
  switch (dest) {
    case 'answer':
      return rfq && rfq.open.length === 0 ? { ok: false, reason: 'This RFQ has no open questions' } : { ok: true }
    case 'questions':
      return hasText ? { ok: true } : { ok: false, reason: 'Needs text' }
    case 'reply':
      return hasText ? { ok: true } : { ok: false, reason: 'Needs text' }
    default:
      return { ok: true }
  }
}

export interface SaveLabelInput {
  dest: Dest
  kind: PayloadKind
  ticked: number
  questionLines: number
}

/** The primary button's words. They say what happens ("Save answer to 2 questions"), and the toast after it says the same thing. */
export function saveLabel({ dest, kind, ticked, questionLines }: SaveLabelInput): string {
  const q = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`
  switch (dest) {
    case 'answer':
      return kind === 'files' ? (ticked > 1 ? `Save photo as the answer to ${q(ticked)}` : 'Save photo as the answer') : ticked === 1 ? 'Save answer to 1 question' : `Save answer to ${q(ticked)}`
    case 'questions':
      return `Add ${q(questionLines)}`
    case 'notes':
      return 'Add to notes'
    case 'new-rfq':
      return 'Continue to intake'
    case 'reply':
      return 'Read the reply'
  }
}

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

/** The sentence under "Saved to RFQ-0177". */
export function savedSummary(dest: Dest, n: { questions: number; photos: number }): string {
  const q = (k: number) => `${k} ${k === 1 ? 'question' : 'questions'}`
  const photos = n.photos > 0 ? ` and ${n.photos} ${n.photos === 1 ? 'photo' : 'photos'} attached` : ''
  switch (dest) {
    case 'answer':
      return `${q(n.questions)} answered${photos}.`
    case 'questions':
      return `${q(n.questions)} added${photos}.`
    default:
      return `Added to the notes${photos}.`
  }
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

/** The short form of a question for the line under the RFQ list: "line size and flange rating". Cut at the first detail clause. */
export function shortQuestion(q: string): string {
  const cut = q.split(/\s+(?:on|for|at|in|of)\s+the\s+|,\s+(?:and|or)\s+|\s+\(|[?.:;]\s/i)[0].trim()
  const s = cut.length > 48 ? `${cut.slice(0, 47).trimEnd()}…` : cut
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s
}

/** "Sat 21 Nov" in Karachi time. */
export function shortDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`
}
