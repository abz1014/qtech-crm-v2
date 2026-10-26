import { paisaToFixed, toPaisa, type Amount } from '@/lib/money'
import { cleanDetail, detailKey, type Category, type CategoryGroup, type ExpenseGroup, type ListedExpense, type PaidVia } from '@/features/money/expenses/model'
import { cashTotals, periodLabel, periodMonths, periodShort, shiftPeriod, type FlowRow, type Period } from '@/features/money/inOut/model'

/*
 * The Expenses report (owner request 2026-10-22: "expense category, expense keeping and expense report are utmost priority"), the
 * pure part. Admin only. A month or a calendar quarter (the In vs out period), read from the expenses themselves, so every
 * figure here is a sum of the entries the drill-down lists. 0087 (redesign phase 1): an expense counts in the month it is FOR
 * (a monthly bill's period: September's salary paid on 5 October is September's), else the month it was paid in:
 *   total      gross (input tax included, every category) of the expenses for the period
 *   kinds      net of input tax per P&L kind, for the period; total = running + order + not a cost + input tax, to the paisa
 *   paid       the same period by the day PAID: the same money out as In vs out (v_month_cash_flow) and the Profit and loss
 *              report's "cash out" (v_month_pnl.cash_out_total); paidKinds equal the P&L lines (running costs = overheads,
 *              order costs = order costs, not a cost = "not in P&L"). The bridge: total - forHerePaidElsewhere + paidForOther = paid
 *   breakdown  group -> category -> detail, each with % of the total, the previous period and the budget (monthly budget x months)
 *   trend      the last 6 months or 4 quarters of money out, from v_month_cash_flow (a closed month answers frozen there)
 * A closed month cannot change (month lock), so its entries add up to its frozen money out; if they ever differ, the difference
 * is its own line ("unexplained"), never hidden. Money is carried as two-decimal strings and added in paisa (bigint).
 */

export const EXPENSE_REPORT_TITLE = 'Expenses'

export interface ReportEntry {
  id: string
  paidOn: string
  /** Gross paid, "1150.00". */
  amount: string
  inputTax: string
  categoryId: string
  paidVia: PaidVia
  /** The Detail field, cleaned ("LEA-1234"); null when none. */
  detail: string | null
  /** Payee or order beside the detail ("Alpenmark Controls GmbH · ORD-0038"), for the drill-down; null when none. */
  who: string | null
  /** 0087: the month it is FOR ("2026-09"): a monthly bill's period, else the month paid. The report groups by this. */
  forMonth: string
}

const fx = (p: bigint) => paisaToFixed(p)
const P = (a: Amount) => toPaisa(a)

/** ListedExpense rows (Expenses api) to report entries. */
export function toEntries(rows: readonly ListedExpense[], labels?: { payees: Record<string, string>; orders: Record<string, string> }): ReportEntry[] {
  return rows.map(r => {
    const who = [r.payeeId ? labels?.payees[r.payeeId] : null, r.orderId ? labels?.orders[r.orderId] : null].filter(Boolean).join(' · ')
    return {
      id: r.id,
      paidOn: r.paidOn,
      amount: fx(P(r.amount)),
      inputTax: fx(P(r.inputTax)),
      categoryId: r.categoryId,
      paidVia: r.paidVia,
      detail: cleanDetail(r.note),
      who: who || null,
      forMonth: r.period ?? r.paidOn.slice(0, 7),
    }
  })
}

/** A change as a share of the earlier amount, one decimal (12.5); null when the earlier amount is 0. */
export function pctChange(now: Amount, before: Amount): number | null {
  const b = P(before)
  if (b === 0n) return null
  return Math.round(Number(((P(now) - b) * 1000n) / b)) / 10
}

/** A part of a whole in percent, one decimal; 0 when the whole is 0. */
export function share(part: Amount, whole: Amount): number {
  const w = P(whole)
  if (w === 0n) return 0
  return Math.round(Number((P(part) * 100000n) / w) / 100) / 10
}

