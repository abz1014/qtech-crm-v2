import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('page shell navigation, per role (Forest lanes: the rail, then the phone bar)', () => {
  it('admin: the rail is Home, Sell, Deliver, Money, Companies; the phone bar Home, Sell, Deliver, Money with the + between', () => {
    render(signedIn('admin'), '/todo')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Home -> /todo",
        "Sell -> /jobs?lane=sell",
        "Deliver -> /jobs?lane=deliver",
        "Money -> /money",
        "Companies -> /companies",
      ]
    `)
    expect(navs()[1]).toEqual(navs()[0].slice(0, 4))
    const bar = el.querySelectorAll('nav[aria-label="Main"]')[1]
    expect([...bar.children].map(c => c.getAttribute('aria-label') ?? c.textContent?.trim())).toEqual(['Home', 'Sell', 'Create', 'Deliver', 'Money'])
  })

  it('sales: the same lanes as admin', () => {
    render(signedIn('sales'), '/todo')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Home -> /todo",
        "Sell -> /jobs?lane=sell",
        "Deliver -> /jobs?lane=deliver",
        "Money -> /money",
        "Companies -> /companies",
      ]
    `)
    expect(navs()[1]).toEqual(navs()[0].slice(0, 4))
  })

  it('engineer: their own lists, Home, I paid and Jobs on the rail, Home, Camera, I paid and Jobs on the bar; never Money, Sell or Create', () => {
    render(signedIn('engineer'), '/todo')
    expect(navs()[0]).toMatchInlineSnapshot(`
      [
        "Home -> /todo",
        "I paid -> /my-expenses",
        "Jobs -> /jobs",
      ]
    `)
    expect(navs()[1]).toMatchInlineSnapshot(`
      [
        "Home -> /todo",
        "Camera -> /capture",
        "I paid -> /my-expenses",
        "Jobs -> /jobs",
      ]
    `)
    expect(el.querySelector('a[href="/money"]')).toBeNull()
    expect(el.textContent).not.toContain('Money')
    expect(el.textContent).not.toContain('Sell')
    expect(el.querySelector('[data-create-tab]')).toBeNull()
    expect([...el.querySelectorAll('button')].some(b => b.textContent?.includes('Create'))).toBe(false)
    // the lime button on an engineer's rail is Take photo, to Capture
    expect(el.querySelector('[data-rail] a[href="/capture"]')?.textContent).toContain('Take photo')
  })

  it('unknown role: no destinations', () => {
    render(signedIn('guest'), '/todo')
    expect(navs()).toEqual([[]])
  })
})

describe('routing and role landing', () => {
  it.each(['admin', 'sales', 'engineer'])('%s lands on Home (/todo) from /', role => {
    render(signedIn(role), '/')
    // Today is a lazy screen now (R11): the shell lands on its route; the screen itself is covered in features/today.
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/todo')
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

  it('signed out goes to sign-in and shows no navigation', async () => {
    render({ status: 'signed-out' }, '/rfqs')
    // the sign-in page is a lazy chunk (round 2): wait for it
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('Sign in'), { timeout: 5000 })
    expect(el.querySelector('nav')).toBeNull()
  })

  it('a signed-in person who opens /login is sent to their landing page', () => {
    render(signedIn('sales'), '/login')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/todo')
  })

  it('an unknown address shows page not found inside the shell', () => {
    render(signedIn('admin'), '/nope')
    expect(el.querySelector('main h1')?.textContent).toBe('Page not found')
  })

  it('a lane lights from its ?lane=, and a sub-route keeps its section active', () => {
    render(signedIn('admin'), '/jobs?lane=deliver')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/jobs?lane=deliver')
    act(() => root?.unmount())
    el.remove()
    render(signedIn('admin'), '/money/gst-register')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/money')
  })

  it('an engineer\'s Jobs stays lit on a job page', () => {
    render(signedIn('engineer'), '/jobs/177')
    expect(el.querySelector('nav[aria-label="Main"] a[aria-current="page"]')?.getAttribute('href')).toBe('/jobs')
  })
})

describe('the engineer\'s phone bar (gate 2, question 3)', () => {
  it('is a bar of four that does not float over the page: no pill, and <main> needs no extra room', () => {
    render(signedIn('engineer'), '/my-expenses')
    expect(el.querySelector('[data-engineer-fab]')).toBeNull()
    expect(el.querySelector('nav[data-tabbar="engineer"] a[aria-current="page"]')?.getAttribute('href')).toBe('/my-expenses')
    expect(el.querySelector('main')?.className).not.toContain('pb-3')
  })
})
