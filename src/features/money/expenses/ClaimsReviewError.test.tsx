import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { ClaimsReview } from '@/features/money/expenses/ClaimsReview'
import { OwedToStaff } from '@/features/money/expenses/OwedToStaff'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Live bug 17: a failed load of To approve / Owed to staff said nothing (the section vanished). Bug 18: "from staff". */
function wrap(ui: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Boss', role: 'admin' } }}>
        <ToastProvider>{ui}</ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('To approve', () => {
  it('says it could not load, with Try again that reloads', async () => {
    const user = userEvent.setup()
    let fail = true
    installFakeDb((c: FakeCall) => (c.target === 'expense_claims' ? (fail ? { data: null, error: { message: 'boom' } } : { data: [] }) : { data: [] }))
    wrap(<ClaimsReview categories={[]} groups={[]} />)
    expect(await screen.findByText("Couldn't load the claims to approve")).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load the claims to approve")).toBeNull())
  })
})

describe('Owed to staff', () => {
  it('says it could not load, with Try again', async () => {
    installFakeDb((c: FakeCall) => (c.target === 'expense_claims' ? { data: null, error: { message: 'boom' } } : { data: [] }))
    wrap(<OwedToStaff />)
    expect(await screen.findByText("Couldn't load what is owed to staff")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
