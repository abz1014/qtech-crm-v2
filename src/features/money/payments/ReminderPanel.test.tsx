import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { navItemsForRole } from '@/app/navConfig'
import { ReceivablesPage } from '@/features/money/payments/ReceivablesPage'
import { ReminderPanel } from '@/features/money/payments/ReminderPanel'
import type { ReceivableRow } from '@/features/money/payments/model'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { businessToday } from '@/lib/dates'

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))
import { copyToClipboard } from '@/lib/clipboard'

const TODAY = businessToday()
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

const row = (o: Partial<ReceivableRow> = {}): ReceivableRow => ({
  orderId: 'o27',
  orderNumber: 27,
  companyId: 'c1',
  companyName: 'Indus Textile Mills',
  ownerId: 'u',
  invoiceNumbers: ['INV-2256'],
  gross: 1_911_600,
  settled: 800_000,
  balance: 1_111_600,
  overpaidBy: 0,
  dueOn: daysAgo(38),
  isOverdue: true,
  state: 'overdue',
  lastRemindedOn: daysAgo(13),
  reminderCount: 2,
  ...o,
})

function db(extra: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  return installFakeDb((c: FakeCall) => {
    const x = extra(c)
    if (x) return x
    switch (c.target) {
      case 'orders':
        return { data: c.ops.some(([k]) => k === 'maybeSingle') ? { customer_po_number: '251992', contact_id: 'ct1' } : [{ id: 'o27', cancelled_on: null }, { id: 'o35', cancelled_on: null }] }
      case 'contacts':
        return { data: { name: 'Mr. Faisal Qureshi', phone: '0300 555 0118', email: 'faisal.q@indus-textile.example', job_title: 'Accounts' } }
      case 'invoices':
        return { data: [{ id: 'inv1', number: 'INV-2256', invoice_date: '2026-09-20', last_reminded_on: daysAgo(13), reminder_count: 2 }] }
      case 'users':
        return { data: [{ id: 'u', job_title: 'Sales' }] }
      case 'rpc:stamp_payment_reminder':
        return { data: 1 }
      default:
        return { data: [] }
    }
  })
}

