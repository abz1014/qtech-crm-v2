import { test, type Page } from '@playwright/test'
import { seedWorld, type World } from '../../verify-roles/fixtures'
import { service } from '../../verify-roles/lib'
import { contextAs, note, settle, shot, vp, Watcher } from './lib'

/*
 * Exploration: offline, slow network, the phone Back button on every overlay, and keyboard-only use. Records only.
 */
let world: World
test.beforeAll(async () => {
  world = await seedWorld('HS')
})

const OVERLAY = '[role="dialog"]:visible, [role="alertdialog"]:visible, [role="menu"]:visible'
const visibleOverlays = (page: Page) => page.locator(OVERLAY).count()

test('offline: save, navigate, come back online', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const context = await contextAs(browser, info, 'sales', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'sales', vp: 'w1366-offline' })
  w.at('/companies?new=1 offline')
  await page.goto('/companies?new=1')
  await settle(page)
  const name = `Hunt Offline Co ${Date.now().toString(36)}`
  const d = page.getByRole('dialog', { name: 'New company' })
  await d.getByRole('textbox', { name: /Company name/ }).fill(name)
  await context.setOffline(true)
  await d.getByRole('button', { name: /Add company/ }).click()
  await page.waitForTimeout(2500)
  const text = await page.locator('body').innerText()
  note({ kind: 'offline', path: 'new company', detail: `dialog open=${(await visibleOverlays(page)) > 0}; typed kept=${(await d.getByRole('textbox', { name: /Company name/ }).inputValue().catch(() => '')) === name}; messages=${JSON.stringify(text.match(/[^\n]*(connection|offline|network|internet)[^\n]*/gi) ?? [])}` })
  await shot(page, 'offline_new-company_submit')
  await context.setOffline(false)
  await d.getByRole('button', { name: /Try again|Add company/ }).click().catch(() => undefined)
  await page.waitForTimeout(2500)
  const rows = (await (await service(`/rest/v1/companies?select=id&name=eq.${encodeURIComponent(name)}`)).json()) as unknown[]
  note({ kind: 'offline', path: 'new company retry', detail: `after coming back online and Try again: ${rows.length} row(s) stored; dialog open=${(await visibleOverlays(page)) > 0}` })
  await shot(page, 'offline_new-company_retry')

  // Navigate while offline: lazy screens that were never loaded, and data that is not cached.
  for (const path of ['/settings/team', '/money/month-end', `/rfqs/${world.rfq.id}`, '/settings/exchange-rates']) {
    w.at(`${path} offline`)
    await page.goto('/today')
    await settle(page)
    await context.setOffline(true)
    await page.evaluate(p => {
      window.history.pushState({}, '', p)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
    await page.waitForTimeout(3000)
    const body = (await page.locator('#main').innerText().catch(() => '(no #main)')).replace(/\s+/g, ' ').slice(0, 300)
    note({ kind: 'offline', path, detail: `in-app navigation while offline shows: "${body}"` })
    await shot(page, `offline_nav_${path}`)
    await context.setOffline(false)
  }
  await context.close()
})

test('slow network: typing is kept, double submit makes one row', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const context = await contextAs(browser, info, 'sales', vp('w375'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'sales', vp: 'w375-slow' })
  await page.route('**/rest/v1/**', async route => {
    await new Promise(r => setTimeout(r, 2500))
    await route.continue().catch(() => undefined)
  })
  w.at('/companies slow')
  await page.goto('/companies')
  await page.getByRole('button', { name: 'New company' }).first().click({ timeout: 20_000 }).catch(() => undefined)
  const name = `Hunt Slow Typing Company ${Date.now().toString(36)}`
  const d = page.getByRole('dialog', { name: 'New company' })
  await d.getByRole('textbox', { name: /Company name/ }).pressSequentially(name, { delay: 15 })
  await page.waitForTimeout(3000) // late answers arrive while the dialog is open
  const kept = await d.getByRole('textbox', { name: /Company name/ }).inputValue().catch(() => '')
  note({ kind: 'slow', path: 'new company', detail: `typed "${name}", field holds "${kept}"` })
  const btn = d.getByRole('button', { name: /Add company/ })
  await btn.click()
  await btn.click({ timeout: 500 }).catch(() => undefined)
  await page.keyboard.press('Enter').catch(() => undefined)
  await page.waitForTimeout(8000)
  const rows = (await (await service(`/rest/v1/companies?select=id&name=eq.${encodeURIComponent(name)}`)).json()) as unknown[]
  note({ kind: 'slow', path: 'new company double submit', detail: `${rows.length} row(s) stored; url=${page.url()}` })
  await shot(page, 'slow_new-company')

  // The search palette with slow answers: type fast, check the last query wins.
  w.at('palette slow')
  await page.goto('/today')
  await settle(page)
  await page.getByRole('button', { name: 'Search' }).first().click().catch(() => undefined)
  const box = page.getByRole('combobox').first()
  await box.pressSequentially(world.tag.slice(0, 2), { delay: 30 })
  await page.waitForTimeout(400)
  await box.pressSequentially(world.tag.slice(2), { delay: 30 })
  await page.waitForTimeout(9000)
  const opts = await page.getByRole('option').allInnerTexts().catch(() => [] as string[])
  note({ kind: 'slow', path: 'palette', detail: `query "${await box.inputValue().catch(() => '')}" shows ${opts.length} options: ${opts.slice(0, 5).join(' | ').replace(/\s+/g, ' ')}` })
  await shot(page, 'slow_palette')
  await context.close()
})

