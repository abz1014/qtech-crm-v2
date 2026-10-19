import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, rest, uniqueName } from '../support/stack'
import { legLoc, seedPo } from '../orders/fixtures'
import { fe2, monthBefore, openPage, ordRef, readCount, resetCount, roleContext, todayHas } from './support'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'

/*
 * P03, the critical paths the order-lifecycle audit (docs/AUDIT_ORDER_LIFECYCLE.md) found untested. Each is a short journey of its own:
 *
 *   1. overpayment and advance: an advance before any invoice, then more than the balance is received
 *   2. cancelling an order after its PO was issued
 *   3. the closed-month refusal in the UI, for a payment and for an invoice
 *   4. goods late on a repeat order
 *
 * Where the product does not yet do what the audit says it must (G1, P2), the test states the right behaviour, runs everything up to it, and
 * records the gap with `knownGap`: CI stays green while the gap is there, the finding is named in every report, and the test turns red the day
 * the gap is fixed (the call is then replaced by the plain assertion).
 */

const unique = () => Math.random().toString(36).slice(2, 8)
const today = karachiDay(0)

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

/** An order for a new customer with one line of net `net` (GST 18%), no invoice yet. */
async function newOrder(label: string, net: number) {
  const customer = await createCompany(uniqueName(label))
  const order = await post<{ id: string; number: number }>('orders', { company_id: customer.id, payment_terms_days: 30 })
  await post('order_items', { order_id: order.id, position: 0, description: `${label} item`, qty: 1, unit_price_net: net })
  return { customer, order }
}

const typedDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

test('overpayment and advance: an advance before the invoice, then more than is owed', async ({ browser }, info) => {
  const o = await newOrder('Advance Customer', 100000) // gross 118,000
  const ctx = await roleContext(browser, info, 'admin')
  const page = await openPage(ctx, `/orders/${o.order.id}`)
  const payments = () => must(rest<{ amount: number }[]>('admin', `payments_in?order_id=eq.${o.order.id}&select=amount&order=created_at`))
  const record = async (amount: string) => {
    await page.locator('[data-slot="order-actions"]').getByRole('button', { name: 'Record payment' }).click()
    const d = page.getByRole('dialog', { name: 'Record payment' })
    await expect(d.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue(/.+/) // the balance due is pre-filled
    await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill(amount)
    return d
  }

  await test.step('an advance of 40,000 before any invoice is a part payment, and says what stays due', async () => {
    const d = await record('40,000')
    await expect(d.getByTestId('payment-note')).toHaveAttribute('data-kind', 'part')
    await expect(d.getByTestId('payment-note')).toContainText('PKR 78,000 will still be due')
    await d.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await payments()).map(p => Number(p.amount))).toEqual([40000])
  })

  await test.step('more than the balance is allowed, the dialog says by how much, and the Exceptions list raises it', async () => {
    const d = await record('100,000') // 78,000 is due: 22,000 too much
    await expect(d.getByTestId('payment-note')).toHaveAttribute('data-kind', 'over')
    await expect(d.getByTestId('payment-note')).toContainText('This is PKR 22,000 more than the balance due on this order.')
    await d.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await payments()).map(p => Number(p.amount))).toEqual([40000, 100000])
    await page.goto('/money/exceptions')
    const item = page.getByRole('list', { name: 'Exceptions' }).getByRole('listitem').filter({ hasText: ordRef(o.order.number) }).filter({ hasText: 'Payments exceed total' })
    await expect(item).toContainText('Customer payments (140,000) exceed the order')
    await expect(item.getByRole('link', { name: 'View order' })).toHaveAttribute('href', `/orders/${o.order.id}`)
  })
  await ctx.close()
})

