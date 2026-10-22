// ONE ordering of an order's steps, used by the orders list ("Next step" column, lib/nextStep.ts) and by the order page (its one green
// button and its "Next step" line, lib/primaryAction.ts), so the two never disagree (review of ux/orders, 2026-10-20). Pure.
//
// The first step that applies is THE next step:
//    cancelled                      nothing to do (an admin can still answer "Is GST included?", see the page)
//    review-imported      inert     an imported order that is not done: nothing is late or due until someone reviews it (money still wins)
//    resolve-basis        now       admin: an imported order whose price basis is unknown
//    chase-payment        late      admin and sales: the payment is overdue (before "done": sales count an invoiced order as done)
//    goods-late           late      a supplier order is past its expected date and not delivered
//    add-supplier         now       admin and sales: goods lines with no supplier (an engineer waits: wait-supplier)
//    place                now       admin and sales: a supplier order with goods is not placed (an engineer waits: wait-placing)
//    plan-commissioning   now       admin and sales: commissioning has no date (an engineer waits: wait-plan)
//    deliver              now/wait  goods on order or part delivered: "Delivered today" when they come
//    mark-done            now       commissioning planned for today or earlier
//    create-invoice       now       admin and sales: not (fully) invoiced; it comes before a commissioning planned later
//    commissioning-later  waiting   commissioning planned after today
//    await-payment        waiting   admin and sales: an invoiced balance not yet due
//    costs                now       admin: costs not marked complete
//    done / nothing       done
// Only supplier orders with at least one goods line count (as v_order_state counts them): a supplier added with no lines yet is not a step.

import { daysBetween } from '@/features/rfqs/lib/dateText'
import type { StepTone } from '@/lib/status'

export type StepKind =
  | 'cancelled'
  | 'resolve-basis'
  | 'review-imported'
  | 'chase-payment'
  | 'goods-late'
  | 'add-supplier'
  | 'wait-supplier'
  | 'place'
  | 'wait-placing'
  | 'plan-commissioning'
  | 'wait-plan'
  | 'deliver'
  | 'mark-done'
  | 'create-invoice'
  | 'commissioning-later'
  | 'await-payment'
  | 'costs'
  | 'done'
  | 'nothing'

/** Who acts next (the shared tone of status text, src/lib/status.ts): a cancelled order is inert. */
export type { StepTone }

/** A supplier order that supplies at least one goods line. */
export interface StepLeg {
  id: string
  supplierName: string
  placedOn: string | null
  expectedOn: string | null
  deliveredOn: string | null
  /** A purchase order has been issued for it (the page knows; the list does not need to). */
  hasPo?: boolean
}

export interface OrderFacts {
  role: string
  /** v_order_state.lifecycle: active, done, cancelled. */
  lifecycle: string | null
  basisUnknown: boolean
  /** Imported from the old CRM (orders.legacy_source is set): open work waits for a one-off "Review imported" (owner decision 1b, 2026-10-22). */
  imported?: boolean
  /** v_order_state.goods_state: to_source, to_place, late, on_order, partly_delivered, received, delivered, n_a. */
  goods: string | null
  /** v_order_state.commissioning_state: to_plan, planned, done, n_a. */
  commissioning: string | null
  plannedOn: string | null
  /** Admin and sales: v_order_state.invoicing_state, the order's gross and what is still owed. Null for an engineer. */
  invoicing: string | null
  gross: number | null
  payment: string | null
  balance: number | null
  dueOn: string | null
  /** Admin: v_order_money.costs_state. */
  costsState: string | null
  /** Supplier orders with a goods line only. */
  legs: readonly StepLeg[]
  today: string
}

export interface OrderStep {
  kind: StepKind
  tone: StepTone
  /** Sorts the list's column: late first, then now, then waiting, then done. */
  rank: number
  /** The supplier order the step is about (goods-late, place, wait-placing, deliver). */
  leg?: StepLeg
  /** goods-late and chase-payment: how many days late, when the date is known. */
  lateDays?: number
}

