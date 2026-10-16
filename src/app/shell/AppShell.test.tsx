import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/routes'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installFakeDb } from '@/test/fakeSupabase'

/* The shell reads the Today and RFQ counts for the top bar: an empty database, and a fresh cache per render. */
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
installFakeDb(() => ({ data: [] }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const signedIn = (role: string): SessionState => ({ status: 'signed-in', user: { id: 'u1', name: 'Test Person', role } })

let root: ReturnType<typeof createRoot> | undefined
let el: HTMLElement

function render(session: SessionState, path: string) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() =>
    root!.render(
      <QueryClientProvider client={qc()}>
        <SessionProvider value={session}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
      </QueryClientProvider>,
    ),
  )
}

afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
  root = undefined
})

/** Link labels and hrefs of every "Main" navigation in the page (desktop bar and phone tab bar). */
function navs() {
  return [...el.querySelectorAll('nav[aria-label="Main"]')].map(nav =>
    [...nav.querySelectorAll('a')].map(a => `${a.textContent?.trim()} -> ${a.getAttribute('href')}`),
  )
}

describe('page shell navigation, per role', () => {
  it('admin: all six, in order, on both bars', () => {
    render(signedIn('admin'), '/today')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Today -> /today",
        "RFQs -> /rfqs",
        "Orders -> /orders",
        "Companies -> /companies",
        "Money -> /money",
        "Reports -> /reports",
      ]
    `)
    expect(navs()[1]).toEqual(navs()[0])
  })

  it('sales: all six, in order, on both bars', () => {
    render(signedIn('sales'), '/today')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Today -> /today",
        "RFQs -> /rfqs",
        "Orders -> /orders",
        "Companies -> /companies",
        "Money -> /money",
        "Reports -> /reports",
      ]
    `)
    expect(navs()[1]).toEqual(navs()[0])
  })

  it('engineer: four, never Money (top bar or tab bar)', () => {
    render(signedIn('engineer'), '/today')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Today -> /today",
        "RFQs -> /rfqs",
        "Orders -> /orders",
        "Companies -> /companies",
      ]
    `)
    expect(navs()[1]).toEqual(navs()[0])
    expect(el.querySelector('a[href="/money"]')).toBeNull()
    expect(el.textContent).not.toContain('Money')
  })

  it('unknown role: no destinations', () => {
    render(signedIn('guest'), '/today')
    expect(navs()).toEqual([[], []])
  })
})

describe('routing and role landing', () => {
  it.each(['admin', 'sales', 'engineer'])('%s lands on Today from /', role => {
    render(signedIn(role), '/')
    // Today is a lazy screen now (R11): the shell lands on its route; the screen itself is covered in features/today.
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/today')
  })

  it('an engineer who opens /money sees no-access inside the shell, not Money', () => {
    render(signedIn('engineer'), '/money')
    expect(el.querySelector('main h1')?.textContent).toBe('Money is for admins and sales')
    expect(el.querySelector('nav[aria-label="Main"]')).not.toBeNull()
  })

  it('an engineer who opens a Money sub-route is also blocked', () => {
    render(signedIn('engineer'), '/money/gst-register')
    expect(el.querySelector('main h1')?.textContent).toContain('is for admins and sales')
  })

  it('an unknown role lands on /no-access', () => {
    render(signedIn('guest'), '/')
    expect(el.querySelector('main h1')?.textContent).toBe('This account has no access yet')
  })

  it('signed out goes to sign-in and shows no navigation', () => {
    render({ status: 'signed-out' }, '/rfqs')
    expect(el.querySelector('h1')?.textContent).toBe('Sign in')
    expect(el.querySelector('nav')).toBeNull()
  })

  it('a signed-in person who opens /login is sent to their landing page', () => {
    render(signedIn('sales'), '/login')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/today')
  })

  it('an unknown address shows page not found inside the shell', () => {
    render(signedIn('admin'), '/nope')
    expect(el.querySelector('main h1')?.textContent).toBe('Page not found')
  })

  it('a sub-route keeps its section active', () => {
    render(signedIn('admin'), '/rfqs/177')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/rfqs')
  })
})
