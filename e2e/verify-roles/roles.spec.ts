import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { API_URL, openAs } from '../support/stack'
import { fill, seedWorld, type World } from './fixtures'
import { moneyIn, norole, FIXTURE_PASSWORD, STAFF_EMAIL, type Leak } from './lib'
import {
  CURRENCY_AMOUNT,
  ENGINEER_MONEY_WORDS,
  ENGINEER_OWN_SELECTORS,
  GST_AMOUNT,
  MONEY_REQUEST,
  ROUTES,
  type Allowance,
  type Expect,
} from './routes'

/*
 * Every route and deep link (routes.ts), as every role, through the real login form, on the production build with the
 * production Content-Security-Policy (E2E_CSP=1, scripts/ci/e2e-run.sh).
 *
 *  - admin, sales, engineer: each route gives the screen, the no-access page or "Page not found" as routes.ts says, and a
 *    redirect lands where it should. Each listed dialog opener is present for the roles that may use it and ABSENT for the
 *    others; present ones are opened and their dialog scanned, then closed. Every popover trigger on the page (menus, tips)
 *    is opened and scanned too.
 *  - engineer only: the visible text of every screen and every opened dialog or popover has no money (amounts, money
 *    words, GST amounts), except the allowances routes.ts names (supplier prices, exchange rates, M-3 quotation prices);
 *    every JSON answer the browser receives is checked column by column (lib.ts MONEY, the same classification as pgTAP
 *    0902), and the browser never asks for a money table, view or function at all.
 *  - signed out, deactivated, no users row: every protected route goes to the sign-in page.
 * Findings are collected with expect.soft, so one run lists every miss.
 */
let world: World
/** What the engineer's browser received during the crawl, kept in a file so the network tests after it can read it even
 * when the crawl itself failed (Playwright starts a new worker after a failure). */
const NET_FILE = join(tmpdir(), 'qtech-verify-roles-engineer-net.json')
const readNet = (): Watch | null => (existsSync(NET_FILE) ? (JSON.parse(readFileSync(NET_FILE, 'utf8')) as Watch) : null)

test.setTimeout(600_000)

test.beforeAll(async () => {
  world = await seedWorld('VR')
})

type Staff = 'admin' | 'sales' | 'engineer'

