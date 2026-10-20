import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/routes'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb } from '@/test/fakeSupabase'

/* /reports is no longer a destination (owner decision 2026-10-19, five tabs): old links and bookmarks land inside Money. */
function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

function at(path: string, role: string) {
  installFakeDb(() => ({ data: [] }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Test Person', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <Where />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('/reports', () => {
  for (const role of ['admin', 'sales'])
    it(`${role}: opens Money's Reports view, keeping the query string`, async () => {
      at('/reports?month=2025-06', role)
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/money/reports?month=2025-06'))
    })

  it('engineer: the no-access page, never a redirect into Money', async () => {
    at('/reports', 'engineer')
    expect(await screen.findByRole('heading', { name: /Money is for/ })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/reports')
  })
})
