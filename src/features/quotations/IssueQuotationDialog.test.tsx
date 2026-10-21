import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function setup(memory: () => FakeResult, quotations: () => FakeResult = () => ({ data: [] })) {
  const db = installFakeDb((c: FakeCall) => {
    if (c.target === 'quotations') return quotations()
    if (c.target === 'rfq_items') {
      return { data: [{ id: 'i1', position: 1, description: 'Pressure transmitter', qty: 2, unit: 'pcs', quoted_unit_price_net: 1000, gst_rate: 18, quoted_lead_time: null, created_at: 't' }] }
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
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

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

  it('HW-4: does not issue over a quotation another tab issued since the dialog opened, and says so', async () => {
    let reads = 0
    const issuedElsewhere = { id: 'q-other', number: 7, revision: 0, issued_on: '2026-10-20', valid_until: '2026-11-19', contact_id: null, lines: [], net_total: 2000, gst_total: 360, delivery_text: null, payment_terms: null, notes: null, signatory_id: 'u2', pdf_path: null }
    const db = setup(
      () => ({ data: [] }),
      () => ({ data: reads++ === 0 ? [] : [issuedElsewhere] }),
    )
    const issue = await screen.findByRole('button', { name: 'Issue quotation' })
    await waitFor(() => expect(issue).toBeEnabled())
    fireEvent.click(issue)
    expect(await screen.findByText(/was just issued for this RFQ/)).toBeInTheDocument()
    expect(db.calls.some(c => c.target === 'rpc:issue_quotation')).toBe(false)
    expect(db.calls.some(c => c.target === 'rfq_items' && c.verb === 'update')).toBe(false)
  })
})
