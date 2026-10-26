import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { AppShell } from '@/app/shell/AppShell'
import { addDays } from '@/features/rfqs/lib/dateText'
import { businessToday } from '@/lib/dates'
import { installFakeDb } from '@/test/fakeSupabase'

/*
 * E-SH-01, revised by the owner's redesign approval of 2026-10-22 (phase 0, "stop the noise"): ONE number in the top bar, on
 * Today, and it means "needs you" by the one definition (features/today/needsYou.ts): due today or late, not Waiting, not older
 * than 30 days. RFQs, Orders and Money carry no number any more. Every number still comes from the person's own Today list.
 */
const twoDaysAgo = addDays(businessToday(), -2) as string
const open = (n: number, receivedOn = twoDaysAgo) => ({ rfq_id: `r${n}`, number: n, company_id: 'c', owner_id: null as string | null, received_on: receivedOn, due_on: null, outcome: 'open', sourcing_state: 'not_floated', clarification_state: 'none', bid_state: 'to_bid', companies: { name: 'Acme' }, users: null })
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

describe('the top bar has one number: Today\'s "needs you"', () => {
  it('makes no head request for active orders: every number comes from the Today list', async () => {
    const { fake, bar } = mount('admin')
    await within(bar).findByRole('link', { name: /^To do\s?, 1 need you$/ })
    expect(fake.calls.some(c => c.target === 'v_order_state' && /head|count/.test(JSON.stringify(c)))).toBe(false)
  })

  it('Today counts the items due today or late (three RFQs nobody asked suppliers about); RFQs, Orders and Money carry no number', async () => {
    const { bar } = mount('admin', [open(1), open(2), open(3)])
    expect(await within(bar).findByRole('link', { name: /^To do\s?, 3 need you$/ })).toBeInTheDocument()
    // "Plan commissioning" and the FBR roll-up are ready-to-move chores: listed on Today, never counted
    expect(within(bar).getByRole('link', { name: 'RFQs' })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: 'Orders' })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: 'Money' })).toBeInTheDocument()
    expect(bar.querySelectorAll('[data-needs-count]')).toHaveLength(1)
  })

  it('an item older than 30 days is not counted (it waits in Today\'s grey fold)', async () => {
    const { fake, bar } = mount('admin', [open(1, '2025-01-27'), open(2)])
    // the fresh one is counted, the one from January 2025 is not
    expect(await within(bar).findByRole('link', { name: /^To do\s?, 1 need you$/ })).toBeInTheDocument()
    expect(fake.calls.some(c => c.target === 'v_rfq_state')).toBe(true)
    expect(bar.querySelectorAll('[data-needs-count]')).toHaveLength(1)
  })

  it('an engineer: no Money entry, no money request, and no number for a chore that is not due (plan commissioning)', async () => {
    const { fake, bar } = mount('engineer')
    await waitFor(() => expect(fake.calls.some(c => c.target === 'v_order_state')).toBe(true))
    expect(bar.querySelectorAll('[data-needs-count]')).toHaveLength(0)
    expect(within(bar).queryByRole('link', { name: /Money/ })).not.toBeInTheDocument()
    const money = /^(v_invoice_state|v_order_money|payments_in|invoices|expenses|recurring_expenses|rpc:order_receivables|rpc:month_end_status)$/
    expect(fake.calls.filter(c => money.test(c.target))).toEqual([])
  })
})
