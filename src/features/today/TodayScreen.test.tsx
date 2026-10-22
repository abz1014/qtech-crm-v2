import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import TodayScreen from '@/features/today/TodayScreen'
import { businessToday } from '@/lib/dates'
import { addDays } from '@/features/rfqs/lib/dateText'

/* Smoke test of the screen over a fake database: the states render and the money reads are gated by role. The real
 * queries are proven against the real database by e2e/today. */
const rfqState = {
  // received two days ago: still "needs you" (an item older than 30 days moves to the grey fold)
  rfq_id: 'r1', number: 184, company_id: 'c1', owner_id: 'me', received_on: addDays(businessToday(), -2), due_on: null, is_priority: false, quoted_on: null, closed_on: null,
  outcome: 'open', sourcing_state: 'not_floated', bid_state: 'to_bid', quotation_valid_until: null, companies: { name: 'Mehran Paper Board' },
}

function install(opts: { rfqs?: unknown[]; fail?: boolean } = {}) {
  return installFakeDb((c: FakeCall): FakeResult => {
    if (opts.fail && c.target === 'v_rfq_state') return { error: { message: 'boom' } }
    if (c.target === 'v_rfq_state') return { data: opts.rfqs ?? [rfqState] }
    if (c.target === 'rpc:my_target_progress') return { data: [] }
    return { data: [] }
  })
}

function renderAs(role: 'admin' | 'sales' | 'engineer') {
  const session: SessionState = { status: 'signed-in', user: { id: 'me', name: 'Ayesha Rana', role } }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <TodayScreen />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

let fake: ReturnType<typeof install> | null = null
afterEach(() => fake?.uninstall())

describe('Today screen', () => {
  it('lists an item with its title and reference', async () => {
    fake = install()
    renderAs('sales')
    expect(await screen.findByText('Needs suppliers')).toBeInTheDocument()
    expect(screen.getAllByText('RFQ-0184').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: /Money/ })).toBeInTheDocument()
  })

  it('counts it once in the header, and shows no number on the tabs (redesign phase 0)', async () => {
    fake = install()
    renderAs('sales')
    await screen.findByText('Needs suppliers')
    expect(document.querySelector('[data-needs-you-count]')?.textContent).toBe('1')
    expect(screen.queryByText(/due now/)).toBeNull()
    expect(document.querySelector('[data-needs-count]')).toBeNull()
  })

  it('an item older than 30 days sits in the grey "Older than 30 days" fold, not counted', async () => {
    fake = install({ rfqs: [{ ...rfqState, received_on: '2025-01-27' }] })
    renderAs('sales')
    const fold = await screen.findByRole('region', { name: 'Older than 30 days' })
    expect(document.querySelector('[data-needs-you-count]')?.textContent).toBe('0')
    expect(screen.getByText('Nothing needs you today')).toBeInTheDocument()
    expect(within(fold).queryByText('Needs suppliers')).toBeNull() // closed until opened
    fireEvent.click(within(fold).getByRole('button', { name: /Older than 30 days/ }))
    expect(within(fold).getByText('Needs suppliers')).toBeInTheDocument()
    expect(within(fold).getByText('since 27 Jan 2025')).toBeInTheDocument()
  })

  it('reads as the goal state when nothing needs you', async () => {
    fake = install({ rfqs: [] })
    renderAs('sales')
    expect(await screen.findByText('Nothing needs you today')).toBeInTheDocument()
  })

  it('says so and offers a retry when it cannot load', async () => {
    fake = install({ fail: true })
    renderAs('sales')
    expect(await screen.findByText('Today could not load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('an engineer has no Money tab and never requests receivables, invoices or the month-end checks', async () => {
    fake = install()
    renderAs('engineer')
    await screen.findByText('Needs suppliers')
    expect(screen.queryByRole('radio', { name: /Money/ })).toBeNull()
    await waitFor(() => expect(fake?.calls.length).toBeGreaterThan(0))
    const targets = fake?.calls.map(c => c.target) ?? []
    expect(targets).not.toContain('rpc:order_receivables')
    expect(targets).not.toContain('rpc:receivables_list')
    expect(targets).not.toContain('rpc:month_end_status')
    expect(targets).not.toContain('invoices')
  })

  it('admin and sales do request the receivables', async () => {
    fake = install()
    renderAs('admin')
    await screen.findByText('Needs suppliers')
    expect(fake?.calls.map(c => c.target)).toContain('rpc:receivables_list')
  })

  it('no target this quarter is ONE small line; the admin gets a link to Settings > Targets', async () => {
    fake = install()
    renderAs('admin')
    const tile = await screen.findByRole('region', { name: /^Your Q\d target$/ })
    expect(tile).toHaveTextContent(/^No Q\d target set\. Set targets$/)
    expect(screen.getByRole('link', { name: 'Set targets' })).toHaveAttribute('href', '/settings/targets')
  })

  it('no target, sales: the same line, no link (only the admin sets targets)', async () => {
    fake = install()
    renderAs('sales')
    const tile = await screen.findByRole('region', { name: /^Your Q\d target$/ })
    expect(tile).toHaveTextContent(/^No Q\d target set\. The admin sets it\.$/)
    expect(screen.queryByRole('link', { name: 'Set targets' })).toBeNull()
  })
})