/** Overlays to open on a phone, then press the browser Back button: the overlay should close and the page stay. */
const BACK_CASES: { role: 'admin' | 'sales' | 'engineer'; path: string; open: (p: Page) => Promise<unknown> }[] = [
  { role: 'sales', path: '/companies', open: p => p.getByRole('button', { name: 'New company' }).first().click() },
  { role: 'sales', path: '/today', open: p => p.getByRole('button', { name: 'Search' }).first().click() },
  { role: 'sales', path: '/today', open: p => p.getByRole('button', { name: /Capture/ }).first().click() },
  { role: 'admin', path: '/money/receivables', open: p => p.getByRole('button', { name: /^Record payment for ORD-/ }).first().click() },
  { role: 'admin', path: '/money/expenses', open: p => p.getByRole('button', { name: /^Add expenses?$/ }).first().click() },
  { role: 'admin', path: '/settings/team', open: p => p.getByRole('button', { name: 'Add person' }).first().click() },
  { role: 'sales', path: '/orders', open: p => p.getByRole('button', { name: /^(New order|Repeat a past order)$/ }).first().click() },
  { role: 'sales', path: '/rfqs/{rfq}', open: p => p.getByRole('button', { name: 'Add item' }).first().click() },
  { role: 'sales', path: '/orders/{order}', open: p => p.getByRole('button', { name: /^More( actions)?$/ }).first().click() },
  { role: 'sales', path: '/rfqs', open: p => p.getByRole('button', { name: /Filter/ }).first().click() },
]

test('phone Back button closes every overlay and keeps the page', async ({ browser }, info) => {
  test.setTimeout(300_000)
  for (const c of BACK_CASES) {
    const context = await contextAs(browser, info, c.role, vp('w375'))
    const page = await context.newPage()
    const w = new Watcher(page, { role: c.role, vp: 'w375-back' })
    const path = c.path.replace('{rfq}', world.rfq.id).replace('{order}', world.order.id)
    w.at(`${c.path} back`)
    await page.goto('/today')
    await settle(page)
    await page.goto(path)
    await settle(page)
    await c.open(page).catch(e => w.add('back-setup', `could not open: ${String(e).split('\n')[0].slice(0, 120)}`))
    await page.waitForTimeout(700)
    const opened = await visibleOverlays(page)
    const urlOpen = page.url()
    await page.goBack()
    await page.waitForTimeout(1200)
    const after = await visibleOverlays(page)
    note({ kind: 'back', role: c.role, vp: 'w375', path: c.path, detail: `overlay opened=${opened > 0}; after Back: overlay open=${after > 0}, url ${urlOpen.replace(/^https?:\/\/[^/]+/, '')} -> ${page.url().replace(/^https?:\/\/[^/]+/, '')}` })
    await shot(page, `back_${c.role}_${c.path}`)
    await context.close()
  }
})

