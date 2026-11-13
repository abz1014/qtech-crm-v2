import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { GstRegisterPage } from '@/features/money/invoices/GstRegisterPage'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * The phone Invoices page (clarity lane L2): the four summary lines, the month headers that carry Net, GST and Gross, the card
 * that unfolds for the admin (and never shows Net or GST to sales), and the one-row Money switcher with its sheet.
 */
const row = (id: string, date: string, n: string, co: string, net: number, gst: number) => ({
  invoice_id: id, invoice_date: date, number: n, order_id: `o${id}`, order_number: 1, company_id: 'c', company_name: co,
  net_amount: net, gst_amount: gst, gross_amount: net + gst, courier_state: 'sent', fbr_state: 'pending', fbr_exception: false,
  needs_fbr_attention: false, psid: null, tax_deposited_on: null,
})
const REGISTER = [
  row('1', '2026-10-28', 'INV-0108', 'Kohat Mills', 1902000, 342360),
  row('2', '2026-10-12', 'INV-0104', 'Karachi Refinery Services', 942000.1, 169560.02),
  row('3', '2026-09-25', 'INV-0103', 'Sindh Gas Pipelines', 1375000, 247500),
]
const WITH_VOID = [...REGISTER, { ...row('4', '2026-10-05', 'INV-0101', 'Voided Co', 100, 18), voided_at: '2026-10-06T00:00:00Z' }, { ...row('5', '2026-10-06', 'CN-0001', 'Credit Co', -100, -18), row_kind: 'credit_note' }]

const desktopMedia = window.matchMedia
function phone() {
  window.matchMedia = ((q: string) => ({ matches: /max-width: (639|767)px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia
}
afterEach(() => {
  cleanup()
  window.matchMedia = desktopMedia
  installFakeDb(() => ({})).uninstall()
})

function mount(role: 'admin' | 'sales', data: object[] = REGISTER) {
  phone()
  installFakeDb(c => (c.target === 'v_gst_register' ? { data } : { data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'T', role } }}>
        <MemoryRouter initialEntries={['/money/gst-register']}>
          <ToastProvider>
            <GstRegisterPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Invoices on a phone: admin', () => {
  it('shows Invoices, Net, GST and Gross as lines, with the period said once', async () => {
    mount('admin')
    await screen.findByText('INV-0108')
    const lines = screen.getByRole('region', { name: 'Totals for the invoices shown' })
    const terms = within(lines).getAllByRole('term').map(t => t.textContent)
    expect(terms).toEqual(['Invoices', 'Net', 'GST', 'Gross'])
    expect(screen.getAllByText(/by invoice date/)).toHaveLength(1)
    expect(lines).toHaveTextContent('PKR · Sep to Oct 2026, by invoice date')
    expect(lines).toHaveTextContent('Gross')
    expect(lines).toHaveTextContent('4,219')
    expect(lines).toHaveAttribute('data-work')
  })

  it('each month header carries its Net, GST and Gross, summed in paisa from its rows', async () => {
    mount('admin')
    await screen.findByText('INV-0108')
    const rows = screen.getAllByRole('row')
    const october = rows.find(r => r.textContent?.includes('October 2026') && r.getAttribute('data-row-kind') === 'group')
    expect(october).toBeTruthy()
    // 1,902,000 + 942,000.10 = 2,844,000.10 net; 342,360 + 169,560.02 = 511,920.02 GST; gross 3,355,920.12 (whole rupees on screen)
    expect(october).toHaveTextContent('Net2,844,000')
    expect(october).toHaveTextContent('GST511,920')
    expect(october).toHaveTextContent('Gross3,355,920')
    const september = rows.find(r => r.textContent?.includes('September 2026') && r.getAttribute('data-row-kind') === 'group')
    expect(september).toHaveTextContent('Net1,375,000')
  })

  it('the month header counts invoices only, not a void invoice or a credit note', async () => {
    mount('admin', WITH_VOID)
    await screen.findByText('INV-0108')
    const october = screen.getAllByRole('row').find(r => r.textContent?.includes('October 2026') && r.getAttribute('data-row-kind') === 'group')
    expect(october).toHaveTextContent('2 invoices')
  })

  it('a tap unfolds Net, GST, Open invoice and PDF; a second tap folds it', async () => {
    const user = userEvent.setup()
    mount('admin')
    const card = (await screen.findByText('INV-0108')).closest('tr') as HTMLElement
    expect(within(card).queryByRole('button', { name: 'Open invoice' })).toBeNull()
    await user.click(card)
    expect(card).toHaveAttribute('data-expanded', 'true')
    expect(within(card).getByText('Net')).toBeInTheDocument()
    expect(within(card).getByText('GST')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Open invoice' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'PDF' })).toBeInTheDocument()
    await user.click(card)
    expect(card).toHaveAttribute('data-expanded', 'false')
  })

  it('the Money switcher is one row that opens a sheet of the five tabs and six pages, the current one ticked, and Escape closes it', async () => {
    const user = userEvent.setup()
    mount('admin')
    const open = await screen.findByTestId('money-switcher')
    expect(open).toHaveTextContent('Invoices')
    expect(open).toHaveTextContent('All Money pages')
    expect(screen.queryByRole('group', { name: 'More money pages' })).toBeNull()
    await user.click(open)
    const nav = await screen.findByRole('navigation', { name: 'All Money pages' })
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual([
      'To collect', 'Invoices', 'Expenses', 'Lock a month', 'Reports', 'Margins', 'Mistakes to fix', 'Bank check', 'Review imported', 'GST to FBR', 'Profitability',
    ])
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'All Money pages' })).toBeNull())
  })
})

describe('Invoices on a phone: sales', () => {
  it('sees Invoices and Gross only, never Net or GST, keeps the three tabs and has no switcher', async () => {
    mount('sales')
    const lines = await screen.findByRole('region', { name: 'Totals for the invoices shown' })
    expect(within(lines).getAllByRole('term').map(t => t.textContent)).toEqual(['Invoices', 'Gross'])
    await screen.findByText('INV-0108')
    expect(screen.queryByText('Net')).toBeNull()
    expect(screen.queryByText('GST')).toBeNull()
    expect(screen.queryByTestId('money-switcher')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Money views' })).getAllByRole('link').map(a => a.textContent)).toEqual(['To collect', 'Invoices', 'Reports'])
    const card = screen.getByText('INV-0108').closest('tr') as HTMLElement
    expect(card).not.toHaveAttribute('data-expanded')
  })
})
