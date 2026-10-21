import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test'
import { openAs, type Role } from '../../support/stack'

/*
 * Exploratory bug hunt, round 1 (workflows). These specs drive the app like a person and RECORD what goes wrong instead of stopping
 * at the first failure, so one CI run reports everything:
 *
 *   probe(info, page, 'step name', async () => { ... })   runs a step; an error is written down (with a screenshot) and the test goes on
 *   note(info, {...})                                      writes down an observation (a finding) without throwing
 *   watch(page, info, label)                               records console errors, page errors, 4xx/5xx answers and failed requests
 *   layout(page, info, label)                              records horizontal scroll, text cut off and overlapping text
 *   shot(page, name)                                       a screenshot into the uploaded review folder
 *
 * Everything lands in <REVIEW_DIR>/hunt-workflows/ (CI uploads review-shots/): findings.jsonl plus the screenshots. Confirmed bugs are
 * then pinned as test.fail('HW-n: ...') tests in bugs.spec.ts, so a fix flips them.
 */

export const OUT = join(process.env.REVIEW_DIR ?? 'test-results', 'hunt-workflows')
mkdirSync(OUT, { recursive: true })

export type Viewport = 'desktop' | 'phone'
export const VIEWPORTS: Record<Viewport, { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean }> = {
  desktop: { viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
}

const STATE_DIR = join(tmpdir(), 'qtech-hunt')

async function stateFor(browser: Browser, info: TestInfo, role: Role): Promise<string> {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = join(STATE_DIR, `${role}-${process.pid}.json`)
  if (existsSync(path)) return path
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  await openAs(page, role, '/today')
  await context.storageState({ path })
  await context.close()
  return path
}

/** A signed-in context for `role` at the given viewport (phone = 375x812 with touch). */
export async function ctxAs(browser: Browser, info: TestInfo, role: Role, vp: Viewport = 'desktop', extra: Record<string, unknown> = {}): Promise<BrowserContext> {
  const storageState = await stateFor(browser, info, role)
  return browser.newContext({
    baseURL: info.project.use.baseURL,
    ...VIEWPORTS[vp],
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    permissions: ['clipboard-read', 'clipboard-write'],
    storageState,
    ...extra,
  })
}

/** A fresh, signed-out context (for sign-in as a user made during the test). */
export async function blankCtx(browser: Browser, info: TestInfo, vp: Viewport = 'desktop'): Promise<BrowserContext> {
  return browser.newContext({ baseURL: info.project.use.baseURL, ...VIEWPORTS[vp], locale: 'en-GB', timezoneId: 'Asia/Karachi', permissions: ['clipboard-read', 'clipboard-write'] })
}

export interface Finding {
  kind: 'probe-failed' | 'console' | 'pageerror' | 'http' | 'requestfailed' | 'slow' | 'layout' | 'observation' | 'access'
  where: string
  what: string
  detail?: unknown
  shot?: string
}

let seq = 0
export function note(info: TestInfo, f: Finding): void {
  const row = { test: info.title, project: info.project.name, at: new Date().toISOString(), ...f }
  appendFileSync(join(OUT, 'findings.jsonl'), JSON.stringify(row) + '\n')
  console.log(`HUNT ${f.kind} @ ${f.where}: ${f.what}${f.detail ? ' ' + JSON.stringify(f.detail).slice(0, 600) : ''}`)
}

const safe = (s: string) => s.replace(/[^a-z0-9-]+/gi, '_').slice(0, 90)

export async function shot(page: Page, name: string, fullPage = true): Promise<string> {
  const path = join(OUT, `${String(++seq).padStart(3, '0')}-${safe(name)}.png`)
  try {
    await page.screenshot({ path, fullPage, timeout: 10_000 })
  } catch {
    /* page gone */
  }
  return path
}

/** Run a step; on failure record it (message + screenshot) and carry on. Returns true when the step passed. */
export async function probe(info: TestInfo, page: Page | null, where: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 6).join(' | ')
    const path = page && !page.isClosed() ? await shot(page, `FAIL-${where}`) : undefined
    note(info, { kind: 'probe-failed', where, what: msg, shot: path })
    return false
  }
}

