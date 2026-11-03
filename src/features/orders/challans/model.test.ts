import { describe, expect, it } from 'vitest'
import type { OrderItemRow } from '@/features/orders/api'
import { defaultDeliverTo, isPartial, parseLines, pickPayload, pickProblem, startPick, toChallan } from '@/features/orders/challans/model'

const item = (over: Partial<OrderItemRow>): OrderItemRow =>
  ({ id: 'i1', number: 1, description: 'Pressure transmitter', brandName: null, model: null, qty: 6, unit: 'pcs', isService: false, legId: null, rfqItemId: null, unitPriceNet: 1500, gstRate: 18, supplierUnitPrice: 900, ...over }) as OrderItemRow

describe('delivery challan lines', () => {
  it('start as every goods line at its full quantity; a service line is never on a challan', () => {
    const lines = startPick([item({ id: 'a' }), item({ id: 'b', isService: true, description: 'Commissioning' }), item({ id: 'c', qty: 2.5, unit: 'm' })])
    expect(lines.map(l => [l.itemId, l.include, l.qty])).toEqual([
      ['a', true, '6'],
      ['c', true, '2.5'],
    ])
  })

  it('carry no price at all', () => {
    const [line] = startPick([item({})])
    expect(JSON.stringify(line)).not.toMatch(/price|1500|900|gst/i)
  })

  it('send only the ticked lines with their quantities', () => {
    const lines = startPick([item({ id: 'a' }), item({ id: 'c', qty: 3 })]).map(l => (l.itemId === 'a' ? { ...l, qty: '4' } : { ...l, include: false }))
    expect(pickPayload(lines)).toEqual([{ item_id: 'a', qty: 4 }])
    expect(isPartial(lines)).toBe(true)
  })

  it('send nothing when nothing is ticked or a quantity is wrong', () => {
    const lines = startPick([item({ id: 'a' })])
    expect(pickPayload(lines.map(l => ({ ...l, include: false })))).toEqual([])
    expect(pickPayload(lines.map(l => ({ ...l, qty: '' })))).toEqual([])
    expect(pickPayload(lines.map(l => ({ ...l, qty: '7' })))).toEqual([])
    expect(pickPayload(lines.map(l => ({ ...l, qty: '0' })))).toEqual([])
  })

  it('say what is wrong with a quantity', () => {
    const [l] = startPick([item({})])
    expect(pickProblem({ ...l, qty: '' })).toBe('Enter how many.')
    expect(pickProblem({ ...l, qty: '9' })).toBe('The order has 6.')
    expect(pickProblem({ ...l, qty: '6' })).toBeNull()
    expect(pickProblem({ ...l, include: false, qty: 'x' })).toBeNull()
  })

  it('a challan of everything is not a part delivery', () => {
    expect(isPartial(startPick([item({})]))).toBe(false)
  })
})

describe('reading a challan', () => {
  it('reads the lines and leaves out what it cannot read', () => {
    expect(parseLines([{ item_id: 'a', description: 'X', unit: 'pcs', qty: 2 }, { description: 'Y', qty: 'bad' }, { qty: 1 }])).toEqual([{ itemId: 'a', description: 'X', unit: 'pcs', qty: 2 }])
    expect(parseLines(null)).toEqual([])
  })

  it('maps the row', () => {
    const c = toChallan({ id: 'c1', order_id: 'o1', number: 'DC-0007', issued_on: '2026-10-30', deliver_to: null, notes: null, lines: [{ description: 'X', qty: 1 }] })
    expect(c).toMatchObject({ number: 'DC-0007', issuedOn: '2026-10-30', lines: [{ description: 'X', qty: 1, unit: null }] })
  })

  it('offers the site as the place to deliver to', () => {
    expect(defaultDeliverTo({ site: { name: 'Plant 2', address: 'Wah Cantt' } })).toBe('Plant 2\nWah Cantt')
    expect(defaultDeliverTo({ site: null })).toBe('')
  })
})
