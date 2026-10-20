import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'

/*
 * Payment corrections (0073) and the invoice PDF button, end to end against the local CI stack, as the fixture users:
 *   Void: the order's balance goes up by the payment, Undo puts it back.
 *   Correct: the new figures count, the old payment is folded under Voided, the correction is tagged.
 *   Print invoice: on the order's Invoicing cell for admin and sales once something is invoiced, never for the engineer.
 */
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

async function seed() {
  const company = await createCompany(uniqueName('Correction Customer'))
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Pressure gauge', qty: 1, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  await must(rest('admin', 'invoices', { method: 'POST', body: { number: `E2E-${unique()}`, invoice_date: today(), net_amount: 100000, gst_amount: 18000, order_id: order.id }, prefer: 'return=minimal' }))
  await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: order.id, amount: 50000, received_on: today(), reference: 'TT-1' }, prefer: 'return=minimal' }))
  return order
}

async function balance(orderId: string): Promise<number> {
  const rows = await must(rest<{ balance: number }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: orderId } }))
  return Number(rows[0].balance)
}

test.describe.configure({ mode: 'serial' })

test.describe('payment corrections (0073)', () => {
  test('void drops the payment from the figures; Undo restores it', async ({ page }) => {
    const order = await seed()
    expect(await balance(order.id)).toBe(68000)
    await openAs(page, 'admin', `/orders/${order.id}`)
    const panel = page.locator('[data-slot="invoices-payments"]')
    await panel.getByRole('button', { name: /Change payment of PKR 50,000/ }).click()
    await page.getByRole('menuitem', { name: /Void/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Void payment' })
    await dialog.getByRole('button', { name: 'Typed twice' }).click()
    await review(page, 'r2-void-payment-1440')
    await dialog.getByRole('button', { name: 'Void payment' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('order-balance')).toHaveText('118,000')
    await expect.poll(() => balance(order.id)).toBe(118000)
    await expect(panel.getByRole('button', { name: 'Voided (1)' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).first().click()
    await expect.poll(() => balance(order.id)).toBe(68000)
    await expect(page.getByTestId('order-balance')).toHaveText('68,000')
  })

  test('correct records the new figures, keeps the old one voided and tags the correction', async ({ page }) => {
    const order = await seed()
    await openAs(page, 'admin', `/orders/${order.id}`)
    const panel = page.locator('[data-slot="invoices-payments"]')
    await panel.getByRole('button', { name: /Change payment of PKR 50,000/ }).click()
    await page.getByRole('menuitem', { name: /Correct/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Correct payment' })
    await expect(dialog.getByRole('button', { name: 'Save correction' })).toBeDisabled()
    const amount = dialog.getByRole('textbox', { name: /Amount received/ })
    await amount.fill('45000')
    await amount.blur()
    await expect(dialog.getByTestId('correction-changes')).toContainText('PKR 50,000 → 45,000')
    await dialog.getByRole('textbox', { name: /Reason/ }).fill('Bank charges deducted')
    await review(page, 'r2-correct-payment-1440')
    await dialog.getByRole('button', { name: 'Save correction' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => balance(order.id)).toBe(73000)
    await expect(panel.getByTestId('payment-line')).toHaveCount(1)
    await expect(panel.getByTestId('payment-line')).toContainText('45,000')
    await expect(panel.getByTestId('payment-line').getByText('Corrected')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Voided (1)' })).toBeVisible()
  })
})

test.describe('Print invoice button', () => {
  test('admin and sales see it on an invoiced order; the engineer does not', async ({ browser }) => {
    const order = await seed()
    const engineer = (await must(rest<{ id: string }[]>('admin', 'users?role=eq.engineer&deactivated_at=is.null&select=id&order=created_at&limit=1')))[0]
    await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: engineer.id }, prefer: 'return=minimal' }))
    for (const role of ['admin', 'sales'] as const) {
      const ctx = await browser.newContext()
      const p = await ctx.newPage()
      await openAs(p, role, `/orders/${order.id}`)
      await expect(p.getByRole('button', { name: 'Print invoice' })).toBeVisible()
      await ctx.close()
    }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await openAs(page, 'engineer', `/orders/${order.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print invoice' })).toHaveCount(0)
    await ctx.close()
  })
})
