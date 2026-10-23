import { expect, test, type Browser, type TestInfo } from '@playwright/test'
import { db, num, rpcAs } from '../../verify/support/db'
import { invoice, letters, order, setProfile, setRates } from '../../verify/support/fixtures'
import { openMarkWon } from '../../verify/support/session'
import { addDays, issuePoRpc, issueQuote, ITEMS, itemsOf, legsOf, liveOrder, PRICE, reply, rfqState, seedCast, seedImported, seedImportedOrder, standardReplies, today, type Cast } from './jobflow-support'
import { ctxAs, settle, shot, tag } from './support'

/*
 * Confirmed bugs from the crawl (crawl.spec.ts), pinned as test.fail so a fix flips them. The setup runs normally (a broken setup is a red
 * failure); test.fail is declared just before the one expect that states the correct behaviour.
 */

test('HW-42 (fixed): on a phone, Invoices & GST keeps the search box and the filter tabs inside the screen', async ({ browser }, info) => {
  const o = await order({ lines: [{ description: `Hunt phone register ${tag()}`, qty: 1, price: 10000 }] })
  await invoice(o.order.id, 10000, 1800)
  const ctx = await ctxAs(browser, info, 'admin', 'phone')
  const page = await ctx.newPage()
  await page.goto('/money/gst-register')
  await settle(page)
  const search = page.getByPlaceholder('Search invoices')
  await expect(search).toBeVisible()
  const box = await search.boundingBox()
  expect(box).not.toBeNull()
  await shot(page, 'HW-42-phone-gst-register', false)
  const width = page.viewportSize()?.width ?? 375
  expect(Math.round(box!.x + box!.width), 'right edge of the Search invoices box').toBeLessThanOrEqual(width)
  await ctx.close()
})

/*
 * Job flow hunt (jobflow.spec.ts, branch hunt/jobflow): RFQ -> quotation -> won -> order -> supplier orders / POs -> delivery ->
 * commissioning -> invoice -> payment. HW-44 onwards. Each test builds its own data the way the app or the import writes it
 * (jobflow-support.ts: never rfq_items.quoted_unit_price_net directly), does the steps, and pins the wrong behaviour.
 */

/** Opens the Mark won dialog on `rfqId` as sales and waits for its lines. */
async function openWon(browser: Browser, info: TestInfo, rfqId: string) {
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/rfqs/${rfqId}`)
  await settle(page)
  await openMarkWon(page)
  const d = page.getByRole('dialog')
  await d.getByRole('group', { name: 'Suppliers by line' }).waitFor()
  return { ctx, page, d }
}

test('HW-44: an imported RFQ marked quotation sent opens a Mark won dialog that cannot make an order and does not say how to go on', async ({ browser }, info) => {
  await setProfile(true)
  const imp = await seedImported(1)
  const { ctx, d } = await openWon(browser, info, imp.rfq.id)
  const text = await d.innerText()
  const way = (await d.getByRole('button', { name: 'Create order' }).isEnabled()) || (await d.getByRole('textbox', { name: /price/i }).count()) > 0 || /issue (a )?quotation/i.test(text)
  test.fail()
  expect(way, `a way to go on from Mark won (every line reads "Left out of the order", Create order is disabled): ${text.slice(0, 160)}`).toBe(true)
  await ctx.close()
})

test('HW-45: a quotation marked sent in the app without a PDF (a verbal one) cannot be won: no line has a selling price and Create order is disabled', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await reply(c.rfq.id, c.supA, [{ itemId: c.items[0].id, price: PRICE.a1, currency: 'PKR' }])
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/rfqs/${c.rfq.id}`)
  await settle(page)
  await page.getByRole('button', { name: 'More', exact: true }).first().click()
  await page.getByRole('menuitem', { name: /^Mark quotation sent/ }).click()
  await expect.poll(async () => (await rfqState(c.rfq.id)).quoted_on).not.toBeNull()
  await page.reload()
  await settle(page)
  await openMarkWon(page)
  const d = page.getByRole('dialog')
  await d.getByRole('group', { name: 'Suppliers by line' }).waitFor()
  const text = await d.innerText()
  const way = (await d.getByRole('button', { name: 'Create order' }).isEnabled()) || (await d.getByRole('textbox', { name: /price/i }).count()) > 0 || /issue (a )?quotation/i.test(text)
  test.fail()
  expect(way, `a way to go on from Mark won after Mark quotation sent: ${text.slice(0, 160)}`).toBe(true)
  await ctx.close()
})

