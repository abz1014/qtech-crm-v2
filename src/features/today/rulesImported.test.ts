import { describe, expect, it } from 'vitest'
import { buildToday } from './rules'
import { needsYouItems } from './needsYou'
import type { LegFact, OrderFact, ReceivableFact, Role, TodayInputs } from './types'

// Owner decision 2026-10-22 (1b): order tasks on an order imported from the old CRM wait in Today's grey "Imported, to review"
// fold, never counted, until the one-off Review imported (redesign phase 2). Its invoices are not linked to it yet, so "still
// to invoice" is not true. Money owed on an invoice (a late payment) is not an order task: it stays. Fictional data.
const TODAY = '2026-10-22'
const ME = 'u-admin'
const roles: Record<string, Role> = { [ME]: 'admin' }

const ctx = (o: Partial<TodayInputs> = {}): TodayInputs => ({
  today: TODAY,
  user: { id: ME, role: 'admin' },
  roleOf: id => (id ? (roles[id] ?? null) : null),
  rfqs: [],
  clarifications: [],
  inquiries: [],
  legs: [],
  orders: [],
  receivables: [],
  monthEnd: null,
  snoozes: [],
  ...o,
})
const ord = (o: Partial<OrderFact> = {}): OrderFact => ({
  id: 'o1',
  number: 38,
  ownerId: null,
  customerName: 'Fictional Customer',
  orderedOn: '2024-09-10',
  goodsState: 'delivered',
  commissioningState: 'n_a',
  invoicingState: 'not_invoiced',
  unsourced: 0,
  toInvoice: null,
  lastInvoicedOn: null,
  deliveredOn: '2024-10-01',
  ...o,
})
const leg = (o: Partial<LegFact> = {}): LegFact => ({
  id: 'l1',
  orderId: 'o9',
  orderNumber: 9,
  ownerId: null,
  customerName: 'Fictional Customer',
  supplierName: 'Fictional Supplier',
  reference: null,
  orderedOn: '2024-09-10',
  placedOn: '2024-09-12',
  expectedOn: '2024-12-01',
  receivedOn: null,
  deliveredOn: null,
  lastChasedOn: null,
  chaseCount: 0,
  ...o,
})
const rec = (o: Partial<ReceivableFact> = {}): ReceivableFact => ({
  orderId: 'i1',
  orderNumber: 13,
  ownerId: ME,
  customerName: 'Fictional Customer',
  balance: 297_000,
  settled: 0,
  dueOn: '2025-01-01',
  isOverdue: true,
  lastRemindedOn: null,
  reminderCount: 0,
  ...o,
})

const imported = ctx({
  orders: [
    ord({ id: 'i1', number: 13, invoicingState: 'part', toInvoice: 45_256, lastInvoicedOn: '2024-10-21', legacy: true }),
    ord({ id: 'i2', number: 11, invoicingState: 'not_invoiced', deliveredOn: '2026-05-04', legacy: true }),
    ord({ id: 'i3', number: 10, goodsState: 'to_source', unsourced: 2, invoicingState: 'fully_invoiced', legacy: true }),
    ord({ id: 'i4', number: 8, commissioningState: 'to_plan', invoicingState: 'fully_invoiced', legacy: true }),
  ],
  legs: [leg({ id: 'l-late', legacy: true }), leg({ id: 'l-po', placedOn: null, legacy: true })],
  receivables: [rec({ legacy: true })],
})

describe('order tasks on an imported order wait in "Imported, to review", never counted', () => {
  it('takes every invoicing, goods and commissioning task of an imported order out of the groups and the count', () => {
    const v = buildToday(imported)
    expect(v.imported.map(i => i.rule).sort()).toEqual(['delivered_not_invoiced', 'delivered_not_invoiced', 'goods_late', 'payment_overdue', 'place_po', 'plan_commissioning', 'to_source'])
    // owner decision 2026-10-22 (1): a late payment on an imported order waits in the fold too, not counted
    expect(v.active).toEqual([])
    expect(v.now).toEqual([])
    expect(v.waiting).toEqual([])
  })

  it('reads grey with the date in words, never "757 days overdue"', () => {
    const v = buildToday(imported)
    for (const i of v.imported) {
      expect(i.badge.tone).toBe('neutral')
      expect(i.badge.text).toMatch(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    }
    expect(v.imported.find(i => i.subjectId === 'i1')?.badge.text).toBe('since 24 Oct 2024')
  })

  it('a v2 order is unchanged: its tasks stay in the list and the count', () => {
    const v = buildToday(ctx({ orders: [ord({ deliveredOn: '2026-10-20' })] }))
    expect(v.imported).toEqual([])
    expect(v.active.map(i => i.rule)).toEqual(['delivered_not_invoiced'])
  })
})

describe('late payments: imported wait in the fold with their money, v2 stay red and counted', () => {
  it('an imported overdue payment lands in view.imported, not now, and is not counted', () => {
    const v = buildToday(ctx({ receivables: [rec({ legacy: true })] }))
    expect(v.imported.map(i => i.rule)).toEqual(['payment_overdue'])
    expect(v.now).toEqual([])
    expect(needsYouItems(v)).toHaveLength(0)
  })

  it('the fold header sums the amount of its late payments', () => {
    const v = buildToday(ctx({ receivables: [rec({ orderId: 'a', legacy: true, balance: 297_000 }), rec({ orderId: 'b', orderNumber: 14, legacy: true, balance: 100_500 })] }))
    const late = v.imported.filter(i => i.rule === 'payment_overdue')
    expect(late).toHaveLength(2)
    expect(late.reduce((s, i) => s + (i.amount ?? 0), 0)).toBe(397_500)
  })

  it('a v2 order 5 days overdue stays in now, red and counted, and never goes stale', () => {
    const v = buildToday(ctx({ receivables: [rec({ orderId: 'v2', dueOn: '2026-10-17', balance: 50_000 }), rec({ orderId: 'old', orderNumber: 14, legacy: true })] }))
    expect(v.now.map(i => i.subjectId)).toEqual(['v2'])
    expect(v.now[0].badge.tone).toBe('danger')
    expect(v.imported.map(i => i.subjectId)).toEqual(['old'])
    expect(needsYouItems(v).map(i => i.subjectId)).toEqual(['v2'])
    expect(v.stale).toEqual([])
  })
})