/** Ignore the noise every page has (favicon, the service worker being blocked, the HEAD auth check aborted on navigation). */
const IGNORE_URL = [/favicon/, /\/sw\.js/, /manifest\.webmanifest/]

export function watch(page: Page, info: TestInfo, label: string, opts: { allowStatus?: number[] } = {}): void {
  const allow = new Set(opts.allowStatus ?? [])
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const text = m.text()
      if (/Download the React DevTools|was preloaded using link preload|Service Worker registration blocked by Playwright/.test(text)) return
      note(info, { kind: 'console', where: `${label} ${page.url()}`, what: `[${m.type()}] ${text.slice(0, 400)}` })
    }
  })
  page.on('pageerror', e => /reading 'waiting'/.test(e.message) && page.context().serviceWorkers().length === 0 ? undefined : note(info, { kind: 'pageerror', where: `${label} ${page.url()}`, what: e.message.slice(0, 400) }))
  page.on('response', async r => {
    const s = r.status()
    if (s < 400 || allow.has(s) || IGNORE_URL.some(x => x.test(r.url()))) return
    let body = ''
    try {
      body = (await r.text()).slice(0, 300)
    } catch {
      /* gone */
    }
    note(info, { kind: 'http', where: `${label} ${page.url()}`, what: `${s} ${r.request().method()} ${decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+/, '').slice(0, 250)}`, detail: body })
  })
  const inflight = new Map<Request, number>()
  INFLIGHT.set(page, inflight)
  page.on('request', r => inflight.set(r, Date.now()))
  page.on('requestfinished', r => inflight.delete(r))
  page.on('requestfailed', r => {
    inflight.delete(r)
    const err = r.failure()?.errorText ?? ''
    if (/ERR_ABORTED/.test(err) || IGNORE_URL.some(x => x.test(r.url()))) return
    note(info, { kind: 'requestfailed', where: `${label} ${page.url()}`, what: `${err} ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 200)}` })
  })
}

const INFLIGHT = new WeakMap<Page, Map<Request, number>>()

/** Open a page in a context with watching on; returns the page and how long the screen took to settle (ms). */
export async function go(ctx: BrowserContext, info: TestInfo, path: string, label = ''): Promise<{ page: Page; ms: number }> {
  const page = await ctx.newPage()
  watch(page, info, label || path)
  const ms = await visit(page, info, path, label)
  return { page, ms }
}

/** Navigate an existing page and time it until no skeleton and the network is idle. Records > 2 s as slow. */
export async function visit(page: Page, info: TestInfo, path: string, label = ''): Promise<number> {
  const t0 = Date.now()
  await page.goto(path)
  await page.locator('#main').waitFor({ timeout: 20_000 }).catch(() => undefined)
  // What a person waits for: the heading and no skeleton. Network idle is measured separately (a poll keeps it busy).
  await page.locator('#main h1, #main h2').first().waitFor({ timeout: 15_000 }).catch(() => undefined)
  await page.locator('#main .skeleton').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined)
  const shown = Date.now() - t0
  const pending = [...(INFLIGHT.get(page)?.entries() ?? [])].filter(([, at]) => Date.now() - at > 1500).map(([r]) => `${r.method()} ${decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`)
  await settle(page)
  const ms = Date.now() - t0
  if (shown > 2000) note(info, { kind: 'slow', where: `${label} ${path}`, what: `content took ${shown} ms to show (network idle at ${ms} ms)`, detail: pending.slice(0, 6) })
  else if (ms > 4000) note(info, { kind: 'slow', where: `${label} ${path}`, what: `shown in ${shown} ms but the network stayed busy until ${ms} ms`, detail: pending.slice(0, 6) })
  return shown
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  await page
    .locator('#main .skeleton, #main [aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined)
}

/**
 * Layout problems a person would see: the page scrolls sideways, text cut off without an ellipsis (or with one, reported separately),
 * text running out of its box, overlapping lines of text, tap targets under 24 px on the phone.
 */
