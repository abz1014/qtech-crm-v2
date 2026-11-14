import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'
import { markWonButton, openFold, openStage } from '../support/job'

/*
 * The Forest cohesion review after wave B (polish-b): one picture of every selling and delivering screen at 1440 and at 375, written
 * to REVIEW_DIR as `pb-<name>-<width>.png` (CI uploads it; nothing is written locally). New RFQ (empty and filled), /capture, a job at
 * the RFQ stage with suppliers asked (one asked about some items only), the reply dialog, items and prices, Issue quotation,
 * questions and files, the comparative statement, Mark won, the Order and Supplier order stops, Issue PO, the Delivery stop with
 * visits and challans, and the engineer's job page. Each picture is checked for sideways scroll, so a phone never runs off the edge.
 * Synthetic data only; long company names test the wrapping.
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const WIDTHS = [
  [1440, 900],
  [375, 812],
] as const

/** No sideways scroll; then the whole page (the shell scrolls inside #main, so the window grows to the content), then back. */
async function pic(page: Page, name: string, opts: { grow?: boolean } = {}): Promise<void> {
  const size = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.waitForTimeout(450)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${size.width}: no sideways scroll`).toBeLessThanOrEqual(0)
  const main = await page.evaluate(() => {
    const m = document.querySelector('#main') as HTMLElement | null
    return m ? m.scrollWidth - m.clientWidth : 0
  })
  expect.soft(main, `${name} at ${size.width}: #main does not scroll sideways`).toBeLessThanOrEqual(1)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  if (opts.grow !== false) {
    const tall = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll('#main, #main *'))
          .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
          .map(e => e.scrollHeight + e.getBoundingClientRect().top),
        window.innerHeight,
      ),
    )
    if (tall > size.height) {
      await page.setViewportSize({ width: size.width, height: Math.min(Math.ceil(tall) + 120, 8000) })
      await page.waitForTimeout(300)
    }
  }
  await page.screenshot({ path: `${dir}/pb-${name}-${size.width}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
  await page.setViewportSize(size)
}

/** A dialog or sheet: once it has finished rising, the window as it is (the dialog scrolls inside itself). */
async function dialogPic(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('dialog').first()).toBeVisible()
  await page.waitForTimeout(600)
  await pic(page, name, { grow: false })
}

async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

/** An RFQ with three items and four suppliers asked: one priced in PKR, one in USD, one who cannot quote, one asked about item 1 only. */
async function seedRfqStage() {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
  const customer = await createCompany(uniqueName(`Pakistan Petroleum Refinery and Industrial Gases ${tag} (Private) Limited`))
  await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: customer.id, name: 'Tariq Mehmood', title: 'Procurement Manager' } }))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(4), customer_ref: `ENQ-${tag}` })
  const items: string[] = []
  for (const [i, description] of [`Endress+Hauser Promag 400 flowmeter DN80 ${tag}`, `Cerabar PMC71 pressure transmitter 0-10 bar ${tag}`, `Vibrating fork level switch ${tag}`].entries()) {
    const [row] = await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: i + 1 } }))
    items.push(row.id)
  }
  const ask = async (name: string, body: Record<string, unknown> = {}) => {
    const co = await createCompany(uniqueName(name))
    const [inq] = await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: co.id, sent_on: karachiDay(-3), ...body } }))
    return { co, inq }
  }
  const line = (inquiryId: string, itemId: string, body: Record<string, unknown>) =>
    must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiryId, rfq_item_id: itemId, ...body }, prefer: 'return=minimal' }))
  const indus = await ask('Indus Instruments Trading')
  await line(indus.inq.id, items[0], { unit_price: 412000, currency: 'PKR', lead_time: '14 days', in_stock: true })
  await line(indus.inq.id, items[1], { unit_price: 96500, currency: 'PKR', lead_time: '14 days', in_stock: true })
  const zhob = await ask('Zhob Control Parts Private Limited, Quetta Industrial Estate')
  await line(zhob.inq.id, items[0], { unit_price: 1390, currency: 'USD', lead_time: '6 weeks', in_stock: false })
  await ask('Swat Sensor Supply', { no_offer_on: karachiDay(-1), no_offer_reason: 'no_brand' })
  const hunza = await ask('Hunza Valve and Pump', { asked_item_ids: [items[0]] })
  return { customer, rfq, indus, hunza }
}

/** An order with two supplier orders (one not placed, in USD; one on its way), an engineer, visits and a challan. */
async function seedOrder() {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
  const company = await createCompany(uniqueName(`Sutlej Board and Packaging Mills ${tag} (Private) Limited`))
  const usd = await createCompany(uniqueName(`Makran Marine Instruments and Controls Trading ${tag}`))
  const pkr = await createCompany(uniqueName(`Indus Instruments ${tag}`))
  const rfq = await createRfq(company.id, { customer_ref: `PB-${tag}`, due_on: karachiDay(3) })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: `Radar level transmitter ${tag}`, qty: 3 }, prefer: 'return=minimal' }))
  const [order] = await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, rfq_id: rfq.id, customer_po_number: `CPO-${tag}`, payment_terms_days: 30, ordered_on: karachiDay(-6), needs_commissioning: true, commissioning_planned_on: karachiDay(3) } }))
  const [legA] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: usd.id, currency: 'USD' } }))
  const [legB] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: pkr.id, currency: 'PKR', placed_on: karachiDay(-4), expected_on: karachiDay(5) } }))
  const lines = [
    { description: `Siemens SITRANS LR250 radar level transmitter ${tag}`, qty: 3, unit: 'nos', unit_price_net: 690000, supplier_unit_price: 2080, supplier_order_id: legA.id },
    { description: `Cerabar PMC71 pressure transmitter ${tag}`, qty: 2, unit: 'nos', unit_price_net: 96000, supplier_unit_price: 81000, supplier_order_id: legB.id },
    { description: `Commissioning and calibration at site ${tag}`, qty: 1, unit_price_net: 110000, is_service: true },
  ]
  for (const [i, l] of lines.entries()) {
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: i, gst_rate: 18, ...l }, prefer: 'return=minimal' }))
  }
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  await must(
    rest('admin', 'order_visits', {
      method: 'POST',
      body: [
        { order_id: order.id, visit_type: 'survey', visit_on: karachiDay(-4), engineer_id: ENGINEER, notes: 'Gate pass arranged. Panel space checked with the plant manager.', done_on: karachiDay(-4) },
        { order_id: order.id, visit_type: 'installation', visit_on: karachiDay(3), engineer_id: ENGINEER, notes: null, done_on: null },
        { order_id: order.id, visit_type: 'service', visit_on: karachiDay(12), engineer_id: ADMIN, notes: null, done_on: null },
      ],
      prefer: 'return=minimal',
    }),
  )
  await must(rest('admin', 'rpc/create_delivery_challan', { method: 'POST', body: { p_order_id: order.id } }))
  return { rfq }
}

test.describe('Forest review pictures (wave B)', () => {
  test.setTimeout(300_000)
  let r: Awaited<ReturnType<typeof seedRfqStage>>
  let o: Awaited<ReturnType<typeof seedOrder>>
  test.beforeAll(async () => {
    r = await seedRfqStage()
    o = await seedOrder()
  })
  test.beforeEach(async ({ page }) => {
    // the stop asked for is the one open: the e2e helper that opens the current step stands down
    await page.addInitScript(() => {
      ;(window as unknown as { __keepStepsClosed?: boolean }).__keepStepsClosed = true
    })
  })

  test('New RFQ, empty and filled (sales)', async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
    const customer = await createCompany(uniqueName(`Pak-Meridian Integrated Process Automation ${tag} (Private) Limited`), { city: 'Sheikhupura' })
    await openAs(page, 'sales', '/enquiries/new')
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/enquiries/new')
      await expect(page.getByTestId('enquiry-dropzone')).toBeVisible()
      await pic(page, 'new-rfq-empty')
      // the other address of New RFQ (Sell's button, a company page's "New RFQ")
      await page.goto('/rfqs/new')
      await page.locator('#main').waitFor()
      await page.waitForLoadState('networkidle')
      await pic(page, 'rfqs-new-empty')
    }
    await page.goto('/enquiries/new')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('combobox', { name: 'Company' }).fill(customer.name.slice(0, 24))
    await page.getByRole('option', { name: new RegExp(tag) }).click()
    await paste(page, ['Dear Sir, please quote:', '1) Endress+Hauser Proline Promag 400 flowmeter DN80 - 2 nos', '2) Siemens SITRANS TH320 temperature transmitter x 10', 'Regards'].join('\n'))
    await expect(page.getByText('2 items found').first()).toBeVisible()
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await pic(page, 'new-rfq-filled')
    }
  })

  test('/capture and Add to this job (engineer)', async ({ page }) => {
    await openAs(page, 'engineer', '/capture')
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/capture')
      await expect(page.getByTestId('photo-or-note')).toBeVisible()
      await page.waitForLoadState('networkidle')
      await pic(page, 'capture')
    }
  })

  for (const role of ['sales', 'engineer'] as Role[]) {
    test(`a job at the RFQ stage, suppliers asked, items and prices (${role})`, async ({ page }) => {
      await openAs(page, role, `/rfqs/${r.rfq.id}`)
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h })
        await page.goto(`/rfqs/${r.rfq.id}`)
        await page.locator('[data-stages]').waitFor()
        await openStage(page, 'Quotation')
        await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText(r.hunza.co.name)
        await page.waitForLoadState('networkidle')
        await pic(page, `rfq-stage-${role}`)
        await openStage(page, 'RFQ')
        await pic(page, `rfq-step-${role}`)
      }
    })
  }

  test('reply dialog, Issue quotation, questions and files, comparative statement (sales)', async ({ page }) => {
    await openAs(page, 'sales', `/rfqs/${r.rfq.id}`)
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`/rfqs/${r.rfq.id}`)
      await page.locator('[data-stages]').waitFor()
      await openStage(page, 'Quotation')
      const asked = page.locator('[data-slot="suppliers-asked"]')
      await expect(asked).toContainText(r.hunza.co.name)
      await asked.getByRole('button', { name: `Enter reply, ${r.hunza.co.name}` }).click()
      await dialogPic(page, 'reply-dialog')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await openFold(page, 'Questions for the customer')
      await openFold(page, 'Files')
      await pic(page, 'questions-files')
      await page.getByRole('button', { name: 'Send quotation', exact: true }).first().click()
      await dialogPic(page, 'issue-quotation')
      await page.keyboard.press('Escape')
      await page.goto(`/rfqs/${r.rfq.id}`)
      await page.locator('[data-stages]').waitFor()
      await openStage(page, 'Quotation')
      await page.getByRole('link', { name: /comparative statement/i }).first().click()
      await page.locator('#main').waitFor()
      await page.waitForLoadState('networkidle')
      await pic(page, 'statement')
    }
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await pic(page, 'statement')
  })

  test('Mark won, the Order and Supplier order stops, Issue PO, the Delivery stop (admin)', async ({ page }) => {
    await openAs(page, 'admin', `/rfqs/${r.rfq.id}`)
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`/rfqs/${r.rfq.id}`)
      await page.locator('[data-stages]').waitFor()
      await (await markWonButton(page)).first().click()
      await dialogPic(page, 'mark-won')
      await page.keyboard.press('Escape')

      for (const [stage, name] of [['order', 'order'], ['supplier-order', 'supplier-order'], ['delivery', 'delivery']] as const) {
        await page.goto(`/jobs/${o.rfq.number}?stage=${stage}`)
        await page.locator('[data-stages]').waitFor()
        await page.waitForLoadState('networkidle')
        await pic(page, `${name}-admin`)
      }
      await page.goto(`/jobs/${o.rfq.number}?stage=supplier-order`)
      await page.locator('[data-supplier-order-work]').waitFor()
      await page.getByRole('button', { name: 'Issue PO' }).first().click()
      await dialogPic(page, 'issue-po')
      await page.keyboard.press('Escape')
      await page.goto('/orders?new=1')
      await dialogPic(page, 'new-order')
      await page.keyboard.press('Escape')
    }
  })

  test("the engineer's job page at the order (engineer)", async ({ page }) => {
    await openAs(page, 'engineer', `/jobs/${o.rfq.number}`)
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`/jobs/${o.rfq.number}`)
      await page.getByRole('region', { name: 'Visits', exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      await pic(page, 'job-engineer')
    }
  })
})
