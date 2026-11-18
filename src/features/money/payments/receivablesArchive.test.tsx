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
 * Archive on receivables: the To collect LIST drops archived orders while every figure keeps counting them; the pickers (Which order?,
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
  it('lists only the live order, keeps the headline on every order, and shows no footer total', async () => {
    at('/money/receivables')
    const table = await screen.findByRole('table', { name: 'To collect' })
    expect(await within(table).findByRole('link', { name: 'Open ORD-0001' })).toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: 'Open ORD-0002' })).toBeNull()
    expect(table.querySelector('tfoot')).toBeNull()
    // the figures count both orders (6,000), not just the one listed
    expect((await screen.findByTestId('owed-line')).textContent).toContain('6,000')
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