export interface Totals {
  amount: string
  count: number
  cash: string
  cashCount: number
  bank: string
  bankCount: number
  inputTax: string
}

export function totalsOf(entries: readonly ReportEntry[]): Totals {
  let amount = 0n
  let cash = 0n
  let bank = 0n
  let tax = 0n
  let cashCount = 0
  for (const e of entries) {
    amount += P(e.amount)
    tax += P(e.inputTax)
    if (e.paidVia === 'cash') {
      cash += P(e.amount)
      cashCount += 1
    } else bank += P(e.amount)
  }
  return { amount: fx(amount), count: entries.length, cash: fx(cash), cashCount, bank: fx(bank), bankCount: entries.length - cashCount, inputTax: fx(tax) }
}

export interface KindTotals {
  /** Net of input tax: P&L overheads. */
  running: string
  /** Net of input tax: P&L order costs. */
  order: string
  /** Net of input tax: P&L "not in P&L" (drawings, loan repayments). */
  notCost: string
  inputTax: string
}

/** Net cost per P&L kind (the category's kind; an unknown category counts as a running cost, as the database cannot hold one). */
export function kindTotals(entries: readonly ReportEntry[], kindOf: (categoryId: string) => CategoryGroup): KindTotals {
  const net: Record<CategoryGroup, bigint> = { overhead: 0n, order_cost: 0n, non_pnl: 0n }
  let tax = 0n
  for (const e of entries) {
    net[kindOf(e.categoryId)] += P(e.amount) - P(e.inputTax)
    tax += P(e.inputTax)
  }
  return { running: fx(net.overhead), order: fx(net.order_cost), notCost: fx(net.non_pnl), inputTax: fx(tax) }
}

export interface DetailLine {
  key: string
  detail: string | null
  amount: string
  count: number
  /** Share of the category, percent. */
  share: number
}

export interface CategoryLine {
  id: string
  /** Its group's id, or OTHER_GROUP when the group is not known. */
  groupId: string
  name: string
  archived: boolean
  amount: string
  count: number
  prev: string
  /** Share of the period's total, percent. */
  share: number
  /** Monthly budget x months in the period, or null when no budget is set. */
  budget: string | null
  /** The budget left (negative when over), or null. */
  budgetLeft: string | null
  details: DetailLine[]
  /** Newest first. */
  entries: ReportEntry[]
}

export interface GroupLine {
  id: string
  name: string
  kind: CategoryGroup
  amount: string
  count: number
  prev: string
  share: number
  budget: string | null
  categories: CategoryLine[]
}

export interface AcrossDetail {
  key: string
  detail: string
  amount: string
  count: number
  /** The categories it was used with ("Fuel & travel, Vehicle repairs"). */
  categories: string[]
}

export interface TrendBar {
  period: Period
  label: string
  amount: string
  current: boolean
}

export interface ExpenseReportView {
  period: Period
  label: string
  prevLabel: string
  months: number
  total: Totals
  prev: Totals
  /** Signed change against the previous period, and as a percent (null when the previous period is 0). */
  change: string
  changePct: number | null
  kinds: KindTotals
  groups: GroupLine[]
  top: ReportEntry[]
  byDetail: AcrossDetail[]
  trend: TrendBar[]
  /** Closed months in the period (figures frozen), out of `months`. */
  frozenMonths: number
  /** Money out as In vs out has it (v_month_cash_flow) less what the entries paid IN the period: 0 unless a closed month differs from the books. */
  unexplained: string
  /**
   * 0087 for-month. The report counts each expense in the month it is FOR (a monthly bill's period, else the month paid); the cash
   * figures (In vs out, Profit and loss, Money's "paid out") count it in the month PAID. `paid` is the period by the day paid (its
   * total is In vs out's money out and its kinds are the P&L lines). The bridge, to the paisa:
   *   total (for) - forHerePaidElsewhere + paidForOther = paid.amount
   */
  paid: Totals
  paidKinds: KindTotals
  /** Paid in the period for another month (September's salary paid on 5 October, seen from October). */
  paidForOther: string
  /** For the period but paid outside it (September's salary paid on 5 October, seen from September). */
  forHerePaidElsewhere: string
  /** Every category's monthly budget summed, x months; null when no category has one. */
  budget: string | null
}

