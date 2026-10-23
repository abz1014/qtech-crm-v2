import { expect, test, type Browser, type TestInfo } from '@playwright/test'
import { db, num, rpcAs } from '../../verify/support/db'
import { invoice, letters, order, setProfile, setRates } from '../../verify/support/fixtures'
import { openMarkWon } from '../../verify/support/session'
import { addDays, issuePoRpc, issueQuote, ITEMS, itemsOf, legsOf, liveOrder, PRICE, reply, rfqState, seedCast, seedImported, seedImportedOrder, standardReplies, stateOf, today, winRpc, type Cast } from './jobflow-support'
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

test('HW-48 (fixed): a goods line left "Not sourced yet" is given a supplier by "Choose supplier" on the order page, and the order leaves "to source"', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true })
  expect((await stateOf(L.id)).goods_state, 'the order starts with a goods line no supplier has').toBe('to_source')
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  // the next step and its words point at the control
  await expect(page.getByRole('button', { name: 'Choose supplier', exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="order-actions"]')).toContainText(/no supplier yet: choose one for each line/)
  // the line itself has it too, in edit mode as well
  await page.getByRole('button', { name: 'Edit GST and lines' }).click()
  const row = page.getByRole('table', { name: 'Order items' }).getByRole('row').filter({ hasText: 'Level switch' })
  await row.getByRole('button', { name: /^Choose supplier, line/ }).click()
  const d = page.getByRole('dialog')
  await expect(d.getByTestId('choose-supplier-line')).toContainText('Level switch')
  await d.getByLabel('Supplier order').selectOption({ index: 0 })
  await d.getByRole('button', { name: 'Use this supplier' }).click()
  await expect.poll(async () => (await itemsOf(L.id)).find(i => i.description.includes('Level switch'))?.supplier_order_id ?? null).not.toBeNull()
  await expect.poll(async () => (await stateOf(L.id)).goods_state).not.toBe('to_source')
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

test('HW-51 (fixed): issuing a PO on a supplier order that was already delivered places it on or before the Delivered date', async () => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`supplier_orders?id=eq.${L.A.id}`, { delivered_on: addDays(today, -3), received_on: addDays(today, -3) })
  expect((await issuePoRpc(L.A.id)).status).toBeLessThan(300)
  const leg = (await legsOf(L.id)).find(l => l.id === L.A.id)!
  expect(leg.placed_on && leg.delivered_on && leg.placed_on <= leg.delivered_on, `placed ${leg.placed_on}, delivered ${leg.delivered_on}`).toBe(true)
})

test('HW-52 (fixed): a customer who sends the same PO again after the order was cancelled can be won again, with the PO on the new order', async ({ browser }, info) => {
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
  const live = await db.rows<{ id: string; customer_po_number: string | null }>(`orders?rfq_id=eq.${L.c.rfq.id}&cancelled_on=is.null&select=id,customer_po_number`)
  expect(live.length, `the new order is made (the page said: "${message}")`).toBe(1)
  expect(live[0].customer_po_number, 'the re-sent PO is on the new order').toBe(PO)
  await ctx.close()
})

test('HW-53 (fixed): Repeat order of a CANCELLED order asks first ("This order was cancelled. Repeat it anyway?") and copies it only when confirmed', async () => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`orders?id=eq.${L.id}`, { cancelled_on: today, cancel_reason: 'customer_cancelled' })
  const r = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: crypto.randomUUID(), p_from_order_id: L.id })
  expect(r.status, 'create_repeat_order from a cancelled order').toBeGreaterThanOrEqual(400)
  expect(JSON.stringify(r.body)).toContain('This order was cancelled. Repeat it anyway?')
  const again = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: crypto.randomUUID(), p_from_order_id: L.id, p_repeat_cancelled: true })
  expect(again.status, 'with the confirmation').toBeLessThan(300)
})

