import { paisaToFixed, sumPaisa, toPaisa, type Amount } from '@/lib/money'
import { monthKeyLabel, shiftMonth } from '@/features/money/expenses/model'

/*
 * In vs out (owner request and decision 2026-10-20), the pure part. Two views side by side, as an accountant would show them:
 *   Cash in vs out   the money trail: customer payments by the day received, expenses and supplier payments by the day paid,
 *                    GST and input tax included, voided payments left out (v_month_cash_flow; a closed month answers frozen).
 *   Profit           the invoiced basis: sales by invoice date net of GST, an order's costs counted with its sales, overheads
 *                    when paid (v_month_profit).
 * and the line that explains the gap between them. A quarter is a calendar quarter (DECISIONS 2026-10-13, Q1 is January to
 * March) and is the sum of its three months. Money is carried as two-decimal strings and added in paisa.
 */

/** The report's name, on Reports and on its own page. */
export const IN_OUT_TITLE = 'In vs out'

export type PeriodKind = 'month' | 'quarter'
export interface Period {
  kind: PeriodKind
  /** "2026-10" for a month, "2026-Q4" for a quarter. */
  key: string
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const isPeriodKey = (kind: PeriodKind, key: string | null | undefined): key is string =>
  !!key && (kind === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(key) : /^\d{4}-Q[1-4]$/.test(key))

/** The month or quarter a month key ("2026-11") falls in. */
export function periodOf(kind: PeriodKind, month: string): Period {
  if (kind === 'month') return { kind, key: month }
  const q = Math.ceil(Number(month.slice(5, 7)) / 3)
  return { kind, key: `${month.slice(0, 4)}-Q${q}` }
}

/** The month keys of a period, oldest first. */
export function periodMonths(p: Period): string[] {
  if (p.kind === 'month') return [p.key]
  const y = p.key.slice(0, 4)
  const first = (Number(p.key.slice(6)) - 1) * 3 + 1
  return [0, 1, 2].map(i => `${y}-${String(first + i).padStart(2, '0')}`)
}

export function shiftPeriod(p: Period, by: number): Period {
  const first = periodMonths(p)[0]
  return periodOf(p.kind, shiftMonth(first, p.kind === 'month' ? by : by * 3))
}

/** "October 2026", or "Q4 2026 (Oct to Dec)". */
export function periodLabel(p: Period): string {
  if (p.kind === 'month') return monthKeyLabel(p.key)
  const ms = periodMonths(p)
  return `${p.key.slice(5)} ${p.key.slice(0, 4)} (${MONTH_SHORT[Number(ms[0].slice(5)) - 1]} to ${MONTH_SHORT[Number(ms[2].slice(5)) - 1]})`
}

/** "Oct 2026" or "Q4 2026": the trend table's first column. */
export const periodShort = (p: Period): string => (p.kind === 'month' ? `${MONTH_SHORT[Number(p.key.slice(5)) - 1]} ${p.key.slice(0, 4)}` : `${p.key.slice(5)} ${p.key.slice(0, 4)}`)

/** The period in the address when it is a real one and not in the future; otherwise the current month or quarter. */
export function chosenPeriod(kind: PeriodKind, key: string | null, today: string): Period {
  const now = periodOf(kind, today.slice(0, 7))
  return isPeriodKey(kind, key) && key <= now.key ? { kind, key } : now
}

// ------------------------------------------------------------------------------------------------ the rows the database returns

export interface FlowRow {
  month: string
  moneyIn: string
  payments: number
  moneyOut: string
  expenses: number
  frozen: boolean
}

export interface ProfitRow {
  month: string
  salesNet: string
  salesGst: string
  invoices: number
  orderCostsMatched: string
  overheads: string
  profit: string
  orderCostsPaid: string
  nonPnlPaid: string
  inputTaxPaid: string
}

export interface DetailRow {
  month: string
  categoryId: string
  detail: string | null
  gross: string
  count: number
}

// ------------------------------------------------------------------------------------------------ the figures

const sum = (xs: Iterable<Amount>): string => paisaToFixed(sumPaisa([...xs]))
const minus = (a: Amount, b: Amount): string => paisaToFixed(toPaisa(a) - toPaisa(b))

export interface CashTotals {
  in: string
  out: string
  net: string
  payments: number
  expenses: number
  /** Months of the period that are closed (their figures frozen at close), and how many months it has. */
  frozenMonths: number
  months: number
}

export function cashTotals(p: Period, flows: readonly FlowRow[]): CashTotals {
  const ms = new Set(periodMonths(p))
  const rows = flows.filter(f => ms.has(f.month))
  const inn = sum(rows.map(r => r.moneyIn))
  const out = sum(rows.map(r => r.moneyOut))
  return {
    in: inn,
    out,
    net: minus(inn, out),
    payments: rows.reduce((s, r) => s + r.payments, 0),
    expenses: rows.reduce((s, r) => s + r.expenses, 0),
    frozenMonths: rows.filter(r => r.frozen).length,
    months: ms.size,
  }
}

export interface ProfitTotals {
  sales: string
  salesGst: string
  invoices: number
  orderCosts: string
  overheads: string
  profit: string
  orderCostsPaid: string
  nonPnlPaid: string
  inputTaxPaid: string
}

export function profitTotals(p: Period, profits: readonly ProfitRow[]): ProfitTotals {
  const ms = new Set(periodMonths(p))
  const rows = profits.filter(r => ms.has(r.month))
  const s = (f: (r: ProfitRow) => string) => sum(rows.map(f))
  return {
    sales: s(r => r.salesNet),
    salesGst: s(r => r.salesGst),
    invoices: rows.reduce((n, r) => n + r.invoices, 0),
    orderCosts: s(r => r.orderCostsMatched),
    overheads: s(r => r.overheads),
    profit: s(r => r.profit),
    orderCostsPaid: s(r => r.orderCostsPaid),
    nonPnlPaid: s(r => r.nonPnlPaid),
    inputTaxPaid: s(r => r.inputTaxPaid),
  }
}

/**
 * Why profit and cash differ in a period, line by line (0079 header):
 *   profit - cash net = owedMore - gst + costsAhead + drawingsAndTax + other
 *   owedMore         invoiced (with GST) less cash received: customers now owe us more (+), or paid off earlier invoices (-)
 *   gst              GST inside the invoices: collected for FBR, not ours
 *   costsAhead       supplier costs paid before their sale is invoiced, held for it (+), or matched now from earlier (-)
 *   drawingsAndTax   owner drawings and loan repayments, and input tax: cash out that is not a cost
 *   other            what is left; 0 unless a closed month's frozen cash figure differs from the books
 */
export interface Reconcile {
  gap: string
  owedMore: string
  gst: string
  costsAhead: string
  drawingsAndTax: string
  other: string
}

export function reconcile(cash: CashTotals, profit: ProfitTotals): Reconcile {
  const gap = toPaisa(profit.profit) - toPaisa(cash.net)
  const owedMore = toPaisa(profit.sales) + toPaisa(profit.salesGst) - toPaisa(cash.in)
  const gst = toPaisa(profit.salesGst)
  const costsAhead = toPaisa(profit.orderCostsPaid) - toPaisa(profit.orderCosts)
  const drawingsAndTax = toPaisa(profit.nonPnlPaid) + toPaisa(profit.inputTaxPaid)
  return {
    gap: paisaToFixed(gap),
    owedMore: paisaToFixed(owedMore),
    gst: paisaToFixed(gst),
    costsAhead: paisaToFixed(costsAhead),
    drawingsAndTax: paisaToFixed(drawingsAndTax),
    other: paisaToFixed(gap - (owedMore - gst + costsAhead + drawingsAndTax)),
  }
}

export interface DetailOut {
  detail: string | null
  amount: string
  count: number
}

export interface CategoryOut {
  categoryId: string
  name: string
  amount: string
  count: number
  /** The same category in the previous period. */
  prev: string
  /** Biggest first; an expense with no detail is one line, detail null. */
  details: DetailOut[]
}

const detailKey = (d: string | null) => (d ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Money out of a period by category (biggest first) and, inside each, by detail; with the same category last period. */
export function categoriesOut(p: Period, details: readonly DetailRow[], names: Readonly<Record<string, string>>): CategoryOut[] {
  const cur = new Set(periodMonths(p))
  const prev = new Set(periodMonths(shiftPeriod(p, -1)))
  const by = new Map<string, { amount: bigint; count: number; prev: bigint; details: Map<string, { detail: string | null; amount: bigint; count: number }> }>()
  const entry = (id: string) => {
    let e = by.get(id)
    if (!e) by.set(id, (e = { amount: 0n, count: 0, prev: 0n, details: new Map() }))
    return e
  }
  for (const r of details) {
    if (cur.has(r.month)) {
      const e = entry(r.categoryId)
      e.amount += toPaisa(r.gross)
      e.count += r.count
      const k = detailKey(r.detail)
      const d = e.details.get(k) ?? { detail: r.detail?.trim() || null, amount: 0n, count: 0 }
      d.amount += toPaisa(r.gross)
      d.count += r.count
      e.details.set(k, d)
    } else if (prev.has(r.month)) entry(r.categoryId).prev += toPaisa(r.gross)
  }
  return [...by.entries()]
    .filter(([, e]) => e.count > 0 || e.prev !== 0n)
    .map(([id, e]) => ({
      categoryId: id,
      name: names[id] ?? 'Category removed',
      amount: paisaToFixed(e.amount),
      count: e.count,
      prev: paisaToFixed(e.prev),
      details: [...e.details.values()]
        .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0) || (a.detail === null ? 1 : b.detail === null ? -1 : a.detail.localeCompare(b.detail)))
        .map(d => ({ detail: d.detail, amount: paisaToFixed(d.amount), count: d.count })),
    }))
    .sort((a, b) => Number(toPaisa(b.amount) - toPaisa(a.amount)) || a.name.localeCompare(b.name))
}

