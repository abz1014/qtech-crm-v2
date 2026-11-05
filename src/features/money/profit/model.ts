import { sumPaisa, toPaisa } from '@/lib/money'
import { shiftMonth } from '@/features/money/expenses/model'
import type { FlowRow, ProfitRow } from '@/features/money/inOut/model'

/*
 * Profitability (owner decision 2026-11-05), the pure part. Two measures of income, never mixed:
 *   Income        what we invoiced in the month, GST left out (v_month_profit.sales_net). The headline.
 *   Cash received what customers paid in the month, GST included (v_month_cash_flow.money_in). Shown beside it.
 * The average is over the last 12 COMPLETE months: the current month is left out, because it is not over. A month with no invoice
 * counts as zero in the average (a quiet month is part of the year). Money is held in paisa (bigint) and added exactly.
 */

export type RangeMonths = 12 | 24

export interface ProfitPoint {
  /** "2026-10" */
  month: string
  /** Invoiced sales net of GST. */
  income: bigint
  /** Customer payments received, GST included. */
  cash: bigint
  /** Order costs matched and overheads. */
  costs: bigint
  /** v_month_profit.profit: income less costs. */
  profit: bigint
  invoices: number
}

/** The `count` complete months before the month of `today` ("2026-11-05"), oldest first. The current month is not one of them. */
export function completeMonths(today: string, count: number): string[] {
  const now = today.slice(0, 7)
  return Array.from({ length: count }, (_, i) => shiftMonth(now, i - count))
}

/** One point per month, in the order given; a month the views have no row for is all zeros. */
export function buildPoints(months: readonly string[], profit: readonly ProfitRow[], flows: readonly FlowRow[]): ProfitPoint[] {
  const p = new Map(profit.map(r => [r.month, r]))
  const f = new Map(flows.map(r => [r.month, r]))
  return months.map(month => {
    const pr = p.get(month)
    const fr = f.get(month)
    return {
      month,
      income: pr ? toPaisa(pr.salesNet) : 0n,
      cash: fr ? toPaisa(fr.moneyIn) : 0n,
      costs: pr ? sumPaisa([pr.orderCostsMatched, pr.overheads]) : 0n,
      profit: pr ? toPaisa(pr.profit) : 0n,
      invoices: pr?.invoices ?? 0,
    }
  })
}

/** Sum over the points. */
export function sumOf(points: readonly ProfitPoint[], field: 'income' | 'cash' | 'costs' | 'profit'): bigint {
  return sumPaisa(points.map(x => x[field]))
}

/** The monthly average of a field over the points, rounded half away from zero to a whole paisa. Zero for no points. */
export function averageOf(points: readonly ProfitPoint[], field: 'income' | 'cash' | 'costs' | 'profit'): bigint {
  if (points.length === 0) return 0n
  const total = sumOf(points, field)
  const n = BigInt(points.length)
  const neg = total < 0n
  const abs = neg ? -total : total
  const q = (abs * 2n + n) / (n * 2n)
  return neg ? -q : q
}

/** Paisa as a plain number of rupees, for drawing only (never for adding). */
export const rupeesOf = (p: bigint): number => Number(p) / 100

/** "Nov 2025": the short label of a month key, for the chart and the table. */
export function shortMonth(key: string): string {
  const [y, m] = key.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`
}

/** The span in words: "Nov 2025 to Oct 2026". */
export function spanLabel(months: readonly string[]): string {
  return months.length === 0 ? '' : `${shortMonth(months[0])} to ${shortMonth(months[months.length - 1])}`
}

/** The month with the highest income, for the chart's one-sentence summary; null when every month is zero. */
export function bestMonth(points: readonly ProfitPoint[]): ProfitPoint | null {
  let best: ProfitPoint | null = null
  for (const x of points) if (x.income > (best?.income ?? 0n)) best = x
  return best
}
