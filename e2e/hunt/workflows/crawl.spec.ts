import { test, type Page } from '@playwright/test'
import { karachiDay } from '../../support/stack'
import { company, invoice, order, payment, quote, quotedRfq, rfq, setProfile, setRates, supplier } from '../../verify/support/fixtures'
import { MONEY_PATHS } from '../../verify/support/session'
import { ctxAs, layout, note, probe, settle, shot, tag, visit, watch, type Viewport } from './support'
import type { Role } from '../../support/stack'

/*
 * The crawl: every screen as every role at 1366x768 and 375x812 (touch). Records slow screens (> 2 s), console errors, 4xx/5xx,
 * layout problems (sideways scroll, cut-off and overlapping text, small text and tap targets), wrong role access (a screen a role
 * should not reach that renders, or one it should reach that refuses), money requests made by the engineer, and internal links that
 * lead to "Page not found". Screenshots of every screen go into the review folder.
 */

type Ids = { rfq: string; quotedRfq: string; order: string; customer: string; supplier: string }
let ids: Ids

test.beforeAll(async () => {
  await setProfile(true)
  await setRates()
  const cust = await company('Hunt Crawl Customer', { city: 'Lahore' })
  const sup = await supplier('Hunt Crawl Supplier GmbH', 'Germany')
  const r = await rfq({ customer: cust, items: [{ description: `Hunt pressure gauge ${tag()} 0-10 bar`, qty: 4 }, { description: `Hunt flow switch ${tag()}`, qty: 2 }] })
  await quote(r.rfq.id, sup, [{ itemId: r.items[0].id, price: 120 }, { itemId: r.items[1].id, price: 80 }], 'EUR')
  const q = await quotedRfq({ items: [{ description: `Hunt valve ${tag()}`, qty: 3, price: 50000, supplierPrice: 40000 }] })
  const o = await order({
    customer: cust,
    suppliers: [{ supplier: sup, currency: 'EUR' }],
    lines: [
      { description: `Hunt transmitter with an unusually long description to see how long names wrap on the order page ${tag()}`, qty: 2, price: 125000, leg: 0, supplierPrice: 300 },
      { description: `Hunt commissioning service ${tag()}`, qty: 1, price: 40000, service: true, gst: 0 },
    ],
    needsCommissioning: true,
  })
  await invoice(o.order.id, 290000, 45000)
  await payment(o.order.id, 100000)
  ids = { rfq: r.rfq.id, quotedRfq: q.rfq.id, order: o.order.id, customer: cust.id, supplier: sup.id }
})

/** Who may open what. 'all' = every role; otherwise the roles that should see the screen (others should get no access). */
function routes(): { path: string; who: Role[] }[] {
  const all: Role[] = ['admin', 'sales', 'engineer']
  const as: Role[] = ['admin', 'sales']
  const a: Role[] = ['admin']
  return [
    { path: '/todo', who: all },
    { path: '/rfqs', who: all },
    { path: '/rfqs/new', who: all },
    { path: `/rfqs/${ids.rfq}`, who: all },
    { path: `/rfqs/${ids.quotedRfq}`, who: all },
    { path: '/orders', who: all },
    { path: '/orders?owner=all', who: all },
    { path: `/orders/${ids.order}`, who: all },
    { path: '/companies', who: all },
    { path: `/companies/${ids.customer}`, who: all },
    { path: `/companies/${ids.supplier}`, who: all },
    { path: '/money/receivables', who: as },
    { path: '/money/gst-register', who: as },
    { path: '/money/expenses', who: a },
    { path: '/money/month-end', who: a },
    { path: '/money/month-end/bank', who: a },
    { path: '/money/margins', who: a },
    { path: '/money/exceptions', who: a },
    { path: '/money/reports', who: as },
    ...['pnl', 'categories', 'aging', 'owe', 'gst', 'team', 'margins', 'in-out'].map(k => ({ path: `/money/reports/${k}`, who: a })),
    { path: '/reports', who: as },
    { path: '/settings', who: all },
    { path: '/settings/team', who: a },
    { path: '/settings/targets', who: a },
    { path: '/settings/categories', who: a },
    { path: '/settings/backups', who: a },
    { path: '/settings/company', who: all },
    { path: '/settings/details', who: all },
    { path: '/settings/exchange-rates', who: all },
    { path: '/settings/password', who: all },
    { path: '/capture', who: all },
  ]
}

async function refused(page: Page): Promise<boolean> {
  const t = await page.locator('#main').innerText().catch(() => '')
  return /\bis for (admins|sales|engineers)|has no access yet/i.test(t) || (await page.locator('h1', { hasText: /is for (admins|sales|engineers)/ }).count()) > 0
}

const links = new Map<string, string>()

