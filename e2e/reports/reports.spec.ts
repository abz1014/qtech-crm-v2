import { test, expect, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, review, uniqueName } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'

/*
 * P01 end to end: the enquiry and customer reports, now part of Money > Reports (owner decision 2026-10-19: five main tabs, and
 * /reports opens Money's Reports view). Other suites' data is not in this database (it is reset first), but the seed and the other tests
 * of this file are, so every assertion looks for this test's own uniquely named customer.
 *
 * What is proved here, beyond the numbers (those are pgTAP and unit tests):
 *  - admin and sales read the page; an engineer does not get the nav item, the page, or one report request;
 *  - a sales visit asks for no money report, and no enquiry-report answer holds a money-looking column (the admin also sees the month's
 *    money reports on the same page, by design).
 */

// Not listed: expenses, v_order_money and v_invoice_state. The shell's Today badge (useNavCounts) reads them on every page for admin and sales
// (the Today money rules, M08), so they appear in any page's log; the Reports page itself asks for none of them.
// v_gst_register is not listed either: the Money frame reads it for the "Invoices & GST" tab count, a register sales already use.
const MONEY_TARGETS = ['payments_in', 'v_cash_month', 'v_payment_net', 'v_month_pnl', 'order_costs', 'v_gst_month']

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
  page.on('request', r => urls.push(r.url()))
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

const QUESTIONS = [
  'How many RFQs did we win, and why did we lose the others?',
  'Does asking suppliers for prices help us win?',
  'How fast do customers answer our questions?',
  'Which customers come back?',
]

/** Each report is one line until it is opened: open all four. */
async function openAll(page: Page) {
  for (const q of QUESTIONS) await page.getByText(q, { exact: true }).click()
}

for (const role of ['admin', 'sales'] as const) {
  test.describe(`P01: Reports as ${role}`, () => {
    test('/reports opens Money > Reports: three numbers first, each report one line, the seeded customer a repeat customer', async ({ page }) => {
      const s = await seed()
      const log = watch(page)
      await openAs(page, role, '/reports')
      // five main tabs: Reports is no longer one of them; the old address lands inside Money
      // round 3: Reports is the fifth Money tab and shows one report at a time (admin opens on Profit and loss)
      await expect(page).toHaveURL(role === 'admin' ? /\/money\/reports\/pnl$/ : /\/money\/reports\/enquiries$/)
      await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Reports' })).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page')
      if (role === 'admin') {
        await expect(page.getByRole('heading', { name: 'Profit and loss', level: 1 })).toBeVisible()
        await page.getByTestId('report-picker').selectOption('enquiries')
      }
      await expect(page.getByRole('heading', { name: 'Enquiries and customers', level: 1 })).toBeVisible()
      await expect(page.getByRole('region', { name: 'At a glance' })).toContainText('Win rate')
      for (const q of QUESTIONS) await expect(page.getByText(q, { exact: true })).toBeVisible()
      await openAll(page)
      // the closed RFQ appears under its reason; the customer with two live orders shows 2 orders
      await expect(page.getByRole('table', { name: 'RFQs lost, by reason' }).getByRole('row', { name: new RegExp(s.reason) })).toBeVisible()
      const row = page.getByRole('table', { name: 'Customers who came back' }).getByRole('row', { name: new RegExp(s.customer.name) })
      await expect(row).toBeVisible()
      await expect(row).toContainText('Yes')
      await expect(row.getByRole('cell').nth(1)).toHaveText('2')
      if (role === 'sales') await expect(page.getByTestId('report-picker')).toHaveCount(0)
      await waitForAnimationsToFinish(page)
      await review(page, `p01-reports-${role}-1440`)

      // network log: the four report views were read, and no report answer holds a money-looking column
      const mine = log.urls.filter(u => u.includes('/rest/v1/'))
      for (const view of ['v_report_rfq_outcomes', 'v_report_float', 'v_report_clarification_turnaround', 'v_report_repeat_customers']) {
        expect(mine.some(u => u.includes(`/rest/v1/${view}`)), view).toBe(true)
      }
      // sales: no money report is requested (the admin's month reports are the admin's)
      if (role === 'sales') for (const target of MONEY_TARGETS) expect(mine.filter(u => u.includes(`/rest/v1/${target}`)), target).toEqual([])
      await expect.poll(() => log.bodies.length).toBeGreaterThanOrEqual(4)
      for (const body of log.bodies) expect(body).not.toMatch(/"(price|amount|net|gross|gst|margin|cost|pkr|total)[a-z_]*"/)

      expect(await axeViolations(page)).toEqual([])
    })

    test('is usable at 375 px', async ({ page }) => {
      await seed()
      await page.setViewportSize({ width: 375, height: 812 })
      await openAs(page, role, '/money/reports/enquiries')
      await openAll(page)
      await expect(page.getByRole('table', { name: 'Customers who came back' })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await waitForAnimationsToFinish(page)
      await review(page, `p01-reports-${role}-375`)
      expect(await axeViolations(page)).toEqual([])
    })
  })
}

test.describe('P01: Reports as an engineer', () => {
  test('has no nav item, gets the no-access page, and makes no report request', async ({ page }) => {
    const log = watch(page)
    await openAs(page, 'engineer', '/reports')
    await expect(page.getByRole('heading', { name: /Money is for/ }).first()).toBeVisible()
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
