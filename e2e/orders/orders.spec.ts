import { expect, test, type Locator, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'

/*
 * O01 (convert an RFQ to an order) and O03 (the order page), end to end against the local CI stack, as the fixture users through the
 * real login form. Every test makes its own customer, RFQ and order.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2 and A3):
 *   win an RFQ                       2 taps: Mark won, Create order (nothing typed)
 *   mark a leg placed / delivered   1 tap each (there is no receiving step: owner decision 2026-10-15)
 *   engineer: commissioning done    1 tap, 0 typed
 * and the rule that an engineer is never sent a price, a receivable or a cost.
 */

const violations = (page: Page): Promise<string[]> => axeViolations(page)
const dialogViolations = (page: Page): Promise<string[]> => axeViolations(page, { landmarks: false })

/** Counts every tap a person makes, so a test can assert the FE-2 number rather than just that something worked. */
function tapper() {
  let taps = 0
  return {
    tap: async (target: Locator) => {
      await target.click()
      taps++
    },
    /** One intended tap that arrives twice (a double click, a shaky finger): still one tap, and the test then proves it made one record. */
    doubleTap: async (target: Locator) => {
      await target.dblclick()
      taps++
    },
    get count() {
      return taps
    },
  }
}

const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const shot = async (page: Page, name: string) => {
  await waitForAnimationsToFinish(page)
  await review(page, name)
}

const get = <T>(path: string) => must(rest<T[]>('admin', path))

// ------------------------------------------------------------------------------------------------ fixtures

interface RfqSeed {
  tag: string
  customer: { id: string; name: string }
  rfq: { id: string; number: number }
  items: { id: string; description: string }[]
  supplierA: { id: string; name: string }
  supplierB: { id: string; name: string }
  /** Quote line ids: item 1 from A (50 USD, 2 wks) and from B (40 USD, 10 days: the lowest), item 2 from A only. */
  lines: { a1: string; b1: string; a2: string }
}

/** A customer with an earlier order on 45-day terms, and an RFQ of three priced items quoted by two suppliers. */
async function seedRfq(): Promise<RfqSeed> {
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = await createCompany(uniqueName('Convert Customer'))
  await must(rest('admin', 'orders', { method: 'POST', body: { company_id: customer.id, ordered_on: karachiDay(-30), payment_terms_days: 45 } }))
  // quoted_on: the quotation is out (marked sent by phone), so Mark won is the RFQ page's one green button (UX audit 2026-10-19).
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
  const items = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: `Damper actuator ${tag}`, qty: 2, quoted_unit_price_net: 1000 },
        { rfq_id: rfq.id, position: 1, description: `Pressure transmitter ${tag}`, qty: 1, quoted_unit_price_net: 2000 },
        { rfq_id: rfq.id, position: 2, description: `Commissioning ${tag}`, qty: 3, quoted_unit_price_net: 500 },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  const supplierA = await createCompany(uniqueName('Alpenmark'), { country: 'Germany' })
  const supplierB = await createCompany(uniqueName('Dubai Instrumentation'), { country: 'UAE' })
  const inq = async (supplierId: string) =>
    (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierId, sent_on: karachiDay(-3) } })))[0].id
  const [ia, ib] = [await inq(supplierA.id), await inq(supplierB.id)]
  const ql = await must(
    rest<{ id: string; inquiry_id: string; rfq_item_id: string }[]>('admin', 'supplier_quote_lines', {
      method: 'POST',
      body: [
        { inquiry_id: ia, rfq_item_id: items[0].id, unit_price: 50, currency: 'USD', lead_time: '2 wks' },
        { inquiry_id: ib, rfq_item_id: items[0].id, unit_price: 40, currency: 'USD', lead_time: '10 days' },
        { inquiry_id: ia, rfq_item_id: items[1].id, unit_price: 100, currency: 'USD', lead_time: '2 wks' },
      ],
    }),
  )
  const line = (inquiry: string, item: string) => ql.find(l => l.inquiry_id === inquiry && l.rfq_item_id === item)!.id
  return { tag, customer, rfq, items, supplierA, supplierB, lines: { a1: line(ia, items[0].id), b1: line(ib, items[0].id), a2: line(ia, items[1].id) } }
}

interface OrderSeed {
  tag: string
  company: { id: string; name: string }
  po: string
  order: { id: string; number: number }
  supplierA: { id: string; name: string }
  supplierB: { id: string; name: string }
  legA: string
  legB: string
  items: { id: string; description: string }[]
  engineer: { id: string; name: string }
  rfqId: string
}

/**
 * An order with: leg A (placed nothing yet, the supplier quoted "2 wks"), leg B (placed 10 days ago, expected 3 days ago: late, reference
 * PI-123), three lines (one on each leg, one service), commissioning planned in 10 days with the fixture engineer assigned,
 * a site, a site contact and notes.
 */