for (const role of ['admin', 'sales', 'engineer'] as Role[])
  for (const vp of ['desktop', 'phone'] as Viewport[])
    test(`crawl: every screen as ${role} at ${vp}`, async ({ browser }, info) => {
      const ctx = await ctxAs(browser, info, role, vp)
      const page = await ctx.newPage()
      watch(page, info, `${role}/${vp}`, { allowStatus: [] })
      const money: string[] = []
      page.on('request', r => {
        if (role === 'engineer' && MONEY_PATHS.some(p => r.url().includes(p))) money.push(`${page.url()} -> ${decodeURIComponent(r.url()).slice(0, 200)}`)
      })
      for (const r of routes()) {
        await probe(info, page, `${role}/${vp} ${r.path}`, async () => {
          const ms = await visit(page, info, r.path, `${role}/${vp}`)
          const should = r.who.includes(role)
          const isRefused = await refused(page)
          const notFound = (await page.getByRole('heading', { name: 'Page not found' }).count()) > 0
          if (notFound) note(info, { kind: 'access', where: `${role}/${vp} ${r.path}`, what: 'Page not found' })
          else if (should && isRefused) note(info, { kind: 'access', where: `${role}/${vp} ${r.path}`, what: 'refused but the role should reach it' })
          else if (!should && !isRefused && !page.url().includes('/no-access'))
            note(info, { kind: 'access', where: `${role}/${vp} ${r.path}`, what: `NOT refused (role should not reach it); landed on ${page.url()}` })
          await layout(page, info, `${role}/${vp}`)
          await shot(page, `${role}-${vp}-${r.path}`, vp === 'phone')
          if (vp === 'desktop')
            for (const href of await page.locator('#main a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href') ?? '')))
              if (!links.has(href)) links.set(href, `${role} ${r.path}`)
          return ms
        })
      }
      if (money.length) note(info, { kind: 'access', where: `engineer/${vp}`, what: `engineer page asked for money data (${money.length} requests)`, detail: money.slice(0, 10) })
      await ctx.close()
    })

test('crawl: every internal link found on the screens opens a real page', async ({ browser }, info) => {
  const ctx = await ctxAs(browser, info, 'admin')
  const page = await ctx.newPage()
  watch(page, info, 'links')
  let n = 0
  for (const [href, from] of links) {
    if (n++ > 120) break
    await probe(info, page, `link ${href}`, async () => {
      await page.goto(href)
      await page.locator('#main').waitFor({ timeout: 15_000 })
      await settle(page)
      if ((await page.getByRole('heading', { name: 'Page not found' }).count()) > 0) note(info, { kind: 'observation', where: from, what: `link ${href} leads to Page not found` })
    })
  }
  note(info, { kind: 'observation', where: 'links', what: `checked ${Math.min(links.size, 121)} of ${links.size} distinct internal links` })
  await ctx.close()
})

test('crawl: deep links to records that do not exist, and junk params', async ({ browser }, info) => {
  const ctx = await ctxAs(browser, info, 'admin')
  const page = await ctx.newPage()
  watch(page, info, 'junk', { allowStatus: [400, 404, 406] })
  for (const path of [
    '/rfqs/00000000-0000-4000-8000-000000000000',
    '/rfqs/not-a-uuid',
    '/orders/00000000-0000-4000-8000-000000000000',
    '/orders/123',
    '/companies/00000000-0000-4000-8000-000000000000',
    '/money/month-end?month=2026-13',
    '/money/month-end?month=garbage',
    '/money/reports/pnl?month=1999-01',
    '/money/reports/nonsense',
    '/money/reports/aging?asof=not-a-date',
    `/money/reports/in-out?period=${karachiDay(0)}`,
    '/rfqs?q=%25%27%22<script>',
    '/orders?owner=nobody',
    '/settings/nope',
  ])
    await probe(info, page, `junk ${path}`, async () => {
      await page.goto(path)
      await page.locator('#main').waitFor({ timeout: 15_000 })
      await settle(page)
      const body = (await page.locator('#main').innerText()).replace(/\s+/g, ' ').slice(0, 220)
      const crashed = (await page.getByText(/Something went wrong|Unexpected error|crashed/i).count()) > 0
      const spinning = (await page.locator('#main .skeleton').count()) > 0
      note(info, { kind: 'observation', where: `junk ${path}`, what: `${crashed ? 'CRASH SCREEN ' : ''}${spinning ? 'STILL LOADING ' : ''}shows: ${body}` })
      await shot(page, `junk-${path}`)
    })
  await ctx.close()
})

test('crawl: an open order page and RFQ page stay quiet (no repeated data requests while nobody touches them)', async ({ browser }, info) => {
  for (const vp of ['desktop', 'phone'] as Viewport[])
    for (const path of [`/orders/${ids.order}`, `/rfqs/${ids.rfq}`, '/todo']) {
      const ctx = await ctxAs(browser, info, 'admin', vp)
      const page = await ctx.newPage()
      watch(page, info, `quiet ${vp}`)
      await probe(info, page, `quiet ${vp} ${path}`, async () => {
        const t0 = Date.now()
        await page.goto(path)
        await page.locator('#main').waitFor()
        const h = await page.locator('#main h1, #main h2, h1').first().waitFor({ timeout: 15_000 }).then(() => Date.now() - t0).catch(() => -1)
        await page.waitForTimeout(4000)
        const seen: string[] = []
        page.on('request', r => seen.push(`${r.method()} ${decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+/, '').slice(0, 140)}`))
        await page.waitForTimeout(10_000)
        const headings = await page.locator('h1').allInnerTexts().catch(() => [] as string[])
        note(info, { kind: 'observation', where: `quiet ${vp} ${path}`, what: `first heading after ${h} ms (h1s: ${JSON.stringify(headings).slice(0, 120)}); ${seen.length} requests in 10 idle seconds`, detail: seen.slice(0, 12) })
      })
      await ctx.close()
    }
})
