import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { addDays } from '@/features/rfqs/lib/dateText'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import TodayScreen from '@/features/today/TodayScreen'

/* Live bug 41: when the message behind a chase could not be loaded, the pane said "nothing to write" (or showed bars for ever). */
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Today pane, the message could not be loaded', () => {
  it('says so with Try again, not "nothing to write", and Try again loads the message', async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
    const user = userEvent.setup()
    let fail = true
    const row = { order_id: 'o1', order_number: 31, company_id: 'c1', owner_id: 'me', balance: 1000, settled: 0, due_on: addDays(businessToday(), -12), is_overdue: true, last_reminded_on: null, reminder_count: 0, company_name: 'Karachi Glassworks', invoice_numbers: [] }
    installFakeDb((c: FakeCall) => {
      if (c.target === 'rpc:receivables_list') return { data: [row] }
      if (c.target === 'invoices' && c.ops.some(o => o[0] === 'eq' && o[1][0] === 'order_id')) return fail ? { data: null, error: { message: 'boom' } } : { data: [] }
      return { data: [] }
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'me', name: 'Me', role: 'admin' } }}>
          <MemoryRouter>
            <ToastProvider>
              <TodayScreen />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Couldn't load the message for this item/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing to write/)).toBeNull()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText(/Couldn't load the message for this item/)).toBeNull())
  })
})
