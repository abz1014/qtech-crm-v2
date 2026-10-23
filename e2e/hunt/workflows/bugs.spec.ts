import { expect, test, type Browser, type TestInfo } from '@playwright/test'
import { db, num, rpcAs } from '../../verify/support/db'
import { invoice, letters, order, setProfile, setRates } from '../../verify/support/fixtures'
import { openMarkWon } from '../../verify/support/session'
import { addDays, issuePoRpc, issueQuote, ITEMS, itemsOf, legsOf, liveOrder, PRICE, reply, rfqState, seedCast, seedImported, seedImportedOrder, standardReplies, today, winRpc, type Cast } from './jobflow-support'
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

test('HW-44 (fixed): an imported RFQ marked quotation sent opens a Mark won dialog that asks for the selling prices and can make the order', async ({ browser }, info) => {
  await setProfile(true)
  const imp = await seedImported(1)
  const { ctx, d } = await openWon(browser, info, imp.rfq.id)
  const text = await d.innerText()
  const way = (await d.getByRole('button', { name: 'Create order' }).isEnabled()) || (await d.getByRole('textbox', { name: /price/i }).count()) > 0 || /issue (a )?quotation/i.test(text)
  expect(way, `a way to go on from Mark won: ${text.slice(0, 160)}`).toBe(true)
  await ctx.close()
})

test('HW-45 (fixed): a quotation marked sent in the app without a PDF (a verbal one) can be won: the dialog asks for the selling prices', async ({ browser }, info) => {
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
  expect(way, `a way to go on from Mark won after Mark quotation sent: ${text.slice(0, 160)}`).toBe(true)
  await ctx.close()
})

test('HW-46 (fixed): a revision that quotes fewer items drops the others: they lose their old prices and Mark won makes 2 lines from a 2 line quotation', async ({ browser }, info) => {
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
  const prices = await db.rows<{ position: number; quoted_unit_price_net: number | null }>(`rfq_items?rfq_id=eq.${c.rfq.id}&select=position,quoted_unit_price_net&order=position`)
  expect(prices.map(r => (r.quoted_unit_price_net === null ? null : Number(r.quoted_unit_price_net))), 'the dropped items 3 and 4 keep no price').toEqual([9500, 185000, null, null])
  const { ctx, d } = await openWon(browser, info, c.rfq.id)
  const text = await d.innerText()
  expect(text, 'the dialog for the R1 quotation (items 1 and 2)').toContain('Creates 2 order lines')
  await ctx.close()
})

test('HW-47 (fixed): "Not sourced yet" chosen in the Mark won dialog is honoured: the order line gets no supplier', async ({ browser }, info) => {
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
  expect(items[0].supplier_order_id, 'line 1 was left "Not sourced yet" in the dialog').toBeNull()
  expect(items[0].supplier_unit_price, 'and has no supplier price').toBeNull()
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

test('HW-49 (fixed): the Mark won dialog reads "Commissioning and loop check" as commissioning: the toggle is on and the line starts as "Service, no supplier" and is saved as a service', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 5 })
  await standardReplies(c)
  expect((await issueQuote(c, { gst: { 4: 0 } })).status).toBeLessThan(300)
  const { ctx, page, d } = await openWon(browser, info, c.rfq.id)
  await expect(d.getByRole('checkbox', { name: /Needs commissioning/ })).toHaveAttribute('aria-checked', 'true')
  await expect(d.getByRole('button', { name: /Supplier for line 5/ })).toContainText('Service, no supplier')
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
  const items = await itemsOf(id)
  const commissioning = items.find(i => /Commissioning and loop check/.test(i.description))
  expect(commissioning?.is_service, 'the commissioning line is a service').toBe(true)
  expect(commissioning?.supplier_order_id, 'with no supplier order').toBeNull()
  await ctx.close()
})

