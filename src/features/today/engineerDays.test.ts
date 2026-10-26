import { describe, expect, it } from 'vitest'
import { buildToday } from '@/features/today/rules'
import { engineerDayGroups } from '@/features/today/engineerDays'
import type { JobFact, RfqFact, TodayInputs } from '@/features/today/types'

// 2026-11-27 is a Friday.
const TODAY = '2026-11-27'
const job = (o: Partial<JobFact> = {}): JobFact => ({
  orderId: 'o1',
  orderNumber: 41,
  ownerId: 'u-sales',
  customerName: 'Alpenmark Controls',
  siteName: 'Plant 2',
  goodsState: 'delivered',
  commissioningState: 'planned',
  plannedOn: TODAY,
  deliveredOn: '2026-11-20',
  visitTime: null,
  visitType: null,
  ...o,
})
const ctx = (jobs: JobFact[], o: Partial<TodayInputs> = {}): TodayInputs => ({
  today: TODAY,
  user: { id: 'u-eng', role: 'engineer' },
  roleOf: () => null,
  rfqs: [],
  clarifications: [],
  inquiries: [],
  legs: [],
  orders: [],
  receivables: [],
  monthEnd: null,
  jobs,
  snoozes: [],
  ...o,
})

describe("an engineer's list by day", () => {
  it('groups Today, Tomorrow and later days, and says each row as time, type, customer, site', () => {
    const view = buildToday(
      ctx([
        job({ orderId: 'a', orderNumber: 50, plannedOn: '2026-11-30', visitType: 'service' }),
        job({ orderId: 'b', orderNumber: 41, visitTime: '14:00', visitType: 'survey' }),
        job({ orderId: 'c', orderNumber: 42, visitTime: '10:00', visitType: 'installation' }),
        job({ orderId: 'd', orderNumber: 43 }),
        job({ orderId: 'e', orderNumber: 44, plannedOn: '2026-11-28' }),
      ]),
    )
    const groups = engineerDayGroups(view, TODAY)
    expect(groups.map(g => g.title)).toEqual(['Today', 'Tomorrow', 'Mon 30 Nov'])
    expect(groups[0].items.map(i => i.title)).toEqual(['10:00 · Install · Alpenmark Controls · Plant 2', '14:00 · Survey · Alpenmark Controls · Plant 2', 'Alpenmark Controls · Plant 2'])
  })

  it('puts a missed day first, in words, and goods on site with no date last', () => {
    const view = buildToday(
      ctx([job({ orderId: 'a', plannedOn: '2026-11-25', visitTime: '09:00', visitType: 'installation' }), job({ orderId: 'b', orderNumber: 60, commissioningState: 'to_plan', plannedOn: null })]),
    )
    const groups = engineerDayGroups(view, TODAY)
    expect(groups.map(g => g.id)).toEqual(['now-missed', 'ready'])
    expect(groups[0].items[0].party).toMatch(/was planned for/)
  })
})

describe('no sales rule reaches an engineer', () => {
  it('an RFQ the engineer owns raises nothing: the list is their jobs only', () => {
    const rfq = { id: 'r1', number: 7, ownerId: 'u-eng', bidDueOn: TODAY, stage: 'sourcing', companyName: 'Alpenmark Controls' } as unknown as RfqFact
    const view = buildToday(ctx([], { rfqs: [rfq] }))
    expect(view.active).toEqual([])
    expect(view.waiting).toEqual([])
  })
})
