import { afterEach, describe, expect, it } from 'vitest'
import { checkedKey, openFindings, setChecked } from '@/features/money/exceptions/checked'
import type { ReconciliationException } from '@/lib/reconciliation'

const f = (key: string, message: string): ReconciliationException => ({ key, message, severity: 'warning', category: 'Costs exceed expected', orderId: 'o1' })

afterEach(() => window.localStorage.clear())

describe('Mark as checked (round 3)', () => {
  it('takes a finding off the open list for that person only', () => {
    const a = f('a', 'ORD-0005: costs 1,480,000 are above expected 640,000')
    const b = f('b', 'ORD-0007: paid twice')
    setChecked(checkedKey('u1', a), true)
    expect(openFindings('u1', [a, b]).map(e => e.key)).toEqual(['b'])
    expect(openFindings('u2', [a, b]).map(e => e.key)).toEqual(['a', 'b'])
  })

  it('comes back by itself when the figures behind it change (the message changes)', () => {
    const a = f('a', 'ORD-0005: costs 1,480,000 are above expected 640,000')
    setChecked(checkedKey('u1', a), true)
    const later = f('a', 'ORD-0005: costs 1,600,000 are above expected 640,000')
    expect(openFindings('u1', [later]).map(e => e.key)).toEqual(['a'])
  })

  it('Put back undoes it', () => {
    const a = f('a', 'x')
    setChecked(checkedKey('u1', a), true)
    setChecked(checkedKey('u1', a), false)
    expect(openFindings('u1', [a])).toHaveLength(1)
  })
})
