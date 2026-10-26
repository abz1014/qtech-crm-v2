import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { businessToday } from '@/lib/dates'
import { MoneyHome } from '@/features/money/home/MoneyHome'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

afterEach(() => installFakeDb(() => ({})).uninstall())

function mount() {
  const month = businessToday().slice(0, 7)
  installFakeDb((c: FakeCall) => {
    switch (c.target) {
      case 'rpc:receivables_summary':
        return { data: [{ outstanding: 2184600, overdue: 636715, overdue_count: 3, open_count: 5 }] }
      case 'v_month_cash_flow':
        return { data: [{ month: `${month}-01`, money_in: 1912400, payments_count: 6, money_out: 731850, expenses_count: 14, frozen: false }] }
      case 'v_month_pnl':
        return { data: [{ month: `${month}-01`, gst_in: 291700 }] }
      case 'rpc:payables_as_of':
        return { data: [{ supplier_order_id: 's1', supplier_name: 'Shanghai Flowtech', currency: 'USD', committed_pkr: 2000000, paid_pkr: 535000, owed_pkr: 1465000, state: 'owing' }] }
      default:
        return { data: [] }
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role: 'admin' } }}>
        <MemoryRouter>
          <ToastProvider>
            <MoneyHome />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Money home', () => {
  it('shows the four numbers with the late part, and says cash is not profit', async () => {
    mount()
    const blocks = await screen.findByTestId('money-blocks')
    expect(await within(blocks).findByText('2,184,600')).toBeInTheDocument()
    expect(within(blocks).getByTestId('late-part')).toHaveTextContent('636,715 late, 3 orders')
    expect(await within(blocks).findByText('1,912,400')).toBeInTheDocument()
    expect(await within(blocks).findByText('731,850')).toBeInTheDocument()
    expect(await within(blocks).findByText('1,465,000')).toBeInTheDocument()
    const sentence = await screen.findByText(/came in this month/)
    expect(screen.getByTestId('cash-not-profit')).toHaveTextContent('Cash, not profit:')
    expect(sentence.closest('p')).toHaveTextContent('about PKR 291,700 of it is GST we owe FBR')
  })

  it('every block is a link to where its number comes from, and Accounts is one level down', async () => {
    mount()
    const blocks = await screen.findByTestId('money-blocks')
    const hrefs = within(blocks).getAllByRole('link').map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(['/money/receivables', '/money/reports/in-out', '/money/expenses', '/money/reports/owe'])
    expect(screen.getByRole('link', { name: /GST to FBR/ })).toHaveAttribute('href', '/money/accounts/gst')
  })

  it('has one green button', async () => {
    mount()
    await screen.findByTestId('money-blocks')
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeInTheDocument()
  })
})
