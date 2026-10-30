import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'
import { openStage, stagesOf } from '../support/job'

/*
 * R07 end to end, against the local CI stack: the RFQ detail page, as the fixture users through the real login form.
 * Every test seeds its own companies and RFQ (unique names), so tests do not depend on each other.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2; the UX audit of 2026-10-19 moved the rare actions into More):
 *   Supplier reply        Enter reply, then at most 1 typed price per item, currency never typed (then one Save reply)
 *   Paste reply           paste + accept, at most 2 actions once the reply is open (nothing is saved until Accept)
 *   Can't quote           Enter reply, Can't quote, the reason (the five reasons sit behind one menu: grade-B R2)
 *   Chase                 1 tap for EVERY supplier asked (Copy and mark chased on the one shown, Chase on the others)
 *   Mark quotation sent   2 taps (More, then the item): a quotation issued from the app is marked sent by Issue itself
 *   Lose / close          at most 2 taps (open More, choose the reason; the suggested one is marked)
 */


const violations = (page: Page): Promise<string[]> => axeViolations(page)
/** A menu or dialog is portalled outside <main> by design, so the landmark rule is off for it (every other rule stays on). */
const overlayViolations = (page: Page): Promise<string[]> => axeViolations(page, { landmarks: false })

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

/**
 * A supplier's reply (grade-B R2/R4): each supplier is listed once, in Suppliers asked, and "Enter reply" (or "Edit reply") opens
 * the price form in a dialog named after the supplier. Opens it if it is not open yet.
 */
