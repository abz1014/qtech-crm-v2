import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Browser, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test'
import { openAs, type Role } from '../../support/stack'

/*
 * Signed-in browser contexts for the verify suites. Each role signs in ONCE per worker process through the real login form; the
 * session is kept as Playwright storage state and every later context starts from it, so a test that needs two or three people
 * (sales quotes, admin records the payment, the engineer marks it delivered) pays for no extra sign-in.
 *
 *   const sales = await signedIn(browser, info, 'sales')
 *   const page = await open(sales, '/rfqs/123')
 *   ...
 *   await sales.close()
 *
 * `openAs(page, role, path)` from e2e/support/stack.ts is still there for a test that wants the sign-in itself on screen.
 */
const STATE_DIR = join(tmpdir(), 'qtech-verify')

function contextOptions(info: TestInfo) {
  const use = info.project.use
  return {
    baseURL: use.baseURL,
    viewport: use.viewport ?? { width: 1440, height: 900 },
    permissions: use.permissions ?? ['clipboard-read', 'clipboard-write'],
    locale: use.locale,
    timezoneId: use.timezoneId,
    serviceWorkers: use.serviceWorkers,
  }
}

async function stateFor(browser: Browser, info: TestInfo, role: Role): Promise<string> {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = join(STATE_DIR, `${role}-${process.pid}.json`)
  if (existsSync(path)) return path
  const context = await browser.newContext(contextOptions(info))
  const page = await context.newPage()
  await openAs(page, role, '/today')
  await context.storageState({ path })
  await context.close()
  return path
}

/** A new browser context already signed in as `role`. Close it at the end of the test. */
export async function signedIn(browser: Browser, info: TestInfo, role: Role): Promise<BrowserContext> {
  const storageState = await stateFor(browser, info, role)
  return browser.newContext({ ...contextOptions(info), storageState })
}

/** A new page in a signed-in context, at `path`, once the app shell is there. */
export async function open(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(path)
  await page.locator('#main').waitFor()
  return page
}

/**
 * Opens the Mark won dialog on an RFQ page. It is the green button (data-slot="mark-won") once a quotation is out or the RFQ is
 * closed; before that it is an item in the header's More menu.
 */
export async function openMarkWon(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: 'More', exact: true }).first()
  await more.waitFor()
  const slot = page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' })
  if ((await slot.count()) > 0 && (await slot.first().isVisible())) {
    await slot.first().click()
    return
  }
  await more.click()
  await page.getByRole('menuitem', { name: /^Mark won/ }).click()
}

/** Every request a page sends to the database's REST API, for "no money is ever asked for" checks. */
export function restLog(page: Page): { urls: string[]; requests: Request[] } {
  const log = { urls: [] as string[], requests: [] as Request[] }
  page.on('request', r => {
    if (r.url().includes('/rest/v1/')) {
      log.urls.push(decodeURIComponent(r.url()))
      log.requests.push(r)
    }
  })
  return log
}

/**
 * The tables, views and functions that carry money an engineer must never ask for (DECISIONS 2026-10-13: money is admin-only;
 * sales see invoices and order balances). Matched against the REST path.
 */
export const MONEY_PATHS = [
  '/rest/v1/payments_in',
  '/rest/v1/expenses',
  '/rest/v1/order_costs',
  '/rest/v1/invoices',
  '/rest/v1/v_order_money',
  '/rest/v1/v_payment_net',
  '/rest/v1/v_cash_month',
  '/rest/v1/v_month_pnl',
  '/rest/v1/v_gst_register',
  '/rest/v1/v_invoice_state',
  '/rest/v1/rpc/order_receivables',
  '/rest/v1/rpc/month_end_status',
  '/rest/v1/rpc/aging_as_of',
  '/rest/v1/rpc/payables_as_of',
]

export function moneyRequests(urls: string[]): string[] {
  return urls.filter(u => MONEY_PATHS.some(p => u.includes(p)))
}

/** The page is done loading data: no skeleton left and no request in flight for a moment. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#main .skeleton')).toHaveCount(0, { timeout: 15_000 })
}

/**
 * Mouse presses and named keys counted by the page itself (as e2e/journeys/support.ts does). Install on the context before the
 * page opens, zero with resetCount, read with readCount.
 */
export async function installCounters(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __fe2?: { mouse: number; keys: string[] } }
    if (w.__fe2) return
    const state = { mouse: 0, keys: [] as string[] }
    w.__fe2 = state
    document.addEventListener('mousedown', () => void (state.mouse += 1), true)
    document.addEventListener('keydown', e => void (e.key.length > 1 && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key) && state.keys.push(e.key)), true)
  })
}

export const resetCount = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const s = (window as unknown as { __fe2?: { mouse: number; keys: string[] } }).__fe2
    if (s) {
      s.mouse = 0
      s.keys.length = 0
    }
  })

export const readCount = (page: Page): Promise<{ mouse: number; keys: string[] }> =>
  page.evaluate(() => {
    const s = (window as unknown as { __fe2?: { mouse: number; keys: string[] } }).__fe2
    return s ? { mouse: s.mouse, keys: [...s.keys] } : { mouse: -1, keys: [] }
  })
