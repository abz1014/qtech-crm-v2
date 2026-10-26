import { describe, expect, it } from 'vitest'
import type { JobRow } from '@/features/jobs/api'
import { byRecent, chipCounts, defaultChip, inChip } from '@/features/jobs/lib/listModel'

const job = (over: Partial<JobRow>): JobRow => ({
  key: '1', kind: 'enquiry', rfqId: 'r', orderId: null, companyId: 'c', companyName: 'Customer', siteName: null, ownerId: 'u1', ownerName: 'A', items: 'x',
  stage: 'enquiry', stageDetail: null, isHistory: false, lastActivityOn: '2026-10-01', repeatOf: null, cancelledOrders: 0, engineerIds: [], ...over,
})
const me = { userId: 'u1', role: 'sales' as const }

describe('Jobs list chips', () => {
  const all = [job({ key: '1' }), job({ key: '2', ownerId: 'u2' }), job({ key: '3', isHistory: true, stage: 'paid' }), job({ key: 'O-4', ownerId: 'u2', engineerIds: ['u1'] })]
  it('History shows only is_history rows and Open and Mine never do', () => {
    expect(all.filter(j => inChip(j, 'history', me)).map(j => j.key)).toEqual(['3'])
    expect(all.filter(j => inChip(j, 'open', me)).map(j => j.key)).toEqual(['1', '2', 'O-4'])
    expect(all.filter(j => inChip(j, 'mine', me)).map(j => j.key)).toEqual(['1', 'O-4'])
  })
  it('counts each chip', () => {
    expect(chipCounts(all, me)).toEqual({ mine: 2, open: 3, history: 1 })
  })
  it('sales and engineers start on Mine, the admin on Open', () => {
    expect(defaultChip('sales')).toBe('mine')
    expect(defaultChip('engineer')).toBe('mine')
    expect(defaultChip('admin')).toBe('open')
  })
  it('sorts the newest activity first', () => {
    expect([job({ key: '1', lastActivityOn: '2026-01-01' }), job({ key: '2', lastActivityOn: '2026-02-01' })].sort(byRecent).map(j => j.key)).toEqual(['2', '1'])
  })
})
