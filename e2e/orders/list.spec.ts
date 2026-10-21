import { test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { expect, get, shot } from './fixtures'

/*
 * O04 end to end: the orders list, with one plain "Next step" per row (UX audit 2026-10-19) and the state filters behind one Filters button. Each test makes its own customer with a unique name and
 * scopes the list to it with the search box (the address carries q=), because other suites' orders are in the same database.
 */

const violations = (page: Page) => axeViolations(page)

interface ListSeed {
  tag: string
  company: { id: string; name: string }
  /** a: goods to place, commissioning planned, assigned to the fixture engineer. b: goods late. c: delivered. d: cancelled. */
  orders: Record<'a' | 'b' | 'c' | 'd', { id: string; number: number; po: string }>
  engineerName: string
  supplierName: string
}

async function seedList(): Promise<ListSeed> {
  const tag = Math.random().toString(36).slice(2, 7)
  const company = await createCompany(uniqueName(`Listco${tag}`))
  const supplier = await createCompany(uniqueName('Supplier'))
  const engineer = (await get<{ id: string; name: string }>('users?role=eq.engineer&deactivated_at=is.null&select=id,name&order=created_at&limit=1'))[0]
  const make = async (key: string, extra: Record<string, unknown>, leg: Record<string, unknown> | null) => {
    const po = `PO-${tag}-${key}`
    const o = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, customer_po_number: po, ordered_on: karachiDay(-5), ...extra } })))[0]
    let legId: string | null = null
    if (leg) legId = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: o.id, supplier_id: supplier.id, currency: 'USD', ...leg } })))[0].id
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: o.id, position: 0, description: `Line ${key} ${tag}`, qty: 1, unit_price_net: 1000, supplier_order_id: legId }, prefer: 'return=minimal' }))
    return { id: o.id, number: o.number, po }
  }
  const a = await make('A', { needs_commissioning: true, commissioning_planned_on: karachiDay(10) }, {})
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: a.id, user_id: engineer.id }, prefer: 'return=minimal' }))
  const b = await make('B', {}, { placed_on: karachiDay(-10), expected_on: karachiDay(-2) })
  const c = await make('C', {}, { placed_on: karachiDay(-10), expected_on: karachiDay(-4), received_on: karachiDay(-3), delivered_on: karachiDay(-3) })
  const d = await make('D', { cancelled_on: karachiDay(-1), cancel_reason: 'customer_cancelled' }, {})
  return { tag, company, orders: { a, b, c, d }, engineerName: engineer.name, supplierName: supplier.name }
}

const row = (page: Page, o: { number: number }) => page.getByRole('row', { name: new RegExp(`ORD-${String(o.number).padStart(4, '0')}`) })
/** The state filters sit behind one button: open it before choosing one (a small panel on a laptop). */
const openFilters = async (page: Page) => {
  if (!(await page.getByLabel('Goods state').isVisible())) await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByLabel('Goods state')).toBeVisible()
}
const closeFilters = async (page: Page) => {
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Goods state')).toHaveCount(0)
}
const open = (page: Page, role: 'admin' | 'sales' | 'engineer', s: ListSeed, extra = '') => openAs(page, role, `/orders?owner=all&q=${encodeURIComponent(s.tag)}${extra}`)

