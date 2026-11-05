import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import MoneyScreen from '@/features/money/MoneyScreen'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Money > Profitability: the "Spent on enquiries we did not win" section reads v_enquiry_costs (state lost) and leaves the profit figures
 * as they were. Invented customers only.
 */
afterEach(() => cleanup())

const LOST = [
  { rfq_id: 'r-1', rfq_number: 181, company_name: 'Indus Textile Mills', spent_net: 1250.5, cost_count: 2, last_paid_on: '2026-10-12' },
  { rfq_id: 'r-2', rfq_number: 177, company_name: 'Karachi Dyeing Co', spent_net: 400, cost_count: 1, last_paid_on: '2026-09-30' },
]

function respond(lost: unknown[] | 'error', seen: FakeCall[] = []) {
  return (c: FakeCall): FakeResult => {
    seen.push(c)
    if (c.target === 'v_enquiry_costs') return lost === 'error' ? { error: { code: '500', message: 'boom' } as never } : { data: lost }
    return { data: [] }
  }
}

function open(reply: (c: FakeCall) => FakeResult) {
  installFakeDb(reply)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Owner', role: 'admin' } }}>
        <MemoryRouter initialEntries={['/money/profit']}>
          <ToastProvider>
            <Routes>
              <Route path="/money/*" element={<MoneyScreen />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Profitability: spent on enquiries we did not win', () => {
  it('lists each lost enquiry with what was spent, and totals them', async () => {
    const seen: FakeCall[] = []
    open(respond(LOST, seen))
    const table = await screen.findByRole('table', { name: 'Spent on enquiries we did not win' })
    expect(within(table).getByRole('link', { name: 'RFQ-0181' })).toHaveAttribute('href', '/rfqs/r-1')
    expect(within(table).getByText('Indus Textile Mills')).toBeInTheDocument()
    expect(within(table).getByText('Karachi Dyeing Co')).toBeInTheDocument()
    expect(table).toHaveTextContent('1,250.5')
    expect(table).toHaveTextContent('1,650.5')
    const call = seen.find(c => c.target === 'v_enquiry_costs')!
    expect(JSON.stringify(call.ops)).toContain('lost')
  })

  it('says so when nothing was spent on a lost enquiry', async () => {
    open(respond([]))
    expect(await screen.findByText('Nothing spent on a lost enquiry')).toBeInTheDocument()
  })

  it('a failed read of the costs does not hide the profit figures', async () => {
    open(respond('error'))
    expect(await screen.findByText('Spent on enquiries we did not win did not load')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('profit-average')).toBeInTheDocument())
  })
})
