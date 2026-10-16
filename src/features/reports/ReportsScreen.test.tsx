import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import ReportsScreen from '@/features/reports/ReportsScreen'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

/* The same hand-computed fixture as the pgTAP test, as the views would return it. */
const VIEWS: Record<string, unknown[]> = {
  v_report_rfq_outcomes: [
    { outcome: 'closed', close_reason: 'competitor', rfqs: 1 },
    { outcome: 'closed', close_reason: 'price', rfqs: 2 },
    { outcome: 'open', close_reason: null, rfqs: 3 },
    { outcome: 'won', close_reason: null, rfqs: 1 },
  ],
  v_report_float: [
    { sourcing_state: 'covered', rfqs: 2, items_total: 3, items_quoted: 3, won: 1, closed: 0, still_open: 1 },
    { sourcing_state: 'floated_awaiting', rfqs: 1, items_total: 1, items_quoted: 0, won: 0, closed: 1, still_open: 0 },
    { sourcing_state: 'no_offer_anywhere', rfqs: 1, items_total: 1, items_quoted: 0, won: 0, closed: 0, still_open: 1 },
    { sourcing_state: 'not_floated', rfqs: 2, items_total: 1, items_quoted: 0, won: 0, closed: 1, still_open: 1 },
    { sourcing_state: 'partly_covered', rfqs: 1, items_total: 2, items_quoted: 1, won: 0, closed: 1, still_open: 0 },
  ],
  v_report_clarification_turnaround: [
    { month: '2026-03-01', asked: 3, answered: 2, withdrawn: 1, still_open: 0, avg_days: 3.5, slowest_days: 5, total_days: 7 },
    { month: '2026-04-01', asked: 2, answered: 1, withdrawn: 0, still_open: 1, avg_days: 1, slowest_days: 1, total_days: 1 },
  ],
  v_report_repeat_customers: [
    { company_id: 'a', name: 'P01 A', orders: 2, first_order_on: '2026-01-10', last_order_on: '2026-03-05', rfqs: 2, is_repeat: true },
    { company_id: 'b', name: 'P01 B', orders: 1, first_order_on: '2026-02-01', last_order_on: '2026-02-01', rfqs: 3, is_repeat: false },
  ],
}

afterEach(() => installFakeDb(() => ({})).uninstall())

function show(respond: (c: FakeCall) => FakeResult = c => ({ data: VIEWS[c.target] ?? [] })) {
  const db = installFakeDb(respond)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReportsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return db
}

describe('Reports screen', () => {
  it('shows the four reports with the hand-counted figures', async () => {
    const db = show()
    expect(await screen.findByText('Price too high')).toBeInTheDocument()
    const outcomes = screen.getByRole('region', { name: 'RFQ outcome totals' })
    expect(within(outcomes).getByText("7")).toBeInTheDocument()
    expect(within(outcomes).getByText('25% of those answered')).toBeInTheDocument()
    const float = await screen.findByRole('region', { name: 'Float totals' })
    expect(within(float).getByText('57%')).toBeInTheDocument()
    expect(within(float).getByText('4 of 7 items on floated RFQs')).toBeInTheDocument()
    const turn = await screen.findByRole('region', { name: 'Clarification totals' })
    expect(within(turn).getByText('2.7 days')).toBeInTheDocument()
    expect(await screen.findByText('Mar 2026')).toBeInTheDocument()
    const repeat = await screen.findByRole('region', { name: 'Repeat customer totals' })
    expect(within(repeat).getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'P01 A' })).toHaveAttribute('href', '/companies/a')
    // only the four report views are read, and nothing is written
    expect(db.calls.map(c => c.target).sort()).toEqual(Object.keys(VIEWS).sort())
    expect(db.calls.every(c => c.verb === 'select')).toBe(true)
  })

  it('says what is true when nothing exists yet', async () => {
    show(() => ({ data: [] }))
    expect(await screen.findByText(/No RFQ has been closed yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No customer has an order yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No question has been asked of a customer yet/)).toBeInTheDocument()
  })

  it('reports a failed read in plain words and keeps the other reports', async () => {
    show(c => (c.target === 'v_report_float' ? { error: { message: 'boom' } } : { data: VIEWS[c.target] ?? [] }))
    expect(await screen.findByText(/The float report could not be read/)).toBeInTheDocument()
    expect(await screen.findByText('Price too high')).toBeInTheDocument()
  })
})
