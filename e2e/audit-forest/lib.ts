import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page, Route, TestInfo } from '@playwright/test'
import { openAs } from '../support/stack'
import type { Role, Width } from './routes'

/*
 * Plumbing of the Forest audit: where it writes, how it signs in, how it makes a state (empty, loading, error) and how it waits for a
 * screen to settle. Findings are appended one JSON line at a time (each worker its own file), so a crash keeps what was found;
 * scripts/audit/forest-merge.mjs folds them into findings.json and summary.json after the run.
 */
export const OUT = fileURLToPath(new URL('../../test-results/forest-audit', import.meta.url))
mkdirSync(join(OUT, 'findings'), { recursive: true })

export type TextSize = 'normal' | 'small' | 'large'
export type State = 'ok' | 'empty' | 'loading' | 'error' | 'long' | 'expanded' | 'long-expanded' | `dialog-${string}`

export interface Where {
  route: string
  path: string
  role: Role
  width: number
  text: TextSize
  state: State
}

export interface Finding extends Where {
  rule: string
  selector: string
  detail: string
  url?: string
  shot?: string
}

const FINDINGS = join(OUT, 'findings', `findings-${process.pid}.jsonl`)
const COMBOS = join(OUT, 'findings', `combos-${process.pid}.jsonl`)

export function record(f: Finding): void {
  appendFileSync(FINDINGS, `${JSON.stringify(f)}\n`)
}
export function combo(w: Where, shot: string, extra: Record<string, unknown> = {}): void {
  appendFileSync(COMBOS, `${JSON.stringify({ ...w, shot, ...extra })}\n`)
}

/** test-results/forest-audit/<route>/<role>-<w>-<text>-<state>[-full].png */
export function shotPath(w: Where, suffix = ''): string {
  const state = w.state.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').slice(0, 60)
  const p = join(OUT, w.route, `${w.role}-${w.width}-${w.text}-${state}${suffix}.png`)
  mkdirSync(dirname(p), { recursive: true })
  return p
}
export const rel = (p: string) => p.slice(OUT.length + 1).replaceAll('\\', '/')

const STATE_DIR = join(tmpdir(), 'qtech-forest-audit')

async function stateFor(browser: Browser, info: TestInfo, role: Exclude<Role, 'anon'>): Promise<string> {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = join(STATE_DIR, `${role}-${process.pid}.json`)
  if (existsSync(path)) return path
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await openAs(page, role, '/todo')
  await context.storageState({ path })
  await context.close()
  return path
}

export const isPhone = (w: number) => w < 768

/** A context signed in as `role` at `v`, the given text size, phones with touch (coarse pointer). */
export async function contextAs(browser: Browser, info: TestInfo, role: Role, v: Width, text: TextSize): Promise<BrowserContext> {
  const storageState = role === 'anon' ? undefined : await stateFor(browser, info, role)
  const phone = isPhone(v.w)
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    storageState,
    viewport: { width: v.w, height: v.h },
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    serviceWorkers: 'block',
    acceptDownloads: false,
  })
  if (text !== 'normal') await context.addInitScript(size => window.localStorage.setItem('qtech.text-size', size), text)
  // A Send or Open that opens a new window (mailto, WhatsApp, a PDF) must not pile up tabs.
  context.on('page', p => {
    void p
      .opener()
      .then(o => (o ? p.close() : undefined))
      .catch(() => undefined)
  })
  context.setDefaultTimeout(8_000)
  context.setDefaultNavigationTimeout(25_000)
  return context
}

/**
 * Emulates a touch screen's pointer media features (pointer: coarse, hover: none) on a phone page: hasTouch alone does not make
 * (pointer: coarse) match in headless Chromium, and the app sizes its touch targets on it (index.css). Call it before the first goto.
 */
export async function coarse(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page).catch(() => null)
  await cdp
    ?.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }, { name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-hover', value: 'none' }] })
    .catch(() => undefined)
}

