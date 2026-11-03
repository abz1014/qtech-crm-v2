import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { openStage } from '../support/job'

/*
 * A8 (R25, R26) end to end, against the local CI stack: the supplier prices on the RFQ page (NOT ranked since the owner decision of
 * 2026-10-29: the CRM never suggests a supplier on the replies), and the track record in the float suggestions and the memory card
 * (who to ASK, which stays). Fixtures follow the S24 named fixtures: (b) mixed currencies with a missing rate, (c) the 2%
 * near-tie band, (d) reliability, (e) order history, (f) spread, (h) memory evidence, (i) money safety (an engineer gets no selling
 * price and no spread, and no extra money request is made).
 *
 * Interaction counts asserted (BUILD_PLAN A8, R25): seeing the prices is 0 taps (they are there when the page opens); opening the
 * details of one supplier is 1 optional tap (rows start closed). The float list needs no extra tap for the new order or the evidence lines.
 */

const violations = (page: Page): Promise<string[]> => axeViolations(page)

type Id = { id: string }
const post = async <T = Id>(table: string, body: unknown): Promise<T> => (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
const letters = () => Math.random().toString(36).slice(2, 6).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)])
const rnd = (n: number) => Math.floor(10 ** (n - 1) + Math.random() * 9 * 10 ** (n - 1))
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "12 Mar 2026", the way the reasons write a date. */
const dmy = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

async function full(page: Page, name: string, height = 2600): Promise<void> {
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const before = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.setViewportSize({ width: before.width, height: before.width < 600 ? 7000 : height })
  await page.screenshot({ path: `${dir}/${name}.png` })
  await page.setViewportSize(before)
}