function mount(ui: React.ReactNode, role: 'admin' | 'sales' = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role } }}>
        <MemoryRouter>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.mocked(copyToClipboard).mockClear())
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Payment-reminder panel (M09)', () => {
  it('shows the prepared WhatsApp text for the picked order, with who it goes to and how often it was reminded', async () => {
    db()
    mount(<ReminderPanel row={row()} today={TODAY} />)
    const text = await screen.findByTestId('reminder-text')
    expect(text.textContent).toContain('Assalamu alaikum Mr. Faisal Qureshi,')
    expect(text.textContent).toContain('INV-2256')
    expect(text.textContent).toContain('PKR 1,111,600')
    expect(text.textContent).toContain('after your payment of PKR 800,000')
    expect(text.textContent).toContain('38 days overdue')
    expect(screen.getByText(/To/, { selector: 'span' }).textContent).toContain('Mr. Faisal Qureshi, Accounts')
    expect(screen.getByText('0300 555 0118')).toBeInTheDocument()
    expect(screen.getByTestId('reminder-state').textContent).toMatch(/Reminded 2× · last .* · 13 days ago/)
    expect(screen.getByText(/Firmer wording, because the invoice is/)).toBeInTheDocument()
    expect(screen.queryByText(/IBAN|bank/i)).not.toBeInTheDocument() // Q5 is open: no bank details
  })

  it('the email variant carries the figures: invoice, total, received, outstanding, due date, days overdue', async () => {
    const user = userEvent.setup()
    db()
    mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    await user.click(screen.getByRole('radio', { name: 'Email' }))
    const t = screen.getByTestId('reminder-text').textContent ?? ''
    expect(t).toContain('Invoice total: PKR 1,911,600')
    expect(t).toContain('Received: PKR 800,000')
    expect(t).toContain('Outstanding: PKR 1,111,600')
    expect(t).toContain('Days overdue: 38')
    expect(screen.getByText('faisal.q@indus-textile.example')).toBeInTheDocument()
  })

  it('"Copy and mark reminded" is one tap: it copies, stamps every invoice of the order, and offers Undo', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    await user.click(screen.getByRole('button', { name: 'Copy and mark reminded' }))
    expect(await screen.findByText(/Reminder/)).toBeInTheDocument()
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain('INV-2256')
    const stamp = d.calls.filter(c => c.target === 'rpc:stamp_payment_reminder')
    expect(stamp).toHaveLength(1)
    expect((opArgs(stamp[0], 'args')?.[0] as { p_invoice_ids: string[] }).p_invoice_ids).toEqual(['inv1'])
    expect(screen.getByTestId('reminder-state').textContent).toMatch(/Reminded 3× · last .* · today/)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy and mark reminded' })).not.toBeInTheDocument()
  })

  it('Open in WhatsApp marks nothing; the separate "Mark reminded" stamps, and Undo takes it back', async () => {
    const user = userEvent.setup()
    const d = db()
    const clicked: string[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href)
    })
    mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    expect(screen.queryByRole('button', { name: 'Mark reminded' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open in WhatsApp' }))
    expect(clicked[0]).toMatch(/^https:\/\/wa\.me\/923005550118\?text=.*INV-2256/)
    expect(copyToClipboard).not.toHaveBeenCalled()
    expect(d.calls.filter(c => c.target === 'rpc:stamp_payment_reminder')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Mark reminded' }))
    expect(await screen.findByText(/recorded today/)).toBeInTheDocument()
    expect(screen.queryByText(/Copied\./)).not.toBeInTheDocument()
    expect(d.calls.filter(c => c.target === 'rpc:stamp_payment_reminder')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy and mark reminded' })).toBeInTheDocument())
    expect(d.calls.some(c => c.target === 'invoices' && c.verb === 'update')).toBe(true)
    spy.mockRestore()
  })

  it('Undo puts the previous reminder fields back', async () => {
    const user = userEvent.setup()
    const d = db()
    mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    await user.click(screen.getByRole('button', { name: 'Copy and mark reminded' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy and mark reminded' })).toBeInTheDocument())
    const restore = d.calls.find(c => c.target === 'invoices' && c.verb === 'update')
    expect(restore).toBeTruthy()
    expect(opArgs(restore as FakeCall, 'update')?.[0]).toEqual({ last_reminded_on: expect.any(String), reminder_count: 2 })
  })

  it('a copy that fails marks nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    const d = db()
    mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    await user.click(screen.getByRole('button', { name: 'Copy and mark reminded' }))
    await screen.findByText('Could not copy the message')
    expect(d.calls.filter(c => c.target === 'rpc:stamp_payment_reminder')).toHaveLength(0)
  })

  it('an order not yet overdue, or not invoiced, gets the plain sentence and no message', () => {
    db()
    const { unmount } = mount(<ReminderPanel row={row({ state: 'part', isOverdue: false, dueOn: '2099-01-01' })} today={TODAY} />)
    expect(screen.getByText('Not overdue yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('reminder-text')).not.toBeInTheDocument()
    unmount()
    mount(<ReminderPanel row={row({ invoiceNumbers: [], dueOn: null, state: 'part' })} today={TODAY} />)
    expect(screen.getByText('Not invoiced yet.')).toBeInTheDocument()
  })

  it('names every invoice of the order when there are two', async () => {
    db(c => (c.target === 'invoices' ? { data: [{ id: 'a', number: 'INV-1', invoice_date: '2026-09-01', last_reminded_on: null, reminder_count: 0 }, { id: 'b', number: 'INV-2', invoice_date: '2026-09-10', last_reminded_on: null, reminder_count: 0 }] } : undefined))
    mount(<ReminderPanel row={row({ invoiceNumbers: ['INV-1', 'INV-2'], lastRemindedOn: null, reminderCount: 0 })} today={TODAY} />)
    const t = (await screen.findByTestId('reminder-text')).textContent ?? ''
    expect(t).toContain('Sales Tax Invoices INV-1, INV-2')
    expect(screen.getByTestId('reminder-state').textContent).toBe('Not reminded yet')
  })
})

describe('the panel beside Receivables (M09)', () => {
  const receivables = [
    { order_id: 'o27', order_number: 27, company_id: 'c1', owner_id: 'u', gross_target: 1911600, settled: 800000, balance: 1111600, overpaid_by: 0, due_on: daysAgo(38), is_overdue: true, payment_state: 'overdue', last_reminded_on: daysAgo(13), reminder_count: 2, data_trust: 'ok' },
    { order_id: 'o35', order_number: 35, company_id: 'c2', owner_id: 'u', gross_target: 552240, settled: 300000, balance: 252240, overpaid_by: 0, due_on: '2099-12-14', is_overdue: false, payment_state: 'part', last_reminded_on: null, reminder_count: 0, data_trust: 'ok' },
  ]
  const feed = (c: FakeCall): FakeResult | undefined => {
    if (c.target === 'rpc:order_receivables') return { data: receivables }
    if (c.target === 'companies') return { data: [{ id: 'c1', name: 'Indus Textile Mills' }, { id: 'c2', name: 'Lahore Beverage Co.' }] }
    if (c.target === 'invoices' && c.ops.some(([k, a]) => k === 'select' && String(a[0]).includes('invoice_date') && !String(a[0]).includes('reminded'))) {
      return { data: [{ order_id: 'o27', number: 'INV-2256', invoice_date: '2026-09-20' }, { order_id: 'o35', number: 'INV-2299', invoice_date: '2026-10-30' }] }
    }
    return undefined
  }

  it('opens on the first overdue order, and picking another row swaps the panel', async () => {
    const user = userEvent.setup()
    db(feed)
    mount(<ReceivablesPage />)
    expect((await screen.findByTestId('reminder-text')).textContent).toContain('INV-2256')
    await user.click(screen.getByText('Lahore Beverage Co.'))
    expect(await screen.findByText('Not overdue yet.')).toBeInTheDocument()
  })

  it('sales get the same panel; neither role is sent to the order by tapping a row', async () => {
    db(feed)
    mount(<ReceivablesPage />, 'sales')
    expect(await screen.findByTestId('reminder-text')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open ORD-0027' })).toHaveAttribute('href', '/orders/o27')
  })
})

describe('Record payment beside the reminder (UX audit rec 4)', () => {
  it('the admin records a payment from the panel, for an overdue and for a not-yet-due order; sales never see the button', async () => {
    db()
    const a = mount(<ReminderPanel row={row()} today={TODAY} />)
    await screen.findByTestId('reminder-text')
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/orders/o27')
    a.unmount()
    const b = mount(<ReminderPanel row={row({ state: 'part', isOverdue: false, dueOn: TODAY })} today={TODAY} />)
    expect(await screen.findByText('Not overdue yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    b.unmount()
    mount(<ReminderPanel row={row()} today={TODAY} />, 'sales')
    await screen.findByTestId('reminder-text')
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
  })
})

describe('engineers cannot reach the reminder (M09)', () => {
  it('Money is not in an engineer\'s navigation, and the stamp RPC is only ever called from the panel', () => {
    expect(navItemsForRole('engineer').map(i => i.path)).not.toContain('/money')
    expect(navItemsForRole('sales').map(i => i.path)).toContain('/money')
  })
})
