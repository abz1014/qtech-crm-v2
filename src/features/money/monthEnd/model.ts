import { formatPaisa, paisaToFixed, sumPaisa, toPaisa, type Amount } from '@/lib/money'
import { orderRef } from '@/lib/refs'
import { monthEnd, monthKeyLabel, monthKeyShort, shiftMonth } from '@/features/money/expenses/model'
import { isMonthKey } from '@/features/money/bank/model'

/*
 * Month-end (M10), the pure part: the checklist cards, who may close what, and every report's figures and CSV rows.
 * No request is made here. The database has already done the sums (v_month_pnl, v_month_expense_category,
 * aging_as_of, payables_as_of, v_gst_month, v_month_team, month_end_status: migration 0028); this file only arranges
 * them. Money is carried as fixed two-decimal strings and added in paisa, never as floating point.
 */

export { isMonthKey, monthKeyLabel, monthKeyShort, shiftMonth }

const fx = (n: Amount | null | undefined): string => paisaToFixed(toPaisa(n ?? 0))
/** For a CSV cell: a real number, so a negative amount stays a number in Excel. */
export const csvNum = (n: Amount | null | undefined): number => Number(fx(n))
const sum = (xs: Iterable<Amount | null | undefined>): string => paisaToFixed(sumPaisa([...xs].map(x => x ?? 0)))
export const negate = (a: Amount): string => paisaToFixed(-toPaisa(a))

// ------------------------------------------------------------------------------------------------ the month

/** The month the checklist opens on: the one that just ended (the close happens in the first days of the next). */
export function defaultMonthEndMonth(today: string): string {
  return shiftMonth(today.slice(0, 7), -1)
}

/** "6 Nov" style day for the closed list: "Fri 6 Nov, 14:05" is built by the screen from a timestamp. */
export const monthName = (key: string): string => monthKeyLabel(key).split(' ')[0]

// ------------------------------------------------------------------------------------------------ the checklist

export type CheckKey =
  | 'bank_unticked'
  | 'fbr_deposits_unticked'
  | 'uncategorised'
  | 'recurring_not_recorded'
  | 'provisional_margins'
  | 'fbr_pending'
  | 'unresolved_payments'

export interface StatusRow {
  check_key: string
  n: number
}

interface CheckDef {
  key: CheckKey
  label: string
  unit: [one: string, many: string]
  /** The one line under the figure when there are items. */
  has: (month: string) => string
  /** The one line when there are none. */
  none: (month: string) => string
  linkLabel: string
  to: (month: string) => string
  /** What a click on the link opens, for the tap-count tests. */
  glyph: 'landmark' | 'receipt' | 'list-filter' | 'history' | 'hourglass' | 'file-check' | 'circle-dashed'
}

/** The seven checks, in the order of the approved mockup (g2-month-end "Checklist"). */
export const CHECKS: readonly CheckDef[] = [
  {
    key: 'bank_unticked',
    label: 'Bank items not ticked',
    unit: ['item', 'items'],
    has: () => 'Bank payments and expenses dated up to month end with no statement month. Items still in transit are expected.',
    none: () => 'Every bank item is ticked against a statement.',
    linkLabel: 'Open bank tick',
    to: m => `/money/month-end/bank?month=${m}`,
    glyph: 'landmark',
  },
  {
    key: 'fbr_deposits_unticked',
    label: 'FBR deposits not ticked',
    unit: ['invoice', 'invoices'],
    has: () => 'Deposits to FBR with no statement month. One tick covers a whole PSID group.',
    none: () => 'Every FBR deposit is ticked against a statement.',
    linkLabel: 'Tick the PSID group',
    to: m => `/money/month-end/bank?month=${m}`,
    glyph: 'receipt',
  },
  {
    key: 'uncategorised',
    label: 'Uncategorised',
    unit: ['to do', 'to do'],
    has: m => `${monthName(m)} expenses with no clear category, or an order cost with no order.`,
    none: () => 'Every expense has a category, and an order where it needs one.',
    linkLabel: 'Open expenses',
    to: () => '/money/expenses',
    glyph: 'list-filter',
  },
  {
    key: 'recurring_not_recorded',
    label: 'Recurring not recorded',
    unit: ['to do', 'to do'],
    has: m => `Recurring templates with no ${monthName(m)} expense yet.`,
    none: m => `Every recurring template has a ${monthName(m)} expense.`,
    linkLabel: 'Open recurring',
    to: () => '/money/expenses',
    glyph: 'history',
  },
  {
    key: 'provisional_margins',
    label: 'Provisional margins',
    unit: ['order', 'orders'],
    has: m => `Settled by the end of ${monthName(m)}, costs not marked complete.`,
    none: () => 'Every settled order has its costs marked complete.',
    linkLabel: 'Review margins',
    to: () => '/money/margins',
    glyph: 'hourglass',
  },
  {
    key: 'fbr_pending',
    label: 'FBR pending',
    unit: ['invoice', 'invoices'],
    has: m => `Invoices dated up to the end of ${monthName(m)} with no FBR deposit date.`,
    none: () => 'Every invoice has its FBR deposit.',
    linkLabel: 'Open GST register',
    to: () => '/money/gst-register',
    glyph: 'file-check',
  },
  {
    key: 'unresolved_payments',
    label: 'Unresolved payments',
    unit: ['payment', 'payments'],
    has: () => 'Counted in gross but not yet split into net, because the order has no value basis.',
    none: () => 'Every payment is split into net and GST.',
    linkLabel: 'Open receivables',
    to: () => '/money/receivables',
    glyph: 'circle-dashed',
  },
]