/** USD fresh today, EUR 12 days old (stale). CNY is left without a rate on purpose (the line is listed, not ranked). */
async function setRates(): Promise<void> {
  for (const r of [
    { currency: 'USD', rate_pkr: 280, as_of: karachiDay(0) },
    { currency: 'EUR', rate_pkr: 300, as_of: karachiDay(-12) },
  ]) {
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { ...r, source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
  }
}

interface Leg {
  /** Days ago the order was placed. */
  placedAgo: number
  /** Days from placed to expected. */
  expectedIn: number
  /** Days from placed to delivered. */
  deliveredIn: number
}

/** One non-cancelled order per leg, with one line whose description is `desc`: that is the supplier's delivery record and order evidence. */
async function history(supplierId: string, desc: string, brandId: string | null, legs: Leg[]): Promise<{ number: number; placed: string; deliveredIn: number }[]> {
  const buyer = await createCompany(uniqueName('Past Buyer'))
  const out: { number: number; placed: string; deliveredIn: number }[] = []
  for (const l of legs) {
    const placed = karachiDay(-l.placedAgo)
    const order = await post<{ id: string; number: number }>('orders', { company_id: buyer.id })
    const leg = await post('supplier_orders', {
      order_id: order.id,
      supplier_id: supplierId,
      currency: 'USD',
      placed_on: placed,
      expected_on: karachiDay(-l.placedAgo + l.expectedIn),
      delivered_on: karachiDay(-l.placedAgo + l.deliveredIn),
      received_on: karachiDay(-l.placedAgo + l.deliveredIn),
    })
    await post('order_items', { order_id: order.id, description: desc, brand_id: brandId, unit_price_net: 500, supplier_order_id: leg.id, supplier_unit_price: 90, qty: 1, unit: 'pcs' })
    out.push({ number: order.number, placed, deliveredIn: l.deliveredIn })
  }
  return out
}

const THREE_ON_TIME: Leg[] = [
  { placedAgo: 100, expectedIn: 14, deliveredIn: 13 },
  { placedAgo: 70, expectedIn: 14, deliveredIn: 10 },
  { placedAgo: 40, expectedIn: 14, deliveredIn: 12 },
]

interface Seed {
  rfqId: string
  item1: { id: string; description: string }
  item2: { id: string; description: string }
  apex: { id: string; name: string }
  bravo: { id: string; name: string }
  charlie: { id: string; name: string }
  delta: { id: string; name: string }
  bravoOrders: { number: number; placed: string; deliveredIn: number }[]
}

/**
 * Item 1 (2 pcs, quoted at PKR 40,000 each): Apex USD 100 (PKR 28,000, the lowest), Bravo USD 101 (1.0% dearer, inside the band, three
 * deliveries all on time), Charlie USD 120 (above the band), Delta CNY 50 (no CNY rate: not ranked).
 * Item 2 (1 pc, no selling price): Bravo USD 150, Apex USD 160.
 */
async function seed(): Promise<Seed> {
  await setRates()
  const tag = letters()
  const customer = await createCompany(uniqueName('Ranking Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
  const d1 = `Flow meter FR${tag}1 DN50`
  const d2 = `Pressure transmitter PR${tag}2 0-10 bar`
  const item1 = await post<{ id: string }>('rfq_items', { rfq_id: rfq.id, position: 0, description: d1, qty: 2, quoted_unit_price_net: 40000 })
  const item2 = await post<{ id: string }>('rfq_items', { rfq_id: rfq.id, position: 1, description: d2, qty: 1 })
  const sup = async (prefix: string) => {
    const c = await createCompany(uniqueName(prefix))
    const inq = await post<{ id: string }>('supplier_inquiries', { rfq_id: rfq.id, supplier_id: c.id, sent_on: karachiDay(-3) })
    return { id: c.id, name: c.name, inquiryId: inq.id }
  }
  const apex = await sup('Apex Low')
  const bravo = await sup('Bravo Proven')
  const charlie = await sup('Charlie Dear')
  const delta = await sup('Delta China')
  const line = (s: { inquiryId: string }, item: { id: string }, unit_price: number, currency: string, extra: Record<string, unknown> = {}) => ({
    inquiry_id: s.inquiryId,
    rfq_item_id: item.id,
    unit_price,
    currency,
    lead_time: null,
    in_stock: null,
    ...extra,
  })
  await must(
    rest('admin', 'supplier_quote_lines', {
      method: 'POST',
      body: [
        line(apex, item1, 100, 'USD', { lead_time: '3 weeks', in_stock: false }),
        line(bravo, item1, 101, 'USD', { lead_time: '2 weeks', in_stock: true }),
        line(charlie, item1, 120, 'USD'),
        line(delta, item1, 50, 'CNY'),
        line(bravo, item2, 150, 'USD'),
        line(apex, item2, 160, 'USD'),
      ],
      prefer: 'return=minimal',
    }),
  )
  const bravoOrders = await history(bravo.id, d1, null, THREE_ON_TIME)
  return { rfqId: rfq.id, item1: { id: item1.id, description: d1 }, item2: { id: item2.id, description: d2 }, apex, bravo, charlie, delta, bravoOrders }
}

const rowOf = (page: Page, item: string, supplier: string) => page.getByRole('article', { name: item }).locator('li[data-price-row]', { hasText: supplier })

test.describe('R25 supplier prices on the RFQ page: listed by name, nothing marked, nothing ranked', () => {
  test('sales: the prices are there when the page opens, by supplier name, with no mark, no reason and no spread', async ({ page }) => {
    const s = await seed()
    const rankCalls: string[] = []
    page.on('request', r => {
      if (r.url().includes('rank_item_quotes')) rankCalls.push(r.url())
    })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)

    // 0 taps: the rows are on the page, in supplier-name order whatever the prices (Apex, Bravo, Charlie, Delta).
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-price-row]')).toHaveCount(4)
    const shown = await art.locator('li[data-price-row]').evaluateAll(els => els.map(e => e.textContent ?? ''))
    expect([s.apex, s.bravo, s.charlie, s.delta].map(x => shown.findIndex(t => t.includes(x.name)))).toEqual([0, 1, 2, 3])
    // The CRM never suggests a supplier (owner decision 2026-10-29): no mark, no reason, no ranking, no spread.
    await expect(art).not.toContainText(/Recommended|Cheapest|Lowest price|Best price|Within 2%|Spread|above the best|Our price/)
    await expect(page.locator('[data-lowest], [data-recommended], [data-ranked], [data-cheapest], [data-cheapest-tag], [data-sell-note], [data-reasons], [data-reasons-for]')).toHaveCount(0)
    // The facts stay: the price in PKR at today's rate, the lead time, the stock.
    await expect(rowOf(page, 'Item 1', s.apex.name)).toContainText('28,000')
    await expect(rowOf(page, 'Item 1', s.apex.name)).toContainText('3 weeks')
    await expect(rowOf(page, 'Item 1', s.bravo.name)).toContainText('In stock')
    await expect(rowOf(page, 'Item 1', s.delta.name)).toContainText('not compared, no rate')
    // Opening a row shows the supplier's own figure and the rate, and no reasons.
    await rowOf(page, 'Item 1', s.bravo.name).getByRole('button', { name: `Show details for ${s.bravo.name}` }).click()
    await expect(rowOf(page, 'Item 1', s.bravo.name)).toContainText('Quoted USD 101.00')
    await expect(rowOf(page, 'Item 1', s.bravo.name)).not.toContainText(/On time|delivery record|orders with us/)
    await page.waitForLoadState('networkidle')
    expect(rankCalls).toEqual([]) // the page does not ask the database to rank anything
    await full(page, 'a8-rfq-prices-sales-1440')
    expect(await violations(page)).toEqual([])
  })

  // Owner decision 2026-10-22 (engineers see no prices): neither shown nor fetched for an engineer.
  test('engineer: who quoted, with lead time and stock; no price, no mark, and nothing priced is requested (fixture i)', async ({ page }) => {
    const s = await seed()
    const urls: string[] = []
    page.on('request', r => urls.push(decodeURIComponent(r.url())))
    await openAs(page, 'engineer', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    for (const sup of [s.apex, s.bravo, s.charlie, s.delta]) await expect(art).toContainText(sup.name)
    await page.waitForLoadState('networkidle')
    await expect(art.locator('li[data-lowest], li[data-recommended]')).toHaveCount(0)
    await expect(art.getByText('Recommended')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Show details for / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'How are prices shown?' })).toHaveCount(0)
    await expect(art.getByText(/Cheapest/)).toHaveCount(0)

    // No price, selling price or spread anywhere on the items panel.
    const panel = page.locator('[data-slot="items"]')
    const text = await panel.innerText()
    expect(text).not.toMatch(/PKR|USD\s*\d|EUR\s*\d|spread|selling price|quoted price|last sold|40,000/i)
    await expect(panel.locator('[data-sell-note]')).toHaveCount(0)

    // Nothing that carries a price was requested.
    expect(urls.filter(u => /rank_item_quotes|supplier_item_memory|customer_price_memory|v_fx_latest|unit_price|v_order_money|v_payment|v_margin/.test(u))).toEqual([])
    await full(page, 'a8-rfq-prices-engineer-1440')
    expect(await violations(page)).toEqual([])
  })

  test('phone 375: two lines per supplier (the name, then price · lead time · stock), and the details wrap under it when opened', async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: 375, height: 900 })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-price-row]')).toHaveCount(4)
    const first = rowOf(page, 'Item 1', s.bravo.name)
    await expect(first).not.toContainText('Recommended')
    // grade-B C3: the price starts on its own line below the name, at the row's left edge, so the name keeps the row's full width.
    const box = async (sel: string) => (await first.locator(sel).first().boundingBox())!
    const name = await first.getByText(s.bravo.name, { exact: true }).boundingBox()
    const price = await box('.num')
    expect(price.y).toBeGreaterThan(name!.y + name!.height - 1)
    expect(Math.abs(price.x - name!.x)).toBeLessThan(40)
    await first.getByRole('button', { name: `Show details for ${s.bravo.name}` }).click()
    await expect(first).toContainText('Quoted USD 101.00')
    // The page does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await full(page, 'a8-rfq-prices-sales-375')
    expect(await violations(page)).toEqual([])
  })

  test('a saved reply shows in the same view (no reload), in name order, and marks nothing', async ({ page }) => {
    const s = await seed()
    const echo = await createCompany(uniqueName('Echo New'))
    await post('supplier_inquiries', { rfq_id: s.rfqId, supplier_id: echo.id, sent_on: karachiDay(-1) })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-price-row]')).toHaveCount(4)
    // Echo quotes far below everyone (its currency is picked with one chip tap, never typed). The reply opens from the supplier's
    // "Enter reply" in Suppliers asked, in a dialog named after them (grade-B R2/R4).
    await page.getByRole('button', { name: `Enter reply, ${echo.name}`, exact: true }).click()
    const region = page.getByRole('dialog', { name: echo.name, exact: true })
    await region.getByRole('group', { name: `Currency for ${echo.name}` }).getByRole('button', { name: 'PKR' }).click()
    await region.getByLabel(`Price for item 1 from ${echo.name}`).fill('90')
    await region.getByRole('button', { name: 'Save reply' }).click()
    await expect(art.locator('li[data-price-row]')).toHaveCount(5)
    // by name: Echo comes after Delta, and is not marked however low it is
    await expect(art.locator('li[data-price-row]').last()).toContainText(echo.name)
    await expect(art).not.toContainText(/Recommended|Lowest price|Cheapest/)
    await expect(region.getByText(/It would be the lowest/)).toHaveCount(0)
  })
})