export async function layout(page: Page, info: TestInfo, label: string): Promise<void> {
  const res = await page
    .evaluate(() => {
      const out: { kind: string; text: string; box?: string }[] = []
      const vw = window.innerWidth
      const doc = document.scrollingElement as HTMLElement
      if (doc.scrollWidth > vw + 1) out.push({ kind: 'page-scrolls-sideways', text: `scrollWidth ${doc.scrollWidth} > ${vw}` })
      const hidden = (el: Element) => Boolean(el.closest('.sr-only, [aria-hidden="true"]'))
      const scrollsX = (el: Element) => {
        for (let a = el.parentElement; a; a = a.parentElement) {
          const o = getComputedStyle(a).overflowX
          if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth) return true
        }
        return false
      }
      const visible = (el: Element) => {
        if (hidden(el)) return false
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
      }
      const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.getAttribute('data-slot') ? `[data-slot=${el.getAttribute('data-slot')}]` : ''}.${String((el as HTMLElement).className || '').split(' ').slice(0, 3).join('.')}`
      const els = Array.from(document.querySelectorAll('#main *, header *, nav *, [role=dialog] *')).slice(0, 4000)
      for (const el of els) {
        if (!(el instanceof HTMLElement) || !visible(el)) continue
        const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1)
        if (!own) continue
        const cs = getComputedStyle(el)
        const txt = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80)
        if (el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip')) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') continue
          out.push({ kind: cs.textOverflow === 'ellipsis' ? 'text-truncated-ellipsis' : 'text-clipped', text: txt, box: describe(el) })
        }
        const r = el.getBoundingClientRect()
        if (r.right > vw + 2 && cs.position !== 'fixed' && !scrollsX(el)) out.push({ kind: 'off-screen-right', text: txt, box: `${describe(el)} right=${Math.round(r.right)}` })
      }
      // Overlapping text: leaf text boxes whose rectangles intersect by more than 3 px both ways.
      const leaves: { r: DOMRect; t: string }[] = []
      const walker = document.createTreeWalker(document.querySelector('#main') ?? document.body, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode()) && leaves.length < 600) {
        const t = (n.textContent ?? '').trim()
        if (t.length < 2 || !n.parentElement || !visible(n.parentElement)) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) if (r.width > 2 && r.height > 2) leaves.push({ r, t: t.slice(0, 40) })
      }
      for (let i = 0; i < leaves.length; i++)
        for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i].r
          const b = leaves[j].r
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (w > 3 && h > 3 && leaves[i].t !== leaves[j].t) out.push({ kind: 'text-overlap', text: `"${leaves[i].t}" overlaps "${leaves[j].t}"` })
        }
      // Small text (owner finds text too small): count visible text under 12 px.
      let small = 0
      const smallSamples: string[] = []
      for (const el of els) {
        if (!(el instanceof HTMLElement) || !visible(el)) continue
        const own = Array.from(el.childNodes).some(nn => nn.nodeType === 3 && (nn.textContent ?? '').trim().length > 1)
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) {
          small++
          if (smallSamples.length < 5) smallSamples.push(`${getComputedStyle(el).fontSize} "${(el.innerText || '').trim().slice(0, 30)}"`)
        }
      }
      if (small) out.push({ kind: 'text-under-12px', text: `${small} elements; e.g. ${smallSamples.join('; ')}` })
      // Tap targets on touch screens.
      if (matchMedia('(pointer: coarse)').matches) {
        const tiny: string[] = []
        for (const el of Array.from(document.querySelectorAll('button, a[href], [role=button], input, select'))) {
          if (!visible(el)) continue
          const r = el.getBoundingClientRect()
          if ((r.width < 24 || r.height < 24) && tiny.length < 8) tiny.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el as HTMLElement).innerText?.trim().slice(0, 20) || el.getAttribute('aria-label') || el.tagName}`)
        }
        if (tiny.length) out.push({ kind: 'tap-target-under-24px', text: tiny.join('; ') })
      }
      return out
    })
    .catch(() => [] as { kind: string; text: string; box?: string }[])
  const seen = new Set<string>()
  for (const r of res) {
    const key = `${r.kind}|${r.text}`
    if (seen.has(key)) continue
    seen.add(key)
    note(info, { kind: 'layout', where: `${label} ${page.url()}`, what: `${r.kind}: ${r.text}`, detail: r.box })
  }
}

/** A word of the alphabet only, so a tag never reads as a quantity to the parsers. */
export const tag = (n = 5): string => Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('')