test('HW-54 (fixed): Repeat order from an imported order whose price basis is unknown copies no figure as a net price: the lines are "price needed"', async () => {
  await setProfile(true)
  const imp = await seedImportedOrder()
  const id = crypto.randomUUID()
  const r = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: id, p_from_order_id: imp.id })
  expect(r.status).toBeLessThan(300)
  const copy = await db.one<{ legacy_flags: string[] }>(`orders?id=eq.${id}&select=legacy_flags`)
  const items = await itemsOf(id)
  expect(!items.some(i => num(i.unit_price_net) === 125000) || copy.legacy_flags.includes('value_basis_unknown'), `the copy carries 125,000 as a net price with flags ${JSON.stringify(copy.legacy_flags)}`).toBe(true)
  const flags = await db.rows<{ legacy_flags: string[] }>(`order_items?order_id=eq.${id}&select=legacy_flags`)
  expect(flags.every(f => f.legacy_flags.includes('price_needed')), 'every line of the copy is marked price needed').toBe(true)
})

test('HW-55 (fixed): Repeat order copies a line priced 0 as a "price needed" line, not as a normal line of the new order', async () => {
  await setProfile(true)
  const imp = await seedImportedOrder()
  const id = crypto.randomUUID()
  expect((await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: id, p_from_order_id: imp.id })).status).toBeLessThan(300)
  const items = await itemsOf(id)
  const flags = await db.rows<{ description: string; unit_price_net: number; legacy_flags: string[] }>(`order_items?order_id=eq.${id}&select=description,unit_price_net,legacy_flags`)
  const zero = flags.filter(f => num(f.unit_price_net) === 0)
  expect(zero.length, `the copy's lines: ${items.map(i => `${i.description} ${i.unit_price_net}`).join(', ')}`).toBeGreaterThan(0)
  expect(zero.every(f => f.legacy_flags.includes('price_needed')), 'every line priced 0 is marked price needed').toBe(true)
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

test('HW-58 (fixed): Reopen order is refused on a cancelled order while its RFQ already has a new live order ("RFQ-x already has live order ORD-y.")', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`orders?id=eq.${L.id}`, { cancelled_on: today, cancel_reason: 'customer_cancelled' })
  expect((await winRpc(L.c, { service: [4], leftOut: [3] })).status).toBeLessThan(300)
  const ctx = await ctxAs(browser, info, 'admin')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  await page.getByRole('button', { name: /^More( actions)?$/ }).first().click()
  await page.getByRole('menuitem', { name: 'Reopen order' }).click()
  await page.waitForTimeout(2000)
  const live = await db.rows(`orders?rfq_id=eq.${L.c.rfq.id}&cancelled_on=is.null&select=id`)
  expect(live.length, 'live orders for one RFQ after Reopen order').toBe(1)
  await expect(page.getByRole('alert').filter({ hasText: /RFQ-\d{4} already has live order ORD-\d{4}\./ })).toBeVisible()
  await ctx.close()
})

test('HW-59 (fixed): the USD and the EUR supplier orders of one supplier have different accessible names ("Issue PO, <supplier> (USD)")', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  await page.getByRole('listitem', { name: /^Supplier order,/ }).nth(2).waitFor()
  const names = await page.getByRole('button', { name: /^(Issue PO|Delivered today|Mark placed|Chase goods|More for),? / }).evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  const rows = await page.getByRole('listitem', { name: /^Supplier order,/ }).evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  expect(new Set(rows).size, `supplier order rows ${JSON.stringify(rows)} (buttons: ${JSON.stringify(names)})`).toBe(rows.length)
  expect(rows.some(r => /\(USD\)$/.test(r ?? '')) && rows.some(r => /\(EUR\)$/.test(r ?? '')), `the two supplier orders of one supplier carry the currency: ${JSON.stringify(rows)}`).toBe(true)
  const buttonNames = names.filter((n): n is string => n !== null)
  expect(new Set(buttonNames).size, `button names ${JSON.stringify(buttonNames)}`).toBe(buttonNames.length)
  await ctx.close()
})