test.describe('R26 float suggestions: ordered by track record, citing the evidence', () => {
  interface FloatSeed {
    brandName: string
    rfqId: string
    zulu: { id: string; name: string }
    alpha: { id: string; name: string }
    mike: { id: string; name: string }
    zuluOrders: { number: number; placed: string; deliveredIn: number }[]
  }

  async function seedFloat(): Promise<FloatSeed> {
    const tag = letters()
    const brand = await post<{ id: string; name: string }>('brands', { name: `Zetalike${tag}`, kind: 'brand' })
    const customer = await createCompany(uniqueName('Float Customer'))
    const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
    await post('rfq_items', { rfq_id: rfq.id, position: 0, description: `${brand.name} ZQ${rnd(4)} portable meter`, qty: 1, brand_id: brand.id })
    const sup = async (prefix: string) => {
      const c = await createCompany(uniqueName(prefix))
      await must(rest('admin', 'company_brands', { method: 'POST', body: { company_id: c.id, brand_id: brand.id } }))
      return { id: c.id, name: c.name }
    }
    // Names sort the other way round (Alpha, Mike, Zulu) and Alpha was contacted yesterday: the old order was Alpha, Mike, Zulu.
    const zulu = await sup('Zulu Proven')
    const alpha = await sup('Alpha Newcomer')
    const mike = await sup('Mike Late')
    const other = `${brand.name} ZR${rnd(4)} other model`
    const zuluOrders = await history(zulu.id, other, brand.id, THREE_ON_TIME)
    await history(mike.id, other, brand.id, [
      { placedAgo: 100, expectedIn: 14, deliveredIn: 13 },
      { placedAgo: 70, expectedIn: 14, deliveredIn: 30 },
      { placedAgo: 40, expectedIn: 14, deliveredIn: 33 },
    ])
    const past = await createRfq(customer.id)
    await post('supplier_inquiries', { rfq_id: past.id, supplier_id: alpha.id, sent_on: karachiDay(-1) })
    return { brandName: brand.name, rfqId: rfq.id, zulu, alpha, mike, zuluOrders }
  }

  test('inside the reason, proven comes first, then unproven, then often late; the order is cited; nothing new is ticked', async ({ page }) => {
    const s = await seedFloat()
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)
    await openStage(page, 'Quotation') // nobody is asked yet, so the job is still at the Enquiry stage
    const card = page.locator('[data-slot="suppliers-to-ask"]')
    // the list also holds a group heading row (C3): the supplier rows are the ones with a tick box
    const supplierRows = card.locator('li', { has: page.getByRole('checkbox') })
    await expect(supplierRows).toHaveCount(3)
    const rows = await supplierRows.allInnerTexts()
    // C3: ordered count first (Zulu and Mike three each, Alpha none), then the delivery record as the tie-break: proven before often late,
    // and Alpha, however recently contacted, after both.
    expect(rows[0]).toContain(s.zulu.name)
    expect(rows[1]).toContain(s.mike.name)
    expect(rows[2]).toContain(s.alpha.name)

    const last = s.zuluOrders[2]
    const zulu = card.locator('li', { hasText: s.zulu.name })
    await expect(zulu.locator('[data-evidence]')).toContainText(`Ordered ${s.brandName} 3 times; last for ORD-${String(last.number).padStart(4, '0')}, placed ${dmy(last.placed)}, delivered after ${last.deliveredIn} days`)
    await expect(zulu.locator('[data-record]')).toHaveText('On time 3 of 3 deliveries')
    await expect(card.locator('li', { hasText: s.mike.name }).locator('[data-record]')).toContainText('Often late: on time 1 of 3')
    await expect(card.locator('li', { hasText: s.alpha.name }).locator('[data-evidence]')).toHaveCount(0)

    // The pre-tick rule is unchanged: only "supplied this item before" is ticked, and nobody is.
    for (const n of [s.zulu.name, s.alpha.name, s.mike.name]) await expect(page.getByRole('checkbox', { name: n })).not.toBeChecked()
    await full(page, 'a8-rfq-float-evidence-1440', 1400)
  })
})

