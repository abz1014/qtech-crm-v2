import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * R07 end to end, against the local CI stack: the RFQ detail page, as the fixture users through the real login form.
 * Every test seeds its own companies and RFQ (unique names), so tests do not depend on each other.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2):
 *   Supplier reply   at most 1 typed price per item, currency never typed (then one Save reply)
 *   Paste reply      paste + accept, at most 2 actions (nothing is saved until Accept)
 *   Can't quote      1 tap
 *   Chase            1 tap
 *   Mark bid sent    1 tap
 *   Lose / close     at most 2 taps (open, confirm), with the reason pre-filled
 */


const violations = (page: Page): Promise<string[]> => axeViolations(page)

const today = () => karachiDay(0)

/** Manual rates: USD fresh today, EUR 12 days old (stale). CNY and AED are left without a rate on purpose. */
async function setRates(): Promise<void> {
  for (const r of [
    { currency: 'USD', rate_pkr: 280, as_of: karachiDay(0) },
    { currency: 'EUR', rate_pkr: 300, as_of: karachiDay(-12) },
  ]) {
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { ...r, source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
  }
}

interface Seed {
  tag: string
  rfq: { id: string; number: number }
  customer: string
  items: { id: string; description: string }[]
  china: { id: string; name: string; inquiryId: string }
  usd: { id: string; name: string; inquiryId: string }
  germany: { id: string; name: string; inquiryId: string }
}

async function seed(opts: { dueInDays?: number } = {}): Promise<Seed> {
  await setRates()
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = uniqueName('Detail Customer')
  const co = await createCompany(customer)
  const rfq = await createRfq(co.id, { due_on: karachiDay(opts.dueInDays ?? 6) })
  const descriptions = [`Flow meter FM${tag}1 DN50`, `Pressure transmitter PT${tag}2 0-10 bar`]
  const items: Seed['items'] = []
  for (const [i, description] of descriptions.entries()) {
    const row = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: 2 } })))[0]
    items.push({ id: row.id, description })
  }
  const supplier = async (prefix: string, country: string | null) => {
    const c = await createCompany(uniqueName(prefix), country ? { country } : {})
    const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: c.id, sent_on: karachiDay(-3) } })))[0]
    return { id: c.id, name: c.name, inquiryId: inq.id }
  }
  const china = await supplier('Hengxin', 'China')
  const usd = await supplier('Apex', 'Pakistan')
  const germany = await supplier('Keller', 'Germany')

  // The USD supplier quoted in USD on an earlier RFQ: that is where its pre-filled currency comes from.
  const earlier = await createRfq(co.id)
  const eItem = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: earlier.id, description: 'Earlier item', qty: 1 } })))[0]
  const eInq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: earlier.id, supplier_id: usd.id, sent_on: karachiDay(-40) } })))[0]
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: eInq.id, rfq_item_id: eItem.id, unit_price: 50, currency: 'USD' } }))
  return { tag, rfq, customer, items, china, usd, germany }
}

