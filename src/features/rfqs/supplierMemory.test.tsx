import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { getItemSupplierMemory, MEMORY_IN_FLIGHT, type MemoryQuery } from '@/features/rfqs/api'
import { useSupplierMemory } from '@/features/rfqs/hooks'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import { installFakeDb } from '@/test/fakeSupabase'

/*
 * Owner, 19 Nov 2026: setting the brand on 20 items of a 31-item RFQ, each save took 30 to 60 seconds. Every edit re-read the
 * supplier memory of all 31 items at once (twice: a new key, and item.edit marking the old one stale), and the save queued behind
 * them. Now one read per item, at most MEMORY_IN_FLIGHT at a time, and an edit re-reads only the item it changed.
 */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const items: MemoryQuery[] = Array.from({ length: 6 }, (_, n) => ({ key: `i${n}`, description: `Item ${n}`, brandId: null, familyId: null }))

function setup() {
  const fake = installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Me', role: 'admin' } }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionContext.Provider>
  )
  const reads = () => fake.calls.filter(c => c.target === 'rpc:supplier_item_memory').length
  return { client, wrapper, reads }
}

describe('supplier memory on the RFQ page', () => {
  it('editing one item re-reads that item only', async () => {
    const { wrapper, reads } = setup()
    const { result, rerender } = renderHook(({ list }) => useSupplierMemory(list, ['s1'], true, 'r1'), { wrapper, initialProps: { list: items } })
    await waitFor(() => expect(Object.keys(result.current.data ?? {})).toHaveLength(6))
    expect(reads()).toBe(6)
    rerender({ list: items.map((it, n) => (n === 2 ? { ...it, brandId: 'b-abb' } : it)) })
    await waitFor(() => expect(reads()).toBe(7))
    // While the edited item is read again, the other five keep their memory.
    await waitFor(() => expect(Object.keys(result.current.data ?? {})).toHaveLength(6))
  })

  it('keeps the same record between renders until a read lands', async () => {
    const { wrapper } = setup()
    const { result, rerender } = renderHook(({ list }) => useSupplierMemory(list, ['s1'], true, 'r1'), { wrapper, initialProps: { list: items } })
    await waitFor(() => expect(Object.keys(result.current.data ?? {})).toHaveLength(6))
    const first = result.current.data
    rerender({ list: [...items] })
    expect(result.current.data).toBe(first)
  })

  it('an item edit does not mark the memory stale', async () => {
    const { client } = setup()
    client.setQueryData(qk.memory.rfq('r1', 'x'), [])
    await invalidateAfter(client, 'item.edit', { rfqId: 'r1' })
    expect(client.getQueryState(qk.memory.rfq('r1', 'x'))?.isInvalidated).toBe(false)
  })
})

describe('getItemSupplierMemory', () => {
  it(`runs at most ${MEMORY_IN_FLIGHT} reads at a time`, async () => {
    let running = 0
    let most = 0
    const db = {
      rpc: async () => {
        running++
        most = Math.max(most, running)
        await new Promise(r => setTimeout(r, 5))
        running--
        return { data: [], error: null }
      },
    } as unknown as Parameters<typeof getItemSupplierMemory>[3]
    await Promise.all(Array.from({ length: 12 }, (_, n) => getItemSupplierMemory({ description: `x${n}`, brandId: null, familyId: null }, ['s1'], 'r1', db)))
    expect(most).toBe(MEMORY_IN_FLIGHT)
  })
})
