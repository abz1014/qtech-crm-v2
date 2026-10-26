import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { GstToFbrPage } from '@/features/money/accounts/GstToFbrPage'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

afterEach(() => installFakeDb(() => ({})).uninstall())

function mount() {
  installFakeDb((c: FakeCall) => {
    if (c.target === 'v_gst_month')
      return {
        data: [
          { month: '2020-02-01', invoice_count: 4, net: 100000, gst: 18000, psid_set_count: 1, deposited_count: 4, deposited_amount: 15000, gst_to_deposit: 0, input_tax: 3000 },
          { month: '2020-03-01', invoice_count: 2, net: 50000, gst: 9000, psid_set_count: 0, deposited_count: 0, deposited_amount: 0, gst_to_deposit: 9000, input_tax: 1000 },
        ],
      }
    if (c.target === 'invoices') return { data: [{ invoice_date: '2020-02-10', psid: '1023-4471-0226', tax_deposited_on: '2020-03-14' }] }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role: 'admin' } }}>
        <MemoryRouter>
          <ToastProvider>
            <GstToFbrPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('GST to FBR page', () => {
  it('shows each month as charged less paid on purchases, with the dates and the payment slip number', async () => {
    mount()
    const list = await screen.findByTestId('gst-months')
    const feb = within(list).getByTestId('gst-2020-02')
    expect(within(feb).getByTestId('topay-2020-02')).toHaveTextContent('15,000')
    expect(within(feb).getByTestId('status-2020-02')).toHaveTextContent('Paid')
    expect(within(feb).getByTestId('status-2020-02')).toHaveTextContent('Payment slip no. (PSID) 1023-4471-0226')
    const mar = within(list).getByTestId('gst-2020-03')
    expect(within(mar).getByTestId('topay-2020-03')).toHaveTextContent('8,000')
    // long past the 15th of April 2020: late, with both dates in words
    expect(within(mar).getByTestId('status-2020-03')).toHaveTextContent('Late: was due Wed 15 Apr')
    expect(within(mar).getByTestId('status-2020-03')).toHaveTextContent('Return by Sat 18 Apr')
  })
  it('says what the page is for in the words of the plan', async () => {
    mount()
    await screen.findByTestId('gst-months')
    expect(screen.getByText(/GST charged on invoices, less GST paid on purchases, is what you pay FBR/)).toBeInTheDocument()
    expect(screen.getAllByText('GST charged').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GST paid on purchases').length).toBeGreaterThan(0)
  })
})
