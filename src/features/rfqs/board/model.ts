import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { STATUS, type StepTone } from '@/lib/status'
import { daysOverdue, dueWord } from '@/lib/timeWords'

/*
 * The RFQ board's pure rules (R06, then the UX audit of 2026-10-19): what is sorted first, what the one filter keeps, how a due
 * date and the next step read. Everything here works on BoardRow, a plain view-model built from v_rfq_state in api.ts, so it is
 * testable without a database or a DOM.
 */
export type SourcingState = 'not_floated' | 'floated_awaiting' | 'partly_covered' | 'covered' | 'no_offer_anywhere'
export type ClarificationState = 'none' | 'to_ask' | 'waiting_on_customer' | 'answers_to_relay'
export type BidState = 'to_bid' | 'bid_sent' | 'quotation_expired'
export type Outcome = 'open' | 'won' | 'closed'

export interface BoardRow {
  rfqId: string
  number: number
  companyId: string
  companyName: string
  customerRef: string | null
  /** The first item's description: what the customer asked for. Null while unknown or with no items. */
  firstItem: string | null
  ownerId: string | null
  ownerName: string | null
  receivedOn: string
  dueOn: string | null
  isPriority: boolean
  daysToDue: number | null
  isOverdue: boolean
  outcome: Outcome
  closeReason: string | null
  sourcingState: SourcingState
  itemsTotal: number
  itemsQuoted: number
  itemsUncovered: number
  floated: number
  clarificationState: ClarificationState
  toAsk: number
  waiting: number
  waitingDays: number | null
  toRelay: number
  bidState: BidState
  /** When the quotation was sent (rfqs.quoted_on), for "Sent Thu 26 Nov". */
  quotedOn: string | null
  /** Closed list only: the day it was closed (rfqs.closed_on), or for a won RFQ the day its order was placed. */
  closedOn?: string | null
  /** Closed list only: the live order a won RFQ became, for "Won → ORD-0012". */
  wonOrder?: { id: string; number: number } | null
}

/*
 * The next step (owner decision 2026-10-19, step 2): one plain phrase for where an open RFQ stands, worked out from the view's
 * sourcing and quotation dimensions. It drives the board's one filter and its "Next step" column; the detailed state stays on the
 * RFQ page. Every open RFQ lands in exactly one step, so the counts add up.
 *   suppliers  nobody asked yet, or every supplier asked said they cannot offer
 *   prices     asked, and not every item has a price yet
 *   ready      every item has at least one price: the quotation can go
 *   sent       the quotation is sent (also when it has expired)
 */
export type NextStep = 'suppliers' | 'prices' | 'ready' | 'sent'
/** The board's one filter: all open RFQs, one next step, or the won and closed ones. */
export type BoardShow = 'all' | NextStep | 'closed'
export type OwnerFilter = 'mine' | 'all'

/** The step words are the registry's `rfq-stage` labels (DESIGN_SYSTEM section 6), so the board, the RFQ header and Today agree. */
export const NEXT_STEP_LABEL: Record<NextStep, string> = {
  suppliers: STATUS['rfq-stage'].suppliers.label,
  prices: STATUS['rfq-stage'].prices.label,
  ready: STATUS['rfq-stage'].ready.label,
  sent: STATUS['rfq-stage'].sent.label,
}

export const SHOW_OPTIONS: ReadonlyArray<{ value: BoardShow; label: string }> = [
  { value: 'all', label: 'All open' },
  { value: 'suppliers', label: NEXT_STEP_LABEL.suppliers },
  { value: 'prices', label: NEXT_STEP_LABEL.prices },
  { value: 'ready', label: NEXT_STEP_LABEL.ready },
  { value: 'sent', label: NEXT_STEP_LABEL.sent },
  { value: 'closed', label: 'Closed' },
]

export function isBoardShow(v: string | null): v is BoardShow {
  return SHOW_OPTIONS.some(o => o.value === v)
}