/** A piece of a card's data line: plain words, or a figure or reference printed in the mono face. */
export type Fact = string | { mono: string }

/** month_end_check_details (migration 0064): the facts behind each count, by check key. */
export type CheckDetails = Partial<Record<string, Record<string, unknown>>>

export interface CheckCard {
  key: CheckKey
  label: string
  n: number
  unit: string
  clear: boolean
  sub: string
  /** `sub` with its figures marked for the mono face; the card prints this one. */
  parts: Fact[]
  linkLabel: string
  to: string
  glyph: CheckDef['glyph']
}

const pkr = (v: unknown): Fact => ({ mono: `PKR ${formatPaisa(toPaisa(Number(v) || 0))}` })
const num = (v: unknown): number => Number(v) || 0
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const monthWord = (key: unknown): string => (typeof key === 'string' && isMonthKey(key) ? monthName(key) : '')
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
/** "A, B, C" or "A, B, C and 2 more": the first few of `n`. */
function names(shown: Fact[], n: number): Fact[] {
  const out: Fact[] = []
  shown.forEach((s, i) => {
    if (i > 0) out.push(', ')
    out.push(s)
  })
  if (n > shown.length) out.push(` and ${n - shown.length} more`)
  return out
}

/**
 * The data line under a check's figure (g2-month-end "Checklist"): what the count is made of, and where the fix is. Falls back to the
 * fixed definition when the figures are not there (the details did not load), so the card never shows less than it did.
 */