const isMoney = (role: string) => role === 'admin' || role === 'sales'

/** The open supplier order expected soonest (no date last). */
function soonest(legs: readonly StepLeg[]): StepLeg | undefined {
  return [...legs].sort((a, b) => (a.expectedOn ?? '9999-99-99').localeCompare(b.expectedOn ?? '9999-99-99'))[0]
}

export function nextOrderStep(f: OrderFacts): OrderStep {
  const money = isMoney(f.role)
  const engineer = f.role === 'engineer'
  if (f.lifecycle === 'cancelled') return { kind: 'cancelled', tone: 'inert', rank: 90 }
  const chase: OrderStep | null =
    money && f.payment === 'overdue' && (f.balance ?? 1) > 0
      ? { kind: 'chase-payment', tone: 'late', rank: 0, lateDays: f.dueOn ? Math.max(0, daysBetween(f.dueOn, f.today)) : undefined }
      : null
  // Owner decision 1b: an imported order with open work is not "late" or "due" on old dates; it waits for a one-off review. Late money still shows.
  if (f.imported && f.lifecycle !== 'done') return chase ?? { kind: 'review-imported', tone: 'inert', rank: 60 }
  if (f.role === 'admin' && f.basisUnknown) return { kind: 'resolve-basis', tone: 'now', rank: 10 }
  if (chase) return chase

  const open = f.legs.filter(l => l.placedOn && !l.deliveredOn)
  const late = open.filter(l => l.expectedOn && l.expectedOn < f.today)
  if (late.length > 0 || f.goods === 'late') {
    // the longest late first
    const leg = late.length > 0 ? soonest(late) : soonest(open)
    // Amber, not red (redesign phase 0): late goods are our own pace slipping; red is kept for late money and promises to customers.
    return { kind: 'goods-late', tone: 'now', rank: 1, leg, lateDays: leg?.expectedOn ? Math.max(0, daysBetween(leg.expectedOn, f.today)) : undefined }
  }

  if (f.goods === 'to_source') return engineer ? { kind: 'wait-supplier', tone: 'waiting', rank: 43 } : { kind: 'add-supplier', tone: 'now', rank: 11 }
  const toPlace = f.legs.find(l => !l.placedOn)
  if (toPlace || f.goods === 'to_place') return engineer ? { kind: 'wait-placing', tone: 'waiting', rank: 44, leg: toPlace } : { kind: 'place', tone: 'now', rank: 12, leg: toPlace }
  if (f.commissioning === 'to_plan') return engineer ? { kind: 'wait-plan', tone: 'waiting', rank: 45 } : { kind: 'plan-commissioning', tone: 'now', rank: 13 }

  const partly = f.goods === 'received' || f.goods === 'partly_delivered'
  if (open.length > 0 || partly || f.goods === 'on_order') return { kind: 'deliver', tone: partly ? 'now' : 'waiting', rank: partly ? 14 : 40, leg: soonest(open) }

  const commissioningOpen = f.commissioning === 'planned'
  if (commissioningOpen && f.plannedOn && f.plannedOn <= f.today) return { kind: 'mark-done', tone: 'now', rank: 15 }
  if (money && (f.invoicing === 'part' || (f.invoicing === 'not_invoiced' && (f.gross ?? 1) > 0))) return { kind: 'create-invoice', tone: 'now', rank: f.invoicing === 'part' ? 17 : 16 }
  if (commissioningOpen) return { kind: 'commissioning-later', tone: 'waiting', rank: 41 }
  if (money && (f.payment === 'unpaid' || f.payment === 'part') && (f.balance ?? 0) > 0) return { kind: 'await-payment', tone: 'waiting', rank: 42 }
  if (f.role === 'admin' && f.costsState !== null && f.costsState !== 'complete') return { kind: 'costs', tone: 'now', rank: 18 }
  if (f.lifecycle === 'done') return { kind: 'done', tone: 'done', rank: 80 }
  return { kind: 'nothing', tone: 'done', rank: 70 }
}