export function nextStepOf(r: Pick<BoardRow, 'sourcingState' | 'bidState'>): NextStep {
  if (r.bidState !== 'to_bid') return 'sent'
  switch (r.sourcingState) {
    case 'not_floated':
    case 'no_offer_anywhere':
      return 'suppliers'
    case 'covered':
      return 'ready'
    case 'floated_awaiting':
    case 'partly_covered':
      return 'prices'
  }
}

export interface NextStepText {
  step: NextStep
  label: string
  /** One short line under the label: what is behind it, in plain words. */
  detail: string
  /** Who acts next (StatusText): we do (suppliers, ready, expired) or someone else does (prices, sent). */
  tone: Extract<StepTone, 'now' | 'waiting' | 'done' | 'late'>
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the customer still owes us, or we owe them, when anything: added to the detail line. */
function questionsNote(r: Pick<BoardRow, 'clarificationState' | 'toAsk' | 'waiting' | 'toRelay'>): string | null {
  switch (r.clarificationState) {
    case 'to_ask':
      return `${count(r.toAsk, 'question', 'questions')} to ask the customer`
    case 'waiting_on_customer':
      return `waiting on the customer for ${count(r.waiting, 'answer', 'answers')}`
    case 'answers_to_relay':
      return `${count(r.toRelay, 'answer', 'answers')} to pass on to suppliers`
    default:
      return null
  }
}

type StepInput = Pick<BoardRow, 'sourcingState' | 'bidState' | 'itemsTotal' | 'itemsQuoted' | 'floated' | 'clarificationState' | 'toAsk' | 'waiting' | 'toRelay' | 'quotedOn'>

export function nextStepText(r: StepInput): NextStepText {
  const step = nextStepOf(r)
  const label = NEXT_STEP_LABEL[step]
  const q = questionsNote(r)
  const withQ = (base: string) => (q ? `${base} · ${q}` : base)
  switch (step) {
    case 'sent':
      return r.bidState === 'quotation_expired'
        ? { step, label: STATUS['rfq-stage'].expired.label, detail: 'Revise it or mark it won', tone: 'now' }
        : { step, label, detail: r.quotedOn ? `Sent ${formatDay(r.quotedOn)}` : 'Waiting for the customer', tone: 'waiting' }
    case 'suppliers':
      return { step, label, detail: withQ(r.sourcingState === 'no_offer_anywhere' ? 'Every supplier asked said no' : 'Nobody asked yet'), tone: 'now' }
    case 'ready':
      return { step, label, detail: withQ(r.itemsTotal === 1 ? 'The item has a price' : `All ${r.itemsTotal} items have a price`), tone: 'now' }
    case 'prices':
      return {
        step,
        label,
        detail: withQ(r.itemsQuoted > 0 ? `${r.itemsQuoted} of ${r.itemsTotal} items priced` : `Asked ${count(r.floated, 'supplier', 'suppliers')}`),
        tone: 'waiting',
      }
  }
}

/** "Cerabar PMC71 pressure transmitter + 3 more": what the customer asked for, short enough for one line. */
export function askedText(r: Pick<BoardRow, 'firstItem' | 'itemsTotal'>, max = 70): string {
  const first = (r.firstItem ?? '').replace(/\s+/g, ' ').trim()
  if (!first) return r.itemsTotal > 0 ? count(r.itemsTotal, 'item', 'items') : 'No items yet'
  const short = first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
  return r.itemsTotal > 1 ? `${short} + ${r.itemsTotal - 1} more` : short
}

/** Due date first (earliest on top, no date last), then priority RFQs, then the older RFQ number. */
export function compareBoard(a: BoardRow, b: BoardRow): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1
    if (b.dueOn === null) return -1
    return a.dueOn < b.dueOn ? -1 : 1
  }
  if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1
  return a.number - b.number
}

export function sortBoard(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort(compareBoard)
}

export function applyOwner(rows: readonly BoardRow[], owner: OwnerFilter, userId: string | null): BoardRow[] {
  return owner === 'mine' ? rows.filter(r => r.ownerId !== null && r.ownerId === userId) : [...rows]
}