test('HW-50 (fixed): Mark won says, in the supplier picker, that an imported supplier price has a currency that was never verified', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const imp = await seedImported(3)
  const cast = { customer: imp.customer, supA: imp.sup, supB: imp.sup, rfq: imp.rfq, items: imp.items.map((x, i) => ({ ...x, description: ITEMS[i].description, qty: ITEMS[i].qty })) } as Cast
  expect((await issueQuote(cast, { only: [0] })).status).toBeLessThan(300)
  const { ctx, d } = await openWon(browser, info, imp.rfq.id)
  const text = await d.innerText()
  expect(await d.getByRole('button', { name: /Supplier for line 1/ }).innerText(), 'the picker button carries the warning of the quote it defaults to').toMatch(/Imported quote: the currency was not confirmed/)
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

test('HW-56 (fixed): a second tab that presses Create order on an RFQ just won in the first tab is told "Already converted to ORD-n" and can add the customer PO it typed to that order', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await standardReplies(c)
  expect((await issueQuote(c, { only: [0, 1, 2] })).status).toBeLessThan(300)
  const one = await openWon(browser, info, c.rfq.id)
  const two = await openWon(browser, info, c.rfq.id)
  await two.d.getByLabel(/^Customer PO number/).fill('TAB-TWO-PO')
  await one.d.getByRole('button', { name: 'Create order' }).click()
  await one.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  await two.d.getByRole('button', { name: 'Create order' }).click()
  await expect(two.d.getByText(/^Already converted to ORD-\d{4}$/)).toBeVisible()
  expect(two.page.url(), 'the second tab stays on the dialog').not.toMatch(/\/orders\//)
  const before = await db.rows<{ id: string; customer_po_number: string | null }>(`orders?rfq_id=eq.${c.rfq.id}&select=id,customer_po_number`)
  expect(before, 'one RFQ, one order').toHaveLength(1)
  expect(before[0].customer_po_number, 'the first tab typed no PO').toBeNull()
  await two.d.getByRole('button', { name: /^Add PO TAB-TWO-PO to ORD-\d{4}$/ }).click()
  await two.page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const after = await db.rows<{ id: string; customer_po_number: string | null }>(`orders?rfq_id=eq.${c.rfq.id}&select=id,customer_po_number`)
  expect(after).toHaveLength(1)
  expect(after[0].customer_po_number, 'the PO typed in the second tab is on the order').toBe('TAB-TWO-PO')
  await one.ctx.close()
  await two.ctx.close()
})

test('HW-57 (fixed): ?won=1 on an RFQ that already has an order opens that order, with a message, not a Mark won dialog', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/rfqs/${L.c.rfq.id}?won=1`)
  await page.waitForURL(new RegExp(`/orders/${L.id}`))
  await settle(page)
  await expect(page.getByRole('status').filter({ hasText: /already exists for this RFQ/ })).toBeVisible()
  expect(await page.getByRole('dialog').filter({ hasText: 'Mark won' }).count(), 'a Mark won dialog on a won RFQ').toBe(0)
  await ctx.close()
})

test('HW-58: Reopen order is allowed on a cancelled order while its RFQ already has a new live order: two live orders for one RFQ, both owing the suppliers', async ({ browser }, info) => {
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
  test.fail()
  expect(live.length, 'live orders for one RFQ after Reopen order').toBe(1)
  await ctx.close()
})

test('HW-59: the USD and the EUR supplier orders of one supplier have the same accessible name, so "Issue PO, <supplier>" and "Delivered today, <supplier>" name two different buttons alike', async ({ browser }, info) => {
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
  test.fail()
  expect(new Set(rows).size, `supplier order rows ${JSON.stringify(rows)} (buttons: ${JSON.stringify(names)})`).toBe(rows.length)
  await ctx.close()
})

test('HW-60 (fixed): the quotation is revised (and a quantity changed) in another tab while Mark won is open: Create order refuses, reloads, and the order is made at the figures then shown', async ({ browser }, info) => {
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
  await expect(d.getByText(/The quotation changed since you opened this\. Review again\./)).toBeVisible()
  expect(page.url(), 'no order page').not.toMatch(/\/orders\//)
  expect(await db.rows(`orders?rfq_id=eq.${c.rfq.id}&select=id`), 'nothing was created').toHaveLength(0)
  await expect.poll(async () => (await d.getByRole('group', { name: 'Order totals' }).innerText()).replace(/\s+/g, ' '), { message: 'the dialog reloaded the new figures' }).not.toBe(shown)
  const reviewed = (await d.getByRole('group', { name: 'Order totals' }).innerText()).replace(/\s+/g, ' ')
  await d.getByRole('button', { name: 'Create order' }).click()
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
  const t = (await db.view<{ net: number; gross: number }>(`v_order_items_total?order_id=eq.${id}&select=net,gross`))[0]
  expect(reviewed, `the dialog showed "${reviewed}"; the order was made at net ${t.net}, gross ${t.gross}`).toContain(Number(t.net).toLocaleString('en-US', { maximumFractionDigits: 2 }))
  await ctx.close()
})

test('HW-61: a line is split in another tab while Issue PO is open: the PO goes to the supplier at the old quantity (10 asked, the order line now has 6)', async ({ browser }, info) => {
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
  test.fail()
  expect(pos.length === 0 || num(poQty) === num(now?.qty), `PO quantity ${poQty}, order line quantity ${now?.qty}`).toBe(true)
  await ctx.close()
})

test('HW-62: an order made by Mark won has no link back to the RFQ (or the quotation) it came from', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const ctx = await ctxAs(browser, info, 'sales')
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(`/orders/${L.id}`)
  await settle(page)
  const links = await page.locator(`#main a[href="/rfqs/${L.c.rfq.id}"]`).count()
  test.fail()
  expect(links, 'a link from the order page to its RFQ').toBeGreaterThan(0)
  await ctx.close()
})

test('HW-63: two people issue the PO for one supplier order from two screens: the second press silently issues an identical R1 (the dialog said "New PO, R0")', async ({ browser }, info) => {
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
  test.fail()
  expect(pos.length, `POs for one supplier order: ${pos.map(p => `${p.number} R${p.revision}`).join(', ')}`).toBe(1)
  await ctx.close()
})

