import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, rfqRef, uniqueName } from '../support/stack'
import { dueRows, showAllTodo } from '../support/todo'

/*
 * Redesign phase 0 ("stop the noise", owner approval 2026-10-22): ONE definition of "needs you" (src/features/todo/needsYou.ts),
 * and no two counters on screen disagree. Against the real stack: the Today badge in the top bar, Today's "N need you", the rows in
 * its Late and Today blocks (and the "N more" fold they spill into), the RFQ board's "N need you" and the Orders list's "N need you" (each the rows of its kind in
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

async function todayReading(page: Page) {
  await page.goto('/todo')
  const header = page.locator('[data-needs-you-count]')
  await expect(header).toBeVisible()
  // the top-bar numbers load once the page has its data (perf/lcp): give them a moment before reading the badge
  const n = Number(await header.innerText())
  await expect(nav(page).getByRole('link', { name: n > 0 ? new RegExp(`^To do\\s?, ${n} need you$`) : /^To do$/ })).toBeVisible({ timeout: 10_000 }).catch(() => undefined)
  // Late + Today wherever they are drawn: To do shows 7 rows at most and folds the rest into "N more" (opened here)
  await showAllTodo(page)
  const rules = await dueRows(page).evaluateAll(ls => ls.map(l => l.getAttribute('data-rule') ?? ''))
  const link = (await nav(page).getByRole('link', { name: /^To do/ }).first().textContent()) ?? ''
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
  await openAs(page, 'admin', '/todo')

  await expect(async () => {
    const t = await todayReading(page)
    expect(t.header, 'Today header vs the top-bar badge').toBe(t.badge)
    expect(t.rows, 'rows in Late + Today vs the header').toBe(t.header)
  }).toPass({ timeout: 90_000 })

  // One badge only: Jobs, Money and Companies carry no number
  for (const name of ['Jobs', 'Money', 'Companies']) await expect(nav(page).getByRole('link', { name, exact: true })).toBeVisible()
  await expect(nav(page).locator('[data-needs-count]')).toHaveCount(1)

  // The fresh RFQ is due now; the 400-day-old one is not counted: it waits in the grey fold, its date in words
  await page.goto('/todo')
  await showAllTodo(page)
  await expect(dueRows(page).filter({ hasText: s.fresh }).and(page.locator('li[data-rule="not_floated"]'))).toBeVisible()
  await expect(dueRows(page).filter({ hasText: s.old })).toHaveCount(0)
  const fold = page.getByRole('region', { name: 'Older than 30 days' })
  await fold.getByRole('button', { name: /^Older than 30 days/ }).click()
  const old = fold.locator('li[data-stale]').filter({ hasText: s.old })
  await expect(old).toBeVisible()
  await expect(old.getByText(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible()
})

test('To do is laid out in colour blocks, at most 7 rows before "N more", and every row has its own button', async ({ page }) => {
  test.setTimeout(180_000)
  await seed()
  await openAs(page, 'admin', '/todo')
  await expect(page.getByRole('heading', { name: 'To do', level: 1 })).toBeVisible()
  await expect(page.locator('[data-needs-you-count]')).toBeVisible()

  // an empty block is not drawn; a drawn one is a colour block with its heading and a number
  for (const block of await page.locator('section[data-block="late"], section[data-block="today"], section[data-block="week"]').all()) {
    expect(await block.locator('li[data-rule]').count(), 'a drawn block has rows').toBeGreaterThan(0)
  }

  // at most 7 rows before the fold (the fold is closed on arrival), and the fold says how many are in it
  const shown = await page.locator('section[data-block="late"] li[data-rule], section[data-block="today"] li[data-rule], section[data-block="week"] li[data-rule]').count()
  expect(shown).toBeLessThanOrEqual(7)
  const more = page.locator('section[data-more-fold]')
  if (await more.count()) await expect(more.getByRole('button')).toHaveText(/^\d+ more( this week)?/)

  // every active row has its own button (words per rule), and the snooze menu offers "Not ours to chase"
  for (const row of await page.locator('section[data-block="late"] li[data-rule], section[data-block="today"] li[data-rule], section[data-block="week"] li[data-rule]').all()) {
    await expect(row.locator('[data-row-actions] button').first()).toBeVisible()
  }
  await page.locator('li[data-rule][data-due]').first().getByRole('button', { name: 'Snooze' }).click()
  await expect(page.getByRole('menuitem', { name: 'Not ours to chase' })).toBeVisible()
  await page.keyboard.press('Escape')

  // the badge, the header and the rows are one number (the counters test above proves it against the other counters)
  await showAllTodo(page)
  expect(await dueRows(page).count()).toBe(Number(await page.locator('[data-needs-you-count]').innerText()))
})