function describe(c: CheckDef, month: string, n: number, d: Record<string, unknown> | undefined): { parts: Fact[]; linkLabel: string; to: string } {
  const base = { linkLabel: c.linkLabel, to: c.to(month) }
  const fallback = { ...base, parts: [n === 0 ? c.none(month) : c.has(month)] as Fact[] }
  if (!d) return fallback
  const name = monthName(month)
  switch (c.key) {
    case 'bank_unticked': {
      if (n === 0) return fallback
      const inN = num(d.in_n)
      const outN = num(d.out_n)
      const prior = num(d.prior_n)
      const first = monthWord(d.prior_first)
      const last = monthWord(d.prior_last)
      const parts: Fact[] = [{ mono: String(inN) }, ' money in (', pkr(d.in_amount), '), ', { mono: String(outN) }, ' money out (', pkr(d.out_amount), ')']
      if (prior > 0 && last) parts.push(', ', { mono: String(prior) }, ` of ${prior === 1 ? 'it' : 'them'} from ${last}${first && first !== last ? ' or earlier' : ''}`)
      parts.push('. Items still in transit are expected.')
      return { ...base, parts }
    }
    case 'fbr_deposits_unticked': {
      if (n === 0) return fallback
      const groups = num(d.groups)
      return {
        linkLabel: plural(groups, 'Tick the PSID group', 'Tick the PSID groups'),
        to: base.to,
        parts: [pkr(d.amount), ' in ', { mono: String(groups) }, plural(groups, ' PSID group', ' PSID groups'), `. One tick covers ${plural(groups, 'the whole group', 'a whole group')}.`],
      }
    }
    case 'uncategorised':
      return n === 0 ? fallback : { ...base, parts: [`${name} expenses with no clear category, or an order cost with no order: `, pkr(d.amount), '.'] }
    case 'recurring_not_recorded': {
      const total = num(d.total)
      if (n === 0) return total > 0 ? { ...base, parts: ['All ', { mono: String(total) }, ` recurring ${plural(total, 'template has', 'templates have')} ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name} expense.`] } : fallback
      const labels = list(d.names).map(String)
      return { ...base, parts: [`No ${name} expense yet for `, ...names(labels, n), '.'] }
    }
    case 'provisional_margins': {
      if (n === 0) return fallback
      const [y, m] = month.split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const shown: Fact[] = list(d.numbers).map(x => ({ mono: orderRef(num(x)) }))
      return { ...base, parts: [`Settled by ${last} ${name}, costs not marked complete: `, ...names(shown, n), '.'] }
    }
    case 'fbr_pending': {
      if (n === 0) return fallback
      const shown: Fact[] = list(d.invoices).map(x => {
        const row = x as { number?: string | null; month?: string }
        const label = row.number ?? 'invoice'
        const mon = monthWord(row.month)
        return { mono: `${label}${mon ? ` (${mon.slice(0, 3)})` : ''}` }
      })
      return { ...base, parts: [pkr(d.amount), ' GST not deposited: ', ...names(shown, n), '.'] }
    }
    case 'unresolved_payments': {
      if (n === 0) return fallback
      const orders = num(d.orders)
      const first = (d.first ?? {}) as { order_id?: string; order_number?: number; reference?: string | null }
      const ref = first.order_number != null ? orderRef(first.order_number) : null
      const parts: Fact[] = [pkr(d.amount), ` counts in gross but ${n === 1 ? 'is' : 'are'} not split into net.`]
      if (ref) {
        parts.push(' ', { mono: ref })
        if (orders > 1) parts.push(` and ${orders - 1} more`)
        else if (first.reference) parts.push(', ', { mono: first.reference })
        parts.push('.')
      }
      return orders === 1 && first.order_id && ref ? { linkLabel: `Open ${ref}`, to: `/orders/${first.order_id}`, parts } : { ...base, parts }
    }
  }
}

const plain = (parts: readonly Fact[]): string => parts.map(p => (typeof p === 'string' ? p : p.mono)).join('')

export function buildChecklist(rows: readonly StatusRow[], month: string, details?: CheckDetails): CheckCard[] {
  const by = new Map(rows.map(r => [r.check_key, Number(r.n) || 0]))
  return CHECKS.map(c => {
    const n = by.get(c.key) ?? 0
    const detail = details?.[c.key]
    const described = describe(c, month, n, detail)
    // A month closed before migration 0076 has no frozen details: its count is frozen but the figures under it are today's.
    const line = detail?.live === true && n > 0 ? { ...described, parts: [...described.parts, ' (live figures, not frozen at close)'] } : described
    return {
      key: c.key,
      label: c.label,
      n,
      unit: n === 1 ? c.unit[0] : c.unit[1],
      clear: n === 0,
      sub: plain(line.parts),
      parts: line.parts,
      linkLabel: line.linkLabel,
      to: line.to,
      glyph: c.glyph,
    }
  })
}

export const checksWithItems = (cards: readonly CheckCard[]): number => cards.filter(c => !c.clear).length

// ------------------------------------------------------------------------------------------------ closing

export interface ClosedMonth {
  /** "2026-09" */
  key: string
  closedAt: string
  closedBy: string | null
  note: string | null
}

export type CloseState =
  /** The month is closed. */
  | { kind: 'closed' }
  /** The month is the current month or later: the database refuses, so the button waits. */
  | { kind: 'not-ended' }
  /** An earlier month with money in it is still open: the button reads "Close through", one tap for all of them. */
  | { kind: 'open'; through: boolean; earlier: string[] }

/**
 * Whether a month can be closed now. `moneyMonths` are the months that have any payment or expense (the months of
 * v_month_pnl); the database refuses a close while an earlier one of those is still open (0027).
 */
export function closeState(month: string, today: string, closed: ReadonlySet<string>, moneyMonths: readonly string[]): CloseState {
  if (closed.has(month)) return { kind: 'closed' }
  if (month >= today.slice(0, 7)) return { kind: 'not-ended' }
  const earlier = moneyMonths.filter(m => m < month && !closed.has(m)).sort()
  return { kind: 'open', through: earlier.length > 0, earlier }
}

export function closeButtonLabel(month: string, state: CloseState): string {
  const name = monthName(month)
  return state.kind === 'open' && state.through ? `Close through ${name}` : `Close ${name}`
}

