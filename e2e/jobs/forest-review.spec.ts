import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, type Role } from '../support/stack'

/*
 * The Forest cohesion review (polish lane after wave A): one picture of every wave-A screen at 1440 and at 375, written to REVIEW_DIR
 * (CI uploads it; nothing is written locally). Home for each role, the Sell and Deliver lanes, a job at the RFQ stage and at the order
 * stage (admin and engineer), the Money hub, Payments, To collect, the Companies list and a company page. Each picture is checked for
 * sideways scroll at 375 so a phone never runs off the edge. Synthetic data only; a long company name tests the truncation.
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

interface Fixture {
  company: { id: string; name: string }
  rfq: { id: string; number: number }
  ordered: { id: string; number: number }
}

async function seed(): Promise<Fixture> {
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase()
  const company = await createCompany(`Pakistan Petroleum Refinery and Industrial Gases ${tag} (Private) Limited`)
  const supplier = await createCompany(`Review Supplier ${tag}`)
  // an enquiry with no order, late (due yesterday): it shows in Sell and in Home's Late block
  const rfq = await createRfq(company.id, { customer_ref: `REV-${tag}-1`, due_on: karachiDay(-1) })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: `Ultrasonic flowmeter DN80 ${tag}`, qty: 2 }, prefer: 'return=minimal' }))
  // an enquiry that became an order with a supplier order, an engineer on it: Deliver, and the engineer's day
  const ordered = await createRfq(company.id, { customer_ref: `REV-${tag}-2`, due_on: karachiDay(3) })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: ordered.id, position: 0, description: `Pressure transmitter ${tag}`, qty: 4 }, prefer: 'return=minimal' }))
  const [order] = await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, rfq_id: ordered.id, customer_po_number: `PO-${tag}-77`, payment_terms_days: 30, ordered_on: karachiDay(-6) } }))
  const [leg] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'PKR', placed_on: karachiDay(-4), expected_on: karachiDay(2) } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: `Pressure transmitter ${tag}`, qty: 4, unit_price_net: 85000, gst_rate: 18, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { company, rfq, ordered }
}

/** Opens `path` at 1440 then at 375 (a fresh load at each width) and writes `<name>-1440.png` and `<name>-375.png`. */
async function both(page: Page, path: string, name: string): Promise<void> {
  const dir = process.env.REVIEW_DIR
  for (const [w, h] of [[1440, 900], [375, 812]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(path)
    await page.locator('#main').waitFor()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    if (w === 375) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflow, `${name}: no sideways scroll at 375`).toBeLessThanOrEqual(0)
    }
    if (dir) await page.screenshot({ path: `${dir}/polish-${name}-${w}.png`, fullPage: true })
  }
}

test.describe('Forest review pictures (wave A)', () => {
  let f: Fixture
  test.beforeAll(async () => { f = await seed() })

  for (const role of ['admin', 'sales', 'engineer'] as Role[]) {
    test(`Home for ${role}`, async ({ page }) => {
      await openAs(page, role, '/todo')
      await both(page, '/todo', `home-${role}`)
    })
  }

  test('Sell, Deliver, a job at each stage (admin)', async ({ page }) => {
    await openAs(page, 'admin', '/jobs?lane=sell')
    await both(page, '/jobs?lane=sell', 'sell')
    await both(page, '/jobs?lane=deliver', 'deliver')
    await both(page, `/jobs/${f.rfq.number}?from=sell`, 'job-rfq-admin')
    await both(page, `/jobs/${f.ordered.number}?from=deliver`, 'job-order-admin')
  })

  test('a job at each stage (engineer)', async ({ page }) => {
    await openAs(page, 'engineer', '/jobs')
    await both(page, '/jobs', 'jobs-engineer')
    await both(page, `/jobs/${f.rfq.number}`, 'job-rfq-engineer')
    await both(page, `/jobs/${f.ordered.number}`, 'job-order-engineer')
  })

  test('Money: home, Payments, To collect (admin)', async ({ page }) => {
    await openAs(page, 'admin', '/money')
    await both(page, '/money', 'money')
    await both(page, '/money/payments', 'payments')
    await both(page, '/money/receivables', 'to-collect')
  })

  test('Companies: the list and a company page (admin)', async ({ page }) => {
    await openAs(page, 'admin', '/companies')
    await both(page, '/companies', 'companies')
    await both(page, `/companies/${f.company.id}`, 'company')
  })
})
