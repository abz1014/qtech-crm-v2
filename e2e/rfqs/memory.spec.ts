import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'

/*
 * R17 and R18 end to end, against the local CI stack: supplier memory in intake (one-liner, Memory card), the "last price
 * for this item" chip on RFQ reply rows, and the company page's "What we know" panels. History is seeded through the REST
 * API as the fixture admin (rows dated in the past), then read through the UI as sales. Fixtures (k) to (n) of DATA_MODEL
 * 5c (Amendment A2b) are named in the test titles. Each test makes its own brands, models and companies.
 */

const violations = (page: Page): Promise<string[]> => axeViolations(page)

async function shot(target: Locator, name: string): Promise<void> {
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await target.screenshot({ path: `${dir}/${name}.png` })
}

async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

type Id = { id: string }
const post = async <T = Id>(table: string, body: unknown): Promise<T> => (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
/** Noon in Karachi, n days ago, as a timestamp (rows are dated in the past through created_at). */
const noon = (daysAgo: number) => `${karachiDay(-daysAgo)}T12:00:00+05:00`
/** A tag with no digits: a brand name that mixes letters and digits is itself a model token (model_tokens), which would make every item of the brand "same model". */
const letters = () => Math.random().toString(36).slice(2, 6).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)])
const rnd = (n: number) => Math.floor(10 ** (n - 1) + Math.random() * 9 * 10 ** (n - 1))

interface History {
  rfqId: string
  itemId: string
  inquiryId: string
}

/** One past RFQ for a company with one item, and an inquiry to `supplierId`. */
async function pastRfq(supplierId: string, o: { description: string; brandId: string | null; sentAgo: number; legacy?: boolean }): Promise<History> {
  const customer = await createCompany(uniqueName('Earlier Customer'))
  const rfq = await createRfq(customer.id, { received_on: karachiDay(-o.sentAgo) })
  const item = await post('rfq_items', { rfq_id: rfq.id, description: o.description, brand_id: o.brandId })
  const inq = await post('supplier_inquiries', {
    rfq_id: rfq.id,
    supplier_id: supplierId,
    sent_on: karachiDay(-o.sentAgo),
    legacy_source: o.legacy ? { import: 1 } : null,
  })
  return { rfqId: rfq.id, itemId: item.id, inquiryId: inq.id }
}

async function quote(h: History, o: { price: number; currency: string; lead?: string; ago: number; rate?: number | null; legacy?: boolean; flags?: string[] }): Promise<void> {
  await post('supplier_quote_lines', {
    inquiry_id: h.inquiryId,
    rfq_item_id: h.itemId,
    unit_price: o.price,
    currency: o.currency,
    lead_time: o.lead ?? null,
    created_at: noon(o.ago),
    fx_rate_pkr: o.rate ?? null,
    fx_rate_on: o.rate ? karachiDay(-o.ago) : null,
    legacy_flags: o.flags ?? [],
    legacy_source: o.legacy ? { import: 1 } : null,
  })
}

interface Seed {
  tag: string
  brand: { id: string; name: string }
  model: string
  desc: string
  customer: { id: string; name: string }
  s1: { id: string; name: string } // supplied the same model before, quoted and ordered (PO)
  s2: { id: string; name: string } // carries the brand, no history at all
  s3: { id: string; name: string } // imported history on another item of the brand, no captured rate, 19 months old
  s4: { id: string; name: string } // imported quote on another item of the brand, currency unverified
}