test.describe('O04: the orders list', () => {
  test('tabs are the lifecycle (no totals: a number beside a tab means needs you); every order says its next step in words, after the customer and what was ordered', async ({ page }) => {
    const s = await seedList()
    await open(page, 'admin', s)
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
    // the tabs carry no totals (consistency spec 2.2); the lede says the active split in words
    await expect(page.getByRole('tab', { name: 'Active' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Cancelled' })).toBeVisible()
    await expect(page.getByText(/^\d+ need you · \d+ waiting$/)).toBeVisible()
    // one plain next step per row instead of four chips
    // the supplier is named, and late goods say by how many days (b was expected 2 days ago)
    await expect(row(page, s.orders.a)).toContainText(`Place the order with ${s.supplierName}`)
    await expect(row(page, s.orders.a)).toContainText(`Line A ${s.tag} ×1`)
    await expect(row(page, s.orders.a)).toContainText(s.orders.a.po)
    await expect(row(page, s.orders.b)).toContainText(`Chase ${s.supplierName}: goods 2 days late`)
    await expect(row(page, s.orders.c)).toContainText('Create the invoice')
    await expect(row(page, s.orders.a).locator('[data-status]')).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Next step' })).toBeVisible()
    await shot(page, 'o04-orders-list-1440')
    await page.getByRole('tab', { name: /^Done/ }).click()
    await expect(page.getByText(/^Nothing matches/)).toBeVisible()
    await expect(row(page, s.orders.a)).toHaveCount(0)
    await page.getByRole('tab', { name: /^Cancelled/ }).click()
    await expect(row(page, s.orders.d)).toBeVisible()
  })

  test('a filter for each dimension behind one Filters button, combined: goods, commissioning, invoicing and payment', async ({ page }) => {
    const s = await seedList()
    await open(page, 'admin', s)
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toBeVisible()
    // the four state filters are not on the toolbar until asked for
    await expect(page.getByLabel('Goods state')).toHaveCount(0)

    await openFilters(page)
    await page.getByLabel('Goods state').selectOption({ label: 'Overdue (1)' })
    await expect(row(page, s.orders.b)).toBeVisible()
    await expect(row(page, s.orders.a)).toHaveCount(0)
    await expect(page).toHaveURL(/goods=late/)

    // combined with commissioning: an order that is late AND planned does not exist
    await page.getByLabel('Commissioning state').selectOption({ label: 'Planned (0)' })
    await expect(page.getByText(/^Nothing matches/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filters · 2 on' })).toBeVisible()
    await closeFilters(page)
    await page.getByRole('button', { name: 'Clear search and filters' }).click()
    // clearing also clears the search, so the list is every order: scope it to this test's customer again
    await page.getByLabel('Search orders').fill(s.tag)
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toBeVisible()

    await openFilters(page)
    await page.getByLabel('Commissioning state').selectOption({ label: 'Planned (1)' })
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toHaveCount(0)
    await page.getByLabel('Invoicing state').selectOption({ label: 'To invoice · nothing invoiced (1)' })
    await page.getByLabel('Payment state').selectOption({ label: 'Awaiting payment · nothing paid (1)' })
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(page).toHaveURL(/commissioning=planned/)
    await expect(page).toHaveURL(/invoicing=not_invoiced/)
    await expect(page).toHaveURL(/payment=unpaid/)
    // the address carries the filters: a reload lands on the same view
    await page.reload()
    await openFilters(page)
    await expect(page.getByLabel('Commissioning state')).toHaveValue('planned')
    await expect(row(page, s.orders.a)).toBeVisible()
  })

  test('search finds an order by number and by customer PO; a row opens the order', async ({ page }) => {
    const s = await seedList()
    await open(page, 'sales', s)
    const search = page.getByLabel('Search orders')
    await search.fill(s.orders.b.po)
    await expect(row(page, s.orders.b)).toBeVisible()
    await expect(row(page, s.orders.a)).toHaveCount(0)
    await search.fill(`ORD-${String(s.orders.a.number).padStart(4, '0')}`)
    await expect(row(page, s.orders.a)).toBeVisible()
    await row(page, s.orders.a).click()
    await expect(page).toHaveURL(new RegExp(`/orders/${s.orders.a.id}$`))
  })

  test('sales start on Mine and can show everyone', async ({ page }) => {
    const s = await seedList()
    await openAs(page, 'sales', `/orders?q=${encodeURIComponent(s.tag)}`)
    // none of these orders belong to the fixture salesperson, so Mine is empty until All is chosen
    await expect(page.getByRole('radio', { name: /^Mine/ })).toBeChecked()
    await expect(page.getByText(/^Nothing matches/)).toBeVisible()
    await page.getByRole('radio', { name: /^All/ }).click()
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(page.getByRole('radio', { name: /^All/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Repeat a past order' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New order' })).toHaveCount(0)
  })

  test('an engineer starts on My jobs, sees no money column and makes no money request', async ({ page }) => {
    const s = await seedList()
    const urls: string[] = []
    page.on('request', r => {
      if (r.url().includes('/rest/v1/')) urls.push(decodeURIComponent(r.url()))
    })
    await openAs(page, 'engineer', `/orders?q=${encodeURIComponent(s.tag)}`)
    // My jobs: only the order the engineer is assigned to
    await expect(page.getByRole('radio', { name: /^My jobs/ })).toBeChecked()
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toHaveCount(0)
    await page.getByRole('radio', { name: /^All/ }).click()
    await expect(row(page, s.orders.b)).toBeVisible()
    await page.waitForLoadState('networkidle')
    const text = await page.locator('#main').innerText()
    expect(text).not.toMatch(/Invoic|Payment|Gross|Value|PKR|Unpaid|Not invoiced|Repeat a past order|New order/)
    // the engineer's next steps are about goods and commissioning only
    await expect(row(page, s.orders.b)).toContainText(`Chase ${s.supplierName}: goods 2 days late`)
    for (const h of ['Invoicing', 'Payment', 'Gross', 'Value']) await expect(page.getByRole('columnheader', { name: new RegExp(h) })).toHaveCount(0)
    await openFilters(page)
    await expect(page.getByLabel('Commissioning state')).toBeVisible()
    await expect(page.getByLabel('Invoicing state')).toHaveCount(0)
    await expect(page.getByLabel('Payment state')).toHaveCount(0)
    await closeFilters(page)
    await expect(page.getByRole('button', { name: 'Repeat a past order' })).toHaveCount(0)
    expect(urls.filter(u => /order_receivables|v_order_money|invoicing_state|[,=(]gross|payments_in|invoices|expenses/.test(u.replace(/^https?:\/\/[^/]+/, '')))).toEqual([])
    expect(urls.some(u => u.includes('v_order_state'))).toBe(true)
    await shot(page, 'o04-orders-list-engineer-1440')
  })

  test('loading, an empty list and an error say what is true', async ({ page }) => {
    await openAs(page, 'admin', `/orders?owner=all&q=${encodeURIComponent('zzzz-nothing-matches')}`)
    await expect(page.getByText(/^Nothing matches/)).toBeVisible()
    await page.route(/\/rest\/v1\/v_order_state/, route => route.abort())
    await page.reload()
    // the query retries before it gives up
    await expect(page.getByText("Couldn't load the orders")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  for (const width of [1440, 375]) {
    test(`axe (WCAG 2.2 AA) and review screenshots at ${width}`, async ({ page }) => {
      const s = await seedList()
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await open(page, 'admin', s)
      await expect(row(page, s.orders.a)).toBeVisible()
      expect(await violations(page)).toEqual([])
      // nothing scrolls sideways at this width
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      await shot(page, `o04-orders-list-axe-${width}`)
      if (width < 640) {
        // a phone gets one Filter button instead of six controls; the owner switch and the four filters are in its sheet
        await expect(page.getByRole('radio', { name: /^All/ })).toHaveCount(0)
        await page.getByRole('button', { name: /^Filter/ }).click()
        const sheet = page.getByRole('dialog', { name: 'Filter orders' })
        await expect(sheet.getByRole('radio', { name: /^All/ })).toBeVisible()
        await expect(sheet.getByLabel('Goods state')).toBeVisible()
        expect(await axeViolations(page, { landmarks: false })).toEqual([])
        await shot(page, 'o04-orders-list-filter-sheet-375')
        await sheet.getByRole('button', { name: /^Show \d+ orders?$/ }).click()
        await expect(sheet).toHaveCount(0)
      }
    })
  }
})
