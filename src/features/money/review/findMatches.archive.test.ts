import { afterEach, describe, expect, it } from 'vitest'
import { findMatches } from '@/features/money/review/api'
import { filterRows, installFakeDb, type FakeCall } from '@/test/fakeSupabase'

/* Archive: Find matches proposes nothing that names an archived invoice or order (the screen is admin only, so orders.archived is readable). */
afterEach(() => installFakeDb(() => ({})).uninstall())

const PROPOSALS = [
  { invoice_id: 'i1', order_id: 'o1', confidence: 'certain', reasons: [] },
  { invoice_id: 'i2', order_id: 'o2', confidence: 'likely', reasons: [] },
  { invoice_id: 'i3', order_id: 'o3', confidence: 'certain', reasons: [] },
]
const INVOICES = [
  { id: 'i1', number: '1', invoice_date: '2024-01-01', net_amount: 100, gst_amount: 18, company_id: 'c1' },
  { id: 'i2', number: '2', invoice_date: '2024-01-02', net_amount: 100, gst_amount: 18, company_id: 'c1', archived: true },
  { id: 'i3', number: '3', invoice_date: '2024-01-03', net_amount: 100, gst_amount: 18, company_id: 'c1' },
]
const ORDERS = [
  { id: 'o1', number: 1, ordered_on: '2024-01-01', customer_po_number: null, company_id: 'c1' },
  { id: 'o2', number: 2, ordered_on: '2024-01-01', customer_po_number: null, company_id: 'c1' },
  { id: 'o3', number: 3, ordered_on: '2024-01-01', customer_po_number: null, company_id: 'c1', archived: true },
]

function fake(invoices: Record<string, unknown>[] = INVOICES, orders: Record<string, unknown>[] = ORDERS) {
  return installFakeDb((c: FakeCall) => {
    if (c.target === 'rpc:link_imported_invoices') return { data: PROPOSALS }
    if (c.target === 'invoices') return { data: filterRows(invoices, c) }
    if (c.target === 'orders') return { data: filterRows(orders, c) }
    if (c.target === 'rpc:lookup_labels') return { data: { companies: { c1: 'Ibrahim Fibres' }, orders: {}, legs: {} } }
    return { data: null }
  })
}

describe('findMatches and the archive', () => {
  it('asks for archived = false on both reads and drops a proposal whose invoice or order is archived', async () => {
    const db = fake()
    const out = await findMatches()
    expect(out.map(p => p.invoiceId)).toEqual(['i1'])
    for (const t of ['invoices', 'orders']) {
      const read = db.calls.find(c => c.target === t)!
      expect(read.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)).toBe(true)
    }
  })

  it('with every record archived (archiving on) there is nothing to propose', async () => {
    fake(INVOICES.map(i => ({ ...i, archived: true })), ORDERS.map(o => ({ ...o, archived: true })))
    expect(await findMatches()).toEqual([])
  })

  it('with archiving off (nothing archived) every proposal still comes through', async () => {
    fake(INVOICES.map(i => ({ ...i, archived: false })), ORDERS.map(o => ({ ...o, archived: false })))
    expect((await findMatches()).map(p => p.invoiceId)).toEqual(['i1', 'i2', 'i3'])
  })
})
