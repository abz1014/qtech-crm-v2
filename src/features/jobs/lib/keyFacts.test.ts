import { describe, expect, it } from 'vitest'
import { jobKeyFacts, type KeyFactLeg } from '@/features/jobs/lib/keyFacts'

const leg = (over: Partial<KeyFactLeg> = {}): KeyFactLeg => ({ supplierName: 'Acme', placedOn: null, expectedOn: null, deliveredOn: null, ...over })
const get = (facts: ReturnType<typeof jobKeyFacts>, key: string) => facts.find(f => f.key === key)?.value
const run = (legs: KeyFactLeg[] | undefined, over: Partial<Parameters<typeof jobKeyFacts>[0]> = {}) =>
  jobKeyFacts({ order: { customerPo: 'PO-77' }, legs, money: true, cancelled: false, today: '2026-11-03', ...over })

describe('jobKeyFacts', () => {
  it('po: the number, or Not recorded', () => {
    expect(get(run([]), 'po')).toBe('PO-77')
    expect(get(run([], { order: { customerPo: null } }), 'po')).toBe('Not recorded')
    expect(get(run([], { order: { customerPo: '  ' } }), 'po')).toBe('Not recorded')
  })
  it('an engineer gets no po fact at all', () => {
    const f = run([leg()], { money: false })
    expect(f.map(x => x.key)).toEqual(['supplier', 'delivery'])
    expect(JSON.stringify(f)).not.toContain('PO-77')
  })
  it('loading: null values', () => {
    const f = jobKeyFacts({ order: undefined, legs: undefined, money: true, cancelled: false })
    expect(f.map(x => x.value)).toEqual([null, null, null])
  })
  it('supplier wording', () => {
    expect(get(run([]), 'supplier')).toBe('Not chosen yet')
    expect(get(run([], { servicesOnly: true }), 'supplier')).toBe('No goods')
    expect(get(run([leg(), leg()]), 'supplier')).toBe('Acme')
    expect(get(run([leg(), leg({ supplierName: 'Beta' })]), 'supplier')).toBe('Acme, Beta')
    expect(get(run([leg(), leg({ supplierName: 'Beta' }), leg({ supplierName: 'Gamma' }), leg({ supplierName: 'Delta' })]), 'supplier')).toBe('Acme, Beta +2 more')
  })
  it('delivery wording', () => {
    expect(get(run([]), 'delivery')).toBe('Not ordered from the supplier yet')
    expect(get(run([leg()]), 'delivery')).toBe('Not ordered from the supplier yet')
    expect(get(run([], { servicesOnly: true }), 'delivery')).toBe('No goods')
    expect(get(run([leg({ placedOn: '2026-10-30' })]), 'delivery')).toBe('Ordered')
    expect(get(run([leg({ placedOn: '2026-10-30', expectedOn: '2026-11-20' }), leg({ placedOn: '2026-10-30', expectedOn: '2026-11-10' })]), 'delivery')).toBe('Ordered, expected 10 Nov')
    expect(get(run([leg({ placedOn: '2026-10-30', deliveredOn: '2026-11-02' }), leg({ placedOn: '2026-10-30' })]), 'delivery')).toBe('1 of 2 delivered')
    expect(get(run([leg({ placedOn: '2026-10-30', deliveredOn: '2026-11-01' }), leg({ placedOn: '2026-10-30', deliveredOn: '2026-11-02' })]), 'delivery')).toBe('Delivered 2 Nov')
  })
  it('a cancelled order says so; a leg cancelled with the supplier is ignored', () => {
    expect(get(run([leg({ placedOn: '2026-10-30' })], { cancelled: true }), 'delivery')).toBe('Order cancelled')
    const f = run([leg({ placedOn: '2026-10-30', deliveredOn: '2026-11-02' }), leg({ supplierName: 'Gone', placedOn: '2026-10-30', cancelledWithSupplierOn: '2026-11-01' })])
    expect(get(f, 'delivery')).toBe('Delivered 2 Nov')
    expect(get(f, 'supplier')).toBe('Acme')
  })
})
