import { paisaToFixed, toPaisa } from '@/lib/money'
import type { CompanyMoney } from '@/features/companies/api'
import type { CreditSummary } from '@/features/money/credit/model'

/*
 * The company page's "Money with them" card (admin only), as lines that add up. Pure.
 *
 * receivables_list gives each order's gross, settled, balance and overpaid_by. Two things made the old card (Total, Received, Balance)
 * impossible to follow (review 2026-11-24, screen 07: Total 141,600, Received 150,000, Balance 23,600, with 28,000 of credit beside it):
 *   - an overpaid order counts 0 in the balance, its excess is the customer's credit, shown in another card
 *   - settled counts the credit applied to an order (0127), so credit moved from one of their orders to another was counted twice
 * The card now reads, in the customer's own money:
 *   Orders total - Received + Refunded to them = Balance due on orders - Credit they hold = the statement's closing balance
 * where Received is cash and tax withheld (settled less the credit applied between their orders), Balance due on orders is what the
 * Apply credit dialog offers order by order, and Credit they hold is the Credit balance card (v_company_credit).
 * An imported order reviewed as settled has no balance though it was never paid in full: that difference, when there is one, is its
 * own line, so the card still adds up.
 */
export interface MoneyLine {
  key: 'total' | 'received' | 'refunded' | 'due' | 'credit' | 'net' | 'closed'
  label: string
  amount: string
  strong?: boolean
}

const fx = (p: bigint): string => paisaToFixed(p)

export function moneyWithThem(m: CompanyMoney, credit: CreditSummary | null): MoneyLine[] {
  const total = toPaisa(m.receivable)
  const due = toPaisa(m.balance)
  if (!credit) {
    // The credit could not be read: only the two figures that need no credit.
    return [
      { key: 'total', label: 'Orders total, GST included', amount: fx(total) },
      { key: 'due', label: 'Balance due on orders', amount: fx(due), strong: true },
    ]
  }
  const received = toPaisa(m.settled) - toPaisa(credit.applied)
  const refunded = toPaisa(credit.refunded)
  const held = toPaisa(credit.balance)
  const lines: MoneyLine[] = [
    { key: 'total', label: 'Orders total, GST included', amount: fx(total) },
    { key: 'received', label: 'Received', amount: fx(received) },
  ]
  if (refunded !== 0n) lines.push({ key: 'refunded', label: 'Refunded to them', amount: fx(refunded) })
  // What the arithmetic leaves owing, against what the orders and the credit say: apart only when an imported order was closed unpaid.
  const closed = total - received + refunded - (due - held)
  if (closed !== 0n) lines.push({ key: 'closed', label: 'Closed in Review imported', amount: fx(closed) })
  lines.push({ key: 'due', label: 'Balance due on orders', amount: fx(due), strong: held === 0n })
  if (held !== 0n) {
    lines.push({ key: 'credit', label: 'Credit they hold', amount: fx(held) })
    const net = due - held
    lines.push(
      net >= 0n
        ? { key: 'net', label: 'Still due after their credit', amount: fx(net), strong: true }
        : { key: 'net', label: 'Credit left after the balance due', amount: fx(-net), strong: true },
    )
  }
  return lines
}
