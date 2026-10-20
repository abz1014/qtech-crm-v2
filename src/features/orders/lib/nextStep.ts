// The orders list's one "Next step" column (UX audit 2026-10-19, screens.md 7): instead of four state chips per row, one plain sentence
// that says what moves the order forward. WHICH step comes from lib/orderSteps.ts, the same ordering the order page uses for its green
// button, so the list and the page always agree; this file only words it for a list row. Pure and framework-free.
// An engineer is never told about money, and never offered a step only admin and sales can take ("Add a supplier").

import { formatAmount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import type { OrderListRow } from '@/features/orders/api'
import { nextOrderStep, type OrderFacts, type OrderStep, type StepKind, type StepTone } from '@/features/orders/lib/orderSteps'

export type NextStepTone = StepTone

export interface NextStep {
  kind: StepKind
  text: string
  tone: NextStepTone
  /** Sorts the column: lower is more urgent. */
  rank: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The facts a list row carries, in the shared shape. */
export function rowFacts(row: OrderListRow, role: string, today: string): OrderFacts {
  return {
    role,
    lifecycle: row.lifecycle,
    basisUnknown: row.dataTrust === 'basis_unknown',
    goods: row.goods,
    commissioning: row.commissioning,
    plannedOn: row.plannedOn,
    invoicing: row.invoicing,
    gross: row.gross,
    payment: row.payment,
    balance: row.balance,
    dueOn: row.dueOn,
    costsState: row.costsState,
    legs: row.legs,
    today,
  }
}

/** One step in a few words for a list row. */
export function listText(step: OrderStep, f: OrderFacts): string {
  const supplier = step.leg?.supplierName
  const pkr = (n: number | null) => (n !== null && n > 0 ? `PKR ${formatAmount(n)}` : null)
  switch (step.kind) {
    case 'cancelled':
      return 'Cancelled'
    case 'resolve-basis':
      return 'Is GST included? Answer it to finish the order'
    case 'chase-payment': {
      const late = step.lateDays && step.lateDays > 0 ? `${plural(step.lateDays, 'day', 'days')} overdue` : 'overdue'
      return `Chase payment: ${late}${pkr(f.balance) ? ` · ${pkr(f.balance)}` : ''}`
    }
    case 'goods-late': {
      const late = step.lateDays && step.lateDays > 0 ? `goods ${plural(step.lateDays, 'day', 'days')} late` : 'goods late'
      return supplier ? `Chase ${supplier}: ${late}` : `Chase the supplier: ${late}`
    }
    case 'add-supplier':
      return 'Add a supplier for the goods'
    case 'wait-supplier':
      return 'Waiting for a supplier to be chosen'
    case 'place':
      return supplier ? `Place the order with ${supplier}` : 'Place the supplier order'
    case 'wait-placing':
      return supplier ? `Waiting for the order with ${supplier} to be placed` : 'Waiting for the supplier order to be placed'
    case 'plan-commissioning':
      return 'Plan commissioning'
    case 'wait-plan':
      return 'Waiting for a commissioning date'
    case 'deliver':
      if (f.goods === 'received') return 'Deliver to the customer'
      if (f.goods === 'partly_delivered') return 'Deliver the rest'
      return step.leg?.expectedOn ? `Goods expected ${formatShortDate(step.leg.expectedOn, f.today)}` : 'Waiting for the goods'
    case 'mark-done':
      return 'Mark commissioning done'
    case 'create-invoice':
      return f.invoicing === 'part' ? 'Invoice the rest' : 'Create the invoice'
    case 'commissioning-later':
      return f.plannedOn ? `Commissioning ${formatShortDate(f.plannedOn, f.today)}` : 'Commissioning planned'
    case 'await-payment': {
      const amount = pkr(f.balance) ?? 'the balance'
      return f.dueOn ? `Waiting for ${amount}, due ${formatShortDate(f.dueOn, f.today)}` : `Waiting for ${amount}`
    }
    case 'costs':
      return 'Mark costs complete'
    case 'done':
      return 'Done'
    case 'nothing':
      return f.role === 'engineer' ? 'Nothing left for you' : 'Nothing left to do'
  }
}

export function listNextStep(row: OrderListRow, role: string, today: string): NextStep {
  const f = rowFacts(row, role, today)
  const step = nextOrderStep(f)
  return { kind: step.kind, text: listText(step, f), tone: step.tone, rank: step.rank }
}
