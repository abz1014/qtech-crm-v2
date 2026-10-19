import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrderItemRow } from '@/features/orders/api'
import { useOrderLegs } from '@/features/orders/hooks'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

function setup(respond: (c: FakeCall) => FakeResult) {
  const db = installFakeDb(respond)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, client, wrapper }
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const item = (o: Partial<OrderItemRow>): OrderItemRow => ({
  id: 'i',
  number: 1,
  description: 'x',
  brandName: null,
  qty: 1,
  unit: null,
  isService: false,
  legId: null,
  rfqItemId: null,
  unitPriceNet: null,
  gstRate: null,
  supplierUnitPrice: null,
  ...o,
})

describe('useOrderLegs', () => {
  it('orders the legs and picks their lead times from the items as they are now, not as they were when the legs were fetched', async () => {
    // A split (or any line move) refreshes items and legs at the same moment: the legs request starts while the old items are still on
    // screen. The leg letters and lead times must follow the new items once they arrive.
    const { db, wrapper } = setup(c => {
      if (c.target === 'supplier_orders')
        return {
          data: [
            { id: 'legA', supplier_id: 's1', inquiry_id: 'q1', currency: 'PKR', created_at: '2026-10-01T00:00:00Z' },
            { id: 'legB', supplier_id: 's2', inquiry_id: 'q2', currency: 'USD', created_at: '2026-10-02T00:00:00Z' },
          ],
        }
      if (c.target === 'companies') return { data: [{ id: 's1', name: 'Metro' }, { id: 's2', name: 'Lahore' }] }
      if (c.target === 'supplier_quote_lines') return { data: [{ inquiry_id: 'q2', rfq_item_id: 'r1', lead_time: '4 weeks' }] }
      return { data: [] }
    })
    const before = [item({ id: 'a', number: 1, legId: 'legA', rfqItemId: 'r2' })]
    const after = [item({ id: 'b', number: 1, legId: 'legB', rfqItemId: 'r1' }), item({ id: 'a', number: 2, legId: 'legA', rfqItemId: 'r2' })]
    const { result, rerender } = renderHook(({ items }) => useOrderLegs('o1', items), { wrapper, initialProps: { items: before } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map(l => l.id)).toEqual(['legA', 'legB'])
    expect(result.current.data?.[1].leadTimes).toEqual([])

    rerender({ items: after })
    await waitFor(() => expect(result.current.data?.map(l => l.id)).toEqual(['legB', 'legA']))
    expect(result.current.data?.[0].leadTimes).toEqual(['4 weeks'])
    // no second round trip was needed for it
    expect(db.calls.filter(c => c.target === 'supplier_orders')).toHaveLength(1)
  })
})
