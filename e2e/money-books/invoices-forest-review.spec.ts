import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Forest lane C1 (invoices, mockups 53-invoices and 54-invoice-dialogs): pictures of the GST register and the invoice dialogs at 1440
 * and 375, written to REVIEW_DIR as `c1-<name>-<width>.png` (CI uploads it; nothing is written locally). Each picture is checked for
 * sideways scroll. The register holds a plain invoice, one for a customer with a very long name, a filed one (PSID and deposit), a
 * void one and a credit note, so every kind of row and every Next step tone is drawn. Synthetic data only.
 */
const WIDTHS = [
  [1440, 900],
  [375, 812],
] as const
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

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
  await page.screenshot({ path: `${dir}/c1-${name}-${size.width}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
  await page.setViewportSize(size)
}

async function seedOrder(name: string, net: number) {
  const company = await createCompany(name)
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }))
  return { id: order.id, number: order.number, company }
}

const seedInvoice = (orderId: string, net: number, over: Record<string, unknown> = {}) =>
  must(
    rest<{ id: string; number: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { number: `C1-${unique()}`, invoice_date: today(), net_amount: net, gst_amount: Math.round(net * 0.18), order_id: orderId, ...over },
    }),
  ).then(r => r[0])

test.describe.configure({ mode: 'serial' })

test('C1 review pictures: the GST register and the invoice dialogs at 1440 and 375', async ({ page }) => {
  test.setTimeout(180_000)
  const plain = await seedOrder(uniqueName('Kestrel Power'), 1725000)
  const long = await seedOrder(uniqueName('Pakistan Petroleum Refinery and Industrial Gases (Private) Limited, Karachi Works'), 640000)
  const filedOrder = await seedOrder(uniqueName('Chenab Chemicals'), 1180000)
  const voidOrder = await seedOrder(uniqueName('Sutlej Board Mills'), 550000)
  const open = await seedInvoice(plain.id, 1725000)
  await seedInvoice(long.id, 640000)
  const filed = await seedInvoice(filedOrder.id, 1180000, { psid: `2026${Date.now() % 100000000}`, tax_deposited_on: today(), tax_deposit_amount: 212400, tcs_sent_on: today() })
  const voided = await seedInvoice(voidOrder.id, 550000)
  await must(rest('admin', 'rpc/void_invoice', { method: 'POST', body: { p_invoice_id: voided.id, p_reason: 'Typed twice' } }))
  await must(rest('admin', 'rpc/create_credit_note', { method: 'POST', body: { p_invoice_id: filed.id, p_net: 100000, p_reason: 'Part of the order was returned' } }))

  let signedIn = false
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    // signed in once: a second visit to /login would only send the session on to Home
    if (signedIn) await page.goto('/money/gst-register')
    else await openAs(page, 'admin', '/money/gst-register')
    signedIn = true
    await expect(page.getByRole('heading', { name: 'GST register', level: 2 })).toBeVisible()
    await expect(page.getByText(open.number).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await pic(page, 'register')

    // tick the month: the stamps band along the foot of the toolbar card
    await page.getByRole('checkbox', { name: /Select all in/ }).first().click()
    await expect(page.getByTestId('batch-bar')).toBeVisible()
    await pic(page, 'register-ticked')
    await page.getByRole('checkbox', { name: /Select all in/ }).first().click()

    // an open invoice opens as the form; a filed one as the summary
    await page.goto(`/money/gst-register?invoice=${open.id}`)
    await expect(page.getByRole('dialog', { name: `Invoice ${open.number}` })).toBeVisible()
    await page.getByRole('button', { name: /Courier, FBR and notes/ }).click()
    await pic(page, 'invoice-form', { grow: false })
    await page.goto(`/money/gst-register?invoice=${filed.id}`)
    await expect(page.getByTestId('invoice-summary')).toBeVisible()
    await pic(page, 'invoice-summary', { grow: false })
    await page.goto(`/money/gst-register?invoice=${voided.id}`)
    await expect(page.getByTestId('invoice-void-banner')).toBeVisible()
    await pic(page, 'invoice-void', { grow: false })

    // Create invoice: the order first, then the form, then Edit the amounts
    await page.goto('/money/gst-register?new=1')
    await expect(page.getByRole('dialog', { name: 'Create invoice' })).toBeVisible()
    await pic(page, 'create-pick', { grow: false })
    await page.goto(`/money/gst-register?new=1&order=${long.id}`)
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await expect(d.getByRole('textbox', { name: 'Invoice number' })).toBeVisible()
    await pic(page, 'create', { grow: false })
    await d.getByRole('button', { name: /Edit the amounts/ }).click()
    await pic(page, 'create-amounts', { grow: false })
  }
})