test('HW-46: a revision that quotes fewer items leaves the dropped items on the order at their old prices (Mark won makes 4 lines from a 2 line quotation)', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 4 })
  await reply(c.rfq.id, c.supA, [
    { itemId: c.items[0].id, price: 8200, currency: 'PKR' },
    { itemId: c.items[2].id, price: 150000, currency: 'PKR' },
    { itemId: c.items[3].id, price: 24000, currency: 'PKR' },
  ])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[1].id, price: 520, currency: 'USD' }])
  expect((await issueQuote(c, { only: [0, 1, 2, 3] })).status).toBeLessThan(300)
  expect((await issueQuote(c, { only: [0, 1], prices: { 0: 9500, 1: 185000 } })).status).toBeLessThan(300)
  const { ctx, d } = await openWon(browser, info, c.rfq.id)
  const text = await d.innerText()
  test.fail()
  expect(text, 'the dialog for the R1 quotation (items 1 and 2)').toContain('Creates 2 order lines')
  await ctx.close()
})

test('HW-47: "Not sourced yet" chosen in the Mark won dialog is ignored: the order line gets the rank-1 supplier anyway', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 2 })
  await reply(c.rfq.id, c.supA, [
    { itemId: c.items[0].id, price: 8200, currency: 'PKR' },
    { itemId: c.items[1].id, price: 150000, currency: 'PKR' },
  ])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[0].id, price: 8600, currency: 'PKR' }])
  expect((await issueQuote(c, { only: [0, 1] })).status).toBeLessThan(300)
  const { ctx, page, d } = await openWon(browser, info, c.rfq.id)
  await d.getByTestId('convert-item-1').getByRole('button', { name: /Supplier for line 1/ }).click()
  await page.getByRole('option', { name: /^Not sourced yet/ }).click()
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
  const items = await itemsOf(id)
  test.fail()
  expect(items[0].supplier_order_id, 'line 1 was left "Not sourced yet" in the dialog').toBeNull()
  await ctx.close()
})

test('HW-48: a goods line left "Not sourced yet" has no way to be given a supplier on the order page, so the order stays at "to source" and its next step is a button that does not fix it', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  await page.getByRole('button', { name: 'Edit GST and lines' }).click()
  const row = page.getByRole('table', { name: 'Order items' }).getByRole('row').filter({ hasText: 'Level switch' })
  const buttons = await row.getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') || (e as HTMLElement).innerText))
  const selects = await row.getByRole('combobox', { name: /supplier|source/i }).count()
  test.fail()
  expect(selects > 0 || buttons.some(b => /supplier|assign|source/i.test(b ?? '')), `a control to give the Level switch line a supplier (buttons: ${buttons.join(' | ')})`).toBe(true)
  await ctx.close()
})

test('HW-49: the Mark won dialog reads "Commissioning and loop check" as commissioning (it switches the toggle on) but saves the line as a goods line with no supplier', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 5 })
  await standardReplies(c)
  expect((await issueQuote(c, { gst: { 4: 0 } })).status).toBeLessThan(300)
  const { ctx, page, d } = await openWon(browser, info, c.rfq.id)
  await expect(d.getByRole('checkbox', { name: /Needs commissioning/ })).toHaveAttribute('aria-checked', 'true')
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
  const items = await itemsOf(id)
  const commissioning = items.find(i => /Commissioning and loop check/.test(i.description))
  test.fail()
  expect(commissioning?.is_service, 'the commissioning line is a service').toBe(true)
  await ctx.close()
})

test('HW-50: Mark won turns an imported supplier price whose currency was never verified into a real supplier order, and the dialog says nothing about it', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const imp = await seedImported(3)
  const cast = { customer: imp.customer, supA: imp.sup, supB: imp.sup, rfq: imp.rfq, items: imp.items.map((x, i) => ({ ...x, description: ITEMS[i].description, qty: ITEMS[i].qty })) } as Cast
  expect((await issueQuote(cast, { only: [0] })).status).toBeLessThan(300)
  const { ctx, d } = await openWon(browser, info, imp.rfq.id)
  const text = await d.innerText()
  test.fail()
  expect(text, 'a sign that the supplier price is imported, its currency unverified and its item guessed').toMatch(/unverified|check the currency|guess|legacy|imported/i)
  await ctx.close()
})

test('HW-51: issuing a PO on a supplier order that was already delivered sets Placed to today, after the Delivered date', async () => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`supplier_orders?id=eq.${L.A.id}`, { delivered_on: addDays(today, -3), received_on: addDays(today, -3) })
  expect((await issuePoRpc(L.A.id)).status).toBeLessThan(300)
  const leg = (await legsOf(L.id)).find(l => l.id === L.A.id)!
  test.fail()
  expect(leg.placed_on && leg.delivered_on && leg.placed_on <= leg.delivered_on, `placed ${leg.placed_on}, delivered ${leg.delivered_on}`).toBe(true)
})

