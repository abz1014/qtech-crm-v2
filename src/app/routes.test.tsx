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
  const capture = (l.state as { capture?: { id?: string } } | null)?.capture?.id ?? ''
  return (
    <>
      <output data-testid="where">{`${l.pathname}${l.search}`}</output>
      <output data-testid="carried">{capture}</output>
    </>
  )
}

function at(path: string | { pathname: string; search?: string; state?: unknown }, role: string) {
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

/* /enquiries/new was the New RFQ address until 25 Nov 2026: old links, bookmarks and a hand-over from Capture land on /rfqs/new. */
describe('/enquiries/new', () => {
  it('opens /rfqs/new, keeping the query string and what was handed over', async () => {
    at({ pathname: '/enquiries/new', search: '?company=c1', state: { capture: { id: 'cap-1', text: 'Please quote', files: [] } } }, 'sales')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/rfqs/new?company=c1'))
    expect(screen.getByTestId('carried')).toHaveTextContent('cap-1')
    // let the New RFQ page finish loading inside the test, so nothing it logs arrives after the worker closes
    expect(await screen.findByRole('heading', { name: 'New RFQ', level: 1 }, { timeout: 10_000 })).toBeInTheDocument()
  })
})
