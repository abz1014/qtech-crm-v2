import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { addDays } from '@/features/rfqs/lib/dateText'
import { businessToday } from '@/lib/dates'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import ReviewPage from '@/features/today/ReviewPage'

/* The weekly review page (P3-C1) over a fake database: admin only, its sections, Still live, Close as lost, the bulk bar. Fictional data. */
const today = businessToday()
const rfq = (n: number, o: Record<string, unknown>) => ({
  rfq_id: `r${n}`, number: n, company_id: 'c', owner_id: 'me', received_on: addDays(today, -40), due_on: null, is_priority: false, quoted_on: null, closed_on: null,
  outcome: 'open', sourcing_state: 'covered', bid_state: 'bid_sent', quotation_valid_until: null, companies: { name: `Review Customer ${n}`, city: null }, ...o,
})
const rows = [
  rfq(11, { quoted_on: addDays(today, -30) }),
  rfq(12, { quoted_on: addDays(today, -35) }),
  rfq(13, { bid_state: 'to_bid', sourcing_state: 'not_floated', received_on: addDays(today, -15) }),
]

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

function mount(role: 'admin' | 'sales') {
  fake = installFakeDb((c: FakeCall) => {
    if (c.target === 'v_rfq_state') return { data: rows }
    if (c.target === 'users') return { data: [{ id: 'me', role, name: 'Ayesha Rana', job_title: null, phone: null }] }
    if (c.verb === 'update') return { data: [{ id: 'x' }] }
    return { data: [] }
  })
  const session: SessionState = { status: 'signed-in', user: { id: 'me', name: 'Ayesha Rana', role } }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <ReviewPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Weekly review', () => {
  it('lists the quotations and the enquiry that wait for a decision, with the count', async () => {
    mount('admin')
    const quotes = await screen.findByRole('region', { name: /^Quotations with no decision/ })
    expect(within(quotes).getAllByRole('listitem')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: /^Enquiries with no supplier asked/ })).getAllByRole('listitem')).toHaveLength(1)
    expect(document.querySelector('[data-review-count]')?.textContent).toBe('3')
    expect(screen.queryByRole('region', { name: /^Payments more than 30 days/ })).toBeNull()
  })

  it('is admin only', () => {
    const { container } = mount('sales')
    expect(container.querySelector('[data-review]')).toBeNull()
  })

  it('Still live keeps a row out of the next two reviews (a snooze under its own review key)', async () => {
    mount('admin')
    const quotes = await screen.findByRole('region', { name: /^Quotations with no decision/ })
    fireEvent.click(within(quotes).getAllByRole('button', { name: /^Still live/ })[0])
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'snoozes' && c.verb === 'upsert')).toBe(true))
    const call = fake!.calls.find(c => c.target === 'snoozes' && c.verb === 'upsert')!
    expect(opArgs(call, 'upsert')?.[0]).toMatchObject({ rule: 'review_quotation', until_on: addDays(today, 14), until_change: false })
  })

  it('Close as lost closes that RFQ and offers Undo', async () => {
    mount('admin')
    const enquiries = await screen.findByRole('region', { name: /^Enquiries with no supplier asked/ })
    fireEvent.click(within(enquiries).getByRole('button', { name: /^Close as lost/ }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'rfqs' && c.verb === 'update')).toBe(true))
    const call = fake!.calls.find(c => c.target === 'rfqs' && c.verb === 'update')!
    expect(opArgs(call, 'update')?.[0]).toMatchObject({ closed_on: today, close_reason: 'other' })
    expect(await screen.findByRole('button', { name: /Undo/ })).toBeInTheDocument()
  })

  it('tick several and close them together; the bulk bar shows only with a tick', async () => {
    mount('admin')
    await screen.findByRole('region', { name: /^Quotations with no decision/ })
    expect(screen.queryByRole('region', { name: 'Selected' })).toBeNull()
    for (const box of screen.getAllByRole('checkbox').slice(0, 2)) fireEvent.click(box)
    const bar = await screen.findByRole('region', { name: 'Selected' })
    expect(within(bar).getByText('selected').parentElement).toHaveTextContent('2 selected')
    fireEvent.click(within(bar).getByRole('button', { name: 'Close selected as lost' }))
    await waitFor(() => expect(fake?.calls.filter(c => c.target === 'rfqs' && c.verb === 'update')).toHaveLength(2))
  })
})