test('HW-52: a customer who sends the same PO again after the order was cancelled cannot be won again: "A order with these details already exists. Open the existing one", with no word that the cancelled order holds the PO', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const PO = `PO-${letters(5).toUpperCase()}`
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`orders?id=eq.${L.id}`, { customer_po_number: PO, cancelled_on: today, cancel_reason: 'customer_cancelled' })
  const { ctx, page, d } = await openWon(browser, info, L.c.rfq.id)
  await d.getByLabel(/^Customer PO number/).fill(PO)
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForTimeout(3000)
  const message = (await d.getByRole('alert').innerText().catch(() => '')).replace(/\s+/g, ' ')
  const made = (await db.rows(`orders?rfq_id=eq.${L.c.rfq.id}&cancelled_on=is.null&select=id`)).length === 1
  test.fail()
  expect(made || /cancel|ORD-\d{4}|\bPO\b/i.test(message.replace(/^Couldn't create the order/, '')), `the order is made, or the refusal names the PO or the cancelled order: "${message}"`).toBe(true)
  await ctx.close()
})

test('HW-53: Repeat order copies a CANCELLED order without a check or a word (create_repeat_order; the company page offers Repeat order on it)', async () => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`orders?id=eq.${L.id}`, { cancelled_on: today, cancel_reason: 'customer_cancelled' })
  const r = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: crypto.randomUUID(), p_from_order_id: L.id })
  test.fail()
  expect(r.status, 'create_repeat_order from a cancelled order').toBeGreaterThanOrEqual(400)
})

test('HW-54: Repeat order from an imported order whose price basis is unknown copies the old figure as a plain net price and drops the "is GST included?" flag', async () => {
  await setProfile(true)
  const imp = await seedImportedOrder()
  const id = crypto.randomUUID()
  const r = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: id, p_from_order_id: imp.id })
  expect(r.status).toBeLessThan(300)
  const copy = await db.one<{ legacy_flags: string[] }>(`orders?id=eq.${id}&select=legacy_flags`)
  const items = await itemsOf(id)
  test.fail()
  expect(!items.some(i => num(i.unit_price_net) === 125000) || copy.legacy_flags.includes('value_basis_unknown'), `the copy carries 125,000 as a net price with flags ${JSON.stringify(copy.legacy_flags)}`).toBe(true)
})

test('HW-55: Repeat order from an imported order copies a line priced 0 as a normal line of the new order', async () => {
  await setProfile(true)
  const imp = await seedImportedOrder()
  const id = crypto.randomUUID()
  expect((await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: id, p_from_order_id: imp.id })).status).toBeLessThan(300)
  const items = await itemsOf(id)
  test.fail()
  expect(items.some(i => num(i.unit_price_net) === 0), `the copy has a line priced 0: ${items.map(i => `${i.description} ${i.unit_price_net}`).join(', ')}`).toBe(false)
})

test('HW-56: a second tab that presses Create order on an RFQ just won in the first tab opens the first tab\'s order and drops the customer PO typed there without a word', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await standardReplies(c)
  expect((await issueQuote(c, { only: [0, 1, 2] })).status).toBeLessThan(300)
  const one = await openWon(browser, info, c.rfq.id)
  const two = await openWon(browser, info, c.rfq.id)
  await two.d.getByLabel(/^Customer PO number/).fill('TAB-TWO-PO')
  await one.d.getByLabel(/^Customer PO number/).fill('TAB-ONE-PO')
  await one.d.getByRole('button', { name: 'Create order' }).click()
  await one.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  await two.d.getByRole('button', { name: 'Create order' }).click()
  await two.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const told = (await two.page.getByRole('status').allInnerTexts()).join(' ')
  const orders = await db.rows<{ customer_po_number: string | null }>(`orders?rfq_id=eq.${c.rfq.id}&select=customer_po_number`)
  test.fail()
  expect(/already|TAB-ONE|PO/i.test(told) || orders[0]?.customer_po_number === 'TAB-TWO-PO', `a sign that the PO typed here was not used (toasts: "${told}")`).toBe(true)
  await one.ctx.close()
  await two.ctx.close()
})

test('HW-57: the Mark won dialog opens by the address (?won=1) on an RFQ that already has an order, although the page offers no Mark won', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/rfqs/${L.c.rfq.id}?won=1`)
  await settle(page)
  await page.waitForTimeout(1500)
  test.fail()
  expect(await page.getByRole('dialog').filter({ hasText: 'Mark won' }).count(), 'a Mark won dialog on a won RFQ').toBe(0)
  await ctx.close()
})
