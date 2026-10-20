import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'

/*
 * R07 end to end, against the local CI stack: the RFQ detail page, as the fixture users through the real login form.
 * Every test seeds its own companies and RFQ (unique names), so tests do not depend on each other.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2; the UX audit of 2026-10-19 moved the rare actions into More):
 *   Supplier reply        at most 1 typed price per item, currency never typed (then one Save reply); the reply is already open
 *   Paste reply           paste + accept, at most 2 actions (nothing is saved until Accept)
 *   Can't quote           1 tap
 *   Chase                 1 tap for EVERY supplier asked (Copy and mark chased on the one shown, Chase on the others)
 *   Mark quotation sent   2 taps (More, then the item): a quotation issued from the app is marked sent by Issue itself
 *   Lose / close          at most 2 taps (open More, choose the reason; the suggested one is marked)
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
    // Every supplier still owing a reply has it open, ready to type into: no tap first.
    const cn = row(page, s.china.name)
    await expect(cn.getByText('Prices in CNY, usual for China.')).toBeVisible()
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

    // The price line shows the supplier's own figure, not compared; the reply row closes to one line with Edit reply.
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('not compared, no rate').first()).toBeVisible()
    await expect(page.locator(`[data-reply-row="${s.china.id}"]`).getByRole('button', { name: `Edit reply, ${s.china.name}` })).toBeVisible()
    await one.getByRole('button', { name: `Show details for ${s.china.name}` }).click()
    await expect(one.getByText('not compared — no rate').first()).toBeVisible()
    await expect(one.locator('[data-status="fx-capture:none"]').first()).toHaveText('No rate') // a chip only when the rate is a problem
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
    // One line: the PKR figure, the lead time; the supplier's own figure and the rates open on request.
    await expect(item.locator('[data-compared]')).toContainText('28,000')
    await expect(item.locator('[data-compared]')).toContainText('3 weeks')
    await expect(item.getByText("USD 280.00, today's rate")).toHaveCount(0)
    await item.getByRole('button', { name: `Show details for ${s.usd.name}` }).click()
    await expect(item.getByText('Quoted USD 100.00')).toBeVisible()
    await expect(item.getByText("USD 280.00, today's rate")).toBeVisible()
    await expect(item.getByText(/At entry 280\.00/)).toBeVisible()
    await expect(item.getByText('Rate from today')).toBeVisible() // a fresh rate is its age in words, no chip
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
    await r.getByRole('button', { name: 'Accept 2 prices' }).click() // action 2: accept all
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
  test('one Recommended mark at today\'s rate; stale rates are labelled in the details; a line with no rate is left out', async ({ page }) => {
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
    await expect(lowest).toContainText('Recommended') // the cheapest is ranked first: one mark, no "Cheapest" line
    await expect(art.getByText('Recommended', { exact: true })).toHaveCount(1)
    await expect(art.locator('[data-cheapest]')).toHaveCount(0)
    await expect(lowest).toContainText('27,000')
    // The rate behind the figure is one tap away.
    await lowest.getByRole('button', { name: `Show details for ${s.germany.name}` }).click()
    await expect(lowest).toContainText('rate 12 days old')
    await expect(lowest.locator('[data-status="fx:stale"]')).toContainText('Old rate')
    // The CNY line is out of the comparison: its own figure, marked not compared, listed after the ranked ones.
    const cny = art.locator('li[data-ranked]', { hasText: s.china.name })
    await expect(cny).toContainText('not compared, no rate')
    await expect(cny.locator('[data-lowest]')).toHaveCount(0)
    await cny.getByRole('button', { name: `Show details for ${s.china.name}` }).click()
    await expect(cny).toContainText('Not ranked: no current CNY rate. Add one.')
    await expect(cny.getByRole('link', { name: 'Add CNY rate' })).toBeVisible()
    // The rule is said once, in a tip in the panel header, not above every item.
    await expect(page.getByRole('button', { name: 'How are prices compared?' })).toHaveCount(1)
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
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('2 prices so far', { exact: true })).toBeVisible()
    await expect(page.locator('[data-lowest]')).toHaveCount(0)
  })

  test('an item nobody priced is flagged uncovered once someone has replied', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const art = page.getByRole('article', { name: 'Item 2' })
    await expect(art.getByText('No price yet', { exact: true })).toBeVisible()
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
    // The supplier's reply row closes to one line: the reason and Take back.
    const closed = page.locator(`[data-reply-row="${s.china.id}"]`)
    await expect(closed).toContainText("Can't quote: Doesn't carry this brand")
    const after = await inquiryOf(s.china.inquiryId)
    expect(after.no_offer_on).toBe(today())
    expect(after.no_offer_reason).toBe('no_brand') // a stored key, not a phrase
    expect(after.notes).toBe('Call Imran on Monday') // the notes belong to people and are never written
    await expect(page.getByRole('article', { name: 'Item 1' }).locator(`[data-declined="${s.china.id}"]`)).toContainText("Doesn't carry this brand")

    await closed.getByRole('button', { name: 'Take back' }).click()
    await expect(r.getByRole('button', { name: "Doesn't carry this brand" })).toBeVisible() // a reply is expected again: open again
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
    await resetClipboard(page)
    await card.getByRole('button', { name: 'Copy and mark chased' }).click() // the one tap
    await expect(page.getByRole('status').filter({ hasText: 'Chase text copied' })).toBeVisible()
    const text = await readClipboardWhen(page, `ref *RFQ-${String(s.rfq.number).padStart(4, '0')}*`)
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
    await resetClipboard(page)
    await card.getByRole('button', { name: 'Copy and mark chased' }).click()
    await readClipboardWhen(page, 'A second reminder')
    expect((await inquiryOf(s.china.inquiryId)).chase_count).toBe(2)
  })

  test('the card shows a short preview and the recipient; the whole message lists only the items still without a price; Email is a link; another supplier is one tap away', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 5, currency: 'CNY' } }))
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: s.china.id, name: 'Mr. Li Wei', phone: '+86 138 0000 0000', email: 'li@hengxin.example' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const card = page.locator(`[data-chase-card="${s.china.id}"]`)
    await expect(card.getByText('WhatsApp to Mr. Li Wei')).toBeVisible()
    await expect(card.getByText('+86 138 0000 0000')).toBeVisible()
    // A preview: the ticks and the reply-by date wait under "Show the whole message".
    await expect(card.getByRole('group', { name: 'Items still without a price from this supplier' })).toHaveCount(0)
    await card.getByRole('button', { name: 'Show the whole message' }).click()
    await expect(card.getByRole('group', { name: 'Items still without a price from this supplier' })).toBeVisible()
    await expect(card.getByText('Thank you for pricing item 1.')).toBeVisible()
    await expect(card.locator('pre')).toContainText(s.items[1].description)
    await expect(card.locator('pre')).not.toContainText(s.items[0].description)
    await card.getByRole('button', { name: 'Email instead' }).click()
    await expect(card.getByText('Email to Mr. Li Wei')).toBeVisible()
    await expect(card.getByText('li@hengxin.example', { exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Copy subject' })).toBeVisible()
    await expect(card.getByText(/^RFQ-\d+: price needed/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'WhatsApp instead' })).toBeVisible()
    // Another supplier: "Show message" opens its card.
    await page.getByRole('button', { name: `Show message, ${s.usd.name}` }).click()
    await expect(page.locator(`[data-chase-card="${s.usd.id}"]`)).toBeVisible()
  })

  test('every supplier asked has its own Chase button: 1 tap copies its text and marks it chased (FE-2)', async ({ page }) => {
    const s = await seed({ dueInDays: 8 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    // Not the supplier shown in the card: the Germany supplier, straight from its entry in Suppliers asked.
    await resetClipboard(page)
    await page.getByRole('button', { name: `Chase ${s.germany.name}`, exact: true }).click()
    taps++
    expect(taps).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Chase text copied' })).toBeVisible()
    const text = await readClipboardWhen(page, 'Following up on our enquiry')
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

const more = (page: Page) => page.getByRole('button', { name: 'More', exact: true })

test.describe('quotation sent and close or lose (the More menu)', () => {
  test('mark quotation sent (no PDF) is 2 taps from More, with an Undo; then the green button is Mark won, and More keeps Quotation sent again', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    let taps = 0
    await more(page).click()
    taps++
    await page.getByRole('menuitem', { name: /Mark quotation sent/ }).click()
    taps++
    expect(taps).toBe(2)
    await expect(page.getByRole('status').filter({ hasText: 'Marked quotation sent' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBe(today())
    await expect(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' })).toBeVisible() // now the green one
    await expect(page.locator('[data-stage]')).toHaveText('Quotation sent')
    await more(page).click()
    await expect(page.getByRole('menuitem', { name: /Quotation sent again/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Mark quotation sent/ })).toHaveCount(0) // already sent
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBeNull()

    // Quotation sent again re-stamps the date (an older date is moved to today).
    await must(rest('admin', `rfqs?id=eq.${s.rfq.id}`, { method: 'PATCH', body: { quoted_on: karachiDay(-5) } }))
    await page.reload()
    await more(page).click()
    await page.getByRole('menuitem', { name: /Quotation sent again/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Quotation date updated' })).toBeVisible()
    await expect.poll(async () => (await rfqOf(s.rfq.id)).quoted_on).toBe(today())
  })

  test('close or lose is two taps (open More, choose the reason); the reason the state points to is marked suggested', async ({ page }) => {
    const s = await seed()
    // Nobody can supply it: that reason is the suggested one.
    await must(rest('admin', 'supplier_inquiries?rfq_id=eq.' + s.rfq.id, { method: 'PATCH', body: { no_offer_on: karachiDay(0) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    // Everyone said no: the green button asks someone else.
    await expect(page.locator('[data-slot="ask-suppliers"]').getByRole('button', { name: 'Ask more suppliers' })).toBeVisible()
    let taps = 0
    await more(page).click()
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
  test('one Items and supplier prices panel with Add item; replies and Quotations under it; Suppliers asked, Questions and Files in the rail', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const items = page.locator('[data-slot="items"]')
    await expect(items.getByRole('heading', { name: 'Items and supplier prices', level: 2 })).toBeVisible()
    await expect(page.locator('[data-slot="replies"]').getByRole('heading', { name: 'Replies from suppliers', level: 2 })).toBeVisible()
    await expect(items.getByRole('button', { name: 'Add item' })).toBeVisible()
    await expect(items).toContainText('2 items · 3 suppliers asked · 0 items have a price')
    await expect(page.locator('[data-slot="quotations"]')).toBeVisible()
    await expect(page.locator('aside [data-slot="quotations"]')).toHaveCount(0) // not in the rail
    const rail = page.locator('aside')
    await expect(rail.getByRole('heading', { name: 'Suppliers asked' })).toBeVisible()
    await expect(rail).toContainText('3 asked · 0 replied')
    await expect(rail.getByRole('heading', { name: 'Questions for the customer' })).toBeVisible()
    await expect(rail.getByRole('heading', { name: 'Files' })).toBeVisible()
    // The header: at most two chips, ONE green button by state (waiting for prices: the supplier chase in the rail), the rest in More.
    await expect(page.locator('header:has(h1) > div [data-status]')).toHaveCount(2) // the chip row under the title, none in the h1
    await expect(page.locator('h1 [data-status]')).toHaveCount(0)
    await expect(page.locator('[data-stage]')).toHaveText('Waiting for prices')
    // The h1 is the company, a link to it; the facts strip has no Company cell.
    await expect(page.getByRole('heading', { level: 1 }).getByRole('link')).toHaveAttribute('href', /\/companies\//)
    await expect(page.locator('dt', { hasText: /^Company$/ })).toHaveCount(0)
    await expect(page.locator('#main button.bg-primary:not([disabled]):visible')).toHaveCount(1)
    // The green one is in the Next step box under the title (coordinator decision 2026-10-20), and goes to the chase in the rail.
    const next = page.getByRole('region', { name: 'Next step' })
    await expect(next).toContainText('Waiting for prices from 3 suppliers. Chase them.')
    await expect(next.getByRole('button', { name: 'Chase suppliers' })).toHaveClass(/bg-primary/)
    await expect(page.locator(`[data-chase-card="${s.china.id}"]`).getByRole('button', { name: 'Copy and mark chased' })).not.toHaveClass(/bg-primary/)
    await next.getByRole('button', { name: 'Chase suppliers' }).click()
    await expect(page.locator(`[data-chase-card="${s.china.id}"]`).getByRole('button', { name: 'Copy and mark chased' })).toBeFocused()
    // Issue quotation is never silently disabled: it is in More and opens (prices can be typed in the dialog).
    await more(page).click()
    await expect(page.getByRole('menuitem', { name: /Issue quotation/ })).toBeEnabled()
    await expect(page.getByRole('menuitem', { name: /Mark won/ })).toContainText('no quotation yet')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Bid and close' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close or lose' })).toHaveCount(0)
    // Owner role and customer since sit under their values.
    await expect(page.locator('dl').first()).toContainText('Customer since')
    await expect(page.locator('dl').first()).toContainText('Admin')
  })

  test('coverage reads "1 price so far" while a supplier has said nothing, "1 price" when everybody has answered', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('1 price so far', { exact: true })).toBeVisible()
    await expect(one.locator(`[data-waiting="${s.china.id}"]`)).toContainText(`Waiting on ${s.china.name}`)
    await expect(one.locator(`[data-waiting="${s.china.id}"]`)).toContainText('asked')
    // A price is in: Issue quotation is the green button.
    await expect(page.locator('[data-slot="issue-quotation"]').getByRole('button', { name: 'Issue quotation' })).toBeVisible()
    await expect(page.locator('#main button.bg-primary:not([disabled]):visible')).toHaveCount(1)
    // The others answer something: nobody is waiting any more.
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'CNY' },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'EUR' },
    ] }))
    await page.reload()
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('1 price', { exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-waiting]')).toHaveCount(0)
  })

  test("a waiting supplier is one line with a Can't quote menu that records the reason for that item in one tap; Add reply is not repeated on items", async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    const waiting = one.locator(`[data-waiting="${s.germany.id}"]`)
    await expect(one.getByRole('button', { name: /Add reply/ })).toHaveCount(0)
    // The price boxes of a supplier still owing a reply are already open below, one row per supplier.
    await expect(page.getByLabel(`Price for item 1 from ${s.germany.name}`)).toBeVisible()
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
    await resetClipboard(page)
    await page.getByRole('menuitem', { name: 'Copy price' }).click()
    await readClipboardWhen(page, t => t === 'USD 100.00')

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
    await expect(page.getByRole('row', { name: /USD/ })).not.toContainText('Old rate') // a fresh rate: its age as text, no chip
    await expect(page.getByRole('row', { name: /EUR/ })).toContainText(/Old rate\s*12 days old/)
    await expect(page.getByRole('row', { name: /JPY/ })).toContainText('No rate yet')

    // Anyone on the team can enter today's rate by hand.
    await page.getByLabel('Currency', { exact: true }).selectOption('JPY')
    await page.getByLabel('Rate, PKR for 1 unit').fill('1.8')
    await page.getByRole('button', { name: 'Save rate' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Rate saved' })).toBeVisible()
    const saved = await must(rest<{ rate_pkr: number; source: string }[]>('admin', `fx_rates?currency=eq.JPY&select=rate_pkr,source`))
    expect(saved).toEqual([{ rate_pkr: 1.8, source: 'manual' }])
    await expect(page.getByRole('row', { name: /JPY/ })).toContainText('today') // fresh: the age as text
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

test.describe('Suppliers asked, Ask more suppliers, and the empty state (C-42, C-44, C-46, C-50)', () => {
  test('each supplier shows its chip, a memory line and when it was sent; Ask more suppliers lists suppliers with reasons and records the asking, with an Undo', async ({ page }) => {
    const s = await seed({ brand: true })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const rail = page.locator('[data-slot="suppliers-asked"]')
    await expect(rail).toContainText('3 asked · 0 replied')
    const usd = rail.locator(`[data-supplier-asked="${s.usd.id}"]`)
    await expect(usd).toContainText(/Asked (once|twice), 1 reply\. Not enough history to say more\./)
    await expect(usd).toContainText('Sent ')
    await expect(usd.locator('[data-status^="inquiry:"]')).toHaveCount(1) // one chip per supplier
    await expect(usd.locator('[data-status^="inquiry:"]')).toContainText('Waiting for prices')

    await rail.getByRole('button', { name: 'Ask more suppliers' }).click()
    const dialog = page.getByRole('dialog', { name: /Ask more suppliers/ })
    await expect(dialog).toContainText(s.carrier!.name)
    await expect(dialog).toContainText('Carries ') // the reason is in plain words (Carries the brand ...)
    await dialog.locator('label', { hasText: s.carrier!.name }).click()
    await resetClipboard(page)
    await dialog.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Message copied' })).toBeVisible()
    const text = await readClipboardWhen(page, s.items[0].description)
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

  test('nobody asked yet: Ask suppliers is the green button, every item needs suppliers, and Suppliers to ask copies one message for every item', async ({ page }) => {
    const s = await seed({ brand: true, asked: false })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const panel = page.locator('[data-slot="items"]')
    await expect(panel).toContainText('2 items · nobody asked yet')
    await expect(panel).toContainText('Ask suppliers for prices. One tap copies a message listing every item')
    await expect(page.getByText('No supplier has been asked about this item.')).toHaveCount(2)
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-status]')).toHaveCount(0) // no item chip while nobody is asked: the header says it
    await expect(page.locator('[data-stage]')).toHaveText('Needs suppliers')
    await expect(page.locator('[data-slot="ask-suppliers"]').getByRole('button', { name: 'Ask suppliers' })).toHaveClass(/bg-primary/)
    await expect(page.locator('#main button.bg-primary:not([disabled]):visible')).toHaveCount(1)
    // The green button opens the same list as a dialog.
    await page.locator('[data-slot="ask-suppliers"]').getByRole('button', { name: 'Ask suppliers' }).click()
    await expect(page.getByRole('dialog', { name: /Ask suppliers/ })).toContainText(s.carrier!.name)
    await page.keyboard.press('Escape')
    const card = page.locator('[data-slot="suppliers-to-ask"]')
    await expect(card).toContainText('suggested')
    await expect(card).toContainText(s.carrier!.name)
    await card.locator('label', { hasText: s.carrier!.name }).click()
    await resetClipboard(page)
    await card.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Message copied' })).toBeVisible()
    const text = await readClipboardWhen(page, s.items[0].description)
    expect(text).toContain(s.items[0].description)
    expect(text).toContain(s.items[1].description) // every item
    await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText(s.carrier!.name)
    await review(page, 'rfq-detail-04-empty-asked-1440')
  })

  test('an item nobody priced lists suppliers to try, each with Copy message for that item only', async ({ page }) => {
    const s = await seed({ brand: true })
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[1].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('No price yet', { exact: true })).toBeVisible()
    await expect(one.getByText(/None of the 1 supplier who replied quoted this item/)).toBeVisible()
    await expect(one.getByText(/Ask someone else before the quotation is due\./)).toBeVisible()
    await resetClipboard(page)
    await one.getByRole('button', { name: `Copy message for ${s.carrier!.name}` }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Message copied' })).toBeVisible()
    const text = await readClipboardWhen(page, s.items[0].description)
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
      await card.getByRole('button', { name: 'Email instead' }).click()
      await expect(card.locator('pre')).toContainText('Q-Tech Solutions\n+92 300 555 0188')
    } finally {
      await rest('admin', `users?id=eq.${ADMIN}`, { method: 'PATCH', body: { phone: null } })
    }
  })
})

/** The page's own content never scrolls sideways. */
async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => {
    const main = document.querySelector('#main') as HTMLElement | null
    const edge = main?.getBoundingClientRect().right ?? window.innerWidth
    // The widest offenders, named in a miss, so the fix is one look away.
    const wide = Array.from(main?.querySelectorAll<HTMLElement>('*') ?? [])
      .filter(e => e.getBoundingClientRect().right > edge + 1 && e.getClientRects().length > 0)
      .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 90)} [${Math.round(e.getBoundingClientRect().width)}px]`)
      .slice(0, 6)
    return { scroll: main?.scrollWidth ?? 0, client: main?.clientWidth ?? 0, right: main?.getBoundingClientRect().right ?? 0, view: window.innerWidth, wide }
  })
  expect(m.scroll, `the content scrolls sideways: ${m.wide.join(' | ')}`).toBeLessThanOrEqual(m.client + 1)
  expect(m.right, 'the content is wider than the window').toBeLessThanOrEqual(m.view + 1)
}

test.describe('the phone layout (C-100 to C-105; UX audit: one bar)', () => {
  test('ONE bar with back and the number, no bottom tabs, and a sticky action bar with the green action, Chase and More', async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: 375, height: 812 })
    // Opened from the board, inside the app: back returns there (history), not to a fixed place.
    await openAs(page, 'sales', '/rfqs?owner=all')
    await page.getByRole('textbox', { name: 'Search RFQs' }).fill(s.customer)
    await page.getByRole('link', { name: s.customer }).first().click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/${s.rfq.id}$`))
    const bar = page.locator('header[data-mobile-bar="detail"]')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText(`RFQ-${String(s.rfq.number).padStart(4, '0')}`)
    await expect(page.locator('header[data-mobile-bar="default"]')).toHaveCount(0) // one bar, not two
    await expect(page.locator('[data-page-bar]')).toHaveCount(0)
    await expect(page.locator('nav[aria-label="Main"]:visible')).toHaveCount(0) // the tabs step aside for the action bar
    // Four meta cells, no icons: customer ref, quotation due, contact, owner.
    await expect(page.locator('dl > div:visible')).toHaveCount(4)
    const actions = page.locator('[data-action-bar]')
    await expect(actions).toBeVisible()
    const box = await actions.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44) // 44 px tap targets
    // Waiting for prices: the green action is the supplier chase.
    for (const name of ['Chase suppliers', 'Chase', 'More actions']) {
      const b = await actions.getByRole('button', { name, exact: true }).boundingBox()
      expect(b!.height, name).toBeGreaterThanOrEqual(44)
    }
    await expect(actions.getByRole('button', { name: 'Chase suppliers', exact: true })).toHaveClass(/bg-primary/)
    await noSidewaysScroll(page)
    // It stays at the foot while the page scrolls.
    await page.evaluate(() => document.getElementById('main')?.scrollTo(0, 600))
    await expect(actions).toBeInViewport()
    await actions.getByRole('button', { name: 'Chase', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Chase suppliers/ })).toContainText('3')
    await page.getByRole('menuitem', { name: /Chase suppliers/ }).click()
    await expect(page.locator('[data-slot="suppliers-asked"]')).toBeInViewport()
    await actions.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Mark won/ })).toBeVisible() // reachable for the odd case, marked
    await expect(page.getByRole('menuitem', { name: /Mark won/ })).toContainText('no quotation yet')
    await expect(page.getByRole('menuitem', { name: /Mark quotation sent/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Issue quotation/ })).toBeEnabled()
    await page.keyboard.press('Escape')
    // P9: a flex title with a basis class that is not a token (basis-48, basis-64) has no basis at all, so on a phone it is squeezed
    // to the width of its neighbours. Every title that sets a basis must keep at least 10rem of its row.
    const squeezed = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[class*="basis-["]')).filter(e => e.offsetParent !== null && e.getBoundingClientRect().width < 150).map(e => `${e.tagName} ${e.className}`),
    )
    expect(squeezed, 'no title with a flex basis is squeezed at 375').toEqual([])
    await review(page, 'rfq-detail-mobile-bar-375')
    // Back goes to where the person came from.
    await bar.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/rfqs\?owner=all$/)
  })

  test('with prices in, at 320 and 375: nothing scrolls sideways, and the green action is Issue quotation', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '8 to 10 weeks from PO', in_stock: true },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[0].id, unit_price: 90, currency: 'EUR', lead_time: null, in_stock: false },
    ] }))
    await page.setViewportSize({ width: 320, height: 740 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    for (const width of [320, 375]) {
      if (width !== 320) {
        await page.setViewportSize({ width, height: 740 })
        await page.reload()
      }
      await expect(page.getByRole('article', { name: 'Item 1' })).toBeVisible()
      await expect(page.locator('[data-action-bar]').getByRole('button', { name: 'Issue quotation', exact: true })).toHaveClass(/bg-primary/)
      await noSidewaysScroll(page)
      const one = page.getByRole('article', { name: 'Item 1' })
      await one.getByRole('button', { name: `Show details for ${s.usd.name}` }).click()
      await noSidewaysScroll(page)
      await review(page, `rfq-detail-prices-${width}`)
    }
  })
})