export interface TrendRow {
  period: Period
  label: string
  in: string
  out: string
  net: string
  profit: string
}

/** The last 6 months or 4 quarters, ending with the period shown, oldest first. */
export function trend(p: Period, flows: readonly FlowRow[], profits: readonly ProfitRow[]): TrendRow[] {
  const n = p.kind === 'month' ? 6 : 4
  return Array.from({ length: n }, (_, i) => shiftPeriod(p, i - n + 1)).map(q => {
    const c = cashTotals(q, flows)
    return { period: q, label: periodShort(q), in: c.in, out: c.out, net: c.net, profit: profitTotals(q, profits).profit }
  })
}

export interface InOutView {
  period: Period
  label: string
  cash: CashTotals
  prevCash: CashTotals
  profit: ProfitTotals
  prevProfit: ProfitTotals
  reconcile: Reconcile
  categories: CategoryOut[]
  /** Money out less the category lines: 0 unless a closed month's frozen figure differs from the live books. */
  unexplainedOut: string
  trend: TrendRow[]
}

export function buildInOut(
  p: Period,
  flows: readonly FlowRow[],
  profits: readonly ProfitRow[],
  details: readonly DetailRow[],
  names: Readonly<Record<string, string>>,
): InOutView {
  const cash = cashTotals(p, flows)
  const profit = profitTotals(p, profits)
  const categories = categoriesOut(p, details, names)
  return {
    period: p,
    label: periodLabel(p),
    cash,
    prevCash: cashTotals(shiftPeriod(p, -1), flows),
    profit,
    prevProfit: profitTotals(shiftPeriod(p, -1), profits),
    reconcile: reconcile(cash, profit),
    categories,
    unexplainedOut: minus(cash.out, sum(categories.map(c => c.amount))),
    trend: trend(p, flows, profits),
  }
}

