import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/*
 * The phone platform (phone audit, ux/phone-platform) on the production build with the service worker, at 375 wide:
 *  - the viewport meta (safe areas, keyboard resize) and no sideways scroll at 375;
 *  - a cold open with no signal and a kept session opens the shell with the offline banner, not the sign-in form,
 *    keeps Capture reachable and recovers by itself when signal returns; the same with an expired access token;
 *  - signed out and offline: "Sign in again when you have signal", no form;
 *  - the shell's <main> starts each new page at the top and Back returns to the list's place.
 * Signs in as the seeded sales fixture user (supabase/seed.sql, local stack only).
 */
const PASSWORD = 'fixture-only-password'

test.use({ viewport: { width: 375, height: 812 } })

async function workerInControl(page: Page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!reg.active) throw new Error('no active worker')
  })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

async function signIn(page: Page) {
  await page.goto('/login')
  await workerInControl(page)
  await page.getByLabel('Email').fill('sales@test.invalid')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/today$/)
  // The session resolved and the person is remembered on this device.
  await page.waitForFunction(() => window.localStorage.getItem('qtech.session.user') !== null)
}

const banner = (page: Page) => page.locator('[data-offline-banner]')

async function noSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.scrollingElement?.scrollWidth ?? 0, width: window.innerWidth }))
  expect(scroll).toBeLessThanOrEqual(width)
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true)
  await page.reload()
}

test.describe('phone platform', () => {
  test('viewport: safe areas and keyboard resize are on, pinch zoom is not taken away, nothing scrolls sideways at 375', async ({ page }) => {
    await page.goto('/login')
    const content = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(content).toContain('viewport-fit=cover')
    expect(content).toContain('interactive-widget=resizes-content')
    expect(content).not.toMatch(/maximum-scale|user-scalable/)
    await noSidewaysScroll(page)
    await signIn(page)
    await noSidewaysScroll(page)
    // The phone chrome is there and fits: the tab bar is on screen, inside the viewport.
    const tabs = page.getByRole('navigation', { name: 'Main' })
    await expect(tabs).toBeVisible()
    const box = await tabs.boundingBox()
    expect(box && box.y + box.height).toBeLessThanOrEqual(812)
  })

  test('offline cold open with a kept session: the shell and the offline banner, Capture reachable, and back online by itself', async ({ page, context }) => {
    await signIn(page)
    // The query cache was saved on the device for this person.
    await page.waitForFunction(
      () =>
        new Promise<boolean>(resolve => {
          const open = indexedDB.open('qtech-cache', 1)
          open.onupgradeneeded = () => open.result.createObjectStore('kv')
          open.onerror = () => resolve(false)
          open.onsuccess = () => {
            const get = open.result.transaction('kv').objectStore('kv').get('queries')
            get.onsuccess = () => resolve(Boolean(get.result?.userId))
            get.onerror = () => resolve(false)
          }
        }),
      undefined,
      { timeout: 15_000 },
    )

    await goOffline(context, page)
    await expect(banner(page)).toHaveText(/You’re offline — Showing what’s saved; changes need signal\./)
    await expect(page).toHaveURL(/\/today$/)
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await noSidewaysScroll(page)

    // Capture stays reachable from the shell (it keeps what is pasted on this phone).
    await expect(page.getByRole('button', { name: 'Capture' })).toBeEnabled()

    // Signal returns: the banner goes without a reload or a sign-in.
    await context.setOffline(false)
    await expect(banner(page)).toHaveCount(0, { timeout: 20_000 })
    await expect(page).toHaveURL(/\/today$/)
  })

  test('offline cold open after the access token expired: still the shell, not the sign-in form', async ({ page, context }) => {
    await signIn(page)
    // Age the kept session's access token, as after an hour away. The refresh token stays.
    await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find(k => /^sb-.*-auth-token$/.test(k))
      if (!key) throw new Error('no stored session')
      const s = JSON.parse(window.localStorage.getItem(key) as string) as { expires_at: number }
      s.expires_at = Math.floor(Date.now() / 1000) - 600
      window.localStorage.setItem(key, JSON.stringify(s))
    })
    await goOffline(context, page)
    await expect(banner(page)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page).toHaveURL(/\/today$/)
    await context.setOffline(false)
  })

  test('signed out and offline: sign in again when there is signal, and no form that cannot work', async ({ page, context }) => {
    await page.goto('/login')
    await workerInControl(page)
    await goOffline(context, page)
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible()
    await expect(page.getByText('Sign in again when you have signal.', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await context.setOffline(false)
    await expect(page.getByLabel('Email')).toBeVisible()
  })

  test('scroll: a new page starts at the top, Back returns to where the list was', async ({ page }) => {
    await signIn(page)
    const main = page.locator('main#main')
    // Make the scroller tall enough to scroll whatever the fixture data is. The spacer is not React's, so it stays across routes.
    await main.evaluate(el => {
      const spacer = document.createElement('div')
      spacer.style.height = '4000px'
      el.append(spacer)
    })
    await main.evaluate(el => el.scrollTo(0, 600))
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(600)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'RFQs' }).click()
    await expect(page).toHaveURL(/\/rfqs/)
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(0)

    await page.goBack()
    await expect(page).toHaveURL(/\/today$/)
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(600)
  })
})

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
const service = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

const savedCache = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>(resolve => {
        const open = indexedDB.open('qtech-cache', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('kv')
        open.onerror = () => resolve(false)
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('queries')
          get.onsuccess = () => resolve(Boolean(get.result))
          get.onerror = () => resolve(false)
        }
      }),
  )

test('an engineer deactivated while the app is open loses everything on this phone at the next request', async ({ page }) => {
  test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack')
  const email = `phone-deact-${Date.now()}@test.invalid`
  const created = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) })
  expect(created.status).toBe(200)
  const { id } = (await created.json()) as { id: string }
  expect((await service('/rest/v1/users', { method: 'POST', body: JSON.stringify({ id, name: 'Phone Engineer', role: 'engineer' }) })).status).toBe(201)

  await page.goto('/login')
  await workerInControl(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect.poll(() => savedCache(page), { timeout: 15_000 }).toBe(true)

  // An admin deactivates them (the users row current_user_role() reads, as the admin-users function writes it).
  expect((await service(`/rest/v1/users?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ deactivated_at: new Date().toISOString() }) })).status).toBe(204)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page).toHaveURL(/\/login$/)
  await expect.poll(() => savedCache(page)).toBe(false)
  const kept = await page.evaluate(() => Object.keys(window.localStorage).filter(k => k.startsWith('qtech.session') || /^sb-.*-auth-token$/.test(k)))
  expect(kept).toEqual([])
})
