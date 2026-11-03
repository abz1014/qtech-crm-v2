import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { openAs, type Role } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'
import { collect, type Metrics } from './collect'
import { seedAudit, type Fixture } from './seed'
import { VISITS, bounded, type CaptureOptions, type Visit } from './screens'

/*
 * The screen audit (docs/audit/SCREEN_AUDIT.md): every main screen and key state, for each role, at each viewport, measured in
 * the real built app on the local CI stack with realistic data (./seed.ts). For each screen x viewport it saves an above-the-fold
 * PNG, a full-page JPEG, the DOM metrics (./collect.ts) and the axe-core violations, into AUDIT_DIR (default test-results/screen-audit, which git ignores; CI uses audit-out):
 *
 *   audit-out/parts/<roles>-<pid>.json                 the captures of this run (scripts/audit/report.mjs merges the parts)
 *   audit-out/shots/<role>/<screen>/<viewport>-fold.png
 *   audit-out/shots/<role>/<screen>/<viewport>-full.jpg
 *
 * It measures; it never fails on a finding. A screen that cannot be reached or driven is recorded with status "error" (and an
 * <viewport>-error.png) and the run goes on. Only a failed seed fails the run.
 *
 * Environment: AUDIT_ROLES ("admin sales engineer"), AUDIT_VIEWPORTS ("1366x768 1920x1080 375x812 320x640"), AUDIT_SCREENS (a
 * regex over visit and screen ids), AUDIT_AXE=0 and AUDIT_FULL=0 to skip axe or the full-page shots, AUDIT_REF and AUDIT_SHA (what
 * is being audited, written into the results).
 */

const OUT = resolve(process.env.AUDIT_DIR || 'test-results/screen-audit')
const ROLES = (process.env.AUDIT_ROLES || 'admin sales engineer').split(/[\s,]+/).filter(Boolean) as Role[]
const VIEWPORTS = (process.env.AUDIT_VIEWPORTS || '1366x768 1920x1080 375x812 320x640')
  .split(/[\s,]+/)
  .filter(Boolean)
  .map(name => {
    const [width, height] = name.split('x').map(Number)
    return { name, width, height }
  })
type Viewport = (typeof VIEWPORTS)[number]
const ONLY = process.env.AUDIT_SCREENS ? new RegExp(process.env.AUDIT_SCREENS) : null
const AXE = process.env.AUDIT_AXE !== '0'
const FULL = process.env.AUDIT_FULL !== '0'
const MAX_FULL_HEIGHT = 15_000
/** How long one visit may take at one viewport, per screen it captures (axe and the full-page shot included). */
const VISIT_BUDGET_PER_SCREEN = 100_000

export interface AxeSummary {
  rules: number
  nodes: number
  byImpact: Record<string, number>
  byRule: Record<string, number>
  sample: string[]
}
export interface CaptureRecord {
  role: Role
  screen: string
  visit: string
  title: string
  viewport: string
  status: Metrics['status'] | 'error'
  error?: string
  ms: number
  metrics?: Metrics
  axe?: AxeSummary
  shots: { fold?: string; full?: string; error?: string }
}

const records: CaptureRecord[] = []
const startedAt = new Date().toISOString()
let fx: Fixture
// One file per worker process: a worker restarted after a timeout writes its own file, and the report keeps the newest capture.
const partFile = join(OUT, 'parts', `${ROLES.join('-')}-${process.pid}.json`)

function flush(): void {
  mkdirSync(join(OUT, 'parts'), { recursive: true })
  writeFileSync(
    partFile,
    JSON.stringify(
      {
        meta: {
          ref: process.env.AUDIT_REF ?? '',
          sha: process.env.AUDIT_SHA ?? '',
          roles: ROLES,
          viewports: VIEWPORTS.map(v => v.name),
          screens: ONLY?.source ?? null,
          axe: AXE,
          startedAt,
          finishedAt: new Date().toISOString(),
        },
        captures: records,
      },
      null,
      1,
    ),
  )
}