const byAmountDesc = <T extends { amount: string }>(a: T, b: T) => {
  const d = P(b.amount) - P(a.amount)
  return d > 0n ? 1 : d < 0n ? -1 : 0
}

export interface ReportInput {
  period: Period
  /** Every expense of the period AND of the previous period (more is fine: they are filtered by date). */
  entries: readonly ReportEntry[]
  categories: readonly Category[]
  groups: readonly ExpenseGroup[]
  /** v_month_cash_flow rows (all months), for the trend and the cross-check with In vs out. */
  flows: readonly FlowRow[]
}

/** 0087: in the period by the month it is FOR (the report's basis). */
const inPeriod = (p: Period) => {
  const ms = new Set(periodMonths(p))
  return (e: ReportEntry) => ms.has(e.forMonth)
}
/** In the period by the day PAID (the cash basis of In vs out and Profit and loss). */
const paidInPeriod = (p: Period) => {
  const ms = new Set(periodMonths(p))
  return (e: ReportEntry) => ms.has(e.paidOn.slice(0, 7))
}

export const OTHER_GROUP = 'other'

export function buildExpenseReport({ period, entries, categories, groups, flows }: ReportInput): ExpenseReportView {
  const prevPeriod = shiftPeriod(period, -1)
  const now = entries.filter(inPeriod(period))
  const before = entries.filter(inPeriod(prevPeriod))
  const months = periodMonths(period).length
  const catById = new Map(categories.map(c => [c.id, c]))
  const groupById = new Map(groups.map(g => [g.id, g]))
  const kindOf = (id: string): CategoryGroup => catById.get(id)?.grp ?? 'overhead'
  const total = totalsOf(now)
  const prev = totalsOf(before)

  // ---- category lines (every category with money now or before)
  const ids = new Set([...now.map(e => e.categoryId), ...before.map(e => e.categoryId)])
  const catLines: CategoryLine[] = [...ids].map(id => {
    const c = catById.get(id)
    const mine = now.filter(e => e.categoryId === id)
    const t = totalsOf(mine)
    const p = totalsOf(before.filter(e => e.categoryId === id))
    const dmap = new Map<string, { detail: string | null; amount: bigint; count: number }>()
    for (const e of mine) {
      const k = e.detail ? detailKey(e.detail) : ''
      const d = dmap.get(k) ?? { detail: e.detail, amount: 0n, count: 0 }
      d.amount += P(e.amount)
      d.count += 1
      dmap.set(k, d)
    }
    const details = [...dmap.entries()]
      .map(([key, d]) => ({ key, detail: d.detail, amount: fx(d.amount), count: d.count, share: share(fx(d.amount), t.amount) }))
      .sort((a, b) => byAmountDesc(a, b) || (a.detail === null ? 1 : b.detail === null ? -1 : a.detail.localeCompare(b.detail)))
    const budget = c?.budget ? fx(P(c.budget) * BigInt(months)) : null
    return {
      id,
      groupId: c && groupById.has(c.groupId) ? c.groupId : OTHER_GROUP,
      name: c?.name ?? 'Category removed',
      archived: c ? !c.active : false,
      amount: t.amount,
      count: t.count,
      prev: p.amount,
      share: share(t.amount, total.amount),
      budget,
      budgetLeft: budget === null ? null : fx(P(budget) - P(t.amount)),
      details,
      entries: [...mine].sort((a, b) => (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : byAmountDesc(a, b))),
    }
  })
  // categories with a budget but no money yet still show (so "nothing spent of 3,000" is visible)
  for (const c of categories) {
    if (ids.has(c.id) || !c.budget || !c.active) continue
    const budget = fx(P(c.budget) * BigInt(months))
    catLines.push({
      id: c.id,
      groupId: groupById.has(c.groupId) ? c.groupId : OTHER_GROUP,
      name: c.name,
      archived: false,
      amount: '0.00',
      count: 0,
      prev: '0.00',
      share: 0,
      budget,
      budgetLeft: budget,
      details: [],
      entries: [],
    })
  }

  // ---- group lines, biggest first; inside, categories biggest first
  const gIds = [...new Set(catLines.map(c => c.groupId))]
  const groupLines: GroupLine[] = gIds.map(gid => {
    const g = groupById.get(gid)
    const cats = catLines.filter(c => c.groupId === gid).sort((a, b) => byAmountDesc(a, b) || a.name.localeCompare(b.name))
    const amount = fx(cats.reduce((s, c) => s + P(c.amount), 0n))
    const budgets = cats.filter(c => c.budget !== null)
    return {
      id: gid,
      name: g?.name ?? 'Other',
      kind: g?.kind ?? 'overhead',
      amount,
      count: cats.reduce((s, c) => s + c.count, 0),
      prev: fx(cats.reduce((s, c) => s + P(c.prev), 0n)),
      share: share(amount, total.amount),
      budget: budgets.length ? fx(budgets.reduce((s, c) => s + P(c.budget as string), 0n)) : null,
      categories: cats,
    }
  })
  groupLines.sort((a, b) => byAmountDesc(a, b) || (groupById.get(a.id)?.sort ?? 999) - (groupById.get(b.id)?.sort ?? 999))

  // ---- top 10, and details across categories
  const top = [...now].sort((a, b) => byAmountDesc(a, b) || (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : 0)).slice(0, 10)
  const across = new Map<string, { detail: string; amount: bigint; count: number; cats: Set<string> }>()
  for (const e of now) {
    if (!e.detail) continue
    const k = detailKey(e.detail)
    const d = across.get(k) ?? { detail: e.detail, amount: 0n, count: 0, cats: new Set<string>() }
    d.amount += P(e.amount)
    d.count += 1
    d.cats.add(catById.get(e.categoryId)?.name ?? 'Category removed')
    across.set(k, d)
  }
  const byDetail = [...across.entries()]
    .map(([key, d]) => ({ key, detail: d.detail, amount: fx(d.amount), count: d.count, categories: [...d.cats].sort() }))
    .sort((a, b) => byAmountDesc(a, b) || a.detail.localeCompare(b.detail))

  // ---- trend and the In vs out cross-check
  const n = period.kind === 'month' ? 6 : 4
  const trend = Array.from({ length: n }, (_, i) => shiftPeriod(period, i - n + 1)).map(q => ({
    period: q,
    label: periodShort(q),
    amount: cashTotals(q, flows).out,
    current: q.key === period.key,
  }))
  const cash = cashTotals(period, flows)
  const budgets = categories.filter(c => c.active && c.budget)
  const paidNow = entries.filter(paidInPeriod(period))
  const paid = totalsOf(paidNow)
  const isFor = inPeriod(period)
  const isPaid = paidInPeriod(period)
  return {
    period,
    label: periodLabel(period),
    prevLabel: periodLabel(prevPeriod),
    months,
    total,
    prev,
    change: fx(P(total.amount) - P(prev.amount)),
    changePct: pctChange(total.amount, prev.amount),
    kinds: kindTotals(now, kindOf),
    groups: groupLines,
    top,
    byDetail,
    trend,
    frozenMonths: cash.frozenMonths,
    unexplained: fx(P(cash.out) - P(paid.amount)),
    paid,
    paidKinds: kindTotals(paidNow, kindOf),
    paidForOther: totalsOf(paidNow.filter(e => !isFor(e))).amount,
    forHerePaidElsewhere: totalsOf(now.filter(e => !isPaid(e))).amount,
    budget: budgets.length ? fx(budgets.reduce((s, c) => s + P(c.budget as number), 0n) * BigInt(months)) : null,
  }
}

