import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { GstToFbrPage } from '@/features/money/accounts/GstToFbrPage'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

afterEach(() => installFakeDb(() => ({})).uninstall())

function mount(wht: unknown[] = []) {
  return mountWith(wht)
}

function mountWith(wht: unknown[]) {
  const fake = installFakeDb((c: FakeCall) => {
    if (c.target === 'v_wht_deducted') return { data: wht }
    if (c.target === 'payments_in') return { data: [{ id: 'p1' }] }
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
  return fake
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

describe('WHT deducted by customers: the certificate number or file (0119)', () => {
  const row = (o: Record<string, unknown>) => ({
    payment_id: 'p1', order_id: 'o1', order_number: 7, company_name: 'Indus Textile Mills', received_on: '2020-03-05', month: '2020-03-01', wht_amount: 80,
    certificate_no: null, certificate_missing: true, certificate_path: null, certificate_name: null, ...o,
  })

  it('a payment with neither number nor file is flagged; a file alone or a number alone is not', async () => {
    mount([
      row({}),
      row({ payment_id: 'p2', order_number: 8, certificate_missing: false, certificate_path: 'wht/p2/a.pdf', certificate_name: 'cert.pdf' }),
      row({ payment_id: 'p3', order_number: 9, certificate_missing: false, certificate_no: 'CPR-9' }),
    ])
    const list = await screen.findByTestId('wht-deducted')
    expect(await within(list).findByTestId('wht-missing')).toHaveTextContent('1 payment has no certificate number or file yet.')
    expect(within(list).getByText('No certificate yet')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Open the certificate file of ORD-0008' })).toHaveTextContent('cert.pdf')
    expect(within(list).getByText('Certificate CPR-9')).toBeInTheDocument()
  })

  it('Add certificate saves the number on the payment (and nothing else) without a file', async () => {
    const user = userEvent.setup()
    const d = mountWith([row({})])
    const list = await screen.findByTestId('wht-deducted')
    await user.click(await within(list).findByRole('button', { name: 'Add the certificate of ORD-0007' }))
    await user.type(within(list).getByRole('textbox', { name: 'Certificate number' }), 'CPR-77')
    await user.click(within(list).getByRole('button', { name: 'Save' }))
    await screen.findByTestId('wht-deducted')
    const upd = d.calls.find(c => c.target === 'payments_in' && c.verb === 'update')!
    expect(upd.ops.find(([n]) => n === 'update')?.[1][0]).toEqual({ wht_certificate_no: 'CPR-77' })
    expect(d.calls.some(c => c.target.startsWith('storage'))).toBe(false)
  })
})

