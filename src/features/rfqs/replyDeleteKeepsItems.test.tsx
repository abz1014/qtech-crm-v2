import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { removeQuoteLine, removeRfqItem, restoreQuoteLine, restoreRfqItem, saveReply, type RfqHeader, type RfqItemRow } from '@/features/rfqs/api'
import { RemoveItemConfirm } from '@/features/rfqs/ItemDialogs'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Job 178: a supplier reply was added and removed, and afterwards the enquiry said "This RFQ has no items yet". Taking a supplier's
 * reply away must delete only that supplier's price line, never the enquiry's items. Removing an ITEM is the one thing that also
 * removes prices (ON DELETE CASCADE), so that confirm names whose prices go, and it can be undone.
 */
afterEach(() => {
  cleanup()
  installFakeDb(() => ({})).uninstall()
})

const touchesItems = (calls: FakeCall[]) => calls.filter(c => c.target === 'rfq_items' && (c.verb === 'delete' || c.verb === 'update'))

describe('removing a supplier reply keeps the RFQ items', () => {
  it('Remove reply deletes one supplier_quote_lines row, scoped to that inquiry and item, and nothing else', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await removeQuoteLine({ inquiryId: 'inq-1', itemId: 'i-1' })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toMatchObject({ target: 'supplier_quote_lines', verb: 'delete' })
    expect(fake.calls[0].ops.filter(([n]) => n === 'eq').map(([, a]) => a)).toEqual([
      ['inquiry_id', 'inq-1'],
      ['rfq_item_id', 'i-1'],
    ])
    expect(touchesItems(fake.calls)).toHaveLength(0)
  })

  it('saving a reply with a price cleared only deletes that supplier line, never an item', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await saveReply({ inquiryId: 'inq-1', currency: 'USD', leadTime: null, inStock: null, prices: [{ itemId: 'i-2', unitPrice: 5 }], removeItemIds: ['i-1'] })
    expect(fake.calls.map(c => `${c.verb} ${c.target}`)).toEqual(['delete supplier_quote_lines', 'upsert supplier_quote_lines'])
    expect(touchesItems(fake.calls)).toHaveLength(0)
  })

  it('Undo of Remove reply writes the line back and never writes an item', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await restoreQuoteLine({ id: 'l', inquiryId: 'inq-1', itemId: 'i-1', unitPrice: 9, currency: 'USD', leadTime: null, inStock: null, fxRatePkr: 280, fxRateOn: '2026-10-28' })
    expect(fake.calls.map(c => `${c.verb} ${c.target}`)).toEqual(['upsert supplier_quote_lines'])
  })
})

function Host({ rfq, item }: { rfq: RfqHeader; item: RfqItemRow }) {
  const [open, setOpen] = useState(true)
  return open ? <RemoveItemConfirm rfq={rfq} item={item} onClose={() => setOpen(false)} /> : null
}

describe('Remove item (the one action that also removes prices)', () => {
  const rfq = { id: 'r-1', number: 178, company: { id: 'c-1', name: 'Test Co' }, createdBy: 'u1', owner: null } as unknown as RfqHeader
  const item: RfqItemRow = { id: 'i-1', number: 1, description: 'Flowmeter', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'nos' }

  it('removeRfqItem returns the old position and rate so Undo can restore it', async () => {
    const fake = installFakeDb(c => (c.verb === 'delete' ? { data: [{ id: 'i-1' }] } : { data: { position: 3, gst_rate: 18, created_at: '2026-10-28T08:00:00Z', created_by: 'u1' } }))
    const snap = await removeRfqItem('i-1')
    expect(snap).toEqual({ position: 3, gstRate: 18, createdAt: '2026-10-28T08:00:00Z', createdBy: 'u1' })
    expect(fake.calls.map(c => c.verb)).toEqual(['select', 'delete'])
  })

  it('restoreRfqItem puts the item back under its old id, then its prices and reasons', async () => {
    const fake = installFakeDb(() => ({ data: [] }))
    await restoreRfqItem({
      rfqId: 'r-1',
      item,
      snapshot: { position: 3, gstRate: 18, createdAt: null, createdBy: null },
      lines: [{ id: 'l', inquiryId: 'inq-1', itemId: 'i-1', unitPrice: 9, currency: 'USD', leadTime: '2 weeks', inStock: false, fxRatePkr: 280, fxRateOn: '2026-10-28' }],
      declines: [{ inquiryId: 'inq-2', reason: 'discontinued' }],
    })
    expect(fake.calls.map(c => `${c.verb} ${c.target}`)).toEqual(['upsert rfq_items', 'upsert supplier_quote_lines', 'upsert inquiry_item_declines'])
    expect((opArgs(fake.calls[0], 'upsert')?.[0] as Record<string, unknown>).id).toBe('i-1')
  })

  it('the confirm names the suppliers whose prices go with the item, points to Remove reply, and Undo puts both back', async () => {
    const respond = (c: FakeCall): FakeResult => {
      if (c.target === 'users') return { data: [{ id: 'u1', name: 'Me' }] }
      if (c.target === 'supplier_inquiries') return { data: [{ id: 'inq-1', supplier_id: 's-1', sent_on: '2026-10-28', chase_count: 1, created_at: '2026-10-28T00:00:00Z' }] }
      if (c.target === 'companies') return { data: [{ id: 's-1', name: 'DEAO Electric', country: null, city: null }] }
      if (c.target === 'supplier_quote_lines' && c.verb === 'select' && opArgs(c, 'in')) {
        return { data: [{ id: 'l1', inquiry_id: 'inq-1', rfq_item_id: 'i-1', unit_price: 12, currency: 'USD', lead_time: null, in_stock: null, fx_rate_pkr: 280, fx_rate_on: '2026-10-28' }] }
      }
      if (c.target === 'rfq_items' && c.verb === 'select') return { data: { position: 0, gst_rate: 18, created_at: '2026-10-28T08:00:00Z', created_by: 'u1' } }
      if (c.verb === 'delete') return { data: [{ id: 'i-1' }] }
      return { data: [] }
    }
    const fake = installFakeDb(respond)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Me', role: 'admin' } }}>
          <ToastProvider>
            <Host rfq={rfq} item={item} />
          </ToastProvider>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/from DEAO Electric/)).toBeTruthy()
    expect(screen.getByText(/use Remove reply on the price row instead/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/1 price removed with it/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(fake.calls.some(c => c.target === 'rfq_items' && c.verb === 'upsert')).toBe(true))
    await waitFor(() => expect(fake.calls.some(c => c.target === 'supplier_quote_lines' && c.verb === 'upsert')).toBe(true))
  })
})
