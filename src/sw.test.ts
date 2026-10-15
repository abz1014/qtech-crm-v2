import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R21: the service worker caches the app shell and nothing else. These tests load the real src/sw.ts against
 * stubbed Workbox modules and look at what it registers: no route may match a Supabase request, a fetch
 * call, or any other origin, and the worker must not add a fetch listener of its own.
 */
const SUPABASE = 'https://yafbphagorydbitfgfmg.supabase.co'
const ORIGIN = 'https://qtechcrm.vercel.app'

type Matcher = (ctx: { request: { mode: string; url: string }; url: URL }) => boolean
const registerRoute = vi.fn<(m: Matcher, h: unknown) => void>()
const precacheAndRoute = vi.fn()
const listeners: string[] = []

vi.mock('workbox-routing', () => ({ registerRoute: (m: Matcher, h: unknown) => registerRoute(m, h) }))
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: (m: unknown) => precacheAndRoute(m),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: (u: string) => ({ shell: u }),
}))
vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }))

const ctx = (url: string, mode: string) => ({ request: { mode, url }, url: new URL(url) })

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

  it('registers exactly one runtime route: the app-shell navigation fallback', () => {
    expect(registerRoute).toHaveBeenCalledTimes(1)
    expect(registerRoute.mock.calls[0][1]).toEqual({ shell: '/index.html' })
  })

  it('that route never matches a request to the Supabase origin (REST, auth, storage, functions, even navigation)', () => {
    const match = registerRoute.mock.calls[0][0]
    for (const path of ['/rest/v1/rfqs?select=*', '/auth/v1/token?grant_type=password', '/storage/v1/object/sign/quotes/a.pdf', '/functions/v1/admin-users']) {
      for (const mode of ['cors', 'same-origin', 'no-cors', 'navigate']) {
        expect(match(ctx(SUPABASE + path, mode))).toBe(false)
      }
    }
  })

  it('matches only same-origin page navigations without a file extension', () => {
    const match = registerRoute.mock.calls[0][0]
    expect(match(ctx(ORIGIN + '/rfqs/123', 'navigate'))).toBe(true)
    expect(match(ctx(ORIGIN + '/rfqs/123', 'cors'))).toBe(false)
    expect(match(ctx(ORIGIN + '/assets/app.js', 'navigate'))).toBe(false)
    expect(match(ctx('https://example.com/rfqs', 'navigate'))).toBe(false)
  })

  it('has no fetch listener of its own (only the precache router, which answers listed files)', () => {
    expect(listeners).not.toContain('fetch')
    expect(listeners).toEqual(['message'])
  })
})