test('HW-60: the quotation is revised (and a quantity changed) in another tab while Mark won is open: Create order makes the order at figures the dialog never showed, with no warning', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await standardReplies(c)
  expect((await issueQuote(c, { only: [0, 1, 2] })).status).toBeLessThan(300)
  const { ctx, page, d } = await openWon(browser, info, c.rfq.id)
  const shown = (await d.getByRole('group', { name: 'Order totals' }).innerText()).replace(/\s+/g, ' ')
  expect((await issueQuote(c, { only: [0, 1, 2], prices: { 0: 10000, 1: 200000, 2: 220000 } })).status).toBeLessThan(300)
  await db.patch(`rfq_items?id=eq.${c.items[0].id}`, { qty: 12 })
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
  const t = (await db.view<{ net: number; gross: number }>(`v_order_items_total?order_id=eq.${id}&select=net,gross`))[0]
  test.fail()
  expect(shown, `the dialog showed "${shown}"; the order was made at net ${t.net}, gross ${t.gross}`).toContain(Number(t.net).toLocaleString('en-US', { maximumFractionDigits: 2 }))
  await ctx.close()
})

test('HW-61 (fixed): a line is split in another tab while Issue PO is open: the PO is refused ("The order lines changed. Review again."), not sent at the old quantity', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  await page.getByRole('listitem', { name: `Supplier order, ${L.c.supA.name}` }).first().getByRole('button', { name: `Issue PO, ${L.c.supA.name}` }).click()
  await page.getByRole('dialog').getByTestId('po-total').waitFor()
  const split = await rpcAs<string>('sales', 'split_order_item', { p_item_id: L.items[0].id, p_qty: 4, p_supplier_id: L.c.supB.id, p_currency: 'USD', p_supplier_unit_price: 31 })
  expect(split.status).toBeLessThan(300)
  await page.getByRole('dialog').getByRole('button', { name: 'Issue PO', exact: true }).click()
  await expect.poll(async () => (await db.rows(`purchase_orders?supplier_order_id=eq.${L.A.id}&select=id`)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(0)
  await page.waitForTimeout(3000)
  const pos = await db.rows<{ lines: { order_item_id: string; qty: number }[] }>(`purchase_orders?supplier_order_id=eq.${L.A.id}&select=lines`)
  const poQty = pos[0]?.lines.find(l => l.order_item_id === L.items[0].id)?.qty
  const now = (await itemsOf(L.id)).find(i => i.id === L.items[0].id)
  expect(pos.length === 0 || num(poQty) === num(now?.qty), `PO quantity ${poQty}, order line quantity ${now?.qty}`).toBe(true)
  await expect(page.getByRole('dialog').getByText('The order lines changed. Review again.')).toBeVisible()
  await ctx.close()
})

test('HW-62 (fixed): an order made by Mark won links back to the RFQ and the quotation it came from', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  const links = await page.locator(`#main a[href="/rfqs/${L.c.rfq.id}"]`).count()
  expect(links, 'a link from the order page to its RFQ').toBeGreaterThan(0)
  await expect(page.getByTestId('order-source')).toContainText(/From RFQ-\d{4} · QT-\d{2}-\d{4} R\d+/)
  await ctx.close()
})

test('HW-63 (fixed): two people issue the PO for one supplier order from two screens: the second press is refused ("PO R0 was just issued by X. Revise instead?"), not an identical R1', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  await page.getByRole('listitem', { name: `Supplier order, ${L.c.supA.name}` }).first().getByRole('button', { name: `Issue PO, ${L.c.supA.name}` }).click()
  await page.getByRole('dialog').getByTestId('po-total').waitFor()
  expect((await issuePoRpc(L.A.id, 'admin')).status).toBeLessThan(300)
  await page.getByRole('dialog').getByRole('button', { name: 'Issue PO', exact: true }).click()
  await page.waitForTimeout(4000)
  const pos = await db.rows<{ number: number; revision: number }>(`purchase_orders?supplier_order_id=eq.${L.A.id}&select=number,revision&order=revision`)
  expect(pos.length, `POs for one supplier order: ${pos.map(p => `${p.number} R${p.revision}`).join(', ')}`).toBe(1)
  await expect(page.getByRole('dialog').getByText(/PO R0 was just issued by .+\. Revise instead\?/)).toBeVisible()
  await ctx.close()
})

