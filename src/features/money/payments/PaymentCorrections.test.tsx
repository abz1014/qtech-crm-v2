import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { OrderPaymentLines } from '@/features/money/payments/PaymentCorrections'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const pay = (o: Record<string, unknown> = {}) => ({
  id: 'p1',
  order_id: 'o1',
  received_on: '2026-10-05',
  amount: 5900,
  paid_via: 'bank',
  reference: 'TT-1',
  bank_month: null,
  created_at: '2026-10-05T10:00:00+00:00',
  created_by: 'u',
  credited_user_id: null,
  legacy_source: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  corrects_payment_id: null,
  ...o,
})

function db(rows: unknown[], extra: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  return installFakeDb((c: FakeCall) => extra(c) ?? (c.target === 'payments_in' ? { data: rows } : { data: null }))
}

function mount(role: 'admin' | 'sales' = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role } }}>
        <MemoryRouter>
          <ToastProvider>
            <OrderPaymentLines orderId="o1" orderNumber={38} />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Payment rows with Correct / Void (0073)', () => {
  it('draws nothing and reads nothing for sales', () => {
    const d = db([pay()])
    const { container } = mount('sales')
    expect(container.textContent).toBe('')
    expect(d.calls.filter(c => c.target === 'payments_in')).toHaveLength(0)
  })

  it('Void needs a reason; a quick pick fills it and the RPC gets it, then an Undo toast', async () => {
    const user = userEvent.setup()
    const d = db([pay()], c => (c.target === 'rpc:void_payment' ? { data: null } : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: /Change payment of PKR 5,900/ }))
    await user.click(screen.getByRole('menuitem', { name: /Void/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Void payment' }))
    expect(within(dialog).getByText('Say why it is voided')).toBeInTheDocument()
    expect(d.calls.filter(c => c.target === 'rpc:void_payment')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Typed twice' }))
    await user.click(within(dialog).getByRole('button', { name: 'Void payment' }))
    expect(await screen.findByText('Voided payment')).toBeInTheDocument()
    const call = d.calls.find(c => c.target === 'rpc:void_payment')!
    expect(opArgs(call, 'args')?.[0]).toEqual({ p_payment_id: 'p1', p_reason: 'Typed twice' })
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
  })

  it('a closed month is said with an "Open Month-end" link', async () => {
    const user = userEvent.setup()
    db([pay()], c =>
      c.target === 'rpc:void_payment' ? { error: { code: 'P0001', message: 'October 2026 is closed. Reopen it first (Money, Month-end), then change this payment.', hint: 'month_closed' } } : undefined,
    )
    mount()
    await user.click(await screen.findByRole('button', { name: /Change payment/ }))
    await user.click(screen.getByRole('menuitem', { name: /Void/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Wrong order' }))
    await user.click(within(dialog).getByRole('button', { name: 'Void payment' }))
    const err = await within(dialog).findByTestId('correction-error')
    expect(err.textContent).toContain('October 2026 is closed')
    expect(within(err).getByRole('link', { name: 'Open Month-end' })).toHaveAttribute('href', '/money/month-end')
  })

  it('Correct: prefilled, Save off until something changes, then the Changes line and one id kept for retries', async () => {
    const user = userEvent.setup()
    let n = 0
    const d = db([pay()], c => (c.target === 'rpc:correct_payment' ? (++n === 1 ? { error: { code: '', message: 'TypeError: Failed to fetch' } } : { data: 'new' }) : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: /Change payment/ }))
    await user.click(screen.getByRole('menuitem', { name: /Correct/ }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save correction' })
    expect(save).toBeDisabled()
    const amount = within(dialog).getByLabelText(/Amount received/)
    await user.clear(amount)
    await user.type(amount, '5000')
    expect(within(dialog).getByTestId('correction-changes').textContent).toContain('PKR 5,900 → 5,000')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Bank charges')
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Corrected payment')).toBeInTheDocument()
    const ids = d.calls.filter(c => c.target === 'rpc:correct_payment').map(c => (opArgs(c, 'args')?.[0] as { p_new_id: string }).p_new_id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
  })

  it('a bank-ticked payment has its menu off; a correction is tagged; voided ones fold under "Voided (n)" with Undo', async () => {
    const user = userEvent.setup()
    const recent = new Date(Date.now() - 60_000).toISOString()
    db([
      pay({ id: 'a', bank_month: '2026-10-01' }),
      pay({ id: 'b', voided_at: recent, voided_by: 'u', void_reason: 'Wrong amount', amount: 100 }),
      pay({ id: 'c', corrects_payment_id: 'b', created_at: recent, amount: 90 }),
    ])
    mount()
    const lines = await screen.findAllByTestId('payment-line')
    expect(lines).toHaveLength(2)
    expect(within(lines[0]).getByRole('button', { name: /Change payment/ })).toBeDisabled()
    expect(within(lines[1]).getByText('Corrected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Voided (1)' }))
    const voided = screen.getByTestId('voided-line')
    expect(voided.textContent).toContain('Wrong amount')
    expect(within(voided).getByRole('button', { name: /Undo/ })).toBeInTheDocument()
  })
})