test.describe('the side column at 1366 (UX audit: never longer than the page beside it)', () => {
  test('with three suppliers asked, questions waiting and replies in, the rail ends before the main column', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks', in_stock: true },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[1].id, unit_price: 90, currency: 'EUR', lead_time: '2 weeks', in_stock: false },
    ] }))
    const ago = new Date(Date.now() - 4 * 86_400_000).toISOString()
    await must(rest('admin', 'clarifications', { method: 'POST', body: [
      // A bulk insert needs the same keys on every row.
      { rfq_id: s.rfq.id, question: 'Is the line size DN50 or DN80?', first_asked_at: ago, last_asked_at: ago, ask_count: 1 },
      { rfq_id: s.rfq.id, question: 'Which output, HART or 4 to 20 mA?', first_asked_at: null, last_asked_at: null, ask_count: 0 },
    ], prefer: 'return=minimal' }))
    await page.setViewportSize({ width: 1366, height: 768 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.locator(`[data-chase-card="${s.china.id}"]`)).toBeVisible()
    await expect(page.locator('[data-slot="clarifications"]')).toContainText('Is the line size DN50 or DN80?')
    const h = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Suppliers, questions and files"]') as HTMLElement | null
      const mainCol = aside?.previousElementSibling
      return {
        rail: aside?.getBoundingClientRect().height ?? 0,
        main: mainCol?.getBoundingClientRect().height ?? 0,
        sticky: aside ? getComputedStyle(aside).position : '',
        content: aside?.scrollHeight ?? 0,
      }
    })
    // The rail stays beside the page and scrolls on its own: it never runs on below the main column, whatever it holds.
    expect(h.sticky).toBe('sticky')
    expect(h.rail, `rail ${h.rail}px (content ${h.content}px) against main ${h.main}px`).toBeLessThanOrEqual(h.main)
    // Everything in it is still reachable: the last panel scrolls into view inside the rail.
    await page.locator('aside').getByRole('heading', { name: 'Files', level: 2 }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('heading', { name: 'Files', level: 2 })).toBeInViewport()
    await noSidewaysScroll(page)
    await review(page, 'rfq-detail-rail-1366')
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
      await more(page).click()
      await expect(page.getByRole('menu', { name: 'More' })).toBeVisible()
      expect(await overlayViolations(page)).toEqual([])
      await review(page, `rfq-detail-more-menu-${width}`)
      await page.keyboard.press('Escape')
      // The tip that explains the order opens and is clean too.
      await page.getByRole('button', { name: 'How are prices compared?' }).click()
      await expect(page.getByRole('dialog', { name: 'How are prices compared?' })).toBeVisible()
      expect(await overlayViolations(page)).toEqual([])
      await page.keyboard.press('Escape')
    } else {
      await expect(page.locator('[data-action-bar]')).toBeVisible()
      await page.getByRole('button', { name: 'Chase', exact: true }).click()
      await expect(page.getByRole('menu', { name: 'Chase' })).toBeVisible()
      expect(await overlayViolations(page)).toEqual([])
      await review(page, `rfq-detail-chase-menu-${width}`)
      await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: 'Ask more suppliers' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await overlayViolations(page)).toEqual([])
    await review(page, `rfq-detail-ask-dialog-${width}`)
  })
}

