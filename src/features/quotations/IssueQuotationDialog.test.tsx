import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RfqHeader } from '@/features/rfqs/api'
import { IssueQuotationDialog } from '@/features/quotations/IssueQuotationDialog'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const RFQ: RfqHeader = {
  id: 'r1',
  number: 12,
  customerRef: null,
  receivedOn: '2026-10-01',
  dueOn: null,
  isPriority: false,
  quotedOn: null,
  closedOn: null,
  closeReason: null,
  closeNote: null,
  notes: null,
  company: { id: 'c1', name: 'Karachi Glassworks', country: 'Pakistan', createdAt: null },
  site: null,
  contactId: null,
  contact: null,
  owner: null,
  state: null,
}

const PROFILE = { id: 1, legal_name: 'Q-Tech', address: 'Karachi', quotation_validity_days: 30, quotation_terms: null }

function setup(memory: () => FakeResult, price: number | null = 1000) {
  installFakeDb((c: FakeCall) => {
    if (c.target === 'rfq_items') {
      return { data: [{ id: 'i1', position: 1, description: 'Pressure transmitter', qty: 2, unit: 'pcs', quoted_unit_price_net: price, gst_rate: 18, quoted_lead_time: null, created_at: 't' }] }
    }
    if (c.target === 'rpc:customer_price_memory') return memory()
    if (c.target === 'company_profile') return { data: PROFILE }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <IssueQuotationDialog rfq={RFQ} inquiries={[]} onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
  window.sessionStorage.clear()
})

describe('Issue quotation dialog', () => {
  it('can still be issued when the price chips (customer_price_memory) fail to load', async () => {
    setup(() => ({ error: { code: 'XX000', message: 'boom' } }))
    const issue = await screen.findByRole('button', { name: 'Issue quotation' })
    await waitFor(() => expect(screen.getByTestId('total-net')).toHaveTextContent('PKR 2,000'))
    expect(issue).toBeEnabled()
  })

  it('seeds the last issued price and enables Issue when everything loads', async () => {
    setup(() => ({ data: [] }))
    const issue = await screen.findByRole('button', { name: 'Issue quotation' })
    await waitFor(() => expect(screen.getByTestId('total-net')).toHaveTextContent('PKR 2,000'))
    expect(issue).toBeEnabled()
  })

  // HW-8: a free line cannot go out on a customer quotation.
  it('blocks Issue on a unit price of 0 and says why', async () => {
    setup(() => ({ data: [] }), 0)
    const issue = await screen.findByRole('button', { name: 'Issue quotation' })
    await waitFor(() => expect(screen.getByTestId('issue-blocked')).toHaveTextContent("can't carry a price of 0"))
    expect(issue).toBeDisabled()
  })

  // HW-2: a price far beyond what the database holds is refused with a reason, not a crash.
  it('blocks Issue on a price too large to store, without crashing', async () => {
    setup(() => ({ data: [] }), 1e22)
    const issue = await screen.findByRole('button', { name: 'Issue quotation' })
    await waitFor(() => expect(screen.getByTestId('issue-blocked')).toHaveTextContent('too large'))
    expect(issue).toBeDisabled()
    expect(screen.getByRole('list', { name: 'Items to quote' })).toBeInTheDocument()
  })

  // HW-9: a draft left by Back or a reload comes back when the dialog opens again.
  it('brings back the typed price from the draft', async () => {
    window.sessionStorage.setItem(
      'qtech.issueDraft.r1',
      JSON.stringify({ prices: { i1: 1500 }, included: { i1: true }, rateOf: { i1: '18' }, leads: { i1: '' }, validUntil: '', contactId: '', delivery: '', payment: '', terms: '' }),
    )
    setup(() => ({ data: [] }))
    await waitFor(() => expect(screen.getByTestId('total-net')).toHaveTextContent('PKR 3,000'))
    expect(screen.getByLabelText('Unit price, net PKR, item 1')).toHaveValue('1,500.00')
  })
})
