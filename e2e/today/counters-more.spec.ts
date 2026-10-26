import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { dueRows, showAllTodo } from '../support/todo'
import { db } from '../verify/support/db'

/*
 * Counters agree (VERIFY pass, redesign phases 0 to 5), against the real stack, fictional data:
 *   1. The Team view says, for a person, exactly what that person's own To do says (late, and late plus due today).
 *   2. Jobs and To do agree: a live supplier order that is late is red on the Jobs list and a due row on To do; the same order
 *      imported from the old CRM is a live job (not history) but raises no task: grey on Jobs, in the grey fold on To do.
 * (The badge = the rows, no "N days overdue" over 30, and an imported late payment waiting in its fold are in counters.spec.ts and
 * no-false-overdue.spec.ts; the Money red dot's rule is a unit test, src/app/oldAddresses.test.tsx.)
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'

async function ownList(page: Page) {
  await page.goto('/todo')
  await showAllTodo(page)
  const due = await dueRows(page).evaluateAll(ls => ls.map(l => l.getAttribute('data-due') ?? ''))
  return { late: due.filter(d => d === 'late').length, total: due.length, header: Number(await page.locator('[data-needs-you-count]').innerText()) }
}

test('Team shows a person exactly what their own To do shows', async ({ browser, page }) => {
  test.setTimeout(240_000)
  for (let i = 0; i < 3; i++) await createRfq((await createCompany(uniqueName('Team Agree'))).id, { owner_id: SALES, received_on: karachiDay(-4 - i) })

  const ctx = await browser.newContext()
  const sales = await ctx.newPage()
  await openAs(sales, 'sales', '/todo')
  await openAs(page, 'admin', '/todo')

  await expect(async () => {
    const mine = await ownList(sales)
    expect(mine.total, 'precondition: sales has work due').toBeGreaterThan(0)
    await page.goto('/todo?view=team')
    await page.locator('[data-team]').waitFor()
    const person = page.locator(`[data-person="${SALES}"]`)
    await expect(person).toBeVisible()
    const late = Number(await person.locator('[data-late]').getAttribute('data-late'))
    const words = await person.locator('[data-late]').innerText()
    const dueToday = Number(/(\d+) due today/.exec(await person.innerText())?.[1] ?? 0)
    expect(late, `Team late count for the salesperson ("${words}") vs their own To do`).toBe(mine.late)
    expect(late + dueToday, 'Team late + due today vs the number on their own To do').toBe(mine.header)
    expect(mine.total, 'their own To do: rows due vs its header').toBe(mine.header)
  }).toPass({ timeout: 90_000 })
  await ctx.close()
})

async function lateGoods(imported: boolean) {
  const customer = uniqueName(imported ? 'JT Imported Customer' : 'JT Live Customer')
  const co = await createCompany(customer)
  const supplier = uniqueName(imported ? 'JT Imported Supplier' : 'JT Live Supplier')
  const sup = await createCompany(supplier)
  const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: SALES, ordered_on: karachiDay(-20) } })))[0]
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: sup.id, placed_on: karachiDay(-15), expected_on: karachiDay(-6) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Level switch', qty: 1, unit_price_net: 1000, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  if (imported) await db.patch(`orders?id=eq.${order.id}`, { legacy_source: { imported: true, table: 'orders' } })
  return { customer, supplier, key: `O-${order.number}` }
}

test('Jobs and To do agree: a live late order is red in both; an imported one is a grey, task-free job', async ({ page }) => {
  test.setTimeout(240_000)
  const live = await lateGoods(false)
  const old = await lateGoods(true)
  await openAs(page, 'sales', '/todo')
  await showAllTodo(page)

  // To do: the live one is a due row, the imported one only waits in the grey fold
  await expect(page.locator('section[data-block="late"], section[data-block="today"]').locator('li[data-rule="goods_late"]').filter({ hasText: live.supplier })).toBeVisible()
  await expect(dueRows(page).filter({ hasText: old.supplier })).toHaveCount(0)

  // Jobs: both are open jobs, the live one says the goods are late (red), the imported one does not raise it
  await page.goto('/jobs?chip=open')
  await page.getByLabel('Search jobs').fill(live.customer)
  const liveRow = page.getByRole('row', { name: new RegExp(`Job ${live.key}\\b`) }).first()
  await expect(liveRow).toBeVisible()
  await expect(liveRow.locator('[data-tone="late"]')).toContainText('The goods are late')
  await page.getByLabel('Search jobs').fill(old.customer)
  const oldRow = page.getByRole('row', { name: new RegExp(`Job ${old.key}\\b`) }).first()
  await expect(oldRow).toBeVisible()
  await expect(oldRow.locator('[data-tone="late"]'), 'an imported job raises no red task').toHaveCount(0)
  await expect(oldRow).toContainText(/Imported/)
})