/** One CSV of the whole report, from the same figures (paisa kept): totals, P&L kinds, groups, categories, details, top 10, trend. */
export function expenseReportCsv(v: ExpenseReportView): { headers: string[]; rows: unknown[][] } {
  const n = (a: Amount) => Number(paisaToFixed(P(a)))
  const rows: unknown[][] = [
    ['Total', v.label, 'Spent (gross, input tax included)', '', v.total.count, n(v.total.amount), n(v.prev.amount), '', ''],
    ['Total', v.label, 'Paid in cash', '', v.total.cashCount, n(v.total.cash), n(v.prev.cash), '', ''],
    ['Total', v.label, 'Paid by bank', '', v.total.bankCount, n(v.total.bank), n(v.prev.bank), '', ''],
    ['Profit and loss', v.label, 'Running costs (overheads), net of input tax', '', '', n(v.kinds.running), '', '', ''],
    ['Profit and loss', v.label, 'Order costs, net of input tax', '', '', n(v.kinds.order), '', '', ''],
    ['Profit and loss', v.label, 'Not a cost (drawings, loan repayments)', '', '', n(v.kinds.notCost), '', '', ''],
    ['Profit and loss', v.label, 'Input tax (claimed back)', '', '', n(v.kinds.inputTax), '', '', ''],
  ]
  // 0087: the bridge from "for the period" to "paid in the period" (In vs out and Profit and loss count by the day paid)
  rows.push(
    ['By the day paid', v.label, 'For this period, paid outside it', '', '', n(v.forHerePaidElsewhere), '', '', ''],
    ['By the day paid', v.label, 'Paid in this period for other months', '', '', n(v.paidForOther), '', '', ''],
    ['By the day paid', v.label, 'Paid in this period (In vs out money out)', '', v.paid.count, n(v.paid.amount), '', '', ''],
  )
  if (P(v.unexplained) !== 0n) rows.push(['Total', v.label, 'Changed after the month was closed', '', '', n(v.unexplained), '', '', ''])
  for (const g of v.groups) {
    rows.push(['Group', v.label, g.name, '', g.count, n(g.amount), n(g.prev), g.share, g.budget === null ? '' : n(g.budget)])
    for (const c of g.categories) {
      rows.push(['Category', v.label, `${g.name} / ${c.name}`, '', c.count, n(c.amount), n(c.prev), c.share, c.budget === null ? '' : n(c.budget)])
      for (const d of c.details) rows.push(['Detail', v.label, `${g.name} / ${c.name}`, d.detail ?? 'No detail', d.count, n(d.amount), '', d.share, ''])
    }
  }
  v.top.forEach((e, i) => rows.push([`Top ${i + 1}`, e.paidOn, e.detail ?? '', e.who ?? '', e.paidVia === 'cash' ? 'Cash' : 'Bank', n(e.amount), '', '', '']))
  for (const t of v.trend) rows.push(['Trend', t.label, 'Spent', '', '', n(t.amount), '', '', ''])
  return {
    headers: ['Section', 'Period', 'Line', 'Detail', 'Count or paid via', 'Amount (PKR)', `Previous: ${v.prevLabel} (PKR)`, '% of total', 'Budget (PKR)'],
    rows,
  }
}

/** The CSV of one category's entries (the drill-down), oldest first. */
export function entriesCsv(name: string, entries: readonly ReportEntry[]): { headers: string[]; rows: unknown[][] } {
  return {
    headers: ['Paid on', 'Category', 'Detail', 'Payee or order', 'Paid via', 'Amount (PKR)', 'Input tax (PKR)'],
    rows: [...entries]
      .sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0))
      .map(e => [e.paidOn, name, e.detail ?? '', e.who ?? '', e.paidVia === 'cash' ? 'Cash' : 'Bank', Number(e.amount), Number(e.inputTax)]),
  }
}