test.describe('reply currency for a supplier with no country (audit R1)', () => {
  test('the procurement leg currency pre-fills the reply', async ({ page }) => {
    const s = await seed()
    const buyer = await createCompany(uniqueName('Leg Buyer'))
    const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: buyer.id } })))[0]
    const withLeg = await createCompany(uniqueName('Legsup'))
    await must(rest('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: withLeg.id, currency: 'CNY' } }))
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: withLeg.id, sent_on: karachiDay(-1) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(row(page, withLeg.name).getByText(/CNY, their last reply/)).toBeVisible()
    await expect(row(page, withLeg.name).getByRole('group', { name: `Currency for ${withLeg.name}` })).toHaveCount(0)
  })

  test('nothing on file: no silent PKR. A chip row, no preselection, no save until one is picked; the pick is remembered', async ({ page }) => {
    const s = await seed()
    const bare = await createCompany(uniqueName('Baresup'))
    const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: bare.id, sent_on: karachiDay(-1) } })))[0]
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = row(page, bare.name)
    const chips = r.getByRole('group', { name: `Currency for ${bare.name}` })
    await expect(chips).toBeVisible()
    for (const c of ['USD', 'EUR', 'CNY', 'PKR']) await expect(chips.getByRole('button', { name: c, exact: true })).toBeVisible()
    await expect(chips.getByRole('button', { pressed: true })).toHaveCount(0) // nothing is preselected
    await r.getByLabel(`Price for item 1 from ${bare.name}`).fill('90')
    await expect(r.getByRole('button', { name: 'Save reply' })).toBeDisabled()
    expect(await linesOf(inq.id)).toEqual([])
    await chips.getByRole('button', { name: 'USD', exact: true }).click()
    await expect(r.getByRole('button', { name: 'Save reply' })).toBeEnabled()
    await r.getByRole('button', { name: 'Save reply' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
    expect((await linesOf(inq.id)).map(l => l.currency)).toEqual(['USD'])
    // Remembered: on another RFQ, this supplier is pre-filled from that reply and is never asked again.
    const other = await createRfq((await createCompany(uniqueName('Another Customer'))).id)
    await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: other.id, position: 0, description: 'Another item', qty: 1 } }))
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: other.id, supplier_id: bare.id, sent_on: karachiDay(-1) } }))
    await page.goto(`/rfqs/${other.id}`)
    await expect(row(page, bare.name).getByText(/USD, their last reply/)).toBeVisible()
    await expect(row(page, bare.name).getByRole('group', { name: `Currency for ${bare.name}` })).toHaveCount(0)
  })

  test('a supplier whose country is Pakistan keeps PKR, with no chip row', async ({ page }) => {
    const s = await seed()
    const pk = await createCompany(uniqueName('Pksup'), { country: 'Pakistan' })
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: pk.id, sent_on: karachiDay(-1) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(row(page, pk.name).getByText(/PKR, usual for Pakistan/)).toBeVisible()
    await expect(row(page, pk.name).getByRole('group', { name: `Currency for ${pk.name}` })).toHaveCount(0)
  })
})
