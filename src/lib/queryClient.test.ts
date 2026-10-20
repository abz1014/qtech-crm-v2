import { onlineManager, type Query } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qk } from '@/features/queryKeys'
import { holdNetwork } from '@/lib/connection'
import { FOCUS_REFETCH_MIN_AGE_MS, queryClient, REFERENCE_STALE_MS, refetchOnReturn } from '@/lib/queryClient'

const aged = (ms: number) => ({ state: { dataUpdatedAt: Date.now() - ms } }) as unknown as Query

afterEach(() => {
  holdNetwork(false)
  vi.restoreAllMocks()
})

describe('freshness on return to the app (phone audit 3)', () => {
  it('refetches on return and on reconnect, with the 30 s floor that stops a storm of staleTime-0 reads', () => {
    const q = queryClient.getDefaultOptions().queries
    expect(q?.refetchOnWindowFocus).toBe(refetchOnReturn)
    expect(q?.refetchOnReconnect).toBe(true)
    expect(q?.staleTime).toBe(30_000)
    expect(refetchOnReturn(aged(5_000))).toBe(false)
    expect(refetchOnReturn(aged(FOCUS_REFETCH_MIN_AGE_MS + 1))).toBe(true)
  })

  it('reference data keeps 5 minutes; lists keep the default', () => {
    for (const key of [qk.settings.profile(), qk.settings.activeCategories(), qk.money.categories(), qk.fx.latest()]) {
      expect(queryClient.getQueryDefaults(key).staleTime, JSON.stringify(key)).toBe(REFERENCE_STALE_MS)
    }
    expect(queryClient.getQueryDefaults(qk.rfqs.board()).staleTime).toBeUndefined()
    expect(queryClient.getQueryDefaults(qk.today.board()).staleTime).toBeUndefined()
  })
})

describe('TanStack online state (connection.ts)', () => {
  it('follows the browser, and is held offline while there is no live token', () => {
    expect(onlineManager.isOnline()).toBe(true)
    holdNetwork(true)
    expect(onlineManager.isOnline()).toBe(false)
    holdNetwork(false)
    expect(onlineManager.isOnline()).toBe(true)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    expect(onlineManager.isOnline()).toBe(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(onlineManager.isOnline()).toBe(true)
  })
})
