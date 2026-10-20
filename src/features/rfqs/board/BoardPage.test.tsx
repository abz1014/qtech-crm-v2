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
    if (c.target === 'rfqs') return { data: [{ id: 'a', customer_ref: 'ENQ-2211', rfq_items: [{ description: 'Cerabar PMC71 pressure transmitter', position: 0 }] }] }
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
  it('shows a sales person their own RFQs first, in due-date order, with counts', async () => {
    db()
    renderBoard('sales')
    await screen.findByText('Indus Textile Mills')
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Sargodha Dairy')
    expect(rows[1]).toHaveTextContent('Indus Textile Mills')
    expect(screen.getByRole('radio', { name: /Mine\s*2/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /All\s*3/ })).toBeInTheDocument()
  })

  it('opens on All for an engineer, overdue first, with the due date in the danger tone', async () => {
    db()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Punjab Cement')
    expect(within(rows[0]).getByText('3 days overdue')).toHaveClass('text-tone-danger-fg')
    // one plain next step per row, not three chips
    expect(within(rows[0]).getByText('Quotation sent')).toBeInTheDocument()
    expect(within(rows[0]).getByText('The quotation has expired')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Needs suppliers')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Waiting for prices')).toBeInTheDocument()
    expect(within(rows[2]).getByText('2 of 5 items priced · waiting on the customer for 2 answers')).toBeInTheDocument()
    // the row leads with the company and what was asked, then the code and their ref
    expect(within(rows[2]).getByText('Cerabar PMC71 pressure transmitter + 4 more')).toBeInTheDocument()
    expect(within(rows[2]).getByText('· RFQ-0177')).toBeInTheDocument()
    expect(within(rows[2]).getByText('their ref ENQ-2211', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['RFQ', 'Next step', 'Due', 'Owner'])
  })

  it('narrows by the next step and keeps the choice in the address', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    expect(screen.getByRole('radio', { name: /^All open\s*3$/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /^Quotation sent\s*1/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0]).toHaveTextContent('Punjab Cement')
    await user.click(screen.getByRole('radio', { name: /^Needs suppliers\s*1/ }))
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent('Sargodha Dairy'))
    expect(screen.queryByRole('radio', { name: 'Compact' })).toBeNull() // no density switch any more
  })

  it('opens the RFQ from a row', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('engineer')
    await screen.findByText('Punjab Cement')
    await user.click(screen.getByRole('link', { name: 'Punjab Cement' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/rfqs/b')
  })

  it('says "No open RFQs" when everything is done, with New RFQ in the empty view too', async () => {
    db([])
    renderBoard('admin')
    expect(await screen.findByText('No open RFQs')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New RFQ' })).toHaveLength(2)
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
  it('filters by company, number or customer ref; Esc clears; a miss names the filter and offers Clear filter', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin')
    await screen.findByText('Indus Textile Mills')
    const box = screen.getByRole('textbox', { name: 'Filter RFQs' })
    await user.type(box, 'rfq-0178')
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Punjab Cement')
    await user.clear(box)
    await user.type(box, 'Belimo')
    expect(await screen.findByText('No RFQs match “Belimo”')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(box).toHaveValue('')
    expect(bodyRows()).toHaveLength(3)
    await user.type(box, 'dairy{Escape}')
    expect(box).toHaveValue('')
  })

  it('/ focuses the filter box', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin')
    await screen.findByText('Indus Textile Mills')
    await user.keyboard('/')
    expect(screen.getByRole('textbox', { name: 'Filter RFQs' })).toHaveFocus()
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

  it('the old ?tab=closed address still lands on Closed, and stays there when the owner switch changes', async () => {
    db()
    const user = userEvent.setup()
    renderBoard('admin', '/rfqs?tab=closed')
    expect(await screen.findByRole('table', { name: 'Closed and won RFQs' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /^Mine/ }))
    expect(screen.getByRole('table', { name: 'Closed and won RFQs' })).toBeInTheDocument()
    expect(screen.getByTestId('where-board')).toHaveTextContent('show=closed')
    expect(screen.getByTestId('where-board')).not.toHaveTextContent('tab=')
  })

  it('on Closed the filter box searches the server: number, reference, company and item text, over every closed RFQ', async () => {
    const closedRow = state({ rfq_id: 'z', number: 12, outcome: 'closed', close_reason: 'price', companies: { name: 'Old Mill' } })
    const d = installFakeDb((c: FakeCall): FakeResult => {
      if (c.target === 'companies') return { data: [{ id: 'c9' }] }
      if (c.target === 'rfqs' && opArgs(c, 'or')) return { data: [{ id: 'z', number: 12 }] }
      if (c.target === 'rfqs' && opArgs(c, 'ilike')) return { data: [{ id: 'y', number: 11 }] }
      if (c.target === 'rfqs') return { data: [{ id: 'z', customer_ref: 'OLD-1', rfq_items: [{ description: 'Belimo actuator', position: 0 }] }] }
      if (c.target === 'v_rfq_state') return opArgs(c, 'in') ? { data: [closedRow], count: 1 } : { data: OPEN }
      return { data: [] }
    })
    const user = userEvent.setup()
    renderBoard('admin', '/rfqs?show=closed')
    await screen.findByRole('table', { name: 'Closed and won RFQs' })
    await user.type(screen.getByRole('textbox', { name: 'Filter RFQs' }), 'belimo')
    await waitFor(() => expect(d.calls.some(c => c.target === 'rfqs' && opArgs(c, 'ilike')?.[0] === 'rfq_items.description')).toBe(true))
    const byItem = d.calls.find(c => c.target === 'rfqs' && opArgs(c, 'ilike'))!
    expect(opArgs(byItem, 'ilike')).toEqual(['rfq_items.description', '%belimo%'])
    expect(opArgs(byItem, 'select')?.[0]).toContain('rfq_items!inner')
    const own = d.calls.find(c => c.target === 'rfqs' && opArgs(c, 'or'))!
    expect(opArgs(own, 'or')?.[0]).toBe('customer_ref.ilike.%belimo%,company_id.in.(c9)')
    // the closed page is read for exactly the matching RFQs, newest first
    await waitFor(() => {
      const page = d.calls.filter(c => c.target === 'v_rfq_state' && c.ops.filter(([n]) => n === 'in').length === 2).at(-1)
      expect(page?.ops.filter(([n]) => n === 'in')[1][1]).toEqual(['rfq_id', ['z', 'y']])
    })
    expect(await screen.findByText('Belimo actuator + 3 more')).toBeInTheDocument()
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