async function seedMemory(): Promise<Seed> {
  const tag = letters()
  const brand = await post<{ id: string; name: string }>('brands', { name: `Hachlike${tag}`, kind: 'brand' })
  const model = `ZQ${rnd(4)}`
  const desc = `${brand.name} ${model} portable meter`
  const customer = await createCompany(uniqueName('Mem Customer'))
  const s1 = await createCompany(uniqueName('Orient Mem'))
  const s2 = await createCompany(uniqueName('Karachi Mem'))
  const s3 = await createCompany(uniqueName('Imported Mem'))
  const s4 = await createCompany(uniqueName('Hidden Mem'))
  await must(rest('admin', 'company_brands', { method: 'POST', body: [{ company_id: s2.id, brand_id: brand.id }, { company_id: s1.id, brand_id: brand.id }] }))

  // s1: a quote 120 days ago (USD 412 at a captured 278.50), an older one with another lead time, and an order with a PO (USD 395).
  const q1 = await pastRfq(s1.id, { description: desc, brandId: brand.id, sentAgo: 121 })
  await quote(q1, { price: 412, currency: 'USD', lead: 'ex Dubai stock, 3 pcs', ago: 120, rate: 278.5 })
  const q0 = await pastRfq(s1.id, { description: desc, brandId: brand.id, sentAgo: 201 })
  await quote(q0, { price: 430, currency: 'USD', lead: '4 weeks', ago: 200, rate: 275 })
  const past = await createCompany(uniqueName('Earlier Buyer'))
  const order = await post('orders', { company_id: past.id })
  const leg = await post('supplier_orders', { order_id: order.id, supplier_id: s1.id, currency: 'USD', placed_on: karachiDay(-101), expected_on: karachiDay(-80), received_on: karachiDay(-79) })
  const oi = await post('order_items', { order_id: order.id, description: desc, brand_id: brand.id, unit_price_net: 500, supplier_order_id: leg.id, supplier_unit_price: 395, qty: 4, unit: 'pcs' })
  await rest('admin', 'fx_rates', { method: 'POST', body: { currency: 'USD', rate_pkr: 279, as_of: karachiDay(-101), source: 'manual' }, prefer: 'return=minimal' })
  await post('purchase_orders', {
    supplier_order_id: leg.id,
    number: 9_000_000 + rnd(6),
    issued_on: karachiDay(-101),
    currency: 'USD',
    total: 1580,
    lines: [{ order_item_id: oi.id, description: desc, qty: 4, unit: 'pcs', unit_price: 395, price_source: 'order' }],
  })

  // s3: imported, another model of the same brand, 19 months ago, no captured rate.
  const q3 = await pastRfq(s3.id, { description: `${brand.name} YY${rnd(4)} ultrasonic open channel level transmitter with remote display`, brandId: brand.id, sentAgo: 580, legacy: true })
  await quote(q3, { price: 640, currency: 'USD', ago: 1, rate: null, legacy: true })
  // s4: imported, another model, currency never verified.
  const q4 = await pastRfq(s4.id, { description: `${brand.name} WW${rnd(4)} gold plated conductivity electrode cable assembly`, brandId: brand.id, sentAgo: 60, legacy: true })
  await quote(q4, { price: 99, currency: 'USD', ago: 1, rate: null, legacy: true, flags: ['currency_unverified'] })
  return { tag, brand, model, desc, customer, s1, s2, s3, s4 }
}

async function reachSuppliers(page: Page, s: Seed, itemsText: string): Promise<void> {
  await openAs(page, 'sales', '/rfqs/new')
  await page.getByRole('combobox', { name: 'Company' }).fill(s.customer.name)
  await page.getByRole('option', { name: new RegExp(s.customer.name) }).click()
  await paste(page, itemsText)
  await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
  await expect(page.locator(`label[for^="sup-"]`).first()).toBeVisible()
}

const order = (page: Page) => page.locator('label[for^="sup-"]').allInnerTexts()
const memoryButton = (page: Page, name: string) => page.getByRole('button', { name: `Memory, ${name}` })

