import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import MoneyScreen from '@/features/money/MoneyScreen'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { receivablesListResult } from '@/test/receivablesFake'
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

  it('admin has five tabs in the decided order (Reports last), one strip only, and the h1 names the tab', async () => {
    at('/money/receivables')
    await screen.findByRole('navigation', { name: 'Money views' })
    expect(tabs()).toEqual(['Who owes us', 'Invoices & GST', 'Expenses', 'Month end', 'Reports'])
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/money/reports')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Who owes us')
  })

  it('sales see the same names (no "Order balances"), two tabs, and Reports', async () => {
    at('/money/receivables', 'sales')
    await screen.findByRole('navigation', { name: 'Money views' })
    expect(tabs()).toEqual(['Who owes us', 'Invoices & GST', 'Reports'])
    expect(screen.queryByText('Order balances')).toBeNull()
  })
})

describe('old addresses keep working', () => {
  it('a month-end report address opens the same report under Reports, with the month kept', async () => {
    at(`/money/month-end/pnl?month=${MONTH}`)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/money/reports/pnl?month=${MONTH}`))
    expect(await screen.findByRole('heading', { name: 'Profit and loss', level: 1 })).toBeInTheDocument()
    // a report lights the Reports tab (round 3, M3), and the select says which report this is
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('report-picker')).toHaveValue('pnl')
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

describe('no Money tab carries a number (redesign phase 0: the one count is Today\'s)', () => {
  it('Who owes us has no count, even with overdue payments (they are rows on Today)', async () => {
    const overdue = (id: string, owner: string) => ({
      order_id: id, order_number: Number(id.slice(1)), company_id: 'c', owner_id: owner, gross_target: 118000, settled: 0, balance: 118000, overpaid_by: 0,
      due_on: '2025-01-01', is_overdue: true, payment_state: 'overdue', reminder_count: 0, data_trust: 'ok', last_reminded_on: null,
    })
    at('/money/receivables', 'admin', c => {
      if (c.target === 'rpc:receivables_list') return receivablesListResult(c, [overdue('o1', 'u'), overdue('o3', 's')])
      if (c.target === 'rpc:order_receivables') return { data: [overdue('o1', 'u'), overdue('o3', 's')] }
      if (c.target === 'users') return { data: [{ id: 'u', role: 'admin', name: 'A' }, { id: 's', role: 'sales', name: 'S' }] }
      return respond(c)
    })
    const tab = await screen.findByRole('link', { name: /^Who owes us/ })
    await new Promise(r => setTimeout(r, 50))
    expect(tab).toHaveAccessibleName(/^Who owes us$/)
    expect(screen.getByTestId('money-tabs').querySelectorAll('[data-needs-count]')).toHaveLength(0)
  })

  it('Month end has no count; the checklist still says how many checks have something', async () => {
    at(`/money/month-end?month=${MONTH}`, 'admin', c =>
      c.target === 'rpc:money_exceptions_input'
        ? { data: { orders: [{ id: 'o1', number: 7, orderedOn: null, cancelled: false, basisUnknown: true }], money: [], payments: [], expenses: [], invoices: [], legs: [], pos: [], legPaid: [] } }
        : respond(c),
    )
    expect(await screen.findByTestId('checks-summary')).toHaveTextContent('3 checks have something to look at')
    expect(screen.getByRole('link', { name: /^Month end/ })).toHaveAccessibleName(/^Month end$/)
  })
})

describe('Month end checklist', () => {
  it('always offers Match bank statement, for the month, even when the bank checks are clear', async () => {
    at(`/money/month-end?month=${MONTH}`, 'admin', c => (c.target === 'rpc:month_end_status' ? { data: [] } : respond(c)))
    await screen.findByTestId('checks-summary')
    expect(screen.queryByTestId('check-bank_unticked')).toBeNull()
    expect(screen.getByTestId('month-bank-link')).toHaveAttribute('href', `/money/month-end/bank?month=${MONTH}`)
  })

  it('the Reports link in the Money header keeps the month', async () => {
    at(`/money/month-end?month=${MONTH}`)
    await screen.findByTestId('checks-summary')
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', `/money/reports?month=${MONTH}`)
  })

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
    await waitFor(() => expect(screen.getByTestId('checks-clear')).toHaveTextContent('5 checks are clear'))
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

describe('Reports view (one report at a time)', () => {
  it('admin: opens Profit and loss for the month; the select offers every report; Export CSV is the one green button', async () => {
    at(`/money/reports?month=${MONTH}`)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/money/reports/pnl?month=${MONTH}`))
    expect(await screen.findByRole('heading', { name: 'Profit and loss', level: 1 })).toBeInTheDocument()
    const picker = screen.getByTestId('report-picker')
    expect(within(picker).getAllByRole('option').map(o => o.textContent)).toEqual([
      'Profit and loss',
      'Money in and out',
      'Expenses',
      'Overdue by age',
      'We owe suppliers',
      'GST and FBR',
      'Sales by person',
      'Enquiries and customers',
    ])
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page')
  })

  it('sales: only the enquiry reports, and no money report is requested', async () => {
    const db = at('/money/reports', 'sales')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/money/reports/enquiries'))
    expect(await screen.findByRole('heading', { name: 'Enquiries and customers', level: 1 })).toBeInTheDocument()
    expect(screen.queryByTestId('report-picker')).toBeNull()
    const targets = db.calls.map(c => c.target)
    for (const t of ['v_month_pnl', 'v_payment_net', 'v_month_expense_category', 'expenses', 'expense_groups', 'expense_categories', 'rpc:aging_as_of', 'rpc:payables_as_of', 'v_gst_month', 'v_month_team', 'v_order_money', 'rpc:month_end_status'])
      expect(targets, t).not.toContain(t)
  })
})

describe('Expenses report (2026-10-22)', () => {
  it('the old Expenses by category address opens the Expenses report for that month', async () => {
    at(`/money/reports/categories?month=${MONTH}`)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/money/reports/expenses?by=month&period=${MONTH}`))
    expect(await screen.findByRole('heading', { name: 'Expenses', level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('report-picker')).toHaveValue('expenses')
  })

  it('the old month-end address leads there too, and the Report select opens it on the month kept', async () => {
    at(`/money/month-end/categories?month=${MONTH}`)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/money/reports/expenses?by=month&period=${MONTH}`))
    expect(await screen.findByTestId('expense-report-period')).toHaveTextContent('June 2025')
  })

  it('sales get the no-access page and make no expense request', async () => {
    const db = at(`/money/reports/expenses?by=month&period=${MONTH}`, 'sales')
    expect((await screen.findAllByText(/Money reports is for/)).length).toBeGreaterThan(0)
    const targets = db.calls.map(c => c.target)
    for (const t of ['expenses', 'expense_groups', 'expense_categories', 'v_month_cash_flow']) expect(targets, t).not.toContain(t)
  })
})
