import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { setProfile } from '../orders/fixtures'
import { db, num } from '../verify/support/db'
import { amount } from '../verify/support/text'

/*
 * The whole job on the Job page (VERIFY, END-CHECKLIST 65), fictional data, as the admin:
 *   enquiry with one supplier price -> Mark won (price TYPED in the dialog) -> order -> supplier PO -> goods delivered ->
 *   commissioning planned -> invoice -> payment in two parts
 * every step done on /jobs/<n> (the stage sections), with the stage bar moving, and the money reconciled to the paisa between the
 * database and the three places the owner reads it: the order's balance, To collect, and the GST register.
 *
 *   3 x 33,333.33 = 99,999.99 net; GST 18% = 17,999.9982 -> 18,000 (whole rupees per line); gross 117,999.99.
 *   payment 1 40,000.00, payment 2 77,999.99.
 */
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const PRICE = 33333.33
const NET = 99999.99
const GST = 18000
const GROSS = 117999.99
const slash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const stages = (page: Page) => page.locator('[data-stages]')
const openStage = async (page: Page, name: RegExp) => {
  const b = stages(page).getByRole('button', { name })
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click()
}
const phoneLabel = (page: Page) => page.locator('[data-stage-phone]')

test('RFQ to payment through the Job page, and the money reconciles to the paisa', async ({ page }) => {
  test.setTimeout(900_000)
  await setProfile(true)
  const today = karachiDay(0)
  const customer = await createCompany(uniqueName('Flow Customer'))
  const supplier = await createCompany(uniqueName('Flow Supplier'), { country: 'Pakistan' })
  const rfq = await createRfq(customer.id, { owner_id: ADMIN, customer_ref: 'FLOW-1', due_on: karachiDay(7) })
  const [item] = await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Vortex flow meter DN50', qty: 3 } }))
  const [inquiry] = await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: today } }))
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiry.id, rfq_item_id: item.id, unit_price: 20000, currency: 'PKR', lead_time: '2 weeks' }, prefer: 'return=minimal' }))

  // the money figures the owner reads, before this job exists (the database is shared with this suite's other tests)
  const before = await db.adminRpc<{ outstanding: number }[]>('receivables_summary')

  await openAs(page, 'admin', `/jobs/${rfq.number}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${rfq.number}`)
  // priced, not quoted: the ruler waits at Quotation
  await expect(phoneLabel(page)).toContainText('Stage 2 of 7 · Quotation')

  // ---- Mark won, the selling price typed ---------------------------------------------------------------------------------------------
  await test.step('Mark won on the Order stage: the price is typed in the dialog', async () => {
    await openStage(page, /^Order/)
    await stages(page).getByRole('button', { name: 'Mark won' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByRole('heading', { name: 'Mark won' })).toBeVisible()
    await d.getByLabel('Selling price, line 1').fill(String(PRICE))
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect.poll(async () => (await db.rows(`orders?rfq_id=eq.${rfq.id}&select=id`)).length, { timeout: 60_000 }).toBe(1)
  })
  const order = await db.one<{ id: string; number: number }>(`orders?rfq_id=eq.${rfq.id}&select=id,number`)
  const lines = await db.rows<{ qty: number; unit_price_net: number }>(`order_items?order_id=eq.${order.id}&select=qty,unit_price_net`)
  expect(lines.map(l => [num(l.qty), num(l.unit_price_net)]), 'the order line carries the typed price').toEqual([[3, PRICE]])
  await page.goto(`/jobs/${rfq.number}`)
  await expect(phoneLabel(page)).toContainText('Stage 4 of 7 · Supplier order')

  // ---- the supplier order: issue the PO --------------------------------------------------------------------------------------------------
  await test.step('Issue PO on the Supplier order stage', async () => {
    await openStage(page, /^Supplier order/)
    await page.getByRole('button', { name: `Issue PO, ${supplier.name}` }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByRole('heading', { name: 'Issue purchase order' })).toBeVisible()
    await d.getByRole('button', { name: 'Issue PO' }).click()
    await expect(d).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(async () => (await db.rows(`supplier_orders?order_id=eq.${order.id}&placed_on=not.is.null&select=id`)).length).toBe(1)
  })

  // ---- delivery and commissioning ----------------------------------------------------------------------------------------------------------
  await test.step('Delivered today on the Delivery stage', async () => {
    await page.reload()
    await openStage(page, /^Delivery/)
    await page.getByRole('button', { name: `Delivered today, ${supplier.name}` }).click()
    await expect.poll(async () => (await db.rows<{ delivered_on: string | null }>(`supplier_orders?order_id=eq.${order.id}&select=delivered_on`))[0].delivered_on).toBe(today)
  })
  await db.patch(`orders?id=eq.${order.id}`, { needs_commissioning: true })
  await test.step('commissioning is planned from the Delivery stage', async () => {
    await page.reload()
    await openStage(page, /^Delivery/)
    const section = page.getByRole('region', { name: 'Commissioning' })
    await section.getByRole('button', { name: 'Edit', exact: true }).click()
    const d = page.getByRole('dialog')
    const planned = d.getByRole('textbox', { name: 'Planned on' })
    await planned.fill(slash(karachiDay(2)))
    await planned.press('Enter')
    await d.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await db.one<{ commissioning_planned_on: string | null }>(`orders?id=eq.${order.id}&select=commissioning_planned_on`)).commissioning_planned_on).toBe(karachiDay(2))
  })
  // the engineer's one tap is proved in the orders and journeys suites; here the visit is closed so the job can move on
  await db.patch(`orders?id=eq.${order.id}`, { commissioning_done_on: today })

  // ---- invoice and payment -----------------------------------------------------------------------------------------------------------------
  await test.step('Create invoice on the Invoice stage: net and GST come from the lines', async () => {
    await page.reload()
    await expect(phoneLabel(page)).toContainText('Stage 6 of 7 · Invoice')
    await openStage(page, /^Invoice/)
    await page.getByRole('button', { name: 'Create invoice' }).first().click()
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await expect(d.getByText(amount(GROSS), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: 'Create invoice' }).click()
    await expect(d).toBeHidden()
    const [inv] = await db.rows<{ net_amount: number; gst_amount: number; number: string }>(`invoices?order_id=eq.${order.id}&select=net_amount,gst_amount,number`)
    expect([num(inv.net_amount), num(inv.gst_amount)], 'invoice net and GST').toEqual([NET, GST])
  })

  const paid = async (n: number, expectBalance: number) => {
    await page.reload()
    await openStage(page, /^Payment/)
    await stages(page).getByRole('button', { name: 'Record payment' }).first().click()
    const d = page.getByRole('dialog', { name: 'Record payment' })
    const box = d.getByRole('textbox', { name: 'Amount received, PKR' })
    await box.fill(String(n))
    await d.getByRole('button', { name: 'Save payment' }).click()
    await expect(d).toBeHidden()
    await expect.poll(async () => num((await db.adminRpc<{ balance: number }[]>('order_receivables', { p_order_id: order.id }))[0].balance)).toBe(expectBalance)
  }
  await test.step('payment 1 of 40,000.00: part paid', async () => {
    await paid(40000, 77999.99)
    const r = (await db.adminRpc<{ settled: number; balance: number; payment_state: string }[]>('order_receivables', { p_order_id: order.id }))[0]
    expect([num(r.settled), num(r.balance), r.payment_state]).toEqual([40000, 77999.99, 'part'])
  })

  // ---- the three places the owner reads it, mid-way ------------------------------------------------------------------------------------------
  await test.step('To collect, the GST register and Money home agree with the database to the paisa', async () => {
    await page.goto('/money/receivables')
    const row = page.getByRole('row').filter({ hasText: customer.name }).first()
    await expect(row).toBeVisible()
    await expect(row).toContainText(amount(77999.99))
    await page.goto('/money/gst-register')
    const inv = (await db.rows<{ number: string }>(`invoices?order_id=eq.${order.id}&select=number`))[0].number
    await page.getByLabel(/^Search/).first().fill(inv).catch(() => undefined)
    const reg = page.getByRole('row').filter({ hasText: inv }).first()
    await expect(reg).toBeVisible()
    await expect(reg).toContainText(amount(NET))
    await expect(reg).toContainText(amount(GST))
    const mid = await db.adminRpc<{ outstanding: number }[]>('receivables_summary')
    expect(num(mid[0].outstanding) - num(before[0].outstanding), 'To collect moved by exactly what is still owed on this job').toBeCloseTo(77999.99, 2)
    await page.goto('/money')
    // Money home may show whole rupees: either form is the same figure
    const figure = num(mid[0].outstanding)
    const forms = [amount(figure), Math.round(figure).toLocaleString('en-US')].map(f => f.replaceAll('.', '\\.').replaceAll(',', ','))
    await expect(page.getByTestId('money-blocks')).toContainText(new RegExp(forms.join('|')))
  })

  await test.step('payment 2 of 77,999.99 settles it: the ruler is done and To collect is back to where it was', async () => {
    await paid(77999.99, 0)
    const r = (await db.adminRpc<{ settled: number; balance: number; payment_state: string }[]>('order_receivables', { p_order_id: order.id }))[0]
    expect([num(r.settled), num(r.balance), r.payment_state]).toEqual([GROSS, 0, 'settled'])
    const after = await db.adminRpc<{ outstanding: number }[]>('receivables_summary')
    expect(num(after[0].outstanding), 'To collect after the job is paid').toBeCloseTo(num(before[0].outstanding), 2)
    await page.goto(`/jobs/${rfq.number}`)
    await expect(phoneLabel(page)).toContainText('All 7 stops done')
  })
})