/** "Closed through September" for the closed list header: the latest closed month. */
export function closedThrough(closed: readonly ClosedMonth[]): string | null {
  return closed.length ? monthName(closed.map(c => c.key).sort().at(-1) as string) : null
}

// ------------------------------------------------------------------------------------------------ P&L

export interface RawPnl {
  netIn: string
  gstIn: string
  unresolvedGross: string
  orderCosts: string
  overheads: string
  result: string
  nonPnlOut: string
  afterDrawings: string
  cashOutTotal: string
  inputTax: string
  /**
   * Changes to closed months shown in this month (owner decision 2026-10-19: a closed month is frozen; a later change that would
   * move it lands here): their effect on the result, and on Not in P&L. Included in result and afterDrawings. Absent: none.
   */
  adjustResult?: string
  adjustNonPnl?: string
  /** When the month was closed and its figures frozen; null or absent for an open month. */
  frozenAt?: string | null
}

/** One month's payments as the P&L's "money in" lines count them. */
export interface PaymentStats {
  /** Every payment received in the month. */
  count: number
  /** Payments with no net split (basis unknown, or the order has no value). */
  unresolved: { orderRef: string | null; amount: string; reference: string | null }[]
}

export interface CategoryLine {
  categoryId: string
  category: string
  grp: 'overhead' | 'order_cost' | 'non_pnl'
  sort: number
  count: number
  gross: string
  net: string
  /** gross less net: the input tax taken out of the cost. */
  inputTax: string
  paidVia: 'bank' | 'cash'
}

/** A line under a category in the report: its payees or, with none, what its expenses were described as, the commonest three. */
export function categoryNotes(rows: readonly { categoryId: string; label: string | null }[]): Record<string, string> {
  const by = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const label = r.label?.trim()
    if (!label) continue
    const m = by.get(r.categoryId) ?? new Map<string, number>()
    m.set(label, (m.get(label) ?? 0) + 1)
    by.set(r.categoryId, m)
  }
  return Object.fromEntries(
    [...by].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([l]) => l).join(', ')]),
  )
}

export interface ViaStat {
  cashCount: number
  cashAmount: string
  bankCount: number
  bankAmount: string
}

export interface GroupTotal {
  count: number
  gross: string
  net: string
  inputTax: string
}

export const ZERO_PNL: RawPnl = {
  netIn: '0.00',
  gstIn: '0.00',
  unresolvedGross: '0.00',
  orderCosts: '0.00',
  overheads: '0.00',
  result: '0.00',
  nonPnlOut: '0.00',
  afterDrawings: '0.00',
  cashOutTotal: '0.00',
  inputTax: '0.00',
}

const GROUP_ORDER = ['overhead', 'order_cost', 'non_pnl'] as const
export type CategoryGroupKey = (typeof GROUP_ORDER)[number]
export const GROUP_TITLE: Record<CategoryGroupKey, string> = { overhead: 'Overheads', order_cost: 'Order costs', non_pnl: 'Not in P&L' }

export function groupTotal(lines: readonly CategoryLine[], grp: CategoryGroupKey): GroupTotal {
  const mine = lines.filter(l => l.grp === grp)
  return {
    count: mine.reduce((n, l) => n + l.count, 0),
    gross: sum(mine.map(l => l.gross)),
    net: sum(mine.map(l => l.net)),
    inputTax: sum(mine.map(l => l.inputTax)),
  }
}

/** Larger first, for sorting by an amount that may be missing. */
const desc = (a: Amount | null | undefined, b: Amount | null | undefined): number => {
  const d = toPaisa(b ?? 0) - toPaisa(a ?? 0)
  return d > 0n ? 1 : d < 0n ? -1 : 0
}

/** The groups in report order, each with its categories in the Settings order and its total. */
export function groupedCategories(lines: readonly CategoryLine[]): { grp: CategoryGroupKey; title: string; total: GroupTotal; lines: CategoryLine[] }[] {
  return GROUP_ORDER.map(grp => ({
    grp,
    title: GROUP_TITLE[grp],
    total: groupTotal(lines, grp),
    lines: lines.filter(l => l.grp === grp).sort((x, y) => x.sort - y.sort || x.category.localeCompare(y.category)),
  }))
}

