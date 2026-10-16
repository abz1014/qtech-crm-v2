import { describe, expect, it } from 'vitest'
import { marginNote, marginTotals, sortMargins, type MarginRow } from '@/features/money/margins/model'

const row = (n: number, over: Partial<MarginRow> = {}): MarginRow => ({
  orderId: `o${n}`,
  orderNumber: n,
  companyName: 'Acme',
  orderedOn: '2026-11-01',
  basis: 'invoice',
  netSale: 1000,
  expectedCost: 700,
  actualCost: 600,
  margin: 400,
  state: 'final',
  ...over,
})

describe('marginTotals (only costs-complete orders are added up)', () => {
  it('adds up the complete orders and counts the rest', () => {
    const t = marginTotals([
      row(1),
      row(2, { netSale: 500, expectedCost: 300, actualCost: 350, margin: 150 }),
      row(3, { state: 'provisional', margin: 999 }),
      row(4, { state: 'basis_unknown', netSale: null, margin: null }),
    ])
    expect(t).toEqual({ orders: 2, netSale: 1500, expectedCost: 1000, actualCost: 950, margin: 550, provisional: 1, basisUnknown: 1 })
  })

  it('a provisional margin never enters a total, however large', () => {
    expect(marginTotals([row(1, { state: 'provisional', margin: 1_000_000 })]).margin).toBe(0)
  })

  it('an order with no expected cost adds nothing to the expected total', () => {
    expect(marginTotals([row(1, { expectedCost: null })]).expectedCost).toBe(0)
  })
})

describe('sortMargins', () => {
  it('lists the newest order first', () => {
    const list = sortMargins([row(1, { orderedOn: '2026-10-01' }), row(2, { orderedOn: '2026-11-05' }), row(3, { orderedOn: '2026-11-05' })])
    expect(list.map(r => r.orderNumber)).toEqual([3, 2, 1])
  })
})

describe('marginNote', () => {
  it('says what is left out, in counts', () => {
    const n = marginNote({ orders: 2, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 3, basisUnknown: 1 })
    expect(n).toBe('Only orders with costs marked complete are totalled. The 3 provisional margins are shown so you can see the trend, but they are not added up, and the order with an unknown price basis is left out until someone resolves it.')
  })
  it('handles only provisional, only unknown, and neither', () => {
    expect(marginNote({ orders: 1, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 1, basisUnknown: 0 })).toBe(
      'Only orders with costs marked complete are totalled. The 1 provisional margin is shown so you can see the trend, but it is not added up.',
    )
    expect(marginNote({ orders: 1, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 0, basisUnknown: 2 })).toBe(
      'Only orders with costs marked complete are totalled. The 2 orders with an unknown price basis are left out until someone resolves them.',
    )
    expect(marginNote({ orders: 1, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 0, basisUnknown: 0 })).toBe('Only orders with costs marked complete are totalled.')
  })
  it('never prints a percentage', () => {
    expect(marginNote({ orders: 2, netSale: 0, expectedCost: 0, actualCost: 0, margin: 0, provisional: 3, basisUnknown: 1 })).not.toContain('%')
  })
})
