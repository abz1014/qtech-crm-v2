// Procurement legs (O03): the next-step stamp, what a stamp writes, the leg's state and its supplier total.
// Pure and framework-free. DATA_MODEL 2.14 and the A3 notes: Mark placed, then Received today, then Delivered today;
// Delivered fills received_on when it is empty; expected_on is suggested from placed_on plus the lead time.

import { suggestExpected } from '@/features/orders/lib/leadTime'

export { suggestExpected, type ExpectedSuggestion } from '@/features/orders/lib/leadTime'

export interface LegDates {
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  deliveredOn: string | null
}

export type LegStep = 'place' | 'receive' | 'deliver'

export interface LegStamp {
  step: LegStep
  /** The button's words. */
  label: string
}

/** The one next-step button for a leg, or null when it is delivered. */
export function nextStamp(d: LegDates): LegStamp | null {
  if (!d.placedOn) return { step: 'place', label: 'Mark placed' }
  if (!d.receivedOn && !d.deliveredOn) return { step: 'receive', label: 'Received today' }
  if (!d.deliveredOn) return { step: 'deliver', label: 'Delivered today' }
  return null
}

export type LegPatch = Partial<{ placed_on: string | null; expected_on: string | null; received_on: string | null; delivered_on: string | null }>

/** What a stamp writes. `lead` is the leg's quote-line lead times, used to suggest expected_on once, when it is empty. */
export function stampPatch(step: LegStep, d: LegDates, today: string, lead: ReadonlyArray<string | null | undefined>): LegPatch {
  if (step === 'place') {
    const patch: LegPatch = { placed_on: today }
    if (!d.expectedOn) {
      const s = suggestExpected(today, lead)
      if (s) patch.expected_on = s.on
    }
    return patch
  }
  if (step === 'receive') return { received_on: today }
  // Delivered fills received_on when it is empty (the goods cannot reach the customer before Q-Tech has them).
  return d.receivedOn ? { delivered_on: today } : { delivered_on: today, received_on: today }
}

/** A hand edit of one date. Delivered still fills an empty received_on; clearing a date clears only that date. */
export function editPatch(field: keyof LegDates, value: string | null, d: LegDates, lead: ReadonlyArray<string | null | undefined>): LegPatch {
  if (field === 'placedOn') {
    const patch: LegPatch = { placed_on: value }
    if (value && !d.expectedOn) {
      const s = suggestExpected(value, lead)
      if (s) patch.expected_on = s.on
    }
    return patch
  }
  if (field === 'expectedOn') return { expected_on: value }
  if (field === 'receivedOn') return { received_on: value }
  return value && !d.receivedOn ? { delivered_on: value, received_on: value } : { delivered_on: value }
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