/** The widest cost among a group's categories, for the quiet bars ("compares categories inside a group, not a percentage"). */
export function barShare(net: Amount, lines: readonly CategoryLine[]): number {
  const max = lines.reduce((m, l) => (toPaisa(l.net) > m ? toPaisa(l.net) : m), 0n)
  if (max <= 0n) return 0
  const v = toPaisa(net)
  return v <= 0n ? 0 : Number((v * 1000n) / max) / 1000
}

export interface PnlView {
  month: string
  grossReceived: string
  gstIn: string
  unresolvedGross: string
  netIn: string
  orderCosts: GroupTotal
  overheads: GroupTotal
  result: string
  notInPnl: { lines: CategoryLine[]; total: GroupTotal }
  afterDrawings: string
  /** Changes to closed months counted in this month's result (0.00 when none), and in Not in P&L. */
  adjustResult: string
  adjustNonPnl: string
  /** Frozen at close: the figures are the ones saved when the month was closed. */
  frozenAt: string | null
  payments: PaymentStats
  cash: { allPaidCount: number; allPaid: string; inputTax: string } & ViaStat
}

export function buildPnl(month: string, pnl: RawPnl | null, payments: PaymentStats, lines: readonly CategoryLine[], via: ViaStat): PnlView {
  const p = pnl ?? ZERO_PNL
  const gross = sum([p.netIn, p.gstIn, p.unresolvedGross])
  const all = lines.reduce((n, l) => n + l.count, 0)
  return {
    month,
    grossReceived: gross,
    gstIn: p.gstIn,
    unresolvedGross: p.unresolvedGross,
    netIn: p.netIn,
    orderCosts: groupTotal(lines, 'order_cost'),
    overheads: groupTotal(lines, 'overhead'),
    result: p.result,
    notInPnl: { lines: lines.filter(l => l.grp === 'non_pnl'), total: groupTotal(lines, 'non_pnl') },
    afterDrawings: p.afterDrawings,
    adjustResult: p.adjustResult ?? '0.00',
    adjustNonPnl: p.adjustNonPnl ?? '0.00',
    frozenAt: p.frozenAt ?? null,
    payments,
    cash: { allPaidCount: all, allPaid: p.cashOutTotal, inputTax: p.inputTax, ...via },
  }
}

export const isEmptyMonth = (v: PnlView): boolean => v.payments.count === 0 && v.cash.allPaidCount === 0

/** Rows for the P&L CSV: one table, the same Gross / GST / Net columns for money in and money out (M05). */
export function pnlCsv(v: PnlView): { headers: string[]; rows: unknown[][] } {
  const count = v.payments.count - v.payments.unresolved.length
  const rows: unknown[][] = [
    ['Money in', 'Payments received, split into net and GST', count, csvNum(sum([v.netIn, v.gstIn])), csvNum(v.gstIn), csvNum(v.netIn)],
    [
      'Money in',
      'Payments not yet split (excluded from net)',
      v.payments.unresolved.length,
      csvNum(v.unresolvedGross),
      '',
      '',
    ],
    ['Money in', 'Payments received, all', v.payments.count, csvNum(v.grossReceived), csvNum(v.gstIn), csvNum(v.netIn)],
    ['Money out', 'Order costs', v.orderCosts.count, csvNum(v.orderCosts.gross), csvNum(v.orderCosts.inputTax), csvNum(negate(v.orderCosts.net))],
    ['Money out', 'Overheads', v.overheads.count, csvNum(v.overheads.gross), csvNum(v.overheads.inputTax), csvNum(negate(v.overheads.net))],
    ...(toPaisa(v.adjustResult) !== 0n ? [['Adjustment', 'Changes to closed months, counted this month', '', '', '', csvNum(v.adjustResult)]] : []),
    ['Result', `Result for ${monthKeyLabel(v.month)}`, '', '', '', csvNum(v.result)],
    ...v.notInPnl.lines.map(l => ['Not in P&L', l.category, l.count, csvNum(l.gross), csvNum(l.inputTax), csvNum(negate(l.net))]),
    ...(toPaisa(v.adjustNonPnl) !== 0n ? [['Not in P&L', 'Changes to closed months, counted this month', '', '', '', csvNum(negate(v.adjustNonPnl))]] : []),
    ['Not in P&L', 'Not in P&L, total', v.notInPnl.total.count, csvNum(v.notInPnl.total.gross), csvNum(v.notInPnl.total.inputTax), csvNum(negate(v.notInPnl.total.net))],
    ['After drawings', 'Result less Not in P&L', '', '', '', csvNum(v.afterDrawings)],
  ]
  return { headers: ['Section', 'Line', 'Count', 'Gross', 'GST or input tax', 'Net'], rows }
}

