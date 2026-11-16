import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { StatementDownloads } from '@/features/statement/StatementDownloads'

/*
 * The Comparative Statement is only downloaded (owner, 2026-11-16): two buttons, Download Excel and Download PDF, for admin and sales.
 * An engineer gets no buttons and the component asks the database for nothing (the statement is made of supplier prices).
 */
afterEach(() => {
  installFakeDb(() => ({})).uninstall()
  document.body.innerHTML = ''
})

function open(role: string, look?: 'panel' | 'inline') {
  const db = installFakeDb(() => ({ data: [] }))
  render(
    <MemoryRouter>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Sana', role } }}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <StatementDownloads jobKey="139" rfqId="00000000-0000-0000-0000-000000000139" look={look} />
          </ToastProvider>
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return db
}

describe('Comparative statement downloads', () => {
  it('an engineer gets no buttons and nothing is read', () => {
    const db = open('engineer')
    expect(screen.queryByTestId('statement-downloads')).toBeNull()
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(screen.queryByText(/Comparative statement/i)).toBeNull()
    expect(db.calls).toHaveLength(0)
  })

  for (const role of ['sales', 'admin']) {
    it(`${role} gets the section with exactly the two downloads, and no on-screen table`, async () => {
      const db = open(role)
      expect(screen.getByRole('heading', { level: 2, name: 'Comparative statement' })).toBeInTheDocument()
      expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Download Excel', 'Download PDF'])
      // nothing to download until the RFQ, its items and the company profile have loaded (the fake database has no items)
      expect(screen.getByRole('button', { name: 'Download Excel' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
      expect(screen.queryByRole('table')).toBeNull()
      await waitFor(() => expect(db.calls.length).toBeGreaterThan(0))
    })
  }

  it('the inline look (Issue quotation dialog) is one line and the same two buttons, with no heading', () => {
    open('sales', 'inline')
    expect(screen.getByTestId('statement-downloads')).toHaveTextContent('Comparative statement of every supplier reply')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Download Excel', 'Download PDF'])
  })
})
