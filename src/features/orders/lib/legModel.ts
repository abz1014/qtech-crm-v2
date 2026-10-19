// Procurement legs (O03): the next-step stamp, what a stamp writes, the leg's state and its supplier total.
// Pure and framework-free. DATA_MODEL 2.14 and the A3 notes, as amended by the owner (2026-10-15): there is no "received" step to tap.
// A leg is Mark placed, then Delivered today. supplier_orders.received_on stays in the database and is set by the app to the delivered
// date, whenever delivered is stamped or edited; expected_on is suggested from placed_on plus the lead time.

import { defaultExpected } from '@/features/orders/lib/leadTime'

export { defaultExpected, suggestExpected, type ExpectedSuggestion } from '@/features/orders/lib/leadTime'

export interface LegDates {
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  deliveredOn: string | null
}

export type LegStep = 'place' | 'deliver'

export interface LegStamp {
  step: LegStep
  /** The button's words. */
  label: string
}

/** The one next-step button for a leg, or null when it is delivered. */
export function nextStamp(d: LegDates): LegStamp | null {
  if (!d.placedOn) return { step: 'place', label: 'Mark placed' }
  if (!d.deliveredOn) return { step: 'deliver', label: 'Delivered today' }
  return null
}

export type LegPatch = Partial<{ placed_on: string | null; expected_on: string | null; received_on: string | null; delivered_on: string | null }>

/** What a stamp writes. `lead` is the leg's quote-line lead times, used to suggest expected_on once, when it is empty. */
export function stampPatch(step: LegStep, d: LegDates, today: string, lead: ReadonlyArray<string | null | undefined>, medianDays: number | null = null): LegPatch {
  if (step === 'place') {
    const patch: LegPatch = { placed_on: today }
    if (!d.expectedOn) {
      const s = defaultExpected(today, lead, medianDays)
      if (s) patch.expected_on = s.on
    }
    return patch
  }
  // Delivered also sets received_on to the same day: nobody types a receiving date, and "goods received" is derived from delivery.
  return { delivered_on: today, received_on: today }
}

/**
 * The expected date to write once a PO is issued, or null to leave it. issue_purchase_order stamps placed_on only when it is empty, so
 * the lead time counts from the leg's own placed date when it has one, and from today when the issue is what placed it.
 */
export function expectedAfterIssue(leg: { placedOn: string | null; expectedOn: string | null; leadTimes: ReadonlyArray<string | null | undefined> }, today: string): string | null {
  if (leg.expectedOn) return null
  return suggestExpected(leg.placedOn ?? today, leg.leadTimes)?.on ?? null
}

/** A hand edit of one date. Editing delivered moves received_on with it (clearing delivered clears both); the other dates are alone. */
export function editPatch(field: keyof LegDates, value: string | null, d: LegDates, lead: ReadonlyArray<string | null | undefined>, medianDays: number | null = null): LegPatch {
  if (field === 'placedOn') {
    const patch: LegPatch = { placed_on: value }
    if (value && !d.expectedOn) {
      const s = defaultExpected(value, lead, medianDays)
      if (s) patch.expected_on = s.on
    }
    return patch
  }
  if (field === 'expectedOn') return { expected_on: value }
  // received_on is never edited on its own: it follows delivered_on
  return { delivered_on: value, received_on: value }
}

/** The values a patch overwrites, so an Undo restores them exactly. */
export function before(d: LegDates, patch: LegPatch): LegPatch {
  const cols: Record<keyof LegPatch, string | null> = {
    placed_on: d.placedOn,
    expected_on: d.expectedOn,
    received_on: d.receivedOn,
    delivered_on: d.deliveredOn,
  }
  return Object.fromEntries(Object.keys(patch).map(k => [k, cols[k as keyof LegPatch]])) as LegPatch
}

export type LegState = 'to-place' | 'on-order' | 'late' | 'received' | 'delivered'

/** The leg's own state, from its dates (the same rule v_order_state applies across legs). */
export function legState(d: LegDates, today: string): LegState {
  if (d.deliveredOn) return 'delivered'
  if (d.receivedOn) return 'received'
  if (!d.placedOn) return 'to-place'
  if (d.expectedOn && d.expectedOn < today) return 'late'
  return 'on-order'
}

export interface LegLine {
  qty: number
  supplierUnitPrice: number | null
  isService: boolean
}

/** The leg's total in its own currency, and how many of its goods lines have a supplier price. */
export function legSupplierTotal(lines: readonly LegLine[]): { total: number; priced: number; of: number } {
  const goods = lines.filter(l => !l.isService)
  const priced = goods.filter(l => l.supplierUnitPrice !== null)
  // Work in thousandths of a unit so 0.1 + 0.2 never shows as 0.30000000000000004.
  const milli = priced.reduce((n, l) => n + Math.round(l.qty * (l.supplierUnitPrice as number) * 1000), 0)
  return { total: milli / 1000, priced: priced.length, of: goods.length }
}

/** "A", "B", ... "Z", "AA": the letter an item's Leg column shows. */
export function legLetter(index: number): string {
  let n = index
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}
