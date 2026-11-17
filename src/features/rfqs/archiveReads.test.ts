import { afterEach, describe, expect, it } from 'vitest'
import { findRfqByCustomerRef, floatRfq, getRfqHeader, listClarifications, updateRfqHeader, getRecentAsks, ArchivedDuplicateRef } from '@/features/rfqs/api'
import { listQuotations, getPriceMemory } from '@/features/quotations/api'
import { getLegPo, getNextPoNumber, getLastPoToSupplier } from '@/features/purchaseOrders/api'
import { mapPgError } from '@/lib/pgErrors'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'

/*
 * Archive (0141). The RFQ, quotation and purchase-order api files hold NO list read: every read is a detail (one record or the children
 * of one open record) or a number (memory, next number, duplicate check). None may carry the archive filter.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const touchesArchived = (calls: FakeCall[]) => calls.some(c => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived'))

describe('no archive filter on detail and number reads', () => {
  it('RFQ detail and duplicate-check reads', async () => {
    const fake = installFakeDb(c => (c.target === 'rfqs' ? { data: [{ id: 'r', number: 1 }] } : { data: [] }))
    await findRfqByCustomerRef('c1', 'X').catch(() => null)
    await getRfqHeader('r').catch(() => null)
    await listClarifications('r').catch(() => null)
    await getRecentAsks(['s1'], '2026-11-17').catch(() => null)
    expect(fake.calls.length).toBeGreaterThan(0)
    expect(touchesArchived(fake.calls)).toBe(false)
  })
  it('quotation revisions of one RFQ and the price memory RPC', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await listQuotations('r')
    await listQuotations('r', false)
    await getPriceMemory('r')
    expect(fake.calls.length).toBe(3)
    expect(touchesArchived(fake.calls)).toBe(false)
  })
  it('purchase order next number, leg PO and last PO to a supplier', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await getNextPoNumber()
    await getLegPo('leg').catch(() => null)
    await getLastPoToSupplier('s1')
    expect(fake.calls.length).toBeGreaterThan(0)
    expect(touchesArchived(fake.calls)).toBe(false)
  })
})

const clash = { code: '23505', message: 'duplicate key value violates unique constraint "rfqs_company_customer_ref_key"' }
const floatInput = { id: 'new', companyId: 'c1', items: [], supplierIds: [], customerRef: ' ENQ-9 ', markSent: false, isPriority: false } as unknown as Parameters<typeof floatRfq>[0]

describe('a customer ref that clashes with an archived RFQ', () => {
  it('floatRfq says which RFQ holds it, found without the archive filter', async () => {
    const fake = installFakeDb(c => (c.verb === 'rpc' ? { error: clash } : { data: [{ id: 'old', number: 42, archived: true }] }))
    const err = await floatRfq(floatInput).catch(e => e)
    expect(err).toBeInstanceOf(ArchivedDuplicateRef)
    expect(err.message).toBe('Ref ENQ-9 already exists on RFQ-42 (in Archive). Unarchive it or use another ref.')
    expect(err.existing).toEqual({ id: 'old', number: 42 })
    expect(mapPgError(err, { entity: 'RFQ' }).message).toBe(err.message)
    expect(touchesArchived(fake.calls)).toBe(false)
  })
  it('a visible clash keeps the original error', async () => {
    installFakeDb(c => (c.verb === 'rpc' ? { error: clash } : { data: [{ id: 'old', number: 42, archived: false }] }))
    await expect(floatRfq(floatInput)).rejects.toMatchObject({ code: '23505' })
  })
  it('editing the header maps it the same way', async () => {
    installFakeDb(c => (c.verb === 'update' ? { error: clash } : { data: [{ id: 'old', number: 7, archived: true }] }))
    const err = await updateRfqHeader('r1', { companyId: 'c1', contactId: null, customerRef: 'A1', receivedOn: '2026-11-01' }).catch(e => e)
    expect(err.message).toBe('Ref A1 already exists on RFQ-7 (in Archive). Unarchive it or use another ref.')
  })
})
