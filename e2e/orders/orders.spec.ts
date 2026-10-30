import { expect, test, type Locator, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'
import { JOB_URL, markWonButton, openStage, stagesOf } from '../support/job'

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
    /** Typing a value is an interaction too. */
    typed: async (target: Locator, value: string) => {
      await target.fill(value)
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
async function seedRfq(opts: { prices?: boolean } = {}): Promise<RfqSeed> {
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = await createCompany(uniqueName('Convert Customer'))
  await must(rest('admin', 'orders', { method: 'POST', body: { company_id: customer.id, ordered_on: karachiDay(-30), payment_terms_days: 45 } }))
  // quoted_on: the quotation is out (marked sent by phone), so Mark won is the RFQ page's one green button (UX audit 2026-10-19).
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
  const items = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: `Damper actuator ${tag}`, qty: 2, ...(opts.prices ? { quoted_unit_price_net: 1000 } : {}) },
        { rfq_id: rfq.id, position: 1, description: `Pressure transmitter ${tag}`, qty: 1, ...(opts.prices ? { quoted_unit_price_net: 2000 } : {}) },
        { rfq_id: rfq.id, position: 2, description: `Commissioning ${tag}`, qty: 3, ...(opts.prices ? { quoted_unit_price_net: 500 } : {}) },
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

/** Issues a real quotation (R0, then R1 on a second call) of just these items, as the Issue quotation dialog does. */
const issueQuotation = (rfqId: string, lines: { id: string; unit_price: number; qty: number }[]) =>
  must(
    rest('admin', 'rpc/issue_quotation', {
      method: 'POST',
      body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfqId, p_lines: lines.map(l => ({ ...l, gst_rate: 18, lead_time: null })) },
    }),
  )

const price = (dialog: Locator, line: number) => dialog.getByLabel(`Selling price, line ${line}`)
const rfqItemPrices = (rfqId: string) => get<{ quoted_unit_price_net: number | null }>(`rfq_items?rfq_id=eq.${rfqId}&select=quoted_unit_price_net&order=position`)

test.describe('O01: Mark won creates the order', () => {
  test("the owner's shape (marked sent by phone, one supplier reply, no quotation): the line is ticked, the price is typed once, and nothing is written back to the RFQ", async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 6)
    const customer = await createCompany(uniqueName('Owner Shape Customer'))
    const supplier = await createCompany(uniqueName('Alpenmark'), { country: 'Germany' })
    const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
    const [item] = await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: [{ rfq_id: rfq.id, position: 0, description: `Hart level transmitter ${tag}`, qty: 2 }] }))
    const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } })))[0]
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiry.id, rfq_item_id: item.id, unit_price: 412, currency: 'USD', lead_time: '3 wks' }, prefer: 'return=minimal' }))

    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    await (await markWonButton(page)).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Mark won' })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Include line 1' })).toBeChecked()
    await expect(price(dialog, 1)).toHaveValue('')
    await expect(dialog).toContainText('Type the selling price from your costing sheet')
    await shot(page, 'a1-markwon-owner-shape-1440')
    expect(await dialogViolations(page)).toEqual([])
    // the same dialog on a phone: the price input stacks under its label, nothing scrolls sideways
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(price(dialog, 1)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    expect(await dialogViolations(page)).toEqual([])
    await shot(page, 'a1-markwon-owner-shape-375')
    await page.setViewportSize({ width: 1440, height: 900 })
    // not stuck: Create order is pressable and says what is missing, then takes the person to the field
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(dialog).toContainText('Type a selling price for line 1.')
    await expect(price(dialog, 1)).toBeFocused()
    expect(await get(`orders?rfq_id=eq.${rfq.id}&select=id`)).toHaveLength(0)

    await price(dialog, 1).fill('120,000')
    await expect(dialog).toContainText('gross PKR 283,200')
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(JOB_URL)
    const [order] = await get<{ id: string }>(`orders?rfq_id=eq.${rfq.id}&select=id`)
    const items = await get<{ unit_price_net: number; supplier_unit_price: number }>(`order_items?order_id=eq.${order.id}&select=unit_price_net,supplier_unit_price&order=position`)
    expect(items.map(i => [Number(i.unit_price_net), Number(i.supplier_unit_price)])).toEqual([[120000, 412]])
    // the typed price makes no quotation and is not written to the RFQ item
    expect((await rfqItemPrices(rfq.id)).map(i => i.quoted_unit_price_net)).toEqual([null])
    expect(await get(`quotations?rfq_id=eq.${rfq.id}&select=id`)).toHaveLength(0)
  })

  test('typing every price: suppliers come from the ranking, terms from the last order, and a double submit makes one order', async ({ page }) => {
    const s = await seedRfq()
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.getByRole('heading', { name: s.customer.name }).first()).toBeVisible()

    await t.tap(await markWonButton(page))
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Mark won' })).toBeVisible()
    await expect(dialog.getByLabel('Customer PO number')).toHaveValue('')
    await expect(dialog.getByLabel('Payment terms in days')).toHaveValue('45')
    await expect(dialog).toContainText('from the last order')
    await expect(dialog.getByRole('checkbox', { name: 'Needs commissioning' })).toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Supplier for line 1' })).toContainText(s.supplierB.name)
    await expect(dialog.getByRole('button', { name: 'Supplier for line 1' })).toContainText('Best price')
    await expect(dialog.getByRole('button', { name: 'Supplier for line 2' })).toContainText(s.supplierA.name)
    await expect(dialog.getByRole('button', { name: 'Supplier for line 3' })).toContainText('Not sourced yet')
    for (const [n, v] of [['1', '1000'], ['2', '2000'], ['3', '500']]) await t.typed(price(dialog, Number(n)), v)

    await t.doubleTap(dialog.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(JOB_URL)
    expect(t.count).toBe(1 + 3 + 1) // Mark won, three prices typed, Create order

    const orders = await get<{ id: string; customer_po_number: string | null; payment_terms_days: number | null }>(`orders?rfq_id=eq.${s.rfq.id}&select=id,customer_po_number,payment_terms_days`)
    expect(orders).toHaveLength(1)
    expect(orders[0].customer_po_number).toBeNull()
    expect(orders[0].payment_terms_days).toBe(45)
    expect((await get<{ needs_commissioning: boolean }>(`orders?id=eq.${orders[0].id}&select=needs_commissioning`))[0].needs_commissioning).toBe(true)
    const items = await get<{ supplier_order_id: string | null; unit_price_net: number; supplier_unit_price: number | null }>(
      `order_items?order_id=eq.${orders[0].id}&select=supplier_order_id,unit_price_net,supplier_unit_price&order=position`,
    )
    expect(items.map(i => Number(i.unit_price_net))).toEqual([1000, 2000, 500])
    expect(Number(items[0].supplier_unit_price)).toBe(40)
    expect(items[2].supplier_order_id).toBeNull()
    const legs = await get<{ id: string; supplier_id: string }>(`supplier_orders?order_id=eq.${orders[0].id}&select=id,supplier_id`)
    expect(legs.map(l => l.supplier_id).sort()).toEqual([s.supplierA.id, s.supplierB.id].sort())
    expect(items[0].supplier_order_id).toBe(legs.find(l => l.supplier_id === s.supplierB.id)!.id)

    // the same id again (a retry, a second tab) returns the same order and writes nothing
    const again = await rest<string>('sales', 'rpc/convert_rfq_to_order', { method: 'POST', body: { p_order_id: orders[0].id, p_rfq_id: s.rfq.id } })
    expect(again.status).toBeLessThan(300)
    expect(await get(`orders?rfq_id=eq.${s.rfq.id}&select=id`)).toHaveLength(1)
    // the won enquiry has its order: the job page offers no Mark won any more
    await page.goto(`/rfqs/${s.rfq.id}`)
    await expect(stagesOf(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark won', exact: true })).toHaveCount(0)
  })

  test('a partial quotation: the line it left out starts unticked, a supplier can be changed, the customer PO is kept', async ({ page }) => {
    const s = await seedRfq()
    await issueQuotation(s.rfq.id, [
      { id: s.items[0].id, unit_price: 1000, qty: 2 },
      { id: s.items[1].id, unit_price: 2000, qty: 1 },
    ])
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await (await markWonButton(page)).click()
    const dialog = page.getByRole('dialog')
    await expect(price(dialog, 1)).toHaveValue('1,000')
    await expect(dialog.getByRole('checkbox', { name: 'Include line 3' })).not.toBeChecked()
    await expect(dialog.getByTestId('convert-item-3-not-in')).toContainText(/Not in QT-\d\d-\d{4}/)
    await expect(dialog.getByText('Creates 2 order lines.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Supplier for line 1' }).click()
    await page.getByRole('option', { name: new RegExp(s.supplierA.name) }).click()
    await dialog.getByLabel('Customer PO number').fill(`CPO-${s.tag}`)
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(JOB_URL)
    const [order] = await get<{ id: string; customer_po_number: string }>(`orders?rfq_id=eq.${s.rfq.id}&select=id,customer_po_number`)
    expect(order.customer_po_number).toBe(`CPO-${s.tag}`)
    const items = await get<{ unit_price_net: number; supplier_unit_price: number }>(`order_items?order_id=eq.${order.id}&select=unit_price_net,supplier_unit_price&order=position`)
    expect(items.map(i => Number(i.unit_price_net))).toEqual([1000, 2000])
    expect(Number(items[0].supplier_unit_price)).toBe(50)
  })

  test('partial revision: R0 priced items 1 and 2, R1 dropped item 2 and repriced item 1; the order follows R1 and R0 is not resurrected', async ({ page }) => {
    const s = await seedRfq()
    await issueQuotation(s.rfq.id, [
      { id: s.items[0].id, unit_price: 1000, qty: 2 },
      { id: s.items[1].id, unit_price: 2000, qty: 1 },
    ])
    await issueQuotation(s.rfq.id, [{ id: s.items[0].id, unit_price: 1100, qty: 2 }])
    // R1 left item 2 out: 0094 clears the R0 price it would otherwise keep (HW-46)
    expect((await rfqItemPrices(s.rfq.id)).map(i => i.quoted_unit_price_net && Number(i.quoted_unit_price_net))).toEqual([1100, null, null])
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await (await markWonButton(page)).click()
    const dialog = page.getByRole('dialog')
    await expect(price(dialog, 1)).toHaveValue('1,100')
    await expect(dialog.getByRole('checkbox', { name: 'Include line 1' })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Include line 2' })).not.toBeChecked()
    await expect(dialog.getByTestId('convert-item-2-not-in')).toContainText(/R1/)
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(JOB_URL)
    const [order] = await get<{ id: string }>(`orders?rfq_id=eq.${s.rfq.id}&select=id`)
    const items = await get<{ unit_price_net: number }>(`order_items?order_id=eq.${order.id}&select=unit_price_net&order=position`)
    expect(items.map(i => Number(i.unit_price_net))).toEqual([1100])
  })

  test('imported, with legacy flags: the guessed supplier price warns, nothing is priced from it, and the typed price goes through', async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 6)
    const customer = await createCompany(uniqueName('Imported Customer'))
    const supplierA = await createCompany(uniqueName('Alpenmark'), { country: 'Germany' })
    const supplierB = await createCompany(uniqueName('Dubai Instrumentation'), { country: 'UAE' })
    const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
    const items = await must(
      rest<{ id: string; position: number }[]>('admin', 'rfq_items', {
        method: 'POST',
        body: [
          { rfq_id: rfq.id, position: 0, description: `Pressure transmitter ${tag}`, qty: 2 },
          { rfq_id: rfq.id, position: 1, description: `Flow meter ${tag}`, qty: 1 },
        ],
      }),
    )
    items.sort((a, b) => a.position - b.position)
    const inq = async (supplierId: string) => (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierId, sent_on: karachiDay(-3) } })))[0].id
    // the importer attached every supplier quote to item 1 and marked it
    await must(
      rest('admin', 'supplier_quote_lines', {
        method: 'POST',
        body: [
          { inquiry_id: await inq(supplierA.id), rfq_item_id: items[0].id, unit_price: 50, currency: 'USD', legacy_flags: ['item_guessed', 'currency_unverified'] },
          { inquiry_id: await inq(supplierB.id), rfq_item_id: items[0].id, unit_price: 40, currency: 'USD', legacy_flags: ['item_guessed', 'currency_unverified'] },
        ],
        prefer: 'return=minimal',
      }),
    )
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    await (await markWonButton(page)).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('convert-item-1-warning').first()).toContainText('may belong to another item')
    await expect(dialog.getByTestId('convert-item-1')).toContainText('currency of this supplier quote was not confirmed')
    await expect(price(dialog, 1)).toHaveValue('')
    await price(dialog, 1).fill('1500')
    await price(dialog, 2).fill('3000')
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(JOB_URL)
    const [order] = await get<{ id: string }>(`orders?rfq_id=eq.${rfq.id}&select=id`)
    const lines = await get<{ unit_price_net: number }>(`order_items?order_id=eq.${order.id}&select=unit_price_net&order=position`)
    expect(lines.map(i => Number(i.unit_price_net))).toEqual([1500, 3000])
  })

  test('a stale exchange rate: the warning names it, the rest of the dialog works, and the price is typed', async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 6)
    // SEK has one rate, 45 days old: older than the 30 days the ranking will use, so the supplier price has no PKR value
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { currency: 'SEK', rate_pkr: 26, as_of: karachiDay(-45), source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
    const customer = await createCompany(uniqueName('Stale Rate Customer'))
    const supplier = await createCompany(uniqueName('Nordmark'), { country: 'Sweden' })
    const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
    const [item] = await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: [{ rfq_id: rfq.id, position: 0, description: `Radar level sensor ${tag}`, qty: 1 }] }))
    const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } })))[0]
    await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiry.id, rfq_item_id: item.id, unit_price: 9000, currency: 'SEK' }, prefer: 'return=minimal' }))
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    await (await markWonButton(page)).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('convert-item-1-warning').first()).toContainText('No current SEK rate: pick the supplier')
    await expect(dialog.getByRole('button', { name: 'Create order' })).toBeEnabled()
    await price(dialog, 1).fill('300000')
    await dialog.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(JOB_URL)
  })

  test('Mark won once the quotation is issued: 2 taps', async ({ page }) => {
    const s = await seedRfq({ prices: true })
    await must(rest('admin', 'rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: s.rfq.id } }))
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    // Mark won is not repeated on the quotation row: it is the page's one green button once a quotation is out.
    await expect(page.getByRole('button', { name: 'Mark won', exact: true })).toHaveCount(1)
    await t.tap(await markWonButton(page))
    await t.tap(page.getByRole('dialog').getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(JOB_URL)
    expect(t.count).toBe(2)
  })
})

// ------------------------------------------------------------------------------------------------ O03 legs

test.describe('O03: supplier orders, one next-step stamp each', () => {
  test('Mark placed (no PO: from the row menu, 2 taps), Delivered today (1 tap), no receiving step, expected date suggested from the lead time, every stamp has an Undo', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await openStage(page, 'Supplier order')
    const a = leg(page, 'A')
    await expect(a).toContainText(s.supplierA.name)
    // not placed and no PO: Issue PO is on the row, "Mark placed, no PO" is in its menu (never both side by side)
    await expect(a.getByRole('button', { name: `Issue PO, ${s.supplierA.name}` })).toBeVisible()
    await expect(a.getByRole('button', { name: /Mark placed/ })).toHaveCount(0)
    await expect(a).toContainText('suggested from lead time 2 wks')
    await expect(page.getByTestId('leg-A-state')).toContainText('Not ordered yet')
    const placeFromMenu = async () => {
      // the job page opens the stage the job is at: placing moves it on to Delivery, undoing it brings it back
      await openStage(page, 'Supplier order')
      await t.tap(a.getByRole('button', { name: `More for ${s.supplierA.name}` }))
      await t.tap(page.getByRole('menuitem', { name: 'Mark placed, no PO' }))
    }

    await placeFromMenu()
    await expect(page.getByTestId('leg-A-state')).toContainText('Ordered')
    const row = await legRow(s.legA)
    expect(row.placed_on).toBe(karachiDay(0))
    expect(row.expected_on).toBe(karachiDay(14))
    await expect(a).toContainText('from lead time 2 wks')

    // the Undo restores exactly what was there, including the suggested expected date
    await page.getByRole('status').filter({ hasText: 'Marked placed' }).getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await legRow(s.legA)).placed_on).toBeNull()
    expect((await legRow(s.legA)).expected_on).toBeNull()
    await placeFromMenu()
    // Delivered today is on the Delivery stage
    await openStage(page, 'Delivery')
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
    await openStage(page, 'Delivery')
    const b = leg(page, 'B')
    await expect(page.getByTestId('leg-B-state')).toContainText('Overdue')
    await b.getByRole('button', { name: `Chase goods, ${s.supplierB.name}` }).click()
    const dialog = page.getByRole('dialog')
    // the same wording as Today: the leg's reference is in the text
    await expect(dialog.getByTestId('draft-text')).toContainText('PI-123')
    await expect(dialog.getByTestId('draft-text')).toContainText('Memosens pH sensor')
    await shot(page, 'o03-goods-chase-dialog-1440')
    await resetClipboard(page)
    await dialog.getByRole('button', { name: 'Copy and mark chased' }).click()
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
    // 0092 (owner decision): sales change the money fields (GST, prices, quantities) of an order they entered or own, so this order is the sales person's
    const s = await seedOrder({ owner_id: 'a0000000-0000-4000-8000-000000000002' })
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await openStage(page, 'Order')
    await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible()
    // the per-line controls are behind one toggle: the table shows five columns until then
    await expect(page.getByLabel('GST rate, line 1')).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit GST and lines' }).click()
    // 18% or exempt only (DECISIONS 2026-10-15, BUG-ORD-1)
    await page.getByLabel('GST rate, line 1').selectOption('0')
    await expect.poll(async () => Number((await itemRows(s.order.id))[0].gst_rate)).toBe(0)
    expect(Number((await itemRows(s.order.id))[1].gst_rate)).toBe(18)

    const exempt = page.getByRole('checkbox', { name: 'Exempt the whole order from GST' })
    await exempt.click()
    await expect.poll(async () => (await itemRows(s.order.id)).map(r => Number(r.gst_rate))).toEqual([0, 0, 0])
    await expect(exempt).toBeChecked()
    // off again: every line returns to where it was
    await exempt.click()
    await expect.poll(async () => (await itemRows(s.order.id)).map(r => Number(r.gst_rate))).toEqual([0, 18, 18])

    // service: the line has no goods leg
    await page.getByRole('checkbox', { name: 'Service, line 2' }).click()
    await expect.poll(async () => (await itemRows(s.order.id))[1].is_service).toBe(true)
    expect((await itemRows(s.order.id))[1].supplier_order_id).toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------ O03 commissioning, cancel

test.describe('O03: commissioning and cancel', () => {
  test('the engineer marks commissioning done in 1 tap, typing nothing (the On site card)', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    const onSite = page.getByRole('region', { name: 'On site' })
    await t.tap(onSite.getByRole('button', { name: 'Installed today' }))
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_done_on).toBe(karachiDay(0))
    expect(t.count).toBe(1)
    await expect(onSite.getByRole('button', { name: 'Installed today' })).toHaveCount(0)
    await page.getByRole('button', { name: /Undo/ }).first().click()
    await expect.poll(async () => (await orderRow(s.order.id)).commissioning_done_on).toBeNull()
  })

  test('the engineer marks a supplier order placed or delivered in 1 tap each', async ({ page }) => {
    const s = await seedOrder()
    const t = tapper()
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await openStage(page, 'Supplier order')
    await t.tap(leg(page, 'A').getByRole('button', { name: `I placed this order, ${s.supplierA.name}` }))
    await expect.poll(async () => (await legRow(s.legA)).placed_on).toBe(karachiDay(0))
    // the engineer's Delivered today is on the On site card, named for the supplier once two orders are on their way
    const onSite = page.getByRole('region', { name: 'On site' })
    await t.tap(onSite.getByRole('button', { name: `Delivered today, ${s.supplierB.name}` }))
    await expect.poll(async () => (await legRow(s.legB)).delivered_on).toBe(karachiDay(0))
    expect((await legRow(s.legB)).received_on).toBe(karachiDay(0))
    await expect(page.getByRole('button', { name: /Received today/ })).toHaveCount(0)
    expect(t.count).toBe(2)
  })

  test('admin or sales: Edit sets the needs-it toggle, the planned date and the engineers; then Mark done today', async ({ page }) => {
    const s = await seedOrder({ needs_commissioning: false, commissioning_planned_on: null })
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await openStage(page, 'Delivery')
    const section = page.getByRole('region', { name: 'Commissioning' })
    await expect(section).toContainText('no commissioning')
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
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
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
    // nothing can be stamped while it is cancelled
    await expect(page.getByRole('button', { name: /Mark placed/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
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
    await openStage(page, 'Order')
    await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible()
    // no money column in the lines table
    for (const header of ['Unit price', 'Total']) await expect(page.getByRole('columnheader', { name: new RegExp(header) })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: /Exempt|Service/ })).toHaveCount(0)
    await expect(page.getByLabel(/GST rate/)).toHaveCount(0)
    await openStage(page, 'Supplier order')
    await expect(leg(page, 'A')).toBeVisible()
    await openStage(page, 'Delivery')
    await expect(page.getByRole('region', { name: 'Commissioning' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const text = await page.locator('#main').innerText()
    expect(text).not.toMatch(/PKR|48,500|96,500|135,000|Margin|Terms|Exempt|Costs|Balance|Add line|Add supplier|Issue PO|Record payment|Add expense|Create invoice/i)
    await expect(page.locator('.sr-only', { hasText: 'Not set' })).toHaveCount(0)
    // the page leads with the engineer's job: the site, the contact, Delivered today and Installed today
    const onSite = page.getByRole('region', { name: 'On site' })
    await expect(page.locator('#main')).toContainText('Hub plant, kiln line 2')
    await expect(page.locator('#main')).toContainText('Mr. Tariq Hussain')
    await expect(onSite.getByRole('button', { name: 'Delivered today' })).toBeVisible()
    await expect(onSite.getByRole('button', { name: 'Installed today' })).toBeVisible()

    const forbidden = /unit_price_net|supplier_unit_price|gst_rate|order_receivables|\/invoices|payments_in|expenses|order_costs|v_order_money|v_order_items_total|invoicing_state|[,=(]gross|[,=(]net\b|invoiced/
    const leaks = urls.filter(u => forbidden.test(u.replace(/^https?:\/\/[^/]+/, '')))
    expect(leaks).toEqual([])
    // the order itself was read, so the assertion above is not vacuous
    expect(urls.some(u => u.includes('/order_items?') || u.includes('/orders?'))).toBe(true)
    await shot(page, 'o03-engineer-1440')
  })

  test('Add line and Add supplier', async ({ page }) => {
    const s = await seedOrder()
    const supplierC = await createCompany(uniqueName('Lahore Automation'))
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfqId, supplier_id: supplierC.id, sent_on: karachiDay(-2) }, prefer: 'return=minimal' }))
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const t = tapper()

    await openStage(page, 'Order')
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

    await openStage(page, 'Supplier order')
    await t.tap(page.getByRole('button', { name: 'Add supplier' }).first())
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Supplier').selectOption({ label: supplierC.name })
    await expect(dialog.getByLabel('Currency')).toHaveValue('PKR')
    await dialog.getByRole('button', { name: 'Add supplier' }).click()
    await expect.poll(async () => (await get(`supplier_orders?order_id=eq.${s.order.id}&select=supplier_id,currency`)).length).toBe(3)
    await expect(page.getByTestId('leg-C')).toContainText(supplierC.name)
  })

  test('an order that is not there says so', async ({ page }) => {
    await openAs(page, 'sales', `/orders/${crypto.randomUUID()}`)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to Today' })).toBeVisible()
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
    await openAs(page, 'sales', '/todo')
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
    await expect(page).toHaveURL(JOB_URL)
  })

  test('an engineer finds an order by its number only, never by the PO number (R12: no PO or invoice number for an engineer)', async ({ page }) => {
    const s = await seedOrder()
    await openAs(page, 'engineer', '/todo')
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
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}: the job page of an order for admin and engineer, the Mark won dialog`, async ({ page }) => {
    const s = await seedOrder()
    const r = await seedRfq()
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })

    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await openStage(page, 'Supplier order')
    await expect(leg(page, 'A')).toBeVisible()
    expect(await violations(page)).toEqual([])
    // nothing scrolls sideways, at 375 as at 1440
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await review(page, `o03-order-admin-${width}`)

    await page.getByRole('button', { name: 'More actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Cancel order' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await dialogViolations(page)).toEqual([])
    await page.keyboard.press('Escape')

    await signOutHard(page)
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await expect(page.getByRole('region', { name: 'On site' }).getByRole('button', { name: 'Installed today' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `o03-order-engineer-${width}`)

    await signOutHard(page)
    await openAs(page, 'sales', `/rfqs/${r.rfq.id}`)
    await (await markWonButton(page)).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Mark won' })).toBeVisible()
    expect(await dialogViolations(page)).toEqual([])
    await shot(page, `o01-convert-dialog-open-${width}`)
  })
}
