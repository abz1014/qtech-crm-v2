import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * P04 on the production build, against the local CI stack, as the admin (who can open every screen).
 *
 *  1. Accessibility: the REAL Lighthouse accessibility category (lighthouse@12, installed by the workflow, not a dependency) on the
 *     seven main screens, desktop and phone. Lighthouse cannot sign in, so Playwright signs in first in a persistent profile that has
 *     the remote-debugging port open; Lighthouse then attaches to that browser (its new tab shares the profile, so it is signed in)
 *     and keeps storage (`disableStorageReset`). Every screen must score >= 95. The other e2e suites keep running axe (WCAG 2.2 AA) too.
 *  2. Content-Security-Policy: this suite runs with E2E_CSP=1 (the preview server sends vercel.json's real policy, Supabase origin swapped
 *     for the local stack). No `securitypolicyviolation` may fire while the screens load. PDFs, the share target and storage images are
 *     covered by the quotation, orders, capture and pwa suites, which run under the same policy.
 *  3. Request shape: on Today and the RFQ page no data request is made twice, and the request waves are reported.
 */
const PORT = 9333
/** The suite's server and Supabase proxy use a throwaway self-signed certificate (scripts/ci/e2e-run.sh); Lighthouse's tab must accept it too. */
const TLS_ARGS = ['--ignore-certificate-errors']
const MIN_SCORE = 95
const summary = (md: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
  console.log(md)
}

interface Seed {
  rfqId: string
  orderId: string
}

async function seed(): Promise<Seed> {
  const customer = await createCompany(uniqueName('Perf Customer'))
  const [rfq] = await must(rest<{ id: string }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: customer.id, due_on: karachiDay(7), customer_ref: 'PERF-1' } }))
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 2 }, prefer: 'return=minimal' }))
  const [order] = await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id, payment_terms_days: 30, ordered_on: karachiDay(-3) } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Pressure transmitter', qty: 3, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  await must(
    rest('admin', 'invoices', {
      method: 'POST',
      body: { order_id: order.id, number: `PERF-${Math.random().toString(36).slice(2, 8)}`, invoice_date: karachiDay(-1), net_amount: 300000, gst_amount: 54000 },
      prefer: 'return=minimal',
    }),
  )
  return { rfqId: rfq.id, orderId: order.id }
}

const screens = (s: Seed): Array<[string, string]> => [
  ['Today', '/today'],
  ['RFQ board', '/rfqs'],
  ['RFQ detail', `/rfqs/${s.rfqId}`],
  ['Order detail', `/orders/${s.orderId}`],
  ['Money: GST register', '/money/gst-register'],
  ['Money: Month-end', '/money/month-end/bank'],
  ['Settings', '/settings'],
]

interface Audit {
  score: number | null
  scoreDisplayMode: string
  details?: { items?: Array<{ node?: { selector?: string; snippet?: string } }> }
}
type Lighthouse = (url: string, flags: Record<string, unknown>) => Promise<{ lhr: { categories: { accessibility: { score: number | null } }; audits: Record<string, Audit> } } | undefined>

test.describe.configure({ mode: 'serial' })

