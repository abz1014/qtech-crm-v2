import { describe, expect, it } from 'vitest'
import { legacyId } from '../src/lib/ids'
import { DELETED_IN_V2_DETAIL, DELETED_IN_V2_LIST, fetchDeletedInV2, skipDeletedInV2 } from '../src/load/loader'
import { IMPORT_TABLES } from '../src/types'
import type { ImportTable, NewRow } from '../src/types'

// W13: an imported record a person deleted in v2 must not come back on a re-import. Pure part, plus the audit read with a fake client.

const empty = () => Object.fromEntries(IMPORT_TABLES.map(t => [t, [] as NewRow[]])) as Record<ImportTable, NewRow[]>

const rfq = legacyId('rfqs', '1')
const rfqKept = legacyId('rfqs', '2')
const item = legacyId('rfq_items', '1')
const itemKept = legacyId('rfq_items', '2')
const inquiry = legacyId('supplier_inquiries', '1')
const line = legacyId('supplier_quote_lines', '1')
const order = legacyId('orders', '1')
const orderKept = legacyId('orders', '2')
const orderItem = legacyId('order_items', '1')
const invoice = legacyId('invoices', '1')

function tables() {
  const t = empty()
  t.rfqs = [{ id: rfq, customer_ref: 'ENQ-1' }, { id: rfqKept, customer_ref: 'ENQ-2' }]
  t.rfq_items = [{ id: item, rfq_id: rfq, description: 'Valve' }, { id: itemKept, rfq_id: rfqKept, description: 'Gauge' }]
  t.supplier_inquiries = [{ id: inquiry, rfq_id: rfq }]
  t.supplier_quote_lines = [{ id: line, inquiry_id: inquiry, rfq_item_id: item }]
  t.orders = [{ id: order, customer_po_number: 'PO-1' }, { id: orderKept, customer_po_number: 'PO-2' }]
  t.order_items = [{ id: orderItem, order_id: order, description: 'Valve', rfq_item_id: itemKept }]
  t.invoices = [{ id: invoice, number: 'INV-9', net_amount: 100, gst_amount: 18 }]
  return t
}

describe('skipDeletedInV2', () => {
  it('leaves out a record deleted in v2 and what went with it, and reports each as deleted in v2, skipped', () => {
    const t = tables()
    const { skipped, review } = skipDeletedInV2(t, new Map([['rfqs', new Set([rfq])], ['orders', new Set([order])]]))
    expect(t.rfqs.map(r => r['id'])).toEqual([rfqKept])
    expect(t.rfq_items.map(r => r['id'])).toEqual([itemKept])
    expect(t.supplier_inquiries).toEqual([])
    expect(t.supplier_quote_lines).toEqual([])
    expect(t.orders.map(r => r['id'])).toEqual([orderKept])
    expect(t.order_items).toEqual([])
    expect(t.invoices).toHaveLength(1)
    expect(skipped.rfqs).toHaveLength(1)
    expect(review.length).toBe(1 + 1 + 1 + 1 + 1 + 1)
    expect(review.every(r => r.list === DELETED_IN_V2_LIST && r.detail === DELETED_IN_V2_DETAIL)).toBe(true)
    expect(review.find(r => r.table === 'orders')).toMatchObject({ oldId: order, label: 'PO-1' })
  })

  it('does nothing when nothing was deleted', () => {
    const t = tables()
    const { review } = skipDeletedInV2(t, new Map())
    expect(review).toEqual([])
    expect(t.rfqs).toHaveLength(2)
  })

  it('skips a single deleted invoice and keeps the order', () => {
    const t = tables()
    const { skipped } = skipDeletedInV2(t, new Map([['invoices', new Set([invoice])]]))
    expect(t.invoices).toEqual([])
    expect(t.orders).toHaveLength(2)
    expect(skipped.invoices[0]).toMatchObject({ net_amount: 100 })
  })
})

describe('fetchDeletedInV2', () => {
  it('reads only DELETE rows made by a person, and only for imported (version 5) ids', async () => {
    const calls: string[] = []
    const rows = [
      { table_name: 'orders', record_id: order },
      { table_name: 'orders', record_id: crypto.randomUUID() }, // made in v2: not the import's business
      { table_name: 'rfqs', record_id: rfq },
    ]
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'in', 'order']) q[m] = (...a: unknown[]) => (calls.push(`${m}:${a.join(',')}`), q)
    q['range'] = async () => ({ data: rows, error: null })
    const db = { from: (t: string) => (calls.push(`from:${t}`), q) }
    const out = await fetchDeletedInV2(db as never)
    expect([...(out.get('orders') ?? [])]).toEqual([order])
    expect([...(out.get('rfqs') ?? [])]).toEqual([rfq])
    expect(calls).toContain('from:audit_log')
    expect(calls).toContain('eq:action,delete')
    expect(calls).toContain('not:changed_by,is,')
  })
})
