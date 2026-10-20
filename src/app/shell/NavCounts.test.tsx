import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { AppShell } from '@/app/shell/AppShell'
import { installFakeDb } from '@/test/fakeSupabase'

/*
 * E-SH-01, revised by the owner decision of 2026-10-19: every top-bar number means "needs you", read from the person's own
 * Today list. RFQs is no longer every open RFQ, and Orders is no longer every active order.
 */
const open = (n: number) => ({ rfq_id: `r${n}`, number: n, company_id: 'c', owner_id: null as string | null, received_on: '2026-11-01', due_on: '2026-12-01', outcome: 'open', sourcing_state: 'not_floated', clarification_state: 'none', bid_state: 'to_bid', companies: { name: 'Acme' }, users: null })
const toPlan = { order_id: 'o1', number: 7, company_id: 'c', owner_id: 'u1', lifecycle: 'active', goods_state: 'n_a', commissioning_state: 'to_plan', invoicing_state: null }

function mount(role: 'admin' | 'engineer', rfqs = [open(1)]) {
  const fake = installFakeDb(c => {
    if (c.target === 'v_order_state') return { data: [toPlan] }
    if (c.target === 'v_rfq_state') return { data: rfqs }
    if (c.target === 'v_invoice_state')
      return { data: [{ invoice_id: 'i1', order_id: 'o1', number: 'INV-1', invoice_date: '2026-09-01', courier_state: 'sent', fbr_state: 'pending', fbr_exception: false, needs_fbr_attention: true }] }
    return { data: [] }
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Test Person', role } }}>
        <MemoryRouter initialEntries={['/orders']}>
          <AppShell />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { fake, bar: screen.getAllByRole('navigation', { name: 'Main' })[0] }
}

describe('top-bar counts mean "needs you"', () => {
  it('makes no head request for active orders: every number comes from the Today list', async () => {
    const { fake, bar } = mount('admin')
    await within(bar).findByRole('link', { name: 'Orders, 1 need you' })
    expect(fake.calls.some(c => c.target === 'v_order_state' && /head|count/.test(JSON.stringify(c)))).toBe(false)
  })

  it('RFQs counts the RFQ items on Today (three not sent to suppliers), not every open RFQ', async () => {
    const { bar } = mount('admin', [open(1), open(2), open(3)])
    expect(await within(bar).findByRole('link', { name: 'RFQs, 3 need you' })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: /^Today, \d+ need you$/ })).toBeInTheDocument()
  })

  it('an open RFQ that needs nothing today gets no number', async () => {
    const { bar } = mount('admin', [{ ...open(1), sourcing_state: 'floated_awaiting', owner_id: 'someone-else' }])
    expect(await within(bar).findByRole('link', { name: 'Orders, 1 need you' })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: 'RFQs' })).toBeInTheDocument()
  })

  it('admin: Orders from the order items on Today (plan commissioning), Money from the money items', async () => {
    const { bar } = mount('admin')
    expect(await within(bar).findByRole('link', { name: 'Orders, 1 need you' })).toBeInTheDocument()
    expect(await within(bar).findByRole('link', { name: 'Money, 1 need you' })).toBeInTheDocument() // the one FBR item
  })

  it('an engineer gets an Orders count, no Money entry, and makes no money request', async () => {
    const { fake, bar } = mount('engineer')
    expect(await within(bar).findByRole('link', { name: 'Orders, 1 need you' })).toBeInTheDocument()
    expect(within(bar).queryByRole('link', { name: /Money/ })).not.toBeInTheDocument()
    const money = /^(v_invoice_state|v_order_money|payments_in|invoices|expenses|recurring_expenses|rpc:order_receivables|rpc:month_end_status)$/
    expect(fake.calls.filter(c => money.test(c.target))).toEqual([])
  })
})