const row = (page: Page, name: string) => page.getByRole('region', { name })
const linesOf = (inquiryId: string) =>
  must(rest<{ rfq_item_id: string; unit_price: number; currency: string; fx_rate_pkr: number | null; lead_time: string | null; in_stock: boolean | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${inquiryId}&select=rfq_item_id,unit_price,currency,fx_rate_pkr,lead_time,in_stock`))
const inquiryOf = (id: string) =>
  must(rest<{ no_offer_on: string | null; no_offer_reason: string | null; notes: string | null; chase_count: number; last_chased_on: string | null }[]>('admin', `supplier_inquiries?id=eq.${id}&select=no_offer_on,no_offer_reason,notes,chase_count,last_chased_on`)).then(r => r[0])
const declinesOf = (inquiryId: string) =>
  must(rest<{ rfq_item_id: string; reason: string }[]>('admin', `inquiry_item_declines?inquiry_id=eq.${inquiryId}&select=rfq_item_id,reason`))
const rfqOf = (id: string) =>
  must(rest<{ quoted_on: string | null; closed_on: string | null; close_reason: string | null }[]>('admin', `rfqs?id=eq.${id}&select=quoted_on,closed_on,close_reason`)).then(r => r[0])

test.describe('supplier reply (FE-2: one typed price per item, currency never typed)', () => {
  test('currency is pre-filled, two prices are typed, one tap saves, a missing rate does not block', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`RFQ-0*${s.rfq.number}`) })).toBeVisible()
    await review(page, 'rfq-detail-01-populated-1440')

    // China, no earlier reply: the country map fills CNY. The USD supplier's last reply fills USD. Nobody types a currency.
    const cn = row(page, s.china.name)
    await expect(cn.getByLabel(`Currency for ${s.china.name}`)).toHaveValue('CNY')
    await expect(row(page, s.usd.name).getByLabel(`Currency for ${s.usd.name}`)).toHaveValue('USD')
    await expect(row(page, s.germany.name).getByLabel(`Currency for ${s.germany.name}`)).toHaveValue('EUR')

    let typedPrices = 0
    let taps = 0
    for (const [i, it] of s.items.entries()) {
      await cn.getByLabel(`Price for item ${i + 1} from ${s.china.name}`).fill(String(1000 + i * 500))
      typedPrices++
      void it
    }
    await cn.getByRole('button', { name: 'Save reply' }).click()
    taps++
    await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
    expect(typedPrices).toBe(s.items.length) // at most 1 typed price per item
    expect(taps).toBe(1)

    const lines = await linesOf(s.china.inquiryId)
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.currency === 'CNY')).toBe(true)
    expect(lines.every(l => l.fx_rate_pkr === null)).toBe(true) // no CNY rate: saved anyway, never blocked

    // The line shows the quiet chip instead of a PKR figure.
    await expect(page.getByText('not compared — no rate').first()).toBeVisible()
    await expect(page.getByText('No rate captured').first()).toBeVisible()
  })

  test('a USD price captures today\'s rate and is shown with the rate\'s age', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.usd.name)
    await r.getByLabel(`Price for item 1 from ${s.usd.name}`).fill('100')
    await r.getByLabel(`Lead time from ${s.usd.name}`).fill('3 weeks')
    await r.getByRole('button', { name: 'Save reply' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
    const [line] = await linesOf(s.usd.inquiryId)
    expect(line).toMatchObject({ currency: 'USD', unit_price: 100, lead_time: '3 weeks' })
    expect(Number(line.fx_rate_pkr)).toBe(280)
    const item = page.getByRole('article', { name: 'Item 1' })
    await expect(item.locator('[data-compared]')).toContainText('28,000')
    await expect(item.getByText("USD 280.00, today's rate")).toBeVisible()
    await expect(item.getByText(/At entry 280\.00/)).toBeVisible()
  })
})

test.describe('paste reply (FE-2: paste + accept is at most 2 actions)', () => {
  const copy = (page: Page, text: string) => page.evaluate(t => navigator.clipboard.writeText(t), text)

  test('one paste and one accept save every offer; nothing is saved before Accept', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.usd.name)
    await copy(page, ['Dear Sir,', `FM${s.tag}1 DN50 - USD 100.00 each, 3 weeks`, `PT${s.tag}2 0-10 bar - USD 250.00 each, 4 weeks`, 'Regards'].join('\n'))
    let actions = 0
    await r.getByRole('button', { name: 'Paste reply' }).click() // action 1: paste
    actions++
    await expect(r.getByText('Read from their reply')).toBeVisible()
    expect(await linesOf(s.usd.inquiryId)).toHaveLength(0) // nothing committed yet
    await review(page, 'rfq-detail-03-paste-suggestions-1440')
    await r.getByRole('button', { name: 'Accept 2 offers' }).click() // action 2: accept all
    actions++
    expect(actions).toBeLessThanOrEqual(2)
    await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
    const lines = await linesOf(s.usd.inquiryId)
    expect(lines.map(l => [Number(l.unit_price), l.currency]).sort()).toEqual([[100, 'USD'], [250, 'USD']])
    expect(Number(lines[0].fx_rate_pkr)).toBe(280)
  })

  test('a figure that could be read two ways is highlighted for checking, and Cancel saves nothing', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.germany.name)
    await copy(page, `FM${s.tag}1 DN50: EUR 1.234 each`)
    await r.getByRole('button', { name: 'Paste reply' }).click()
    await expect(r.locator('[data-flagged]')).toHaveCount(1)
    await expect(r.locator('[data-flagged]')).toContainText('check')
    await r.getByRole('button', { name: 'Cancel' }).click()
    expect(await linesOf(s.germany.inquiryId)).toHaveLength(0)
  })

  test("a regret becomes can't quote with the reason filled in", async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.china.name)
    await copy(page, 'Regret, we do not handle this brand. Sorry we cannot quote.')
    await r.getByRole('button', { name: 'Paste reply' }).click()
    await expect(r.getByText(/They say they can't quote\. Reason:/)).toBeVisible()
    await r.getByRole('button', { name: "Mark can't quote" }).click()
    await expect.poll(async () => (await inquiryOf(s.china.inquiryId)).no_offer_on).toBe(today())
    const done = await inquiryOf(s.china.inquiryId)
    expect(['no_brand', 'other']).toContain(done.no_offer_reason)
    expect(done.notes).toBeNull()
  })
})

test.describe('comparison', () => {
  test('lowest is marked at today\'s rate; stale rates are labelled; a line with no rate is left out', async ({ page }) => {
    const s = await seed()
    const item = s.items[0].id
    // USD 100 = PKR 28,000; EUR 90 at 300 = PKR 27,000 (lowest, on a 12-day-old rate); CNY has no rate.
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: item, unit_price: 100, currency: 'USD' },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: item, unit_price: 90, currency: 'EUR' },
      { inquiry_id: s.china.inquiryId, rfq_item_id: item, unit_price: 1, currency: 'CNY' },
    ] }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const art = page.getByRole('article', { name: 'Item 1' })
    const lowest = art.locator('[data-lowest]')
    await expect(lowest).toHaveCount(1)
    await expect(lowest).toContainText(s.germany.name)
    await expect(lowest).toContainText('Lowest')
    await expect(lowest).toContainText('27,000')
    await expect(lowest).toContainText('rate 12 days old')
    await expect(lowest).toContainText('Stale')
    // The CNY line is out of the comparison, with the quiet chip.
    const cny = art.locator('li', { hasText: s.china.name })
    await expect(cny).toContainText('not compared — no rate')
    await expect(cny.locator('[data-lowest]')).toHaveCount(0)
    await expect(art.getByText(/Lowest of the 2 compared/)).toBeVisible()
    // Item 2 has no prices: nothing is marked.
    await expect(page.getByRole('article', { name: 'Item 2' }).locator('[data-lowest]')).toHaveCount(0)
    await review(page, 'rfq-detail-02-rate-states-1440')
  })

  test('only one comparable line means no lowest mark', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' },
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 1, currency: 'CNY' },
    ] }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('Covered, 2 prices')).toBeVisible()
    await expect(page.locator('[data-lowest]')).toHaveCount(0)
  })

  test('an item nobody priced is flagged uncovered once someone has replied', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const art = page.getByRole('article', { name: 'Item 2' })
    await expect(art.getByText('Uncovered item')).toBeVisible()
    await expect(art.getByText(/None of the 1 supplier who replied quoted this item/)).toBeVisible()
  })
})

test.describe("can't quote (FE-2: 1 tap)", () => {
  test('one tap records the reason, a per-item override is optional, and it can be taken back', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', `supplier_inquiries?id=eq.${s.china.inquiryId}`, { method: 'PATCH', body: { notes: 'Call Imran on Monday' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.china.name)
    await r.getByRole('button', { name: "Doesn't carry this brand" }).click() // the one tap
    await expect(page.getByRole('status').filter({ hasText: "Marked can't quote" })).toBeVisible()
    await expect(r.getByText("Can't quote", { exact: false }).first()).toBeVisible()
    const after = await inquiryOf(s.china.inquiryId)
    expect(after.no_offer_on).toBe(today())
    expect(after.no_offer_reason).toBe('no_brand') // a stored key, not a phrase
    expect(after.notes).toBe('Call Imran on Monday') // the notes belong to people and are never written
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText("Can't quote: Doesn't carry this brand")).toBeVisible()

    await r.getByRole('button', { name: 'Take back' }).click()
    await expect(r.getByRole('button', { name: "Doesn't carry this brand" })).toBeVisible()
    const back = await inquiryOf(s.china.inquiryId)
    expect(back.no_offer_on).toBeNull()
    expect(back.no_offer_reason).toBeNull()
    expect(back.notes).toBe('Call Imran on Monday')
  })

  test('a different reason for one item is kept beside the inquiry reason', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.germany.name)
    await r.getByText('A different reason for one item').click()
    await r.getByLabel(`Can't quote reason for item 2 from ${s.germany.name}`).selectOption('Item discontinued')
    await expect.poll(async () => (await declinesOf(s.germany.inquiryId)).map(d => [d.rfq_item_id, d.reason])).toEqual([[s.items[1].id, 'discontinued']])
    const after = await inquiryOf(s.germany.inquiryId)
    expect(after.notes).toBeNull()
    expect(after.no_offer_on).toBeNull()
    await expect(page.getByRole('article', { name: 'Item 2' }).getByText("Can't quote: Item discontinued")).toBeVisible()
  })
})

