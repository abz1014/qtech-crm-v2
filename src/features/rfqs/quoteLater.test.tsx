import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SupplierReplyDialog } from '@/features/rfqs/SupplierReplies'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * 0145 (owner, 20 Nov 2026): a supplier prices some items and says "please wait" for the rest. "The rest: quoting later" records
 * that for every item not priced or declined yet, and an item put off says so in the reply with a Take back.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 183, company: { id: 'c-1', name: 'ATS Synthetic' } } as unknown as RfqHeader
const item = (n: number): RfqItemRow => ({ id: `it-${n}`, number: n, description: `Item ${n}`, brandId: null, brandName: null, familyId: null, qty: 1, unit: 'nos' })
const items = [item(1), item(2), item(3)]
const base: InquiryRow = {
  id: 'i-1',
  supplierId: 's-1',
  supplierName: 'Achievers Automation',
  supplierCountry: 'China',
  sentOn: '2026-11-18',
  lastChasedOn: null,
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 0,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: 'USD',
  responseState: 'quoted',
  contactState: null,
  itemsQuoted: 1,
  lines: [{ id: 'l-1', itemId: 'it-1', unitPrice: 78, currency: 'USD', leadTime: '1 week', inStock: null, fxRatePkr: null, fxRateOn: null, weight: null, weightUnit: 'kg', origin: null, notes: null }] as unknown as InquiryRow['lines'],
}

function renderDialog(inquiry: InquiryRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ahmad', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <SupplierReplyDialog rfq={rfq} items={items} inquiry={inquiry} inquiries={[inquiry]} rates={{}} onClose={() => undefined} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('quoting later', () => {
  it('"The rest: quoting later" records every item not priced or declined yet', async () => {
    const writes: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'inquiry_item_waits') writes.push(call)
      return { data: [] }
    })
    const user = userEvent.setup()
    renderDialog({ ...base, itemDeclines: { 'it-3': 'discontinued' } })
    await user.click(screen.getByRole('button', { name: 'The rest: quoting later (1)' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(opArgs(writes[0], 'upsert')?.[0]).toEqual([{ inquiry_id: 'i-1', rfq_item_id: 'it-2' }])
  })

  it('an item put off says so, and Take back clears it', async () => {
    const writes: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'inquiry_item_waits') writes.push(call)
      return { data: [] }
    })
    const user = userEvent.setup()
    renderDialog({ ...base, itemWaits: { 'it-2': true, 'it-3': true } })
    expect(screen.getAllByText('Quoting later. A price typed here and saved ends it.')).toHaveLength(2)
    // Nothing is left to put off: the footer action is not drawn.
    expect(screen.queryByRole('button', { name: /The rest: quoting later/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Take back quoting later, item 2 from Achievers Automation' }))
    await waitFor(() => expect(writes.some(c => c.verb === 'delete')).toBe(true))
  })

  it('is not offered when nothing is priced yet: that supplier is simply still waited on', () => {
    installFakeDb(() => ({ data: [] }))
    renderDialog({ ...base, lines: [], itemsQuoted: 0, responseState: 'awaiting' })
    expect(screen.queryByRole('button', { name: /The rest: quoting later/ })).toBeNull()
  })
})