const rel = (p: string) => relative(OUT, p).split(sep).join('/')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 400)

function summariseAxe(lines: string[]): AxeSummary {
  const byRule: Record<string, number> = {}
  const byImpact: Record<string, number> = {}
  for (const l of lines) {
    const m = /^([\w-]+) \(([^)]*)\)/.exec(l)
    const rule = m?.[1] ?? 'unknown'
    const impact = m?.[2] ?? 'unknown'
    byRule[rule] = (byRule[rule] ?? 0) + 1
    byImpact[impact] = (byImpact[impact] ?? 0) + 1
  }
  return { rules: Object.keys(byRule).length, nodes: lines.length, byImpact, byRule, sample: lines.slice(0, 5).map(l => l.slice(0, 300)) }
}

// ---------------------------------------------------------------- one signed-in page per role and viewport

const pages = new Map<string, { context: BrowserContext; page: Page }>()

async function pageFor(browser: Browser, info: TestInfo, role: Role, vp: Viewport): Promise<Page> {
  const key = `${role} ${vp.name}`
  const hit = pages.get(key)
  if (hit && !hit.page.isClosed()) return hit.page
  const phone = vp.width < 768
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    // A phone is a touch device: pointer: coarse applies, as on a real phone.
    isMobile: phone,
    hasTouch: phone,
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    // New RFQ copies the message to the clipboard.
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  // Its own sign-in through the login form, so no two contexts share (and rotate) one refresh token.
  await openAs(page, role, '/todo')
  // No click, fill or wait may hang a visit: without this, an action on an element that never shows waits for the whole test timeout.
  page.setDefaultTimeout(20_000)
  page.setDefaultNavigationTimeout(30_000)
  pages.set(key, { context, page })
  return page
}

async function dropPage(role: Role, vp: Viewport): Promise<void> {
  const key = `${role} ${vp.name}`
  const hit = pages.get(key)
  pages.delete(key)
  await hit?.context.close().catch(() => undefined)
}

// ---------------------------------------------------------------- one capture

async function fullShot(page: Page, vp: Viewport, path: string, root: string | null): Promise<void> {
  const height = await page.evaluate(sel => {
    // A dialog: the viewport grows by what its tallest inner scroller hides, so the whole dialog is in the picture.
    const dialog = sel ? document.querySelector<HTMLElement>(sel) : null
    if (dialog) {
      let hidden = 0
      for (const el of [dialog, ...Array.from(dialog.querySelectorAll<HTMLElement>('*'))]) {
        const oy = getComputedStyle(el).overflowY
        if (oy === 'auto' || oy === 'scroll') hidden = Math.max(hidden, el.scrollHeight - el.clientHeight)
      }
      return window.innerHeight + hidden
    }
    const main = document.querySelector<HTMLElement>('#main')
    main?.scrollTo(0, 0)
    const se = document.scrollingElement ?? document.documentElement
    return Math.max(se.scrollHeight, main ? main.scrollHeight + (window.innerHeight - main.clientHeight) : 0)
  }, root)
  const tall = Math.min(Math.max(height, vp.height), MAX_FULL_HEIGHT)
  // The app scrolls <main>, not the document: the page is made as tall as its content, photographed, and put back.
  if (tall > vp.height + 1) {
    await page.setViewportSize({ width: vp.width, height: tall })
    await page.waitForTimeout(300)
    await waitForAnimationsToFinish(page)
  }
  try {
    await page.screenshot({ path, fullPage: true, type: 'jpeg', quality: 70, animations: 'disabled', caret: 'hide' })
  } finally {
    if (tall > vp.height + 1) await page.setViewportSize({ width: vp.width, height: vp.height })
  }
}

