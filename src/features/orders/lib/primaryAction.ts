// The order page's ONE primary (green) button and its "Next step" line (UX audit 2026-10-19: "one green button per screen, chosen by
// state"). WHICH step is next comes from lib/orderSteps.ts, the same ordering as the orders list's "Next step" column; this file turns that
// step into the page's button (or none) and its sentence. Pure.
//
//   resolve-basis       admin: "Is GST included?"
//   chase-payment       admin: Record payment; sales: Copy reminder (the payment reminder text, on the clipboard)
//   goods-late          admin and sales: Chase goods; an engineer: Delivered today (they are the ones on site)
//   add-supplier        admin and sales: Add supplier
//   place               admin and sales: Issue PO (Mark placed when its PO already exists); an engineer waits for the admin
//   plan-commissioning  admin and sales: Plan commissioning (the Commissioning dialog)
//   deliver             everyone: Delivered today
//   mark-done           everyone: Mark done today (only once the planned date has come)
//   create-invoice      admin and sales: Create invoice
//   await-payment       admin: Record payment; sales: Copy reminder
//   done                admin and sales: Repeat order (the Repeat a past order dialog with this order chosen; audit 39676918821: a done,
//                       paid order had no green button); an engineer: the sentence only
//   the waiting steps, costs: the sentence only (an engineer keeps "Mark done today" as a secondary button in "Your job")

import { formatAmount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow, OrderMoney } from '@/features/orders/api'
import { nextOrderStep, type OrderFacts, type OrderStep, type StepLeg } from '@/features/orders/lib/orderSteps'

export type PrimaryKind = 'resolve-basis' | 'record-payment' | 'chase-goods' | 'deliver' | 'add-supplier' | 'issue-po' | 'mark-placed' | 'plan-commissioning' | 'mark-done' | 'create-invoice' | 'copy-reminder' | 'repeat-order'

