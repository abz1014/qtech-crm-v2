import { expect, test, type Page } from '@playwright/test'
import { openStage } from '../support/job'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Forest lane C2 (55-credit-statement, 56-margins-profit): one picture of each screen at 1440, 768 and 375, written to REVIEW_DIR as
 * `c2-<name>-<width>.png` (CI uploads it; nothing is written locally): the company page with the Credit balance card, the Statement of
 * account dialog, the Refund and Apply credit dialogs, the job page's Costs and margin card, Order margins (Invoiced and Cash) and
 * Profitability. Each width is checked for sideways scroll. A long company name tests the wrapping. Synthetic data only.
 */
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const WIDTHS = [1440, 768, 375] as const
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

/** An invoiced order: one line at `net` (GST 18 %). */
async function invoicedOrder(companyId: string, net: number): Promise<{ id: string; number: number }> {
  const order = await post<{ id: string; number: number }>('orders', { company_id: companyId, payment_terms_days: 30 })
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Promag 400 flowmeter DN80', qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }))
  await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, number: `C2-${unique()}`.toUpperCase(), invoice_date: today(), net_amount: net, gst_amount: Math.round(net * 0.18) }, prefer: 'return=minimal' }))
  return order
}

/** No sideways scroll at this width; then the whole page (the shell scrolls inside #main, so the window grows to the content). */
async function pic(page: Page, name: string, opts: { grow?: boolean } = {}): Promise<void> {
  const size = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.waitForTimeout(450)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${size.width}: no sideways scroll`).toBeLessThanOrEqual(0)
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
  await page.screenshot({ path: `${dir}/c2-${name}-${size.width}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
  await page.setViewportSize(size)
}

async function eachWidth(page: Page, run: (width: number) => Promise<void>): Promise<void> {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 })
    await run(w)
  }
}

test.describe('Forest C2 screens', () => {
  test('credit balance card, statement, refund and apply dialogs on the company page', async ({ page }) => {
    const company = await createCompany(uniqueName('Chenab Chemicals and Allied Industries (Private) Limited'), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
    const a = await invoicedOrder(company.id, 100000) // gross 118,000
    await invoicedOrder(company.id, 20000) // gross 23,600, still owed: a target for Apply
    await must(rest('admin', 'rpc/record_payment', { method: 'POST', body: { p_id: crypto.randomUUID(), p_order_id: a.id, p_received_on: today(), p_amount: 150000, p_reference: null, p_paid_via: 'bank' } }))
    await must(rest('admin', 'rpc/record_refund', { method: 'POST', body: { p_id: crypto.randomUUID(), p_company_id: company.id, p_order_id: null, p_refunded_on: today(), p_amount: 4000, p_paid_via: 'bank', p_reference: 'TT-48217', p_reason: 'Cancelled line', p_confirm_duplicate: false } })).catch(() => undefined)

    await openAs(page, 'admin', `/companies/${company.id}`)
    const panel = page.getByRole('region', { name: 'Credit balance' })
    await expect(panel.getByTestId('credit-balance')).toBeVisible()
    await eachWidth(page, async () => {
      await panel.scrollIntoViewIfNeeded()
      await pic(page, 'company-credit')
    })

    await eachWidth(page, async () => {
      await page.getByRole('button', { name: 'Statement of account' }).click()
      const dialog = page.getByRole('dialog', { name: 'Statement of account' })
      await expect(dialog.getByTestId('statement-closing')).toBeVisible()
      await expect(dialog).not.toContainText(/\bRs\b/)
      await pic(page, 'statement', { grow: false })
      await dialog.getByRole('button', { name: 'Close' }).last().click()
      await expect(dialog).toHaveCount(0)
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    for (const [button, name, file] of [
      ['Refund', 'Refund customer', 'refund'],
      ['Apply to an order', 'Apply credit to an order', 'apply'],
    ] as const) {
      for (const w of [1440, 375]) {
        await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 })
        await panel.getByRole('button', { name: button, exact: true }).click()
        const dialog = page.getByRole('dialog', { name })
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
        await pic(page, file, { grow: false })
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toHaveCount(0)
      }
    }
  })

  test('costs and margin card, order margins and profitability', async ({ page }) => {
    const customer = await createCompany(uniqueName('Sutlej Board and Packaging Mills (Private) Limited'))
    const supplier = await createCompany(uniqueName('Karakoram Flow Systems'))
    const order = await post<{ id: string; number: number }>('orders', { company_id: customer.id })
    await post('supplier_orders', { order_id: order.id, supplier_id: supplier.id, currency: 'PKR' })
    await post('order_items', { order_id: order.id, position: 0, description: 'Siemens SITRANS LR250 radar level transmitter', qty: 2, unit_price_net: 430000 })
    await post('payments_in', { order_id: order.id, amount: 523600, received_on: today() })
    await post('expenses', { order_id: order.id, amount_pkr: 500000, category_id: SUPPLIER_PAYMENT, paid_on: today(), description: 'Supplier payment' })
    await must(rest('admin', 'order_costs', { method: 'POST', body: { order_id: order.id, expected_cost_pkr: 640000 }, prefer: 'resolution=merge-duplicates,return=minimal' })).catch(() => undefined)

    await openAs(page, 'admin', `/orders/${order.id}`)
    await eachWidth(page, async () => {
      await openStage(page, 'Order')
      const fold = page.getByRole('button', { name: /^Costs and margin/ })
      if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click()
      const card = page.getByRole('region', { name: 'Margin' })
      await expect(card.getByTestId('margin-cash')).toBeVisible()
      await card.scrollIntoViewIfNeeded()
      await pic(page, 'margin-card')
    })

    await openAs(page, 'admin', '/money/margins')
    await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
    await expect(page.getByTestId('margin-totals')).toBeVisible()
    await eachWidth(page, async () => pic(page, 'margins'))
    await page.getByRole('radio', { name: 'Cash' }).click()
    await expect(page.getByTestId('margins-cash')).toBeVisible()
    await eachWidth(page, async () => pic(page, 'margins-cash'))

    await openAs(page, 'admin', '/money/profit')
    await expect(page.getByTestId('profit-average')).toBeVisible()
    await expect(page.getByTestId('bar-chart')).toBeVisible()
    await eachWidth(page, async () => pic(page, 'profit'))
  })
})
