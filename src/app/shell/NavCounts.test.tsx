import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { AppShell } from '@/app/shell/AppShell'
import { installFakeDb } from '@/test/fakeSupabase'

/* B-11 / B-164, E-SH-01: the top bar shows "RFQs 14" and "Orders 7", and "Money 3" (admin and sales only). */
const open = (n: number) => ({ rfq_id: `r${n}`, number: n, company_id: 'c', owner_id: null, received_on: '2026-11-01', due_on: '2026-12-01', outcome: 'open', sourcing_state: 'not_floated', clarification_state: 'none', bid_state: 'to_bid', companies: { name: 'Acme' }, users: null })

describe('top-bar counts', () => {
  it('shows the open RFQ count beside RFQs and nothing beside Orders or Money', async () => {
    installFakeDb(c => (c.target === 'v_rfq_state' ? { data: [open(1), open(2), open(3)] } : { data: [] }))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Test Person', role: 'admin' } }}>
          <MemoryRouter initialEntries={['/orders']}>
            <AppShell />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    const bar = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(await within(bar).findByRole('link', { name: /^RFQs\s*3$/ })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: /^Orders$/ })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: /^Money$/ })).toBeInTheDocument()
    expect(within(bar).getByRole('link', { name: /^Today\s*\d+$/ })).toBeInTheDocument()
  })
})

describe('top-bar counts: Orders and Money (E-SH-01)', () => {
  const mount = (role: 'admin' | 'engineer') => {
    const fake = installFakeDb(c => {
      if (c.target === 'v_order_state') return { data: null, count: 7 }
      if (c.target === 'v_rfq_state') return { data: [open(1)] }
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

  it('admin sees Orders from the active-order count and Money from the Money items on Today', async () => {
    const { bar } = mount('admin')
    expect(await within(bar).findByRole('link', { name: /^Orders\s*7$/ })).toBeInTheDocument()
    expect(await within(bar).findByRole('link', { name: /^Money\s*1$/ })).toBeInTheDocument() // the one FBR item
  })

  it('an engineer gets an Orders count, no Money entry, and makes no money request', async () => {
    const { fake, bar } = mount('engineer')
    expect(await within(bar).findByRole('link', { name: /^Orders\s*7$/ })).toBeInTheDocument()
    expect(within(bar).queryByRole('link', { name: /Money/ })).not.toBeInTheDocument()
    const money = /^(v_invoice_state|v_order_money|payments_in|invoices|expenses|recurring_expenses|rpc:order_receivables|rpc:month_end_status)$/
    expect(fake.calls.filter(c => money.test(c.target))).toEqual([])
  })
})
