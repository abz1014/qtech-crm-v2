import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * Redesign phase 0 ("stop the noise", owner approval 2026-10-22): ONE definition of "needs you" (src/features/today/needsYou.ts),
 * and no two counters on screen disagree. Against the real stack: the Today badge in the top bar, Today's "N need you", the rows in
 * its "Overdue or due today" group, the RFQ board's "N need you" and the Orders list's "N need you" (each the rows of its kind in
 * that group), and no number on RFQs, Orders or Money. An RFQ older than 30 days is listed in the grey fold, not counted.
 * Other suites write to the same database, so each comparison is retried until one consistent reading is seen. Fictional data.
 */
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const RFQ_RULES = ['chase_customer', 'relay_answers', 'not_floated', 'chase_supplier', 'bid_due', 'decision_overdue']
const ORDER_RULES = ['goods_late', 'place_po', 'plan_commissioning', 'to_source', 'job_commissioning', 'job_on_site']

async function seed() {
  const fresh = await createRfq((await createCompany(uniqueName('Counter Fresh'))).id, { owner_id: ADMIN, received_on: karachiDay(0) })
  const old = await createRfq((await createCompany(uniqueName('Counter Old'))).id, { owner_id: ADMIN, received_on: karachiDay(-400) })
  const co = await createCompany(uniqueName('Counter Customer'))
  const sup = await createCompany(uniqueName('Counter Supplier'))
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: ADMIN, ordered_on: karachiDay(-20) } })))[0]
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: sup.id, placed_on: karachiDay(-15), expected_on: karachiDay(-6) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Level switch', qty: 1, unit_price_net: 1000, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  return { fresh: rfqRef(fresh.number), old: rfqRef(old.number) }
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first()
const ledeNeed = async (page: Page): Promise<number> => Number(/(\d+) need you/.exec(await page.locator('#main').innerText())?.[1] ?? 0)

async function todayReading(page: Page) {
  await page.goto('/today')
  const header = page.locator('[data-needs-you-count]')
  await expect(header).toBeVisible()
  // the top-bar numbers load once the page has its data (perf/lcp): give them a moment before reading the badge
  const n = Number(await header.innerText())
  await expect(nav(page).getByRole('link', { name: n > 0 ? new RegExp(`^Today\\s?, ${n} need you$`) : /^Today$/ })).toBeVisible({ timeout: 10_000 }).catch(() => undefined)
  const due = page.getByRole('region', { name: 'Overdue or due today' })
  const rules = (await due.count()) ? await due.locator('li[data-rule]').evaluateAll(ls => ls.map(l => l.getAttribute('data-rule') ?? '')) : []
  const link = (await nav(page).getByRole('link', { name: /^Today/ }).first().textContent()) ?? ''
  return {
    badge: Number(/(\d+)/.exec(link)?.[1] ?? 0),
    header: Number(await header.innerText()),
    rows: rules.length,
    rfqRows: rules.filter(r => RFQ_RULES.includes(r)).length,
    orderRows: rules.filter(r => ORDER_RULES.includes(r)).length,
  }
}

test('no two counters disagree: Today badge = header = rows due now; the board and Orders say their share; no other badge', async ({ page }) => {
  test.setTimeout(180_000)
  const s = await seed()
  await openAs(page, 'admin', '/today')

  await expect(async () => {
    const t = await todayReading(page)
    expect(t.header, 'Today header vs the top-bar badge').toBe(t.badge)
    expect(t.rows, 'rows in "Overdue or due today" vs the header').toBe(t.header)
    // In-app navigation, as a person moves: the pages read the shell's numbers (a reload would draw the lede before they load)
    await nav(page).getByRole('link', { name: /^RFQs/ }).click()
    await expect(page.getByRole('heading', { name: 'RFQs', level: 1 })).toBeVisible()
    await expect(page.getByText(t.rfqRows ? new RegExp(`^\\d+ open · ${t.rfqRows} need you$`) : /^\d+ open$/), 'the RFQ board\'s "need you" vs the RFQ rows due now on Today').toBeVisible({ timeout: 5_000 })
    expect(await ledeNeed(page)).toBe(t.rfqRows)
    await nav(page).getByRole('link', { name: /^Orders/ }).click()
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
    await expect(page.getByText(new RegExp(`^${t.orderRows} need you · \\d+ active$`)), 'the Orders page\'s "need you" vs the order rows due now on Today').toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  // One badge only: RFQs, Orders and Money carry no number
  for (const name of ['RFQs', 'Orders', 'Money']) await expect(nav(page).getByRole('link', { name, exact: true })).toBeVisible()
  await expect(nav(page).locator('[data-needs-count]')).toHaveCount(1)

  // The fresh RFQ is due now; the 400-day-old one is not counted: it waits in the grey fold, its date in words
  await page.goto('/today')
  await expect(page.getByRole('region', { name: 'Overdue or due today' }).locator('li[data-rule="not_floated"]').filter({ hasText: s.fresh })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Overdue or due today' }).locator('li').filter({ hasText: s.old })).toHaveCount(0)
  const fold = page.getByRole('region', { name: 'Older than 30 days' })
  await fold.getByRole('button', { name: /^Older than 30 days/ }).click()
  const old = fold.locator('li[data-stale]').filter({ hasText: s.old })
  await expect(old).toBeVisible()
  await expect(old.getByText(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible()
})
