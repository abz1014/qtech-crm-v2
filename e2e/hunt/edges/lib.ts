import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { openAs, type Role } from '../../support/stack'

/*
 * Exploratory bug hunt (hunt/edges, round 1): screens, inputs and edge cases. Runs on the CI-local Supabase stack only
 * (API_URL from `supabase status`), with the seed's fixture users and fictional records it makes itself. It RECORDS what it
 * sees (console errors, unhandled rejections, 4xx/5xx, sideways scroll, cut-off controls, small text and targets) into
 * review-shots/hunt-edges/findings.jsonl plus a screenshot per stop; the confirmed bugs are pinned as test.fail('HE-n').
 */
export const OUT = join(process.env.REVIEW_DIR ?? join(tmpdir(), 'hunt-review'), 'hunt-edges')
mkdirSync(OUT, { recursive: true })

export interface Viewport {
  key: string
  width: number
  height: number
  scale: number
}
/** 200% browser zoom on a 1920x1080 screen is a 960x540 CSS viewport at device scale 2. */
export const VIEWPORTS: readonly Viewport[] = [
  { key: 'w1920', width: 1920, height: 1080, scale: 1 },
  { key: 'w1366', width: 1366, height: 768, scale: 1 },
  { key: 'w768', width: 768, height: 1024, scale: 1 },
  { key: 'w375', width: 375, height: 812, scale: 1 },
  { key: 'w320', width: 320, height: 640, scale: 1 },
  { key: 'z200', width: 960, height: 540, scale: 2 },
]
export const vp = (key: string): Viewport => VIEWPORTS.find(v => v.key === key) as Viewport

const STATE_DIR = join(tmpdir(), 'qtech-hunt-edges')

async function stateFor(browser: Browser, info: TestInfo, role: Role): Promise<string> {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = join(STATE_DIR, `${role}-${process.pid}.json`)
  if (existsSync(path)) return path
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  await openAs(page, role, '/todo')
  await context.storageState({ path })
  await context.close()
  return path
}

export async function contextAs(browser: Browser, info: TestInfo, role: Role, v: Viewport, extra: Record<string, unknown> = {}): Promise<BrowserContext> {
  const storageState = await stateFor(browser, info, role)
  const phone = v.width < 768
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    storageState,
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.scale,
    isMobile: phone,
    hasTouch: phone,
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    permissions: ['clipboard-read', 'clipboard-write'],
    ...extra,
  })
  // A control that never becomes clickable must not hold the whole exploration until the test timeout.
  context.setDefaultTimeout(10_000)
  context.setDefaultNavigationTimeout(30_000)
  return context
}

export interface Finding {
  kind: string
  role?: string
  vp?: string
  path?: string
  detail: string
}

const FINDINGS = join(OUT, 'findings.jsonl')
export function note(f: Finding): void {
  appendFileSync(FINDINGS, `${JSON.stringify(f)}\n`)
}

/** Console errors, page errors, failed and 4xx/5xx answers, all tagged with where the page was at the time. */
export class Watcher {
  private where: { role?: string; vp?: string; path?: string } = {}
  readonly seen: Finding[] = []
  constructor(page: Page, base: { role?: string; vp?: string }) {
    this.where = { ...base }
    page.on('console', m => {
      if (m.type() === 'error') this.add('console', m.text().slice(0, 400))
    })
    page.on('pageerror', e => this.add('pageerror', `${e.name}: ${e.message}`.slice(0, 400)))
    page.on('response', r => {
      if (r.status() >= 400) this.add(`http${r.status()}`, `${r.request().method()} ${safeDecode(r.url()).replace(/^https?:\/\/[^/]+/, '').slice(0, 300)}`)
    })
    page.on('requestfailed', r => {
      const why = r.failure()?.errorText ?? ''
      if (!/ERR_ABORTED/.test(why)) this.add('requestfailed', `${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 200)} ${why}`)
    })
  }
  at(path: string): void {
    this.where.path = path
  }
  add(kind: string, detail: string): void {
    const f = { kind, ...this.where, detail }
    this.seen.push(f)
    note(f)
  }
}

