import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R21: the service worker caches the app shell and nothing else. These tests load the real src/sw.ts against
 * stubbed Workbox modules and look at what it registers: no route may match a Supabase request, a fetch
 * call, or any other origin, and the worker must not add a fetch listener of its own.
 */
const SUPABASE = 'https://yafbphagorydbitfgfmg.supabase.co'
const ORIGIN = 'https://qtech-crm-v2.vercel.app'

type Matcher = (ctx: { request: { mode: string; url: string; method?: string }; url: URL }) => boolean
const registerRoute = vi.fn<(m: Matcher, h: unknown, method?: string) => void>()
const precacheAndRoute = vi.fn()
const listeners: string[] = []

vi.mock('workbox-routing', () => ({ registerRoute: (m: Matcher, h: unknown, method?: string) => registerRoute(m, h, method) }))
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: (m: unknown) => precacheAndRoute(m),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: (u: string) => async () => ({ shell: u }),
}))
vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }))

const ctx = (url: string, mode: string) => ({ request: { mode, url, method: 'GET' }, url: new URL(url) })

beforeEach(async () => {
  vi.resetModules()
  registerRoute.mockClear()
  precacheAndRoute.mockClear()
  listeners.length = 0
  const g = globalThis as unknown as Record<string, unknown>
  g.__WB_MANIFEST = [{ url: 'index.html', revision: 'x' }]
  g.addEventListener = (type: string) => listeners.push(type)
  g.skipWaiting = vi.fn()
  Object.defineProperty(globalThis, 'location', { value: new URL(ORIGIN), configurable: true })
  await import('@/sw')
})

describe('service worker: nothing from Supabase is cached', () => {
  it('precaches only the injected shell list', () => {
    expect(precacheAndRoute).toHaveBeenCalledTimes(1)
    expect(precacheAndRoute.mock.calls[0][0]).toEqual([{ url: 'index.html', revision: 'x' }])
  })

  it('registers exactly two routes: the app-shell navigation fallback and the share-target POST (R22)', () => {
    expect(registerRoute).toHaveBeenCalledTimes(2)
    expect(typeof registerRoute.mock.calls[0][1]).toBe('function')
    expect(registerRoute.mock.calls[0][2]).toBeUndefined()
    expect(registerRoute.mock.calls[1][2]).toBe('POST')
  })

  it('neither route ever matches a request to the Supabase origin (REST, auth, storage, functions, any method or mode)', () => {
    for (const [match] of registerRoute.mock.calls) {
      for (const path of ['/rest/v1/rfqs?select=*', '/auth/v1/token?grant_type=password', '/storage/v1/object/sign/quotes/a.pdf', '/functions/v1/admin-users', '/capture']) {
        for (const mode of ['cors', 'same-origin', 'no-cors', 'navigate']) {
          for (const method of ['GET', 'POST']) {
            expect(match({ request: { mode, url: SUPABASE + path, method } as never, url: new URL(SUPABASE + path) })).toBe(false)
          }
        }
      }
    }
  })

  it('the shell route matches only same-origin page navigations without a file extension', () => {
    const match = registerRoute.mock.calls[0][0]
    expect(match(ctx(ORIGIN + '/rfqs/123', 'navigate'))).toBe(true)
    expect(match(ctx(ORIGIN + '/rfqs/123', 'cors'))).toBe(false)
    expect(match(ctx(ORIGIN + '/assets/app.js', 'navigate'))).toBe(false)
    expect(match(ctx('https://example.com/rfqs', 'navigate'))).toBe(false)
  })

  it('a page open asks the network first, revalidated, and takes the cached shell only when the network fails or answers with a non-page', async () => {
    const handler = registerRoute.mock.calls[0][1] as (o: { request: unknown }) => Promise<unknown>
    const page = { ok: true, redirected: false, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) }
    const request = { url: ORIGIN + '/rfqs/1', mode: 'navigate' }
    const fetchSpy = vi.fn(async () => page)
    vi.stubGlobal('fetch', fetchSpy)
    expect(await handler({ request })).toBe(page)
    expect(fetchSpy).toHaveBeenCalledWith(request, expect.objectContaining({ cache: 'no-cache' }))
    fetchSpy.mockRejectedValueOnce(new TypeError('offline'))
    expect(await handler({ request })).toEqual({ shell: '/index.html' })
    fetchSpy.mockResolvedValueOnce({ ok: false, redirected: false, headers: new Headers({ 'content-type': 'text/html' }) } as never)
    expect(await handler({ request })).toEqual({ shell: '/index.html' })
    fetchSpy.mockResolvedValueOnce({ ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/json' }) } as never)
    expect(await handler({ request })).toEqual({ shell: '/index.html' })
    vi.unstubAllGlobals()
  })

  it('the share route matches only a same-origin POST to /capture', () => {
    const match = registerRoute.mock.calls[1][0]
    const req = (url: string, method: string) => ({ request: { mode: 'navigate', url, method } as never, url: new URL(url) })
    expect(match(req(ORIGIN + '/capture', 'POST'))).toBe(true)
    expect(match(req(ORIGIN + '/capture', 'GET'))).toBe(false)
    expect(match(req(ORIGIN + '/rfqs', 'POST'))).toBe(false)
    expect(match(req('https://example.com/capture', 'POST'))).toBe(false)
  })

  it('has no fetch listener of its own (only the precache router, which answers listed files)', () => {
    expect(listeners).not.toContain('fetch')
    expect(listeners).toEqual(['message'])
  })
})
