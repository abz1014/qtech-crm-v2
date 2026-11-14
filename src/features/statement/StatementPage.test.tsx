import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { installFakeDb } from '@/test/fakeSupabase'
import StatementPage, { ItemSection, Totals } from '@/features/statement/StatementPage'
import { buildStatement, DEFAULT_SORT } from '@/features/statement/model'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'

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

// Synthetic data only: one item, two suppliers in two currencies.
const ITEM: RfqItemRow = { id: 'i1', number: 1, description: 'Pressure transmitter 0-10 bar', brandId: null, brandName: null, familyId: null, qty: 4, unit: 'pcs' }
const quote = (id: string, name: string, unitPrice: number, currency: string) =>
  ({
    id,
    supplierId: `s-${id}`,
    supplierName: name,
    supplierCountry: null,
    sentOn: '2026-10-20',
    noOfferOn: null,
    noOfferReason: null,
    itemDeclines: {},
    lines: [{ id: `${id}-i1`, inquiryId: id, itemId: 'i1', unitPrice, currency, leadTime: '3 weeks', inStock: null, fxRatePkr: null, fxRateOn: null, weight: null, weightUnit: 'kg', origin: null, notes: null }],
  }) as unknown as InquiryRow

describe('Comparative statement layout (live bug 7: nothing scrolls the page sideways)', () => {
  const statement = buildStatement([ITEM], [quote('a', 'Alpha Instruments', 9000, 'PKR'), quote('z', 'Zed Controls', 100, 'USD')], { showNoReply: true, sort: DEFAULT_SORT })

  it('the quotes table sits in its own scroll box, with no minimum width that could push the page', () => {
    render(<ItemSection sec={statement.sections[0]} sort={DEFAULT_SORT} onSort={() => undefined} showNoReply compact={false} />)
    const table = screen.getByRole('table', { name: 'Supplier prices for item 1' })
    const box = table.parentElement as HTMLElement
    expect(box).toHaveAttribute('data-testid', 'statement-table-scroll')
    expect(box.className).toContain('overflow-x-auto')
    expect(table.className).not.toMatch(/min-w-/)
    // the column tracks may shrink to nothing: no fixed minimum in any column
    const head = screen.getAllByRole('row')[0]
    expect(head.className).not.toMatch(/minmax\((?!0,)/)
    expect(screen.getByRole('columnheader', { name: /Supplier/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('the totals table sits in its own scroll box too', () => {
    render(<Totals totals={statement.totals} quotedAny compact={false} />)
    const table = screen.getByRole('table', { name: 'Totals by supplier' })
    expect(table.parentElement).toHaveAttribute('data-testid', 'statement-totals-scroll')
    expect(table.parentElement?.className).toContain('overflow-x-auto')
    expect(table.className).not.toMatch(/min-w-/)
  })

  it('narrower than a desktop, each quote is a card (no table, nothing to scroll)', () => {
    render(<ItemSection sec={statement.sections[0]} sort={DEFAULT_SORT} onSort={() => undefined} showNoReply compact />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.querySelectorAll('li[data-statement-row]')).toHaveLength(2)
  })
})
