import { monthLabel } from '@/features/money/expenses/model'
import type { FlowRow, ProfitRow } from '@/features/money/inOut/model'
import type { RawPnl } from '@/features/money/monthEnd/model'
import type { ReceivableTotals } from '@/features/money/payments/model'

/*
 * Money home (redesign P6-A, plan section (f)): four plain numbers for the month so far, cash kept apart from profit.
 *   To collect         what customers still owe, with the late part (a payment past its due date) in red
 *   Received           customer payments of this month, GST included (In vs out's money in)
 *   Paid out           expenses and supplier payments by the day paid (In vs out's money out)
 *   We owe suppliers   supplier orders not fully paid, in rupees at the rate of the day (the We owe suppliers report)
 * Then one sentence that says the cash is not profit (how much of what came in is GST owed to FBR), the profit of the last
 * finished month one click away, and the cash-in-hand line. Pure: no React, no database. The CRM works out no sell price here;
 * every figure is read from a view or function that already has it.
 */
export interface MoneyHomeInput {
  today: string
  summary: Pick<ReceivableTotals, 'outstanding' | 'overdue' | 'overdueCount'> | null
  flows: readonly FlowRow[] | null
  pnl: Readonly<Record<string, Pick<RawPnl, 'gstIn'>>> | null
  profits: readonly ProfitRow[] | null
  /** The We owe suppliers total and how many supplier orders make it. */
  owed: { total: string; count: number } | null
}

export interface MoneyHomeFigures {
  monthKey: string
  /** "October" */
  monthName: string
  toCollect: { total: number; late: number; lateCount: number } | null
  received: { total: string; count: number } | null
  paidOut: { total: string; count: number } | null
  owed: { total: string; count: number } | null
  /** GST inside what came in this month (v_month_pnl.gst_in): the part that is FBR's, not ours. */
  gstShare: string | null
  /** The last finished month that has invoices, for the Profit line. */
  profit: { monthKey: string; monthName: string; amount: string } | null
}

const nameOf = (key: string): string => monthLabel(`${key}-01`).split(' ')[0]

export function moneyHomeFigures(i: MoneyHomeInput): MoneyHomeFigures {
  const monthKey = i.today.slice(0, 7)
  const flow = i.flows?.find(f => f.month === monthKey) ?? null
  // a month with no row yet has had no money in or out: zero, not "loading"
  const received = i.flows ? { total: flow?.moneyIn ?? '0.00', count: flow?.payments ?? 0 } : null
  const paidOut = i.flows ? { total: flow?.moneyOut ?? '0.00', count: flow?.expenses ?? 0 } : null
  const finished = [...(i.profits ?? [])].filter(p => p.month < monthKey && p.invoices > 0).sort((a, b) => (a.month < b.month ? 1 : -1))[0]
  return {
    monthKey,
    monthName: nameOf(monthKey),
    toCollect: i.summary ? { total: i.summary.outstanding, late: i.summary.overdue, lateCount: i.summary.overdueCount } : null,
    received,
    paidOut,
    owed: i.owed,
    gstShare: i.pnl ? (i.pnl[monthKey]?.gstIn ?? '0.00') : null,
    profit: finished ? { monthKey: finished.month, monthName: nameOf(finished.month), amount: finished.profit } : null,
  }
}

/** "3 invoices" / "1 invoice": an order counts once, as the receivables do (one row a customer order). */
export const countWord = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Accounts: the monthly work, one level down. Plain words; nothing here is counted as a task. */
export const ACCOUNTS_LINKS: readonly { to: string; label: string; hint: string }[] = [
  { to: '/money/gst-register', label: 'Invoices', hint: 'Sales-tax invoices: print, post' },
  { to: '/money/accounts/gst', label: 'GST to FBR', hint: 'What to pay and what is paid' },
  { to: '/money/month-end/bank', label: 'Bank check', hint: "Tick this month's bank lines" },
  { to: '/money/month-end', label: 'Lock a month', hint: 'Lock a month when it is checked' },
  { to: '/money/expenses', label: 'Monthly bills', hint: 'Salaries, rent, internet' },
  { to: '/money/reports', label: 'Reports', hint: 'Profit, expenses, late payments' },
  { to: '/settings/categories', label: 'Expense categories', hint: 'Groups, categories, budgets' },
]