// ------------------------------------------------------------------------------------------------ expenses by category

export interface CategoryView {
  groups: ReturnType<typeof groupedCategories>
  all: GroupTotal
  via: ViaStat
}

export function buildCategories(lines: readonly CategoryLine[], via: ViaStat): CategoryView {
  return {
    groups: groupedCategories(lines),
    all: {
      count: lines.reduce((n, l) => n + l.count, 0),
      gross: sum(lines.map(l => l.gross)),
      net: sum(lines.map(l => l.net)),
      inputTax: sum(lines.map(l => l.inputTax)),
    },
    via,
  }
}

export type ViaFilter = 'all' | 'cash' | 'bank'

export function categoriesCsv(v: CategoryView, month: string, via: ViaFilter): { headers: string[]; rows: unknown[][] } {
  const rows: unknown[][] = []
  for (const g of v.groups) {
    const lines = g.lines.filter(l => via === 'all' || l.paidVia === via)
    if (lines.length === 0) continue
    for (const l of lines) rows.push([monthKeyLabel(month), g.title, l.category, l.paidVia === 'bank' ? 'Bank' : 'Cash', l.count, csvNum(l.gross), csvNum(l.inputTax), csvNum(l.net)])
  }
  return { headers: ['Month', 'Group', 'Category', 'Paid via', 'Count', 'Gross paid', 'Input tax', 'Net cost'], rows }
}

// ------------------------------------------------------------------------------------------------ aging

export interface AgingRow {
  invoiceId: string
  customer: string
  invoiceNumber: string
  orderRef: string | null
  invoiceDate: string
  ageDays: number
  gross: string
  applied: string
  remaining: string
  bucket: '0-30' | '31-60' | '61-90' | '90+'
}

export interface AdvanceRow {
  orderId: string
  orderRef: string | null
  customer: string
  held: string
}

export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]
export const BUCKET_LABEL: Record<AgingBucket, string> = { '0-30': '0 to 30', '31-60': '31 to 60', '61-90': '61 to 90', '90+': '90+' }
export const BUCKET_TITLE: Record<AgingBucket, string> = { '0-30': '0 to 30 days', '31-60': '31 to 60 days', '61-90': '61 to 90 days', '90+': 'Over 90 days' }

export interface AgingView {
  asOf: string
  rows: AgingRow[]
  advances: AdvanceRow[]
  totals: Record<AgingBucket, { amount: string; count: number }>
  gross: string
  applied: string
  outstanding: string
  advanceTotal: string
}

export function buildAging(asOf: string, rows: readonly AgingRow[], advances: readonly AdvanceRow[]): AgingView {
  const sorted = [...rows].sort((a, b) => b.ageDays - a.ageDays || a.invoiceNumber.localeCompare(b.invoiceNumber))
  const totals = Object.fromEntries(
    AGING_BUCKETS.map(b => {
      const mine = sorted.filter(r => r.bucket === b)
      return [b, { amount: sum(mine.map(r => r.remaining)), count: mine.length }]
    }),
  ) as AgingView['totals']
  return {
    asOf,
    rows: sorted,
    advances: [...advances],
    totals,
    gross: sum(sorted.map(r => r.gross)),
    applied: sum(sorted.map(r => r.applied)),
    outstanding: sum(sorted.map(r => r.remaining)),
    advanceTotal: sum(advances.map(a => a.held)),
  }
}

export function agingCsv(v: AgingView): { headers: string[]; rows: unknown[][] } {
  return {
    headers: ['As of', 'Customer', 'Invoice', 'Order', 'Invoice date', 'Days', 'Invoice gross', 'Paid by then', ...AGING_BUCKETS.map(b => BUCKET_LABEL[b])],
    rows: [
      ...v.rows.map(r => [
        v.asOf,
        r.customer,
        r.invoiceNumber,
        r.orderRef ?? '',
        r.invoiceDate,
        r.ageDays,
        csvNum(r.gross),
        csvNum(r.applied),
        ...AGING_BUCKETS.map(b => (r.bucket === b ? csvNum(r.remaining) : '')),
      ]),
      ...v.advances.map(a => [v.asOf, a.customer, 'Advance held, not invoiced yet', a.orderRef ?? '', '', '', '', csvNum(a.held), '', '', '', '']),
    ],
  }
}

// ------------------------------------------------------------------------------------------------ we owe

