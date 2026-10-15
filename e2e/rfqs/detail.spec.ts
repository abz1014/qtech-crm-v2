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
 *   Chase            1 tap for EVERY supplier asked (its own Chase button copies the text and marks it chased)
 *   Mark bid sent    1 tap (a direct button in the header while the bid is open and not sent)
 *   Lose / close     at most 2 taps (open Bid and close, choose the reason; the suggested one is marked)
 */


const violations = (page: Page): Promise<string[]> => axeViolations(page)
/** A menu or dialog is portalled outside <main> by design, so the landmark rule is off for it (every other rule stays on). */
const overlayViolations = (page: Page): Promise<string[]> => axeViolations(page, { landmarks: false })

const today = () => karachiDay(0)

/** "Tue 1 Dec", the way the page writes a day. */
const formatLong = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

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
  /** The bid due date (YYYY-MM-DD). */
  dueDate: string
  /** A supplier that carries the brand of item 1 and has not been asked: it is suggested. Only with { brand: true }. */
  carrier?: { id: string; name: string }
  rfq: { id: string; number: number }
  customer: string
  items: { id: string; description: string }[]
  china: { id: string; name: string; inquiryId: string }
  usd: { id: string; name: string; inquiryId: string }
  germany: { id: string; name: string; inquiryId: string }
}

async function seed(opts: { dueInDays?: number; brand?: boolean; asked?: boolean } = {}): Promise<Seed> {
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
    if (opts.asked === false) return { id: c.id, name: c.name, inquiryId: '' }
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
  let carrier: Seed['carrier']
  if (opts.brand) {
    const brand = (await must(rest<{ id: string }[]>('admin', 'brands', { method: 'POST', body: { name: `Zetabrand${tag}`, kind: 'brand' } })))[0]
    await must(rest('admin', `rfq_items?id=eq.${items[0].id}`, { method: 'PATCH', body: { brand_id: brand.id } }))
    const c = await createCompany(uniqueName('Carrier'))
    await must(rest('admin', 'company_brands', { method: 'POST', body: { company_id: c.id, brand_id: brand.id } }))
    carrier = { id: c.id, name: c.name }
  }
  return { tag, dueDate: karachiDay(opts.dueInDays ?? 6), carrier, rfq, customer, items, china, usd, germany }
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
    await expect(cn.getByText('The currency follows the supplier: CNY, usual for China. There is nothing to pick.')).toBeVisible()
    await expect(row(page, s.usd.name).getByText(/USD, their last reply/)).toBeVisible()
    await expect(row(page, s.germany.name).getByText(/EUR, usual for Germany/)).toBeVisible()
    await expect(cn.getByLabel(`Currency for ${s.china.name}`)).toHaveCount(0) // no control to pick one
    await expect(cn.getByLabel(`Price for item 1 from ${s.china.name}`)).toBeVisible()

    let typedPrices = 0
    let taps = 0
    for (const [i, it] of s.items.entries()) {
      await cn.getByLabel(`Price for item ${i + 1} from ${s.china.name}`).fill(String(1000 + i * 500))
      typedPrices++
      void it
    }
    // No CNY rate: the row says the reply can be saved and the rate added afterwards (live PKR preview, C-40).
    await expect(cn.getByText('No current CNY rate. You can save the reply and add the rate afterwards.').first()).toBeVisible()
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
    // The live preview: what it reads as in PKR at today's rate, and that it would be the lowest (C-40).
    await expect(r.getByText("Reads as ≈ PKR 28,000 at today's USD rate.")).toBeVisible()
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
    await expect(art.getByText(/Lowest of the 2 with a rate/)).toBeVisible()
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
    await expect(page.getByRole('article', { name: 'Item 1' }).locator(`[data-declined="${s.china.id}"]`)).toContainText("Doesn't carry this brand")

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
    await expect(page.getByRole('article', { name: 'Item 2' }).locator(`[data-declined="${s.germany.id}"]`)).toContainText('Item discontinued')
  })
})

