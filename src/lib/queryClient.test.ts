import { MutationObserver, onlineManager, type Query } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qk } from '@/features/queryKeys'
import { holdNetwork } from '@/lib/connection'
import { mapPgError } from '@/lib/pgErrors'
import { FOCUS_REFETCH_MIN_AGE_MS, OfflineSaveError, queryClient, REFERENCE_STALE_MS, refetchOnReturn } from '@/lib/queryClient'

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

describe('a save never pauses silently offline (BUG-RES-1, U07)', () => {
  const save = (fn: () => Promise<unknown>) => new MutationObserver(queryClient, { mutationFn: fn }).mutate()

  it('offline: fails at once with the plain sentence, and the request is never sent', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    const sent = vi.fn(async () => 'saved')
    const err = await save(sent).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OfflineSaveError)
    expect(sent).not.toHaveBeenCalled()
    expect(mapPgError(err).message).toBe('Check your connection and try again. Trying again will not create a duplicate.')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
  })

  it('no live session yet (network held): fails the same way instead of waiting', async () => {
    holdNetwork(true)
    const sent = vi.fn(async () => 'saved')
    await expect(save(sent)).rejects.toBeInstanceOf(OfflineSaveError)
    expect(sent).not.toHaveBeenCalled()
  })

  it('online: the save runs, and never pauses (networkMode always)', async () => {
    expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe('always')
    await expect(save(async () => 'saved')).resolves.toBe('saved')
  })
})
