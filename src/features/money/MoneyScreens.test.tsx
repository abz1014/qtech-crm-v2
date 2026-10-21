import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { CreateInvoiceDialog } from '@/features/money/invoices/CreateInvoiceDialog'
import { GstRegisterPage } from '@/features/money/invoices/GstRegisterPage'
import { RecordPaymentDialog } from '@/features/money/payments/RecordPaymentDialog'
import { ReceivablesPage } from '@/features/money/payments/ReceivablesPage'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { receivablesListResult } from '@/test/receivablesFake'
import { ToastProvider } from '@/ui/Toast'
import { businessToday } from '@/lib/dates'

const TODAY = businessToday()

const register = [
  { invoice_id: 'i1', invoice_date: '2026-10-30', number: 'INV-2299', order_id: 'o35', order_number: 35, company_id: 'c', company_name: 'Lahore Beverage Co.', net_amount: 468000, gst_amount: 84240, gross_amount: 552240, courier_state: 'not_started', fbr_state: 'pending', fbr_exception: false, needs_fbr_attention: false, psid: null, tax_deposited_on: null },
  { invoice_id: 'i2', invoice_date: '2026-10-24', number: 'INV-2294', order_id: 'o34', order_number: 34, company_id: 'c', company_name: 'Karachi Glassworks', net_amount: 706000, gst_amount: 127080, gross_amount: 833080, courier_state: 'not_started', fbr_state: 'pending', fbr_exception: false, needs_fbr_attention: false, psid: null, tax_deposited_on: null },
  { invoice_id: 'i3', invoice_date: '2026-10-17', number: 'INV-2291', order_id: 'o36', order_number: 36, company_id: 'c', company_name: 'Margalla Steel Re-rolling', net_amount: 702000, gst_amount: 126360, gross_amount: 828360, courier_state: 'not_started', fbr_state: 'pending', fbr_exception: false, needs_fbr_attention: true, psid: null, tax_deposited_on: null },
]
const receivables = [
  { order_id: 'o38', order_number: 38, company_id: 'c', owner_id: 'u', gross_target: 2300764, settled: 700000, balance: 1600764, overpaid_by: 0, due_on: null, is_overdue: false, payment_state: 'part', last_reminded_on: null, reminder_count: 0, data_trust: 'ok' },
  { order_id: 'o27', order_number: 27, company_id: 'c', owner_id: 'u', gross_target: 1911600, settled: 800000, balance: 1111600, due_on: '2020-10-20', is_overdue: true, overpaid_by: 0, payment_state: 'overdue', last_reminded_on: null, reminder_count: 0, data_trust: 'ok' },
]

function db(extra: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  return installFakeDb((c: FakeCall) => {
    const x = extra(c)
    if (x) return x
    switch (c.target) {
      case 'v_gst_register':
        return { data: register }
      case 'rpc:order_receivables': {
        const id = (c.ops[0]?.[1][0] as { p_order_id?: string } | undefined)?.p_order_id
        return { data: id ? receivables.filter(r => r.order_id === id) : receivables }
      }
      case 'rpc:receivables_list':
        return receivablesListResult(c, receivables, { companyName: () => 'Punjab Cement Ltd', invoiceNumbers: id => (id === 'o27' ? ['INV-2256'] : []) })
      case 'rpc:next_invoice_number':
        return { data: [{ next_number: 'INV-2312', last_number: 'INV-2311', last_date: '2026-11-25' }] }
      case 'rpc:stamp_tcs_sent':
      case 'rpc:stamp_fbr_psid':
      case 'rpc:stamp_tax_deposited':
        return { data: 3 }
      case 'companies':
        return { data: [{ id: 'c', name: 'Punjab Cement Ltd' }] }
      case 'orders':
        return { data: c.ops.some(([k]) => k === 'maybeSingle') ? { id: 'o38', number: 38, company_id: 'c', payment_terms_days: 30, cancelled_on: null } : [{ id: 'o38', cancelled_on: null }, { id: 'o27', cancelled_on: null }] }
      case 'v_order_items_total':
        return { data: { net: 1949800, gst: 350964 } }
      case 'order_items':
        return { data: Array.from({ length: 8 }, () => ({ gst_rate: 18 })) }
      case 'payments_in':
        return c.verb === 'insert' ? {} : { data: [{ received_on: '2026-11-09', amount: 700000 }] }
      case 'invoices':
        return { data: c.verb === 'select' && c.ops.some(([k, a]) => k === 'select' && String(a[0]).includes('number')) ? [{ order_id: 'o27', number: 'INV-2256', invoice_date: '2026-09-20' }] : [] }
      default:
        return { data: [] }
    }
  })
}

