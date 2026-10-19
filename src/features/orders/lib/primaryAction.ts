// The order page's ONE primary (green) action (UX audit 2026-10-19: "one green button per screen, chosen by state"). Pure.
//
// The order moves through the same steps every time, so the most urgent step that is not done yet is the one button:
//   Is GST included? (admin, an imported order whose price basis is unknown: nothing else is right until it is answered)
//   Issue PO, to the first supplier not ordered from yet (an engineer, who sees no prices, gets Mark placed only if nothing else is theirs)
//   Delivered today, on the supplier order that is late first, else the one expected soonest
//   Mark done today, once commissioning is due (planned for today or earlier)
//   Create invoice (admin and sales), once every supplier order is delivered
//   Record payment (admin), while an invoiced balance is still owed
// An engineer's page leads with their job: Mark done today while commissioning is open, else Delivered today. Everything else on the
// page is a secondary button or sits in a menu.

import type { LegPo, OrderHeader, OrderLegRow, OrderMoney } from '@/features/orders/api'

export type PrimaryKind = 'resolve-basis' | 'issue-po' | 'mark-placed' | 'deliver' | 'mark-done' | 'create-invoice' | 'record-payment'

export interface PrimaryLeg {
  id: string
  supplierName: string
  placedOn: string | null
  expectedOn: string | null
  deliveredOn: string | null
  /** A purchase order has been issued for it. */
  hasPo: boolean
}

export interface PrimaryInput {
  role: string
  cancelled: boolean
  basisUnknown: boolean
  legs: readonly PrimaryLeg[]
  today: string
  needsCommissioning: boolean
  plannedOn: string | null
  doneOn: string | null
  /** v_order_state.invoicing: not_invoiced, part, fully_invoiced. Null for an engineer. */
  invoicing: string | null
  /** Gross still to invoice is above zero (v_order_state gross less invoiced). */
  toInvoice: number | null
  /** What is still owed on what was invoiced (the balance), and what has been invoiced so far. */
  balance: number | null
  invoiced: number | null
}

export interface PrimaryAction {
  kind: PrimaryKind
  /** The button's words. */
  label: string
  /** One sentence beside it: what the step is, in plain words. */
  why: string
  /** For a supplier-order step: which one. */
  legId?: string
  late?: boolean
}

/** The supplier order to stamp delivered next: a late one first (the longest late), else the one expected soonest. */
function nextToDeliver(legs: readonly PrimaryLeg[], today: string): { leg: PrimaryLeg; late: boolean } | null {
  const open = legs.filter(l => l.placedOn && !l.deliveredOn)
  if (open.length === 0) return null
  const sorted = [...open].sort((a, b) => (a.expectedOn ?? '9999').localeCompare(b.expectedOn ?? '9999'))
  const leg = sorted[0]
  return { leg, late: Boolean(leg.expectedOn && leg.expectedOn < today) }
}

export function choosePrimary(i: PrimaryInput): PrimaryAction | null {
  if (i.cancelled) return null
  const money = i.role === 'admin' || i.role === 'sales'
  const isEngineer = i.role === 'engineer'
  const commissioningOpen = i.needsCommissioning && !i.doneOn
  const deliver = nextToDeliver(i.legs, i.today)
  const deliverAction = (d: { leg: PrimaryLeg; late: boolean }): PrimaryAction => ({
    kind: 'deliver',
    label: 'Delivered today',
    why: d.late ? `Goods from ${d.leg.supplierName} are late` : `Goods from ${d.leg.supplierName} are on the way`,
    legId: d.leg.id,
    late: d.late,
  })

  if (isEngineer) {
    if (commissioningOpen) return { kind: 'mark-done', label: 'Mark done today', why: 'Commissioning on this order' }
    if (deliver) return deliverAction(deliver)
    return null
  }
  if (!money) return null

  if (i.role === 'admin' && i.basisUnknown) return { kind: 'resolve-basis', label: 'Is GST included?', why: 'The old CRM did not say whether these prices include GST' }

  const toPlace = i.legs.find(l => !l.placedOn)
  if (toPlace) {
    return toPlace.hasPo
      ? { kind: 'mark-placed', label: 'Mark placed', why: `The PO to ${toPlace.supplierName} is issued`, legId: toPlace.id }
      : { kind: 'issue-po', label: 'Issue PO', why: `Order the goods from ${toPlace.supplierName}`, legId: toPlace.id }
  }
  if (deliver) return deliverAction(deliver)
  if (commissioningOpen && i.plannedOn && i.plannedOn <= i.today) return { kind: 'mark-done', label: 'Mark done today', why: 'Commissioning was planned for today or earlier' }
  if (i.invoicing !== 'fully_invoiced' && (i.toInvoice ?? 0) > 0) {
    return { kind: 'create-invoice', label: 'Create invoice', why: i.invoicing === 'part' ? 'Part of this order is not invoiced yet' : 'Everything is delivered: invoice the customer' }
  }
  if (i.role === 'admin' && (i.invoiced ?? 0) > 0 && (i.balance ?? 0) > 0) return { kind: 'record-payment', label: 'Record payment', why: 'The customer still owes on this order' }
  return null
}

/** With no step to take, what the order is waiting for, in a few plain words. */
export function waitingText(i: {
  legs: ReadonlyArray<{ placedOn: string | null; deliveredOn: string | null }>
  needsCommissioning: boolean
  plannedOn: string | null
  doneOn: string | null
  invoicing: string | null
  balance: number | null
  role: string
}): string {
  if (i.legs.some(l => l.placedOn && !l.deliveredOn)) return 'Waiting for the goods'
  if (i.needsCommissioning && !i.doneOn) return i.plannedOn ? 'Waiting for the commissioning date' : 'Commissioning needs a date: set it under Commissioning'
  if ((i.role === 'admin' || i.role === 'sales') && i.invoicing && i.invoicing !== 'not_invoiced' && (i.balance ?? 0) > 0) return 'Waiting for the customer to pay'
  return 'Nothing left to do on this order'
}

/** The page's one primary step for this order and this person (lib/primaryAction.ts), from what the page already read. */
export function orderPrimary(order: OrderHeader, legs: readonly OrderLegRow[], pos: readonly LegPo[], role: string, orderMoney: OrderMoney | null | undefined, today: string): PrimaryAction | null {
  const s = order.state
  const gross = s?.gross ?? null
  const invoiced = s?.invoiced ?? null
  return choosePrimary({
    role,
    cancelled: order.cancelledOn !== null,
    basisUnknown: s?.dataTrust === 'basis_unknown',
    legs: legs.map(l => ({ id: l.id, supplierName: l.supplierName, placedOn: l.placedOn, expectedOn: l.expectedOn, deliveredOn: l.deliveredOn, hasPo: pos.some(p => p.legId === l.id) })),
    today,
    needsCommissioning: order.needsCommissioning,
    plannedOn: order.plannedOn,
    doneOn: order.doneOn,
    invoicing: s?.invoicing ?? null,
    toInvoice: gross !== null ? gross - (invoiced ?? 0) : null,
    balance: orderMoney?.balance ?? null,
    invoiced,
  })
}
