import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { openStage } from '../support/job'
import { createCompany, karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'

/*
 * The Forest cohesion review after round 3 (polish-c): one picture of every money screen at 1440 and at 375, written to REVIEW_DIR as
 * `pc-<name>-<width>.png` (CI uploads it; nothing is written locally). Money home, To collect, Payments, the GST register and its
 * dialogs, the company page's credit card with the statement, refund and apply dialogs, Margins, Profitability, Lock a month and its
 * dialog, Bank check, Mistakes to fix, Review imported, GST to FBR, every report, Expenses with the Add expenses sheet, I paid (engineer),
 * the no-access page for sales, the job page's money stops, and Home and Companies for comparison. Each picture is checked for sideways
 * scroll (soft), so a phone never runs off the edge. The month is never locked (other specs share the database). Synthetic data only;
 * long company names test the wrapping. Named zz- so it runs after the money-costs specs that count rows.
 */
const WIDTHS = [
  [1440, 900],
  [375, 812],
] as const
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const FUEL = 'ca7e0000-0000-4000-8000-000000000004'
const UTILITIES = 'ca7e0000-0000-4000-8000-000000000003'
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase()

/** A day in the month before this one (the month Lock a month and the reports open on). */
function lastMonth(day: number): string {
  const [y, m] = today().split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, day)).toISOString().slice(0, 10)
}

async function post<T = { id: string }>(role: Role, table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>(role, table, { method: 'POST', body })))[0]
}

