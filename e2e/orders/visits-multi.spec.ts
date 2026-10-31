import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Several visits per order (migration 0130) and the service report of a visit. End to end against the local CI stack:
 *   - admin adds a survey and then an installation to one order; the order follows the next open visit and is done only when every
 *     visit is done;
 *   - a service report downloads as a PDF;
 *   - an old-style order (a planned date on the order itself, as before 0130) shows that visit in the list;
 *   - an engineer changes only the visits that are theirs, and cannot add one.
 */
test.describe.configure({ mode: 'serial' })

const slash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

async function seedOrder(extra: Record<string, unknown> = {}) {
  const company = await createCompany(uniqueName('Visits Customer'))
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: { company_id: company.id, ordered_on: karachiDay(-6), needs_commissioning: true, payment_terms_days: 30, ...extra },
      }),
    )
  )[0]
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { company, order }
}

interface VisitRow {
  id: string
  visit_type: string
  visit_on: string | null
  engineer_id: string | null
  notes: string | null
  done_on: string | null
}
const visitsOf = (orderId: string) => must(rest<VisitRow[]>('admin', `order_visits?order_id=eq.${orderId}&select=id,visit_type,visit_on,engineer_id,notes,done_on&order=visit_on.asc`))
const summaryOf = async (orderId: string) =>
  (await must(rest<{ commissioning_planned_on: string | null; commissioning_done_on: string | null; visit_type: string | null }[]>('admin', `orders?id=eq.${orderId}&select=commissioning_planned_on,commissioning_done_on,visit_type`)))[0]

test('admin plans a survey and then an installation; the order follows the next open visit and is done when both are', async ({ page }) => {
  const s = await seedOrder()
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  const section = page.getByRole('region', { name: 'Commissioning' })
  await expect(section.getByText('No visits yet.')).toBeVisible()

  const add = async (type: string, day: string, notes: string, engineer?: string) => {
    await section.getByRole('button', { name: 'Add visit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: /Visit type/ }).selectOption(type)
    const date = dialog.getByRole('textbox', { name: 'Date' })
    await date.fill(slash(day))
    await date.press('Enter')
    if (engineer) await dialog.getByRole('combobox', { name: 'Engineer' }).selectOption(engineer)
    await dialog.getByRole('textbox', { name: 'Notes' }).fill(notes)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
  }

  await add('survey', karachiDay(1), 'Look at the cable run', ENGINEER)
  await add('installation', karachiDay(5), 'Bring the long ladder')
  const list = section.getByRole('list', { name: 'Visits on this order' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').first()).toContainText('Survey')
  await expect(list.getByRole('listitem').first()).toContainText('Look at the cable run')
  expect((await visitsOf(s.order.id)).map(v => v.visit_type)).toEqual(['survey', 'installation'])
  expect(await summaryOf(s.order.id)).toMatchObject({ commissioning_planned_on: karachiDay(1), visit_type: 'survey', commissioning_done_on: null })

  // the survey is done: the order is planned for the installation, not done
  await list.getByRole('listitem').filter({ hasText: 'Survey' }).getByRole('button', { name: 'Mark visit done' }).click()
  await expect.poll(async () => (await summaryOf(s.order.id)).commissioning_planned_on).toBe(karachiDay(5))
  expect(await summaryOf(s.order.id)).toMatchObject({ visit_type: 'installation', commissioning_done_on: null })

  // both done: the order is done
  await list.getByRole('listitem').filter({ hasText: 'Installation' }).getByRole('button', { name: 'Mark visit done' }).click()
  await expect.poll(async () => (await summaryOf(s.order.id)).commissioning_done_on).toBe(karachiDay(0))

  // the engineer of the survey is on the order's crew
  const crew = await must(rest<{ user_id: string }[]>('admin', `order_engineers?order_id=eq.${s.order.id}&select=user_id`))
  expect(crew.map(c => c.user_id)).toContain(ENGINEER)
})

test('a visit downloads as a service report PDF', async ({ page }) => {
  const s = await seedOrder()
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: s.order.id, position: 0, description: 'Fixture actuator', qty: 3, unit: 'pcs', unit_price_net: 1500 }, prefer: 'return=minimal' }))
  await must(rest('admin', 'order_visits', { method: 'POST', body: { order_id: s.order.id, visit_type: 'service', visit_on: karachiDay(0), engineer_id: ENGINEER, notes: 'Replaced the actuator.\nChecked the loop.' }, prefer: 'return=minimal' }))
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  const item = page.getByRole('region', { name: 'Commissioning' }).getByRole('list', { name: 'Visits on this order' }).getByRole('listitem')
  const [download] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: 'Service report' }).click()])
  expect(download.suggestedFilename()).toMatch(/^Service-report-ORD-\d{4}-service-\d{4}-\d{2}-\d{2}\.pdf$/)
  const file = await download.path()
  const bytes = await readFile(file)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(3000)
})

test('a visit date set on the order itself, as before, shows as a visit and is not lost', async ({ page }) => {
  const s = await seedOrder({ commissioning_planned_on: karachiDay(3) })
  const rows = await visitsOf(s.order.id)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ visit_type: 'installation', visit_on: karachiDay(3), done_on: null })
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  const section = page.getByRole('region', { name: 'Commissioning' })
  const visits = section.getByRole('list', { name: 'Visits on this order' }).getByRole('listitem')
  await expect(visits).toHaveCount(1)
  await expect(visits).toContainText('Installation')
  // and the old one-tap still works: it marks the next open visit done
  await must(rest('admin', `orders?id=eq.${s.order.id}`, { method: 'PATCH', body: { commissioning_done_on: karachiDay(0) }, prefer: 'return=minimal' }))
  expect((await visitsOf(s.order.id))[0].done_on).toBe(karachiDay(0))
})

test('an engineer changes only their own visits, and cannot add or delete one', async ({ page }) => {
  const s = await seedOrder()
  const [mine, theirs] = await must(
    rest<{ id: string }[]>('admin', 'order_visits', {
      method: 'POST',
      body: [
        { order_id: s.order.id, visit_type: 'installation', visit_on: karachiDay(2), engineer_id: ENGINEER },
        { order_id: s.order.id, visit_type: 'service', visit_on: karachiDay(9), engineer_id: ADMIN },
      ],
    }),
  )
  await openAs(page, 'engineer', `/orders/${s.order.id}`)
  const section = page.getByRole('region', { name: 'Commissioning' })
  await expect(section.getByRole('list', { name: 'Visits on this order' }).getByRole('listitem')).toHaveCount(2)
  await expect(section.getByRole('button', { name: 'Mark visit done' })).toHaveCount(1)
  await expect(section.getByRole('button', { name: 'Add visit' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Service report' })).toHaveCount(2)

  expect((await rest('engineer', `order_visits?id=eq.${mine.id}`, { method: 'PATCH', body: { notes: 'On site' } })).body).toHaveLength(1)
  expect((await rest('engineer', `order_visits?id=eq.${theirs.id}`, { method: 'PATCH', body: { notes: 'Not mine' } })).body).toHaveLength(0)
  expect((await rest('engineer', `order_visits?id=eq.${mine.id}`, { method: 'PATCH', body: { engineer_id: ADMIN } })).status).toBe(403)
  expect((await rest('engineer', 'order_visits', { method: 'POST', body: { order_id: s.order.id } })).status).toBe(403)
  expect((await rest('engineer', `order_visits?id=eq.${mine.id}`, { method: 'DELETE' })).body).toHaveLength(0)
  expect((await visitsOf(s.order.id)).find(v => v.id === theirs.id)?.notes).toBeNull()
})
