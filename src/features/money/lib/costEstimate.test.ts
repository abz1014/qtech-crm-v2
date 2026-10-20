import { describe, expect, it } from 'vitest'
import { estimateExpectedCost, stillOwedOnLeg, type EstItem, type EstLeg, type EstPo } from '@/features/money/lib/costEstimate'

const item = (id: string, over: Partial<EstItem> = {}): EstItem => ({ id, qty: 1, supplierUnitPrice: null, legId: null, isService: false, ...over })
const legs: EstLeg[] = [
  { id: 'A', currency: 'EUR' },
  { id: 'B', currency: 'USD' },
  { id: 'C', currency: 'PKR' },
]
const rates = { EUR: { rate: 320, ageDays: 0 }, USD: { rate: 280, ageDays: 2 } }

describe('estimateExpectedCost (supplier prices x today\'s rate)', () => {
  it('sums qty x supplier price per leg currency at today\'s rate', () => {
    const e = estimateExpectedCost({
      items: [item('1', { qty: 6, supplierUnitPrice: 214, legId: 'A' }), item('2', { qty: 4, supplierUnitPrice: 286.5, legId: 'A' }), item('3', { qty: 10, supplierUnitPrice: 3450, legId: 'C' })],
      legs,
      pos: [],
      rates,
    })
    expect(e.legs.find(l => l.legId === 'A')).toMatchObject({ amount: 2430, currency: 'EUR', pkr: 777600, source: 'prices' })
    expect(e.legs.find(l => l.legId === 'C')).toMatchObject({ amount: 34500, pkr: 34500 })
    expect(e.pkr).toBe(812100)
    expect(e.linesWithoutPrice).toBe(0)
    expect(e.unconverted).toEqual([])
  })

  it('uses the PO line instead of the item price once a PO has been issued', () => {
    const pos: EstPo[] = [{ legId: 'A', currency: 'EUR', lines: [{ orderItemId: '1', qty: 6, unitPrice: 200 }] }]
    const e = estimateExpectedCost({ items: [item('1', { qty: 6, supplierUnitPrice: 214, legId: 'A' }), item('2', { qty: 1, supplierUnitPrice: 100, legId: 'A' })], legs, pos, rates })
    // line 1 from the PO (6 x 200 = 1,200), line 2 added after the PO from its own price (100)
    expect(e.legs[0]).toMatchObject({ amount: 1300, source: 'po and prices' })
  })

  it('counts goods lines with no supplier price, and never service lines', () => {
    const e = estimateExpectedCost({
      items: [item('1', { supplierUnitPrice: 10, legId: 'C' }), item('2', { legId: 'B' }), item('3', { supplierUnitPrice: 5 }), item('4', { isService: true, supplierUnitPrice: 999, legId: 'C' })],
      legs,
      pos: [],
      rates,
    })
    expect(e.linesWithoutPrice).toBe(2) // item 2 has no price, item 3 is on no leg
    expect(e.pkr).toBe(10)
  })

  it('leaves a leg out when its currency has no usable rate, and says which', () => {
    const e = estimateExpectedCost({
      items: [item('1', { supplierUnitPrice: 100, legId: 'B' }), item('2', { supplierUnitPrice: 50, legId: 'C' })],
      legs,
      pos: [],
      rates: { USD: { rate: 280, ageDays: 31 } },
    })
    expect(e.pkr).toBe(50)
    expect(e.unconverted).toEqual(['USD'])
    expect(e.legs.find(l => l.legId === 'B')?.pkr).toBeNull()
  })

  it('has no figure at all when nothing can be converted', () => {
    expect(estimateExpectedCost({ items: [item('1', { supplierUnitPrice: 100, legId: 'B' })], legs, pos: [], rates: {} }).pkr).toBeNull()
    expect(estimateExpectedCost({ items: [], legs, pos: [], rates }).pkr).toBeNull()
  })

  it('A8: one RFQ item split over two suppliers is two lines with their own supplier, price and currency', () => {
    // both order items came from the same RFQ item; each sits on its own leg
    const e = estimateExpectedCost({
      items: [item('x1', { qty: 3, supplierUnitPrice: 100, legId: 'A' }), item('x2', { qty: 2, supplierUnitPrice: 90, legId: 'B' })],
      legs,
      pos: [],
      rates,
    })
    expect(e.legs).toHaveLength(2)
    expect(e.pkr).toBe(300 * 320 + 180 * 280)
  })
})

describe('stillOwedOnLeg (Pay supplier pre-fill)', () => {
  const est = (pkr: number | null, currency = 'PKR') => ({ pkr, legs: [{ legId: 'L', currency, amount: 1000, source: 'po' as const, pkr }], linesWithoutPrice: 0, unconverted: [] })
  it('is the PO total less what is paid', () => {
    expect(stillOwedOnLeg(est(1000), 'L', 400)).toEqual({ amount: 600, note: 'Still owed: PO total PKR 1,000, less PKR 400 paid' })
  })
  it('labels a foreign currency as about, at today', () => {
    expect(stillOwedOnLeg(est(280000, 'EUR'), 'L', 0)?.note).toBe('Still owed: PO total EUR 1,000, about PKR 280,000 today')
  })
  it('offers nothing when paid in full or not convertible', () => {
    expect(stillOwedOnLeg(est(1000), 'L', 1000)).toBeNull()
    expect(stillOwedOnLeg(est(null, 'EUR'), 'L', 0)).toBeNull()
    expect(stillOwedOnLeg(est(1000), 'other', 0)).toBeNull()
  })
})
