import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { fetchFirstUse, isNewOn, type FirstUseFacts } from '@/features/help/firstUseApi'
import { firstWeekRows, inFirstWeeks } from '@/features/help/firstWeek'
import { fetchFirstWeek } from '@/features/help/firstWeekApi'

const none: FirstUseFacts = { ownsRfq: false, ownsOrder: false, onJob: false, companyHasInvoice: true, ownerAlone: false }

describe('isNewOn (learnability 1.1)', () => {
  it('sales is new on Today until they own an RFQ or an order', () => {
    expect(isNewOn('today', 'sales', none)).toBe(true)
    expect(isNewOn('today', 'sales', { ...none, ownsOrder: true })).toBe(false)
  })
  it('engineers are new until put on a job, on Today and Orders', () => {
    expect(isNewOn('today', 'engineer', none)).toBe(true)
    expect(isNewOn('orders', 'engineer', { ...none, onJob: true })).toBe(false)
  })
  it('admin is new while there is no invoice or the owner is alone', () => {
    expect(isNewOn('today', 'admin', none)).toBe(false)
    expect(isNewOn('today', 'admin', { ...none, companyHasInvoice: false })).toBe(true)
    expect(isNewOn('today', 'admin', { ...none, ownerAlone: true })).toBe(true)
  })
  it('the RFQ board and Orders look at what the person owns', () => {
    expect(isNewOn('rfqs', 'sales', { ...none, ownsOrder: true })).toBe(true)
    expect(isNewOn('orders', 'sales', { ...none, ownsRfq: true })).toBe(true)
  })
})

let uninstall = () => {}
afterEach(() => uninstall())

describe('fetchFirstUse', () => {
  it('runs head counts only the role can read', async () => {
    const counts: Record<string, number> = { rfqs: 0, orders: 0, order_engineers: 1 }
    const fake = installFakeDb((c: FakeCall) => ({ count: counts[c.target] ?? 0 }))
    uninstall = fake.uninstall
    const f = await fetchFirstUse('u1', 'engineer')
    expect(f.onJob).toBe(true)
    expect(fake.calls.map(c => c.target).sort()).toEqual(['order_engineers', 'orders', 'rfqs'])
  })

  it('finds the owner alone', async () => {
    const fake = installFakeDb((c: FakeCall) => ({ count: c.target === 'users' ? 1 : 0 }))
    uninstall = fake.uninstall
    expect((await fetchFirstUse('u1', 'admin')).ownerAlone).toBe(true)
  })
})

describe('first-week checklist (learnability 5.1)', () => {
  const now = new Date('2026-10-20T10:00:00Z')
  const m = { id: 'u1', role: 'sales', phone: '0300', created_at: '2026-10-15T00:00:00Z', deactivated_at: null }

  it('shows for 14 days after someone is added, for active people', () => {
    expect(inFirstWeeks(m, now)).toBe(true)
    expect(inFirstWeeks({ ...m, created_at: '2026-09-01T00:00:00Z' }, now)).toBe(false)
    expect(inFirstWeeks({ ...m, deactivated_at: '2026-10-16' }, now)).toBe(false)
  })

  it('marks items from the facts and the phone', () => {
    const rows = firstWeekRows(m, { u1: { rfq: '2026-10-16T09:00:00Z' } })
    expect(rows.filter(r => r.doneOn).map(r => r.id)).toEqual(['phone', 'rfq'])
    expect(rows).toHaveLength(6)
  })

  it('keeps the earliest date per person and item', async () => {
    const fake = installFakeDb((c: FakeCall) =>
      c.target === 'rfqs'
        ? { data: [{ created_by: 'u1', created_at: '2026-10-17' }, { created_by: 'u1', created_at: '2026-10-16' }] }
        : { data: [] },
    )
    uninstall = fake.uninstall
    const facts = await fetchFirstWeek([{ id: 'u1', role: 'sales' }])
    expect(facts.u1?.rfq).toBe('2026-10-16')
    expect(fake.calls.some(c => c.target === 'payments_in')).toBe(false)
  })
})