export interface PrimaryAction {
  kind: PrimaryKind
  /** The button's words. */
  label: string
  /** For a supplier-order step: which one (its name goes into the button's accessible name). */
  legId?: string
  supplierName?: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The page's facts for the shared ordering: the order's own states, its goods supplier orders, and for admin and sales the balance. */
export function orderFacts(
  order: OrderHeader,
  legs: readonly OrderLegRow[],
  items: readonly OrderItemRow[],
  pos: readonly LegPo[],
  role: string,
  orderMoney: OrderMoney | null | undefined,
  today: string,
): OrderFacts & { unsourced: number } {
  const s = order.state
  const money = role === 'admin' || role === 'sales'
  // Only supplier orders that supply a goods line count, as v_order_state counts them: one added with no lines yet is not a step.
  const goodsLegs: StepLeg[] = legs
    .filter(l => items.some(i => i.legId === l.id && !i.isService))
    .map(l => ({ id: l.id, supplierName: l.supplierName, placedOn: l.placedOn, expectedOn: l.expectedOn, deliveredOn: l.deliveredOn, hasPo: pos.some(p => p.legId === l.id) }))
  return {
    role,
    lifecycle: order.cancelledOn !== null ? 'cancelled' : (s?.lifecycle ?? 'active'),
    basisUnknown: s?.dataTrust === 'basis_unknown',
    goods: s?.goods ?? null,
    commissioning: order.needsCommissioning ? (order.doneOn ? 'done' : (s?.commissioning ?? (order.plannedOn ? 'planned' : 'to_plan'))) : 'n_a',
    plannedOn: order.plannedOn,
    invoicing: money ? (s?.invoicing ?? null) : null,
    gross: money ? (s?.gross ?? null) : null,
    payment: money ? (orderMoney?.paymentState ?? null) : null,
    balance: money ? (orderMoney?.balance ?? null) : null,
    dueOn: money ? (orderMoney?.dueOn ?? null) : null,
    costsState: role === 'admin' ? (orderMoney?.costsState ?? null) : null,
    legs: goodsLegs,
    today,
    unsourced: items.filter(i => !i.isService && i.legId === null).length,
  }
}

/** The button for a step, or null when the step has none for this person. */
export function pagePrimary(step: OrderStep, f: OrderFacts): PrimaryAction | null {
  const money = f.role === 'admin' || f.role === 'sales'
  const admin = f.role === 'admin'
  const leg = step.leg
  const onLeg = (kind: PrimaryKind, label: string): PrimaryAction | null => (leg ? { kind, label, legId: leg.id, supplierName: leg.supplierName } : null)
  switch (step.kind) {
    case 'resolve-basis':
      return admin ? { kind: 'resolve-basis', label: 'Is GST included?' } : null
    case 'chase-payment':
    case 'await-payment':
      return admin ? { kind: 'record-payment', label: 'Record payment' } : money ? { kind: 'copy-reminder', label: 'Copy reminder' } : null
    case 'goods-late':
      return money ? onLeg('chase-goods', 'Chase goods') : onLeg('deliver', 'Delivered today')
    case 'add-supplier':
      return money ? { kind: 'add-supplier', label: 'Add supplier' } : null
    case 'place':
      return money ? (leg?.hasPo ? onLeg('mark-placed', 'Mark placed') : onLeg('issue-po', 'Issue PO')) : null
    case 'plan-commissioning':
      return money ? { kind: 'plan-commissioning', label: 'Plan commissioning' } : null
    case 'deliver':
      return onLeg('deliver', 'Delivered today')
    case 'mark-done':
      return { kind: 'mark-done', label: 'Mark done today' }
    case 'create-invoice':
      return money ? { kind: 'create-invoice', label: 'Create invoice' } : null
    case 'done':
      return money ? { kind: 'repeat-order', label: 'Repeat order' } : null
    default:
      return null
  }
}

/** The sentence beside the button (or alone): what the step is, in plain words. */
export function pageText(step: OrderStep, f: OrderFacts & { unsourced?: number }): string {
  const supplier = step.leg?.supplierName ?? 'the supplier'
  const pkr = (n: number | null) => (n !== null && n > 0 ? `PKR ${formatAmount(n)}` : 'the balance')
  switch (step.kind) {
    case 'cancelled':
      return 'This order is cancelled'
    case 'resolve-basis':
      return 'The old CRM did not say whether these prices include GST'
    case 'chase-payment': {
      const late = step.lateDays && step.lateDays > 0 ? `${plural(step.lateDays, 'day', 'days')} overdue` : 'overdue'
      return `Customer owes ${pkr(f.balance)}, ${late}`
    }
    case 'goods-late': {
      const late = step.lateDays && step.lateDays > 0 ? `${plural(step.lateDays, 'day', 'days')} late` : 'late'
      return `Goods from ${supplier} are ${late}`
    }
    case 'add-supplier':
      return f.unsourced && f.unsourced > 0 ? `${plural(f.unsourced, 'goods line has', 'goods lines have')} no supplier yet` : 'Some goods have no supplier yet'
    case 'wait-supplier':
      return 'Waiting for a supplier to be chosen'
    case 'place':
      return `Order the goods from ${supplier}`
    case 'wait-placing':
      return `Waiting for admin to place the order with ${supplier}`
    case 'plan-commissioning':
      return 'Commissioning needs a date'
    case 'wait-plan':
      return 'Waiting for a commissioning date'
    case 'deliver':
      return step.leg?.expectedOn ? `Goods from ${supplier} expected ${formatShortDate(step.leg.expectedOn, f.today)}` : `Goods from ${supplier} are on the way`
    case 'mark-done':
      return 'Commissioning was planned for today or earlier'
    case 'create-invoice':
      return f.invoicing === 'part' ? 'Part of this order is not invoiced yet' : f.goods === 'n_a' ? 'Invoice the customer' : 'Everything is delivered: invoice the customer'
    case 'commissioning-later':
      return f.plannedOn ? `Commissioning planned ${formatShortDate(f.plannedOn, f.today)}` : 'Waiting for the commissioning date'
    case 'await-payment':
      return `Customer owes ${pkr(f.balance)}${f.dueOn ? `, due ${formatShortDate(f.dueOn, f.today)}` : ''}`
    case 'costs':
      return 'Mark costs complete in the Margin panel'
    case 'done':
    case 'nothing':
      return 'Nothing left to do on this order'
  }
}

/** Everything the page needs from one call: the step, its button and its sentence. */
export function pageStep(f: OrderFacts & { unsourced?: number }): { step: OrderStep; primary: PrimaryAction | null; text: string } {
  const step = nextOrderStep(f)
  return { step, primary: pagePrimary(step, f), text: pageText(step, f) }
}

/**
 * Where an admin's "Record payment" goes (UX audit P2): the green next step when payment is the step; in the Payment cell once an
 * invoice exists and something is owed; otherwise (an advance before the invoice, or more than is owed) in the order's More menu,
 * so it is never offered up front on an order not yet invoiced or already paid, yet an advance can still be recorded.
 */
export function recordPaymentPlace(order: OrderHeader, money: OrderMoney | null | undefined, primaryKind: string | undefined, role: string): 'primary' | 'cell' | 'menu' | null {
  if (role !== 'admin' || order.cancelledOn !== null) return null
  if (primaryKind === 'record-payment') return 'primary'
  return (order.state?.invoiced ?? 0) > 0 && (money?.balance ?? 0) > 0 ? 'cell' : 'menu'
}