async function captureOne(page: Page, role: Role, visit: Visit, screen: string, vp: Viewport, opts: CaptureOptions = {}): Promise<CaptureRecord> {
  const t0 = Date.now()
  const base = { role, screen, visit: visit.id, title: visit.title, viewport: vp.name }
  const dir = join(OUT, 'shots', role, screen)
  mkdirSync(dir, { recursive: true })
  try {
    await waitForAnimationsToFinish(page)
    await page.evaluate(sel => {
      const main = document.querySelector<HTMLElement>('#main')
      main?.scrollTo(0, 0)
      window.scrollTo(0, 0)
      const el = sel ? document.querySelector(sel) : null
      const target = el?.closest('section, article, [role="region"]') ?? el
      // Scroll <main> only: scrollIntoView would also move the document and push the top bar off the screen.
      if (main && target) main.scrollTop = target.getBoundingClientRect().top - main.getBoundingClientRect().top - 8
    }, opts.scrollTo ?? null)
    if (opts.root) await page.locator(opts.root).first().waitFor({ timeout: 10_000 })
    const metrics = await page.evaluate(collect, { phone: vp.width < 768, root: opts.root ?? null })
    const fold = join(dir, `${vp.name}-fold.png`)
    await page.screenshot({ path: fold, animations: 'disabled', caret: 'hide' })
    const axe = AXE ? summariseAxe(await axeViolations(page)) : undefined
    let full: string | undefined
    if (FULL) {
      full = join(dir, `${vp.name}-full.jpg`)
      await fullShot(page, vp, full, opts.root ?? null)
    }
    return { ...base, status: metrics.status, ms: Date.now() - t0, metrics, axe, shots: { fold: rel(fold), full: full ? rel(full) : undefined } }
  } catch (e) {
    return { ...base, status: 'error', error: message(e), ms: Date.now() - t0, shots: {} }
  }
}

// ---------------------------------------------------------------- the run

test.beforeAll(async () => {
  test.setTimeout(300_000)
  fx = await seedAudit(join(OUT, 'seed.json'))
})

test.afterAll(async () => {
  flush()
  for (const { context } of pages.values()) await context.close().catch(() => undefined)
  pages.clear()
})

for (const role of ROLES) {
  test.describe(role, () => {
    const visits = VISITS.filter(v => v.roles.includes(role) && (!ONLY || ONLY.test(v.id) || v.screens.some(s => ONLY.test(s))))
    for (const visit of visits) {
      test(`${role} ${visit.id}`, async ({ browser }, info) => {
        test.setTimeout(VIEWPORTS.length * visit.screens.length * 120_000 + 60_000)
        for (const vp of VIEWPORTS) {
          const done = new Set<string>()
          let page: Page | undefined
          try {
            page = await pageFor(browser, info, role, vp)
            const current = page
            let late = false
            // A backstop: a visit that is still going after its budget is recorded as an error and its page replaced (below).
            await bounded(visit.screens.length * VISIT_BUDGET_PER_SCREEN, `${visit.id} at ${vp.name}`, () =>
              visit.run(current, fx, async (screen, opts) => {
                if (late) throw new Error('visit timed out')
                done.add(screen)
                const record = await captureOne(current, role, visit, screen, vp, opts)
                if (!late) records.push(record)
              }),
            ).catch(e => {
              late = true
              throw e
            })
          } catch (e) {
            let shot: string | undefined
            if (page && !page.isClosed()) {
              const path = join(OUT, 'shots', role, visit.id, `${vp.name}-error.png`)
              mkdirSync(join(OUT, 'shots', role, visit.id), { recursive: true })
              shot = await page
                .screenshot({ path })
                .then(() => rel(path))
                .catch(() => undefined)
            }
            for (const screen of visit.screens.filter(s => !done.has(s))) {
              records.push({ role, screen, visit: visit.id, title: visit.title, viewport: vp.name, status: 'error', error: message(e), ms: 0, shots: { error: shot } })
            }
            // Start the next visit from a fresh, signed-in page.
            await dropPage(role, vp)
          }
          flush()
        }
      })
    }
  })
}
