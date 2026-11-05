import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { JOB_URL } from '../support/job'

/*
 * Delete a job (migration 0132), end to end against the local CI stack, from the job page's More menu:
 *   - a clean job: the confirm says what goes, Delete removes it and lands on the Jobs list
 *   - a job with a payment: a guide ("To do first") instead of Delete; after the payment is cleared, Check again turns it into the confirm
 *   - a job with a numbered invoice: "These stay for the books" and Cancel the job instead (the existing cancel flow)
 *   - sales and engineers are offered no Delete job
 * Synthetic data only.
 */
test.describe.configure({ mode: 'serial' })

const unique = () => Math.random().toString(36).slice(2, 8)

async function seedJob() {
  const company = await createCompany(uniqueName('Delete Job Customer'), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  return { id: order.id, number: order.number, key: `O-${order.number}`, company }
}

const addPayment = (orderId: string) =>
  must(rest<{ id: string }[]>('admin', 'payments_in', { method: 'POST', body: { order_id: orderId, amount: 1000, received_on: karachiDay(0) } })).then(r => r[0])

const addInvoice = (orderId: string) =>
  must(
    rest<{ id: string; number: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { order_id: orderId, number: `DJ-${unique()}`.toUpperCase(), invoice_date: karachiDay(0), net_amount: 100000, gst_amount: 18000 },
    }),
  ).then(r => r[0])

async function openJob(page: Page, role: 'admin' | 'sales' | 'engineer', orderId: string) {
  await openAs(page, role, `/orders/${orderId}`)
  await expect(page).toHaveURL(JOB_URL)
}

const openMore = (page: Page) => page.getByRole('button', { name: /^More( actions)?$/ }).click()

const orderRows = (id: string) => must(rest<unknown[]>('admin', `orders?id=eq.${id}&select=id`))

test.describe('delete a job', () => {
  test('a clean job: the confirm says what goes, Delete removes it and the Jobs list is shown', async ({ page }) => {
    const job = await seedJob()
    await openJob(page, 'admin', job.id)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Delete job' }).click()

    const dialog = page.getByRole('dialog', { name: `Delete Job ${job.key}?` })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-slot="delete-also"]')).toContainText('its orders and their lines')
    await expect(dialog.getByText('This can’t be undone.')).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page).toHaveURL(/\/jobs$/)
    await expect(page.getByRole('status').filter({ hasText: `Job ${job.key} deleted` })).toBeVisible()
    expect(await orderRows(job.id)).toEqual([])
  })

  test('a job with a payment shows the guide, no Delete; clear the payment, Check again, then it can be deleted', async ({ page }) => {
    const job = await seedJob()
    const payment = await addPayment(job.id)
    await openJob(page, 'admin', job.id)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Delete job' }).click()

    const guide = page.getByRole('dialog', { name: 'This job cannot be deleted yet' })
    await expect(guide).toBeVisible()
    await expect(guide.getByRole('heading', { name: 'To do first' })).toBeVisible()
    await expect(guide.getByText(/Delete the payment:/)).toBeVisible()
    await expect(guide.getByRole('link', { name: 'Open this stage' })).toHaveAttribute('href', new RegExp(`/jobs/${job.key}\\?stage=payment$`))
    await expect(guide.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    // text is never below 16px
    const small = await guide.locator('[data-slot="delete-guide"]').evaluate(el => Array.from(el.querySelectorAll('p, li, span, h3, a')).filter(n => n.textContent?.trim() && parseFloat(getComputedStyle(n).fontSize) < 16).length)
    expect(small).toBe(0)

    // the payment is cleared outside the dialog (the step the guide asked for), then the guide is read again
    await must(rest('admin', 'rpc/delete_payment', { method: 'POST', body: { p_payment_id: payment.id } }))
    await guide.getByRole('button', { name: 'Check again' }).click()
    const confirm = page.getByRole('dialog', { name: `Delete Job ${job.key}?` })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL(/\/jobs$/)
    expect(await orderRows(job.id)).toEqual([])
  })

  test('a numbered invoice stays for the books: the guide says so and offers Cancel the job instead', async ({ page }) => {
    const job = await seedJob()
    const invoice = await addInvoice(job.id)
    await openJob(page, 'admin', job.id)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Delete job' }).click()

    const guide = page.getByRole('dialog', { name: 'This job cannot be deleted yet' })
    await expect(guide.getByRole('heading', { name: 'These stay for the books' })).toBeVisible()
    await expect(guide.getByText(new RegExp(`Invoice ${invoice.number}`))).toBeVisible()
    await expect(guide.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await guide.getByRole('button', { name: 'Cancel the job instead' }).click()

    // the order's own cancel flow opens
    await expect(page.getByRole('dialog', { name: 'Cancel this order' })).toBeVisible()
    expect(await orderRows(job.id)).toHaveLength(1)
  })

  test('sales is offered no Delete job', async ({ page }) => {
    const job = await seedJob()
    await openJob(page, 'sales', job.id)
    await openMore(page)
    await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete job' })).toHaveCount(0)
  })

  test('an engineer has no menu for it', async ({ page }) => {
    const job = await seedJob()
    await openJob(page, 'engineer', job.id)
    await expect(page.getByRole('menuitem', { name: 'Delete job' })).toHaveCount(0)
    await expect(page.getByText('Delete job')).toHaveCount(0)
  })
})
