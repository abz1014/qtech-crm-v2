import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest } from '../support/stack'

/*
 * Forest lane B4 pictures: the Order stop and the Supplier order stop of the job page (mockups 41 and 42), as admin and as an engineer,
 * written to REVIEW_DIR (CI uploads it; nothing is written locally) at the project's width (w1440, w375). Each picture is checked for
 * sideways scroll, so a phone never runs off the edge. Synthetic data only; a long company and supplier name test the wrapping.
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

async function seed(): Promise<number> {
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase()
  const company = await createCompany(`Sutlej Board and Packaging Mills ${tag} (Private) Limited`)
  const usd = await createCompany(`Makran Marine Instruments and Controls Trading ${tag}`)
  const pkr = await createCompany(`Indus Instruments ${tag}`)
  const rfq = await createRfq(company.id, { customer_ref: `B4-${tag}`, due_on: karachiDay(3) })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: `Radar level transmitter ${tag}`, qty: 3 }, prefer: 'return=minimal' }))
  const [order] = await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, rfq_id: rfq.id, customer_po_number: `CPO-${tag}`, payment_terms_days: 30, ordered_on: karachiDay(-6) } }))
  // one supplier not ordered from yet (USD), one placed and on its way (PKR)
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
  return rfq.number
}

/** The whole page (the shell scrolls inside #main: the window grows to the content), no sideways scroll, one picture. */
async function picture(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name}: no sideways scroll`).toBeLessThanOrEqual(0)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  const h = page.viewportSize()?.height ?? 900
  const tall = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('#main, #main *')).filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e => e.scrollHeight + e.getBoundingClientRect().top), window.innerHeight))
  if (tall > h) {
    await page.setViewportSize({ width, height: Math.min(Math.ceil(tall) + 120, 8000) })
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${dir}/forest-b4-${name}-${width}.png`, fullPage: true })
  await page.setViewportSize({ width, height: h })
}

test.describe('Forest B4 pictures: Order and Supplier order stops', () => {
  let job: number
  test.beforeAll(async () => {
    job = await seed()
  })

  test('admin: the Order stop, its edit mode, and the Supplier order stop', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 1440
    await openAs(page, 'admin', `/jobs/${job}?stage=order`)
    await expect(page.locator('[data-order-work]')).toBeVisible()
    await picture(page, 'order-admin', width)
    await page.getByRole('button', { name: 'Edit GST and lines' }).click()
    await picture(page, 'order-edit-admin', width)
    await page.goto(`/jobs/${job}?stage=supplier-order`)
    await expect(page.locator('[data-supplier-order-work]')).toBeVisible()
    await picture(page, 'supplier-order-admin', width)
  })

  test('engineer: the Order and Supplier order stops, no prices', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 1440
    await openAs(page, 'engineer', `/jobs/${job}?stage=order`)
    await expect(page.locator('[data-order-work]')).toBeVisible()
    await picture(page, 'order-engineer', width)
    await page.goto(`/jobs/${job}?stage=supplier-order`)
    await expect(page.locator('[data-supplier-order-work]')).toBeVisible()
    await expect(page.locator('[data-supplier-order-work]')).not.toContainText(/PKR|USD|PO-/)
    await picture(page, 'supplier-order-engineer', width)
  })
})