interface Visit {
  state: 'page' | 'no-access' | 'not-found' | 'login'
  url: string
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  await page.locator('[role="status"][aria-label="Loading"], [aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}

async function stateOf(page: Page): Promise<Visit> {
  const url = page.url()
  if (new URL(url).pathname.startsWith('/login')) return { state: 'login', url }
  const h1 = (await page.locator('h1').allInnerTexts().catch(() => [] as string[])).join(' | ')
  const titles = (await page.locator('[data-mood="warning"]').allInnerTexts().catch(() => [] as string[])).join(' | ')
  if (/ is for (admins|admins and sales)|has no access yet/.test(`${h1} ${titles}`)) return { state: 'no-access', url }
  if (/Page not found/.test(h1)) return { state: 'not-found', url }
  return { state: 'page', url }
}

function allowedStates(e: Expect): Visit['state'][] {
  return e === 'ok' ? ['page'] : e === 'new' ? ['page', 'not-found'] : ['no-access', 'not-found']
}

/** The visible text of the page (or of one element), less the parts an engineer may always see (their own target). */
async function visibleText(page: Page, scope?: string): Promise<string> {
  return page.evaluate(
    ({ scope, exclude }) => {
      const root = (scope ? document.querySelector(scope) : document.body) as HTMLElement | null
      if (!root) return ''
      let text = root.innerText
      for (const sel of exclude) for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) text = text.split(el.innerText).join(' ')
      return text
    },
    { scope, exclude: ENGINEER_OWN_SELECTORS },
  )
}

/** Money an engineer must not see in `text`, given the screen's allowances. */
function engineerTextLeaks(text: string, allow: readonly Allowance[], w: World): string[] {
  const out: string[] = []
  const words = (text.match(new RegExp(ENGINEER_MONEY_WORDS.source, 'g')) ?? []).filter(x => !(allow.includes('m3') && x === 'Selling price'))
  out.push(...words.map(x => `money word "${x}"`))
  const pricesOk = allow.includes('supplier') || allow.includes('m3') || allow.includes('fx')
  if (!pricesOk) {
    const amount = text.match(new RegExp(CURRENCY_AMOUNT.source, 'g')) ?? []
    out.push(...amount.map(x => `amount "${x}…"`))
    const gst = text.match(GST_AMOUNT)
    if (gst) out.push(`GST amount "${gst[0]}"`)
  }
  // The world's distinctive figures that are never allowed: invoice, payment, expense, expected cost, legacy value and cost.
  const fmt = (n: number) => [String(n), n.toLocaleString('en-US')]
  const never = [w.amounts.invoiceNet, w.amounts.invoiceGst, w.amounts.payment, w.amounts.expense, w.amounts.cost, w.amounts.legacyCost]
  if (!allow.includes('m3')) never.push(w.amounts.sell, w.amounts.legacyValue)
  if (!allow.includes('supplier')) never.push(w.amounts.supplier)
  for (const n of never) for (const s of fmt(n)) if (text.includes(s)) out.push(`figure ${s}`)
  return [...new Set(out)]
}

interface Watch {
  current: string
  allow: readonly Allowance[]
  leaks: string[]
  /** Selling or supplier prices on a screen whose allowances do not cover them. */
  prices: string[]
  requests: string[]
  accepted: string[]
}

/** Engineer: every JSON answer from the API is checked; money requests are recorded. */
function watchNetwork(page: Page, w: Watch): void {
  page.on('request', r => {
    const u = r.url()
    if (u.startsWith(API_URL) && MONEY_REQUEST.test(u)) w.requests.push(`${w.current}: ${r.method()} ${new URL(u).pathname}`)
  })
  page.on('response', async res => {
    const u = res.url()
    if (!u.startsWith(`${API_URL}/rest/v1/`)) return
    if (!(res.headers()['content-type'] ?? '').includes('json')) return
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return
    }
    const path = new URL(u).pathname.replace('/rest/v1/', '')
    const object = path.startsWith('rpc/') ? path.slice(4) : path
    const found: Leak[] = moneyIn(object, body, `${w.current} -> /${path}`)
    for (const l of found) {
      const line = `${l.where}: ${l.field} [${l.rule}]`
      if (l.rule === 'legacy') continue // BUG-RV-01 has its own expected-fail test below
      if ((l.rule === 'supplier' && w.allow.includes('supplier')) || (l.rule === 'm3' && w.allow.includes('m3')) || l.rule === 'own') {
        w.accepted.push(line)
        continue
      }
      if (l.rule === 'supplier' || l.rule === 'm3') w.prices.push(line)
      else w.leaks.push(line)
    }
  })
}

/** Opens each popover trigger on the page (menus, info tips), scans what it shows, closes it. Returns the texts. */
async function popoverTexts(page: Page): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = []
  const triggers = page.locator('#main [aria-haspopup="dialog"]:visible, #main [aria-haspopup="menu"]:visible')
  const n = Math.min(await triggers.count(), 20)
  for (let i = 0; i < n; i++) {
    const t = triggers.nth(i)
    if (!(await t.isEnabled().catch(() => false))) continue
    const name = ((await t.getAttribute('aria-label')) ?? (await t.innerText().catch(() => ''))).trim().slice(0, 60)
    try {
      await t.click({ timeout: 3_000 })
      const pop = page.locator('[data-radix-popper-content-wrapper]').last()
      await pop.waitFor({ state: 'visible', timeout: 3_000 })
      out.push({ name, text: await pop.innerText() })
    } catch {
      // a trigger that opens nothing in this state is not a finding
    }
    await page.keyboard.press('Escape')
    await page.locator('[data-radix-popper-content-wrapper]').first().waitFor({ state: 'detached', timeout: 2_000 }).catch(() => undefined)
  }
  return out
}

async function closeDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').first().waitFor({ state: 'detached', timeout: 2_000 }).catch(() => undefined)
  }
}

