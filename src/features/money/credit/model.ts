import { formatAmount, paisaToFixed, toPaisa } from '@/lib/money'

/*
 * Customer credit (0117, 0118): the pure rules. No React and no database.
 *
 * A customer's credit balance is what their orders hold above what they are worth (overpayments; a credit note on a paid invoice
 * shows up there too), less what was refunded, less what was put against another order. The database works it out (v_company_credit);
 * these rules only say what the screens offer and how they word it.
 */
export interface CreditSummary {
  overpaid: number
  refunded: number
  applied: number
  balance: number
}

export const NO_CREDIT: CreditSummary = { overpaid: 0, refunded: 0, applied: 0, balance: 0 }

export interface CreditRefund {
  id: string
  refundedOn: string
  amount: number
  paidVia: 'bank' | 'cash'
  reference: string | null
  reason: string | null
  orderId: string | null
}

export interface CreditApplication {
  id: string
  appliedOn: string
  amount: number
  note: string | null
  toOrderId: string
}

/** An order of the customer that still owes money: where credit can go. */
export interface ApplyTarget {
  orderId: string
  orderNumber: number
  balance: number
}

const p = (n: number): bigint => toPaisa(n)

/** The panel shows when there is credit to give out, or there is a history to read. */
export const showCredit = (c: CreditSummary, refunds: number, applications: number): boolean => c.balance > 0 || refunds + applications > 0

/** The most one refund can be: the whole balance. */
export const refundDefault = (c: CreditSummary): number => Math.max(c.balance, 0)

/** The amount an apply starts at: the credit, or what the order owes if that is less. */
export function applyDefault(c: CreditSummary, target: Pick<ApplyTarget, 'balance'> | null): number {
  if (!target) return Math.max(c.balance, 0)
  return Number(paisaToFixed(p(c.balance) < p(target.balance) ? p(c.balance) : p(target.balance)))
}

export type CreditNote = { kind: 'ok' | 'over'; text: string }

/** The line under a refund amount: what is left, or why it cannot be refunded. */
export function refundNote(c: CreditSummary, amount: number | null): CreditNote {
  const left = `Rs ${formatAmount(c.balance)}`
  if (amount === null || !(amount > 0)) return { kind: 'ok', text: `This customer holds ${left} of credit.` }
  if (p(amount) > p(c.balance)) return { kind: 'over', text: `That is more than the ${left} this customer holds. Record the overpayment or a credit note first.` }
  const rest = paisaToFixed(p(c.balance) - p(amount))
  return { kind: 'ok', text: p(amount) === p(c.balance) ? 'This refunds all of their credit.' : `Rs ${formatAmount(rest)} of credit stays with them.` }
}

/** The line under an apply amount: against the credit and against what the order owes. */
export function applyNote(c: CreditSummary, target: Pick<ApplyTarget, 'balance'> | null, amount: number | null): CreditNote {
  if (!target) return { kind: 'ok', text: 'Choose the order to put the credit against.' }
  if (amount === null || !(amount > 0)) return { kind: 'ok', text: `They hold Rs ${formatAmount(c.balance)} of credit; the order owes Rs ${formatAmount(target.balance)}.` }
  if (p(amount) > p(c.balance)) return { kind: 'over', text: `That is more than the Rs ${formatAmount(c.balance)} of credit they hold.` }
  if (p(amount) > p(target.balance)) return { kind: 'over', text: `That is more than the Rs ${formatAmount(target.balance)} the order still owes.` }
  const owing = paisaToFixed(p(target.balance) - p(amount))
  return { kind: 'ok', text: p(amount) === p(target.balance) ? 'This settles the order. No cash moves.' : `The order will still owe Rs ${formatAmount(owing)}. No cash moves.` }
}

/** One line of the credit history, refunds and applied credit together, newest first. */
export interface CreditEvent {
  key: string
  kind: 'refund' | 'applied'
  date: string
  amount: number
  orderId: string | null
  detail: string | null
}

export function creditEvents(refunds: readonly CreditRefund[], applications: readonly CreditApplication[]): CreditEvent[] {
  const rows: CreditEvent[] = [
    ...refunds.map(r => ({
      key: `r:${r.id}`,
      kind: 'refund' as const,
      date: r.refundedOn,
      amount: r.amount,
      orderId: r.orderId,
      detail: [r.paidVia === 'cash' ? 'cash' : null, r.reference, r.reason].filter(Boolean).join(' · ') || null,
    })),
    ...applications.map(a => ({ key: `a:${a.id}`, kind: 'applied' as const, date: a.appliedOn, amount: a.amount, orderId: a.toOrderId, detail: a.note })),
  ]
  return rows.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1))
}
