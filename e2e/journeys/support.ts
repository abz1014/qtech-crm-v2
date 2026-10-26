import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { openAs, type Role } from '../support/stack'

/*
 * Shared by the three journey specs (P03). A journey is one working day for one role, driven through the real screens; this file holds
 * what every journey needs and nothing about any one of them:
 *
 *  - roleContext: a browser context that is already signed in as a fixture user. The session is made once per role (through the real
 *    login form) and kept as Playwright storage state, so a journey does not pay for a sign-in each time it needs a role.
 *  - counters: mouse presses and named keys counted from the page itself (installed with the context, so they survive a page load), so an
 *    interaction count is what the browser saw, not what the test believes it did.
 *  - fe2: records an interaction count against its FE-2 target and fails (softly, so one run reports every miss) when it is over.
 */

const STATE_DIR = join(tmpdir(), 'qtech-journeys')

/** The options a project's `use` block gives the `page` fixture; `browser.newContext()` does not inherit them, so they are passed on. */
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

async function installCounters(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __fe2?: { mouse: number; keys: string[] } }
    if (w.__fe2) return
    const state = { mouse: 0, keys: [] as string[] }
    w.__fe2 = state
    document.addEventListener('mousedown', () => void (state.mouse += 1), true)
    document.addEventListener(
      'keydown',
      e => {
        if (e.key.length > 1 && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) state.keys.push(e.key)
      },
      true,
    )
  })
}

/** Signs in as `role` once per run (through the real login form) and returns the saved storage state's path. */
async function stateFor(browser: Browser, info: TestInfo, role: Role): Promise<string> {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = join(STATE_DIR, `${role}-${process.pid}.json`)
  if (existsSync(path)) return path
  const context = await browser.newContext(contextOptions(info))
  const page = await context.newPage()
  await openAs(page, role, '/todo')
  await context.storageState({ path })
  await context.close()
  return path
}

/** A new context signed in as `role`, with the interaction counters installed. Close it when the journey is over. */
export async function roleContext(browser: Browser, info: TestInfo, role: Role): Promise<BrowserContext> {
  const storageState = await stateFor(browser, info, role)
  const context = await browser.newContext({ ...contextOptions(info), storageState })
  await installCounters(context)
  return context
}

/** Opens `path` in a new page of a signed-in context and waits for the app shell (as openAs does after sign-in). */
export async function openPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(path)
  await page.locator('#main').waitFor()
  return page
}

export interface Count {
  mouse: number
  keys: string[]
}

/** Zero the counters. Call it at the start of the interactions being counted (after setup that is not part of the flow). */
export const resetCount = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const s = (window as unknown as { __fe2?: Count }).__fe2
    if (!s) throw new Error('interaction counters are not installed in this page')
    s.mouse = 0
    s.keys.length = 0
  })

export const readCount = (page: Page): Promise<Count> =>
  page.evaluate(() => {
    const s = (window as unknown as { __fe2?: Count }).__fe2
    if (!s) throw new Error('interaction counters are not installed in this page')
    return { mouse: s.mouse, keys: [...s.keys] }
  })

const rows: string[] = []

/**
 * Record an interaction count against its FE-2 target. The check is soft: a miss is reported with the count and the target and the journey
 * carries on, so one run lists every step that is over rather than only the first. A miss is a finding about the product, not a thing to
 * loosen here.
 */
export function fe2(step: string, actual: number, target: number, note = ''): void {
  const line = `FE-2 | ${step} | ${actual} | target ${target}${note ? ` | ${note}` : ''}`
  rows.push(line)
  test.info().annotations.push({ type: 'FE-2', description: `${step}: ${actual} (target at most ${target})${note ? `. ${note}` : ''}` })
  console.log(line)
  expect.soft(actual, `FE-2 "${step}": ${actual} interactions, the target is at most ${target}`).toBeLessThanOrEqual(target)
}

/** A paste as the browser delivers it to the page when nothing is focused (the intake and Capture screens listen for it anywhere). */
export async function pastePage(page: Page, payload: { text?: string; file?: { name: string; type: string; b64: string } }): Promise<void> {
  await page.evaluate(({ text, file }) => {
    const dt = new DataTransfer()
    if (text) dt.setData('text/plain', text)
    if (file) {
      const bytes = Uint8Array.from(atob(file.b64), c => c.charCodeAt(0))
      dt.items.add(new File([bytes], file.name, { type: file.type }))
    }
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, payload)
}


/** Force the file-download fallback of Share (a desktop Chromium has no share sheet that takes files). */
export async function noShareApi(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }))
}

/** A 1x1 PNG: enough for a photo path (it is read, shrunk if that helps, uploaded and recorded). */
export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const ordRef = (n: number): string => `ORD-${String(n).padStart(4, '0')}`

/** The calendar month a day belongs to, as 'YYYY-MM' and as the page writes it ('September 2026'). */
export function monthOf(iso: string): { key: string; start: string; name: string; label: string; day: (n: number) => string } {
  const key = iso.slice(0, 7)
  const d = new Date(`${key}-01T00:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(d)
  return { key, start: `${key}-01`, name, label: `${name} ${d.getUTCFullYear()}`, day: n => `${key}-${String(n).padStart(2, '0')}` }
}

/** The month `back` months before the month of `iso`. */
export function monthBefore(iso: string, back: number) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - back, 1))
  return monthOf(d.toISOString().slice(0, 10))
}

export type Rule = 'not_floated' | 'chase_supplier' | 'bid_due' | 'chase_customer' | 'place_po' | 'goods_late' | 'delivered_not_invoiced' | 'payment_overdue'

/**
 * A hand-off check (lifecycle audit): open Today fresh, as the salesperson, and say whether the item for this record is listed. `text` is
 * what the row carries (the RFQ or order number, plus a supplier name where one RFQ or order has several rows of the same rule).
 */
export async function todayHas(context: BrowserContext, rule: Rule, text: string[], listed: boolean): Promise<void> {
  const page = await openPage(context, '/todo')
  await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()
  await expect(page.getByText(/\d+ need you/)).toBeVisible() // the list has loaded
  // Waiting starts collapsed (R2-08): open it, so a waiting row counts as listed as it did before
  const waiting = page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /^Chased, waiting · \d+/ })
  if ((await waiting.count()) > 0 && (await waiting.getAttribute('aria-expanded')) === 'false') await waiting.click()
  let row = page.locator(`li[data-rule="${rule}"]`)
  for (const t of text) row = row.filter({ hasText: t })
  if (listed) await expect(row.first(), `Today should list ${rule} for ${text.join(' ')}`).toBeVisible()
  else await expect(row, `Today should not list ${rule} for ${text.join(' ')}`).toHaveCount(0)
  await page.close()
}
