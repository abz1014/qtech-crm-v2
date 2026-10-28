import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ToastProvider } from '@/ui/Toast'
import { qk } from '@/features/queryKeys'
import type { JobFacts, JobRow } from '@/features/jobs/api'
import JobsScreen from '@/features/jobs/JobsScreen'
import { OFFLINE_TEXT } from '@/features/jobs/EngineerActions'

/*
 * The engineer's Job page (P7-B): three big buttons, one of them green, no price, and a plain line (and no sending) with no signal.
 */
const J: JobRow = {
  key: '139', kind: 'enquiry', rfqId: 'r1', orderId: 'o1', companyId: 'c1', companyName: 'Harbour Textiles Limited', siteName: null, ownerId: 'u2', ownerName: 'Faizan',
  items: 'Flowmeter +2 more', stage: 'supplier_ordered', stageDetail: 'goods arrived', isHistory: false, lastActivityOn: '2026-10-19', repeatOf: null, cancelledOrders: 0, engineerIds: ['u1'],
}
const FACTS: JobFacts = {
  job: J, customerRef: '80955', receivedOn: '2026-08-12', dueOn: null, notes: null, closedOn: null, closeReason: null,
  contact: { name: 'Tariq Mehmood', phone: '0300 555 0142', email: null, jobTitle: null }, site: null, orderNumber: null,
}
const leg = (over: Record<string, unknown> = {}) => ({
  id: 'l1', supplier_id: 's1', currency: 'PKR', reference: null, placed_on: '2026-10-01', expected_on: '2026-10-10', received_on: null, delivered_on: null,
  last_chased_on: null, chase_count: 0, inquiry_id: null, created_at: '2026-10-01T00:00:00Z', ...over,
})

function mount(opts: { needsCommissioning?: boolean; legs?: ReturnType<typeof leg>[]; state?: unknown } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  client.setQueryData(qk.jobs.part(J.key, 'facts'), FACTS)
  client.setQueryData(qk.rfqs.part('r1', 'items'), [])
  client.setQueryData([...qk.rfqs.part('r1', 'inquiries'), 'no-prices'], [])
  client.setQueryData(qk.rfqs.part('r1', 'attachments'), [])
  client.setQueryData(qk.orders.part('o1', 'header'), {
    id: 'o1', number: 1, companyId: 'c1', companyName: 'Harbour Textiles Limited', rfqId: 'r1', customerPo: null, orderedOn: '2026-09-02', paymentTermsDays: null,
    needsCommissioning: opts.needsCommissioning ?? true, plannedOn: null, visitTime: null, visitType: null, doneOn: null, cancelledOn: null, cancelReason: null, imported: false,
    notes: null, site: null, contact: null, owner: null, state: null,
  })
  client.setQueryData(qk.orders.part('o1', 'items'), [])
  client.setQueryData(qk.orders.part('o1', 'legs'), { legs: opts.legs ?? [leg()], names: new Map([['s1', 'Orient Analytical']]), quoteLines: [] })
  client.setQueryData(qk.orders.part('o1', 'engineers'), [])
  client.setQueryData(qk.orders.part('o1', 'files'), [])
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ali Raza', role: 'engineer' } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={[{ pathname: '/jobs/139', state: opts.state ?? null }]}>
            <Routes>
              <Route path="/jobs/*" element={<JobsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe("the engineer's Job page", () => {
  it('has the three big buttons, one green, and no price', async () => {
    const { container } = mount()
    const card = await screen.findByRole('region', { name: 'On site' })
    for (const name of ['Delivered today', 'Installed today', 'Add photo or note']) expect(within(card).getByRole('button', { name })).toBeInTheDocument()
    expect([...container.querySelectorAll('button.bg-primary')]).toHaveLength(1)
    expect(within(card).getByRole('button', { name: 'Delivered today' })).toHaveClass('bg-primary')
    expect(container.textContent).not.toMatch(/PKR|Invoic|Price|Gross/)
  })

  it('the green button moves on: Installed today once the goods are delivered, then Add photo or note', async () => {
    mount({ legs: [leg({ delivered_on: '2026-10-05' })] })
    const card = await screen.findByRole('region', { name: 'On site' })
    expect(within(card).queryByRole('button', { name: 'Delivered today' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Installed today' })).toHaveClass('bg-primary')
    expect(within(card).getByRole('button', { name: 'Add photo or note' })).not.toHaveClass('bg-primary')
  })

  it('a supply-only job with nothing to deliver offers Add photo or note as its green button', async () => {
    mount({ needsCommissioning: false, legs: [] })
    const card = await screen.findByRole('region', { name: 'On site' })
    expect(within(card).getByRole('button', { name: 'Add photo or note' })).toHaveClass('bg-primary')
  })

  it('every button is the 52 px size (44 px at least on a phone)', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'On site' })
    for (const b of within(card).getAllByRole('button')) expect(b.className).toMatch(/h-control-lg|min-h-control-lg|h-touch|min-h-touch|h-control/)
  })

  it('with no signal it says so, keeps the buttons off, and still opens Add photo or note', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mount()
    const card = await screen.findByRole('region', { name: 'On site' })
    expect(within(card).getByText(OFFLINE_TEXT)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Delivered today' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Installed today' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Add photo or note' })).toBeEnabled()
  })

  it('arriving from Photo or note opens the photo-or-note box at once', async () => {
    mount({ state: { photoOrNote: true } })
    expect(await screen.findByRole('dialog', { name: /Add photo or note/ })).toBeInTheDocument()
  })
})