test.describe('cancelling an order after its PO was issued', () => {
  test('the order is cancelled and kept; the PO stays on record; Today stops chasing its goods', async ({ browser }, info) => {
    const s = await seedPo({ allPriced: true })
    const ctx = await roleContext(browser, info, 'admin')
    const page = await openPage(ctx, `/orders/${s.order.id}`)
    await resetCount(page)
    await legLoc(page, 'A').getByRole('button', { name: 'Issue PO, leg A' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Issue PO' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
    fe2('Issue PO (every line priced)', (await readCount(page)).mouse, 2)
    // The goods were due three days ago (the date is moved back): Today chases them.
    await must(rest('admin', `supplier_orders?id=eq.${s.leg}`, { method: 'PATCH', body: { expected_on: karachiDay(-3) }, prefer: 'return=minimal' }))
    await todayHas(ctx, 'goods_late', [s.supplier.name], true)

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Cancel order' }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
    await d.getByRole('button', { name: 'Cancel order' }).click()
    await expect.poll(async () => (await must(rest<{ cancelled_on: string | null }[]>('admin', `orders?id=eq.${s.order.id}&select=cancelled_on`)))[0].cancelled_on).toBe(today)
    await expect(page.getByText(/^Cancelled /).first()).toBeVisible()

    // The PO is a record of what was sent: cancelling the order does not delete it.
    expect(await must(rest<{ id: string }[]>('admin', `purchase_orders?supplier_order_id=eq.${s.leg}&select=id`))).toHaveLength(1)
    // And a cancelled order must not keep nagging: no goods-late chase for a supplier whose order nobody wants any more.
    await todayHas(ctx, 'goods_late', [s.supplier.name], false)
    await ctx.close()
  })

  test('the cancel dialog says which PO went to whom and copies the cancellation message in one tap (audit P2)', async ({ browser }, info) => {
    const s = await seedPo({ allPriced: true })
    const ctx = await roleContext(browser, info, 'admin')
    const page = await openPage(ctx, `/orders/${s.order.id}`)
    await legLoc(page, 'A').getByRole('button', { name: 'Issue PO, leg A' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Issue PO' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
    const [po] = await must(rest<{ number: number; issued_on: string }[]>('admin', `purchase_orders?supplier_order_id=eq.${s.leg}&select=number,issued_on`))
    const ref = `PO-${po.issued_on.slice(2, 4)}-${String(po.number).padStart(4, '0')}`

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Cancel order' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByTestId('cancel-sent-pos')).toContainText(`${ref} was sent to ${s.supplier.name}. Tell them it's cancelled.`)
    await resetCount(page)
    await resetClipboard(page)
    await d.getByRole('button', { name: 'Copy cancellation message' }).click()
    fe2('Copy the cancellation message', (await readCount(page)).mouse, 1)
    const text = await readClipboardWhen(page, `*${ref}*`)
    expect(text).toContain('Endress+Hauser Cerabar PMC51 pressure transmitter')
    expect(text).toMatch(/ask you to cancel/)
    expect(text).not.toMatch(/PKR|USD|\d+\.\d\d/) // no price
    // Telling the supplier is not a required step: the order cancels with the reason alone.
    await d.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
    await d.getByRole('button', { name: 'Cancel order' }).click()
    await expect.poll(async () => (await must(rest<{ cancelled_on: string | null }[]>('admin', `orders?id=eq.${s.order.id}&select=cancelled_on`)))[0].cancelled_on).toBe(today)
    await ctx.close()
  })
})

test.describe('the closed-month refusal, in the screens, for a payment and an invoice', () => {
  const stmt = monthBefore(today, 1)
  const sentence = `${stmt.label} is closed. An admin can reopen it.`
  const typed = `05/${stmt.key.slice(5)}/${stmt.key.slice(0, 4)}`

  test.beforeAll(async () => {
    // a money row in the month, so closing it is a real close; then close it through the API (the Month-end screen is covered by the admin journey)
    await post('expenses', { paid_on: stmt.day(6), paid_via: 'cash', category_id: 'ca7e0000-0000-4000-8000-000000000002', amount_pkr: 13, description: `lock-${unique()}` })
    await must(rest('admin', 'rpc/close_months_through', { method: 'POST', body: { p_month: stmt.start }, prefer: 'return=minimal' }))
  })
  test.afterAll(async () => {
    await rest('admin', 'rpc/reopen_month', { method: 'POST', body: { p_month: stmt.start }, prefer: 'return=minimal' })
  })

  test('Record payment dated in the closed month shows the sentence under the date, keeps the entry and saves nothing', async ({ browser }, info) => {
    const o = await newOrder('Locked Payer', 50000)
    const ctx = await roleContext(browser, info, 'admin')
    const page = await openPage(ctx, `/orders/${o.order.id}`)
    await page.locator('[data-slot="order-actions"]').getByRole('button', { name: 'Record payment' }).click()
    const d = page.getByRole('dialog', { name: 'Record payment' })
    await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('10,000')
    await d.getByRole('textbox', { name: 'Date received' }).fill(typed)
    await d.getByRole('button', { name: 'Save payment' }).click()
    await expect(d.getByText(sentence)).toBeVisible()
    await expect(d.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue('10,000')
    expect(await must(rest<{ id: string }[]>('admin', `payments_in?order_id=eq.${o.order.id}&select=id`))).toHaveLength(0)
    await ctx.close()
  })

  test('Create invoice dated in the closed month shows the sentence under the date and saves nothing', async ({ browser }, info) => {
    const o = await newOrder('Locked Invoicer', 50000)
    const ctx = await roleContext(browser, info, 'sales')
    const page = await openPage(ctx, `/orders/${o.order.id}`)
    await page.locator('[data-slot="order-actions"]').getByRole('button', { name: 'Create invoice' }).click()
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await d.getByRole('textbox', { name: 'Invoice date' }).fill(typed)
    await d.getByRole('button', { name: 'Create invoice' }).click()
    await expect(d.getByText(sentence)).toBeVisible()
    expect(await must(rest<{ id: string }[]>('admin', `invoices?order_id=eq.${o.order.id}&select=id`))).toHaveLength(0)
    // dated today it goes through: the lock is about the month, not the order
    await d.getByRole('textbox', { name: 'Invoice date' }).fill(typedDate(today))
    await d.getByRole('textbox', { name: 'Invoice date' }).press('Tab') // the date is read when the cell is left
    await expect(d.getByText(sentence)).toBeHidden() // changing the date clears the refusal
    await d.getByRole('button', { name: /Create invoice|Try again/ }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await must(rest<{ id: string }[]>('admin', `invoices?order_id=eq.${o.order.id}&select=id`))).toHaveLength(1)
    await ctx.close()
  })
})

test('goods late on a repeat order: late goods are raised even though no quote ever gave the leg an expected date', async ({ browser }, info) => {
  // A past order, delivered, with one supplier leg; the repeat is made on screen from "New order".
  const tag = unique()
  const company = await createCompany(uniqueName(`Repeatco${tag}`))
  const supplier = await createCompany(uniqueName('Alpenmark'), { country: 'Germany' })
  const past = await post<{ id: string; number: number }>('orders', { company_id: company.id, ordered_on: karachiDay(-40), payment_terms_days: 45 })
  const leg = await post('supplier_orders', { order_id: past.id, supplier_id: supplier.id, currency: 'EUR', placed_on: karachiDay(-38), expected_on: karachiDay(-24), received_on: karachiDay(-24), delivered_on: karachiDay(-24) })
  await post('order_items', { order_id: past.id, position: 0, description: `Belimo damper actuator ${tag}`, qty: 6, unit: 'ea', unit_price_net: 48500, supplier_order_id: leg.id, supplier_unit_price: 214 })

  const ctx = await roleContext(browser, info, 'sales')
  const page = await openPage(ctx, '/orders?owner=all')
  await page.getByRole('button', { name: 'New order' }).first().click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Find a past order').fill(company.name)
  await d.getByRole('button', { name: new RegExp(`${company.name}.*ORD-${String(past.number).padStart(4, '0')}`) }).click()
  await d.getByRole('button', { name: 'Create order' }).click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop() as string

  // The supplier is ordered from with one tap; the goods have not come twenty days later (the date is moved back).
  await legLoc(page, 'A').getByRole('button', { name: 'Mark placed, leg A' }).click()
  const legs = await must(rest<{ id: string }[]>('admin', `supplier_orders?order_id=eq.${id}&select=id`))
  await expect.poll(async () => (await must(rest<{ placed_on: string | null }[]>('admin', `supplier_orders?id=eq.${legs[0].id}&select=placed_on`)))[0].placed_on).toBe(today)
  // The leg got its expected date when it was placed (0067: no lead time on a repeat leg, so the supplier's record or 30 days), not by a person.
  const placed = (await must(rest<{ expected_on: string | null }[]>('admin', `supplier_orders?id=eq.${legs[0].id}&select=expected_on`)))[0]
  expect(placed.expected_on).not.toBeNull()
  // Forty-five days pass (the dates move back together): the default has run out and goods late is raised.
  await must(rest('admin', `supplier_orders?id=eq.${legs[0].id}`, { method: 'PATCH', body: { placed_on: karachiDay(-45), expected_on: karachiDay(-45 + Math.round((Date.parse(placed.expected_on as string) - Date.parse(today)) / 86_400_000)) }, prefer: 'return=minimal' }))
  await todayHas(ctx, 'goods_late', [supplier.name], true)
  await ctx.close()
})
