import { Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import MoneyScreen from '@/features/money/MoneyScreen'
import { businessToday } from '@/lib/dates'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { receivablesListResult } from '@/test/receivablesFake'
import { ToastProvider } from '@/ui/Toast'

/* Money > Payments (owner gate 2, 13 Nov 2026; 52-payments.html) and Record payment with no order ("Which order?", F-287 / F-642). */

const MONTH = businessToday().slice(0, 7)
const PAYMENTS = [
  { id: 'p1', received_on: `${MONTH}-02`, amount: 755200, paid_via: 'bank', reference: 'TT-88', order_id: 'o1' },
  { id: 'p2', received_on: `${MONTH}-01`, amount: 7000.5, paid_via: 'cash', reference: null, order_id: 'o2' },
]
const LABELS = { companies: {}, legs: {}, orders: { o1: { number: 117, company_id: 'c1', company_name: 'Hillside Pharma' }, o2: { number: 9, company_id: 'c2', company_name: 'Ravi Agro' } } }
const OPEN = [
  { order_id: 'o3', order_number: 121, company_id: 'c3', gross_target: 1793600, settled: 0, balance: 1793600, overpaid_by: 0, due_on: '2025-01-01', is_overdue: true, payment_state: 'overdue', reminder_count: 0, last_reminded_on: null },
  { order_id: 'o4', order_number: 133, company_id: 'c4', gross_target: 50000, settled: 50000, balance: 0, overpaid_by: 0, due_on: null, is_overdue: false, payment_state: 'settled', reminder_count: 0, last_reminded_on: null },
]
const NAMES: Record<string, string> = { c3: 'Ravi Agro', c4: 'Kestrel Power' }

function respond(rows: unknown[]) {
  return (c: FakeCall): FakeResult => {
    if (c.target === 'payments_in') return { data: rows }
    if (c.target === 'rpc:lookup_labels') return { data: LABELS }
    if (c.target === 'v_month_pnl') return { data: [{ month: `${MONTH}-01`, net_in: 640000, gst_in: 115200 }] }
    if (c.target === 'rpc:receivables_list') return receivablesListResult(c, OPEN, { companyName: id => NAMES[id], invoiceNumbers: id => (id === 'o3' ? ['INV-2284'] : []) })
    return { data: [] }
  }
}

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

function at(path: string, role: 'admin' | 'sales' = 'admin', rows: unknown[] = PAYMENTS) {
  const calls: FakeCall[] = []
  installFakeDb(c => {
    calls.push(c)
    return respond(rows)(c)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/money/*" element={<MoneyScreen />} />
              </Routes>
            </Suspense>
            <Where />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return calls
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Money > Payments', () => {
  it('reads one month of payments, every paid via, voided ones left out, and lists them with the order reference', async () => {
    const calls = at('/money/payments')
    const table = await screen.findByRole('table', { name: /Payments received in/ })
    expect(await within(table).findByText('Hillside Pharma')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Open ORD-0117' })).toHaveAttribute('href', '/orders/o1')
    expect(within(table).getByText('TT-88')).toBeInTheDocument()
    expect(within(table).getByText('Cash')).toBeInTheDocument()
    const read = calls.find(c => c.target === 'payments_in')
    expect(read?.verb).toBe('select')
    expect(opArgs(read as FakeCall, 'is')).toEqual(['voided_at', null])
    expect(opArgs(read as FakeCall, 'gte')).toEqual(['received_on', `${MONTH}-01`])
    expect(read?.ops.some(([op, a]) => op === 'eq' && a[0] === 'paid_via')).toBe(false)
    expect(screen.getByTestId('payments-count')).toHaveTextContent('2 payments in')
    expect(screen.getByTestId('payments-count')).toHaveTextContent('PKR 762,201 with GST. Voided payments are not listed.')
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page')
  })

  it('an empty month says so and offers Record a payment', async () => {
    at('/money/payments?month=2025-06', 'admin', [])
    expect(await screen.findByText('No payments in June 2025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeInTheDocument()
  })

  it('the month pager moves the month in the address and stops at this month', async () => {
    const user = userEvent.setup()
    at('/money/payments')
    await screen.findByTestId('payments-count')
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/\/money\/payments\?month=\d{4}-\d{2}$/))
  })

  it('is admin only: sales get the no-access page and no payment read', async () => {
    const calls = at('/money/payments', 'sales')
    expect(await screen.findByRole('heading', { name: /is for/ })).toBeInTheDocument()
    expect(calls.some(c => c.target === 'payments_in')).toBe(false)
  })
})

describe('Record payment with no order: "Which order?" first', () => {
  it('lists the open orders only, most overdue first; picking one opens the Record payment form for it', async () => {
    const user = userEvent.setup()
    at('/money/payments')
    await user.click(await screen.findByRole('button', { name: 'Record payment' }))
    const pick = await screen.findByRole('dialog', { name: 'Which order?' })
    expect(pick).toHaveTextContent('Record payment, step 1 of 2')
    const list = await within(pick).findByRole('list', { name: 'Open orders' })
    expect(within(list).getAllByRole('button')).toHaveLength(1) // the paid order is not listed
    expect(within(list).getByRole('button')).toHaveTextContent('ORD-0121 · INV-2284')
    await user.click(within(list).getByRole('button'))
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Which order?' })).toBeNull()
  })

  it('search narrows the list; nothing matching says so', async () => {
    const user = userEvent.setup()
    at('/money/receivables?pay=1')
    const pick = await screen.findByRole('dialog', { name: 'Which order?' })
    await within(pick).findByRole('list', { name: 'Open orders' })
    await user.type(within(pick).getByRole('textbox', { name: 'Search open orders' }), 'Kestrel')
    expect(within(pick).getByRole('status')).toHaveTextContent('No open order matches “Kestrel”.')
  })

  it('?pay=1 with no order opens the picker for an admin only; closing it drops ?pay from the address', async () => {
    const user = userEvent.setup()
    at('/money/receivables?pay=1')
    const pick = await screen.findByRole('dialog', { name: 'Which order?' })
    await user.click(within(pick).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/money\/receivables$/))
  })

  it('sales opening ?pay=1 get no picker', async () => {
    at('/money/receivables?pay=1', 'sales')
    await screen.findByRole('navigation', { name: 'Money views' })
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByRole('dialog', { name: 'Which order?' })).toBeNull()
  })
})
