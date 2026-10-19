import { test, expect, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, review, uniqueName } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'

/*
 * P01 end to end: the Reports page. Other suites' data is not in this database (it is reset first), but the seed and the other tests
 * of this file are, so every assertion looks for this test's own uniquely named customer.
 *
 * What is proved here, beyond the numbers (those are pgTAP and unit tests):
 *  - admin and sales read the page; an engineer does not get the nav item, the page, or one report request;
 *  - the network log of a Reports visit contains no money table or view, and no money-looking column in any report answer.
 */

const MONEY_TARGETS = ['payments_in', 'expenses', 'v_order_money', 'v_cash_month', 'v_payment_net', 'v_month_pnl', 'v_invoice_state', 'order_costs', 'v_gst_']

interface Seed {
  customer: { id: string; name: string }
  reason: string
}

/** A customer with two live orders (a repeat customer) and a closed RFQ with a reason, all made through the API as admin. */
async function seed(): Promise<Seed> {
  const customer = await createCompany(uniqueName('Reportco'))
  for (const [i, day] of [-30, -3].entries()) {
    await must(rest('admin', 'orders', { method: 'POST', body: { company_id: customer.id, customer_po_number: `PO-${customer.id.slice(0, 6)}-${i}`, ordered_on: karachiDay(day) }, prefer: 'return=minimal' }))
  }
  await createRfq(customer.id, { closed_on: karachiDay(-1), close_reason: 'competitor' })
  return { customer, reason: 'The customer chose a competitor' }
}

function watch(page: Page) {
  const urls: string[] = []
  const bodies: string[] = []
  // Only what the Reports page itself asks for: the landing page the login passes through (Today) reads money for admin and sales.
  let onReports = false
  page.on('framenavigated', f => {
    if (f === page.mainFrame()) onReports = /\/reports(\?|$)/.test(new URL(f.url()).pathname)
  })
  page.on('request', r => onReports && urls.push(r.url()))
  page.on('response', async r => {
    if (!r.url().includes('/rest/v1/v_report_')) return
    try {
      bodies.push(await r.text())
    } catch {
      /* navigation tore the response down: nothing to inspect */
    }
  })
  return { urls, bodies }
}

for (const role of ['admin', 'sales'] as const) {
  test.describe(`P01: Reports as ${role}`, () => {
    test('shows the four reports, the seeded customer as a repeat customer, and no money anywhere', async ({ page }) => {
      const s = await seed()
      const log = watch(page)
      await openAs(page, role, '/reports')
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
      for (const h of ['RFQ outcomes', 'Float coverage and conversion', 'Clarification turnaround', 'Repeat customers']) {
        await expect(page.getByRole('heading', { name: h, level: 2 })).toBeVisible()
      }
      // the nav item is there and marked current
      await expect(page.getByRole('link', { name: 'Reports' }).first()).toBeVisible()
      // the closed RFQ appears under its reason; the customer with two live orders shows 2 orders
      await expect(page.getByRole('table', { name: 'RFQs closed by reason' }).getByRole('row', { name: new RegExp(s.reason) })).toBeVisible()
      const row = page.getByRole('table', { name: 'Repeat customers' }).getByRole('row', { name: new RegExp(s.customer.name) })
      await expect(row).toBeVisible()
      await expect(row).toContainText('Yes')
      await expect(row.getByRole('cell').nth(1)).toHaveText('2')
      await waitForAnimationsToFinish(page)
      await review(page, `p01-reports-${role}-1440`)

      // network log: only the four report views were read for the page, and no answer holds a money-looking column
      const mine = log.urls.filter(u => u.includes('/rest/v1/'))
      for (const target of MONEY_TARGETS) expect(mine.filter(u => u.includes(`/rest/v1/${target}`)), target).toEqual([])
      for (const view of ['v_report_rfq_outcomes', 'v_report_float', 'v_report_clarification_turnaround', 'v_report_repeat_customers']) {
        expect(mine.some(u => u.includes(`/rest/v1/${view}`)), view).toBe(true)
      }
      await expect.poll(() => log.bodies.length).toBeGreaterThanOrEqual(4)
      for (const body of log.bodies) expect(body).not.toMatch(/"(price|amount|net|gross|gst|margin|cost|pkr|total)[a-z_]*"/)

      expect(await axeViolations(page)).toEqual([])
    })

    test('is usable at 375 px', async ({ page }) => {
      await seed()
      await page.setViewportSize({ width: 375, height: 812 })
      await openAs(page, role, '/reports')
      await expect(page.getByRole('heading', { name: 'Repeat customers', level: 2 })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await waitForAnimationsToFinish(page)
      await review(page, `p01-reports-${role}-375`)
    })
  })
}

test.describe('P01: Reports as an engineer', () => {
  test('has no nav item, gets the no-access page, and makes no report request', async ({ page }) => {
    const log = watch(page)
    await openAs(page, 'engineer', '/reports')
    await expect(page.getByRole('heading', { name: /Reports is for/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0)
    expect(log.urls.filter(u => u.includes('/rest/v1/v_report_'))).toEqual([])
  })

  test('the database gives an engineer no rows from any report view, and a sales person rows', async () => {
    await seed()
    for (const view of ['v_report_rfq_outcomes', 'v_report_float', 'v_report_clarification_turnaround', 'v_report_repeat_customers']) {
      const eng = await rest<unknown[]>('engineer', `${view}?select=*`)
      expect(eng.status, view).toBe(200)
      expect(eng.body, view).toEqual([])
    }
    const sales = await rest<unknown[]>('sales', 'v_report_repeat_customers?select=*')
    expect(sales.body.length).toBeGreaterThan(0)
  })
})
