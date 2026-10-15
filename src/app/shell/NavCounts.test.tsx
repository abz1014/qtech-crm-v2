import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { AppShell } from '@/app/shell/AppShell'
import { installFakeDb } from '@/test/fakeSupabase'

/* B-11 / B-164: the top bar shows "RFQs 14" from the open-RFQ count; Orders and Money stay bare (not built yet). */
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