test('keyboard only: focus is visible on every Tab stop of the main screens', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366-keys' })
  for (const path of ['/today', '/rfqs', `/rfqs/${world.rfq.id}`, `/orders/${world.order.id}`, '/companies', '/money/receivables', '/settings/targets']) {
    w.at(`${path} tab`)
    await page.goto(path)
    await settle(page)
    const invisible: string[] = []
    const seen = new Set<string>()
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab')
      const f = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        if (!a || a === document.body) return null
        const cs = getComputedStyle(a)
        const r = a.getBoundingClientRect()
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none')
        const name = `${a.tagName} ${(a.getAttribute('aria-label') ?? a.innerText ?? '').trim().slice(0, 40)}`
        return { name, ring, off: r.bottom < 0 || r.top > window.innerHeight || r.width === 0 }
      })
      if (!f) continue
      if (seen.has(f.name)) continue
      seen.add(f.name)
      if (!f.ring) invisible.push(f.name)
      if (f.off) invisible.push(`${f.name} (off screen)`)
    }
    if (invisible.length) w.add('focus-invisible', `${invisible.length} stops with no visible focus ring: ${invisible.slice(0, 6).join(' | ')}`)
  }
  await context.close()
})

/*
 * The browser clock at the edges of a period (quarter end and start, the Pakistani tax year end on 30 June). Only times in the PAST
 * are used, so the signed-in session never looks expired to the client. The database's own "today" stays the real one.
 */
const EDGE_TIMES = ['2026-06-30T23:59:30+05:00', '2026-07-01T00:00:30+05:00', '2026-09-30T23:59:30+05:00', '2026-10-01T00:00:30+05:00', '2026-08-31T23:59:30+05:00']

test('clock at quarter, month and tax-year ends', async ({ browser }, info) => {
  test.setTimeout(300_000)
  for (const t of EDGE_TIMES) {
    const context = await contextAs(browser, info, 'admin', vp('w1366'))
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(t))
    const w = new Watcher(page, { role: 'admin', vp: `w1366-clock-${t.slice(0, 16)}` })
    for (const path of ['/today', '/settings/targets', '/money/month-end', '/money/reports', '/money/receivables', '/money/expenses?add=1']) {
      w.at(path)
      await page.goto(path)
      await page.locator('#main').waitFor({ timeout: 15_000 }).catch(() => undefined)
      await settle(page)
      const main = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const dates = main.match(/\b(Q[1-4]\b[^.|]{0,20}|(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3} \d{4}|(January|February|March|April|May|June|July|August|September|October|November|December) \d{4})/g) ?? []
      note({ kind: 'clock', role: 'admin', vp: 'w1366', path, detail: `${t}: ${[...new Set(dates)].slice(0, 10).join(' ; ')}` })
      await shot(page, `clock_${t.slice(0, 16)}_${path}`)
    }
    await context.close()
  }
})

/** Hand-edited and stale links: a malformed id, an id that does not exist, an impossible month, junk query values. */
const BAD_LINKS = [
  '/rfqs/not-a-uuid',
  '/rfqs/00000000-0000-4000-8000-000000000000',
  '/orders/123',
  '/orders/00000000-0000-4000-8000-000000000000',
  '/companies/zzz',
  '/companies/00000000-0000-4000-8000-000000000000',
  '/money/month-end?month=2026-13',
  '/money/month-end?month=garbage',
  '/money/month-end?month=2030-01',
  '/money/month-end/bank?month=2030-01',
  '/money/month-end?month=1999-12',
  '/money/reports/pnl?month=1999-01',
  '/money/reports/aging?month=2026-02&asof=2026-02-30',
  '/money/receivables?pay=1&order=garbage',
  '/money/receivables?pay=1&order=00000000-0000-4000-8000-000000000000',
  '/money/gst-register?invoice=garbage',
  '/money/gst-register?new=1&order=garbage',
  '/money/expenses?add=1&order=garbage',
  '/rfqs?show=bogus&owner=nobody',
  '/orders?tab=bogus',
  '/settings/targets?year=1800',
  '/rfqs/new?company=garbage',
]

test('bad deep links: malformed ids, missing records, impossible months', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const w = new Watcher(page, { role: 'admin', vp: 'w1366-links' })
  for (const path of BAD_LINKS) {
    w.at(path)
    await page.goto(path)
    await page.locator('#main').waitFor({ timeout: 15_000 }).catch(() => undefined)
    await settle(page)
    await page.waitForTimeout(1500)
    const h1 = (await page.locator('h1').allInnerTexts().catch(() => [] as string[])).join(' | ')
    const main = (await page.locator('#main').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const skeleton = await page.locator('#main [aria-busy="true"], #main .animate-pulse').count()
    note({ kind: 'bad-link', role: 'admin', vp: 'w1366', path, detail: `h1="${h1}" skeletons=${skeleton} dialogs=${await visibleOverlays(page)} text="${main.slice(0, 220)}"` })
    await shot(page, `badlink_${path}`)
  }
  await context.close()
})