test.describe('R26 intake: evidence in the list and in the memory card', () => {
  test('a supplier who supplied this item before: ticked, with the order behind it, and the card shows the orders and the counts', async ({ page }) => {
    const tag = letters()
    const brand = await post<{ id: string; name: string }>('brands', { name: `Hachlike${tag}`, kind: 'brand' })
    const model = `ZQ${rnd(4)}`
    const desc = `${brand.name} ${model} portable meter`
    const customer = await createCompany(uniqueName('Evidence Customer'))
    const supplier = await createCompany(uniqueName('Orient Evidence'))
    await must(rest('admin', 'company_brands', { method: 'POST', body: { company_id: supplier.id, brand_id: brand.id } }))
    const orders = await history(supplier.id, desc, brand.id, THREE_ON_TIME)
    const last = orders[2]
    const ref = `ORD-${String(last.number).padStart(4, '0')}`

    await openAs(page, 'sales', '/rfqs/new')
    await page.getByRole('combobox', { name: 'Company' }).fill(customer.name)
    await page.getByRole('option', { name: new RegExp(customer.name) }).click()
    await page.evaluate(t => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, `Please quote:\n1) ${desc} - 1 no\nRegards`)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    const row = page.locator('li', { has: page.getByRole('checkbox', { name: supplier.name }) })
    await expect(row).toBeVisible()
    await expect(page.getByRole('checkbox', { name: supplier.name })).toBeChecked()
    // R2-10: the order behind the reason is in Memory (the evidence block below), not on the row.
    await expect(row.locator('[data-evidence]')).toHaveCount(0)
    await expect(row.locator('[data-record]')).toHaveText('On time 3 of 3 deliveries')
    await expect(row.locator('[data-memory-line]')).toContainText('ordered from 3 times') // P9: v_supplier_stats.orders_count, and no "last contacted" beside the cited order
    await expect(row.locator('[data-memory-line]')).not.toContainText('last contacted')

    // The card: 1 optional tap, the latest order with its days, then the counts.
    await page.getByRole('button', { name: `History, ${supplier.name}` }).click()
    const block = page.getByLabel(`What we know about ${supplier.name}`).locator('[data-evidence-block]')
    await expect(block).toContainText('Recent orders of this item from')
    // P9: up to three orders, each with its own days (the mockup's evidence block), and the supplier's order count.
    await expect(block.locator('[data-evidence-order]')).toHaveCount(3)
    for (const o of orders) await expect(block).toContainText(`ORD-${String(o.number).padStart(4, '0')}`)
    await expect(block).toContainText('3 of 3')
    await expect(block).toContainText('Ordered from')
    await expect(block).toContainText('3 times')
    await expect(block).toContainText(ref)
    await expect(block).toContainText(`placed ${dmy(last.placed)}`)
    await expect(block).toContainText(`delivered after ${last.deliveredIn} days`)
    await expect(block).toContainText('expected in 14 · on time')
    await expect(block).toContainText('Deliveries')
    await expect(block).toContainText('3 of 3')
    expect(await block.innerText()).not.toMatch(/receiv/i)
    await full(page, 'a8-intake-memory-evidence-1440', 1700)
    expect(await violations(page)).toEqual([])
  })
})