async function seedOrder(extra: Record<string, unknown> = {}): Promise<OrderSeed> {
  const tag = Math.random().toString(36).slice(2, 6)
  const company = await createCompany(uniqueName('Punjab Cement'))
  const supplierA = await createCompany(uniqueName('Alpenmark Controls'), { country: 'Germany' })
  const supplierB = await createCompany(uniqueName('Dubai Instrumentation'), { country: 'UAE' })
  const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Hub plant, kiln line 2', address: 'Hub Chowki Road, Lasbela' } })))[0]
  const contact = (await must(rest<{ id: string }[]>('admin', 'contacts', { method: 'POST', body: { company_id: company.id, name: 'Mr. Tariq Hussain', phone: '0301 555 0142' } })))[0]
  // the RFQ the order came from, only so leg A has a quoted lead time to suggest the expected date from
  const rfq = await createRfq(company.id)
  const rfqItem = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, description: `Actuator ${tag}`, qty: 6 } })))[0]
  const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierA.id, sent_on: karachiDay(-20) } })))[0]
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiry.id, rfq_item_id: rfqItem.id, unit_price: 214, currency: 'EUR', lead_time: '2 wks' } }))

  const po = `PO-${tag.toUpperCase()}-${Date.now().toString(36).slice(-4)}`
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: {
          company_id: company.id,
          site_id: site.id,
          contact_id: contact.id,
          rfq_id: rfq.id,
          customer_po_number: po,
          ordered_on: karachiDay(-12),
          payment_terms_days: 30,
          needs_commissioning: true,
          commissioning_planned_on: karachiDay(10),
          notes: 'Gate pass needed 2 days ahead.',
          ...extra,
        },
      }),
    )
  )[0]
  const legs = await must(
    rest<{ id: string; supplier_id: string }[]>('admin', 'supplier_orders', {
      method: 'POST',
      body: [
        { order_id: order.id, supplier_id: supplierA.id, currency: 'EUR', inquiry_id: inquiry.id, placed_on: null, expected_on: null, reference: null },
        { order_id: order.id, supplier_id: supplierB.id, currency: 'USD', inquiry_id: null, placed_on: karachiDay(-10), expected_on: karachiDay(-3), reference: 'PI-123' },
      ],
    }),
  )
  const legA = legs.find(l => l.supplier_id === supplierA.id)!.id
  const legB = legs.find(l => l.supplier_id === supplierB.id)!.id
  const items = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: `Belimo actuator ${tag}`, qty: 6, unit: 'ea', unit_price_net: 48500, supplier_unit_price: 214, supplier_order_id: legA, rfq_item_id: rfqItem.id, is_service: false },
        { order_id: order.id, position: 1, description: `Memosens pH sensor ${tag}`, qty: 2, unit: 'ea', unit_price_net: 96500, supplier_unit_price: null, supplier_order_id: legB, rfq_item_id: null, is_service: false },
        { order_id: order.id, position: 2, description: `Loop check and commissioning ${tag}`, qty: 1, unit: 'job', unit_price_net: 135000, supplier_unit_price: null, supplier_order_id: null, rfq_item_id: null, is_service: true },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  const engineer = (await get<{ id: string; name: string }>('users?role=eq.engineer&deactivated_at=is.null&select=id,name&order=created_at&limit=1'))[0]
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: engineer.id } }))
  return { tag, company, po, order, supplierA, supplierB, legA, legB, items, engineer, rfqId: rfq.id }
}

const orderRow = (id: string) => get<Record<string, unknown>>(`orders?id=eq.${id}&select=*`).then(r => r[0])
const legRow = (id: string) => get<Record<string, unknown>>(`supplier_orders?id=eq.${id}&select=*`).then(r => r[0])
const itemRows = (orderId: string) => get<{ id: string; gst_rate: number; is_service: boolean; supplier_order_id: string | null; position: number }>(`order_items?order_id=eq.${orderId}&select=id,gst_rate,is_service,supplier_order_id,position&order=position`)

/** Forget the session (the app keeps it in this browser) so the next openAs signs in as someone else on the same page. */
async function signOutHard(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
}

const leg = (page: Page, letter: string) => page.getByTestId(`leg-${letter}`)

// ------------------------------------------------------------------------------------------------ O01 convert