test.describe('chase (FE-2: 1 tap)', () => {
  test('one tap copies the approved text and stamps the chase together', async ({ page }) => {
    const s = await seed({ dueInDays: 8 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const card = page.locator(`[data-chase-card="${s.china.id}"]`) // the supplier shown in the Suppliers asked card
    await card.getByRole('button', { name: 'Copy and mark chased' }).click() // the one tap
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
    await expect(card.getByText('Chased once already')).toBeVisible()

    // The second chase uses the second-reminder wording.
    await card.getByRole('button', { name: 'Copy and mark chased' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('A second reminder')
    expect((await inquiryOf(s.china.inquiryId)).chase_count).toBe(2)
  })

  test('the card shows the text and the recipient, lists only the items still without a price, and another supplier is one tap away', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 5, currency: 'CNY' } }))
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: s.china.id, name: 'Mr. Li Wei', phone: '+86 138 0000 0000', email: 'li@hengxin.example' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const card = page.locator(`[data-chase-card="${s.china.id}"]`)
    await expect(card.getByText('Thank you for pricing item 1.')).toBeVisible()
    await expect(card.locator('pre')).toContainText(s.items[1].description)
    await expect(card.locator('pre')).not.toContainText(s.items[0].description)
    await expect(card.getByText('WhatsApp to Mr. Li Wei')).toBeVisible()
    await expect(card.getByText('+86 138 0000 0000')).toBeVisible()
    await card.getByRole('radio', { name: 'Email' }).click()
    await expect(card.getByText('Email to Mr. Li Wei')).toBeVisible()
    await expect(card.getByText('li@hengxin.example')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Copy subject' })).toBeVisible()
    await expect(card.getByText(/^RFQ-\d+: price needed/)).toBeVisible()
    // Another supplier: "Show text" opens its card.
    await page.getByRole('button', { name: `Show text, ${s.usd.name}` }).click()
    await expect(page.locator(`[data-chase-card="${s.usd.id}"]`)).toBeVisible()
  })

  test('every supplier asked has its own Chase button: 1 tap copies its text and marks it chased (FE-2)', async ({ page }) => {
    const s = await seed({ dueInDays: 8 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    // Not the supplier shown in the card: the Germany supplier, straight from its entry in Suppliers asked.
    await page.getByRole('button', { name: `Chase ${s.germany.name}`, exact: true }).click()
    taps++
    expect(taps).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Chase text copied' })).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain('Following up on our enquiry')
    expect(text).toContain(s.items[0].description)
    expect(text).not.toContain(s.customer)
    const after = await inquiryOf(s.germany.inquiryId)
    expect(after.chase_count).toBe(1)
    expect(after.last_chased_on).toBe(today())
    expect((await inquiryOf(s.usd.inquiryId)).chase_count).toBe(0) // only that supplier
    // And the next one, 1 tap again.
    await page.getByRole('button', { name: `Chase ${s.usd.name}`, exact: true }).click()
    await expect.poll(async () => (await inquiryOf(s.usd.inquiryId)).chase_count).toBe(1)
  })
})

const bidAndClose = (page: Page) => page.getByRole('button', { name: 'Bid and close' })

test.describe('bid sent and close or lose (Bid and close menu)', () => {
  test('mark bid sent is 1 tap (a header button), with an Undo; the menu keeps Sent the offer again', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    await page.getByRole('button', { name: 'Mark bid sent' }).click() // the one tap
    taps++
    expect(taps).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Marked bid sent' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBe(today())
    await expect(page.getByRole('button', { name: 'Mark bid sent' })).toHaveCount(0) // sent: the button is gone
    await bidAndClose(page).click()
    await expect(page.getByRole('menuitem', { name: /Sent the offer again/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Mark bid sent/ })).toBeDisabled() // already sent
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBeNull()

    // Sent the offer again re-stamps the date (an older date is moved to today).
    await must(rest('admin', `rfqs?id=eq.${s.rfq.id}`, { method: 'PATCH', body: { quoted_on: karachiDay(-5) } }))
    await page.reload()
    await bidAndClose(page).click()
    await page.getByRole('menuitem', { name: /Sent the offer again/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Offer sent again' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBe(today())
  })

  test('close or lose is two taps (open the menu, choose the reason); the reason the state points to is marked suggested', async ({ page }) => {
    const s = await seed()
    // Nobody can supply it: that reason is the suggested one.
    await must(rest('admin', 'supplier_inquiries?rfq_id=eq.' + s.rfq.id, { method: 'PATCH', body: { no_offer_on: karachiDay(0) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    await bidAndClose(page).click()
    taps++
    await expect(page.getByRole('menuitem', { name: /We could not source it/ })).toContainText('suggested')
    await page.getByRole('menuitem', { name: /We could not source it/ }).click()
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

  test('the clarifications panel (R09) and the quotations block (R19) are both built', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await expect(page.locator('[data-slot="clarifications"]')).toContainText('Questions for the customer')
    await expect(page.locator('[data-slot="quotations"]')).toContainText('Nothing issued')
  })
})

test.describe('the page as drawn in the mockup (parity audit Part C)', () => {
  test('one Items and supplier replies panel with Add item; Quotations under it; Suppliers asked, Questions and Files in the rail', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const items = page.locator('[data-slot="items"]')
    await expect(items.getByRole('heading', { name: 'Items and supplier replies', level: 2 })).toBeVisible()
    await expect(items.getByRole('button', { name: 'Add item' })).toBeVisible()
    await expect(items).toContainText('2 items · 3 suppliers asked · 0 items have a price')
    await expect(page.locator('[data-slot="quotations"]')).toBeVisible()
    await expect(page.locator('aside [data-slot="quotations"]')).toHaveCount(0) // not in the rail
    const rail = page.locator('aside')
    await expect(rail.getByRole('heading', { name: 'Suppliers asked' })).toBeVisible()
    await expect(rail).toContainText('3 asked · 0 replied')
    await expect(rail.getByRole('heading', { name: 'Questions for the customer' })).toBeVisible()
    await expect(rail.getByRole('heading', { name: 'Files' })).toBeVisible()
    // The header: Issue quotation (off until a price exists) and one Bid and close menu.
    await expect(page.getByRole('button', { name: 'Issue quotation' }).first()).toBeDisabled()
    await expect(bidAndClose(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark bid sent' })).toBeVisible() // 1 tap while the bid is open and not sent
    await expect(page.getByRole('button', { name: 'Close or lose' })).toHaveCount(0)
    // Owner role and customer since sit under their values.
    await expect(page.locator('dl').first()).toContainText('Customer since')
    await expect(page.locator('dl').first()).toContainText('Admin')
  })

  test('coverage reads Partly covered while a supplier has said nothing, Covered when everybody has answered', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('Partly covered, 1 price')).toBeVisible()
    await expect(one.locator(`[data-waiting="${s.china.id}"]`)).toContainText(`Waiting on ${s.china.name}`)
    await expect(one.locator(`[data-waiting="${s.china.id}"]`)).toContainText('enquiry sent')
    // The others answer something: nobody is waiting any more.
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'CNY' },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'EUR' },
    ] }))
    await page.reload()
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('Covered, 1 price')).toBeVisible()
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-waiting]')).toHaveCount(0)
  })

  test("a waiting supplier has Add reply and a Can't quote menu that records the reason for that item in one tap", async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    const waiting = one.locator(`[data-waiting="${s.germany.id}"]`)
    await waiting.getByRole('button', { name: 'Add reply' }).click()
    await expect(page.getByLabel(`Price for item 1 from ${s.germany.name}`)).toBeFocused()
    await waiting.getByRole('button', { name: new RegExp(`Can't quote, ${s.germany.name}`) }).click()
    await expect(page.getByRole('menu', { name: 'Reason' })).toContainText('One tap records the reason')
    await page.getByRole('menuitem', { name: 'Item discontinued' }).click() // the one tap
    await expect.poll(async () => (await declinesOf(s.germany.inquiryId)).map(d => [d.rfq_item_id, d.reason])).toEqual([[s.items[0].id, 'discontinued']])
    await expect(one.locator(`[data-declined="${s.germany.id}"]`)).toContainText('Item discontinued')
    await expect(one.locator(`[data-waiting="${s.germany.id}"]`)).toHaveCount(0)
  })

  test('the item row menu: Copy price, Remove reply with an Undo, Edit reply goes to the price box', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const menu = () => page.getByRole('button', { name: `More for ${s.usd.name}` }).click()
    await menu()
    await page.getByRole('menuitem', { name: 'Copy price' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('USD 100.00')

    await menu()
    await page.getByRole('menuitem', { name: 'Edit reply' }).click()
    await expect(page.getByLabel(`Price for item 1 from ${s.usd.name}`)).toBeFocused()

    await menu()
    await page.getByRole('menuitem', { name: 'Remove reply' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reply removed' })).toBeVisible()
    await expect.poll(async () => (await linesOf(s.usd.inquiryId)).length).toBe(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await linesOf(s.usd.inquiryId)).length).toBe(1)
    const [back] = await linesOf(s.usd.inquiryId)
    expect(back).toMatchObject({ currency: 'USD', unit_price: 100, lead_time: '3 weeks' })
    expect(Number(back.fx_rate_pkr)).toBe(280) // the rate it was entered at comes back with it
  })

  test('Add item puts a new item on the RFQ: only the description is required', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await page.getByRole('button', { name: 'Add item' }).click()
    await page.getByRole('button', { name: 'Add item' }).last().click()
    await expect(page.getByText('Describe the item')).toBeVisible()
    await page.getByLabel('Description').fill(`Gauge GG${s.tag} 0-6 bar`)
    await page.getByRole('button', { name: 'Add item' }).last().click()
    await expect(page.getByRole('article', { name: 'Item 3' })).toContainText(`Gauge GG${s.tag} 0-6 bar`)
    const rows = await must(rest<{ description: string; qty: number; position: number }[]>('admin', `rfq_items?rfq_id=eq.${s.rfq.id}&order=position&select=description,qty,position`))
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ description: `Gauge GG${s.tag} 0-6 bar`, qty: 1, position: 2 })
  })
})

