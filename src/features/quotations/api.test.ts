import { afterEach, describe, expect, it } from 'vitest'
import { issueQuotation } from '@/features/quotations/api'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'

const ROW = {
  id: 'q2',
  number: 42,
  revision: 1,
  issued_on: '2026-10-19',
  valid_until: '2026-11-18',
  contact_id: null,
  lines: [],
  net_total: 0,
  gst_total: 0,
  delivery_text: null,
  payment_terms: null,
  notes: null,
  signatory_id: 'u1',
  pdf_path: null,
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

describe('issueQuotation', () => {
  // issue_quotation (0039) coalesces a NULL delivery / payment / notes with the previous revision's, so sending nothing
  // for a field the person emptied would silently print the old text again on the re-issue.
  it('sends an emptied delivery, payment terms and standard terms as empty text, so a re-issue does not bring the old ones back', async () => {
    const db = installFakeDb(c => (c.target === 'quotations' ? { data: ROW } : { data: 'q2' }))
    await issueQuotation({
      id: 'q2',
      rfqId: 'r1',
      items: [{ id: 'i1', unitPrice: 100, gstRate: 18, leadTime: null }],
      validUntil: '2026-11-18',
      contactId: null,
      deliveryText: null,
      paymentTerms: null,
      notes: null,
    })
    const rpc = db.calls.find(c => c.target === 'rpc:issue_quotation')!
    const args = opArgs(rpc, 'args')?.[0] as Record<string, unknown>
    expect(args.p_delivery_text).toBe('')
    expect(args.p_payment_terms).toBe('')
    expect(args.p_notes).toBe('')
    expect(args.p_item_ids).toEqual(['i1'])
  })

  // HW-43: the prices go to the database inside issue_quotation (0083), never as separate rfq_items writes before it,
  // so a refused issue cannot leave a price that no quotation carries.
  it('writes the prices only through the one issue_quotation call, with the quantity the person saw', async () => {
    const db = installFakeDb(c => (c.target === 'quotations' ? { data: ROW } : { data: 'q2' }))
    await issueQuotation({
      id: 'q2',
      rfqId: 'r1',
      items: [{ id: 'i1', unitPrice: 1300, gstRate: 18, leadTime: '2 weeks', qty: 2.5 }],
      validUntil: '2026-11-18',
      contactId: null,
      deliveryText: null,
      paymentTerms: null,
      notes: null,
    })
    expect(db.calls.filter(c => c.target === 'rfq_items')).toEqual([])
    const rpc = db.calls.find(c => c.target === 'rpc:issue_quotation')!
    const args = opArgs(rpc, 'args')?.[0] as Record<string, unknown>
    expect(args.p_lines).toEqual([{ id: 'i1', unit_price: 1300, gst_rate: 18, lead_time: '2 weeks', qty: 2.5 }])
  })

  it('a refused issue throws and writes nothing else', async () => {
    const db = installFakeDb(c => (c.target === 'rpc:issue_quotation' ? { error: { code: '22003', message: 'numeric field overflow' } } : { data: ROW }))
    await expect(
      issueQuotation({
        id: 'q3',
        rfqId: 'r1',
        items: [{ id: 'i1', unitPrice: 999999999999, gstRate: 18, leadTime: null, qty: 2.5 }],
        validUntil: '2026-11-18',
        contactId: null,
        deliveryText: null,
        paymentTerms: null,
        notes: null,
      }),
    ).rejects.toMatchObject({ code: '22003' })
    expect(db.calls.map(c => c.target)).toEqual(['rpc:issue_quotation'])
  })
})