test('Lighthouse accessibility is at least 95 on the main screens (desktop and phone)', async ({ baseURL }) => {
  test.setTimeout(900_000)
  const s = await seed()
  const profile = mkdtempSync(join(tmpdir(), 'p04-profile-'))
  const ctx = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`, ...TLS_ARGS], ignoreHTTPSErrors: true, baseURL, viewport: { width: 1440, height: 900 } })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await openAs(page, 'admin', '/today')
    const pkg = 'lighthouse'
    const lighthouse = ((await import(/* @vite-ignore */ pkg)) as { default: Lighthouse }).default
    const rows: string[] = ['### Lighthouse accessibility (P04)', '', '| Screen | Desktop | Phone |', '|---|---|---|']
    const failures: string[] = []
    const notes: string[] = []
    const out: Record<string, unknown> = {}
    for (const [name, path] of screens(s)) {
      const cells: number[] = []
      for (const form of ['desktop', 'mobile'] as const) {
        const flags: Record<string, unknown> = {
          port: PORT,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['accessibility'],
          disableStorageReset: true,
          throttlingMethod: 'provided',
          formFactor: form,
          screenEmulation:
            form === 'desktop'
              ? { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false }
              : { mobile: true, width: 375, height: 812, deviceScaleFactor: 2, disabled: false },
          pauseAfterLoadMs: 2500,
          networkQuietThresholdMs: 1500,
        }
        const run = await lighthouse(`${baseURL}${path}`, flags)
        const lhr = run?.lhr
        const score = Math.round((lhr?.categories.accessibility.score ?? 0) * 100)
        cells.push(score)
        out[`${name} (${form})`] = score
        if (score < 100 && lhr) {
          const bad = Object.entries(lhr.audits)
            .filter(([, a]) => a.scoreDisplayMode === 'binary' && a.score === 0)
            .map(([id, a]) => `${id}: ${(a.details?.items ?? []).slice(0, 4).map(i => i.node?.selector ?? i.node?.snippet ?? '').join(' | ')}`)
          const line = `${name} (${form}) scored ${score}: ${bad.join('; ')}`
          notes.push(line)
          if (score < MIN_SCORE) failures.push(line)
        }
      }
      rows.push(`| ${name} | ${cells[0]} | ${cells[1]} |`)
    }
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/lighthouse-a11y.json', JSON.stringify(out, null, 2))
    summary([...rows, '', ...notes.map(n => `- ${n}`)].join('\n'))
    expect(failures, failures.join('\n')).toEqual([])
  } finally {
    await ctx.close()
  }
})

/*
 * Speed on a phone over mobile data (rubric "Speed of everyday jobs": screens open fast on a phone). The REAL Lighthouse performance
 * category on the production build, mobile form factor with its default simulated Slow 4G and 4x CPU slowdown (Lighthouse's own
 * "mobile" preset: 150 ms RTT, 1.6 Mbps), signed in as the admin, one cold load per main screen: the HTTP cache, the service
 * worker and Cache Storage are cleared before each run (storage reset stays off so the session survives). LCP must be at most
 * 2.5 s on every screen; LCP, FCP, TBT and the transferred JS are reported per screen (PERF-LCP-1, fixed on perf/lcp).
 *
 * Served as production serves it (scripts/ci/e2e-run.sh): the app over HTTPS and HTTP/2 with compression and vercel.json's
 * headers (as Vercel), and the stack behind an HTTPS, HTTP/2 proxy (as Supabase's edge). Lighthouse's simulation models HTTP/1.1
 * as six connections per origin, each with its own handshake, and HTTP/2 as one, so plain HTTP/1.1 measured something production
 * never does.
 */
const MAX_LCP_MS = 2500

type PerfRun = { lhr: { categories: { performance: { score: number | null } }; audits: Record<string, { numericValue?: number; details?: { items?: Array<{ resourceType?: string; transferSize?: number }> } }> } } | undefined

test('Lighthouse mobile (Slow 4G): every main screen paints its largest content within 2.5 s', async ({ baseURL }) => {
  test.setTimeout(900_000)
  const s = await seed()
  const profile = mkdtempSync(join(tmpdir(), 'perf-profile-'))
  const ctx = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`, ...TLS_ARGS], ignoreHTTPSErrors: true, baseURL, viewport: { width: 412, height: 823 } })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await openAs(page, 'admin', '/today')
    const cdp = await ctx.newCDPSession(page)
    const origin = new URL(baseURL!).origin
    const pkg = 'lighthouse'
    const lighthouse = ((await import(/* @vite-ignore */ pkg)) as { default: (url: string, flags: Record<string, unknown>) => Promise<PerfRun> }).default
    const targets: Array<[string, string]> = [
      ['Today', '/today'],
      ['RFQ list', '/rfqs'],
      ['RFQ page', `/rfqs/${s.rfqId}`],
      ['Orders list', '/orders'],
      ['Order page', `/orders/${s.orderId}`],
      ['Who owes us', '/money/receivables'],
      ['Companies', '/companies'],
    ]
    const rows = ['### Lighthouse mobile, simulated Slow 4G (rubric: LCP at most 2.5 s)', '', '| Screen | Score | FCP | LCP | TBT | JS transferred |', '|---|---|---|---|---|---|']
    const out: Record<string, unknown> = {}
    const slow: string[] = []
    const ms = (v?: number) => (v === undefined ? '-' : `${(v / 1000).toFixed(2)} s`)
    for (const [name, path] of targets) {
      await cdp.send('Network.clearBrowserCache')
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'service_workers,cache_storage' })
      const run = await lighthouse(`${baseURL}${path}`, {
        port: PORT,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        disableStorageReset: true,
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
      })
      // The whole report per screen (open it in https://googlechrome.github.io/lighthouse/viewer/): the request chain and the
      // LCP element and its phases say what to fix.
      mkdirSync('test-results/lighthouse', { recursive: true })
      writeFileSync(`test-results/lighthouse/${name.replaceAll(' ', '-').toLowerCase()}.json`, JSON.stringify(run?.lhr ?? null))
      const a = run?.lhr.audits ?? {}
      const lcp = a['largest-contentful-paint']?.numericValue
      const fcp = a['first-contentful-paint']?.numericValue
      const tbt = a['total-blocking-time']?.numericValue
      const js = (a['network-requests']?.details?.items ?? []).filter(i => i.resourceType === 'Script').reduce((n, i) => n + (i.transferSize ?? 0), 0)
      const score = Math.round((run?.lhr.categories.performance.score ?? 0) * 100)
      out[name] = { score, fcpMs: fcp, lcpMs: lcp, tbtMs: tbt, jsTransferBytes: js }
      rows.push(`| ${name} | ${score} | ${ms(fcp)} | ${ms(lcp)} | ${tbt === undefined ? '-' : `${Math.round(tbt)} ms`} | ${Math.round(js / 1024)} KB |`)
      if (lcp === undefined || lcp > MAX_LCP_MS) slow.push(`${name}: LCP ${ms(lcp)}`)
    }
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/lighthouse-perf.json', JSON.stringify(out, null, 2))
    summary(rows.join('\n'))
    expect(slow, slow.join('\n')).toEqual([])
  } finally {
    await ctx.close()
  }
})