test.describe('chase (FE-2: 1 tap)', () => {
  test('one tap copies the approved text and stamps the chase together', async ({ page }) => {
    const s = await seed({ dueInDays: 8 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.china.name)
    await r.getByRole('button', { name: /Copy & mark chased/ }).click() // the one tap
    await expect(page.getByRole('status').filter({ hasText: 'Chase text copied' })).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(`ref *RFQ-${String(s.rfq.number).padStart(4, '0')}*`)
    expect(text).toContain('Following up on our enquiry')
    expect(text).toContain(s.items[0].description)
    expect(text).toContain(s.items[1].description)
    expect(text).not.toContain(s.customer) // never names the customer
    const after = await inquiryOf(s.china.inquiryId)
    expect(after.chase_count).toBe(1)
    expect(after.last_chased_on).toBe(today())
    await expect(r.getByText(/chased 1 time/)).toBeVisible()

    // The second chase uses the second-reminder wording.
    await r.getByRole('button', { name: /Copy & mark chased/ }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('A second reminder')
    expect((await inquiryOf(s.china.inquiryId)).chase_count).toBe(2)
  })

  test('lists only the items still without a price', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 5, currency: 'CNY' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, s.china.name)
    await r.getByRole('button', { name: 'Preview text' }).click()
    await expect(r.getByText('Thank you for pricing item 1.')).toBeVisible()
    await expect(r.locator('pre')).toContainText(s.items[1].description)
    await expect(r.locator('pre')).not.toContainText(s.items[0].description)
  })
})

