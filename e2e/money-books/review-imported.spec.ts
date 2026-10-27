import { expect, test } from '@playwright/test'
import { createCompany, openAs, uniqueName } from '../support/stack'
import { db, num } from '../verify/support/db'

const ADMIN = 'a0000000-0000-4000-8000-000000000001'

/*
 * Review imported (redesign phase 2, migration 0096), end to end with fictional data written the way the import writes it (the
 * service role, legacy_source set):
 *   - Find matches proposes the link of an imported invoice to its order: the same customer, the PO on the order, the amount
 *     (a "certain" match: one order for the invoice, one invoice for the order, both dates known)
 *   - Accept links it, EVEN IN A LOCKED IMPORTED MONTH (the import locks the months through Aug 2026); unlink puts it back
 *   - "Settled, keep as history" takes an imported order's open balance away (it leaves Who owes us) and Undo brings it back
 * The rules themselves are in pgTAP 0096_money_truth.test.sql; this proves the screen drives them.
 */
const MARCH = '2026-03-01'

async function seed() {
  const co = await createCompany(uniqueName('Review Customer'))
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase()
  const po = `RV-PO-${tag}`
  const order = await db.add<{ id: string; number: number }>('orders', {
    company_id: co.id, owner_id: ADMIN, ordered_on: '2026-03-02', customer_po_number: po, payment_terms_days: 30, legacy_source: { sheet: 'orders', row: tag },
  })
  await db.insert('order_items', { order_id: order.id, position: 0, description: `Imported item ${tag}`, qty: 1, unit: 'ea', unit_price_net: 1000, gst_rate: 18 })
  const invoice = await db.add<{ id: string }>('invoices', {
    company_id: co.id, number: `RV-${tag}`, invoice_date: '2026-03-12', net_amount: 1000, gst_amount: 180, notes: `PO ${po}`, legacy_source: { sheet: 'invoices', row: tag },
  })
  await db.patch(`orders?id=eq.${order.id}`, { legacy_review: 'to_review' })
  await db.patch(`invoices?id=eq.${invoice.id}`, { legacy_review: 'to_review' })
  return { co, order, invoice, number: `RV-${tag}` }
}

const balance = async (orderId: string) => num((await db.adminRpc<{ balance: number }[]>('order_receivables', { p_order_id: orderId }))[0]?.balance)

test('Find matches proposes the certain link, Accept links it (a locked month allows it), unlink puts it back', async ({ page }) => {
  test.setTimeout(180_000)
  const s = await seed()
  const locked = (await db.count(`closed_months?month=eq.${MARCH}&select=month`)) > 0

  await openAs(page, 'admin', '/money/review-imported')
  await expect(page.getByTestId(`review-order-${s.order.id}`)).toBeVisible()
  await expect(page.getByTestId(`review-invoice-${s.invoice.id}`)).toBeVisible()

  await page.getByRole('button', { name: 'Find matches' }).click()
  const proposal = page.locator('[data-confidence]').filter({ hasText: s.number })
  await expect(proposal).toBeVisible()
  await expect(proposal).toHaveAttribute('data-confidence', 'certain')
  await expect(proposal).toContainText('Certain')
  // a dry run changed nothing
  expect((await db.one<{ order_id: string | null }>(`invoices?id=eq.${s.invoice.id}&select=order_id`)).order_id).toBeNull()

  await proposal.getByRole('button', { name: 'Accept' }).click()
  await expect.poll(async () => (await db.one<{ order_id: string | null }>(`invoices?id=eq.${s.invoice.id}&select=order_id`)).order_id, 'the invoice is linked').toBe(s.order.id)
  // linking is audited
  expect(await db.count(`audit_log?record_id=eq.${s.invoice.id}&select=id`)).toBeGreaterThan(0)
  test.info().annotations.push({ type: 'locked month', description: locked ? `${MARCH} is locked: the link worked inside it` : `${MARCH} is not locked on this database` })

  // unlink (the admin's way back, also inside a locked month)
  await db.adminRpc('unlink_imported_invoice', { p_invoice_id: s.invoice.id })
  expect((await db.one<{ order_id: string | null }>(`invoices?id=eq.${s.invoice.id}&select=order_id`)).order_id, 'unlinked').toBeNull()
})

test('Settled, keep as history takes the imported order off Who owes us; Undo brings it back', async ({ page }) => {
  test.setTimeout(180_000)
  const s = await seed()
  // the invoice belongs to the order from the start in this test, so the order has a real balance
  await db.patch(`invoices?id=eq.${s.invoice.id}`, { order_id: s.order.id })
  const before = await balance(s.order.id)
  expect(before, 'precondition: the imported order owes 1,180').toBe(1180)
  const outstanding = async () => num((await db.adminRpc<{ outstanding: number }[]>('receivables_summary'))[0].outstanding)
  const collect0 = await outstanding()

  await openAs(page, 'admin', '/money/review-imported')
  const row = page.getByTestId(`review-order-${s.order.id}`)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Settled, keep as history' }).click()
  await expect.poll(async () => (await db.one<{ legacy_review: string | null }>(`orders?id=eq.${s.order.id}&select=legacy_review`)).legacy_review).toBe('settled')
  await expect.poll(() => balance(s.order.id), 'a settled imported order owes nothing').toBe(0)
  expect(await outstanding(), 'To collect (Money home) drops by exactly what that order owed').toBeCloseTo(collect0 - 1180, 2)

  // (the decision stays on the page with its Undo until the page is left; the "Kept as history" toast sits over the row's Undo for a few seconds)
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Kept as history')).toBeHidden({ timeout: 30_000 })
  await page.getByRole('listitem').filter({ hasText: s.co.name }).getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await db.one<{ legacy_review: string | null }>(`orders?id=eq.${s.order.id}&select=legacy_review`)).legacy_review).toBe('to_review')
  await expect.poll(() => balance(s.order.id), 'undo: the balance is back').toBe(1180)
  expect(await outstanding(), 'and To collect is back').toBeCloseTo(collect0, 2)
})
