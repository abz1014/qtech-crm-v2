import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SupplierReplies } from '@/features/rfqs/SupplierReplies'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* One supplier's reply row (R07): Enter in a price box saves the reply, once, however often it is pressed while saving. */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 185, company: { id: 'c-1', name: 'Acme Plastics' } } as unknown as RfqHeader
const items: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: null, brandName: null, familyId: null, qty: 1, unit: 'pcs' }]
const inquiry: InquiryRow = {
  id: 'i-1',
  supplierId: 's-1',
  supplierName: 'Orient Analytical',
  supplierCountry: 'Pakistan',
  sentOn: '2026-10-01',
  lastChasedOn: null,
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 0,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: 'PKR',
  responseState: 'awaiting',
  contactState: null,
  itemsQuoted: 0,
  lines: [],
}

describe('SupplierReplies', () => {
  it('pressing Enter again while the reply is saving does not save it a second time', async () => {
    const writes: FakeCall[] = []
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    installFakeDb(async call => {
      if (call.target === 'supplier_quote_lines' && call.verb === 'upsert') {
        writes.push(call)
        await held
      }
      return { data: [] }
    })
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <SupplierReplies rfq={rfq} items={items} inquiries={[inquiry]} rates={{}} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    const box = screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })
    await user.type(box, '1500')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(writes).toHaveLength(1))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    release()
    await waitFor(() => expect(screen.getAllByText('Reply saved').length).toBeGreaterThan(0))
    expect(writes).toHaveLength(1)
  })

  it('closing a reply with prices typed and not saved asks first; Keep editing keeps them, Close without saving closes', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <SupplierReplies rfq={rfq} items={items} inquiries={[inquiry]} rates={{}} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    const close = screen.getByRole('button', { name: 'Close the reply, Orient Analytical' })
    await user.type(screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' }), '1500')
    await user.click(close)
    const ask = await screen.findByRole('dialog', { name: 'Close without saving the prices?' })
    await user.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })).toHaveValue('1,500')
    await user.click(close)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close without saving' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })).toBeNull())
  })

  it('closing a reply with nothing typed closes at once', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <SupplierReplies rfq={rfq} items={items} inquiries={[inquiry]} rates={{}} />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Close the reply, Orient Analytical' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Price for item 1 from Orient Analytical' })).toBeNull()
  })
})
