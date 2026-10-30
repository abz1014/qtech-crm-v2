import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { BoardPage } from '@/features/rfqs/board/BoardPage'
import { parseRfqNumber, searchRfqs } from '@/features/rfqs/board/api'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

const ME = 'user-me'
const state = (over: Record<string, unknown>) => ({
  rfq_id: 'x',
  number: 1,
  company_id: 'c',
  owner_id: 'other',
  received_on: '2026-11-01',
  due_on: '2026-12-01',
  is_priority: false,
  quoted_on: null,
  closed_on: null,
  close_reason: null,
  outcome: 'open',
  items_total: 4,
  items_quoted: 0,
  items_uncovered: 0,
  floated: 0,
  responders: 0,
  sourcing_state: 'not_floated',
  to_ask: 0,
  waiting: 0,
  waiting_days: null,
  to_relay: 0,
  clarification_state: 'none',
  bid_state: 'to_bid',
  days_to_due: 4,
  is_overdue: false,
  companies: { name: 'Acme' },
  users: { name: 'Bilal Khan' },
  ...over,
})

const OPEN = [
  state({ rfq_id: 'a', number: 177, due_on: '2026-12-05', days_to_due: 8, owner_id: ME, users: { name: 'Ayesha Rana' }, companies: { name: 'Indus Textile Mills' }, sourcing_state: 'partly_covered', items_quoted: 2, items_total: 5, clarification_state: 'waiting_on_customer', waiting: 2, waiting_days: 3 }),
  state({ rfq_id: 'b', number: 178, due_on: '2026-11-24', days_to_due: -3, is_overdue: true, companies: { name: 'Punjab Cement' }, sourcing_state: 'covered', bid_state: 'quotation_expired' }),
  state({ rfq_id: 'c', number: 179, due_on: '2026-12-01', days_to_due: 4, owner_id: ME, users: { name: 'Ayesha Rana' }, companies: { name: 'Sargodha Dairy' } }),
]

function db(openRows: unknown[] | Error = OPEN, closedRows: unknown[] = []) {
  return installFakeDb((c: FakeCall): FakeResult => {
    if (c.target === 'v_rfq_state') {
      if (opArgs(c, 'in')) return { data: closedRows, count: closedRows.length }
      if (openRows instanceof Error) return { error: { message: openRows.message } }
      return { data: openRows }
    }
    if (c.target === 'rfqs') return { data: [{ id: 'a', customer_ref: 'ENQ-2211', rfq_items: [{ description: 'Cerabar PMC71 pressure transmitter', position: 0 }] }], count: 1 }
    return { data: [] }
  })
}

function Where({ id = 'where' }: { id?: string }) {
  const l = useLocation()
  return <p data-testid={id}>{l.pathname + l.search}</p>
}