export interface PayableRow {
  legId: string
  supplier: string
  orderRef: string | null
  /** "leg A" */
  leg: string | null
  currency: string
  committed: string | null
  rate: string | null
  committedPkr: string | null
  paidPkr: string
  owedPkr: string | null
  state: 'settled' | 'owing' | 'unpriced' | 'no_rate'
  flag: string | null
}

export interface PayablesView {
  asOf: string
  rows: PayableRow[]
  owed: string
  owedCount: number
  committed: string
  committedLegs: number
  paid: string
  paidLegs: number
  settledCount: number
  settledLeft: string
  paidOver: string
}

export function buildPayables(asOf: string, rows: readonly PayableRow[]): PayablesView {
  const order = { owing: 0, no_rate: 1, unpriced: 2, settled: 3 } as const
  const sorted = [...rows].sort((a, b) => order[a.state] - order[b.state] || desc(a.owedPkr, b.owedPkr))
  const owing = rows.filter(r => r.state === 'owing')
  const settled = rows.filter(r => r.state === 'settled')
  const priced = rows.filter(r => r.committedPkr !== null)
  // "owed" of a settled leg is clamped at 0, so what is left on it is committed less paid, when that is positive.
  const left = settled.map(r => (r.committedPkr !== null ? toPaisa(r.committedPkr) - toPaisa(r.paidPkr) : 0n)).filter(p => p > 0n)
  const over = rows.filter(r => r.flag === 'overpaid').map(r => toPaisa(r.paidPkr) - toPaisa(r.committedPkr ?? 0))
  return {
    asOf,
    rows: sorted,
    owed: sum(owing.map(r => r.owedPkr)),
    owedCount: owing.length,
    committed: sum(priced.map(r => r.committedPkr)),
    committedLegs: priced.length,
    paid: sum(rows.map(r => r.paidPkr)),
    paidLegs: rows.filter(r => toPaisa(r.paidPkr) > 0n).length,
    settledCount: settled.length,
    settledLeft: paisaToFixed(left.reduce((a, b) => a + b, 0n)),
    paidOver: paisaToFixed(over.filter(p => p > 0n).reduce((a, b) => a + b, 0n)),
  }
}

export const PAYABLE_STATE_LABEL: Record<PayableRow['state'], string> = {
  owing: 'Owed',
  settled: 'Settled (≈)',
  unpriced: 'No price yet',
  no_rate: 'Needs a rate',
}

export function payablesCsv(v: PayablesView): { headers: string[]; rows: unknown[][] } {
  return {
    headers: ['As of', 'Supplier', 'Order', 'Leg', 'Currency', 'Committed', 'Rate', 'Committed, PKR', 'Paid, PKR', 'Owed, PKR (approx.)', 'State'],
    rows: v.rows.map(r => [
      v.asOf,
      r.supplier,
      r.orderRef ?? '',
      r.leg ?? '',
      r.currency,
      r.committed === null ? '' : csvNum(r.committed),
      r.rate === null ? '' : csvNum(r.rate),
      r.committedPkr === null ? '' : csvNum(r.committedPkr),
      csvNum(r.paidPkr),
      r.owedPkr === null ? '' : csvNum(r.owedPkr),
      PAYABLE_STATE_LABEL[r.state] + (r.flag === 'overpaid' ? ' (paid over)' : ''),
    ]),
  }
}

// ------------------------------------------------------------------------------------------------ GST and FBR

export interface GstMonthRow {
  month: string
  invoiceCount: number
  net: string
  gst: string
  psidSets: number
  depositedCount: number
  depositedAmount: string
  toDeposit: string
  /** Admin only; null for anyone else. */
  inputTax: string | null
}

export interface GstView {
  /** Selected month first, then earlier months, newest first, three at most. */
  rows: GstMonthRow[]
  selected: GstMonthRow | null
  total: GstMonthRow
  showInputTax: boolean
}

export function buildGst(month: string, all: readonly GstMonthRow[], showInputTax: boolean): GstView {
  const upTo = all.filter(r => r.month <= month).sort((a, b) => b.month.localeCompare(a.month))
  const rows = upTo.slice(0, 3)
  const selected = rows.find(r => r.month === month) ?? null
  const total: GstMonthRow = {
    month: '',
    invoiceCount: rows.reduce((n, r) => n + r.invoiceCount, 0),
    net: sum(rows.map(r => r.net)),
    gst: sum(rows.map(r => r.gst)),
    psidSets: rows.reduce((n, r) => n + r.psidSets, 0),
    depositedCount: rows.reduce((n, r) => n + r.depositedCount, 0),
    depositedAmount: sum(rows.map(r => r.depositedAmount)),
    toDeposit: sum(rows.map(r => r.toDeposit)),
    inputTax: showInputTax ? sum(rows.map(r => r.inputTax)) : null,
  }
  return { rows, selected, total, showInputTax }
}

