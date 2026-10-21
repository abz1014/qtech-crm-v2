import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ apply: vi.fn(() => 'none' as 'none' | 'applying' | 'blocked'), dirty: vi.fn(() => false) }))
vi.mock('@/lib/pwa/updates', () => ({ applyUpdate: h.apply }))
vi.mock('@/lib/pwa/dirtyForms', () => ({ hasDirtyForms: h.dirty }))

import { importWithReload, isChunkLoadError, pageReload, RELOAD_MARK, StaleAppError } from '@/lib/importWithReload'
import { mapPgError } from '@/lib/pgErrors'

// What Chrome, Firefox and Safari throw when /assets/old-chunk.js comes back as the app's HTML after a deploy.
const stale = () => new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/termLines-OLD.js')

let reload: ReturnType<typeof vi.fn>
beforeEach(() => {
  window.sessionStorage.clear()
  h.apply.mockReset().mockReturnValue('none')
  h.dirty.mockReset().mockReturnValue(false)
  reload = vi.fn()
  pageReload.run = reload as unknown as () => void
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('isChunkLoadError', () => {
  it('knows the browsers’ chunk-load messages and nothing else', () => {
    expect(isChunkLoadError(stale())).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: /assets/x.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('importWithReload', () => {
  it('returns the module when the import works, and clears a spent reload mark', async () => {
    window.sessionStorage.setItem(RELOAD_MARK, '1')
    await expect(importWithReload(() => Promise.resolve({ ok: 1 }))).resolves.toEqual({ ok: 1 })
    expect(window.sessionStorage.getItem(RELOAD_MARK)).toBeNull()
  })

  it('reload: false (an idle-time preload) never reloads or applies an update: it throws the plain sentence', async () => {
    h.apply.mockReturnValue('applying')
    const load = vi.fn().mockRejectedValue(stale())
    const err = await importWithReload(load, { reload: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaleAppError)
    expect((err as StaleAppError).message).toMatch(/could not be downloaded/)
    expect(reload).not.toHaveBeenCalled()
    expect(h.apply).not.toHaveBeenCalled()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(importWithReload(load, { reload: false })).rejects.toThrow(/You are offline/)
  })

  it('retries a failed import once (a dropped connection) without reloading', async () => {
    const load = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValueOnce({ ok: 2 })
    await expect(importWithReload(load)).resolves.toEqual({ ok: 2 })
    expect(load).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('rethrows an error that is not about loading the chunk', async () => {
    const boom = new Error('module threw while evaluating')
    await expect(importWithReload(() => Promise.reject(boom))).rejects.toBe(boom)
    expect(reload).not.toHaveBeenCalled()
  })

  it('a chunk missing after a deploy reloads the page once, marked in sessionStorage', async () => {
    importWithReload(() => Promise.reject(stale())).catch(() => {})
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(window.sessionStorage.getItem(RELOAD_MARK)).not.toBeNull()
  })

  it('does not reload a second time: the mark stops a loop and the person is told what to do', async () => {
    window.sessionStorage.setItem(RELOAD_MARK, '1')
    const err = await importWithReload(() => Promise.reject(stale())).catch(e => e)
    expect(err).toBeInstanceOf(StaleAppError)
    expect(reload).not.toHaveBeenCalled()
    expect(mapPgError(err).message).toMatch(/Close the app .* open it again/)
  })

  it('prefers a waiting service worker: it takes over (updates.ts reloads) instead of a plain reload', async () => {
    h.apply.mockReturnValue('applying')
    importWithReload(() => Promise.reject(stale())).catch(() => {})
    await vi.waitFor(() => expect(h.apply).toHaveBeenCalledTimes(1))
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads over unsaved typing (the update toast’s rule)', async () => {
    h.dirty.mockReturnValue(true)
    const err = await importWithReload(() => Promise.reject(stale())).catch(e => e)
    expect(err).toBeInstanceOf(StaleAppError)
    expect(mapPgError(err).message).toMatch(/Save what you are typing/)
    expect(reload).not.toHaveBeenCalled()
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('never reloads offline: a reload could fetch nothing new', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const err = await importWithReload(() => Promise.reject(stale())).catch(e => e)
    expect(err).toBeInstanceOf(StaleAppError)
    expect((err as StaleAppError).code).toBe('offline')
    expect(reload).not.toHaveBeenCalled()
  })
})
