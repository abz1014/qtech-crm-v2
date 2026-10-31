import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { installFakeDb } from '@/test/fakeSupabase'
import StatementPage from '@/features/statement/StatementPage'

/*
 * The Comparative Statement is for admin and sales (it is made of supplier prices). An engineer gets a notice and the page asks the
 * database for nothing: the database refuses them the prices as well (0081, 0111), but they are not even asked.
 */
afterEach(() => installFakeDb(() => ({})).uninstall())

function open(role: string) {
  const db = installFakeDb(() => ({ data: [] }))
  render(
    <MemoryRouter initialEntries={['/jobs/139/statement']}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Sana', role } }}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/jobs/:key/statement" element={<StatementPage />} />
          </Routes>
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return db
}

describe('Comparative statement access', () => {
  it('an engineer sees a notice, a way back, no statement and no Export PDF, and nothing is read', () => {
    const db = open('engineer')
    expect(screen.getByText('The comparative statement is for admins and sales')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the job' })).toHaveAttribute('href', '/jobs/139')
    expect(screen.queryByTestId('statement')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull()
    expect(db.calls).toHaveLength(0)
  })

  it('sales and admin are not shown the notice', async () => {
    for (const role of ['sales', 'admin']) {
      const db = open(role)
      expect(screen.queryByText(/is for admins and sales/)).toBeNull()
      // they start reading the job
      await screen.findByRole('status', { name: 'Loading the comparative statement' }).catch(() => undefined)
      expect(db.calls.length).toBeGreaterThan(0)
      db.uninstall()
      document.body.innerHTML = ''
    }
  })
})
