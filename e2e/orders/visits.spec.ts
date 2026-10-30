import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { openStage } from '../support/job'
import { showAllTodo } from '../support/todo'

/*
 * Visits (migration 0109; owner answer to Q6, 2026-10-28): a visit is an Installation, a Survey or a Service, on a DATE. There is no
 * time of day. End to end against the local CI stack:
 *   - admin plans a visit and picks its type; leaving the type alone files an installation (the form's default and the database's);
 *   - there is no time field anywhere;
 *   - the engineer assigned to the site sees the type on the job and on To do, can change it, and sees nothing GST.
 */
test.describe.configure({ mode: 'serial' })

const slash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

async function seedOrder() {
  const company = await createCompany(uniqueName('Visit Customer'))
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: { company_id: company.id, ordered_on: karachiDay(-6), needs_commissioning: true, payment_terms_days: 30 },
      }),
    )
  )[0]
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { company, order }
}

const visitOf = async (id: string) => (await must(rest<{ visit_type: string | null; commissioning_planned_on: string | null }[]>('admin', `orders?id=eq.${id}&select=visit_type,commissioning_planned_on`)))[0]

let surveyOrder: Awaited<ReturnType<typeof seedOrder>>

test('admin plans a visit with a type; there is no time of day', async ({ page }) => {
  surveyOrder = await seedOrder()
  await openAs(page, 'admin', `/orders/${surveyOrder.order.id}`)
  await openStage(page, 'Delivery')
  const section = page.getByRole('region', { name: 'Commissioning' })
  await section.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const type = dialog.getByRole('combobox', { name: /Visit type/ })
  await expect(type).toHaveValue('installation') // the obvious default for an order's commissioning
  await expect(dialog.locator('input[type="time"]')).toHaveCount(0)
  await expect(dialog.getByText(/Visit time/i)).toHaveCount(0)
  await type.selectOption('survey')
  const planned = dialog.getByRole('textbox', { name: 'Planned on' })
  await planned.fill(slash(karachiDay(0)))
  await planned.press('Enter')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await visitOf(surveyOrder.order.id)).visit_type).toBe('survey')
  expect((await visitOf(surveyOrder.order.id)).commissioning_planned_on).toBe(karachiDay(0))
  await expect(section.getByTestId('visit-line')).toHaveText('Survey')
})

test('a visit planned without choosing a type is an installation', async ({ page }) => {
  const s = await seedOrder()
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  await openStage(page, 'Delivery')
  const section = page.getByRole('region', { name: 'Commissioning' })
  await section.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const planned = dialog.getByRole('textbox', { name: 'Planned on' })
  await planned.fill(slash(karachiDay(3)))
  await planned.press('Enter')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await visitOf(s.order.id)).visit_type).toBe('installation')
  await expect(section.getByTestId('visit-line')).toHaveText('Installation')
})

test('the database files an installation when a date is set with no type', async () => {
  const s = await seedOrder()
  await must(rest('admin', `orders?id=eq.${s.order.id}`, { method: 'PATCH', body: { commissioning_planned_on: karachiDay(4) }, prefer: 'return=minimal' }))
  expect((await visitOf(s.order.id)).visit_type).toBe('installation')
})

test('the engineer sees the type on the job and on To do, can change it, and sees no GST', async ({ page }) => {
  await openAs(page, 'engineer', `/orders/${surveyOrder.order.id}`)
  await expect(page.getByRole('region', { name: 'On site' })).toBeVisible()
  await expect(page.locator('#main')).not.toContainText(/GST/)

  await page.goto('/todo')
  await showAllTodo(page)
  const row = page.locator('li[data-rule="job_commissioning"]').filter({ hasText: surveyOrder.company.name })
  await expect(row).toContainText('Survey')
  await expect(row).not.toContainText(/\d\d:\d\d/) // no time of day

  await page.goto(`/orders/${surveyOrder.order.id}`)
  await page.getByRole('button', { name: 'Visit type', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('input[type="time"]')).toHaveCount(0)
  await dialog.getByRole('combobox', { name: /Visit type/ }).selectOption('service')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await visitOf(surveyOrder.order.id)).visit_type).toBe('service')

  await page.goto('/settings/tax-deadlines')
  await expect(page.locator('#main')).toContainText('Tax deadlines is for')
})