function mount(ui: React.ReactNode, role: 'admin' | 'sales' = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
        <MemoryRouter>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Record payment (M02)', () => {
  it('opens with the balance due and today, says it settles the order, and Save is the only tap', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<RecordPaymentDialog open onOpenChange={() => {}} orderId="o38" />)
    const amount = await screen.findByRole('textbox', { name: 'Amount received, PKR' })
    expect(amount).toHaveValue('1,600,764')
    expect(screen.getByText(`Balance due on ORD-0038`)).toBeInTheDocument()
    expect(screen.getByTestId('payment-note')).toHaveTextContent('This settles the order: PKR 1,600,764 of 2,300,764 gross, after the advance of 700,000 on 9 Nov')
    await user.click(screen.getByRole('button', { name: 'Save payment' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'payments_in' && c.verb === 'insert')).toBe(true))
    const call = d.calls.find(c => c.target === 'payments_in' && c.verb === 'insert')!
    expect(opArgs(call, 'insert')?.[0]).toMatchObject({ order_id: 'o38', amount: 1600764, received_on: TODAY, paid_via: 'bank', reference: null })
  })

  it('a smaller amount is a part payment, and says what stays due', async () => {
    const user = userEvent.setup()
    db()
    mount(<RecordPaymentDialog open onOpenChange={() => {}} orderId="o38" />)
    const amount = await screen.findByRole('textbox', { name: 'Amount received, PKR' })
    await user.clear(amount)
    await user.type(amount, '600000')
    expect(screen.getByTestId('payment-note')).toHaveTextContent('PKR 1,000,764 will still be due')
  })

  it('a closed month shows the sentence under the date and keeps the amount', async () => {
    const user = userEvent.setup()
    db(c => (c.target === 'payments_in' && c.verb === 'insert' ? { error: { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' } } : undefined))
    mount(<RecordPaymentDialog open onOpenChange={() => {}} orderId="o38" />)
    await screen.findByRole('textbox', { name: 'Amount received, PKR' })
    await user.click(screen.getByRole('button', { name: 'Save payment' }))
    expect(await screen.findByText('September 2026 is closed. An admin can reopen it.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue('1,600,764')
  })
})

describe('Create invoice (M01)', () => {
  it('opens with the next number, today, and the order amounts: Create invoice is the only tap', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<CreateInvoiceDialog open onOpenChange={() => {}} orderId="o38" />)
    const number = await screen.findByRole('textbox', { name: 'Invoice number' })
    expect(number).toHaveValue('INV-2312')
    expect(screen.getByText(/Next after INV-2311/)).toBeInTheDocument()
    expect(screen.getByText('GST, 18%')).toBeInTheDocument()
    expect(screen.getByText('1,949,800')).toBeInTheDocument()
    expect(screen.getByText('350,964')).toBeInTheDocument()
    expect(screen.getByText('2,300,764')).toBeInTheDocument()
    expect(screen.getByText(/30 days from invoice/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create invoice' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'insert')).toBe(true))
    const call = d.calls.find(c => c.target === 'invoices' && c.verb === 'insert')!
    expect(opArgs(call, 'insert')?.[0]).toMatchObject({ order_id: 'o38', number: 'INV-2312', invoice_date: TODAY, net_amount: 1949800, gst_amount: 350964 })
  })

  it('GST is 18% or exempt: switching to exempt zeroes it', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<CreateInvoiceDialog open onOpenChange={() => {}} orderId="o38" />)
    await screen.findByRole('textbox', { name: 'Invoice number' })
    await user.click(screen.getByRole('button', { name: /Edit the amounts/ }))
    expect(screen.queryByRole('radio', { name: /5%|12%/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Exempt' }))
    expect(screen.getByText('GST, exempt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create invoice' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'insert')).toBe(true))
    expect(opArgs(d.calls.find(c => c.target === 'invoices' && c.verb === 'insert')!, 'insert')?.[0]).toMatchObject({ gst_amount: 0, net_amount: 1949800 })
  })

  it('a number already in the register is refused under the number field, and everything stays', async () => {
    const user = userEvent.setup()
    db(c => (c.target === 'invoices' && c.verb === 'insert' ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "invoices_number_key"' } } : undefined))
    mount(<CreateInvoiceDialog open onOpenChange={() => {}} orderId="o38" />)
    await screen.findByRole('textbox', { name: 'Invoice number' })
    await user.click(screen.getByRole('button', { name: 'Create invoice' }))
    expect(await screen.findByText('This invoice number is already in the register. Use the next one.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Invoice number' })).toHaveValue('INV-2312')
  })
})

describe('GST register (M01)', () => {
  it('month stamping is tick, then one tap per step with one PSID paste, and writes to every ticked invoice', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<GstRegisterPage />)
    await screen.findByText('INV-2299')
    expect(screen.getByText('October 2026 · 3 invoices')).toBeInTheDocument()
    expect(screen.getByText('October invoice, tax not deposited')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Select all in October 2026/ })) // tap 1: tick the month
    expect(screen.getByTestId('batch-bar')).toHaveTextContent('3 invoices ticked')
    await user.click(screen.getByRole('button', { name: 'Sent by TCS today' })) // tap 2
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:stamp_tcs_sent')).toBe(true))
    expect((opArgs(d.calls.find(c => c.target === 'rpc:stamp_tcs_sent')!, 'args') as { p_invoice_ids: string[] }[])[0].p_invoice_ids.sort()).toEqual(['i1', 'i2', 'i3'])
    await user.click(screen.getByRole('textbox', { name: 'PSID' }))
    await user.paste('1234567890')
    await user.keyboard('{Enter}') // the paste, confirmed with Enter: no tap
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:stamp_fbr_psid')).toBe(true))
    expect((opArgs(d.calls.find(c => c.target === 'rpc:stamp_fbr_psid')!, 'args') as { p_psid: string }[])[0].p_psid).toBe('1234567890')
    await user.click(screen.getByRole('button', { name: 'Deposited today' })) // tap 3
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:stamp_tax_deposited')).toBe(true))
  })

  it('admin can export; sales tick and stamp the same register (Today sends them the TCS and FBR items), without Export, Net or GST', async () => {
    const user = userEvent.setup()
    db()
    const a = mount(<GstRegisterPage />)
    await screen.findByText('INV-2299')
    expect(screen.getByRole('columnheader', { name: /Tax deposited \(FBR\)/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: 'Export' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    a.unmount()
    const d = db()
    mount(<GstRegisterPage />, 'sales')
    await screen.findByText('INV-2299')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Export' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'GST register' })
    for (const h of ['Net', 'GST']) expect(within(table).queryByRole('columnheader', { name: h })).toBeNull()
    expect(within(table).getByRole('columnheader', { name: /Tax deposited \(FBR\)/ })).toBeInTheDocument()
    // ONE switch (R2-15): All, Needs attention N, Not sent by TCS N; the counts are needs-you pills
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Needs attention/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Not sent by TCS/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search invoices' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Select all in October 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Sent by TCS today' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'rpc:stamp_tcs_sent')).toBe(true))
  })

  it('shows each courier and FBR state once, as a chip, never a chip beside a progress bar', async () => {
    db()
    const { container } = mount(<GstRegisterPage />)
    await screen.findByText('INV-2299')
    expect(container.querySelectorAll('[data-on]')).toHaveLength(0) // no step-track bar segments (the old StatusTrack is gone)
  })

  it('Needs attention filters the list and the totals recompute', async () => {
    const user = userEvent.setup()
    db()
    mount(<GstRegisterPage />)
    await screen.findByText('INV-2299')
    await user.click(screen.getByRole('radio', { name: /Needs attention/ }))
    expect(screen.queryByText('INV-2299')).not.toBeInTheDocument()
    expect(screen.getByText('INV-2291')).toBeInTheDocument()
    expect(screen.getByText('All 1 invoice shown')).toBeInTheDocument()
  })

  it('Search invoices narrows the register and says so when nothing matches', async () => {
    const user = userEvent.setup()
    db()
    mount(<GstRegisterPage />)
    await screen.findByText('INV-2299')
    await user.type(screen.getByRole('textbox', { name: 'Search invoices' }), 'glassworks')
    expect(screen.queryByText('INV-2299')).not.toBeInTheDocument()
    expect(screen.getByText('INV-2294')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search invoices' }), ' nothing-like-this')
    expect(screen.getByText('Nothing matches "glassworks nothing-like-this"')).toBeInTheDocument()
    // the empty state's own button (the field's clear x shares the name)
    await user.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!)
    expect(screen.getByText('INV-2299')).toBeInTheDocument()
  })
})

describe('Who owes us (M02)', () => {
  it('admin sees balances and a Record payment action per open order', async () => {
    db()
    mount(<ReceivablesPage />)
    expect(await screen.findByText('Indus Textile Mills').catch(() => screen.findAllByText('Punjab Cement Ltd'))).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Record payment for ORD-/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Who owes us', { selector: 'h2' })).toBeInTheDocument()
  })

  it('sales see the same page under the same name, with no Record payment, and never ask for a payment row', async () => {
    const d = db()
    mount(<ReceivablesPage />, 'sales')
    await screen.findAllByText('Punjab Cement Ltd')
    expect(screen.getByText('Who owes us', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record payment/ })).not.toBeInTheDocument()
    expect(d.calls.filter(c => c.target === 'payments_in')).toHaveLength(0)
    expect(within(screen.getByRole('table', { name: 'Who owes us' })).getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('has ONE info tip beside "Balance is gross, GST included", covering the balance and reminders', async () => {
    db()
    mount(<ReceivablesPage />)
    await screen.findAllByText('Punjab Cement Ltd')
    const toolbar = screen.getByText('Balance is gross, GST included').parentElement as HTMLElement
    expect(toolbar.querySelectorAll('[data-infotip]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'About the balance and reminders' })).toBeInTheDocument()
  })

  it('an empty list says "Nothing is owed" only when orders exist; with none ever, a neutral first-use line', async () => {
    const empty = db(c => (c.target === 'rpc:receivables_list' ? receivablesListResult(c, [], {}) : undefined))
    const first = mount(<ReceivablesPage />)
    expect(await screen.findByText('No balances yet')).toBeInTheDocument()
    expect(screen.queryByText(/Every order is paid in full/)).toBeNull()
    first.unmount()
    empty.uninstall()

    const settled = receivables.map(r => ({ ...r, balance: 0, settled: r.gross_target, is_overdue: false, payment_state: 'settled' }))
    db(c => (c.target === 'rpc:receivables_list' ? receivablesListResult(c, settled, { companyName: () => 'Punjab Cement Ltd' }) : undefined))
    mount(<ReceivablesPage />)
    expect(await screen.findByText('Nothing is owed')).toBeInTheDocument()
    expect(screen.getByText(/Every order is paid in full/)).toBeInTheDocument()
  })

  it('the filter carries no counts: Overdue is not a needs-you count (the Who owes us tab carries the to-remind one)', async () => {
    db()
    mount(<ReceivablesPage />)
    await screen.findAllByText('Punjab Cement Ltd')
    const filter = screen.getByRole('radiogroup', { name: 'Filter' })
    expect(within(filter).getByRole('radio', { name: /Overdue/ })).toHaveTextContent(/^Overdue$/)
    expect(within(filter).getByRole('radio', { name: /Open/ })).toHaveTextContent(/^Open$/)
  })

  it('has ONE Next step column (no Payment chip, no Last reminder), and Search balances narrows the list (R2-06)', async () => {
    const user = userEvent.setup()
    db()
    mount(<ReceivablesPage />)
    await screen.findAllByText('Punjab Cement Ltd')
    const table = screen.getByRole('table', { name: 'Who owes us' })
    expect(within(table).getByRole('columnheader', { name: /Next step/ })).toBeInTheDocument()
    for (const h of [/^Payment/, /Last reminder/]) expect(within(table).queryByRole('columnheader', { name: h })).toBeNull()
    expect(table.querySelector('[data-status-text], [data-tone]')).not.toBeNull()
    const search = screen.getByRole('textbox', { name: 'Search balances' })
    await user.type(search, 'no-such-customer')
    expect(screen.getByText('Nothing matches "no-such-customer"')).toBeInTheDocument()
  })
})
