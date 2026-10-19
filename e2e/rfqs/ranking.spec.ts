import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * A8 (R25, R26) end to end, against the local CI stack: the ranked comparison on the RFQ page, and the track record in the float
 * suggestions and the memory card. Fixtures follow the S24 named fixtures: (b) mixed currencies with a missing rate, (c) the 2%
 * near-tie band, (d) reliability, (e) order history, (f) spread, (h) memory evidence, (i) money safety (an engineer gets no selling
 * price and no spread, and no extra money request is made).
 *
 * Interaction counts asserted (BUILD_PLAN A8, R25): seeing the ranking is 0 taps (it is there when the page opens); opening the
 * reasons of one supplier is 1 optional tap. The float list needs no extra tap for the new order or the evidence lines.
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

const rowOf = (page: Page, item: string, supplier: string) => page.getByRole('article', { name: item }).locator('li[data-ranked]', { hasText: supplier })

test.describe('R25 ranked comparison on the RFQ page', () => {
  test('sales: the ranking is there when the page opens, with the reasons, the spread and the evidence (fixtures b, c, d, e, f, h)', async ({ page }) => {
    const s = await seed()
    let taps = 0
    const rankCalls: string[] = []
    page.on('request', r => {
      if (r.url().includes('rank_item_quotes')) rankCalls.push(r.url())
    })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)

    // 0 taps: ranked rows, in rank order, are on the page.
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-ranked]')).toHaveCount(4)
    const order = await art.locator('li[data-ranked]').evaluateAll(els => els.map(e => e.getAttribute('data-ranked')))
    expect(order).toEqual(['1', '2', '3', 'none'])
    const names = await art.locator('li[data-ranked]').allInnerTexts()
    expect(names[0]).toContain(s.bravo.name) // 1.0% dearer, but inside the 2% band and proven: first
    expect(names[1]).toContain(s.apex.name)
    expect(names[2]).toContain(s.charlie.name)
    expect(names[3]).toContain(s.delta.name)
    await expect(art.getByText('Ranked 3 of 4')).toBeVisible()
    await expect(art.locator('[data-rank-note="ranked"]')).toContainText("Ranked by price in PKR at today's rate.")
    await expect(art.locator('[data-sell-note="quoted"]')).toContainText('Selling price PKR 40,000 each, quoted')

    // Rank 1 (inside the band, proven): open by default, every key printed as a count, the evidence cites the order.
    const bravo = rowOf(page, 'Item 1', s.bravo.name)
    const last = s.bravoOrders[2]
    await expect(bravo.locator('[data-reasons="full"]')).toBeVisible()
    await expect(bravo).toContainText('≈ PKR 280 each above the best (1.0%)')
    await expect(bravo).toContainText('Within 2% of the best price: ordered by delivery record')
    await expect(bravo).toContainText('Spread ≈ PKR 11,700 each, PKR 23,400 for 2, against our quoted PKR 40,000. Supplier price only, before freight and duty.')
    await expect(bravo).toContainText('On time 3 of 3 deliveries')
    await expect(bravo).toContainText(`Ordered from 3 times, last ORD-${String(last.number).padStart(4, '0')} on ${dmy(last.placed)}`)
    await expect(bravo.locator('[data-reason="evidence"]')).toContainText(
      `Ordered ${s.item1.description} ×1 for ORD-${String(last.number).padStart(4, '0')}, placed ${dmy(last.placed)}, delivered after ${last.deliveredIn} days (expected 14)`,
    )

    // Rank 2 is the lowest price, with no record yet.
    const apex = rowOf(page, 'Item 1', s.apex.name)
    await expect(apex).toHaveAttribute('data-lowest', '')
    await expect(apex).toContainText('Lowest')
    await expect(apex).toContainText('Best price: ≈ PKR 28,000 each (USD 100 at 280.00, today)')
    await expect(apex).toContainText('No deliveries yet')

    // Rank 3 is above the band: one line, closed; 1 tap opens it.
    const charlie = rowOf(page, 'Item 1', s.charlie.name)
    await expect(charlie.locator('[data-reasons="short"]')).toContainText('≈ PKR 5,600 each above the best (20.0%)')
    await expect(charlie.locator('[data-reasons="short"]')).not.toContainText('Within 2%')
    const toggle = charlie.getByRole('button', { name: `Show reasons for ${s.charlie.name}` })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    taps++
    await expect(charlie.getByRole('button', { name: `Hide reasons for ${s.charlie.name}` })).toHaveAttribute('aria-expanded', 'true')
    await expect(charlie.locator('[data-reasons="full"]')).toContainText('Spread ≈ PKR 6,400 each')
    expect(taps).toBe(1)

    // No rate: listed after the ranked lines, with the reason and the one button.
    const delta = rowOf(page, 'Item 1', s.delta.name)
    await expect(delta).toContainText('Not ranked: no current CNY rate. Add one.')
    await expect(delta.getByRole('link', { name: 'Add CNY rate' })).toHaveAttribute('href', '/settings/exchange-rates')

    // Item 2 has no selling price: the note says so, and no spread is invented.
    const item2 = page.getByRole('article', { name: 'Item 2' })
    await expect(item2.locator('[data-sell-note="none"]')).toContainText('No selling price yet')
    await expect(item2.locator('[data-reasons]').first()).not.toContainText('Spread')

    // There is no "Received" step anywhere in the reasons: legs are placed, then delivered.
    expect(await page.locator('[data-reasons-for]').allInnerTexts().then(t => t.join(' '))).not.toMatch(/receiv/i)
    // One read for the whole page.
    expect(rankCalls).toHaveLength(1)

    await full(page, 'a8-rfq-ranked-sales-1440')
    expect(await violations(page)).toEqual([])
  })

  test('engineer: supplier prices, the rank and the reliability and history reasons; no selling price, no spread, no extra money request (fixture i)', async ({ page }) => {
    const s = await seed()
    const urls: string[] = []
    const bodies: string[] = []
    page.on('request', r => urls.push(r.url()))
    page.on('response', async r => {
      if (r.url().includes('rank_item_quotes')) bodies.push(await r.text())
    })
    await openAs(page, 'engineer', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-ranked]')).toHaveCount(4)
    const names = await art.locator('li[data-ranked]').allInnerTexts()
    expect(names[0]).toContain(s.bravo.name)
    await expect(rowOf(page, 'Item 1', s.bravo.name)).toContainText('On time 3 of 3 deliveries')
    await expect(rowOf(page, 'Item 1', s.bravo.name)).toContainText('Within 2% of the best price: ordered by delivery record')
    await expect(rowOf(page, 'Item 1', s.bravo.name).locator('[data-reason="evidence"]')).toContainText('delivered after')

    // Nothing about our selling price or the spread is on the items panel.
    const panel = page.locator('[data-slot="items"]')
    const text = await panel.innerText()
    expect(text).not.toMatch(/spread|selling price|quoted price|last sold|40,000/i)
    await expect(panel.locator('[data-sell-note]')).toHaveCount(0)

    // The one new request returned no money, and no money view or price memory was read by the ranking.
    await expect.poll(() => bodies.length).toBeGreaterThan(0)
    const rows = JSON.parse(bodies[0]) as Record<string, unknown>[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      for (const k of ['sell_unit_net', 'sell_order_number', 'sell_on', 'spread_unit', 'spread_total']) expect(r[k]).toBeNull()
    }
    expect(urls.filter(u => u.includes('rank_item_quotes'))).toHaveLength(1)
    expect(urls.filter(u => /customer_price_memory|v_order_money|v_payment|v_margin/.test(u))).toEqual([])
    await full(page, 'a8-rfq-ranked-engineer-1440')
    expect(await violations(page)).toEqual([])
  })

  test('phone 375: the rank sits in its own column and the reasons wrap under the supplier', async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: 375, height: 900 })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-ranked]')).toHaveCount(4)
    const first = rowOf(page, 'Item 1', s.bravo.name)
    await expect(first.locator('[data-rank="1"]')).toBeVisible()
    await expect(first).toContainText('On time 3 of 3 deliveries')
    // The page does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await full(page, 'a8-rfq-ranked-sales-375')
    expect(await violations(page)).toEqual([])
  })

  test('a saved reply moves the ranking in the same view (no reload)', async ({ page }) => {
    const s = await seed()
    const echo = await createCompany(uniqueName('Echo New'))
    await post('supplier_inquiries', { rfq_id: s.rfqId, supplier_id: echo.id, sent_on: karachiDay(-1) })
    await openAs(page, 'sales', `/rfqs/${s.rfqId}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    await expect(art.locator('li[data-ranked]')).toHaveCount(4)
    await expect(art.locator('li[data-ranked]').first()).toContainText(s.bravo.name)
    // Echo quotes far below everyone (its currency is pre-filled, not typed): it becomes rank 1 without a reload.
    const region = page.getByRole('region', { name: echo.name })
    await region.getByLabel(`Price for item 1 from ${echo.name}`).fill('90')
    await region.getByRole('button', { name: 'Save reply' }).click()
    await expect(art.locator('li[data-ranked]')).toHaveCount(5)
    await expect(art.locator('li[data-ranked]').first()).toContainText(echo.name)
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
    const card = page.locator('[data-slot="suppliers-to-ask"]')
    await expect(card.locator('li')).toHaveCount(3)
    const rows = await card.locator('li').allInnerTexts()
    expect(rows[0]).toContain(s.zulu.name)
    expect(rows[1]).toContain(s.alpha.name)
    expect(rows[2]).toContain(s.mike.name)

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
    await expect(row.locator('[data-evidence]')).toContainText(`Ordered ${desc} ×1 for ${ref}, placed ${dmy(last.placed)}, delivered after ${last.deliveredIn} days (expected 14)`)
    await expect(row.locator('[data-record]')).toHaveText('On time 3 of 3 deliveries')
    await expect(row.locator('[data-memory-line]')).toContainText('ordered from 3 times') // P9: v_supplier_stats.orders_count, and no "last contacted" beside the cited order
    await expect(row.locator('[data-memory-line]')).not.toContainText('last contacted')

    // The card: 1 optional tap, the latest order with its days, then the counts.
    await page.getByRole('button', { name: `Memory, ${supplier.name}` }).click()
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
  test('a 12-day-old rate still ranks, labelled; a rate over 30 days old is not used: the row is unranked with an Add rate link', async ({ page }) => {
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
    await expect(art.locator('li[data-ranked]')).toHaveCount(3)
    // EUR 96 at 300 = PKR 28,800 (2.9% above, outside the 2% band) against USD 100 at 280 = PKR 28,000: both rank; the EUR row says its rate is 12 days old.
    await expect(rowOf(page, 'Item 1', fresh.name)).toHaveAttribute('data-ranked', '1')
    await expect(rowOf(page, 'Item 1', stale.name)).toHaveAttribute('data-ranked', '2')
    await rowOf(page, 'Item 1', stale.name).getByRole('button', { name: `Show reasons for ${stale.name}` }).click()
    await expect(rowOf(page, 'Item 1', stale.name)).toContainText('Rate 12 days old')
    // SAR: the only rate is 45 days old, so it is not used. Unranked, with the reason and the one link.
    const oldRow = rowOf(page, 'Item 1', old.name)
    await expect(oldRow).toHaveAttribute('data-ranked', 'none')
    await expect(oldRow).toContainText(/Not ranked: the SAR rate is 45 days old\. Add a current one\./)
    await expect(oldRow.getByRole('link', { name: 'Add SAR rate' })).toHaveAttribute('href', '/settings/exchange-rates')
  })
})
