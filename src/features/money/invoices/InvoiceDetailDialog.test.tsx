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
  tax_deposited_on: null,
  legacy_source: null,
  updated_at: '2025-01-11T00:00:00Z',
  voided_at: null,
  void_reason: null,
}

function setup(over: Record<string, unknown> = {}, closed: string[] = [], role = 'admin') {
  const d = installFakeDb((c: FakeCall) => {
    if (c.target === 'invoices' && c.verb === 'select') return { data: { ...INVOICE, ...over } }
    if (c.target === 'rpc:delete_invoice' && over.refuse) return { error: { code: 'P0001', message: 'This invoice has its tax deposit ticked against the March 2026 bank statement. Untick it first (Money, Match bank statement), then delete it.', hint: 'bank_ticked' } }
    if (c.target === 'rpc:void_invoice' && over.voidRefuse) return { error: { code: 'P0001', message: 'Invoice INV-0012 has a PSID or a tax deposit recorded, so it cannot be voided. Issue a credit note instead.', hint: 'filed' } }
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
    const { user } = setup({ tax_bank_month: '2025-01-01', number: null })
    await user.click(await screen.findByRole('button', { name: 'Delete invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    expect(within(dialog).getByText(/ticked against the January 2025 bank statement/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open Bank check' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('a refusal after the page loaded does not guess a statement month: it says a bank statement (M6)', async () => {
    const { user } = setup({ refuse: true, invoice_date: '2025-01-28', number: null })
    await user.click(await screen.findByRole('button', { name: 'Delete invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    await user.click(within(dialog).getByRole('checkbox', { name: 'I understand' }))
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/ticked against a bank statement\. Untick it first/)).toBeInTheDocument()
    expect(screen.queryByText(/January 2025 bank statement/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Bank check' })).toHaveAttribute('href', '/money/month-end/bank')
  })

  it('a return that may be filed needs the tick before Delete, then delete_invoice runs', async () => {
    const { d, user } = setup({ number: null })
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

describe('Invoice: void and credit note (0112)', () => {
  it('a numbered invoice offers Void and Create credit note, and no Delete', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Void invoice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create credit note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete invoice' })).toBeNull()
  })

  it('Void needs a reason, then void_invoice runs with it', async () => {
    const { d, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Void invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    const go = within(dialog).getByRole('button', { name: 'Void invoice' })
    expect(go).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason for voiding'), 'Wrong customer')
    expect(go).toBeEnabled()
    await user.click(go)
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:void_invoice')).toBe(true))
    const call = d.calls.find(c => c.target === 'rpc:void_invoice') as FakeCall
    expect(opArgs(call, 'args')?.[0]).toEqual({ p_invoice_id: 'i1', p_reason: 'Wrong customer' })
  })

  it('a filed invoice cannot be voided: the dialog says so and points to a credit note, with no Void button', async () => {
    const { user } = setup({ psid: 'PSID-1' })
    await user.click(await screen.findByRole('button', { name: 'Void invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    expect(within(dialog).getByTestId('void-blocked')).toHaveTextContent(/cannot be voided\. Issue a credit note instead/)
    expect(within(dialog).queryByRole('button', { name: 'Void invoice' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Create credit note' })).toBeInTheDocument()
  })

  it('a filed invoice has its figures fixed, with the way to correct them', async () => {
    setup({ psid: 'PSID-1' })
    expect(await screen.findByTestId('invoice-filed-line')).toHaveTextContent(/number, date and amounts are fixed\. To correct it, issue a credit note/)
    expect(screen.queryByLabelText('Net amount, PKR')).toBeNull()
  })

  it('a refusal the page did not foresee is shown, with the Credit note button', async () => {
    const { user } = setup({ voidRefuse: true })
    await user.click(await screen.findByRole('button', { name: 'Void invoice' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    await user.type(within(dialog).getByLabelText('Reason for voiding'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Void invoice' }))
    expect(await within(dialog).findByTestId('void-error')).toHaveTextContent(/Issue a credit note instead/)
    expect(within(dialog).getByRole('button', { name: 'Create credit note' })).toBeInTheDocument()
  })

  it('a void invoice shows why, and offers nothing to change', async () => {
    setup({ voided_at: '2025-01-12T10:00:00Z', void_reason: 'Wrong customer', voided_net: 100000, voided_gst: 18000, net_amount: 0, gst_amount: 0 })
    expect(await screen.findByTestId('invoice-void-banner')).toHaveTextContent(/Void: INV-0012 is kept in the register but counts for nothing\./)
    expect(screen.getByTestId('invoice-void-banner')).toHaveTextContent('Wrong customer')
    expect(screen.queryByRole('button', { name: 'Void invoice' })).toBeNull()
    expect(screen.queryByLabelText('Net amount, PKR')).toBeNull()
  })

  it('a save sends the version the page was opened with (M1), and says so when someone else changed the invoice', async () => {
    const { d, user } = setup({}, [])
    const net = await screen.findByLabelText('Net amount, PKR')
    await user.clear(net)
    await user.type(net, '90000')
    const warning = await screen.findByTestId('gst-filed-warning')
    await user.click(within(warning).getByRole('checkbox', { name: 'I understand' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'update')).toBe(true))
    const upd = d.calls.find(c => c.target === 'invoices' && c.verb === 'update') as FakeCall
    expect(JSON.stringify(upd)).toContain('2025-01-11T00:00:00Z')
    // the fake answers an update with no row: the version had moved on
    expect(await screen.findByText(/Someone else changed this invoice while you had it open/)).toBeInTheDocument()
  })
})
