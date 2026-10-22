import { describe, expect, it } from 'vitest'
import { buildToday } from './rules'
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
  receivables: [rec()],
})

describe('order tasks on an imported order wait in "Imported, to review", never counted', () => {
  it('takes every invoicing, goods and commissioning task of an imported order out of the groups and the count', () => {
    const v = buildToday(imported)
    expect(v.imported.map(i => i.rule).sort()).toEqual(['delivered_not_invoiced', 'delivered_not_invoiced', 'goods_late', 'place_po', 'plan_commissioning', 'to_source'])
    // money owed on an invoice stays, and is counted
    expect(v.active.map(i => i.rule)).toEqual(['payment_overdue'])
    expect(v.now.map(i => i.rule)).toEqual(['payment_overdue'])
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