/** Keep the open RFQs at one next step ('all' keeps every one). */
export function applyStep(rows: readonly BoardRow[], step: 'all' | NextStep): BoardRow[] {
  return step === 'all' ? [...rows] : rows.filter(r => nextStepOf(r) === step)
}

/** The filter box: every word must appear in the RFQ number ("RFQ-0177" or "177"), the customer, their reference or what was asked. */
export function applyQuery(rows: readonly BoardRow[], query: string): BoardRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter(r => {
    const hay = `${rfqRef(r.number)} ${r.number} ${r.companyName} ${r.customerRef ?? ''} ${r.firstItem ?? ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

export function stepCounts(rows: readonly BoardRow[]): Record<'all' | NextStep, number> {
  const out: Record<'all' | NextStep, number> = { all: rows.length, suppliers: 0, prices: 0, ready: 0, sent: 0 }
  for (const r of rows) out[nextStepOf(r)]++
  return out
}

/** Mine is the default for sales, who own their RFQs. Admin and engineers look across the whole floor. */
export function defaultOwner(role: string): OwnerFilter {
  return role === 'sales' ? 'mine' : 'all'
}

export interface DueText {
  /** "Thu 26 Nov", or null with no due date. */
  date: string | null
  /** "3 days overdue", "Due today", "Due in 4 days" (timeWords). */
  hint: string
  tone: 'danger' | 'warning' | 'normal'
}

export function dueText(r: Pick<BoardRow, 'dueOn' | 'daysToDue' | 'isOverdue'>): DueText {
  if (!r.dueOn) return { date: null, hint: 'No due date', tone: 'normal' }
  const date = formatDay(r.dueOn)
  const n = r.daysToDue
  if (r.isOverdue) return { date, hint: daysOverdue(n ?? 0), tone: 'danger' }
  if (n === null) return { date, hint: '', tone: 'normal' }
  if (n <= 1) return { date, hint: dueWord(Math.max(0, n)), tone: 'warning' }
  return { date, hint: dueWord(n), tone: 'normal' }
}

/** The closed list's outcome in words (UX audit 2026-10-22, L3): why it was closed, as a sentence, not a grey "Closed" chip. */
export const CLOSE_REASON: Record<string, string> = {
  competitor: 'Lost to a competitor',
  price: 'Lost on price',
  no_reply_to_clarification: 'No reply to our question',
  customer_cancelled: 'Customer cancelled',
  could_not_source: 'Could not source',
  we_were_late: 'We were late',
  other: 'Other reason',
}

/** "Lost on price", "Customer cancelled", or "Won" (the order code is drawn beside it as a link). */
export function outcomeText(r: Pick<BoardRow, 'outcome' | 'closeReason'>): string {
  if (r.outcome === 'won') return 'Won'
  if (r.outcome === 'open') return 'Open'
  return r.closeReason ? (CLOSE_REASON[r.closeReason] ?? 'Other reason') : 'Closed, no reason given'
}

export const PAGE_SIZE = 25

/** "Showing 26 to 50 of 61". */
export function pageSummary(page: number, size: number, total: number): string {
  if (total === 0) return 'Nothing to show'
  const from = page * size + 1
  const to = Math.min(total, (page + 1) * size)
  return `Showing ${from} to ${to} of ${total}`
}

/**
 * The small print under a load error: "Request failed · Fri 27 Nov, 09:41 · reference 4f1c9a".
 * The reference is six hex digits derived from the time and the error text, so the same failure reads
 * the same on screen and in a screenshot someone sends to support.
 */
export function failureReference(at: number, message: string): string {
  let h = 2166136261
  for (const c of `${at}|${message}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

export function failureLine(at: number, message: string): string {
  const when = new Date(at || Date.now())
  const day = formatDay(when.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }))
  const time = when.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false })
  return `Request failed · ${day}, ${time} · reference ${failureReference(at, message)}`
}