/** The change against the previous period, signed ("+1200.00", "-50.00", "0.00"). */
export const change = (now: Amount, before: Amount): string => minus(now, before)

/** One CSV of everything on the page, from the same figures: the totals, the reconciliation, money out by category and detail, the trend. */
export function inOutCsv(v: InOutView): { headers: string[]; rows: unknown[][] } {
  const n = (a: Amount) => Number(paisaToFixed(toPaisa(a)))
  const prevLabel = periodLabel(shiftPeriod(v.period, -1))
  const rows: unknown[][] = [
    ['Cash', v.label, 'Money in (payments received, GST included)', '', v.cash.payments, n(v.cash.in), n(v.prevCash.in)],
    ['Cash', v.label, 'Money out (expenses and supplier payments, input tax included)', '', v.cash.expenses, n(v.cash.out), n(v.prevCash.out)],
    ['Cash', v.label, 'Cash net (in less out)', '', '', n(v.cash.net), n(v.prevCash.net)],
    ['Profit', v.label, 'Sales invoiced, GST taken out', '', v.profit.invoices, n(v.profit.sales), n(v.prevProfit.sales)],
    ['Profit', v.label, 'Order costs counted with their sales', '', '', n(v.profit.orderCosts), n(v.prevProfit.orderCosts)],
    ['Profit', v.label, 'Overheads', '', '', n(v.profit.overheads), n(v.prevProfit.overheads)],
    ['Profit', v.label, 'Profit (invoiced basis)', '', '', n(v.profit.profit), n(v.prevProfit.profit)],
    ['Why they differ', v.label, 'Profit less cash net', '', '', n(v.reconcile.gap), ''],
    ['Why they differ', v.label, 'Customers owe us more (+) or paid off earlier invoices (-)', '', '', n(v.reconcile.owedMore), ''],
    ['Why they differ', v.label, 'less GST in the invoices (for FBR)', '', '', -n(v.reconcile.gst), ''],
    ['Why they differ', v.label, 'Supplier costs paid ahead of their sale (+) or matched now (-)', '', '', n(v.reconcile.costsAhead), ''],
    ['Why they differ', v.label, 'Drawings, loan repayments and input tax (cash out, not cost)', '', '', n(v.reconcile.drawingsAndTax), ''],
    ['Why they differ', v.label, 'Other', '', '', n(v.reconcile.other), ''],
  ]
  for (const c of v.categories) {
    rows.push(['Money out by category', v.label, c.name, '', c.count, n(c.amount), n(c.prev)])
    for (const d of c.details) rows.push(['Money out by detail', v.label, c.name, d.detail ?? 'No detail', d.count, n(d.amount), ''])
  }
  if (toPaisa(v.unexplainedOut) !== 0n) rows.push(['Money out by category', v.label, 'Changed after the month was closed', '', '', n(v.unexplainedOut), ''])
  for (const t of v.trend) rows.push(['Trend', t.label, 'In / out / net / profit', '', '', n(t.net), '', n(t.in), n(t.out), n(t.profit)])
  return {
    headers: ['Section', 'Period', 'Line', 'Detail', 'Count', 'Amount (PKR)', `Previous: ${prevLabel} (PKR)`, 'In (PKR)', 'Out (PKR)', 'Profit (PKR)'],
    rows,
  }
}
