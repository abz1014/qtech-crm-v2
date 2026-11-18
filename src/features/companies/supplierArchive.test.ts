import { afterEach, describe, expect, it } from 'vitest'
import { getSupplierActivity, getSupplierRecord } from '@/features/companies/api'
import { buildSupplierRecord, type SupplierRecordRaw } from '@/features/companies/supplierRecord'
import { filterRows, installFakeDb, type FakeCall } from '@/test/fakeSupabase'

/* Archive: the supplier panels list only what the archive leaves visible, while the counts and the span still read everything. */
afterEach(() => installFakeDb(() => ({})).uninstall())

const INQ = [
  { id: 'q1', supplier_id: 's1', rfq_id: 'r1', sent_on: '2026-11-10', last_chased_on: null, chase_count: 0, no_offer_on: null, no_offer_reason: null, imported: null },
  { id: 'q2', supplier_id: 's1', rfq_id: 'r2', sent_on: '2025-01-10', last_chased_on: null, chase_count: 0, no_offer_on: null, no_offer_reason: null, imported: null, archived: true },
]
const LEGS = [
  { id: 'l1', supplier_id: 's1', placed_on: '2026-11-01', expected_on: '2026-11-20', received_on: null, currency: 'EUR', imported: null, orders: { number: 5, cancelled_on: null } },
  { id: 'l2', supplier_id: 's1', placed_on: '2024-02-01', expected_on: '2024-03-01', received_on: '2024-03-01', currency: 'EUR', imported: null, orders: { number: 2, cancelled_on: null }, archived: true },
]
const isIdRead = (c: FakeCall) => c.ops.some(([n, a]) => n === 'select' && a[0] === 'id')

describe('getSupplierRecord and the archive', () => {
  it('keeps the raw rows whole and names the live ids from id-only archived = false reads', async () => {
    const db = installFakeDb((c: FakeCall) => {
      if (c.target === 'supplier_inquiries') return { data: isIdRead(c) ? filterRows(INQ, c).map(r => ({ id: r.id })) : INQ }
      if (c.target === 'supplier_orders') return { data: isIdRead(c) ? filterRows(LEGS, c).map(r => ({ id: r.id })) : LEGS }
      return { data: [] }
    })
    const raw = await getSupplierRecord('s1')
    expect(raw.inquiries.map(i => i.id)).toEqual(['q1', 'q2'])
    expect(raw.legs.map(l => l.id)).toEqual(['l1', 'l2'])
    expect(raw.liveInquiryIds).toEqual(['q1'])
    expect(raw.liveLegIds).toEqual(['l1'])
    const idReads = db.calls.filter(c => (c.target === 'supplier_inquiries' || c.target === 'supplier_orders') && isIdRead(c))
    expect(idReads).toHaveLength(2)
    for (const r of idReads) expect(r.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)).toBe(true)
  })

  it('the lists drop archived rows; the span and the raw rows (counts, first year) keep them', () => {
    const base: SupplierRecordRaw = {
      supplierId: 's1',
      inquiries: [
        { id: 'q1', rfqId: 'r1', sentOn: '2026-11-10', lastChasedOn: null, chaseCount: 0, noOfferOn: null, noOfferReason: null, legacy: false },
        { id: 'q2', rfqId: 'r2', sentOn: '2025-01-10', lastChasedOn: null, chaseCount: 0, noOfferOn: null, noOfferReason: null, legacy: false },
      ],
      lines: [],
      items: [],
      rfqs: [
        { id: 'r1', number: 1, closedOn: null },
        { id: 'r2', number: 2, closedOn: null },
      ],
      orderItems: [],
      legs: [
        { id: 'l1', orderNumber: 5, cancelled: false, placedOn: '2026-11-01', expectedOn: '2026-11-20', receivedOn: null, legacy: false, currency: null, po: null },
        { id: 'l2', orderNumber: 2, cancelled: false, placedOn: '2024-02-01', expectedOn: '2024-03-01', receivedOn: '2024-03-01', legacy: false, currency: null, po: null },
      ],
    }
    const all = buildSupplierRecord(base, '2026-11-17')
    expect(all.quoteCount).toBe(2)
    expect(all.deliveryCount).toBe(2)
    const live = buildSupplierRecord({ ...base, liveInquiryIds: ['q1'], liveLegIds: ['l1'] }, '2026-11-17')
    expect(live.allQuotes.map(q => q.inquiryId)).toEqual(['q1'])
    expect(live.quoteCount).toBe(1)
    expect(live.deliveries.map(d => d.key)).toEqual(['l1'])
    expect(live.open.enquiries.map(e => e.inquiryId)).toEqual(['q1'])
    expect(live.open.legs.map(l => l.legId)).toEqual(['l1'])
    expect(live.span).toEqual(all.span)
    expect(live.span?.from).toBe('2024-02-01')
    expect(base.inquiries).toHaveLength(2)
  })
})

describe('getSupplierActivity and the archive', () => {
  it('keeps only enquiries v_inquiry_state says are not archived', async () => {
    const db = installFakeDb((c: FakeCall) => {
      if (c.target === 'v_supplier_activity')
        return { data: ['a1', 'a2'].map(id => ({ inquiry_id: id, rfq_id: null, sent_on: '2026-01-01', replied: true, quoted: true, no_offer: false, reply_days: 2, is_legacy: false })) }
      if (c.target === 'v_inquiry_state') return { data: filterRows([{ inquiry_id: 'a1' }, { inquiry_id: 'a2', archived: true }], c) }
      return { data: [] }
    })
    const out = await getSupplierActivity('s1')
    expect(out.map(a => a.inquiryId)).toEqual(['a1'])
    const state = db.calls.find(c => c.target === 'v_inquiry_state')!
    expect(state.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)).toBe(true)
  })
})