export function gstCsv(v: GstView): { headers: string[]; rows: unknown[][] } {
  const headers = ['Invoice month', 'Invoices', 'Net', 'GST', 'PSID sets', 'Deposited (invoices)', 'Deposited, PKR', 'To deposit, PKR']
  if (v.showInputTax) headers.push('Input tax paid')
  return {
    headers,
    rows: v.rows.map(r => {
      const row: unknown[] = [monthKeyLabel(r.month), r.invoiceCount, csvNum(r.net), csvNum(r.gst), r.psidSets, r.depositedCount, csvNum(r.depositedAmount), csvNum(r.toDeposit)]
      if (v.showInputTax) row.push(csvNum(r.inputTax))
      return row
    }),
  }
}

// ------------------------------------------------------------------------------------------------ team

export interface TeamRow {
  userId: string
  name: string
  role: string
  payments: number
  net: string | null
  quarterNet: string | null
  quarterTarget: string | null
}

export interface TeamView {
  rows: TeamRow[]
  credited: string
  creditedPayments: number
  creditedPeople: number
  unresolved: string
  unresolvedCount: number
  quarterToDate: string
  quarter: number
  daysLeft: number
  quarterEnd: string
}

/** Quarter of a month key, and how many days are left in it counting from `today` (never negative). */
export function quarterOf(month: string, today: string): { quarter: number; end: string; daysLeft: number } {
  const [y, m] = month.split('-').map(Number)
  const q = Math.ceil(m / 3)
  const end = monthEnd(`${y}-${String(q * 3).padStart(2, '0')}`)
  const left = Math.round((Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8))) / 86_400_000)
  return { quarter: q, end, daysLeft: Math.max(0, left) }
}

export function buildTeam(
  month: string,
  today: string,
  credited: readonly { userId: string; name: string; payments: number; net: string; quarterNet: string | null; quarterTarget: string | null }[],
  staff: readonly { userId: string; name: string; role: string }[],
  unresolved: PaymentStats['unresolved'],
): TeamView {
  const q = quarterOf(month, today)
  const by = new Map(credited.map(c => [c.userId, c]))
  const rows: TeamRow[] = staff.map(s => {
    const c = by.get(s.userId)
    return {
      userId: s.userId,
      name: s.name,
      role: s.role,
      payments: c?.payments ?? 0,
      net: c ? c.net : null,
      quarterNet: c ? c.quarterNet : null,
      quarterTarget: c ? c.quarterTarget : null,
    }
  })
  // A credited person who is no longer on the staff list still counts, so the total stays tied to the P&L.
  for (const c of credited) {
    if (!staff.some(s => s.userId === c.userId)) rows.push({ userId: c.userId, name: c.name, role: '', payments: c.payments, net: c.net, quarterNet: c.quarterNet, quarterTarget: c.quarterTarget })
  }
  rows.sort((a, b) => desc(a.net, b.net) || a.name.localeCompare(b.name))
  const withNet = rows.filter(r => r.net !== null)
  return {
    rows,
    credited: sum(withNet.map(r => r.net)),
    creditedPayments: rows.reduce((n, r) => n + r.payments, 0),
    creditedPeople: withNet.length,
    unresolved: sum(unresolved.map(u => u.amount)),
    unresolvedCount: unresolved.length,
    quarterToDate: sum(withNet.map(r => r.quarterNet)),
    quarter: q.quarter,
    daysLeft: q.daysLeft,
    quarterEnd: q.end,
  }
}

export function teamCsv(v: TeamView, month: string): { headers: string[]; rows: unknown[][] } {
  return {
    headers: ['Month', 'Person', 'Role', 'Payments', 'Net credited', `Quarter to date (Q${v.quarter})`, `Q${v.quarter} target`],
    rows: v.rows.map(r => [monthKeyLabel(month), r.name, r.role, r.payments, r.net === null ? '' : csvNum(r.net), r.quarterNet === null ? '' : csvNum(r.quarterNet), r.quarterTarget === null ? '' : csvNum(r.quarterTarget)]),
  }
}
