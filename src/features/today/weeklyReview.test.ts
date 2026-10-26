import { describe, expect, it } from 'vitest'
import { addDays } from '@/features/rfqs/lib/dateText'
import { buildReview, isMonday, reviewCount, REVIEW_RULE } from './weeklyReview'
import { ruleWeeklyReview } from './rules'
import type { LegFact, ReceivableFact, RfqFact, TodayInputs } from './types'

/*
 * The weekly owner review (P3-C1): what lands on it, what "Still live" hides, and the Monday row (admin only, only when there is
 * something to decide). Monday 26 Oct 2026. Fictional data.
 */
const MON = '2026-10-26'
const ago = (n: number) => addDays(MON, -n) as string
const rfq = (n: number, o: Partial<RfqFact>): RfqFact => ({
  id: `rv-rfq-${n}`, number: n, ownerId: 'u-sales', companyName: `Review Customer ${n}`, customerRef: null, receivedOn: ago(1), dueOn: null, dueTime: null,
  quotedOn: null, isPriority: false, bidState: 'to_bid', sourcingState: 'covered', quotationValidUntil: null, ...o,
})
const leg = (n: number, o: Partial<LegFact>): LegFact => ({
  id: `rv-leg-${n}`, orderId: `rv-ord-${n}`, orderNumber: n, ownerId: 'u-sales', customerName: `Review Customer ${n}`, supplierName: 'Fictional Supplier', reference: null,
  orderedOn: ago(60), placedOn: ago(50), expectedOn: ago(20), receivedOn: null, deliveredOn: null, lastChasedOn: null, chaseCount: 0, ...o,
})
const pay = (n: number, o: Partial<ReceivableFact>): ReceivableFact => ({
  orderId: `rv-pay-${n}`, orderNumber: n, ownerId: 'u-sales', customerName: `Review Customer ${n}`, balance: 100000, settled: 0, dueOn: ago(45), isOverdue: true, lastRemindedOn: null, reminderCount: 0, ...o,
})
const inputs = (): Pick<TodayInputs, 'today' | 'rfqs' | 'legs' | 'receivables' | 'snoozes'> => ({
  today: MON,
  rfqs: [
    rfq(1, { bidState: 'bid_sent', quotedOn: ago(20) }), // sent 14 working days ago: on the review
    rfq(2, { bidState: 'bid_sent', quotedOn: ago(7) }), // 5 working days: too soon
    rfq(3, { sourcingState: 'not_floated', receivedOn: ago(12) }), // no supplier asked, 12 days
    rfq(4, { sourcingState: 'not_floated', receivedOn: ago(5) }), // too soon
  ],
  legs: [leg(1, {}), leg(2, { expectedOn: ago(10) }), leg(3, { legacy: true }), leg(4, { deliveredOn: ago(1) })],
  receivables: [pay(1, {}), pay(2, { dueOn: ago(20) }), pay(3, { legacy: true }), pay(4, { isOverdue: false })],
  snoozes: [],
})

describe('what lands on the weekly review', () => {
  const r = buildReview(inputs())
  it('quotations with no decision after 10 working days', () => expect(r.quotation.map(x => x.subjectId)).toEqual(['rv-rfq-1']))
  it('enquiries with no supplier asked after 10 days', () => expect(r.enquiry.map(x => x.subjectId)).toEqual(['rv-rfq-3']))
  it('goods more than 14 days late, not imported, not delivered', () => expect(r.goods.map(x => x.subjectId)).toEqual(['rv-leg-1']))
  it('payments more than 30 days late, not imported', () => {
    expect(r.payment.map(x => x.subjectId)).toEqual(['rv-pay-1'])
    expect(r.payment[0].amount).toBe(100000)
    expect(r.payment[0].tone).toBe('danger')
  })
  it('counts them all', () => expect(reviewCount(r)).toBe(4))
  it('says how long in words, with dates a person reads', () => {
    expect(r.quotation[0].detail).toMatch(/^Quotation sent \w{3} \d{1,2} \w{3}, \d+ working days ago$/)
    expect(r.goods[0].detail).toMatch(/days late$/)
  })
})

describe('Still live', () => {
  it('hides the row while its snooze runs, per kind', () => {
    const i = inputs()
    i.snoozes = [{ rule: REVIEW_RULE.quotation, subjectId: 'rv-rfq-1', untilOn: addDays(MON, 14) as string }]
    const r = buildReview(i)
    expect(r.quotation).toEqual([])
    expect(r.enquiry).toHaveLength(1)
  })
  it('a snooze of another kind, or one that ended, hides nothing', () => {
    const i = inputs()
    i.snoozes = [
      { rule: REVIEW_RULE.enquiry, subjectId: 'rv-rfq-1', untilOn: addDays(MON, 14) as string },
      { rule: REVIEW_RULE.quotation, subjectId: 'rv-rfq-1', untilOn: MON },
    ]
    expect(buildReview(i).quotation).toHaveLength(1)
  })
})

describe('the Monday row', () => {
  const ctx = (role: 'admin' | 'sales' | 'engineer', today = MON): TodayInputs => ({
    ...inputs(), today, user: { id: 'u-admin', role }, roleOf: () => null, clarifications: [], inquiries: [], orders: [], monthEnd: null,
  })
  it('is one row for the admin on a Monday, with the number to decide', () => {
    expect(isMonday(MON)).toBe(true)
    const rows = ruleWeeklyReview(ctx('admin'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rule: 'weekly_review', title: 'Weekly review: 4 to decide', href: '/todo/review', group: 'now' })
  })
  it('is not there on other days, for sales, for an engineer, or when there is nothing to decide', () => {
    expect(ruleWeeklyReview({ ...ctx('admin'), today: '2026-10-27' })).toEqual([])
    expect(ruleWeeklyReview(ctx('sales'))).toEqual([])
    expect(ruleWeeklyReview(ctx('engineer'))).toEqual([])
    expect(ruleWeeklyReview({ ...ctx('admin'), rfqs: [], legs: [], receivables: [] })).toEqual([])
  })
})
