/*
 * Payments in and receivables (M02): the pure rules. Balance is gross, GST included (DATA_MODEL 2.17): customers pay the full
 * invoice amount and deduct nothing. "Settled" is computed against gross by order_receivables(), with a Rs 1 allowance.
 */
export type PaymentState = 'unpaid' | 'part' | 'settled' | 'overdue'

export interface ReceivableRow {
  orderId: string
  orderNumber: number
  companyId: string
  companyName: string
  ownerId: string | null
  /** Invoice numbers on the order, oldest first. Empty: not invoiced yet (the figures come from the order's lines). */
  invoiceNumbers: string[]
  gross: number
  settled: number
  balance: number
  overpaidBy: number
  dueOn: string | null
  isOverdue: boolean
  state: PaymentState
  lastRemindedOn: string | null
  reminderCount: number
}

export const isInvoiced = (r: ReceivableRow): boolean => r.invoiceNumbers.length > 0
export const isOpen = (r: ReceivableRow): boolean => r.state !== 'settled'

export type ReceivableFilter = 'open' | 'overdue' | 'settled'

export function filterReceivables(rows: readonly ReceivableRow[], f: ReceivableFilter): ReceivableRow[] {
  return rows.filter(r => (f === 'open' ? isOpen(r) : f === 'overdue' ? r.state === 'overdue' : r.state === 'settled'))
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Open orders first by due date; an order with no due date (not invoiced yet) last; settled orders after them. */
export function sortReceivables(rows: readonly ReceivableRow[]): ReceivableRow[] {
  const rank = (r: ReceivableRow) => (r.state === 'settled' ? 1 : 0)
  return rows.slice().sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn) || a.orderNumber - b.orderNumber
    if (a.dueOn) return -1
    if (b.dueOn) return 1
    return a.orderNumber - b.orderNumber
  })
}

export interface ReceivableTotals {
  openCount: number
  outstanding: number
  overdueCount: number
  overdue: number
  /** Overdue and not reminded in the last 7 days. */
  reminderDueCount: number
  notYetDueCount: number
  notYetDue: number
  notInvoicedCount: number
  notInvoiced: number
  gross: number
  settled: number
}

/** A reminder is due when the order is overdue and has not been reminded in the last 7 days (M09; Today shows the same rule). */
export function reminderDue(r: ReceivableRow, today: string): boolean {
  return r.state === 'overdue' && (r.lastRemindedOn === null || daysBetween(r.lastRemindedOn, today) >= 7)
}

export function receivableTotals(rows: readonly ReceivableRow[], today: string): ReceivableTotals {
  const open = rows.filter(isOpen)
  const overdue = open.filter(r => r.state === 'overdue')
  const notInvoiced = open.filter(r => !isInvoiced(r))
  const notYetDue = open.filter(r => isInvoiced(r) && r.state !== 'overdue')
  const sum = (l: readonly ReceivableRow[], k: 'balance' | 'gross' | 'settled') => round2(l.reduce((s, r) => s + r[k], 0))
  return {
    openCount: open.length,
    outstanding: sum(open, 'balance'),
    overdueCount: overdue.length,
    overdue: sum(overdue, 'balance'),
    reminderDueCount: overdue.filter(r => reminderDue(r, today)).length,
    notYetDueCount: notYetDue.length,
    notYetDue: sum(notYetDue, 'balance'),
    notInvoicedCount: notInvoiced.length,
    notInvoiced: sum(notInvoiced, 'balance'),
    gross: sum(open, 'gross'),
    settled: sum(open, 'settled'),
  }
}

/** "both due a reminder", "1 due a reminder", "none due a reminder". */
export function reminderPhrase(overdueCount: number, dueCount: number): string {
  if (overdueCount === 0) return 'Nothing overdue'
  if (dueCount === 0) return 'none due a reminder'
  if (dueCount === overdueCount) return overdueCount === 1 ? 'due a reminder' : overdueCount === 2 ? 'both due a reminder' : 'all due a reminder'
  return `${dueCount} due a reminder`
}

// ------------------------------------------------------------------ the record-payment dialog

export interface PriorPayment {
  receivedOn: string
  amount: number
}

export interface PaymentFacts {
  gross: number
  settled: number
  balance: number
  invoiced: boolean
  prior: readonly PriorPayment[]
}

/** The amount the dialog opens with: the balance due (empty when nothing is due). */
export const defaultPaymentAmount = (f: Pick<PaymentFacts, 'balance'>): number | null => (f.balance > 0 ? f.balance : null)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export type PaymentKind = 'settles' | 'part' | 'over' | 'none'

export interface PaymentNote {
  kind: PaymentKind
  text: string
}

/**
 * The sentence in the grey box under the amount. It says what saving does: this settles the order, a part payment (and what
 * stays due), or more than is due. Within Rs 1 of the balance counts as settling it, as the database does.
 */
export function paymentNote(f: PaymentFacts, amount: number | null): PaymentNote {
  if (amount === null || !(amount > 0)) return { kind: 'none', text: 'Type the amount received.' }
  const after = f.balance - amount
  const priorText =
    f.prior.length === 0
      ? ''
      : f.prior.length === 1
        ? `, after the ${f.invoiced ? 'payment' : 'advance'} of ${fmt(f.prior[0].amount)} on ${day(f.prior[0].receivedOn)}`
        : `, after ${f.prior.length} earlier payments of ${fmt(f.prior.reduce((s, p) => s + p.amount, 0))} in all`
  if (after < -1) return { kind: 'over', text: `This is PKR ${fmt(round2(-after))} more than the balance due on this order.` }
  if (after <= 1) return { kind: 'settles', text: `This settles the order: PKR ${fmt(amount)} of ${fmt(f.gross)} gross${priorText}. Type a smaller amount to record a part payment.` }
  return { kind: 'part', text: `A part payment: PKR ${fmt(amount)} of ${fmt(f.gross)} gross${priorText}. PKR ${fmt(round2(after))} will still be due.` }
}
