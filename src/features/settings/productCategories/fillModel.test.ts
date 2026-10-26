import { describe, expect, it } from 'vitest'
import { BATCH_SIZE, fillBatches, planFill, planSummary } from '@/features/settings/productCategories/fillModel'

const families = [
  { id: 'f-con', name: 'Contactors' },
  { id: 'f-pt', name: 'Pressure transmitters' },
  { id: 'f-mcb', name: 'MCB' },
]
const row = (id: string, description: string) => ({ id, description })

describe('fill missing categories: the plan', () => {
  it('groups the items by the category the dictionary names, rfq items and order items apart', () => {
    const plan = planFill(
      [row('r1', 'Contactor 3P 25A'), row('r2', 'Pressure transmitter 0-10 bar'), row('r3', 'contactor 40A')],
      [row('o1', 'Contactor 3P 25A'), row('o2', 'MCB 16A 1P')],
      families,
    )
    expect(plan.groups.map(g => [g.name, g.rfqItemIds, g.orderItemIds])).toEqual([
      ['Contactors', ['r1', 'r3'], ['o1']],
      ['MCB', [], ['o2']],
      ['Pressure transmitters', ['r2'], []],
    ])
    expect(plan.total).toBe(5)
    expect(plan.scanned).toBe(5)
    expect(planSummary(plan)).toBe('5 items in 3 categories')
  })

  it('counts what it will not fill: unrecognised text, an unsure answer, a category that is not on file', () => {
    const plan = planFill([row('a', 'something unusual'), row('b', 'Contactor 25A')], [row('c', 'Flow meter DN50')], [{ id: 'f-con', name: 'Contactors' }])
    expect(plan.groups.map(g => g.name)).toEqual(['Contactors'])
    expect(plan.unknown).toBe(2)
    expect(plan.total).toBe(1)
  })

  it('an empty database makes an empty plan', () => {
    const plan = planFill([], [], families)
    expect(plan).toEqual({ groups: [], unsure: 0, unknown: 0, total: 0, scanned: 0 })
    expect(planSummary(plan)).toBe('0 items in 0 categories')
    expect(fillBatches(plan)).toEqual([])
  })
})

describe('fill missing categories: the batches', () => {
  it('writes at most 200 ids at a time, rfq items first, one category after another', () => {
    const many = Array.from({ length: 450 }, (_, n) => row(`r${n}`, 'Contactor 25A'))
    const plan = planFill(many, [row('o1', 'Contactor 25A')], families)
    const batches = fillBatches(plan)
    expect(BATCH_SIZE).toBe(200)
    expect(batches.map(b => [b.table, b.ids.length])).toEqual([['rfq_items', 200], ['rfq_items', 200], ['rfq_items', 50], ['order_items', 1]])
    expect(new Set(batches.flatMap(b => b.ids)).size).toBe(451)
  })
})
