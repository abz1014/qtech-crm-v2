import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { CreditPanel } from '@/features/money/credit/CreditPanel'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* 0126, 0127: the company page's "Credit balance" with Refund and Apply to an order (admin only, short forms). */

const VIEW = { company_id: 'c1', overpaid: 320, refunded: 100, applied: 0, balance: 220 }
const REFUND = { id: 'r1', company_id: 'c1', order_id: null, refunded_on: '2026-10-09', amount: 100, paid_via: 'bank', reference: 'RF-1', reason: 'goodwill', bank_month: null, created_at: '2026-10-09T10:00:00+00:00', created_by: 'u' }
const RECEIVABLES = [
  { order_id: 'o11', order_number: 11, company_id: 'c1', balance: 500 },
  { order_id: 'o13', order_number: 13, company_id: 'c1', balance: 50 },
  { order_id: 'o10', order_number: 10, company_id: 'c1', balance: 0 },
]

function db(extra: (c: FakeCall) => FakeResult | undefined = () => undefined, view: unknown = VIEW) {
  return installFakeDb((c: FakeCall) => {
    const e = extra(c)
    if (e) return e
    if (c.target === 'v_company_credit') return { data: view }
    if (c.target === 'customer_refunds') return { data: [REFUND] }
    if (c.target === 'credit_applications') return { data: [] }
    if (c.target === 'rpc:receivables_list') return { data: RECEIVABLES }
    if (c.target === 'rpc:lookup_labels') return { data: { companies: {}, orders: {}, legs: {} } }
    return { data: null }
  })
}