function safeDecode(u: string): string {
  try {
    return decodeURIComponent(u)
  } catch {
    return u
  }
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}

export interface Layout {
  vw: number
  scrollW: number
  offenders: string[]
  clipped: string[]
  smallText: string[]
  smallTargets: string[]
  offscreenDialog: string[]
}

/** Measures the page as a person would notice it: sideways scroll, things past the right edge, cut-off labels, tiny text/targets. */
export async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const desc = (el: Element) => {
      const id = el.id ? `#${el.id}` : ''
      const lab = el.getAttribute('aria-label') ?? ''
      const t = ((el as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)
      return `${el.tagName.toLowerCase()}${id}${lab ? `[${lab.slice(0, 40)}]` : ''} "${t}"`
    }
    const clipsX = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true
      }
      return false
    }
    const offenders: string[] = []
    const clipped: string[] = []
    const smallText: string[] = []
    const smallTargets: string[] = []
    const offscreenDialog: string[] = []
    const all = Array.from(document.querySelectorAll('body *'))
    const flagged = new Set<Element>()
    for (const el of all) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
      if (el.closest('[aria-hidden="true"], .sr-only')) continue
      if ((r.right > vw + 1 || r.left < -1) && !clipsX(el) && cs.position !== 'fixed' && !(el.parentElement && flagged.has(el.parentElement))) {
        flagged.add(el)
        if (offenders.length < 8) offenders.push(`${desc(el)} x=${Math.round(r.left)}..${Math.round(r.right)}`)
      }
      const ownText = Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1)
      if (ownText) {
        const fs = parseFloat(cs.fontSize)
        if (fs < 12 && smallText.length < 6) smallText.push(`${fs}px ${desc(el)}`)
        if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && clipped.length < 6) clipped.push(desc(el))
      }
      if (vw < 768 && el.matches('button, a[href], [role="button"], input, select, [role="tab"], [role="menuitem"]') && !el.closest('p, li > span')) {
        if ((r.height < 24 || r.width < 24) && smallTargets.length < 6) smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${desc(el)}`)
      }
    }
    for (const d of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'))) {
      const r = d.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || (r.bottom > vh + 1 && getComputedStyle(d).overflowY === 'visible')) offscreenDialog.push(`${desc(d)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${vw}x${vh}`)
    }
    return { vw, scrollW: document.documentElement.scrollWidth, offenders, clipped, smallText, smallTargets, offscreenDialog }
  })
}

export function recordLayout(w: Watcher, l: Layout, where: string): void {
  if (l.scrollW > l.vw + 1) w.add('sideways-scroll', `${where}: page is ${l.scrollW}px wide in a ${l.vw}px viewport; ${l.offenders.slice(0, 3).join(' | ')}`)
  else if (l.offenders.length) w.add('past-edge', `${where}: ${l.offenders.slice(0, 3).join(' | ')}`)
  if (l.clipped.length) w.add('clipped', `${where}: ${l.clipped.join(' | ')}`)
  if (l.smallText.length) w.add('small-text', `${where}: ${l.smallText.slice(0, 3).join(' | ')}`)
  if (l.smallTargets.length) w.add('small-target', `${where}: ${l.smallTargets.slice(0, 4).join(' | ')}`)
  if (l.offscreenDialog.length) w.add('overlay-offscreen', `${where}: ${l.offscreenDialog.join(' | ')}`)
}

let shotCount = 0
/** Screenshot file names carry a running number: names that differ only in letter case would collide on Windows and macOS. */
export function shotName(...parts: string[]): string {
  shotCount += 1
  const base = parts
    .join('_')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 140)
  return `${base}_${process.pid}-${shotCount}`
}

export async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: join(OUT, `${shotName(name)}.png`), fullPage, timeout: 10_000 }).catch(() => undefined)
}
