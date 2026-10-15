import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { AppShell } from '@/app/shell/AppShell'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installFakeDb } from '@/test/fakeSupabase'

/* The shell reads the Today and RFQ counts for the top bar: an empty database, and a fresh cache per render. */
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
installFakeDb(() => ({ data: [] }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary inside the shell', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a crashing page leaves the navigation in place', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() =>
      root.render(
        <QueryClientProvider client={qc()}>
          <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Test Person', role: 'admin' } }}>
          <MemoryRouter initialEntries={['/today']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="today" element={<Boom />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
        </QueryClientProvider>,
      ),
    )
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong')
    expect(el.querySelectorAll('nav[aria-label="Main"] a').length).toBe(12)
    act(() => root.unmount())
  })
})
