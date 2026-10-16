import { CLOSE_REASONS } from '@/features/rfqs/lib/closeDefaults'

/*
 * Reports (P01): pure shaping of the four report views. The database does the counting; these functions only
 * label, sort and work out the few ratios the screen shows, so each can be checked against a hand count.
 * No report carries money. Nobody types anything for them: they read what the team already recorded.
 */

/** Whole percent, or null when there is nothing to divide by. 1 of 3 is 33. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

export const showPct = (v: number | null): string => (v === null ? 'n/a' : `${v}%`)

// ------------------------------------------------------------------ RFQ outcomes
export interface OutcomeRow {
  outcome: 'won' | 'closed' | 'open'
  closeReason: string | null
  rfqs: number
}

export interface ReasonLine {
  key: string
  label: string
  count: number
  /** Whole percent of the closed RFQs. */
  share: number | null
}

export interface OutcomesSummary {
  total: number
  won: number
  closed: number
  open: number
  /** Won of the RFQs that have an answer (won + closed). Open ones are not counted either way. */
  winRate: number | null
  reasons: ReasonLine[]
}

const reasonLabel = (key: string): string => CLOSE_REASONS.find(r => r.value === key)?.label ?? 'Another reason'

export function summariseOutcomes(rows: readonly OutcomeRow[]): OutcomesSummary {
  const sum = (o: OutcomeRow['outcome']) => rows.filter(r => r.outcome === o).reduce((n, r) => n + r.rfqs, 0)
  const won = sum('won')
  const closed = sum('closed')
  const open = sum('open')
  const byKey = new Map<string, number>()
  for (const r of rows) {
    if (r.outcome !== 'closed') continue
    const key = r.closeReason ?? 'other'
    byKey.set(key, (byKey.get(key) ?? 0) + r.rfqs)
  }
  const reasons = [...byKey.entries()]
    .map(([key, count]) => ({ key, label: reasonLabel(key), count, share: pct(count, closed) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { total: won + closed + open, won, closed, open, winRate: pct(won, won + closed), reasons }
}

// ------------------------------------------------------------------ float coverage and conversion
export interface FloatRow {
  state: string
  rfqs: number
  itemsTotal: number
  itemsQuoted: number
  won: number
  closed: number
  open: number
}

/** In the order the work flows. */
export const FLOAT_STATES = [
  { key: 'not_floated', label: 'Not floated' },
  { key: 'floated_awaiting', label: 'Floated, waiting for prices' },
  { key: 'partly_covered', label: 'Some items priced' },
  { key: 'covered', label: 'Every item priced' },
  { key: 'no_offer_anywhere', label: 'No offer anywhere' },
] as const

export interface FloatLine extends FloatRow {
  label: string
  /** Won of the RFQs in this group that have an answer. */
  winRate: number | null
}

export interface FloatSummary {
  lines: FloatLine[]
  floatedRfqs: number
  floatedItems: number
  floatedItemsQuoted: number
  /** Share of the items on floated RFQs that got at least one supplier price. */
  coverage: number | null
  /** Won of answered RFQs, floated against not floated. */
  floatedWinRate: number | null
  notFloatedWinRate: number | null
}

export function summariseFloat(rows: readonly FloatRow[]): FloatSummary {
  const lines: FloatLine[] = FLOAT_STATES.map(s => {
    const base: FloatRow = rows.find(x => x.state === s.key) ?? {
      state: s.key,
      rfqs: 0,
      itemsTotal: 0,
      itemsQuoted: 0,
      won: 0,
      closed: 0,
      open: 0,
    }
    return { ...base, label: s.label, winRate: pct(base.won, base.won + base.closed) }
  }).filter(l => l.rfqs > 0)
  const floated = lines.filter(l => l.state !== 'not_floated')
  const notFloated = lines.filter(l => l.state === 'not_floated')
  type K = 'rfqs' | 'itemsTotal' | 'itemsQuoted' | 'won' | 'closed'
  const sum = (ls: FloatLine[], k: K) => ls.reduce((n, l) => n + l[k], 0)
  return {
    lines,
    floatedRfqs: sum(floated, 'rfqs'),
    floatedItems: sum(floated, 'itemsTotal'),
    floatedItemsQuoted: sum(floated, 'itemsQuoted'),
    coverage: pct(sum(floated, 'itemsQuoted'), sum(floated, 'itemsTotal')),
    floatedWinRate: pct(sum(floated, 'won'), sum(floated, 'won') + sum(floated, 'closed')),
    notFloatedWinRate: pct(sum(notFloated, 'won'), sum(notFloated, 'won') + sum(notFloated, 'closed')),
  }
}

// ------------------------------------------------------------------ clarification turnaround
export interface TurnaroundRow {
  /** First day of the month, "2026-03-01". */
  month: string
  asked: number
  answered: number
  withdrawn: number
  open: number
  avgDays: number | null
  slowestDays: number | null
  totalDays: number
}

export interface TurnaroundSummary {
  rows: TurnaroundRow[]
  asked: number
  answered: number
  open: number
  /** Days from first asked to answered, over every answered question (not an average of monthly averages). */
  avgDays: number | null
}

export function summariseTurnaround(rows: readonly TurnaroundRow[]): TurnaroundSummary {
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month))
  const answered = sorted.reduce((n, r) => n + r.answered, 0)
  const days = sorted.reduce((n, r) => n + r.totalDays, 0)
  return {
    rows: sorted,
    asked: sorted.reduce((n, r) => n + r.asked, 0),
    answered,
    open: sorted.reduce((n, r) => n + r.open, 0),
    avgDays: answered > 0 ? Math.round((days / answered) * 10) / 10 : null,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-03-01" to "Mar 2026". */
export function monthLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : iso
}

/** 1 day, 3.5 days, 0 days. */
export function daysText(d: number | null): string {
  if (d === null) return 'n/a'
  return `${d} ${d === 1 ? 'day' : 'days'}`
}

// ------------------------------------------------------------------ repeat customers
export interface RepeatRow {
  companyId: string
  name: string
  orders: number
  firstOrderOn: string | null
  lastOrderOn: string | null
  rfqs: number
  isRepeat: boolean
}

export interface RepeatSummary {
  rows: RepeatRow[]
  customers: number
  repeat: number
  share: number | null
}

export function summariseRepeat(rows: readonly RepeatRow[]): RepeatSummary {
  const sorted = [...rows].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name))
  const repeat = sorted.filter(r => r.isRepeat).length
  return { rows: sorted, customers: sorted.length, repeat, share: pct(repeat, sorted.length) }
}
