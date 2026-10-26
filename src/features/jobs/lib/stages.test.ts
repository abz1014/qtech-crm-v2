import { describe, expect, it } from 'vitest'
import { currentStopIndex, stageModel, STOPS } from '@/features/jobs/lib/stages'

const model = (stage: string, stageDetail: string | null = null, kind: 'enquiry' | 'direct' = 'enquiry') => stageModel({ stage, stageDetail, kind })
const states = (m: ReturnType<typeof stageModel>) => m.stops.map(s => s.state)

describe('the seven stops', () => {
  it('has the seven stops of the plan, in order', () => {
    expect([...STOPS]).toEqual(['Enquiry', 'Quotation', 'Order', 'Supplier order', 'Delivery', 'Invoice', 'Payment'])
  })

  it('the current stop is the earliest one not finished, for every stage word the database sends', () => {
    expect(currentStopIndex('enquiry', null)).toBe(0)
    expect(currentStopIndex('asking_suppliers', '1 of 3 suppliers replied')).toBe(1)
    expect(currentStopIndex('prices_in', '2 of 3 items priced')).toBe(1)
    expect(currentStopIndex('quoted', 'waiting for the customer')).toBe(2)
    expect(currentStopIndex('ordered', 'to source')).toBe(3)
    expect(currentStopIndex('supplier_ordered', 'with the supplier')).toBe(3)
    expect(currentStopIndex('supplier_ordered', 'supplier late')).toBe(3)
    expect(currentStopIndex('supplier_ordered', 'arrived, not delivered')).toBe(4)
    expect(currentStopIndex('supplier_ordered', '2 of 3 delivered')).toBe(4)
    expect(currentStopIndex('delivered', 'not invoiced yet')).toBe(5)
    expect(currentStopIndex('invoiced', 'not paid yet')).toBe(6)
    expect(currentStopIndex('paid', null)).toBe(7)
    expect(currentStopIndex('lost', 'price too high')).toBeNull()
    expect(currentStopIndex('cancelled', 'order cancelled')).toBeNull()
  })

  it('Job 139 in the mockup: the supplier order is placed and the goods are late, so it reads "Stage 4 of 7 · Supplier order"', () => {
    const m = model('supplier_ordered', 'supplier late, advance received')
    expect(m.phoneLabel).toBe('Stage 4 of 7 · Supplier order')
    expect(states(m)).toEqual(['done', 'done', 'done', 'current', 'future', 'future', 'future'])
    expect(m.stops[3].note).toBe('supplier late')
    // the advance is a parallel state under Payment, drawn as a half-filled stop, and does not move the bar
    expect(m.stops[6].note).toBe('advance received')
    expect(m.stops[6].half).toBe(true)
  })

  it('draws the parallel states under their stop: "2 of 3 delivered", partly invoiced, installation', () => {
    expect(model('supplier_ordered', '2 of 3 delivered').stops[4].note).toBe('2 of 3 delivered')
    expect(model('delivered', 'partly invoiced').stops[5].note).toBe('partly invoiced')
    const inst = model('delivered', 'not invoiced yet, installation planned 28 Oct')
    expect(inst.stops[4].note).toBe('installation planned 28 Oct')
    expect(inst.stops[5].note).toBe('not invoiced yet')
    expect(model('supplier_ordered', 'with the supplier, invoiced').stops[5].note).toBe('invoiced')
  })

  it('a job with an order and no enquiry (O-45) starts at Order: Enquiry and Quotation are "none"', () => {
    const m = model('ordered', 'supplier order to place', 'direct')
    expect(states(m)).toEqual(['none', 'none', 'done', 'current', 'future', 'future', 'future'])
    expect(m.phoneLabel).toBe('Stage 4 of 7 · Supplier order')
  })

  it('a lost job ends with its reason and nothing is current', () => {
    const m = model('lost', 'price too high')
    expect(m.ending).toBe('Lost: price too high')
    expect(m.current).toBeNull()
    expect(m.stops.some(s => s.state === 'current')).toBe(false)
    expect(m.phoneLabel).toBe('Lost: price too high')
  })

  it('a cancelled order ends the ruler with its words', () => {
    expect(model('cancelled', 'order cancelled, money still open').ending).toBe('Order cancelled, money still open')
  })

  it('a paid job has every stop done', () => {
    const m = model('paid')
    expect(states(m)).toEqual(Array(7).fill('done'))
    expect(m.finished).toBe(true)
  })

  it('an unknown or missing stage does not crash the page', () => {
    expect(stageModel({ stage: null, stageDetail: null, kind: 'enquiry' }).current).toBeNull()
  })
})
