import { describe, expect, it } from 'vitest'
import { owedByPerson, type Claim } from './claimsApi'

const claim = (o: Partial<Claim>): Claim => ({
  id: 'c', createdAt: '2026-10-01T00:00:00Z', createdBy: 'u1', byName: 'Bilal Engineer', spentOn: '2026-10-01', amount: 100, note: null, orderId: null, orderLabel: null,
  status: 'owed', paidHow: null, rejectReason: null, decidedAt: null, ...o,
})

describe('owed to staff (process audit 5)', () => {
  it('adds up what is owed to each person, largest first', () => {
    const rows = owedByPerson([
      claim({ id: 'a', amount: 700.5 }),
      claim({ id: 'b', amount: 299.5 }),
      claim({ id: 'c', createdBy: 'u2', byName: 'Sana Sales', amount: 2000 }),
    ])
    expect(rows).toEqual([
      { personId: 'u2', name: 'Sana Sales', total: 2000, count: 1 },
      { personId: 'u1', name: 'Bilal Engineer', total: 1000, count: 2 },
    ])
  })

  it('has nothing to show when nothing is owed', () => {
    expect(owedByPerson([])).toEqual([])
  })
})