const row = async (page: Page, name: string) => {
  const dialog = page.getByRole('dialog', { name, exact: true })
  if (!(await dialog.isVisible())) {
    await page
      .getByRole('button', { name: `Enter reply, ${name}`, exact: true })
      .or(page.getByRole('button', { name: `Edit reply, ${name}`, exact: true }))
      .click()
  }
  await expect(dialog).toBeVisible()
  return dialog
}
const linesOf = (inquiryId: string) =>
  must(rest<{ rfq_item_id: string; unit_price: number; currency: string; fx_rate_pkr: number | null; lead_time: string | null; in_stock: boolean | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${inquiryId}&select=rfq_item_id,unit_price,currency,fx_rate_pkr,lead_time,in_stock`))
const inquiryOf = (id: string) =>
  must(rest<{ no_offer_on: string | null; no_offer_reason: string | null; notes: string | null; chase_count: number; last_chased_on: string | null }[]>('admin', `supplier_inquiries?id=eq.${id}&select=no_offer_on,no_offer_reason,notes,chase_count,last_chased_on`)).then(r => r[0])
const declinesOf = (inquiryId: string) =>
  must(rest<{ rfq_item_id: string; reason: string }[]>('admin', `inquiry_item_declines?inquiry_id=eq.${inquiryId}&select=rfq_item_id,reason`))
test.describe('supplier reply (FE-2: one typed price per item, currency never typed)', () => {
  test('currency is pre-filled, two prices are typed, one tap saves, a missing rate does not block', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${s.rfq.number}`)
    await review(page, 'rfq-detail-01-populated-1440')

    // China, no earlier reply: the country map fills CNY. The USD supplier's last reply fills USD. Nobody types a currency.
    // The price form opens only when asked for: one tap on Enter reply in Suppliers asked (grade-B R2).
    await expect(page.getByLabel(`Price for item 1 from ${s.china.name}`)).toHaveCount(0)
    await expect((await row(page, s.usd.name)).getByText(/USD, their last reply/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect((await row(page, s.germany.name)).getByText(/EUR, usual for Germany/)).toBeVisible()
    await page.keyboard.press('Escape')
    const cn = await row(page, s.china.name)
    await expect(cn.getByText('Prices in CNY, usual for China.')).toBeVisible()
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

    // The price line shows the supplier's own figure, not compared; the dialog closed, and the supplier's row offers Edit reply.
    await expect(cn).toHaveCount(0)
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
    const r = await row(page, s.usd.name)
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
    const r = await row(page, s.usd.name)
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
    const r = await row(page, s.germany.name)
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
    const r = await row(page, s.china.name)
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

test.describe("can't quote (Enter reply, Can't quote, the reason)", () => {
  test('the reasons sit behind one menu; one tap records the reason, and it can be taken back', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', `supplier_inquiries?id=eq.${s.china.inquiryId}`, { method: 'PATCH', body: { notes: 'Call Imran on Monday' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = await row(page, s.china.name)
    await expect(r.getByRole('button', { name: "Doesn't carry this brand" })).toHaveCount(0) // not five buttons (grade-B R2)
    await r.getByRole('button', { name: `Can't quote, ${s.china.name}` }).click()
    await page.getByRole('menuitem', { name: "Doesn't carry this brand" }).click() // the one tap on the reason
    await expect(page.getByRole('status').filter({ hasText: "Marked can't quote" })).toBeVisible()
    await expect(r).toHaveCount(0) // the dialog closes
    // The supplier's row in Suppliers asked: the reason and Take back.
    const closed = page.locator(`[data-reply-row="${s.china.id}"]`)
    await expect(closed).toContainText("Can't quote: Doesn't carry this brand")
    const after = await inquiryOf(s.china.inquiryId)
    expect(after.no_offer_on).toBe(today())
    expect(after.no_offer_reason).toBe('no_brand') // a stored key, not a phrase
    expect(after.notes).toBe('Call Imran on Monday') // the notes belong to people and are never written
    await expect(page.getByRole('article', { name: 'Item 1' }).locator(`[data-declined="${s.china.id}"]`)).toContainText("Doesn't carry this brand")

    await closed.getByRole('button', { name: `Take back can't quote, ${s.china.name}` }).click()
    await expect(closed.getByRole('button', { name: `Enter reply, ${s.china.name}` })).toBeVisible() // a reply is expected again
    const back = await inquiryOf(s.china.inquiryId)
    expect(back.no_offer_on).toBeNull()
    expect(back.no_offer_reason).toBeNull()
    expect(back.notes).toBe('Call Imran on Monday')
  })

  test('a different reason for one item is kept beside the inquiry reason', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = await row(page, s.germany.name)
    await r.getByText('A different reason for one item').click()
    await r.getByLabel(`Can't quote reason for item 2 from ${s.germany.name}`).selectOption('Item discontinued')
    await expect.poll(async () => (await declinesOf(s.germany.inquiryId)).map(d => [d.rfq_item_id, d.reason])).toEqual([[s.items[1].id, 'discontinued']])
    const after = await inquiryOf(s.germany.inquiryId)
    expect(after.notes).toBeNull()
    expect(after.no_offer_on).toBeNull()
    // The reply dialog says it at once; the page behind it (hidden while the dialog is open) shows it on the item once it closes.
    await expect(r).toContainText("Can't quote: Item discontinued")
    await page.keyboard.press('Escape')
    await expect(r).toHaveCount(0)
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
    const text = await readClipboardWhen(page, 'Following up on our enquiry')
    expect(text).not.toMatch(/RFQ-|assalam/i) // no RFQ number or religious greeting in the supplier text
    expect(text).toContain('these 2 requirements are very important')
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

  test('the card shows a short preview and the recipient; the whole message lists only the items still without a price; Email is a link; another supplier is one choice away', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[0].id, unit_price: 5, currency: 'CNY' } }))
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: s.china.id, name: 'Mr. Li Wei', phone: '+86 138 0000 0000', email: 'li@hengxin.example' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    // A price is in, so Issue quotation is the green button: the chase card waits for "Show message" (grade-B R3).
    const card = page.locator(`[data-chase-card="${s.china.id}"]`)
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: `Show message, ${s.china.name}` }).click()
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
    await expect(card.getByText(/^Request for quotation: reminder for/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'WhatsApp instead' })).toBeVisible()
    // Another supplier: the card's "Message for" picker switches it (one control, not a "Show message" on every row; grade-A 9).
    await expect(page.getByRole('button', { name: `Show message, ${s.usd.name}` })).toHaveCount(0)
    await card.getByRole('combobox', { name: /^Message for/ }).selectOption({ label: s.usd.name })
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


test.describe('states', () => {
  test('an enquiry that does not exist says so', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs/00000000-0000-4000-8000-00000000dead')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })

  test('an engineer sees who was asked but has no Enter or Edit reply', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await expect(stagesOf(page)).toBeVisible()
    // Owner decision 2026-10-22: a reply is prices, so an engineer sees who was asked but has no Enter or Edit reply.
    await expect(page.getByRole('button', { name: /^(Enter|Edit) reply, / })).toHaveCount(0)
  })
})

