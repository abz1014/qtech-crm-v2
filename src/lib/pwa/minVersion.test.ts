import { MutationObserver } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapPgError } from '@/lib/pgErrors'
import { APP_VERSION, UPDATE_NEEDED_MESSAGE, checkMinVersion, isUpdateNeeded, needsUpdate, resetMinVersionForTests } from '@/lib/pwa/minVersion'
import { queryClient } from '@/lib/queryClient'

/* Owner decision 2026-10-22: the server can declare a minimum client version; an older app keeps reading but cannot save. */

afterEach(() => resetMinVersionForTests(false))

const json = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)

describe('minimum app version', () => {
  it('this build knows its own version, from app-version.json', () => {
    const file = JSON.parse(readFileSync(path.resolve(__dirname, '../../../app-version.json'), 'utf8')) as { version: number; minSupported: number }
    expect(APP_VERSION).toBe(file.version)
    expect(file.minSupported).toBeLessThanOrEqual(file.version)
  })

  it('needs an update only when the published minimum is above the running version', () => {
    expect(needsUpdate({ version: 4, minSupported: 3 }, 3)).toBe(false)
    expect(needsUpdate({ version: 4, minSupported: 4 }, 3)).toBe(true)
    expect(needsUpdate({ minSupported: '9' }, 3)).toBe(false)
    expect(needsUpdate(null, 3)).toBe(false)
    expect(needsUpdate('oops', 3)).toBe(false)
  })

  it('reads /version.json without the cache; a failed or malformed answer changes nothing', async () => {
    const ok = json({ version: APP_VERSION, minSupported: APP_VERSION })
    expect(await checkMinVersion(ok)).toBe(false)
    expect(ok).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }))
    expect(await checkMinVersion(vi.fn(async () => { throw new TypeError('offline') }))).toBe(false)
    expect(await checkMinVersion(json({}, false))).toBe(false)
    expect(isUpdateNeeded()).toBe(false)
    expect(await checkMinVersion(json({ version: APP_VERSION + 1, minSupported: APP_VERSION + 1 }))).toBe(true)
    // once needed, a later answer does not take it back before a reload
    expect(await checkMinVersion(json({ minSupported: 0 }))).toBe(true)
  })

  it('an out-of-date app refuses every save before it is sent, with the plain sentence; reading is untouched', async () => {
    resetMinVersionForTests(true)
    const send = vi.fn(async () => 'saved')
    const save = new MutationObserver(queryClient, { mutationFn: send })
    const err = await save.mutate().catch((e: unknown) => e)
    expect(send).not.toHaveBeenCalled()
    expect(mapPgError(err).message).toBe(UPDATE_NEEDED_MESSAGE)
    expect(UPDATE_NEEDED_MESSAGE).toMatch(/^Update needed/)
    expect(await queryClient.fetchQuery({ queryKey: ['min-version-read'], queryFn: async () => 'read' })).toBe('read')
  })

  it('an up-to-date app saves as before', async () => {
    const send = vi.fn(async () => 'saved')
    expect(await new MutationObserver(queryClient, { mutationFn: send }).mutate()).toBe('saved')
  })
})
