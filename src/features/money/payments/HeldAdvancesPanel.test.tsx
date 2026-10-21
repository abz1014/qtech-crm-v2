import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HeldAdvancesPanel } from '@/features/money/payments/HeldAdvancesPanel'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'

/* Owner decision 2026-10-22: an advance on a cancelled, never-invoiced order is listed apart for the admin, never as owed. */

const HELD = [
  { order_id: 'o9', order_number: 9, company_id: 'c1', company_name: 'Indus Textile Mills', cancelled_on: '2026-10-05', held: 250000 },
  { order_id: 'o4', order_number: 4, company_id: 'c2', company_name: 'Sargodha Fertilizer Co.', cancelled_on: '2026-09-12', held: 700 },
]

function mount(isAdmin: boolean) {
  const calls: string[] = []
  installFakeDb((c: FakeCall) => {
    calls.push(c.target)
    return c.target === 'rpc:held_advances' ? { data: HELD } : { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HeldAdvancesPanel isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return calls
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Advance held — refund or keep', () => {
  it('lists each cancelled order with the amount held and the total, for the admin', async () => {
    mount(true)
    const panel = await screen.findByRole('region', { name: 'Advance held — refund or keep' })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Indus Textile Mills')
    expect(items[0]).toHaveTextContent('ORD-0009')
    expect(items[0]).toHaveTextContent(/cancelled/)
    expect(items[0]).toHaveTextContent(/250,000/)
    expect(within(panel).getByRole('link', { name: 'ORD-0004' })).toHaveAttribute('href', '/orders/o4')
    expect(panel).toHaveTextContent(/250,700/)
  })

  it('is not asked for and not shown for anyone but the admin', async () => {
    const calls = mount(false)
    await new Promise(r => setTimeout(r, 20))
    expect(calls).not.toContain('rpc:held_advances')
    expect(screen.queryByRole('region', { name: 'Advance held — refund or keep' })).toBeNull()
  })
})