test.describe('O01: Mark won creates the order', () => {
  test('2 taps, nothing typed: suppliers come from the lowest quote, terms from the last order, and a double submit makes one order', async ({ page }) => {
    const s = await seedRfq()
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('heading', { name: s.customer.name }).first()).toBeVisible()

    await t.tap(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }))
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Mark won' })).toBeVisible()
    // pre-filled, nothing to type: the PO is empty and optional, the terms come from the customer's last order
    await expect(dialog.getByLabel('Customer PO number')).toHaveValue('')
    await expect(dialog.getByLabel('Payment terms in days')).toHaveValue('45')
    await expect(dialog).toContainText('from the last order')
    // the item called "Commissioning ..." makes the toggle start on, so nothing is tapped to plan the job
    await expect(dialog.getByRole('checkbox', { name: 'Needs commissioning' })).toBeChecked()
    // supplier per line is its rank-1 quote (B, 40 USD, beats A, 50 USD), with the reason under the name; the person may change it
    await expect(dialog.getByRole('button', { name: 'Supplier for line 1' })).toContainText(s.supplierB.name)
    await expect(dialog.getByRole('button', { name: 'Supplier for line 1' })).toContainText('Best price')
    await expect(dialog.getByRole('button', { name: 'Supplier for line 2' })).toContainText(s.supplierA.name)
    await expect(dialog.getByRole('button', { name: 'Supplier for line 3' })).toContainText('Not sourced yet')
    await shot(page, 'o01-convert-dialog-1440')

    // a double submit: two clicks in the same gesture; the client-made order id makes it one order
    await t.doubleTap(dialog.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    expect(t.count).toBe(2) // Mark won, Create order

    const orders = await get<{ id: string; number: number; customer_po_number: string | null; payment_terms_days: number | null; owner_id: string | null }>(`orders?rfq_id=eq.${s.rfq.id}&select=id,number,customer_po_number,payment_terms_days,owner_id`)
    expect(orders).toHaveLength(1)
    expect(orders[0].customer_po_number).toBeNull()
    expect(orders[0].payment_terms_days).toBe(45)
    expect((await get<{ needs_commissioning: boolean }>(`orders?id=eq.${orders[0].id}&select=needs_commissioning`))[0].needs_commissioning).toBe(true)
    const items = await get<{ description: string; supplier_order_id: string | null; unit_price_net: number; supplier_unit_price: number | null; is_service: boolean }>(
      `order_items?order_id=eq.${orders[0].id}&select=description,supplier_order_id,unit_price_net,supplier_unit_price,is_service&order=position`,
    )
    expect(items.map(i => Number(i.unit_price_net))).toEqual([1000, 2000, 500])
    expect(items[0].supplier_order_id).not.toBeNull()
    expect(Number(items[0].supplier_unit_price)).toBe(40)
    expect(items[2].supplier_order_id).toBeNull()
    const legs = await get<{ id: string; supplier_id: string; currency: string }>(`supplier_orders?order_id=eq.${orders[0].id}&select=id,supplier_id,currency`)
    expect(legs.map(l => l.supplier_id).sort()).toEqual([s.supplierA.id, s.supplierB.id].sort())
    expect(items[0].supplier_order_id).toBe(legs.find(l => l.supplier_id === s.supplierB.id)!.id)

    // the same id again (a retry, a second tab) returns the same order and writes nothing
    const again = await rest<string>('sales', 'rpc/convert_rfq_to_order', { method: 'POST', body: { p_order_id: orders[0].id, p_rfq_id: s.rfq.id } })
    expect(again.status).toBeLessThan(300)
    expect(await get(`orders?rfq_id=eq.${s.rfq.id}&select=id`)).toHaveLength(1)

    // afterwards the order is open and the RFQ page points at it
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s.customer.name)
    await page.goto(`/rfqs/${s.rfq.id}`)
    await expect(page.locator('[data-slot="mark-won"]').getByRole('link', { name: /Open ORD-\d{4}/ })).toBeVisible()
  })

  test('the supplier on a line can be changed, the customer PO is kept, and a line the quotation never priced is left out of the order', async ({ page }) => {
    const s = await seedRfq()
    await must(rest('admin', `rfq_items?id=eq.${s.items[2].id}`, { method: 'PATCH', body: { quoted_unit_price_net: null }, prefer: 'return=minimal' }))
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }).click()
    const dialog = page.getByRole('dialog')
    // the unpriced line was never sold: it is shown, marked left out, and asks for nothing
    await expect(dialog.getByTestId('convert-item-3-left-out')).toContainText('Left out of the order')
    await expect(dialog.getByText('Creates 2 order lines.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create order' })).toBeEnabled()
    // line 1: take supplier A instead of the lowest
    await dialog.getByRole('button', { name: 'Supplier for line 1' }).click()
    await page.getByRole('option', { name: new RegExp(s.supplierA.name) }).click()
    await dialog.getByLabel('Customer PO number').fill(`CPO-${s.tag}`)
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    const [order] = await get<{ id: string; customer_po_number: string }>(`orders?rfq_id=eq.${s.rfq.id}&select=id,customer_po_number`)
    expect(order.customer_po_number).toBe(`CPO-${s.tag}`)
    const items = await get<{ unit_price_net: number; supplier_unit_price: number; supplier_order_id: string }>(`order_items?order_id=eq.${order.id}&select=unit_price_net,supplier_unit_price,supplier_order_id&order=position`)
    expect(Number(items[0].supplier_unit_price)).toBe(50)
    expect(items).toHaveLength(2)
    await expect(page.getByText(`CPO-${s.tag}`).first()).toBeVisible()
  })

  test('Mark won once the quotation is issued: 2 taps', async ({ page }) => {
    const s = await seedRfq()
    await must(rest('admin', 'rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: s.rfq.id } }))
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    // Mark won is not repeated on the quotation row: it is the page's one green button once a quotation is out.
    await expect(page.getByTestId('quotation-0').getByRole('button', { name: 'Mark won' })).toHaveCount(0)
    await t.tap(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }))
    await t.tap(page.getByRole('dialog').getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    expect(t.count).toBe(2)
  })
})

// ------------------------------------------------------------------------------------------------ O03 legs

