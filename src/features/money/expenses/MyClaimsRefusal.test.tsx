import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { MyClaimsPage } from '@/features/money/expenses/MyClaimsPage'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Live bugs 1 and 3: an admin opening I paid is told who the page is for (not "admins"), and a failed claims load says so with Try again. */
function mount(role: 'admin' | 'engineer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Me', role } }}>
          <ToastProvider>
            <MyClaimsPage />
          </ToastProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('I paid refusal for an admin', () => {
  it('names sales and engineers and says admins approve on Expenses, never "admins" or "Ask an admin"', () => {
    installFakeDb(() => ({ data: [] }))
    mount('admin')
    expect(screen.getAllByText('I paid is for sales and engineers').length).toBeGreaterThan(0)
    expect(screen.getByText('Your role is Admin. Admins approve claims on the Expenses page, so there is no I paid page for admins.')).toBeInTheDocument()
    expect(screen.queryByText(/Ask an admin/)).toBeNull()
  })
})

describe('My claims failed load', () => {
  it('shows a failure with Try again, not "Nothing yet", and Try again reloads', async () => {
    const user = userEvent.setup()
    let fail = true
    installFakeDb((c: FakeCall) => {
      if (c.target === 'expense_claims') return fail ? { data: null, error: { message: 'boom' } } : { data: [] }
      return { data: [] }
    })
    mount('engineer')
    expect(await screen.findByText("Claims could not be loaded")).toBeInTheDocument()
    expect(screen.queryByText('Nothing yet')).toBeNull()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('Nothing yet')).toBeInTheDocument())
  })
})
