import { describe, expect, it } from 'vitest'
import { buildToday, ruleJobCommissioning, ruleJobOnSite } from './rules'
import type { JobFact, Role, TodayInputs } from './types'

/*
 * An engineer's own jobs on Today (owner decision 2026-10-19, audit E1): the orders they are ASSIGNED to (order_engineers),
 * not only the ones they own. 2026-11-27 is a Friday.
 */
const TODAY = '2026-11-27'
const ENG = 'u-eng'

const job = (o: Partial<JobFact> = {}): JobFact => ({
  orderId: 'o1',
  orderNumber: 41,
  ownerId: 'u-sales',
  customerName: 'Indus Textile Mills',
  siteName: 'Faisalabad plant',
  goodsState: 'delivered',
  commissioningState: 'planned',
  plannedOn: '2026-12-01',
  deliveredOn: '2026-11-24',
  ...o,
})

const ctx = (jobs: JobFact[], role: Role = 'engineer', o: Partial<TodayInputs> = {}): TodayInputs => ({
  today: TODAY,
  user: { id: ENG, role },
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

describe('rule: commissioning on an assigned order (engineers)', () => {
  it('shows commissioning planned within the next 5 working days, dated on the day, with the customer and the site', () => {
    const [e, ...rest] = ruleJobCommissioning(ctx([job()]))
    expect(rest).toEqual([])
    expect(e).toMatchObject({
      rule: 'job_commissioning',
      title: 'Commissioning on Tuesday 1 December',
      ref: 'ORD-0041',
      party: 'Indus Textile Mills, Faisalabad plant',
      actionDueOn: '2026-12-01',
      group: 'soon',
      tab: 'sourcing',
      href: '/orders/o1',
    })
  })
  it('words today and tomorrow, and keeps a missed date red until it is marked done or moved', () => {
    expect(ruleJobCommissioning(ctx([job({ plannedOn: TODAY })]))[0]).toMatchObject({ title: 'Commissioning today', group: 'now' })
    expect(ruleJobCommissioning(ctx([job({ plannedOn: '2026-11-28' })]))[0].title).toBe('Commissioning tomorrow')
    const late = ruleJobCommissioning(ctx([job({ plannedOn: '2026-11-25' })]))[0]
    expect(late).toMatchObject({ title: 'Commissioning was planned for Wednesday 25 November: mark it done or move it', group: 'now' })
    expect(late.badge).toEqual({ text: '2d late', tone: 'danger' })
  })
  it('stays quiet for a date further out, a done or unplanned job, and no date', () => {
    expect(ruleJobCommissioning(ctx([job({ plannedOn: '2026-12-11' })]))).toEqual([])
    expect(ruleJobCommissioning(ctx([job({ commissioningState: 'done' })]))).toEqual([])
    expect(ruleJobCommissioning(ctx([job({ commissioningState: 'to_plan', plannedOn: null })]))).toEqual([])
    expect(ruleJobCommissioning(ctx([job({ plannedOn: null })]))).toEqual([])
  })
  it('is for engineers only (admin and sales are routed by ownership, and never read assignments)', () => {
    expect(ruleJobCommissioning(ctx([job()], 'admin'))).toEqual([])
    expect(ruleJobCommissioning(ctx([job()], 'sales'))).toEqual([])
  })
})

describe('rule: goods delivered to site on an assigned order (engineers)', () => {
  it('asks for the commissioning date once the goods are on site, aged from the delivery', () => {
    const [e] = ruleJobOnSite(ctx([job({ commissioningState: 'to_plan', plannedOn: null })]))
    expect(e).toMatchObject({ rule: 'job_on_site', title: 'Goods delivered to site: set the commissioning date', group: 'ready', badge: { text: '3d old', tone: 'neutral' } })
    expect(ruleJobOnSite(ctx([job({ commissioningState: 'to_plan', goodsState: 'partly_delivered' })]))[0].title).toBe('Some goods delivered to site: set the commissioning date')
  })
  it('stays quiet before delivery, once a date is set, and on an order the engineer owns (Plan commissioning says it)', () => {
    expect(ruleJobOnSite(ctx([job({ commissioningState: 'to_plan', goodsState: 'on_order' })]))).toEqual([])
    expect(ruleJobOnSite(ctx([job({ commissioningState: 'planned' })]))).toEqual([])
    expect(ruleJobOnSite(ctx([job({ commissioningState: 'to_plan', ownerId: ENG })]))).toEqual([])
  })
})

describe("an engineer's Today with assigned jobs", () => {
  it('is no longer empty for jobs the engineer does not own, and a snooze hides one', () => {
    const jobs = [job(), job({ orderId: 'o2', orderNumber: 42, commissioningState: 'to_plan', plannedOn: null })]
    expect(buildToday(ctx(jobs)).active.map(i => i.rule)).toEqual(['job_commissioning', 'job_on_site'])
    const snoozed = buildToday(ctx(jobs, 'engineer', { snoozes: [{ rule: 'job_on_site', subjectId: 'o2', untilOn: '2026-12-01' }] }))
    expect(snoozed.active.map(i => i.rule)).toEqual(['job_commissioning'])
  })
})