test.describe('O03: supplier orders, one next-step stamp each', () => {
  test('Mark placed (no PO: from the row menu, 2 taps), Delivered today (1 tap), no receiving step, expected date suggested from the lead time, every stamp has an Undo', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const a = leg(page, 'A')
    await expect(a).toContainText(s.supplierA.name)
    // not placed and no PO: Issue PO is on the row, "Mark placed, no PO" is in its menu (never both side by side)
    await expect(a.getByRole('button', { name: `Issue PO, ${s.supplierA.name}` })).toBeVisible()
    await expect(a.getByRole('button', { name: /Mark placed/ })).toHaveCount(0)
    await expect(a).toContainText('suggested from lead time 2 wks')
    await expect(page.getByTestId('leg-A-state')).toContainText('To place')
    const placeFromMenu = async () => {
      await t.tap(a.getByRole('button', { name: `More for ${s.supplierA.name}` }))
      await t.tap(page.getByRole('menuitem', { name: 'Mark placed, no PO' }))
    }

    await placeFromMenu()
    await expect(page.getByTestId('leg-A-state')).toContainText('On order')
    const row = await legRow(s.legA)
    expect(row.placed_on).toBe(karachiDay(0))
    expect(row.expected_on).toBe(karachiDay(14))
    await expect(a).toContainText('from lead time 2 wks')

    // the Undo restores exactly what was there, including the suggested expected date
    await page.getByRole('status').filter({ hasText: 'Marked placed' }).getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await legRow(s.legA)).placed_on).toBeNull()
    expect((await legRow(s.legA)).expected_on).toBeNull()
    await placeFromMenu()
    await expect(a.getByRole('button', { name: `Delivered today, ${s.supplierA.name}` })).toBeVisible()
    // there is no receiving step or date anywhere on the leg
    await expect(page.getByRole('button', { name: /Received today/ })).toHaveCount(0)
    await expect(a.getByText('Received', { exact: true })).toHaveCount(0)
    await t.tap(a.getByRole('button', { name: `Delivered today, ${s.supplierA.name}` }))
    await expect(page.getByTestId('leg-A-state')).toContainText('Delivered')
    expect((await legRow(s.legA)).delivered_on).toBe(karachiDay(0))
    // received_on is set by the app to the delivered date
    expect((await legRow(s.legA)).received_on).toBe(karachiDay(0))
    await expect(a.getByRole('button', { name: new RegExp(`(Delivered today|Mark placed), ${s.supplierA.name}`) })).toHaveCount(0)
    // 5 taps in all: placed without a PO twice (menu + item, the first undone), delivered (1). Issue PO is the 1-tap way to place.
    expect(t.count).toBe(5)
    // the toast is added after the save returns, which can be a beat after the leg already reads Delivered: click this stamp's own Undo
    await page.getByRole('status').filter({ hasText: 'Marked delivered' }).getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await legRow(s.legA)).delivered_on).toBeNull()
    // undo clears both
    expect((await legRow(s.legA)).received_on).toBeNull()
    await shot(page, 'o03-legs-stamped-1440')
  })

  test('a stamped date reads as text and edits on tap; editing Delivered moves the stored received date with it', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const b = leg(page, 'B')
    // leg B is placed 10 days ago: tapping its Placed date shows it as text and opens an editor
    const B = s.supplierB.name
    await expect(b.getByRole('button', { name: new RegExp(`^Placed date, ${B}: .*Edit$`) })).toBeVisible()
    await b.getByRole('button', { name: new RegExp(`^Delivered date, ${B}`) }).click()
    await page.getByRole('textbox', { name: `Delivered date, ${B}` }).fill(slashDate(karachiDay(0)))
    await page.getByRole('textbox', { name: `Delivered date, ${B}` }).press('Enter')
    await page.getByRole('button', { name: 'Save' }).click()
    // the editor closes only after the save and refetch finish; clicking its trigger sooner would toggle it shut
    await expect(page.getByRole('textbox', { name: `Delivered date, ${B}` })).toHaveCount(0)
    await expect.poll(async () => (await legRow(s.legB)).delivered_on).toBe(karachiDay(0))
    expect((await legRow(s.legB)).received_on).toBe(karachiDay(0))
    // editing delivered moves received too
    await b.getByRole('button', { name: new RegExp(`^Delivered date, ${B}`) }).click()
    await page.getByRole('textbox', { name: `Delivered date, ${B}` }).fill(slashDate(karachiDay(-1)))
    await page.getByRole('textbox', { name: `Delivered date, ${B}` }).press('Enter')
    await page.getByRole('button', { name: 'Save' }).click()
    // the editor closes only after the save and refetch finish; clicking its trigger sooner would toggle it shut
    await expect(page.getByRole('textbox', { name: `Delivered date, ${B}` })).toHaveCount(0)
    await expect.poll(async () => (await legRow(s.legB)).delivered_on).toBe(karachiDay(-1))
    expect((await legRow(s.legB)).received_on).toBe(karachiDay(-1))
    // and a date can be fixed
    await b.getByRole('button', { name: new RegExp(`^Placed date, ${B}`) }).click()
    await page.getByRole('textbox', { name: `Placed date, ${B}` }).fill(slashDate(karachiDay(-9)))
    await page.getByRole('textbox', { name: `Placed date, ${B}` }).press('Enter')
    await page.getByRole('button', { name: 'Save' }).click()
    // the editor closes only after the save and refetch finish; clicking its trigger sooner would toggle it shut
    await expect(page.getByRole('textbox', { name: `Placed date, ${B}` })).toHaveCount(0)
    await expect.poll(async () => (await legRow(s.legB)).placed_on).toBe(karachiDay(-9))
  })

  test('the supplier order reference edits on tap', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await leg(page, 'A').getByRole('button', { name: new RegExp(`Reference, ${s.supplierA.name}`) }).click()
    await page.getByRole('textbox', { name: `Reference, ${s.supplierA.name}` }).fill('PO-26-0017')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await legRow(s.legA)).reference).toBe('PO-26-0017')
    await expect(leg(page, 'A')).toContainText('PO-26-0017')
  })

  test('late goods can be chased with the R16 message; copying marks it chased, and Undo takes it back', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const b = leg(page, 'B')
    await expect(page.getByTestId('leg-B-state')).toContainText('Late')
    await b.getByRole('button', { name: `Chase goods, ${s.supplierB.name}` }).click()
    const dialog = page.getByRole('dialog')
    // the same wording as Today: the leg's reference is in the text
    await expect(dialog.getByTestId('draft-text')).toContainText('PI-123')
    await expect(dialog.getByTestId('draft-text')).toContainText('Memosens pH sensor')
    await shot(page, 'o03-goods-chase-dialog-1440')
    await resetClipboard(page)
    await dialog.getByRole('button', { name: 'Copy message and mark chased' }).click()
    await expect.poll(async () => (await legRow(s.legB)).chase_count).toBe(1)
    expect((await legRow(s.legB)).last_chased_on).toBe(karachiDay(0))
    await readClipboardWhen(page, 'PI-123')
    await page.getByRole('button', { name: /Undo/ }).first().click()
    await expect.poll(async () => (await legRow(s.legB)).chase_count).toBe(0)
  })
})