/** Data requests the app made to the stack, with the time each started and ended (ms since the trace began). */
function trace(page: Page) {
  const log: Array<{ key: string; start: number; end: number }> = []
  const open = new Map<string, number>()
  const t0 = Date.now()
  const idOf = (r: { url: () => string; method: () => string; postData: () => string | null }) => `${r.method()} ${r.url()} ${r.postData() ?? ''}`
  const isData = (url: string) => {
    const p = new URL(url).pathname
    return p.startsWith('/rest/v1/') || p.startsWith('/functions/v1/')
  }
  page.on('request', r => {
    if (isData(r.url())) open.set(idOf(r), Date.now() - t0)
  })
  page.on('requestfinished', r => {
    const start = open.get(idOf(r))
    if (start === undefined) return
    const u = new URL(r.url())
    log.push({ key: `${r.method()} ${u.pathname}${u.search.slice(0, 100)}`, start, end: Date.now() - t0 })
    open.delete(idOf(r))
  })
  return log
}

/** Waves: a request that starts only after every earlier one has finished begins a new wave (a waterfall has many). */
function waves(log: Array<{ start: number; end: number }>): number {
  const sorted = [...log].sort((a, b) => a.start - b.start)
  let n = 0
  let reach = -1
  for (const r of sorted) {
    if (r.start >= reach) n++
    reach = Math.max(reach, r.end)
  }
  return n
}

test('the production CSP is never violated, and Today and the RFQ page make no repeated data request', async ({ page, baseURL }) => {
  test.setTimeout(300_000)
  expect(process.env.E2E_CSP, 'run this suite with E2E_CSP=1 so the preview server sends the production policy').toBeTruthy()
  const s = await seed()
  const violations: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`CSPVIOLATION ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`))
  })
  page.on('console', m => {
    if (m.text().startsWith('CSPVIOLATION') || /Content[ -]Security[ -]Policy/i.test(m.text())) violations.push(m.text())
  })
  // The policy must really be on the page, or the test proves nothing.
  const res = await page.request.get(`${baseURL}/login`)
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'")
  expect(res.headers()['content-security-policy']).not.toMatch(/'unsafe-eval'/)

  await openAs(page, 'admin', '/today')
  const lines: string[] = ['### Request shape (P04)', '', '| Page | Data requests | Waves | Repeated |', '|---|---|---|---|']
  const repeated: string[] = []
  for (const [name, path] of screens(s)) {
    // Leave the previous page first, so a late request of the old document is not counted against this one.
    await page.goto('about:blank')
    const log = trace(page)
    await page.goto(path)
    await page.locator('#main').waitFor()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const seen = new Map<string, number>()
    // The session check (src/app/AuthProvider.tsx) re-reads the signed-in person's own users row once soon after the first data request,
    // by design, so a deactivated person is signed out on their next request. It is not a waterfall and is left out of the count.
    const isSessionCheck = (k: string) => k.startsWith('GET /rest/v1/users?select=id%2Cname&id=eq.')
    for (const r of log) if (r.key.startsWith('GET') && !isSessionCheck(r.key)) seen.set(r.key, (seen.get(r.key) ?? 0) + 1)
    const dup = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`)
    lines.push(`| ${name} | ${log.length} | ${waves(log)} | ${dup.length} |`)
    if (name === 'Today' || name === 'RFQ detail') repeated.push(...dup.map(d => `${name}: ${d}`))
    page.removeAllListeners('request')
    page.removeAllListeners('requestfinished')
  }
  summary(lines.join('\n'))
  expect(violations, violations.join('\n')).toEqual([])
  expect(repeated, repeated.join('\n')).toEqual([])
})
