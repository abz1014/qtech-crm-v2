import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderHit } from '@/features/orders/api'

const searchOrders = vi.fn<(text: string, signal?: AbortSignal) => Promise<OrderHit[]>>()
vi.mock('@/features/orders/api', () => ({ searchOrders: (t: string, s?: AbortSignal) => searchOrders(t, s) }))
vi.mock('@/app/palette/usePalette', () => ({ usePaletteSource: () => undefined }))

import { ordersPaletteSource } from '@/features/orders/paletteSource'

describe('orders palette source (O03)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    searchOrders.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('finds an order by number or customer PO and opens it', async () => {
    searchOrders.mockResolvedValue([
      { id: 'o1', number: 38, customerPo: '253074', companyName: 'Punjab Cement Ltd' },
      { id: 'o2', number: 39, customerPo: null, companyName: 'Faisalabad Textile Mills' },
    ])
    const run = ordersPaletteSource(0).search!('2530', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    expect(await run).toEqual([
      expect.objectContaining({ group: 'Orders', label: 'ORD-0038 Punjab Cement Ltd', meta: 'Customer PO 253074', href: '/orders/o1' }),
      expect.objectContaining({ label: 'ORD-0039 Faisalabad Textile Mills', meta: undefined, href: '/orders/o2' }),
    ])
  })

  it('a burst of keystrokes makes one request, and a replaced request returns nothing', async () => {
    searchOrders.mockResolvedValue([])
    const src = ordersPaletteSource(150)
    const ctls = [0, 1, 2].map(() => new AbortController())
    const runs = ['2', '25', '253'].map((q, i) => src.search!(q, ctls[i].signal))
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(40)
      ctls[i].abort()
    }
    await vi.advanceTimersByTimeAsync(200)
    await Promise.all(runs)
    expect(searchOrders).toHaveBeenCalledTimes(1)
    expect(searchOrders.mock.calls[0][0]).toBe('253')
  })

  it('empty text asks for nothing', async () => {
    expect(await ordersPaletteSource(0).search!('  ', new AbortController().signal)).toEqual([])
    expect(searchOrders).not.toHaveBeenCalled()
  })
})