/** Waits until the screen has loaded: shell, no request in flight, no skeleton or busy region, fonts in, animations done. */
export async function settle(page: Page, opts: { skeletons?: boolean } = {}): Promise<void> {
  await page.locator('#main, form').first().waitFor({ timeout: 15_000 }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined)
  if (opts.skeletons !== false) {
    await page
      .waitForFunction(() => !document.querySelector('#main .skeleton, #main [aria-busy="true"], [role="dialog"] [aria-busy="true"]'), undefined, { timeout: 6_000 })
      .catch(() => undefined)
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
  await waitAnimations(page)
}

export async function waitAnimations(page: Page, limit = 2_000): Promise<void> {
  await page
    .evaluate(async ms => {
      const deadline = performance.now() + ms
      const running = () =>
        document.getAnimations().filter(a => {
          const t = a.effect?.getComputedTiming()
          return a.playState === 'running' && t !== undefined && Number.isFinite(t.endTime)
        })
      while (running().length > 0 && performance.now() < deadline) await new Promise(r => setTimeout(r, 50))
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    }, limit)
    .catch(() => undefined)
}

/** Client-side navigation (the shell stays mounted): what a tap on a link does. */
export async function spaGo(page: Page, path: string): Promise<void> {
  await page.evaluate(p => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  }, path)
}

const REST = /\/rest\/v1\//

/** Empty state: every list read answers no rows; a single-row read answers "no row" (PGRST116). RPCs pass (their shapes vary). */
export async function makeEmpty(page: Page): Promise<void> {
  await page.route(REST, async (r: Route) => {
    const req = r.request()
    if (/\/rest\/v1\/rpc\//.test(req.url()) || !['GET', 'HEAD'].includes(req.method())) return r.continue()
    if (/vnd\.pgrst\.object/.test(req.headers().accept ?? ''))
      return r.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }) })
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]' })
  })
}

/** Loading state: every data request is held (released when the page closes). */
export async function makeLoading(page: Page): Promise<() => void> {
  const held: Route[] = []
  await page.route(REST, r => {
    held.push(r)
  })
  return () => {
    for (const r of held) void r.abort().catch(() => undefined)
  }
}

/** Error state: every data request fails as if the connection dropped. */
export async function makeError(page: Page): Promise<void> {
  await page.route(REST, r => r.abort('failed'))
}

const MUTATING_RPC = /\/rpc\/(issue|close|reopen|stamp|merge|delete|mark|record|create|set|update|insert|add|remove|lock|cancel|approve|reject|send|save|upsert|import|undo|tick|untick|move|convert|split|repeat|restore|archive|deactivate|reactivate|copy|apply|clear|post|book|pay|link|unlink|assign)/i

/** While openers are clicked: no write reaches the database (a one-tap action is refused, not done), so every page stays as seeded. */
export async function writeFirewall(page: Page): Promise<void> {
  await page.route(/\/(rest|storage|functions)\/v1\//, r => {
    const req = r.request()
    const m = req.method()
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return r.continue()
    if (/\/rest\/v1\/rpc\//.test(req.url()) && !MUTATING_RPC.test(req.url())) return r.continue()
    return r.abort('blockedbyclient')
  })
}

/**
 * A full-page picture. The app scrolls #main, not the document, so the viewport is grown by what #main (and the document) hide,
 * the picture taken, and the viewport put back.
 */
export async function fullShot(page: Page, path: string): Promise<void> {
  const vp = page.viewportSize()
  if (!vp) return
  const extra = await page
    .evaluate(() => {
      const m = document.getElementById('main')
      const doc = document.documentElement
      return Math.max(0, doc.scrollHeight - doc.clientHeight) + (m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0)
    })
    .catch(() => 0)
  const h = Math.min(vp.height + extra, 14_000)
  try {
    if (h > vp.height) {
      await page.setViewportSize({ width: vp.width, height: h })
      await waitAnimations(page, 800)
    }
    await page.screenshot({ path, timeout: 15_000, animations: 'disabled', caret: 'hide' })
  } finally {
    if (h > vp.height) await page.setViewportSize(vp)
  }
}

/** Runs `fn`, at most `ms`; a step that hangs is recorded instead of eating the test's time. */
export async function bounded<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([fn(), new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)))])
  } finally {
    if (t) clearTimeout(t)
  }
}
