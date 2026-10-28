import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { InvoiceDetailDialog } from '@/features/money/invoices/InvoiceDetailDialog'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* W11: edit an invoice's number, date, net and GST in an open month; the GST-filed warning with its tick; delete with its hints. */
const INVOICE = {
  id: 'i1',
  number: 'INV-0012',
  invoice_date: '2025-01-10', // long past the 18th of February 2025: the return may be filed
  net_amount: 100000,
  gst_amount: 18000,
  order_id: 'o1',
  psid: null,
  tax_bank_month: null,
  tax_deposit_amount: null,
  legacy_source: null,
}

function setup(over: Record<string, unknown> = {}, closed: string[] = [], role = 'admin') {
  const d = installFakeDb((c: FakeCall) => {
    if (c.target === 'invoices' && c.verb === 'select') return { data: { ...INVOICE, ...over } }
    if (c.target === 'rpc:delete_invoice' && over.refuse) return { error: { code: 'P0001', message: 'This invoice has its tax deposit ticked against the March 2026 bank statement. Untick it first (Money, Match bank statement), then delete it.', hint: 'bank_ticked' } }
    if (c.target === 'rpc:month_closed') return { data: closed.includes('2025-01') }
    if (c.target === 'closed_months') return { data: closed.map(m => ({ month: `${m}-01`, closed_at: '2025-03-01T00:00:00Z', closed_by: 'u', note: null })) }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role } as never }}>
        <MemoryRouter>
          <ToastProvider>
            <InvoiceDetailDialog invoiceId="i1" onClose={() => undefined} />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { d, user: userEvent.setup() }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Invoice: edit', () => {
  it('a change in a month whose return may be filed warns, needs the tick, then sends only what changed', async () => {
    const { d, user } = setup()
    const net = await screen.findByLabelText('Net amount, PKR')
    expect(screen.queryByTestId('gst-filed-warning')).toBeNull()
    await user.clear(net)
    await user.type(net, '90000')
    const warning = await screen.findByTestId('gst-filed-warning')
    expect(warning.textContent).toContain("This month's GST return may already be filed. File a revised return with FBR.")
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText(/Tick the box to go on/)).length).toBeGreaterThan(0)
    expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'update')).toBe(false)
    await user.click(within(warning).getByRole('checkbox', { name: 'I understand' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'update')).toBe(true))
    const upd = d.calls.find(c => c.target === 'invoices' && c.verb === 'update') as FakeCall
    expect(opArgs(upd, 'update')?.[0]).toMatchObject({ net_amount: 90000 })
    expect(opArgs(upd, 'update')?.[0]).not.toHaveProperty('number')
    expect(opArgs(upd, 'update')?.[0]).not.toHaveProperty('invoice_date')
  })

  it('a change that is not to the invoice itself (a note) needs no tick', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText(/Notes/), 'Customer asked for a copy')
    expect(screen.queryByTestId('gst-filed-warning')).toBeNull()
  })

  it('a closed month shows the figures as text with the lock line, and no edit boxes or Delete', async () => {
    setup({}, ['2025-01'])
    expect(await screen.findByTestId('invoice-closed-line')).toHaveTextContent('Month closed. Reopen the month first, in Lock a month, to change or delete.')
    expect(screen.queryByLabelText('Net amount, PKR')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete invoice' })).toBeNull()
  })
})

describe('Invoice: a closed month for sales (M4)', () => {
  it('sales cannot read closed_months, so they ask the one month: read-only with the reason, no edit boxes', async () => {
    setup({}, ['2025-01'], 'sales')
    expect(await screen.findByTestId('invoice-closed-line')).toHaveTextContent('INV-0012 is in a closed month. An admin can reopen it.')
    expect(screen.queryByLabelText('Net amount, PKR')).toBeNull()
  })
  it('sales in an open month still edit', async () => {
    setup({}, [], 'sales')
    expect(await screen.findByLabelText('Net amount, PKR')).toBeInTheDocument()
  })
})

describe('Invoice: delete', () => {
  it('a bank-ticked invoice says which statement, links to it, and has no Delete', async () => {
    const { user } = setup({ tax_bank_month: '2025-01-01' })
    await user.click(await screen.findByRole('button', { name: 'Delete invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    expect(within(dialog).getByText(/ticked against the January 2025 bank statement/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open Bank check' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('a refusal after the page loaded does not guess a statement month: it says a bank statement (M6)', async () => {
    const { user } = setup({ refuse: true, invoice_date: '2025-01-28' })
    await user.click(await screen.findByRole('button', { name: 'Delete invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    await user.click(within(dialog).getByRole('checkbox', { name: 'I understand' }))
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/ticked against a bank statement\. Untick it first/)).toBeInTheDocument()
    expect(screen.queryByText(/January 2025 bank statement/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Bank check' })).toHaveAttribute('href', '/money/month-end/bank')
  })

  it('a return that may be filed needs the tick before Delete, then delete_invoice runs', async () => {
    const { d, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Delete invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    const del = within(dialog).getByRole('button', { name: 'Delete' })
    expect(del).toBeDisabled()
    expect(within(dialog).getByText(/may already be filed/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'I understand' }))
    expect(del).toBeEnabled()
    await user.click(del)
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:delete_invoice')).toBe(true))
    const call = d.calls.find(c => c.target === 'rpc:delete_invoice') as FakeCall
    expect((opArgs(call, 'args')?.[0] as { p_invoice_id: string }).p_invoice_id).toBe('i1')
  })
})