test.describe('R25 stale and missing exchange rates (audit K1)', () => {
  test('a 12-day-old rate is used and labelled; a rate over 30 days old is not used: the row says so, with an Add rate link', async ({ page }) => {
    await setRates()
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { currency: 'SAR', rate_pkr: 74, as_of: karachiDay(-45), source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
    const customer = await createCompany(uniqueName('Stale Rate Customer'))
    const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
    const item = await post<{ id: string }>('rfq_items', { rfq_id: rfq.id, position: 0, description: `Level switch LS${letters()} float`, qty: 1 })
    const mk = async (prefix: string) => {
      const c = await createCompany(uniqueName(prefix))
      const inq = await post<{ id: string }>('supplier_inquiries', { rfq_id: rfq.id, supplier_id: c.id, sent_on: karachiDay(-3) })
      return { name: c.name, inquiryId: inq.id }
    }
    const fresh = await mk('Fresh Usd')
    const stale = await mk('Stale Eur')
    const old = await mk('Old Sar')
    await must(
      rest('admin', 'supplier_quote_lines', {
        method: 'POST',
        body: [
          { inquiry_id: fresh.inquiryId, rfq_item_id: item.id, unit_price: 100, currency: 'USD' },
          { inquiry_id: stale.inquiryId, rfq_item_id: item.id, unit_price: 96, currency: 'EUR' },
          { inquiry_id: old.inquiryId, rfq_item_id: item.id, unit_price: 200, currency: 'SAR' },
        ],
        prefer: 'return=minimal',
      }),
    )
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-price-row]')).toHaveCount(3)
    // EUR 96 at 300 = PKR 28,800 and USD 100 at 280 = PKR 28,000: both are shown in PKR, by name; the EUR row says its rate is 12 days old.
    await expect(rowOf(page, 'Item 1', fresh.name)).toContainText('28,000')
    await expect(rowOf(page, 'Item 1', stale.name)).toContainText('28,800')
    await rowOf(page, 'Item 1', stale.name).getByRole('button', { name: `Show details for ${stale.name}` }).click()
    await expect(rowOf(page, 'Item 1', stale.name)).toContainText('rate 12 days old')
    // SAR: the only rate is 45 days old, so it is not used: the supplier's own figure, the reason and the one link.
    const oldRow = rowOf(page, 'Item 1', old.name)
    await expect(oldRow).toContainText('not compared, rate too old')
    await oldRow.getByRole('button', { name: `Show details for ${old.name}` }).click()
    await expect(oldRow.getByRole('link', { name: 'Add SAR rate' })).toHaveAttribute('href', '/settings/exchange-rates')
  })
})