/** Visits every route as `role`; returns nothing, records soft failures. */
async function crawl(page: Page, role: Staff, info: TestInfo): Promise<Watch> {
  const watch: Watch = { current: '', allow: [], leaks: [], prices: [], requests: [], accepted: [] }
  if (role === 'engineer') watchNetwork(page, watch)
  page.on('dialog', d => void d.accept()) // a browser "Leave site?" never blocks the crawl
  const table: string[] = []

  for (const r of ROUTES) {
    const path = fill(r.path, world)
    watch.current = r.path
    watch.allow = r.prices ?? []
    await page.goto(path)
    await settle(page)
    const v = await stateOf(page)
    table.push(`${r.path} -> ${v.state} ${new URL(v.url).pathname}`)
    expect.soft(allowedStates(r[role]), `${role} ${r.path}: expected ${r[role]}, got ${v.state} at ${v.url}`).toContain(v.state)
    if (r.landsOn && r[role] === 'ok') expect.soft(new URL(v.url).pathname, `${role} ${r.path}: redirect target`).toMatch(r.landsOn)

    // Deep-link dialogs (?issue=1, ?new=1, ?pay=1 ...) are open now: scan them, then close.
    if (role === 'engineer') {
      for (const d of await page.getByRole('dialog').all()) {
        const leaks = engineerTextLeaks(await d.innerText().catch(() => ''), watch.allow, world)
        expect.soft(leaks, `engineer ${r.path}: deep-link dialog shows money`).toEqual([])
      }
    }
    if (r.path.includes('pay=1') && role === 'sales') {
      await expect.soft(page.getByRole('dialog', { name: /Record payment/ }), 'sales must not get the Record payment dialog from a deep link').toHaveCount(0)
    }
    await closeDialogs(page)

    if (v.state !== 'page') {
      if (role === 'engineer') expect.soft(engineerTextLeaks(await visibleText(page), [], world), `engineer ${r.path}: refused page shows money`).toEqual([])
      continue
    }

    if (role === 'engineer') {
      expect.soft(engineerTextLeaks(await visibleText(page), watch.allow, world), `engineer ${r.path}: money on the screen`).toEqual([])
      for (const name of r.engineerAbsent ?? []) {
        const hits = (await page.getByRole('button', { name }).count()) + (await page.getByRole('columnheader', { name }).count()) +
          (await page.getByRole('heading', { name }).count()) + (await page.getByRole('checkbox', { name }).count())
        expect.soft(hits, `engineer ${r.path}: "${name.source}" must not be offered`).toBe(0)
      }
    }

    for (const o of r.openers ?? []) {
      const button = page.getByRole('button', { name: o.name })
      const count = await button.count()
      if (!o.roles.includes(role)) {
        expect.soft(count, `${role} ${r.path}: "${o.name.source}" is for ${o.roles.join(', ')} only`).toBe(0)
        continue
      }
      if (count === 0) {
        if (!o.optional) expect.soft(count, `${role} ${r.path}: "${o.name.source}" should be offered (positive control)`).toBeGreaterThan(0)
        continue
      }
      if (o.open === false) continue
      const b = button.first()
      if (!(await b.isEnabled())) continue
      await b.click()
      const dialog = page.getByRole('dialog').last()
      const opened = await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)
      expect.soft(opened, `${role} ${r.path}: "${o.name.source}" opens a dialog`).toBe(true)
      if (opened && role === 'engineer') {
        expect.soft(engineerTextLeaks(await dialog.innerText(), watch.allow, world), `engineer ${r.path}: dialog "${o.name.source}" shows money`).toEqual([])
      }
      await closeDialogs(page)
    }

    for (const p of await popoverTexts(page)) {
      if (role === 'engineer') expect.soft(engineerTextLeaks(p.text, watch.allow, world), `engineer ${r.path}: popover "${p.name}" shows money`).toEqual([])
      if (role !== 'admin') {
        expect.soft(/Merge into another company/.test(p.text), `${role} ${r.path}: popover "${p.name}" offers Merge (admin only)`).toBe(false)
        expect.soft(/^\s*Team\s*$/m.test(p.text) && /Sign out/.test(p.text), `${role}: the account menu offers Team (admin only)`).toBe(false)
      }
    }
  }

  // The network findings are asserted by the two "engineer network" tests after the crawl.
  if (role === 'engineer') await settle(page)
  info.annotations.push({ type: 'route table', description: table.join('\n') })
  return watch
}

async function staffContext(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
}

for (const role of ['admin', 'sales', 'engineer'] as const) {
  test(`${role}: every route, dialog and popover`, async ({ browser }, info) => {
    const context = await staffContext(browser, info)
    const page = await context.newPage()
    await openAs(page, role, '/today')
    // The shell: the nav and the account menu.
    const money = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Money/ })
    if (role === 'engineer') await expect.soft(money).toHaveCount(0)
    else await expect.soft(money).toHaveCount(1)
    await page.getByRole('button', { name: /^Account menu, / }).click()
    const team = page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Team' })
    await expect.soft(team).toHaveCount(role === 'admin' ? 1 : 0)
    await page.keyboard.press('Escape')
    if (role === 'engineer') rmSync(NET_FILE, { force: true })
    const w = await crawl(page, role, info)
    if (role === 'engineer') writeFileSync(NET_FILE, JSON.stringify(w))
    await context.close()
  })
}