test.describe('the rate bar and Exchange rates (R15)', () => {
  test('the bar shows today\'s rate per currency with its age; entering a missing rate on Settings updates the ranking', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'fx_rates?currency=eq.JPY', { method: 'DELETE' }))
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' }, // PKR 28,000
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[0].id, unit_price: 5000, currency: 'JPY' }, // PKR 9,000 once JPY has a rate
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 90, currency: 'EUR' }, // PKR 27,000 on a stale rate
    ] }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const bar = page.locator('[data-ratebar]')
    await expect(bar).toContainText("Today's rates, PKR per unit")
    await expect(bar.locator('[data-rate="USD"]')).toContainText('USD 280.00')
    await expect(bar.locator('[data-rate="USD"]')).toContainText('by hand · today')
    await expect(bar.locator('[data-rate="EUR"]')).toContainText('12 days ago, stale')
    await expect(bar.locator('[data-rate="EUR"]')).toHaveAttribute('data-band', 'stale')
    await expect(bar.locator('[data-rate="JPY"]')).toContainText(/JPY\s*no rate, not compared/)
    // JPY is not compared: EUR is the lowest of the two that are.
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-lowest]')).toContainText(s.china.name)

    await bar.getByRole('link', { name: 'Exchange rates' }).click()
    await expect(page).toHaveURL(/\/settings\/exchange-rates$/)
    await expect(page.getByRole('heading', { name: 'Exchange rates', level: 1 })).toBeVisible()
    await expect(page.getByRole('row', { name: /USD/ })).toContainText('Fresh')
    await expect(page.getByRole('row', { name: /EUR/ })).toContainText('Stale, 12 days')
    await expect(page.getByRole('row', { name: /JPY/ })).toContainText('No rate yet')

    // Anyone on the team can enter today's rate by hand.
    await page.getByLabel('Currency', { exact: true }).selectOption('JPY')
    await page.getByLabel('Rate, PKR for 1 unit').fill('1.8')
    await page.getByRole('button', { name: 'Save rate' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Rate saved' })).toBeVisible()
    const saved = await must(rest<{ rate_pkr: number; source: string }[]>('admin', `fx_rates?currency=eq.JPY&select=rate_pkr,source`))
    expect(saved).toEqual([{ rate_pkr: 1.8, source: 'manual' }])
    await expect(page.getByRole('row', { name: /JPY/ })).toContainText('Fresh')
    await review(page, 'exchange-rates-1440')

    await page.goto(`/rfqs/${s.rfq.id}`)
    const lowest = page.getByRole('article', { name: 'Item 1' }).locator('[data-lowest]')
    await expect(lowest).toContainText(s.germany.name)
    await expect(lowest).toContainText('9,000')
    await expect(page.locator('[data-ratebar] [data-rate="JPY"]')).toContainText('JPY 1.80')
  })

  test('the Exchange rates page: an engineer can add a rate, a bad figure is refused in words', async ({ page }) => {
    await openAs(page, 'engineer', '/settings/exchange-rates')
    await expect(page.getByRole('link', { name: 'Exchange rates' })).toBeVisible() // in the Settings list
    await page.getByLabel('Rate, PKR for 1 unit').fill('abc')
    await expect(page.getByText('Enter a rate above zero')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save rate' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: /^Recent .* rates$/ })).toBeVisible()
  })
})

