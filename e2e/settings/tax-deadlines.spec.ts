import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { showAllTodo } from '../support/todo'

/*
 * Settings > Tax deadlines (migration 0110; owner answer to Q8, 2026-10-28), end to end against the local CI stack.
 *   - the admin edits "pay GST by day N" and "file the return by day N", and the GST row on To do moves with them;
 *   - the admin can give one month a one-off date (FBR extended it), and remove it again;
 *   - sales can read the days and cannot change them;
 *   - an engineer sees no GST: no menu entry, no page, and the database returns no row.
 * The days are global settings, so the file runs in order and puts back 15 and 18 at the end.
 */
test.describe.configure({ mode: 'serial' })

const slash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const putDays = (pay: number, ret: number) =>
  must(rest('admin', 'gst_deadline_settings?id=eq.1', { method: 'PATCH', body: { pay_day: pay, return_day: ret }, prefer: 'return=minimal' }))
const clearOverrides = () => must(rest('admin', 'gst_deadline_overrides?month=gte.2000-01-01', { method: 'DELETE', prefer: 'return=minimal' }))

/** Last month's first day plus four: an invoice with GST and no tax deposit, which is what puts the GST row on the admin's To do. */
function lastMonthDay(): { invoiceDate: string; monthStart: string } {
  const [y, m] = karachiDay().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  const monthStart = d.toISOString().slice(0, 10)
  return { invoiceDate: `${monthStart.slice(0, 8)}05`, monthStart }
}

async function seedUndepositedInvoice() {
  const company = await createCompany(uniqueName('Tax Deadline Customer'))
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, ordered_on: karachiDay(-40), needs_commissioning: false } })))[0]
  await must(
    rest('admin', 'invoices', {
      method: 'POST',
      body: { order_id: order.id, number: `TD-${Date.now().toString(36)}`, invoice_date: lastMonthDay().invoiceDate, net_amount: 100000, gst_amount: 18000 },
      prefer: 'return=minimal',
    }),
  )
}

const gstRow = (page: Page) => page.locator('li[data-rule="gst_fbr"]')

test.beforeAll(async () => {
  await putDays(15, 18)
  await clearOverrides()
  await seedUndepositedInvoice()
})
test.afterAll(async () => {
  await putDays(15, 18)
  await clearOverrides()
})

test('admin changes the GST days and the To do deadline moves with them', async ({ page }) => {
  await openAs(page, 'admin', '/todo')
  await showAllTodo(page)
  await expect(gstRow(page)).toContainText('Pay by 15')
  await expect(gstRow(page)).toContainText('return by 18')

  await page.goto('/settings/tax-deadlines')
  await expect(page.getByRole('heading', { level: 1, name: 'Tax deadlines' })).toBeVisible()
  await page.getByLabel(/Pay GST to FBR by day/).fill('22')
  await page.getByLabel(/File the return by day/).fill('26')
  await page.getByRole('button', { name: 'Save days' }).click()
  await expect.poll(async () => (await must(rest<{ pay_day: number; return_day: number }[]>('admin', 'gst_deadline_settings?select=pay_day,return_day')))[0]).toEqual({ pay_day: 22, return_day: 26 })

  await page.goto('/todo')
  await showAllTodo(page)
  await expect(gstRow(page)).toContainText('Pay by 22')
  await expect(gstRow(page)).toContainText('return by 26')

  // the GST to FBR page reads the same days
  await page.goto('/money/accounts/gst')
  await expect(page.getByTestId('gst-pay-day')).toHaveText('22nd')
  await expect(page.getByTestId('gst-return-day')).toHaveText('26th')
})

test('admin gives one month a one-off date, and takes it away again', async ({ page }) => {
  const { monthStart } = lastMonthDay()
  const [y, m] = karachiDay().split('-').map(Number)
  const moved = new Date(Date.UTC(y, m - 1, 28)).toISOString().slice(0, 10)
  await openAs(page, 'admin', '/settings/tax-deadlines')
  await expect(page.getByTestId('no-overrides')).toBeVisible()
  await page.getByRole('combobox', { name: 'GST for the month of' }).selectOption(monthStart)
  const pay = page.getByRole('textbox', { name: 'New pay-by date' })
  await pay.fill(slash(moved))
  await pay.press('Enter')
  await page.getByRole('button', { name: 'Save one-off date' }).click()
  await expect.poll(async () => (await must(rest<{ month: string; pay_by: string | null; return_by: string | null }[]>('admin', 'gst_deadline_overrides?select=month,pay_by,return_by')))[0]).toEqual({ month: monthStart, pay_by: moved, return_by: null })
  await expect(page.getByTestId('overrides')).toContainText('Pay by')

  await page.goto('/todo')
  await showAllTodo(page)
  await expect(gstRow(page)).toContainText('Pay by 28')
  await expect(gstRow(page)).toContainText('return by 26') // the empty date keeps the usual day

  await page.goto('/settings/tax-deadlines')
  await page.getByRole('button', { name: /Remove the one-off date/ }).click()
  await expect.poll(async () => (await must(rest<unknown[]>('admin', 'gst_deadline_overrides?select=month'))).length).toBe(0)
})

test('sales can read the days and cannot change them', async ({ page }) => {
  await openAs(page, 'sales', '/settings/tax-deadlines')
  await expect(page.getByRole('heading', { level: 1, name: 'Tax deadlines' })).toBeVisible()
  await expect(page.getByTestId('read-pay-day')).toContainText('22nd of the following month')
  await expect(page.getByRole('button', { name: 'Save days' })).toHaveCount(0)
  const refused = await rest('sales', 'gst_deadline_settings?id=eq.1', { method: 'PATCH', body: { pay_day: 1 }, prefer: 'return=representation' })
  expect(refused.status < 300 ? refused.body : []).toEqual([])
  expect((await must(rest<{ pay_day: number }[]>('admin', 'gst_deadline_settings?select=pay_day')))[0].pay_day).toBe(22)
})

test('an engineer sees nothing GST', async ({ page }) => {
  await openAs(page, 'engineer', '/settings/tax-deadlines')
  await expect(page.locator('#main')).toContainText('Tax deadlines is for')
  await expect(page.getByLabel(/Pay GST to FBR by day/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Tax deadlines' })).toHaveCount(0)
  await page.goto('/todo')
  await showAllTodo(page)
  await expect(gstRow(page)).toHaveCount(0)
  const settings = await rest<unknown[]>('engineer', 'gst_deadline_settings?select=pay_day')
  expect(settings.status < 300 ? settings.body : []).toEqual([])
  const overrides = await rest<unknown[]>('engineer', 'gst_deadline_overrides?select=month')
  expect(overrides.status < 300 ? overrides.body : []).toEqual([])
})
