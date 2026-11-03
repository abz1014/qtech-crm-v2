import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { JOB_URL, openStage } from '../support/job'

/*
 * The money-integrity and owner actions, reached from a JOB address. The old Order page is gone: /orders/<id> redirects to /jobs/O-<n>
 * (src/app/oldAddresses.tsx), and everything below starts there and goes only through the Job page.
 *   - void an invoice: Invoice stage, "Open in Invoices", the invoice, Void invoice
 *   - credit note on a filed invoice: the same road, Create credit note
 *   - record a payment with withholding tax, tied to one of two invoices (RecordPaymentDialog, from the Invoice stage)
 *   - reassign the owner (the Job page header)
 * Synthetic data only. No test here depends on the day of the month: invoices are dated today.
 */
test.describe.configure({ mode: 'serial' })

const unique = () => Math.random().toString(36).slice(2, 8)
const LINK = 'Open in Invoices to void one or issue a credit note'

async function seedOrder(extra: Record<string, unknown> = {}) {
  const company = await createCompany(uniqueName('Job Actions Customer'), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30, ...extra } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  return { id: order.id, number: order.number, company }
}

const makeInvoice = (orderId: string, over: Record<string, unknown> = {}) =>
  must(
    rest<{ id: string; number: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { order_id: orderId, number: `JA-${unique()}`.toUpperCase(), invoice_date: karachiDay(0), net_amount: 100000, gst_amount: 18000, ...over },
    }),
  ).then(r => r[0])

/** From the old address to the Invoice stage of the Job page, then through its link to the invoice in the register. */
async function openInvoiceFromJob(page: import('@playwright/test').Page, orderId: string, number: string) {
  await openAs(page, 'admin', `/orders/${orderId}`)
  await expect(page).toHaveURL(JOB_URL)
  const stage = await openStage(page, 'Invoice')
  await stage.getByRole('link', { name: LINK }).click()
  await expect(page).toHaveURL(/\/money\/gst-register/)
  await page.getByRole('row', { name: new RegExp(number) }).first().click()
}

test('void an invoice from the Job page: the number stays in the register at 0 and the order is open again', async ({ page }) => {
  const order = await seedOrder()
  const inv = await makeInvoice(order.id)
  await openInvoiceFromJob(page, order.id, inv.number)
  await page.getByRole('button', { name: 'Void invoice' }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Reason for voiding').fill('Wrong customer')
  await dialog.getByRole('button', { name: 'Void invoice' }).click()
  await expect(page.getByText(`Voided invoice ${inv.number}`)).toBeVisible()
  const row = await must(rest<{ net_amount: number; voided_at: string | null; void_reason: string }[]>('admin', `invoices?id=eq.${inv.id}&select=net_amount,voided_at,void_reason`))
  expect(row[0]).toMatchObject({ net_amount: 0, void_reason: 'Wrong customer' })
  expect(row[0].voided_at).not.toBeNull()
})

test('credit note on a filed invoice from the Job page', async ({ page }) => {
  const order = await seedOrder()
  const inv = await makeInvoice(order.id, { psid: `PSID-${unique()}` })
  await openInvoiceFromJob(page, order.id, inv.number)
  await page.getByRole('button', { name: 'Create credit note' }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Amount to credit').fill('40000')
  await dialog.getByLabel('Reason for the credit note').fill('Part returned')
  await dialog.getByRole('button', { name: 'Issue credit note' }).click()
  await expect(page.getByText(/Credit note CN-\d{4} issued/)).toBeVisible()
  const notes = await must(rest<{ gst_amount: number }[]>('admin', `credit_notes?invoice_id=eq.${inv.id}&select=gst_amount`))
  expect(notes).toHaveLength(1)
  expect(Number(notes[0].gst_amount)).toBe(7200)
})

test('record a payment with withholding tax, tied to the second invoice, from the Job page', async ({ page }) => {
  const order = await seedOrder()
  const first = await makeInvoice(order.id, { net_amount: 40000, gst_amount: 7200 })
  const second = await makeInvoice(order.id, { net_amount: 60000, gst_amount: 10800 })
  await openAs(page, 'admin', `/orders/${order.id}`)
  await expect(page).toHaveURL(JOB_URL)
  const stage = await openStage(page, 'Invoice')
  await stage.getByRole('button', { name: 'Record payment' }).click()
  const d = page.getByRole('dialog', { name: 'Record payment' })
  await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('60800')
  await d.getByRole('button', { name: 'This payment is for one invoice' }).click()
  await d.getByLabel('This payment is for').selectOption(second.id)
  await d.getByRole('button', { name: 'Withholding tax deducted' }).click()
  await d.getByLabel('Withholding tax deducted', { exact: true }).fill('10000')
  await d.getByLabel('Withholding tax certificate number').fill(`WHT-${unique()}`)
  await d.getByRole('button', { name: 'Save payment' }).click()
  await expect(d).toBeHidden()
  const pay = await must(rest<{ invoice_id: string | null; amount: number; wht_amount: number }[]>('admin', `payments_in?order_id=eq.${order.id}&voided_at=is.null&select=invoice_id,amount,wht_amount`))
  expect(pay).toHaveLength(1)
  expect(pay[0].invoice_id).toBe(second.id)
  expect(pay[0].invoice_id).not.toBe(first.id)
  expect([Number(pay[0].amount), Number(pay[0].wht_amount)]).toEqual([60800, 10000])
})

test('reassign the owner from the Job page header', async ({ page }) => {
  const users = await must(rest<{ id: string; role: string; name: string }[]>('admin', 'users?select=id,role,name&deactivated_at=is.null'))
  const sales = users.find(u => u.role === 'sales' && u.name)!
  const admin = users.find(u => u.role === 'admin' && u.name)!
  const order = await seedOrder({ owner_id: sales.id })
  await openAs(page, 'admin', `/orders/${order.id}`)
  await expect(page).toHaveURL(JOB_URL)
  await page.getByRole('button', { name: 'Reassign owner' }).click()
  const d = page.getByRole('dialog', { name: 'Reassign owner' })
  await d.getByLabel('New owner').selectOption({ label: admin.name })
  await d.getByRole('button', { name: 'Change owner' }).click()
  await expect.poll(async () => (await must(rest<{ owner_id: string }[]>('admin', `orders?id=eq.${order.id}&select=owner_id`)))[0].owner_id).toBe(admin.id)
})