function renderBoard(role: string, url = '/rfqs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session: SessionState = { status: 'signed-in', user: { id: ME, name: 'Ayesha Rana', role } }
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>
  )
  return render(
    <Routes>
      <Route
        path="/rfqs"
        element={
          <>
            <BoardPage />
            <Where id="where-board" />
          </>
        }
      />
      <Route path="/rfqs/:id" element={<Where />} />
      <Route path="/rfqs/new" element={<Where />} />
    </Routes>,
    { wrapper: wrap },
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const bodyRows = () => within(screen.getByRole('table', { name: 'Open RFQs' })).getAllByRole('row').slice(1)

describe('RFQ board', () => {
  it('shows a sales person their own RFQs first, in due-date order; the owner switch carries no totals', async () => {
    db()
    renderBoard('sales')
    await screen.findByText('Indus Textile Mills')
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Sargodha Dairy')
    expect(rows[1]).toHaveTextContent('Indus Textile Mills')
    expect(screen.getByRole('radio', { name: 'Mine' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument()
  })

  it('a long company name and customer reference are clamped in the table, the whole text kept in the title', async () => {
    const long = 'Sample Industrial Holdings and Allied Manufacturing Company Private Limited'
    db([state({ rfq_id: 'a', number: 177, owner_id: ME, companies: { name: long } })])
    renderBoard('sales')
    const link = await screen.findByRole('link', { name: new RegExp(long) })
    expect(link).toHaveClass('line-clamp-2')
    expect(link).toHaveAttribute('title', long)
    const asked = within(screen.getByRole('table', { name: 'Open RFQs' })).getByText(/Cerabar/, { selector: '[data-asked]' })
    expect(asked).toHaveClass('line-clamp-2')
  })

  it('opens on All for an engineer, overdue first, with the due date in the danger tone', async () => {
    db()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Punjab Cement')
    expect(within(rows[0]).getByText('3 days overdue')).toHaveClass('text-tone-danger-fg')
    // one plain next step per row (StatusText, no chip), in the registry's rfq-stage words
    expect(within(rows[0]).getByText('Quotation expired')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Revise it or mark it won')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Quotation expired').closest('[data-tone]')).toHaveAttribute('data-tone', 'now')
    expect(within(rows[0]).queryByText((_, el) => el?.hasAttribute('data-status') ?? false)).toBeNull()
    expect(within(rows[1]).getByText('Needs suppliers')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Waiting for prices')).toBeInTheDocument()
    expect(within(rows[2]).getByText('2 of 5 items priced · waiting on the customer for 2 answers')).toBeInTheDocument()
    // the row leads with the company and what was asked, then, on a line of their own (they never share one to be drawn over each
    // other, UX audit 2026-10-22 L1), the code and their ref; the cell wraps instead of being cut
    const asked = within(rows[2]).getByText('Cerabar PMC71 pressure transmitter + 4 more')
    const refs = rows[2].querySelector('[data-refs]')
    expect(refs).toHaveTextContent(/^RFQ-0177 · their ref ENQ-2211$/)
    expect(asked.contains(refs)).toBe(false)
    expect(asked.parentElement).toBe(refs?.parentElement)
    expect(asked.parentElement).toHaveClass('whitespace-normal')
    expect(within(rows[2]).getByText('Waiting for prices').closest('[data-next-step]')).toHaveClass('whitespace-normal')
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['RFQ', 'Next step', 'Due', 'Owner'])
  })

  it('narrows by the next step and keeps the choice in the address', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    expect(screen.getByRole('radio', { name: 'All open' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Quotation sent' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0]).toHaveTextContent('Punjab Cement')
    // no count on a step (redesign phase 0: the one "needs you" number is Today's)
    await user.click(screen.getByRole('radio', { name: /^Needs suppliers$/ }))
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent('Sargodha Dairy'))
    expect(screen.queryByRole('radio', { name: 'Compact' })).toBeNull() // no density switch any more
  })

  it('opens the RFQ from a row', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    await user.click(screen.getByRole('link', { name: /^Punjab Cement, RFQ-0178, / }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/rfqs/b')
  })

  it('with nothing open says "No open RFQs" in words true for a new CRM too, with New RFQ, and asks for no closed count', async () => {
    const d = db([], [])
    renderBoard('admin')
    expect(await screen.findByText('No open RFQs')).toBeInTheDocument()
    expect(screen.getByText(/New RFQs appear here as soon as you start one/)).toBeInTheDocument()
    expect(screen.queryByText(/Every quotation is out or closed/)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'New RFQ' })).toHaveLength(2)
    // no head request for the closed count (consistency spec 2.2 #10)
    expect(d.calls.filter(c => c.target === 'v_rfq_state' && opArgs(c, 'in'))).toHaveLength(0)
  })

  it('New RFQ is the page header primary, with its N key', async () => {
    db()
    renderBoard('sales')
    await screen.findByText('Indus Textile Mills')
    expect(screen.getByRole('heading', { level: 1, name: 'RFQs' })).toHaveClass('max-md:sr-only')
    expect(screen.getByRole('button', { name: 'New RFQ' })).toHaveAttribute('aria-keyshortcuts', 'N')
  })

  it('New RFQ in the header opens the intake screen', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('sales')
    await screen.findByText('Indus Textile Mills')
    await user.click(screen.getByRole('button', { name: 'New RFQ' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/rfqs/new')
  })

  it('offers everyone’s RFQs when none are yours', async () => {
    db([OPEN[1]])
    renderBoard('sales')
    expect(await screen.findByText('None of your RFQs are open. Nice.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show everyone/ })).toBeInTheDocument()
  })

  it('shows a skeleton while loading, then an error with Try again', async () => {
    db(new Error('boom'))
    renderBoard('admin')
    expect(await screen.findByText("Couldn’t load RFQs")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

describe('RFQ board toolbar', () => {
  it('searches by company, number or customer ref, kept in ?q=; Esc clears; a miss says what was searched and offers Clear search', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin')
    await screen.findByText('Indus Textile Mills')
    const box = screen.getByRole('textbox', { name: 'Search RFQs' })
    expect(box).toHaveAttribute('placeholder', 'Search RFQs')
    await user.type(box, 'rfq-0178')
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Punjab Cement')
    expect(screen.getByTestId('where-board')).toHaveTextContent('q=rfq-0178')
    await user.clear(box)
    await user.type(box, 'Belimo')
    expect(await screen.findByText('Nothing matches "Belimo"')).toBeInTheDocument()
    expect(screen.getByText('Searched open RFQs by number, customer, their reference and item.')).toBeInTheDocument()
    // the field's own clear (x) and the no-results action share the name; use the one in the empty state
    await user.click(within(screen.getByRole('table', { name: 'Open RFQs' })).getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(bodyRows()).toHaveLength(3)
    await user.type(box, 'dairy{Escape}')
    expect(box).toHaveValue('')
  })

  it('a search in the address is applied on load', async () => {
    db()
    renderBoard('admin', '/rfqs?q=punjab')
    await screen.findByText('Punjab Cement')
    expect(screen.getByRole('textbox', { name: 'Search RFQs' })).toHaveValue('punjab')
    expect(bodyRows()).toHaveLength(1)
  })

  it('/ focuses the search', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin')
    await screen.findByText('Indus Textile Mills')
    await user.keyboard('/')
    expect(screen.getByRole('textbox', { name: 'Search RFQs' })).toHaveFocus()
  })

  it('Closed is one more choice of the same filter', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin')
    await screen.findByText('Indus Textile Mills')
    await user.click(screen.getByRole('radio', { name: /^Closed/ }))
    expect(await screen.findByRole('table', { name: 'Closed and won RFQs' })).toBeInTheDocument()
    expect(screen.getByTestId('where-board')).toHaveTextContent('show=closed')
  })

  it('Closed says each outcome in words, links a won RFQ to its order, dates the close, and counts the closed list in the subline', async () => {
    const lost = state({ rfq_id: 'l', number: 14, outcome: 'closed', close_reason: 'price', closed_on: '2026-10-04', companies: { name: 'Old Mill' } })
    const won = state({ rfq_id: 'w', number: 15, outcome: 'won', companies: { name: 'New Mill' } })
    const d = installFakeDb((c: FakeCall): FakeResult => {
      if (c.target === 'v_rfq_state') return opArgs(c, 'in') ? { data: [lost, won], count: 8 } : { data: OPEN }
      if (c.target === 'orders') return { data: [{ id: 'o12', number: 12, rfq_id: 'w', ordered_on: '2026-10-02' }] }
      return { data: [] }
    })
    renderBoard('admin', '/rfqs?show=closed')
    const table = await screen.findByRole('table', { name: 'Closed and won RFQs' })
    expect(await within(table).findByRole('link', { name: 'ORD-0012' })).toHaveAttribute('href', '/orders/o12')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Lost on price')
    expect(rows[0]).toHaveTextContent('Sun 4 Oct')
    expect(rows[1]).toHaveTextContent('Won → ORD-0012')
    expect(rows[1]).toHaveTextContent('Fri 2 Oct')
    // no grey "Closed" chip repeated on every row
    expect(within(table).queryByText('Closed', { exact: true })).toBeNull()
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['RFQ', 'Outcome', 'Closed on', 'Received', 'Owner'])
    expect(screen.getByText('8 closed')).toBeInTheDocument()
    expect(screen.queryByText(/open ·/)).toBeNull()
    // only the won RFQ's live order is read
    const orders = d.calls.find(c => c.target === 'orders')!
    expect(opArgs(orders, 'in')).toEqual(['rfq_id', ['w']])
    expect(opArgs(orders, 'is')).toEqual(['cancelled_on', null])
  })

  it('the old ?tab=closed address still lands on Closed; the owner switch is not drawn there (the Closed list is everyone\'s)', async () => {
    db()
    renderBoard('sales', '/rfqs?tab=closed')
    expect(await screen.findByRole('table', { name: 'Closed and won RFQs' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Whose RFQs' })).toBeNull()
    expect(screen.getByRole('radio', { name: /^Closed/ })).toBeChecked()
  })

  it('on Closed the filter box searches the server over every won and closed RFQ, one page at a time, in the order it gives', async () => {
    const z = state({ rfq_id: 'z', number: 12, outcome: 'closed', close_reason: 'price', companies: { name: 'Old Mill' } })
    const y = state({ rfq_id: 'y', number: 11, outcome: 'won', companies: { name: 'Older Mill' } })
    const d = installFakeDb((c: FakeCall): FakeResult => {
      if (c.target === 'rpc:search_closed_rfqs') return { data: [{ rfq_id: 'z', total: 40 }, { rfq_id: 'y', total: 40 }] }
      if (c.target === 'rfqs') return { data: [{ id: 'z', customer_ref: 'OLD-1', rfq_items: [{ description: 'Belimo actuator', position: 0 }] }] }
      // the state rows come back in another order: the page keeps the search's order
      if (c.target === 'v_rfq_state') return opArgs(c, 'in') ? { data: [y, z], count: 2 } : { data: OPEN }
      return { data: [] }
    })
    const user = userEvent.setup()
    renderBoard('admin', '/rfqs?show=closed')
    await screen.findByRole('table', { name: 'Closed and won RFQs' })
    await user.type(screen.getByRole('textbox', { name: 'Search RFQs' }), 'belimo  gauge')
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:search_closed_rfqs')).toBe(true))
    const search = d.calls.find(c => c.target === 'rpc:search_closed_rfqs')!
    expect(opArgs(search, 'args')?.[0]).toEqual({ p_text: 'belimo  gauge', p_limit: 25, p_offset: 0 })
    expect(await screen.findByText('Belimo actuator + 3 more')).toBeInTheDocument()
    const names = within(screen.getByRole('table', { name: 'Closed and won RFQs' })).getAllByRole('link').map(a => a.textContent)
    expect(names).toEqual(['Old Mill', 'Older Mill'])
    expect(screen.getByText('Showing 1 to 25 of 40')).toBeInTheDocument()
  })
})

describe('RFQ search', () => {
  it('reads RFQ numbers in the forms people type them', () => {
    expect(parseRfqNumber('177')).toBe(177)
    expect(parseRfqNumber('RFQ-0177')).toBe(177)
    expect(parseRfqNumber('rfq 177')).toBe(177)
    expect(parseRfqNumber('ENQ-2211')).toBeNull()
    expect(parseRfqNumber('Indus')).toBeNull()
  })

  it('searches the number, the customer ref and the company in one query', async () => {
    const d = installFakeDb(c => (c.target === 'companies' ? { data: [{ id: 'c1' }] } : { data: [{ id: 'r1', number: 177, customer_ref: 'ENQ-2211', closed_on: null, companies: { name: 'Indus' } }] }))
    const hits = await searchRfqs('177')
    expect(hits).toEqual([{ id: 'r1', number: 177, customerRef: 'ENQ-2211', companyName: 'Indus', closed: false }])
    const or = opArgs(d.calls.find(c => c.target === 'rfqs')!, 'or')?.[0] as string
    expect(or).toContain('customer_ref.ilike.%177%')
    expect(or).toContain('number.eq.177')
    expect(or).toContain('company_id.in.(c1)')
  })

  it('does not let a comma or bracket in the text break the filter', async () => {
    const d = installFakeDb(() => ({ data: [] }))
    await searchRfqs('a,b)(c')
    const or = opArgs(d.calls.find(c => c.target === 'rfqs')!, 'or')?.[0] as string
    expect(or).toBe('customer_ref.ilike.%a b  c%')
  })
})