test('engineer network: no hidden money column in any answer, and no request for money at all', async () => {
  const info = test.info()
  const w = readNet()
  test.skip(!w, 'needs the engineer crawl above')
  if (!w) return
  info.annotations.push({ type: 'accepted exposure (owner decisions M-3 and (a))', description: [...new Set(w.accepted)].slice(0, 60).join(' ; ') || 'none' })
  expect.soft([...new Set(w.leaks)], 'engineer: money columns (invoice, payment, cost, margin, GST, balance) in API answers').toEqual([])
  expect.soft([...new Set(w.requests)], 'engineer: requests for money tables, views or functions').toEqual([])
})

test('engineer network: no selling or supplier price outside the screens that show them by owner decision', async () => {
  const info = test.info()
  const w = readNet()
  test.skip(!w, 'needs the engineer crawl above')
  if (!w) return
  info.annotations.push({ type: 'prices outside the allowances', description: [...new Set(w.prices)].join(' ; ') || 'none' })
  expect([...new Set(w.prices)], 'engineer: selling or supplier prices in answers on screens that do not show prices').toEqual([])
})

test('signed out: every protected route and deep link goes to sign-in, then back to it after sign-in', async ({ page }) => {
  for (const r of ROUTES.filter(x => x.path !== '/login')) {
    await page.goto(fill(r.path, world))
    await expect.soft(page, `signed out ${r.path}`).toHaveURL(/\/login$/)
  }
  // The sign-in return point keeps the address, and the role rule still applies after it.
  await page.goto(fill('/orders/{order}', world))
  await page.getByLabel('Email').fill(STAFF_EMAIL.engineer)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/orders/${world.order.id}$`))
  await page.getByRole('button', { name: /^Account menu, / }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/money/expenses')
  await page.getByLabel('Email').fill(STAFF_EMAIL.engineer)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/money\/expenses$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/is for admins/)
})

for (const who of ['deactivated', 'norole'] as const) {
  test(`${who}: signing in is refused, and every route stays on sign-in`, async ({ page }) => {
    const cred = who === 'deactivated' ? { email: STAFF_EMAIL.deactivated, password: FIXTURE_PASSWORD } : await norole()
    await page.goto('/login')
    await page.getByLabel('Email').fill(cred.email)
    await page.getByLabel('Password', { exact: true }).fill(cred.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('This account is deactivated')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    for (const r of ROUTES.filter(x => x.path !== '/login')) {
      await page.goto(fill(r.path, world))
      await expect.soft(page, `${who} ${r.path}`).toHaveURL(/\/login$/)
      await expect.soft(page.locator('#main'), `${who} ${r.path}: no shell`).toHaveCount(0)
    }
  })
}

// BUG-RV-01 in the browser: the supplier's company page downloads supplier_orders.legacy_source, which (for imported
// orders) is the old order row with its value and COST, into any role's browser, the engineer's included.
test('BUG-RV-01: the engineer\'s browser receives no legacy order value or cost', async ({ browser }, info) => {
  test.fail(true, 'BUG-RV-01: legacy_source (old order_value, cost_value) reaches engineers; see pgTAP 0902')
  const context = await staffContext(browser, info)
  const page = await context.newPage()
  const legacy: string[] = []
  page.on('response', async res => {
    if (!res.url().startsWith(`${API_URL}/rest/v1/`) || !(res.headers()['content-type'] ?? '').includes('json')) return
    const body = await res.json().catch(() => null)
    const path = new URL(res.url()).pathname.replace('/rest/v1/', '')
    for (const l of moneyIn(path.replace(/^rpc\//, ''), body)) if (l.rule === 'legacy') legacy.push(`${path}: ${l.field}`)
  })
  await openAs(page, 'engineer', `/companies/${world.supplier.id}`)
  await settle(page)
  await page.goto(`/orders/${world.legacyOrder.id}`)
  await settle(page)
  await context.close()
  expect(legacy, 'legacy money keys the engineer\'s browser received').toEqual([])
})
