import { formatDay } from '@/lib/formatDay'

/*
 * The RFQ board's pure rules (R06): what is sorted first, what the filters keep, how a due date reads.
 * Everything here works on BoardRow, a plain view-model built from v_rfq_state in api.ts, so it is
 * testable without a database or a DOM. Status values are never decided here: the row carries the
 * view's own words and StatusBadge resolves them through the U05 registry.
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
}

/** The state filter: five choices, because a segmented control holds at most five. */
export type StateFilter = 'all' | 'not-floated' | 'out' | 'covered' | 'no-offer'
export type OwnerFilter = 'mine' | 'all'

export const STATE_FILTERS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: 'all', label: 'All open' },
  { value: 'not-floated', label: 'Not floated' },
  { value: 'out', label: 'Out for offers' },
  { value: 'covered', label: 'Covered' },
  { value: 'no-offer', label: 'No offer' },
]

/** Which filter segment a sourcing state belongs to. "Out for offers" is floated and not yet fully covered. */
export function filterOf(state: SourcingState): Exclude<StateFilter, 'all'> {
  switch (state) {
    case 'not_floated':
      return 'not-floated'
    case 'floated_awaiting':
    case 'partly_covered':
      return 'out'
    case 'covered':
      return 'covered'
    case 'no_offer_anywhere':
      return 'no-offer'
  }
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

export function applyState(rows: readonly BoardRow[], state: StateFilter): BoardRow[] {
  return state === 'all' ? [...rows] : rows.filter(r => filterOf(r.sourcingState) === state)
}

export function stateCounts(rows: readonly BoardRow[]): Record<StateFilter, number> {
  const out: Record<StateFilter, number> = { all: rows.length, 'not-floated': 0, out: 0, covered: 0, 'no-offer': 0 }
  for (const r of rows) out[filterOf(r.sourcingState)]++
  return out
}

/** Mine is the default for sales, who own their RFQs. Admin and engineers look across the whole floor. */
export function defaultOwner(role: string): OwnerFilter {
  return role === 'sales' ? 'mine' : 'all'
}

export interface DueText {
  /** "Thu 26 Nov", or null with no due date. */
  date: string | null
  /** "3 days overdue", "Due today", "in 4 days". */
  hint: string
  tone: 'danger' | 'warning' | 'normal'
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export function dueText(r: Pick<BoardRow, 'dueOn' | 'daysToDue' | 'isOverdue'>): DueText {
  if (!r.dueOn) return { date: null, hint: 'No due date', tone: 'normal' }
  const date = formatDay(r.dueOn)
  const n = r.daysToDue
  if (r.isOverdue) return { date, hint: `${days(Math.abs(n ?? 0))} overdue`, tone: 'danger' }
  if (n === null) return { date, hint: '', tone: 'normal' }
  if (n <= 0) return { date, hint: 'Due today', tone: 'warning' }
  if (n === 1) return { date, hint: 'Due tomorrow', tone: 'warning' }
  return { date, hint: `in ${days(n)}`, tone: 'normal' }
}

/** The mono suffix on the sourcing chip: how many items have a price. Nothing before anything is floated. */
export function sourcingDetail(r: Pick<BoardRow, 'sourcingState' | 'itemsQuoted' | 'itemsTotal' | 'itemsUncovered'>): string | undefined {
  if (r.sourcingState === 'not_floated' || r.sourcingState === 'no_offer_anywhere' || r.itemsTotal === 0) return undefined
  return `${r.itemsQuoted} of ${r.itemsTotal}`
}

/** The mono suffix on the clarification chip: how many questions, and for how long the customer has had them. */
export function clarificationDetail(r: Pick<BoardRow, 'clarificationState' | 'toAsk' | 'waiting' | 'waitingDays' | 'toRelay'>): string | undefined {
  switch (r.clarificationState) {
    case 'to_ask':
      return String(r.toAsk)
    case 'waiting_on_customer':
      return r.waitingDays !== null && r.waitingDays > 0 ? `${r.waiting} · ${r.waitingDays}d` : String(r.waiting)
    case 'answers_to_relay':
      return String(r.toRelay)
    default:
      return undefined
  }
}

export const CLOSE_REASON: Record<string, string> = {
  competitor: 'Lost to a competitor',
  price: 'Price',
  no_reply_to_clarification: 'No reply to our question',
  customer_cancelled: 'Customer cancelled',
  could_not_source: 'Could not source',
  we_were_late: 'We were late',
  other: 'Other reason',
}

export const PAGE_SIZE = 25

/** "Showing 26 to 50 of 61". */
export function pageSummary(page: number, size: number, total: number): string {
  if (total === 0) return 'Nothing to show'
  const from = page * size + 1
  const to = Math.min(total, (page + 1) * size)
  return `Showing ${from} to ${to} of ${total}`
}