test.describe('bid sent and close or lose', () => {
  test('mark bid sent is one tap, with an Undo', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await page.getByRole('button', { name: 'Mark bid sent' }).click() // the one tap
    await expect(page.getByRole('status').filter({ hasText: 'Marked bid sent' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBe(today())
    await expect(page.getByRole('button', { name: 'Mark bid sent' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBeNull()
  })

  test('close or lose is two taps with the reason already chosen', async ({ page }) => {
    const s = await seed()
    // Nobody can supply it: the reason is pre-filled from that.
    await must(rest('admin', 'supplier_inquiries?rfq_id=eq.' + s.rfq.id, { method: 'PATCH', body: { no_offer_on: karachiDay(0) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    await page.getByRole('button', { name: 'Close or lose' }).click()
    taps++
    await expect(page.getByRole('radio', { name: 'We could not source it' })).toBeChecked()
    await page.getByRole('button', { name: 'Close RFQ' }).click()
    taps++
    expect(taps).toBeLessThanOrEqual(2)
    await expect(page.getByRole('status').filter({ hasText: 'Closed' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).close_reason).toBe('could_not_source')
    expect((await rfqOf(s.rfq.id)).closed_on).toBe(today())
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
    await page.getByRole('button', { name: 'Reopen' }).click()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).closed_on).toBeNull()
  })
})

test.describe('states', () => {
  test('an RFQ that does not exist says so', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs/00000000-0000-4000-8000-00000000dead')
    await expect(page.getByText("This RFQ isn't here")).toBeVisible()
  })

  test('the slots for the clarifications and quotations panels are marked', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await expect(page.locator('[data-slot="clarifications"]')).toContainText('R09')
    await expect(page.locator('[data-slot="quotations"]')).toContainText('R19')
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}`, async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks', in_stock: true },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[0].id, unit_price: 90, currency: 'EUR', lead_time: null, in_stock: false },
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 1, currency: 'CNY', lead_time: null, in_stock: null },
    ] }))
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('article', { name: 'Item 1' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `rfq-detail-populated-${width}`)

    await row(page, s.china.name).getByRole('button', { name: 'Preview text' }).click().catch(() => undefined)
    await page.getByRole('button', { name: 'Close or lose' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `rfq-detail-close-dialog-${width}`)
  })
}