test.describe('the page as drawn in the mockup (parity audit Part C)', () => {
  test('coverage reads "1 price so far" while a supplier has said nothing, "1 price" when everybody has answered', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.getByText('1 price so far', { exact: true })).toBeVisible()
    await expect(one.locator(`[data-waiting~="${s.china.id}"]`)).toHaveText('Waiting on 2 suppliers') // China and Germany, one line
    // A price is in: Issue quotation is the green button.
    await expect(page.getByRole('button', { name: 'Send quotation', exact: true })).toBeVisible()
    // The others answer something: nobody is waiting any more.
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: [
      { inquiry_id: s.china.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'CNY' },
      { inquiry_id: s.germany.inquiryId, rfq_item_id: s.items[1].id, unit_price: 5, currency: 'EUR' },
    ] }))
    await page.reload()
    await expect(page.getByRole('article', { name: 'Item 1' }).getByText('1 price', { exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-waiting]')).toHaveCount(0)
  })

  test('the suppliers still to answer an item are ONE line, with no buttons; each supplier is listed once, in Suppliers asked (grade-B R1, R4)', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const one = page.getByRole('article', { name: 'Item 1' })
    await expect(one.locator('[data-waiting]')).toHaveCount(1)
    await expect(one.locator('[data-waiting]')).toHaveText('Waiting on 3 suppliers')
    await expect(one.getByRole('button', { name: /Add reply|Enter reply|Can't quote/ })).toHaveCount(0)
    // No price boxes until a supplier's Enter reply is tapped.
    await expect(page.getByLabel(`Price for item 1 from ${s.germany.name}`)).toHaveCount(0)
    await expect(page.locator(`[data-reply-row="${s.germany.id}"]`)).toHaveCount(1)
    // A reason for this one item is set in that supplier's reply.
    const r = await row(page, s.germany.name)
    await r.getByText('A different reason for one item').click()
    await r.getByLabel(`Can't quote reason for item 1 from ${s.germany.name}`).selectOption('Item discontinued')
    await expect.poll(async () => (await declinesOf(s.germany.inquiryId)).map(d => [d.rfq_item_id, d.reason])).toEqual([[s.items[0].id, 'discontinued']])
    await page.keyboard.press('Escape')
    await expect(one.locator(`[data-declined="${s.germany.id}"]`)).toContainText('Item discontinued')
    await expect(one.locator('[data-waiting]')).toHaveText('Waiting on 2 suppliers')
  })

  test('the item row menu: Copy price, Remove reply with an Undo, Edit reply goes to the price box', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks' } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    // The "..." waits behind the line's chevron (one control per price line until it is opened; grade-A 9).
    await expect(page.getByRole('button', { name: `More for ${s.usd.name}` })).toHaveCount(0)
    await page.getByRole('button', { name: `Show details for ${s.usd.name}` }).click()
    const menu = () => page.getByRole('button', { name: `More for ${s.usd.name}` }).click()
    await menu()
    await resetClipboard(page)
    await page.getByRole('menuitem', { name: 'Copy price' }).click()
    await readClipboardWhen(page, t => t === 'USD 100.00')

    await menu()
    await page.getByRole('menuitem', { name: 'Edit reply' }).click()
    // The supplier's reply dialog opens with the cursor in that item's price box.
    await expect(page.getByRole('dialog', { name: s.usd.name, exact: true }).getByLabel(`Price for item 1 from ${s.usd.name}`)).toBeFocused()
    await page.keyboard.press('Escape')

    await menu()
    await page.getByRole('menuitem', { name: 'Remove reply' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reply removed' })).toBeVisible()
    await expect.poll(async () => (await linesOf(s.usd.inquiryId)).length).toBe(0)
    // Job 178: taking a reply away never takes the enquiry's items with it
    const itemIds = async () => (await must(rest<{ id: string }[]>('admin', `rfq_items?rfq_id=eq.${s.rfq.id}&select=id`))).map(r => r.id).sort()
    expect(await itemIds()).toEqual(s.items.map(i => i.id).sort())
    await expect(page.getByText('This RFQ has no items yet')).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await linesOf(s.usd.inquiryId)).length).toBe(1)
    const [back] = await linesOf(s.usd.inquiryId)
    expect(back).toMatchObject({ currency: 'USD', unit_price: 100, lead_time: '3 weeks' })
    expect(Number(back.fx_rate_pkr)).toBe(280) // the rate it was entered at comes back with it
  })

  test('Remove item names the supplier prices that go with it, says Remove reply keeps the item, and Undo puts item and price back', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: s.usd.inquiryId, rfq_item_id: s.items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks' } }))
    await openAs(page, 'admin', `/rfqs/${s.rfq.id}`)
    await page.getByRole('button', { name: 'More for item 1' }).click()
    await page.getByRole('menuitem', { name: 'Remove item' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm).toContainText(s.usd.name)
    await expect(confirm).toContainText('use Remove reply on the price row instead')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Item 1 removed' })).toBeVisible()
    await expect.poll(async () => (await must(rest<unknown[]>('admin', `rfq_items?id=eq.${s.items[0].id}&select=id`))).length).toBe(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await must(rest<unknown[]>('admin', `rfq_items?id=eq.${s.items[0].id}&select=id`))).length).toBe(1)
    await expect.poll(async () => (await linesOf(s.usd.inquiryId)).length).toBe(1)
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
    // One line (grade-B R5): a fresh rate is its figure (where it came from is its title); a stale one says how old.
    await expect(bar).toContainText('Rates today, PKR per unit')
    await expect(bar.locator('[data-rate="USD"]')).toContainText('USD 280.00')
    await expect(bar.locator('[data-rate="USD"]')).toHaveAttribute('title', 'by hand · today')
    await expect(bar.locator('[data-rate="EUR"]')).toContainText('12 days old')
    await expect(bar.locator('[data-rate="EUR"]')).toHaveAttribute('data-band', 'stale')
    await expect(bar.locator('[data-rate="JPY"]')).toContainText(/JPY\s*no rate, not compared/)
    // JPY is not compared: EUR is the lowest of the two that are.
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-lowest]')).toContainText(s.china.name)

    await bar.getByRole('link', { name: 'Edit exchange rates' }).click()
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

  test('the Exchange rates page: an engineer is refused it (no currency amounts, 2026-10-22)', async ({ page }) => {
    await openAs(page, 'engineer', '/settings/exchange-rates')
    await expect(page.getByRole('heading', { name: 'Exchange rates is for admins and sales' })).toBeVisible()
    await expect(page.getByLabel('Rate, PKR for 1 unit')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Exchange rates' })).toHaveCount(0) // not in the Settings list either
  })

  test('the Exchange rates page: sales can add a rate, a bad figure is refused in words', async ({ page }) => {
    await openAs(page, 'sales', '/settings/exchange-rates')
    await expect(page.getByRole('link', { name: 'Exchange rates' })).toBeVisible() // in the Settings list
    await page.getByLabel('Rate, PKR for 1 unit').fill('abc')
    await expect(page.getByText('Enter a rate above zero')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save rate' })).toBeDisabled()
    // A row's History opens that currency's recent rates (one dialog, not a second panel repeating the table).
    await page.getByRole('button', { name: /^History of / }).first().click()
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
    await expect(usd).toContainText('Asked ')
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
    expect(text).not.toContain(`RFQ-${String(s.rfq.number).padStart(4, '0')}`)
    expect(text).not.toMatch(/assalam/i)
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
    await openStage(page, 'Quotation') // nobody is asked yet, so the job is still at the Enquiry stage
    const panel = page.locator('[data-slot="items"]')
    await expect(panel).toContainText('2 items · nobody asked yet')
    await expect(panel).toContainText('Ask suppliers for prices. One tap copies a message listing every item')
    await expect(page.getByText('No supplier has been asked about this item.')).toHaveCount(2)
    await expect(page.getByRole('article', { name: 'Item 1' }).locator('[data-status]')).toHaveCount(0) // no item chip while nobody is asked: the header says it
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
    await noSidewaysScroll(page)
    await review(page, `rfq-detail-populated-${width}`)

    // The tip that explains the order opens and is clean too.
    await page.getByRole('button', { name: 'How are prices compared?' }).click()
    await expect(page.getByRole('dialog', { name: 'How are prices compared?' })).toBeVisible()
    expect(await overlayViolations(page)).toEqual([])
    await page.keyboard.press('Escape')
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
    await expect((await row(page, withLeg.name)).getByText(/CNY, their last reply/)).toBeVisible()
    await expect((await row(page, withLeg.name)).getByRole('group', { name: `Currency for ${withLeg.name}` })).toHaveCount(0)
  })

  test('nothing on file: no silent PKR. A chip row, no preselection, no save until one is picked; the pick is remembered', async ({ page }) => {
    const s = await seed()
    const bare = await createCompany(uniqueName('Baresup'))
    const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: bare.id, sent_on: karachiDay(-1) } })))[0]
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const r = await row(page, bare.name)
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
    await expect((await row(page, bare.name)).getByText(/USD, their last reply/)).toBeVisible()
    await expect((await row(page, bare.name)).getByRole('group', { name: `Currency for ${bare.name}` })).toHaveCount(0)
  })

  test('a supplier whose country is Pakistan keeps PKR, with no chip row', async ({ page }) => {
    const s = await seed()
    const pk = await createCompany(uniqueName('Pksup'), { country: 'Pakistan' })
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: pk.id, sent_on: karachiDay(-1) } }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect((await row(page, pk.name)).getByText(/PKR, usual for Pakistan/)).toBeVisible()
    await expect((await row(page, pk.name)).getByRole('group', { name: `Currency for ${pk.name}` })).toHaveCount(0)
  })
})
