import { Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import MoneyScreen from '@/features/money/MoneyScreen'
import { listApplyTargets, listCompanyOrders } from '@/features/money/credit/api'
import { listReceivables } from '@/features/money/payments/api'
import { filterRows, installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { receivablesListResult } from '@/test/receivablesFake'
import { ToastProvider } from '@/ui/Toast'

/*
 * Archive on receivables: the To collect LIST and the To collect figures drop archived orders (owner decision 18 Nov 2026: the server's
 * receivables_summary leaves them out, and the page's own Not invoiced / Imported tiles count the live rows only); the pickers (Which order?,
 * Apply credit, the refund order) keep every order and tag the archived ones "In Archive". Archived ids come from v_order_state only.
 */
const ROWS = [
  { order_id: 'o1', order_number: 1, company_id: 'c1', gross_target: 1000, settled: 0, balance: 1000, overpaid_by: 0, due_on: '2025-01-01', is_overdue: true, payment_state: 'overdue', reminder_count: 0, last_reminded_on: null },
  { order_id: 'o2', order_number: 2, company_id: 'c1', gross_target: 5000, settled: 0, balance: 5000, overpaid_by: 0, due_on: '2024-01-01', is_overdue: true, payment_state: 'overdue', reminder_count: 0, last_reminded_on: null },
]
const STATE = [{ order_id: 'o1' }, { order_id: 'o2', archived: true }]
const touchesOrdersArchived = (c: FakeCall) => c.target === 'orders' && c.ops.some(([, a]) => a[0] === 'archived')

function respond(calls: FakeCall[]) {
  return (c: FakeCall): FakeResult => {
    calls.push(c)
    if (c.target === 'rpc:receivables_list') return receivablesListResult(c, ROWS, { companyName: () => 'Ravi Agro' })
    if (c.target === 'v_order_state') return { data: filterRows(STATE, c) }
    return { data: [] }
  }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('receivables data', () => {
  it('flags archived orders from v_order_state, never from the orders table, and keeps every row', async () => {
    const calls: FakeCall[] = []
    installFakeDb(respond(calls))
    const rows = await listReceivables()
    expect(rows.map(r => [r.orderId, r.archived === true])).toEqual([
      ['o1', false],
      ['o2', true],
    ])
    expect(calls.some(touchesOrdersArchived)).toBe(false)
    expect(calls.some(c => c.target === 'v_order_state')).toBe(true)
  })

  it('the Apply-credit targets and the refund orders keep every order and flag the archived ones', async () => {
    installFakeDb(respond([]))
    expect((await listApplyTargets('c1')).map(t => [t.orderId, t.archived])).toEqual([
      ['o1', false],
      ['o2', true],
    ])
    expect((await listCompanyOrders('c1')).map(t => [t.orderId, t.archived])).toEqual([
      ['o1', false],
      ['o2', true],
    ])
  })
})

function at(path: string) {
  const calls: FakeCall[] = []
  installFakeDb(respond(calls))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role: 'admin' } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/money/*" element={<MoneyScreen />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return calls
}

describe('To collect page', () => {
  it('lists only the live order, counts only the live order in the headline, and shows no footer total', async () => {
    at('/money/receivables')
    const table = await screen.findByRole('table', { name: 'To collect' })
    expect(await within(table).findByRole('link', { name: 'Open ORD-0001' })).toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: 'Open ORD-0002' })).toBeNull()
    expect(table.querySelector('tfoot')).toBeNull()
    // the figures count the live order only (1,000), not the archived one (5,000)
    const owed = (await screen.findByTestId('owed-line')).textContent
    expect(owed).toContain('1,000')
    expect(owed).not.toContain('6,000')
  })

  it('the Imported and Not invoiced tiles leave out an archived imported order that has not been invoiced', async () => {
    const calls: FakeCall[] = []
    const withImported = [
      ...ROWS,
      { order_id: 'o3', order_number: 3, company_id: 'c1', gross_target: 800, settled: 0, balance: 800, overpaid_by: 0, due_on: null, is_overdue: false, payment_state: 'unpaid', reminder_count: 0, last_reminded_on: null },
    ]
    const state = [...STATE, { order_id: 'o3', archived: true }]
    const summary = { open_count: 1, outstanding: 1000, overdue_count: 1, overdue: 1000, reminder_due_count: 1, not_yet_due_count: 0, not_yet_due: 0, not_invoiced_count: 0, not_invoiced: 0, gross: 1000, settled: 0, settled_count: 0 }
    installFakeDb((c: FakeCall): FakeResult => {
      calls.push(c)
      if (c.target === 'rpc:receivables_list') return receivablesListResult(c, withImported, { companyName: () => 'Ravi Agro' })
      if (c.target === 'rpc:receivables_summary') return { data: [summary] }
      if (c.target === 'v_order_state') return { data: filterRows(state, c) }
      if (c.target === 'orders' && c.ops.some(([n]) => n === 'not')) return { data: [{ id: 'o3' }] }
      return { data: [] }
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role: 'admin' } }}>
          <MemoryRouter initialEntries={['/money/receivables']}>
            <ToastProvider>
              <Suspense fallback={null}>
                <Routes>
                  <Route path="/money/*" element={<MoneyScreen />} />
                </Routes>
              </Suspense>
            </ToastProvider>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    await screen.findByRole('table', { name: 'To collect' })
    expect(await screen.findByText('0 orders, from the old CRM')).toBeInTheDocument()
    // the live order o1 has no invoice number here, so it is the one Not invoiced order; the archived o3 is in neither tile
    expect(screen.getByText('1 order, balance from items')).toBeInTheDocument()
    expect(screen.queryByText('1 order, from the old CRM')).toBeNull()
    expect(calls.some(c => c.target === 'rpc:receivables_summary')).toBe(true)
  })
})

describe('Which order? picker', () => {
  it('offers the archived order too, tagged In Archive', async () => {
    const user = userEvent.setup()
    at('/money/receivables?pay=1')
    const pick = await screen.findByRole('dialog', { name: 'Which order?' })
    const list = await within(pick).findByRole('list', { name: 'Open orders' })
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    const archived = buttons.find(b => b.textContent?.includes('ORD-0002')) as HTMLElement
    expect(archived).toHaveTextContent('In Archive')
    expect(buttons.find(b => b.textContent?.includes('ORD-0001'))).not.toHaveTextContent('In Archive')
    await user.click(archived)
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument()
  })
})