// ------------------------------------------------------------------------------------------------ O03 items

test.describe('O03: items', () => {
  test('GST per line, exempt the whole order, and the service flag', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible()
    // the per-line controls are behind one toggle: the table shows five columns until then
    await expect(page.getByLabel('GST rate, line 1')).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit GST and lines' }).click()
    await page.getByLabel('GST rate, line 1').selectOption('5')
    await expect.poll(async () => Number((await itemRows(s.order.id))[0].gst_rate)).toBe(5)
    expect(Number((await itemRows(s.order.id))[1].gst_rate)).toBe(18)

    const exempt = page.getByRole('checkbox', { name: 'Exempt the whole order from GST' })
    await exempt.click()
    await expect.poll(async () => (await itemRows(s.order.id)).map(r => Number(r.gst_rate))).toEqual([0, 0, 0])
    await expect(exempt).toBeChecked()
    // off again: every line returns to where it was
    await exempt.click()
    await expect.poll(async () => (await itemRows(s.order.id)).map(r => Number(r.gst_rate))).toEqual([5, 18, 18])

    // service: the line has no goods leg
    await page.getByRole('checkbox', { name: 'Service, line 2' }).click()
    await expect.poll(async () => (await itemRows(s.order.id))[1].is_service).toBe(true)
    expect((await itemRows(s.order.id))[1].supplier_order_id).toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------ O03 commissioning, cancel

test.describe('O03: commissioning and cancel', () => {
  test('the engineer marks commissioning done in 1 tap, typing nothing, and changes the planned date separately', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s.company.name)
    await expect(page.getByRole('button', { name: 'Change planned date' })).toBeVisible()
    await t.tap(page.getByRole('button', { name: 'Mark done today' }))
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_done_on).toBe(karachiDay(0))
    expect(t.count).toBe(1)
    await expect(page.getByRole('button', { name: 'Mark done today' })).toHaveCount(0)
    await expect(page.getByTestId('order-notes')).toContainText('Gate pass needed 2 days ahead.')
    await page.getByRole('button', { name: /Undo/ }).first().click()
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_done_on).toBeNull()

    // the planned date is its own optional action
    await page.getByRole('button', { name: 'Change planned date' }).click()
    await page.getByRole('textbox', { name: 'Planned date' }).fill(slashDate(karachiDay(20)))
    await page.getByRole('textbox', { name: 'Planned date' }).press('Enter')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_planned_on).toBe(karachiDay(20))
  })

  test('the engineer marks a supplier order placed or delivered in 1 tap each', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await t.tap(leg(page, 'A').getByRole('button', { name: `Mark placed, ${s.supplierA.name}` }))
    await expect.poll(async () => (await legRow(s.legA)).placed_on).toBe(karachiDay(0))
    await t.tap(leg(page, 'B').getByRole('button', { name: `Delivered today, ${s.supplierB.name}` }))
    await expect.poll(async () => (await legRow(s.legB)).delivered_on).toBe(karachiDay(0))
    expect((await legRow(s.legB)).received_on).toBe(karachiDay(0))
    await expect(page.getByRole('button', { name: /Received today/ })).toHaveCount(0)
    expect(t.count).toBe(2)
  })

  test('admin or sales: Edit sets the needs-it toggle, the planned date and the engineers; then Mark done today', async ({ page }) => {
    const s = await seedOrder({ needs_commissioning: false, commissioning_planned_on: null })
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    const section = page.getByRole('region', { name: 'Commissioning' })
    await expect(section).toContainText('This order has no commissioning')
    await section.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: 'This order needs commissioning' }).click()
    await dialog.getByRole('textbox', { name: 'Planned on' }).fill(slashDate(karachiDay(15)))
    await dialog.getByRole('textbox', { name: 'Planned on' }).press('Enter')
    await expect(dialog.getByRole('list', { name: /Engineers on this order/ })).toContainText(s.engineer.name)
    await dialog.getByRole('button', { name: `Remove ${s.engineer.name}` }).click()
    await expect.poll(async () => (await get(`order_engineers?order_id=eq.${s.order.id}&select=user_id`)).length).toBe(0)
    await dialog.getByRole('combobox', { name: 'Assign an engineer' }).selectOption({ label: s.engineer.name })
    await expect.poll(async () => (await get(`order_engineers?order_id=eq.${s.order.id}&select=user_id`)).length).toBe(1)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await orderRow(s.order.id)).needs_commissioning).toBe(true)
    expect((await orderRow(s.order.id)).commissioning_planned_on).toBe(karachiDay(15))
    await expect(section.getByRole('list', { name: 'Engineers on this order' })).toContainText(s.engineer.name)
    await section.getByRole('button', { name: 'Mark done today' }).click()
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_done_on).toBe(karachiDay(0))
  })

  test('cancel an order with a reason; it stays on record and can be reopened', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Cancel order' }).click()
    const dialog = page.getByRole('dialog')
    // a reason is needed
    await expect(dialog.getByRole('button', { name: 'Cancel order' })).toBeDisabled()
    await dialog.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
    await expect(dialog.getByRole('radio')).toHaveCount(6)
    await shot(page, 'o03-cancel-dialog-1440')
    await dialog.getByRole('button', { name: 'Cancel order' }).click()
    // The dialog's own text carries the reason label too, and it is still on screen while it fades out: wait for it to go
    // before reading the page behind it, or the sentence matches twice.
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await orderRow(s.order.id)).cancelled_on).toBe(karachiDay(0))
    const row = await orderRow(s.order.id)
    // the reason is a structured key; the notes are exactly what people wrote and are never appended to
    expect(row.cancel_reason).toBe('customer_cancelled')
    expect(row.notes).toBe('Gate pass needed 2 days ahead.')
    await expect(page.getByText(/^Cancelled /).first()).toBeVisible()
    await expect(page.locator('#main').getByText(/The customer cancelled the PO\./)).toBeVisible()
    // nothing can be stamped while it is cancelled
    await expect(page.getByRole('button', { name: /Mark placed/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Reopen order' }).click()
    await expect.poll(async () => (await orderRow(s.order.id)).cancelled_on).toBeNull()
    expect((await orderRow(s.order.id)).cancel_reason).toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------ O03 role views

test.describe('O03: role views', () => {
  test('an engineer is never shown a price and never asks for money: no receivables, invoices, payments, costs or margin', async ({ page }) => {
    const s = await seedOrder()
    const urls: string[] = []
    page.on('request', r => {
      if (r.url().includes('/rest/v1/')) urls.push(decodeURIComponent(r.url()) + (r.postData() ?? ''))
    })
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible()
    await expect(leg(page, 'A')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Commissioning' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const text = await page.locator('#main').innerText()
    expect(text).not.toMatch(/PKR|48,500|96,500|135,000|GST|Invoic|Margin|Payment|Terms|Exempt|Costs|Balance|Add line|Add supplier|Issue PO|Record payment|Add expense|Create invoice/i)
    await expect(page.getByRole('checkbox', { name: /Exempt|Service/ })).toHaveCount(0)
    await expect(page.getByLabel(/GST rate/)).toHaveCount(0)
    await expect(page.getByText('Not set')).toHaveCount(0)
    // no money column in the lines table, and no money dimension
    for (const header of ['Unit price', 'Total']) await expect(page.getByRole('columnheader', { name: new RegExp(header) })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Items' })).toBeVisible()
    // the page leads with the engineer's job; supplier B's goods are late, so its one green button is Delivered today, and Mark done today
    // (planned in 10 days) is still one tap, as a secondary button
    const job = page.getByRole('region', { name: 'Your job' })
    await expect(job).toContainText('Hub plant, kiln line 2')
    await expect(job).toContainText('Mr. Tariq Hussain')
    await expect(page.locator('#main button.bg-primary:visible')).toHaveText(['Delivered today'])
    await expect(job.getByRole('button', { name: 'Mark done today' })).toBeVisible()

    const forbidden = /unit_price_net|supplier_unit_price|gst_rate|order_receivables|\/invoices|payments_in|expenses|order_costs|v_order_money|v_order_items_total|invoicing_state|[,=(]gross|[,=(]net\b|invoiced/
    const leaks = urls.filter(u => forbidden.test(u.replace(/^https?:\/\/[^/]+/, '')))
    expect(leaks).toEqual([])
    // the order itself was read, so the assertion above is not vacuous
    expect(urls.some(u => u.includes('/order_items?') || u.includes('/orders?'))).toBe(true)
    expect(urls.some(u => u.includes('v_order_state'))).toBe(true)
    await shot(page, 'o03-engineer-1440')
  })

  test('admin sees five dimension cells, prices, the margin, the balance in the strip, and exactly one green button: the next step', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    const items = page.getByRole('table', { name: 'Order items' })
    await expect(items).toContainText('48,500')
    await expect(items).toContainText('291,000')
    // five columns; the supplier is named on the line, no leg letters
    await expect(items.getByRole('columnheader')).toHaveText(['Item', 'Qty', /Unit price/, /Total/, 'Supplier'])
    await expect(items).toContainText(s.supplierA.name)
    await expect(page.getByTestId('items-gst-summary')).toContainText('730,420')
    const dims = page.getByLabel('State of this order')
    for (const d of ['Goods', 'Commissioning', 'Invoicing', 'Payment', 'Costs']) await expect(dims.getByRole('heading', { name: d })).toBeVisible()
    await expect(dims).toContainText('Not invoiced')
    await expect(dims).toContainText('Unpaid')
    await expect(dims).toContainText(/Provisional|Not final/)
    await expect(leg(page, 'A')).toContainText('EUR')
    await expect(page.getByTestId('leg-A-total')).toContainText('1,284')
    await expect(page.getByTestId('leg-A-po')).toHaveText('No PO yet')
    await expect(page.getByRole('region', { name: 'Margin' })).toContainText('Admin only')
    await expect(page.getByTestId('margin-expenses-empty')).toBeVisible()
    // the Invoices and payments panel is folded into the strip: invoiced, received, balance
    await expect(page.getByRole('region', { name: 'Invoices and payments' })).toHaveCount(0)
    await expect(page.getByTestId('order-invoiced')).toContainText('730,420 to invoice')
    await expect(page.getByTestId('order-balance')).toHaveText('730,420')
    await expect(page.getByTestId('payments-empty')).toBeVisible()
    // ONE green button for the page, chosen by state (the same order as the list): supplier B's goods are late, which comes first
    await expect(page.getByRole('region', { name: 'Next step' })).toContainText(`Goods from ${s.supplierB.name} are 3 days late`)
    await expect(page.locator('#main button.bg-primary:visible')).toHaveText(['Chase goods'])
    await expect(page.locator('#main button.bg-primary:visible')).toHaveAccessibleName(`Chase goods, ${s.supplierB.name}`)
    // every other action once: Record payment and Create invoice in the strip, Add expense on each supplier order and in Margin
    for (const name of ['Record payment', 'Create invoice']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: `Issue PO, ${s.supplierA.name}` })).toBeEnabled()
    await expect(page.getByRole('region', { name: 'Margin' }).getByRole('button', { name: 'Add expense' })).toBeEnabled()
    await leg(page, 'A').getByRole('button', { name: `More for ${s.supplierA.name}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Add expense' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Add line' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add supplier' })).toBeVisible()
    await expect(page.getByText(s.po).first()).toBeVisible()
    await expect(page.getByText('Terms 30 days from invoice')).toBeVisible()
    await shot(page, 'o03-admin-1440')
  })

  test('sales see four cells (no Costs), the balance and no margin; sales read the balance, never payment rows', async ({ page }) => {
    const s = await seedOrder()
    await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: s.order.id, amount: 100000, received_on: karachiDay(-2) }, prefer: 'return=minimal' }))
    const urls: string[] = []
    page.on('request', r => urls.push(decodeURIComponent(r.url())))
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(page.getByRole('table', { name: 'Order items' })).toContainText('48,500')
    const dims = page.getByLabel('State of this order')
    for (const d of ['Goods', 'Commissioning', 'Invoicing', 'Payment']) await expect(dims.getByRole('heading', { name: d })).toBeVisible()
    await expect(dims.getByRole('heading', { name: 'Costs' })).toHaveCount(0)
    await expect(dims).toContainText('Part paid')
    await expect(page.getByRole('region', { name: 'Margin' })).toHaveCount(0)
    await expect(page.locator('[data-slot="margin-costs"]')).toHaveCount(0)
    await expect(page.getByTestId('order-balance')).toHaveText('630,420')
    // sales: Create invoice (M01) only; Record payment and Add expense are admin's
    await expect(page.getByRole('button', { name: 'Create invoice' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add expense' })).toHaveCount(0)
    await expect(page.locator('#main button.bg-primary:visible')).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    expect(urls.filter(u => /payments_in|v_order_money|expenses|order_costs/.test(u))).toEqual([])
    expect(urls.some(u => u.includes('order_receivables'))).toBe(true)
    await shot(page, 'o03-sales-1440')
  })

  test('a legacy order with an unknown price basis: the banner, the prices as typed, and Is GST included? shows what each choice does before it rewrites anything', async ({ page }) => {
    const s = await seedOrder({ legacy_flags: ['value_basis_unknown'] })
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await expect(page.getByText('Is GST included in these prices?').first()).toBeVisible()
    await expect(page.getByLabel('State of this order')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Margin' })).toContainText('Is GST included?')
    await expect(page.getByRole('columnheader', { name: /Unit price as typed/ })).toBeVisible()
    await expect(page.getByLabel(/GST rate/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit GST and lines' })).toHaveCount(0)
    // the question is the page's one green button
    await expect(page.locator('#main button.bg-primary:visible')).toHaveText(['Is GST included?'])
    await shot(page, 'o03-basis-unknown-1440')
    await page.getByRole('button', { name: 'Is GST included?' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Save answer' })).toBeDisabled()
    await expect(dialog).toContainText('Net 619,000 + GST 111,420 = 730,420 gross.')
    await shot(page, 'o03-resolve-basis-dialog-1440')
    await dialog.getByRole('radio', { name: /The prices are before GST/ }).click()
    await dialog.getByRole('button', { name: 'Save answer' }).click()
    await expect.poll(async () => ((await orderRow(s.order.id)).legacy_flags as string[]).includes('value_basis_unknown')).toBe(false)
    await expect(page.getByText('Is GST included in these prices?')).toHaveCount(0)
  })

  test('Add line and Add supplier', async ({ page }) => {
    const s = await seedOrder()
    const supplierC = await createCompany(uniqueName('Lahore Automation'))
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfqId, supplier_id: supplierC.id, sent_on: karachiDay(-2) }, prefer: 'return=minimal' }))
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const t = tapper()

    await t.tap(page.getByRole('button', { name: 'Add line' }))
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Add line' })).toBeDisabled()
    await dialog.getByLabel('Description').fill('Terminal and cable gland kit, IP67')
    await dialog.getByLabel('Unit price, net PKR').fill('5600')
    await shot(page, 'o03-add-line-dialog-1440')
    await dialog.getByRole('button', { name: 'Add line' }).click()
    await expect.poll(async () => (await itemRows(s.order.id)).length).toBe(4)
    const added = (await itemRows(s.order.id))[3]
    expect(Number(added.gst_rate)).toBe(18)
    expect(added.is_service).toBe(false)
    await expect(page.getByRole('table', { name: 'Order items' })).toContainText('Terminal and cable gland kit, IP67')

    await t.tap(page.getByRole('button', { name: 'Add supplier' }))
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Supplier').selectOption({ label: supplierC.name })
    await expect(dialog.getByLabel('Currency')).toHaveValue('PKR')
    await dialog.getByRole('button', { name: 'Add supplier' }).click()
    await expect.poll(async () => (await get(`supplier_orders?order_id=eq.${s.order.id}&select=supplier_id,currency`)).length).toBe(3)
    await expect(page.getByTestId('leg-C')).toContainText(supplierC.name)
  })

  test('an order that is not there says so, with a way back', async ({ page }) => {
    await openAs(page, 'sales', `/orders/${crypto.randomUUID()}`)
    await expect(page.getByText("This order isn't here")).toBeVisible()
    await expect(page.getByRole('link', { name: 'All orders' })).toBeVisible()
  })
})

// ------------------------------------------------------------------------------------------------ palette

test.describe('O03: the command palette finds an order by number and customer PO', () => {
  const openPalette = async (page: Page) => {
    await page.locator('#main').waitFor()
    await expect(async () => {
      if (!(await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())) await page.keyboard.press('Control+k')
      await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
  }

  const ref = (n: number) => `ORD-${String(n).padStart(4, '0')}`

  test('by customer PO, and by order number', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(s.po.slice(0, 9))
    const hit = page.getByRole('option', { name: new RegExp(`${ref(s.order.number)} ${s.company.name}`) })
    await expect(hit).toBeVisible()
    await expect(hit).toContainText(`Customer PO ${s.po}`)
    await shot(page, 'o03-palette-po-1440')
    await input.fill(ref(s.order.number))
    await expect(hit).toBeVisible()
    await hit.click()
    await expect(page).toHaveURL(new RegExp(`/orders/${s.order.id}$`))
  })

  test('an engineer finds an order by its number only, never by the PO number (R12: no PO or invoice number for an engineer)', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'engineer', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(s.po)
    await expect(page.getByRole('option', { name: new RegExp(`Add “${s.po}”`) })).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(1)
    await input.fill(ref(s.order.number))
    const hit = page.getByRole('option', { name: new RegExp(`${ref(s.order.number)} ${s.company.name}`) })
    await expect(hit).toBeVisible()
    await expect(hit).not.toContainText(s.po)
  })
})

// ------------------------------------------------------------------------------------------------ axe and screenshots

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}: order page for admin and engineer, the Mark won dialog`, async ({ page }) => {
    const s = await seedOrder()
    const r = await seedRfq()
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })

    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await expect(leg(page, 'A')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Items' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    // nothing scrolls sideways, at 375 as at 1440
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    if (width < 768) {
      // one bar with back and the order number; the next step sits in a bar at the bottom instead of the tabs
      await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
      await expect(page.getByTestId('order-sticky-action').getByRole('button', { name: /^Chase goods/ })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
    }
    await review(page, `o03-order-admin-${width}`)

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Cancel order' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await dialogViolations(page)).toEqual([])
    await page.keyboard.press('Escape')

    await signOutHard(page)
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await expect(leg(page, 'A')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark done today' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `o03-order-engineer-${width}`)

    await signOutHard(page)
    await openAs(page, 'sales', `/rfqs/${r.rfq.id}`)
    await page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Mark won' })).toBeVisible()
    expect(await dialogViolations(page)).toEqual([])
    await shot(page, `o01-convert-dialog-open-${width}`)
  })
}