async function pic(page: Page, name: string, opts: { grow?: boolean } = {}): Promise<void> {
  const size = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.waitForTimeout(500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${size.width}: no sideways scroll`).toBeLessThanOrEqual(0)
  const main = await page.evaluate(() => {
    const m = document.querySelector('#main') as HTMLElement | null
    return m ? m.scrollWidth - m.clientWidth : 0
  })
  expect.soft(main, `${name} at ${size.width}: #main does not scroll sideways`).toBeLessThanOrEqual(1)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
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
  await page.screenshot({ path: `${dir}/pc-${name}-${size.width}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
  await page.setViewportSize(size)
}

/** Opens the address and waits until nothing is loading (no busy region, no skeleton), then the picture. */
async function screen(page: Page, name: string, path: string): Promise<void> {
  await page.goto(path)
  await page.locator('#main').waitFor()
  await page.waitForLoadState('networkidle')
  // a picture is wanted even if something keeps a busy mark: wait, but never fail on it
  await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined)
  await pic(page, name)
}

async function eachWidth(page: Page, run: () => Promise<void>): Promise<void> {
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await run()
  }
}

/** An invoiced order for `companyId`: one line at `net` (GST 18 %), invoiced on `on`. */
async function invoicedOrder(companyId: string, net: number, on: string, over: Record<string, unknown> = {}) {
  const order = await post<{ id: string; number: number }>('admin', 'orders', { company_id: companyId, payment_terms_days: 30, customer_po_number: `PO-${unique()}` })
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: { order_id: order.id, position: 0, description: 'Endress+Hauser Promag 400 flowmeter DN80', qty: 2, unit_price_net: net / 2, gst_rate: 18 },
      prefer: 'return=minimal',
    }),
  )
  const invoice = await post<{ id: string; number: string }>('admin', 'invoices', {
    order_id: order.id,
    number: `PC-${unique()}`,
    invoice_date: on,
    net_amount: net,
    gst_amount: Math.round(net * 0.18),
    ...over,
  })
  return { order, invoice }
}

test.describe.configure({ mode: 'serial' })

test.describe('Forest review pictures (round 3, money)', () => {
  test.setTimeout(600_000)
  let jobOrder = ''
  let companyId = ''

  test.beforeAll(async () => {
    const long = await createCompany(uniqueName('Pakistan Petroleum Refinery and Industrial Gases (Private) Limited, Karachi Works'), {
      invoice_address: 'Plot 14, Sector 23, Korangi Industrial Area, Karachi',
    })
    companyId = long.id
    const kestrel = await createCompany(uniqueName('Kestrel Power'))
    const chenab = await createCompany(uniqueName('Chenab Chemicals'))
    const supplier = await createCompany(uniqueName('Karakoram Flow Systems'))

    // last month: invoiced, part paid, an expense against the order (Margins, Profitability, the reports, Lock a month)
    const a = await invoicedOrder(long.id, 1_725_000, lastMonth(6))
    await post('admin', 'payments_in', { order_id: a.order.id, amount: 900_000, received_on: lastMonth(12) })
    await post('admin', 'supplier_orders', { order_id: a.order.id, supplier_id: supplier.id, currency: 'PKR', placed_on: lastMonth(3) })
    await post('admin', 'expenses', { order_id: a.order.id, amount_pkr: 1_100_000, category_id: SUPPLIER_PAYMENT, paid_on: lastMonth(9), paid_via: 'bank', description: 'Supplier payment' })
    jobOrder = a.order.id
    // older and overdue (Overdue by age), filed (GST to FBR)
    const b = await invoicedOrder(kestrel.id, 640_000, lastMonth(2), { psid: `2026${Date.now() % 100000000}`, tax_deposited_on: lastMonth(20), tax_deposit_amount: 115_200 })
    await post('admin', 'payments_in', { order_id: b.order.id, amount: 755_200, received_on: lastMonth(25) })
    await invoicedOrder(chenab.id, 410_000, lastMonth(15), { psid: `2027${Date.now() % 100000000}` })
    // this month: one plain, one void, one with a credit note; a customer with credit
    await invoicedOrder(kestrel.id, 280_000, today())
    const v = await invoicedOrder(chenab.id, 550_000, today())
    await must(rest('admin', 'rpc/void_invoice', { method: 'POST', body: { p_invoice_id: v.invoice.id, p_reason: 'Typed twice' } }))
    const c = await invoicedOrder(long.id, 100_000, today())
    await must(
      rest('admin', 'rpc/record_payment', {
        method: 'POST',
        body: { p_id: crypto.randomUUID(), p_order_id: c.order.id, p_received_on: today(), p_amount: 150_000, p_reference: 'TT-48217', p_paid_via: 'bank' },
      }),
    )

    for (const [day, amount, cat, via, description] of [
      [4, 12_400, FUEL, 'cash', 'Diesel for the site van, Sheikhupura and back, with toll at the motorway plaza'],
      [8, 24_000, UTILITIES, 'bank', 'Electricity, office'],
      [18, 9_500, UTILITIES, 'bank', 'Internet'],
    ] as const) {
      await post('admin', 'expenses', { category_id: cat, paid_on: lastMonth(day), amount_pkr: amount, paid_via: via, description })
    }
    await post('admin', 'expenses', { category_id: FUEL, paid_on: today(), amount_pkr: 1_850, paid_via: 'cash', description: 'Courier to Multan' })
    await must(rest('admin', 'recurring_expenses', { method: 'POST', body: { label: uniqueName('Office rent'), category_id: UTILITIES, amount: 85_000, day_of_month: 1 } }))
    await post('engineer', 'expense_claims', { amount_pkr: 8_400, note: 'Fuel for the site visit to Pak-Meridian Integrated Process Automation, Sheikhupura' })
  })

  test('money home, to collect, payments, invoices and their dialogs', async ({ page }) => {
    await openAs(page, 'admin', '/money')
    await eachWidth(page, async () => {
      await screen(page, 'home', '/money')
      await screen(page, 'collect', '/money/receivables')
      await screen(page, 'payments', '/money/payments')
      await screen(page, 'register', '/money/gst-register')
      await page.goto('/money/gst-register?new=1')
      await expect(page.getByRole('dialog', { name: 'Create invoice' })).toBeVisible()
      await pic(page, 'create-invoice', { grow: false })
    })
  })

  test('the company credit card, statement, refund and apply', async ({ page }) => {
    await openAs(page, 'admin', `/companies/${companyId}`)
    await eachWidth(page, async () => {
      await screen(page, 'company-credit', `/companies/${companyId}`)
      await page.getByRole('button', { name: 'Statement of account' }).click()
      const dialog = page.getByRole('dialog', { name: 'Statement of account' })
      await expect(dialog.getByTestId('statement-closing')).toBeVisible()
      await pic(page, 'statement', { grow: false })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      for (const [button, name, file] of [
        ['Refund', 'Refund customer', 'refund'],
        ['Apply to an order', 'Apply credit to an order', 'apply'],
      ] as const) {
        const b = page.getByRole('region', { name: 'Credit balance' }).getByRole('button', { name: button, exact: true })
        if ((await b.count()) === 0) continue
        await b.click()
        const d = page.getByRole('dialog', { name })
        await expect(d).toBeVisible()
        await pic(page, file, { grow: false })
        await page.keyboard.press('Escape')
        await expect(d).toHaveCount(0)
      }
    })
  })

  test('margins, profitability, lock a month, checks', async ({ page }) => {
    await openAs(page, 'admin', '/money/margins')
    await eachWidth(page, async () => {
      await screen(page, 'margins', '/money/margins')
      await screen(page, 'profit', '/money/profit')
      await screen(page, 'lock', '/money/month-end')
      const lock = page.getByRole('button', { name: /^Lock [A-Z][a-z]+$/ }).first()
      if (await lock.isVisible()) {
        await lock.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await pic(page, 'lock-dialog', { grow: false })
        await page.keyboard.press('Escape')
      }
      await screen(page, 'bank', '/money/month-end/bank')
      await screen(page, 'mistakes', '/money/exceptions')
      await screen(page, 'review-imported', '/money/review-imported')
      await screen(page, 'gst-fbr-page', '/money/accounts/gst')
    })
  })

  test('every report', async ({ page }) => {
    await openAs(page, 'admin', '/money/reports')
    await eachWidth(page, async () => {
      for (const key of ['pnl', 'in-out', 'expenses', 'aging', 'owe', 'gst', 'team', 'enquiries']) await screen(page, `report-${key}`, `/money/reports/${key}`)
    })
  })

  test('expenses, the sheet, the dialog, claims and recurring', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses')
    await eachWidth(page, async () => {
      await screen(page, 'expenses', '/money/expenses')
      await page.goto('/money/expenses?burst=1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await pic(page, 'add-expenses', { grow: false })
      await page.goto('/money/expenses?add=1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await pic(page, 'add-expense', { grow: false })
    })
  })

  test('the job page money stops', async ({ page }) => {
    await openAs(page, 'admin', `/orders/${jobOrder}`)
    await eachWidth(page, async () => {
      await page.goto(`/orders/${jobOrder}`)
      await openStage(page, 'Invoice')
      await page.waitForLoadState('networkidle')
      await pic(page, 'job-invoice')
      await openStage(page, 'Payment')
      await pic(page, 'job-payment')
    })
  })

  test('home and companies, for comparison', async ({ page }) => {
    await openAs(page, 'admin', '/todo')
    await eachWidth(page, async () => {
      await screen(page, 'r1-home', '/todo')
      await screen(page, 'r1-companies', '/companies')
      await screen(page, 'r1-sell', '/jobs?lane=sell')
    })
  })

  for (const role of ['engineer', 'sales'] as const) {
    test(`${role}: I paid, and no access`, async ({ page }) => {
      await openAs(page, role, '/my-expenses')
      await eachWidth(page, async () => {
        await screen(page, `ipaid-${role}`, '/my-expenses')
        if (role === 'sales') await screen(page, 'no-access', '/money/payments')
      })
    })
  }
})