test.describe('Suppliers asked, Float to another supplier, and the empty state (C-42, C-44, C-46, C-50)', () => {
  test('each supplier shows its chips, a memory line and when it was sent; Float lists suppliers with reasons and records the asking, with an Undo', async ({ page }) => {
    const s = await seed({ brand: true })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const rail = page.locator('[data-slot="suppliers-asked"]')
    await expect(rail).toContainText('3 asked · 0 replied')
    const usd = rail.locator(`[data-supplier-asked="${s.usd.id}"]`)
    await expect(usd).toContainText(/Asked (once|twice), 1 reply\. Not enough history to say more\./)
    await expect(usd).toContainText('Sent ')
    await expect(usd.getByText('Awaiting reply')).toBeVisible()

    await rail.getByRole('button', { name: 'Float to another supplier' }).click()
    const dialog = page.getByRole('dialog', { name: /Float to another supplier/ })
    await expect(dialog).toContainText(s.carrier!.name)
    await expect(dialog).toContainText('Carries ') // the reason is in plain words (Carries the brand ...)
    await dialog.locator('label', { hasText: s.carrier!.name }).click()
    await dialog.getByRole('button', { name: 'Copy enquiry for 1 supplier' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Enquiry text copied' })).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(s.items[0].description)
    expect(text).toContain(`RFQ-${String(s.rfq.number).padStart(4, '0')}`)
    expect(text).not.toContain(s.customer)
    const made = await must(rest<{ sent_on: string | null; id: string }[]>('admin', `supplier_inquiries?rfq_id=eq.${s.rfq.id}&supplier_id=eq.${s.carrier!.id}&select=id,sent_on`))
    expect(made).toHaveLength(1)
    expect(made[0].sent_on).toBe(today())
    await expect(rail).toContainText('4 asked')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await must(rest<unknown[]>('admin', `supplier_inquiries?rfq_id=eq.${s.rfq.id}&supplier_id=eq.${s.carrier!.id}&select=id`))).length).toBe(0)
  })

  test('nobody asked yet: the Ask suppliers block, No replies yet on every item, and Suppliers to ask copies one enquiry for every item', async ({ page }) => {
    const s = await seed({ brand: true, asked: false })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const panel = page.locator('[data-slot="items"]')
    await expect(panel).toContainText('2 items · nobody asked yet')
    await expect(panel.getByRole('heading', { name: 'Ask suppliers for prices' })).toBeVisible()
    await expect(panel).toContainText('Pick the suppliers on the right.')
    await expect(page.getByText('No supplier has been asked about this item.')).toHaveCount(2)
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('No replies yet')).toBeVisible()
    const card = page.locator('[data-slot="suppliers-to-ask"]')
    await expect(card).toContainText('suggested')
    await expect(card).toContainText(s.carrier!.name)
    await card.locator('label', { hasText: s.carrier!.name }).click()
    await card.getByRole('button', { name: 'Copy enquiry for 1 supplier' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Enquiry text copied' })).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(s.items[0].description)
    expect(text).toContain(s.items[1].description) // every item
    await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText(s.carrier!.name)
    await review(page, 'rfq-detail-04-empty-asked-1440')
  })

  test('an uncovered item lists suppliers to try, each with Copy enquiry text for that item only', async ({ page }) => {
    const s = await seed({ brand: true })
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[1].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('Uncovered item')).toBeVisible()
    await expect(one.getByText(/None of the 1 supplier who replied quoted this item/)).toBeVisible()
    await expect(one.getByText("Float it to someone else before the customer's bid is due.")).toBeVisible()
    await one.getByRole('button', { name: `Copy enquiry text for ${s.carrier!.name}` }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Enquiry text copied' })).toBeVisible()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(s.items[0].description)
    expect(text).not.toContain(s.items[1].description) // this item only
    const made = await must(rest<{ id: string }[]>('admin', `supplier_inquiries?rfq_id=eq.${s.rfq.id}&supplier_id=eq.${s.carrier!.id}&select=id`))
    expect(made).toHaveLength(1)
  })
})

test.describe('optional fields (migration 0039): bid time, company city, contact title, owner phone', () => {
  test('they appear where the mockup shows them, and the phone prints under an email chase signature', async ({ page }) => {
    const s = await seed()
    const ADMIN = 'a0000000-0000-4000-8000-000000000001'
    const co = (await must(rest<{ company_id: string }[]>('admin', `rfqs?id=eq.${s.rfq.id}&select=company_id`)))[0].company_id
    const contact = (await must(rest<{ id: string }[]>('admin', 'contacts', { method: 'POST', body: { company_id: co, name: 'Mr. Tariq Mehmood', phone: '+92 300 555 0142', job_title: 'Procurement Manager' } })))[0]
    await must(rest('admin', `rfqs?id=eq.${s.rfq.id}`, { method: 'PATCH', body: { due_time: '17:00', contact_id: contact.id } }))
    await must(rest('admin', `companies?id=eq.${co}`, { method: 'PATCH', body: { city: 'Faisalabad' } }))
    await must(rest('admin', `companies?id=eq.${s.china.id}`, { method: 'PATCH', body: { city: 'Shenzhen' } }))
    await must(rest('admin', `users?id=eq.${ADMIN}`, { method: 'PATCH', body: { phone: '+92 300 555 0188' } }))
    try {
      await openAs(page, 'admin', `/rfqs/${s.rfq.id}`)
      const meta = page.locator('dl').first()
      await expect(meta).toContainText(`${formatLong(s.dueDate)}, 17:00`) // the bid time
      await expect(meta).toContainText('Faisalabad') // under the site
      await expect(meta).toContainText('Procurement Manager') // under the contact
      await expect(meta).toContainText('+92 300 555 0188') // the owner's phone, beside the role
      await expect(row(page, s.china.name)).toContainText('Shenzhen, China')
      const card = page.locator(`[data-chase-card="${s.china.id}"]`)
      await card.getByRole('radio', { name: 'Email' }).click()
      await expect(card.locator('pre')).toContainText('Q-Tech Solutions\n+92 300 555 0188')
    } finally {
      await rest('admin', `users?id=eq.${ADMIN}`, { method: 'PATCH', body: { phone: null } })
    }
  })
})

test.describe('the phone layout (C-100 to C-105)', () => {
  test('a page bar with back, a sticky action bar with Issue quotation, Chase and more menus', async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const bar = page.locator('[data-page-bar]')
    await expect(bar.getByRole('link', { name: 'Back to RFQs' })).toBeVisible()
    await expect(bar).toContainText(`RFQ-${String(s.rfq.number).padStart(4, '0')}`)
    // Four meta cells, no icons: customer ref, bid due, contact, owner.
    await expect(page.locator('dl > div:visible')).toHaveCount(4)
    const actions = page.locator('[data-action-bar]')
    await expect(actions).toBeVisible()
    const box = await actions.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44) // 44 px tap targets
    for (const name of ['Issue quotation', 'Chase', 'More actions']) {
      const b = await actions.getByRole('button', { name, exact: true }).boundingBox()
      expect(b!.height, name).toBeGreaterThanOrEqual(44)
    }
    // It stays at the foot while the page scrolls.
    await page.evaluate(() => document.getElementById('main')?.scrollTo(0, 600))
    await expect(actions).toBeInViewport()
    await actions.getByRole('button', { name: 'Chase', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Chase suppliers/ })).toContainText('3')
    await page.getByRole('menuitem', { name: /Chase suppliers/ }).click()
    await expect(page.locator('[data-slot="suppliers-asked"]')).toBeInViewport()
    await actions.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Mark won' })).toBeVisible() // as in the mockup's phone menu
    await expect(page.getByRole('menuitem', { name: /Sent the offer again/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await review(page, 'rfq-detail-mobile-bar-375')
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

    if (width > 800) {
      await bidAndClose(page).click()
      await expect(page.getByRole('menu', { name: 'Bid and close' })).toBeVisible()
      expect(await overlayViolations(page)).toEqual([])
      await review(page, `rfq-detail-bid-and-close-menu-${width}`)
      await page.keyboard.press('Escape')
    } else {
      await expect(page.locator('[data-action-bar]')).toBeVisible()
      await page.getByRole('button', { name: 'Chase', exact: true }).click()
      await expect(page.getByRole('menu', { name: 'Chase' })).toBeVisible()
      expect(await overlayViolations(page)).toEqual([])
      await review(page, `rfq-detail-chase-menu-${width}`)
      await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: 'Float to another supplier' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await overlayViolations(page)).toEqual([])
    await review(page, `rfq-detail-float-dialog-${width}`)
  })
}
