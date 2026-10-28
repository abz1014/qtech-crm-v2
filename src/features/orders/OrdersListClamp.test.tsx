import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { OrderListRow } from '@/features/orders/api'
import OrdersListPage from '@/features/orders/OrdersListPage'

const LONG_NAME = 'Sample Industrial Holdings and Allied Manufacturing Company Private Limited'
const LONG_WHAT = 'Sample flow meter model FM-100 DN50 flanged with remote display, Sample pressure transmitter PT-20 0-10 bar, Sample junction box JB-9'
const row: OrderListRow = {
  id: 'o1', number: 12, customerPo: 'PO/SAMPLE/2026/000123456', orderedOn: '2026-10-01', ownerId: 'u', ownerName: 'Sample Owner', companyId: 'c1', companyName: LONG_NAME, siteName: 'Sample Plant Two',
  imported: false, lifecycle: 'active', goods: 'not_ordered', commissioning: 'not_needed', dataTrust: 'ok', invoicing: 'not_invoiced', gross: 1000, payment: 'unpaid', balance: 1000,
  engineerIds: [], plannedOn: null, dueOn: null, costsState: null, what: LONG_WHAT, moreLines: true, itemsText: LONG_WHAT.toLowerCase(), legs: [], poNumbers: [],
}

vi.mock('@/features/orders/hooks', async importOriginal => {
  const real = await importOriginal<typeof import('@/features/orders/hooks')>()
  return { ...real, useOrdersList: () => ({ data: [row], isLoading: false, isError: false, error: null, refetch: () => undefined }) }
})

describe('Orders list: wrapping cells are clamped', () => {
  it('the customer, the items and the PO line show two lines at most, with the whole text in the title', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Sample Owner', role: 'admin' } }}>
          <MemoryRouter initialEntries={['/orders']}>
            <OrdersListPage />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
    const table = container.querySelector('table') as HTMLElement
    const clamped = [...table.querySelectorAll('.line-clamp-2')] as HTMLElement[]
    const titles = clamped.map(e => e.getAttribute('title'))
    expect(titles).toContain(`${LONG_NAME} · Sample Plant Two`)
    expect(titles).toContain(`${LONG_WHAT} + more`)
    expect(titles).toContain('PO PO/SAMPLE/2026/000123456 · Sample Owner')
    expect(screen.getAllByText(/Sample Industrial Holdings/).length).toBeGreaterThan(0)
  })
})
