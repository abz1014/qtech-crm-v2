// The orders list's one "Next step" column (UX audit 2026-10-19, screens.md 7): instead of four state chips per row, one plain sentence
// that says what moves the order forward, worked out from the states the list already reads (v_order_state, and for admin and sales the
// balance). Pure and framework-free. The wording follows the Today rules (src/features/today/rules.ts: "Place PO with", "Goods N days
// late", "Plan commissioning", "Delivered, not invoiced", "Payment N days overdue") and the plain-words glossary in DECISIONS.
//
// Order of urgency: what is late first (payment overdue, goods late), then what someone can do now (is GST included, choose a supplier,
// place the supplier order, plan commissioning, deliver, mark commissioning done, invoice, mark costs complete), then what we are waiting
// for (goods on order, commissioning planned, payment not yet due). An engineer is never told about money.

import { daysBetween } from '@/features/rfqs/lib/dateText'
import { formatAmount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import type { OrderListRow } from '@/features/orders/api'

export type NextStepTone = 'late' | 'now' | 'waiting' | 'done'

export interface NextStep {
  text: string
  tone: NextStepTone
  /** Sorts the column: lower is more urgent. */
  rank: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function listNextStep(row: OrderListRow, role: string, today: string): NextStep {
  const money = role === 'admin' || role === 'sales'
  if (row.lifecycle === 'cancelled') return { text: 'Cancelled', tone: 'done', rank: 90 }
  if (row.lifecycle === 'done') return { text: 'Done', tone: 'done', rank: 80 }

  // late first
  if (money && row.payment === 'overdue') {
    const late = row.dueOn ? Math.max(0, daysBetween(row.dueOn, today)) : 0
    const amount = row.balance !== null && row.balance > 0 ? ` · PKR ${formatAmount(row.balance)}` : ''
    return { text: `Chase payment: ${late > 0 ? `${plural(late, 'day', 'days')} overdue` : 'overdue'}${amount}`, tone: 'late', rank: 0 }
  }
  if (row.goods === 'late') return { text: 'Chase the supplier: goods late', tone: 'late', rank: 1 }

  // what can be done now
  if (role === 'admin' && row.dataTrust === 'basis_unknown') return { text: 'Is GST included? Choose to finish the order', tone: 'now', rank: 10 }
  if (row.goods === 'to_source') return { text: 'Choose a supplier', tone: 'now', rank: 11 }
  if (row.goods === 'to_place') return { text: 'Place the supplier order', tone: 'now', rank: 12 }
  if (row.commissioning === 'to_plan') return { text: 'Plan commissioning', tone: 'now', rank: 13 }
  if (row.goods === 'received' || row.goods === 'partly_delivered') return { text: row.goods === 'received' ? 'Deliver to the customer' : 'Deliver the rest', tone: 'now', rank: 14 }

  const goodsDone = row.goods === 'delivered' || row.goods === 'n_a'
  if (!goodsDone) {
    // on order: waiting for the supplier
    return { text: 'Waiting for the goods', tone: 'waiting', rank: 40 }
  }
  if (row.commissioning === 'planned') {
    if (row.plannedOn && row.plannedOn <= today) return { text: 'Mark commissioning done', tone: 'now', rank: 15 }
    return { text: row.plannedOn ? `Commissioning ${formatShortDate(row.plannedOn, today)}` : 'Commissioning planned', tone: 'waiting', rank: 41 }
  }
  if (!money) return { text: 'Nothing left for you', tone: 'done', rank: 70 }

  if (row.invoicing === 'not_invoiced') return { text: 'Create the invoice', tone: 'now', rank: 16 }
  if (row.invoicing === 'part') return { text: 'Invoice the rest', tone: 'now', rank: 17 }
  if (row.payment === 'unpaid' || row.payment === 'part') {
    const amount = row.balance !== null && row.balance > 0 ? `PKR ${formatAmount(row.balance)}` : 'the balance'
    return { text: row.dueOn ? `Waiting for ${amount}, due ${formatShortDate(row.dueOn, today)}` : `Waiting for ${amount}`, tone: 'waiting', rank: 42 }
  }
  if (role === 'admin' && row.costsState !== 'complete') return { text: 'Mark costs complete', tone: 'now', rank: 18 }
  return { text: 'Nothing left to do', tone: 'done', rank: 70 }
}