function mount(isAdmin = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <CreditPanel companyId="c1" companyName="Indus Textile Mills" isAdmin={isAdmin} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Credit balance panel', () => {
  it('shows the balance with Refund and Apply to an order, and the history, for the admin', async () => {
    db()
    mount()
    const panel = await screen.findByRole('region', { name: 'Credit balance' })
    expect(within(panel).getByTestId('credit-balance')).toHaveTextContent(/220/)
    expect(within(panel).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Apply to an order/ })).toBeInTheDocument()
    const items = within(panel).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Refunded')
    expect(items[0]).toHaveTextContent(/RF-1 · goodwill/)
  })

  it('is not asked for and not drawn for anyone but the admin', async () => {
    const d = db()
    mount(false)
    await new Promise(r => setTimeout(r, 20))
    expect(d.calls.filter(c => c.target === 'v_company_credit')).toHaveLength(0)
    expect(screen.queryByRole('region', { name: 'Credit balance' })).toBeNull()
  })

  it('draws nothing for a customer with no credit and no history', async () => {
    installFakeDb(c => ({ data: c.target === 'v_company_credit' ? null : [] }))
    mount()
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('region', { name: 'Credit balance' })).toBeNull()
  })

  it('Refund opens at the whole balance and today; Save sends one record_refund with the form id', async () => {
    const user = userEvent.setup()
    const d = db(c => (c.target === 'rpc:record_refund' ? { data: null } : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: /Amount refunded/ })).toHaveValue('220')
    expect(within(dialog).getByTestId('refund-note')).toHaveTextContent('This refunds all of their credit.')
    await user.click(within(dialog).getByRole('button', { name: 'Save refund' }))
    expect(await screen.findByText('Recorded refund')).toBeInTheDocument()
    const call = d.calls.find(c => c.target === 'rpc:record_refund')!
    const args = opArgs(call, 'args')?.[0] as Record<string, unknown>
    expect(args).toMatchObject({ p_company_id: 'c1', p_amount: 220, p_paid_via: 'bank', p_confirm_duplicate: false })
    expect(typeof args.p_id).toBe('string')
  })

  it('a refund above the balance is flagged in the dialog as it is typed', async () => {
    const user = userEvent.setup()
    db()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('dialog')
    const amount = within(dialog).getByRole('textbox', { name: /Amount refunded/ })
    await user.clear(amount)
    await user.type(amount, '300')
    expect(within(dialog).getByTestId('refund-note')).toHaveAttribute('data-kind', 'over')
  })

  it('"Looks like a refund already recorded" asks Record it anyway, then sends the confirm', async () => {
    const user = userEvent.setup()
    let first = true
    const d = db(c => {
      if (c.target !== 'rpc:record_refund') return undefined
      if (first) {
        first = false
        return { error: { code: 'P0001', message: 'Looks like a refund already recorded on 9 Oct 2026.', hint: 'duplicate_refund' } }
      }
      return { data: null }
    })
    mount()
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save refund' }))
    const warning = await within(dialog).findByTestId('duplicate-refund')
    expect(warning).toHaveTextContent('Looks like a refund already recorded on 9 Oct 2026.')
    await user.click(within(warning).getByRole('checkbox', { name: 'Record it anyway' }))
    await user.click(within(dialog).getByRole('button', { name: /Try again|Save refund/ }))
    expect(await screen.findByText('Recorded refund')).toBeInTheDocument()
    const calls = d.calls.filter(c => c.target === 'rpc:record_refund')
    expect(calls).toHaveLength(2)
    expect((opArgs(calls[1], 'args')?.[0] as Record<string, unknown>).p_confirm_duplicate).toBe(true)
    // the same request id both times: a retry cannot record it twice
    expect((opArgs(calls[0], 'args')?.[0] as Record<string, unknown>).p_id).toBe((opArgs(calls[1], 'args')?.[0] as Record<string, unknown>).p_id)
  })

  it('Apply lists only the orders that owe, starts at the smaller of credit and balance, and sends apply_credit', async () => {
    const user = userEvent.setup()
    const d = db(c => (c.target === 'rpc:apply_credit' ? { data: null } : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: /Apply to an order/ }))
    const dialog = await screen.findByRole('dialog')
    const select = await within(dialog).findByRole('combobox', { name: /Put it against/ })
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['ORD-0011 · owes Rs 500', 'ORD-0013 · owes Rs 50'])
    expect(within(dialog).getByRole('textbox', { name: /Amount to apply/ })).toHaveValue('220')
    await user.selectOptions(select, 'o13')
    expect(within(dialog).getByRole('textbox', { name: /Amount to apply/ })).toHaveValue('50')
    expect(within(dialog).getByTestId('apply-note')).toHaveTextContent('This settles the order. No cash moves.')
    await user.click(within(dialog).getByRole('button', { name: 'Apply credit' }))
    expect(await screen.findByText('Applied credit')).toBeInTheDocument()
    const args = opArgs(d.calls.find(c => c.target === 'rpc:apply_credit')!, 'args')?.[0] as Record<string, unknown>
    expect(args).toMatchObject({ p_to_order_id: 'o13', p_amount: 50 })
  })

  it('Apply says so when no order owes anything', async () => {
    const user = userEvent.setup()
    db(c => (c.target === 'rpc:receivables_list' ? { data: [] } : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: /Apply to an order/ }))
    expect(await screen.findByTestId('no-targets')).toHaveTextContent(/nothing to put the credit against/)
  })

  it('taking a refund back asks first, then deletes it', async () => {
    const user = userEvent.setup()
    const d = db(c => (c.verb === 'delete' ? { data: [{ id: 'r1' }] } : undefined))
    mount()
    await user.click(await screen.findByRole('button', { name: 'Remove this refund' }))
    expect(d.calls.filter(c => c.verb === 'delete')).toHaveLength(0)
    await user.click(within(screen.getByRole('group', { name: 'Remove this refund?' })).getByRole('button', { name: 'Remove' }))
    await screen.findByRole('region', { name: 'Credit balance' })
    expect(d.calls.some(c => c.target === 'customer_refunds' && c.verb === 'delete')).toBe(true)
  })
})
