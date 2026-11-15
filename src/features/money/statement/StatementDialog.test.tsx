import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { StatementButton } from '@/features/money/statement/StatementDialog'
import { financialYearStart } from '@/features/money/statement/model'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Statement of account on the company page (55-credit-statement #st-ok): admin only, lines with a running balance, PKR on screen. */

afterEach(() => installFakeDb(() => ({})).uninstall())

const day = financialYearStart(businessToday())

function mount(role: 'admin' | 'sales') {
  installFakeDb((c: FakeCall) => {
    if (c.target === 'rpc:customer_statement')
      return {
        data: [
          { line_on: day, kind: 'invoice', ref: 'INV-2263', order_number: 7, note: null, debit: 1392400, credit: 0, seq: 1 },
          { line_on: day, kind: 'payment', ref: 'INV-2263', order_number: 7, note: 'includes withholding tax Rs 1,200.00', debit: 0, credit: 1392400, seq: 3 },
        ],
      }
    return { data: null }
  })
  const session: SessionState = { status: 'signed-in', user: { id: 'u', name: 'Sana', role } }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <StatementButton companyId="c1" companyName="Chenab Chemicals" />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Statement of account', () => {
  it('is not drawn for sales', () => {
    mount('sales')
    expect(screen.queryByRole('button', { name: 'Statement of account' })).toBeNull()
  })

  it('lists the opening balance, each line with its running balance and the closing balance; a server "Rs" reads PKR', async () => {
    mount('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Statement of account' }))
    const list = await screen.findByRole('list', { name: 'Statement lines' })
    expect(within(list).getByTestId('statement-opening')).toHaveTextContent('Opening balance')
    const rows = within(list).getAllByTestId('statement-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Invoice INV-2263')
    expect(rows[0]).toHaveTextContent('Charged, PKR: 1,392,400.00')
    expect(rows[1]).toHaveTextContent('includes withholding tax PKR 1,200.00')
    expect(rows[1]).not.toHaveTextContent(/\bRs\b/)
    expect(rows[1]).toHaveTextContent('Paid or credited, PKR: 1,392,400.00')
    expect(within(list).getByTestId('statement-closing')).toHaveTextContent('Balance, PKR: 0.00')
  })
})
