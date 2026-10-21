import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SalesReports } from '@/features/reports/SalesReports'
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
        <SalesReports />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return db
}

describe('Enquiry and customer reports (inside Money > Reports)', () => {
  it('leads with three numbers, each report is one line with its headline, and opens to the hand-counted figures', async () => {
    const user = userEvent.setup()
    const db = show()
    const glance = await screen.findByRole('region', { name: 'At a glance' })
    expect(within(glance).getByText('25%')).toBeInTheDocument() // 1 won of 4 decided
    expect(within(glance).getByText('Of the 4 RFQs decided')).toBeInTheDocument()
    // round 3: "Customers who came back" is its own report line, not also a tile (the same fact twice)
    expect(within(glance).queryByText('Customers who came back')).toBeNull()
    // every report is a closed line with its headline; nothing to read until it is opened
    expect(screen.getByText('1 won, 3 lost, 3 open')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 came back')).toBeInTheDocument()
    for (const q of [
      'How many RFQs did we win, and why did we lose the others?',
      'Does asking suppliers for prices help us win?',
      'How fast do customers answer our questions?',
      'Which customers come back?',
    ])
      await user.click(screen.getByText(q))
    expect(await screen.findByText('Price too high')).toBeInTheDocument()
    const outcomes = screen.getByRole('region', { name: 'RFQ outcome totals' })
    expect(within(outcomes).getByText("7")).toBeInTheDocument()
    expect(within(outcomes).getByText('25% of those decided')).toBeInTheDocument()
    const float = await screen.findByRole('region', { name: 'Asking suppliers totals' })
    expect(within(float).getByText('57%')).toBeInTheDocument()
    expect(within(float).getByText('4 of 7 items on RFQs sent to suppliers')).toBeInTheDocument()
    expect(screen.getByText('Needs suppliers')).toBeInTheDocument() // the RFQ step's word, not the old "Not sent to suppliers"
    const turn = await screen.findByRole('region', { name: 'Customer answer totals' })
    expect(within(turn).getByText('2.7 days')).toBeInTheDocument()
    expect(await screen.findByText('Mar 2026')).toBeInTheDocument()
    const repeat = await screen.findByRole('region', { name: 'Repeat customer totals' })
    expect(within(repeat).getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'P01 A' })).toHaveAttribute('href', '/companies/a')
    // only the four report views are read, and nothing is written
    expect(db.calls.map(c => c.target).sort()).toEqual(Object.keys(VIEWS).sort())
    expect(db.calls.every(c => c.verb === 'select')).toBe(true)
  })

  it('says what is true when nothing exists yet, without empty tiles', async () => {
    const user = userEvent.setup()
    show(() => ({ data: [] }))
    expect(await screen.findByText(/Not enough data yet\. These fill in/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'At a glance' })).toBeNull()
    for (const q of ['How many RFQs did we win, and why did we lose the others?', 'How fast do customers answer our questions?', 'Which customers come back?']) await user.click(screen.getByText(q))
    expect(await screen.findByText(/No RFQ has been closed yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No customer has an order yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No question has been asked of a customer yet/)).toBeInTheDocument()
  })

  it('builds the asking-suppliers headline per side, so a side with nothing decided never reads "Won not enough data"', async () => {
    show(c =>
      c.target === 'v_report_float'
        ? { data: [{ sourcing_state: 'covered', rfqs: 2, items_total: 3, items_quoted: 3, won: 1, closed: 1, still_open: 0 }, { sourcing_state: 'not_floated', rfqs: 1, items_total: 1, items_quoted: 0, won: 0, closed: 0, still_open: 1 }] }
        : { data: VIEWS[c.target] ?? [] },
    )
    expect(await screen.findByText('Won 50% when asked, nothing decided when not')).toBeInTheDocument()
    expect(screen.queryByText(/not enough data when/)).toBeNull()
  })

  it('reports a failed read in plain words and keeps the other reports', async () => {
    const user = userEvent.setup()
    show(c => (c.target === 'v_report_float' ? { error: { message: 'boom' } } : { data: VIEWS[c.target] ?? [] }))
    // the closed line already says so; nobody has to open it to find out
    expect(await screen.findByText('Could not load')).toBeInTheDocument()
    await user.click(await screen.findByText('Does asking suppliers for prices help us win?'))
    await user.click(screen.getByText('How many RFQs did we win, and why did we lose the others?'))
    expect(await screen.findByText(/This report could not be read/)).toBeInTheDocument()
    expect(await screen.findByText('Price too high')).toBeInTheDocument()
  })
})
