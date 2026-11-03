import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { JOB_URL } from '../support/job'

/*
 * The Job page header's key facts (Customer PO, Supplier, Delivery): shown for a job that has an order, at desktop and phone width.
 * The Customer PO is for admin and sales only; an engineer's page must not hold it anywhere in its text. Synthetic data only.
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase()

async function seed() {
  const po = `HDR-PO-${unique()}`
  const customer = await createCompany(uniqueName('Header Customer'))
  const supplierName = uniqueName('Header Supplier')
  const supplier = await createCompany(supplierName)
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id, customer_po_number: po, payment_terms_days: 30, ordered_on: karachiDay(-3) } }))
  const [leg] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'PKR', placed_on: karachiDay(-1), expected_on: karachiDay(10) } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: 100000, gst_rate: 18, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { id: order.id, po, supplierName }
}

test.describe('Job page header key facts', () => {
  for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 375, height: 812 }]] as const) {
    test(`admin sees PO, supplier and delivery on ${label}`, async ({ page }) => {
      const o = await seed()
      await page.setViewportSize(size)
      await openAs(page, 'admin', `/orders/${o.id}`)
      await expect(page).toHaveURL(JOB_URL)
      const facts = page.getByLabel('Key facts')
      await expect(facts).toBeVisible()
      await expect(facts.getByText('Customer PO')).toBeVisible()
      await expect(facts.getByText(o.po)).toBeVisible()
      await expect(facts.getByText('Supplier', { exact: true })).toBeVisible()
      await expect(facts.getByText(o.supplierName)).toBeVisible()
      await expect(facts.getByText('Delivery', { exact: true })).toBeVisible()
      await expect(facts.getByText(/^Ordered, expected /)).toBeVisible()
    })
  }

  test('an engineer sees supplier and delivery, never the Customer PO', async ({ page }) => {
    const o = await seed()
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'engineer', `/orders/${o.id}`)
    await expect(page).toHaveURL(JOB_URL)
    const facts = page.getByLabel('Key facts')
    await expect(facts).toBeVisible()
    await expect(facts.getByText('Supplier', { exact: true })).toBeVisible()
    await expect(facts.getByText('Delivery', { exact: true })).toBeVisible()
    await expect(facts.getByText('Customer PO')).toHaveCount(0)
    expect(await page.content()).not.toContain(o.po)
  })
})
