import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import MoneyScreen from '@/features/money/MoneyScreen'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Money's navigation after the owner decision of 2026-10-19: four tabs, two levels, Who owes us first and where Money opens,
 * one name for admin and sales, Reports a link in the header (and from Month end), no third strip, and every old address
 * still landing somewhere sensible.
 */
const MONTH = '2025-06' // long ended, so the close button is live whatever day the test runs

function respond(c: FakeCall): FakeResult {
  switch (c.target) {
    case 'rpc:month_end_status':
      return {
        data: [
          { check_key: 'bank_unticked', n: 3 },
          { check_key: 'fbr_deposits_unticked', n: 0 },
          { check_key: 'uncategorised', n: 0 },
          { check_key: 'recurring_not_recorded', n: 0 },
          { check_key: 'provisional_margins', n: 2 },
          { check_key: 'fbr_pending', n: 0 },
          { check_key: 'unresolved_payments', n: 0 },
        ],
      }
    case 'v_month_pnl':
      return { data: [{ month: `${MONTH}-01`, net_in: 100, gst_in: 18, result: 50, after_drawings: 40 }] }
    case 'rpc:money_exceptions_input':
      return { data: null }
    default:
      return { data: [] }
  }
}

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

function at(path: string, role: 'admin' | 'sales' = 'admin', reply: (c: FakeCall) => FakeResult = respond) {
  const db = installFakeDb(reply)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Routes>
              <Route path="/money/*" element={<MoneyScreen />} />
              <Route path="*" element={null} />
            </Routes>
            <Where />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return db
}

const tabs = () => within(screen.getByRole('navigation', { name: 'Money views' })).getAllByRole('link').map(a => a.textContent?.replace(/\d+.*$/, '').trim())

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Money tabs and landing', () => {
  it('opens on Who owes us, for admin and for sales', async () => {
    at('/money')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/money/receivables'))
    expect(screen.getByRole('link', { name: /^Who owes us/ })).toHaveAttribute('aria-current', 'page')
  })

  it('admin has four tabs in the decided order, and one strip only', async () => {
    at('/money/receivables')
    await screen.findByRole('navigation', { name: 'Money views' })
    expect(tabs()).toEqual(['Who owes us', 'Invoices & GST', 'Expenses', 'Month end'])
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/money/reports')
  })

  it('sales see the same names (no "Order balances"), two tabs, and Reports', async () => {
    at('/money/receivables', 'sales')
    await screen.findByRole('navigation', { name: 'Money views' })
    expect(tabs()).toEqual(['Who owes us', 'Invoices & GST'])
    expect(screen.queryByText('Order balances')).toBeNull()
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
  })
})

describe('old addresses keep working', () => {
  it('a month-end report address opens the same report under Reports, with the month kept', async () => {
    at(`/money/month-end/pnl?month=${MONTH}`)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/money/reports/pnl?month=${MONTH}`))
    expect(await screen.findByRole('heading', { name: 'Profit and loss', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Reports' })).toHaveAttribute('href', `/money/reports?month=${MONTH}`)
  })

  it('Margins and Exceptions still open, inside Month end, with their plain names', async () => {
    at('/money/exceptions')
    expect(await screen.findByRole('heading', { name: 'Things to check', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Month end/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Back to Month end' })).toHaveAttribute('href', '/money/month-end')
  })

  it('sales get the no-access page on a money report', async () => {
    at('/money/reports/pnl', 'sales')
    expect(await screen.findByRole('heading', { name: /is for/ })).toBeInTheDocument()
  })
})

describe('Month end checklist', () => {
  it('lists only the checks that have items, each linking to its fix, and the clear ones on one line', async () => {
    at(`/money/month-end?month=${MONTH}`)
    const bank = await screen.findByTestId('check-bank_unticked')
    expect(within(bank).getByRole('link')).toHaveAttribute('href', `/money/month-end/bank?month=${MONTH}`)
    expect(within(bank).getByText('Match bank statement')).toBeInTheDocument()
    const margins = screen.getByTestId('check-provisional_margins')
    expect(within(margins).getByText('Margin not final')).toBeInTheDocument()
    expect(within(margins).getByRole('link')).toHaveAttribute('href', '/money/margins?filter=paid-provisional')
    expect(screen.queryByTestId('check-uncategorised')).toBeNull()
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('2 checks have something to look at')
    await waitFor(() => expect(screen.getByTestId('checks-clear')).toHaveTextContent('6 checks are clear'))
    expect(screen.getByTestId('checks-clear')).toHaveTextContent('Expenses without a category')
    expect(screen.getByTestId('checks-clear')).toHaveTextContent('Things to check')
  })

  it('has one green button with its (i), one link to the month’s reports, and no repeated panels', async () => {
    at(`/money/month-end?month=${MONTH}`)
    expect(await screen.findByRole('button', { name: 'Close June' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About closing a month' })).toBeInTheDocument()
    expect(screen.getByTestId('month-reports-link')).toHaveAttribute('href', `/money/reports?month=${MONTH}`)
    expect(screen.queryByText('What closing does')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Reports' })).toBeNull()
  })

  it('adds a Things to check row when the reconciliation finds something', async () => {
    at(`/money/month-end?month=${MONTH}`, 'admin', c =>
      c.target === 'rpc:money_exceptions_input'
        ? { data: { orders: [{ id: 'o1', number: 7, orderedOn: null, cancelled: false, basisUnknown: true }], money: [], payments: [], expenses: [], invoices: [], legs: [], pos: [], legPaid: [] } }
        : respond(c),
    )
    const things = await screen.findByTestId('check-things_to_check')
    expect(within(things).getByRole('link')).toHaveAttribute('href', '/money/exceptions')
    expect(screen.getByTestId('checks-summary')).toHaveTextContent('3 checks have something to look at')
  })
})

describe('Reports view', () => {
  it('admin: the money reports for the month in whole rupees, and the enquiry reports', async () => {
    at(`/money/reports?month=${MONTH}`)
    expect(await screen.findByRole('heading', { name: 'Reports', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Money for June 2025' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Money reports' })
    for (const t of ['Profit and loss', 'Expenses by category', 'Overdue by age', 'We owe suppliers', 'GST and FBR', 'Sales by person', 'Order margins'])
      expect(within(list).getAllByText(t).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Enquiries and customers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page')
  })

  it('sales: only the enquiry reports, and no money report is requested', async () => {
    const db = at('/money/reports', 'sales')
    expect(await screen.findByRole('heading', { name: 'Enquiries and customers' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Money reports' })).toBeNull()
    const targets = db.calls.map(c => c.target)
    for (const t of ['v_month_pnl', 'v_payment_net', 'v_month_expense_category', 'rpc:aging_as_of', 'rpc:payables_as_of', 'v_gst_month', 'v_month_team', 'v_order_money', 'rpc:month_end_status'])
      expect(targets, t).not.toContain(t)
  })
})
