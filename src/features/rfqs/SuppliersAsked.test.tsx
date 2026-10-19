import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { SuppliersAsked } from '@/features/rfqs/SuppliersAsked'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * "Chased twice, no reply" (g2-chase-texts): the next suppliers in line for the items. Never the customer the RFQ is for (a
 * company can be both), and an item known only by its family still finds the suppliers on that family's shortlist.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq: RfqHeader = {
  id: 'r-1',
  number: 185,
  customerRef: null,
  receivedOn: '2026-10-01',
  dueOn: null,
  isPriority: false,
  quotedOn: null,
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c-customer', name: 'Acme Plastics', country: 'Pakistan', createdAt: null },
  site: null,
  contactId: null,
  contact: null,
  owner: null,
  state: null,
}

const inquiry: InquiryRow = {
  id: 'i-1',
  supplierId: 's-silent',
  supplierName: 'Silent Traders',
  supplierCountry: 'Pakistan',
  sentOn: '2026-10-01',
  lastChasedOn: '2026-10-05',
  lastRelayedAt: null,
  noOfferOn: null,
  noOfferReason: null,
  itemDeclines: {},
  chaseCount: 2,
  notes: null,
  contactName: null,
  contactPhone: null,
  lastCurrency: null,
  responseState: 'awaiting',
  contactState: null,
  itemsQuoted: 0,
  lines: [],
}

function stats(id: string, brandIds: string[]) {
  return { supplier_id: id, asked: 3, replied: 3, no_offer: 0, median_reply_days: 1, last_contact: '2026-09-01', reply_days_n: 3, brand_ids: brandIds, brand_names: brandIds.map(() => 'x') }
}

function renderWith(items: RfqItemRow[], inq: InquiryRow = inquiry, onCall: (call: FakeCall) => void = () => undefined) {
  installFakeDb((call: FakeCall) => {
    onCall(call)
    if (call.target === 'rpc:stamp_supplier_chase') return { data: inq.chaseCount + 1 }
    if (call.target === 'v_supplier_stats') return { data: [stats('c-customer', ['b-hach', 'f-meters']), stats('s-orient', ['b-hach']), stats('s-family', ['f-meters'])] }
    if (call.target === 'companies')
      return {
        data: [
          { id: 'c-customer', name: 'Acme Plastics', country: 'Pakistan', city: 'Lahore' },
          { id: 's-orient', name: 'Orient Analytical', country: 'Pakistan', city: 'Karachi' },
          { id: 's-family', name: 'Meter House', country: 'Pakistan', city: 'Karachi' },
        ],
      }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <SuppliersAsked rfq={rfq} items={items} inquiries={[inq]} stats={undefined} onFloat={() => undefined} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('SuppliersAsked escalation', () => {
  it('never offers the customer the RFQ is for as the next supplier in line', async () => {
    renderWith([{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }])
    const next = await screen.findByRole('list', { name: 'Next in line' })
    expect(within(next).getByText(/Orient Analytical/)).toBeInTheDocument()
    expect(within(next).queryByText(/Acme Plastics/)).toBeNull()
  })

  it('finds the suppliers on the family shortlist for an item known only by its family', async () => {
    renderWith([{ id: 'it-1', number: 1, description: 'Portable pH meter', brandId: null, brandName: null, familyId: 'f-meters', familyName: 'Meters', qty: 1, unit: 'pcs' }])
    const next = await screen.findByRole('list', { name: 'Next in line' })
    expect(within(next).getByText(/Meter House/)).toBeInTheDocument()
  })
})

describe('SuppliersAsked chase', () => {
  it('a double tap on Chase records one chase, not two', async () => {
    const stamps: FakeCall[] = []
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => held } })
    renderWith(
      [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: 'b-hach', brandName: 'Hach', familyId: null, qty: 1, unit: 'pcs' }],
      { ...inquiry, chaseCount: 0, lastChasedOn: null },
      call => {
        if (call.target === 'rpc:stamp_supplier_chase') stamps.push(call)
      },
    )
    const chase = screen.getByRole('button', { name: 'Chase Silent Traders' })
    await user.dblClick(chase)
    release()
    await waitFor(() => expect(screen.getAllByText('Chase text copied').length).toBeGreaterThan(0))
    expect(stamps).toHaveLength(1)
  })
})