test.describe('R17 memory in intake', () => {
  test('(k) same model, (n) rate at the time, imported and thin states; memory never reorders; the card renders fast', async ({ page }) => {
    const s = await seedMemory()
    await reachSuppliers(page, s, `Please quote:\n1) ${s.desc} - 1 no\nRegards`)

    // Only "supplied this item before" is ticked, and it comes first.
    await expect(page.getByRole('checkbox', { name: s.s1.name })).toBeChecked()
    for (const other of [s.s2, s.s3, s.s4]) await expect(page.getByRole('checkbox', { name: other.name })).not.toBeChecked()
    const before = await order(page)
    expect(before[0]).toContain(s.s1.name)
    // The one-liner: counts only, and the low-data wording.
    await expect(page.locator('li', { hasText: s.s2.name }).locator('[data-memory-line]')).toHaveText('no history yet')

    // s1: same model, the quote at the rate of the day, the PO price, the lead time as written.
    await memoryButton(page, s.s1.name).click()
    const card = page.getByLabel(`What we know about ${s.s1.name}`)
    await expect(card.getByText('same model', { exact: true })).toBeVisible()
    await expect(card.getByText('Matched on model code.', { exact: false })).toBeVisible()
    await expect(card.getByText('USD 412')).toBeVisible()
    await expect(card).toContainText('≈ PKR 114,742')
    await expect(card).toContainText('at the time')
    await expect(card).toContainText('rate 278.50')
    await expect(card.getByText('USD 395')).toBeVisible()
    await expect(card).toContainText('≈ PKR 110,205')
    await expect(card).toContainText('PO')
    await expect(card.getByText('ex Dubai stock, 3 pcs')).toBeVisible()
    await expect(card).toContainText('Before that: “4 weeks”')
    await expect(card.getByText(s.brand.name, { exact: true })).toBeVisible()
    await expect(card).not.toContainText('months ago') // both dates are under 18 months
    expect(await card.innerText()).not.toMatch(/%|score|rating/i)
    await shot(card, 'r17-memory-card-same-model-1440')
    await expect(page.getByRole('checkbox', { name: s.s1.name })).toBeChecked() // opening a card does not touch the tick
    await memoryButton(page, s.s1.name).click()

    // s2: carries the brand, nothing recorded: brands only, no zero counts.
    await memoryButton(page, s.s2.name).click()
    const empty = page.getByLabel(`What we know about ${s.s2.name}`)
    await expect(empty.getByText('None on file')).toHaveCount(3) // last quote, last ordered, lead time
    await expect(empty).toContainText('No history yet')
    await expect(empty).toContainText('Nothing recorded or imported for this supplier yet.')
    await expect(empty.getByText('same brand')).toBeVisible()
    await shot(empty, 'r17-memory-card-no-history-1440')

    // s3: imported, no captured rate: original currency only, old, marked.
    await memoryButton(page, s.s3.name).click()
    const old = page.getByLabel(`What we know about ${s.s3.name}`)
    await expect(old.getByText('same brand', { exact: true })).toBeVisible()
    await expect(old.getByText('USD 640')).toBeVisible()
    await expect(old).toContainText('PKR value not captured at the time')
    await expect(old).toContainText('months ago')
    await expect(old).toContainText('Imported')
    await expect(old).toContainText('Includes imported history')
    await expect(old).not.toContainText('≈ PKR')
    await shot(old, 'r17-memory-card-imported-old-1440')

    // s4: an unverified currency hides the price.
    await memoryButton(page, s.s4.name).click()
    const hidden = page.getByLabel(`What we know about ${s.s4.name}`)
    await expect(hidden).toContainText('Price on file')
    await expect(hidden).toContainText('currency unverified, so not shown')
    await expect(hidden).not.toContainText('USD 99')
    await shot(hidden, 'r17-memory-card-price-hidden-1440')

    // Memory never reorders.
    expect(await order(page)).toEqual(before)
    await review(page, 'r17-intake-memory-cards-1440')
    expect(await violations(page), 'axe at 1440').toEqual([])

    // The card renders in under 200 ms once the data is there (it is already loaded: opening asks for nothing).
    await memoryButton(page, s.s3.name).click()
    await memoryButton(page, s.s2.name).click()
    const ms = await page.evaluate(
      name =>
        new Promise<number>(resolve => {
          const btn = document.querySelector<HTMLButtonElement>(`button[aria-label="Memory, ${name}"]`) as HTMLButtonElement
          const t0 = performance.now()
          const obs = new MutationObserver(() => {
            if (document.querySelector('[data-memory-card]')) {
              obs.disconnect()
              requestAnimationFrame(() => resolve(performance.now() - t0))
            }
          })
          obs.observe(document.body, { childList: true, subtree: true })
          btn.click()
        }),
      s.s2.name,
    )
    console.log(`PERF memory card render after click: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(200)
    const rpc = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('supplier_item_memory')).map(e => Math.round(e.duration)))
    console.log(`PERF supplier_item_memory requests (ms): ${JSON.stringify(rpc)}`)
    expect(rpc.length, 'one memory call for the one item, not one per supplier').toBe(1)

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByLabel(`What we know about ${s.s2.name}`)).toBeVisible()
    await review(page, 'r17-intake-memory-cards-375')
    expect(await violations(page), 'axe at 375').toEqual([])
  })

  test('(l) no model tokens: a 24V actuator is never "same model"; (m) the same code under another brand is not a match', async ({ page }) => {
    const tag = letters()
    const brandL = await post<{ id: string; name: string }>('brands', { name: `Qmeter${tag}`, kind: 'brand' })
    const brandA = await post<{ id: string; name: string }>('brands', { name: `Alphaco${tag}`, kind: 'brand' })
    const brandB = await post<{ id: string; name: string }>('brands', { name: `Betaco${tag}`, kind: 'brand' })
    const customer = await createCompany(uniqueName('Mem Customer'))
    const sL = await createCompany(uniqueName('Actuator Mem'))
    const sM = await createCompany(uniqueName('Code Mem'))
    await must(rest('admin', 'company_brands', { method: 'POST', body: [{ company_id: sM.id, brand_id: brandB.id }] }))
    const hl = await pastRfq(sL.id, { description: `${brandL.name} 24V actuator for ball valve`, brandId: brandL.id, sentAgo: 30 })
    await quote(hl, { price: 60, currency: 'PKR', ago: 30, rate: 1 })
    const past = await createCompany(uniqueName('Earlier Buyer'))
    const order = await post('orders', { company_id: past.id })
    const leg = await post('supplier_orders', { order_id: order.id, supplier_id: sL.id, currency: 'PKR' })
    await post('order_items', { order_id: order.id, description: `${brandL.name} 24V actuator for ball valve`, brand_id: brandL.id, unit_price_net: 100, supplier_order_id: leg.id, supplier_unit_price: 60 })
    const hm = await pastRfq(sM.id, { description: `${brandA.name} XK2040 relay`, brandId: brandA.id, sentAgo: 30 })
    await quote(hm, { price: 70, currency: 'PKR', ago: 30, rate: 1 })
    const seed = { customer } as Seed
    await reachSuppliers(page, seed, `Please quote:\n1) ${brandL.name} 24V actuator for ball valve - 1 no\n2) ${brandB.name} XK2040 relay - 1 no\nRegards`)

    await memoryButton(page, sL.name).click()
    const l = page.getByLabel(`What we know about ${sL.name}`)
    await expect(l.getByText('same item', { exact: true })).toBeVisible() // brand and description, not a model code
    await expect(l.getByText('same model')).toHaveCount(0)

    await memoryButton(page, sM.name).click()
    const m = page.getByLabel(`What we know about ${sM.name}`)
    await expect(m.getByText('same model')).toHaveCount(0)
    await expect(m.getByText('None on file').first()).toBeVisible()
  })
})

test.describe('R17 last price chip on RFQ reply rows', () => {
  test('(n) shows the supplier\'s last price for the same item at the time; an imported line with no rate shows the original currency only', async ({ page }) => {
    const s = await seedMemory()
    // An imported same-model quote with no captured rate, from a supplier that has since been asked again.
    const s7 = await createCompany(uniqueName('Legacy Same Model'))
    const h7 = await pastRfq(s7.id, { description: s.desc, brandId: s.brand.id, sentAgo: 90, legacy: true })
    await quote(h7, { price: 640, currency: 'USD', ago: 1, rate: null, legacy: true })

    const rfq = await createRfq(s.customer.id)
    const item = await post('rfq_items', { rfq_id: rfq.id, description: s.desc, brand_id: s.brand.id })
    for (const sup of [s.s1, s.s3, s7]) {
      const inq = await post('supplier_inquiries', { rfq_id: rfq.id, supplier_id: sup.id, sent_on: karachiDay(-1) })
      await post('supplier_quote_lines', { inquiry_id: inq.id, rfq_item_id: item.id, unit_price: 438, currency: 'USD', lead_time: '2 weeks' })
    }
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    const rows = page.locator('li', { has: page.locator('[data-last-price]') })
    const chip1 = page.locator('li', { hasText: s.s1.name }).locator('[data-last-price]')
    await expect(chip1).toContainText('Last price for this item:')
    // The PO (101 days ago) is newer than the quote (120 days ago) and both are the same model: the newer wins.
    await expect(chip1).toContainText('USD 395')
    await expect(chip1).toContainText('≈ PKR 110,205')
    await expect(chip1).toContainText('at the time')
    await expect(chip1).toContainText('ordered')
    await expect(chip1).toContainText('same model')
    const chip7 = page.locator('li', { hasText: s7.name }).locator('[data-last-price]')
    await expect(chip7).toContainText('USD 640')
    await expect(chip7).toContainText('PKR value not captured at the time')
    await expect(chip7).not.toContainText('≈ PKR')
    // A same-brand price is not a price for this item: s3 has no chip.
    await expect(page.locator('li', { hasText: s.s3.name }).locator('[data-last-price]')).toHaveCount(0)
    await expect(rows).toHaveCount(2)
    await review(page, 'r17-rfq-detail-last-price-chip-1440')
    expect(await violations(page), 'axe at 1440').toEqual([])
    await page.setViewportSize({ width: 375, height: 812 })
    await review(page, 'r17-rfq-detail-last-price-chip-375')
    expect(await violations(page), 'axe at 375').toEqual([])
  })
})

test.describe('R18 company page: What we know', () => {
  test('recent quotes with PKR at the time, deliveries, quoted N times per brand and Open with them', async ({ page }) => {
    const tag = letters()
    const brand = await post<{ id: string; name: string }>('brands', { name: `Belimo${tag}`, kind: 'brand' })
    const listed = await post<{ id: string; name: string }>('brands', { name: `Siemens${tag}`, kind: 'brand' })
    const sup = await createCompany(uniqueName('Alpenmark Mem'), { country: 'Austria' })
    await must(rest('admin', 'company_brands', { method: 'POST', body: [{ company_id: sup.id, brand_id: listed.id }] }))

    // Two EUR quotes, one ordered here (with a PO and a late delivery), one not.
    const a = await pastRfq(sup.id, { description: `${brand.name} NM24A-SR damper actuator`, brandId: brand.id, sentAgo: 30 })
    await quote(a, { price: 214, currency: 'EUR', lead: '2 to 3 weeks ex stock', ago: 29, rate: 326.8 })
    const b = await pastRfq(sup.id, { description: `${brand.name} LM24A-SR actuator`, brandId: brand.id, sentAgo: 100 })
    await quote(b, { price: 118.4, currency: 'EUR', lead: 'Ex stock', ago: 99, rate: 323.1 })
    const buyer = await createCompany(uniqueName('Earlier Buyer'))
    const order = await post<{ id: string; number: number }>('orders', { company_id: buyer.id })
    const leg = await post('supplier_orders', { order_id: order.id, supplier_id: sup.id, currency: 'EUR', placed_on: karachiDay(-25), expected_on: karachiDay(-15), received_on: karachiDay(-9) })
    await post('order_items', { order_id: order.id, description: `${brand.name} NM24A-SR damper actuator`, brand_id: brand.id, unit_price_net: 100, supplier_order_id: leg.id, rfq_item_id: a.itemId, supplier_unit_price: 214 })
    await post('purchase_orders', { supplier_order_id: leg.id, number: 8_000_000 + rnd(6), issued_on: karachiDay(-25), currency: 'EUR', total: 214, lines: [{ order_item_id: a.itemId, description: 'x', qty: 1, unit: 'pcs', unit_price: 214, price_source: 'order' }] })
    // An imported quote with an unverified currency, a declined enquiry, an enquiry nobody answered, and one still open.
    const c = await pastRfq(sup.id, { description: `${brand.name} CQ24A-SR actuator`, brandId: brand.id, sentAgo: 200, legacy: true })
    await quote(c, { price: 77, currency: 'EUR', ago: 1, rate: null, legacy: true, flags: ['currency_unverified'] })
    const d = await pastRfq(sup.id, { description: `${listed.name} QAA2030 duct sensor`, brandId: listed.id, sentAgo: 60 })
    await rest('admin', `supplier_inquiries?id=eq.${d.inquiryId}`, { method: 'PATCH', body: { no_offer_on: karachiDay(-58), no_offer_reason: 'no_brand' } })
    await pastRfq(sup.id, { description: `${listed.name} AME435 valve`, brandId: listed.id, sentAgo: 40 })
    const open = await pastRfq(sup.id, { description: `${brand.name} LR24A-SR actuator`, brandId: brand.id, sentAgo: 3 })
    const openLeg = await post('supplier_orders', { order_id: order.id, supplier_id: sup.id, currency: 'EUR', placed_on: karachiDay(-2), expected_on: karachiDay(5) })
    void openLeg

    await openAs(page, 'engineer', `/companies/${sup.id}`)
    const what = page.getByRole('region', { name: 'What we know' })
    await expect(what).toBeVisible()
    await expect(what.getByText(brand.name)).toBeVisible()
    await expect(what.locator('li', { hasText: brand.name })).toContainText(/quoted 3×/)
    await expect(what.locator('li', { hasText: listed.name })).toContainText('listed, no quote yet')
    expect(await what.innerText()).not.toMatch(/score|rating|rank|%/i)

    const quotes = page.getByRole('region', { name: 'Recent quotes' })
    const rowA = quotes.locator('li', { hasText: 'NM24A-SR' })
    await expect(rowA).toContainText(/EUR\s*214/)
    await expect(rowA).toContainText(/≈ PKR\s*69,935/)
    await expect(rowA).toContainText('at the time')
    await expect(rowA).toContainText('rate 326.80')
    await expect(rowA).toContainText('2 to 3 weeks ex stock')
    await expect(rowA).toContainText('Ordered here')
    await expect(quotes.locator('li', { hasText: 'LM24A-SR' })).toContainText('Not ordered')
    const rowC = quotes.locator('li', { hasText: 'CQ24A-SR' })
    await expect(rowC).toContainText('Price on file, currency unverified')
    await expect(rowC).toContainText('Imported')
    await expect(quotes.locator('li', { hasText: 'QAA2030' })).toContainText("Couldn't offer")
    await expect(quotes.locator('li', { hasText: 'AME435' })).toContainText('No reply')
    await expect(quotes.locator('li', { hasText: 'LR24A-SR' })).toContainText('Waiting for a reply')
    await expect(quotes.getByRole('link', { name: 'All enquiries' })).toBeVisible()

    const deliveries = page.getByRole('region', { name: 'Deliveries' })
    await expect(deliveries.locator('li', { hasText: `ORD-${String(order.number).padStart(4, '0')}` }).first()).toBeVisible()
    await expect(deliveries).toContainText('Late 6 days')
    await expect(deliveries).toContainText(/PO-\d\d-\d{4}/)

    const openPanel = page.getByRole('region', { name: 'Open with them' })
    await expect(openPanel).toContainText('waiting, 3 days')
    await expect(openPanel).toContainText(`ORD-${String(order.number).padStart(4, '0')}`)
    await expect(openPanel).toContainText('expected')
    await expect(openPanel).toContainText('EUR')
    void open

    await review(page, 'r18-company-what-we-know-1440')
    expect(await violations(page), 'axe at 1440').toEqual([])
    await page.setViewportSize({ width: 375, height: 812 })
    await review(page, 'r18-company-what-we-know-375')
    expect(await violations(page), 'axe at 375').toEqual([])
  })
})
