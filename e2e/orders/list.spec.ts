import { test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { expect, get, shot } from './fixtures'

/*
 * O04 end to end: the orders list with a filter for each state dimension. Each test makes its own customer with a unique name and
 * scopes the list to it with the search box (the address carries q=), because other suites' orders are in the same database.
 */

const violations = (page: Page) => axeViolations(page)

interface ListSeed {
  tag: string
  company: { id: string; name: string }
  /** a: goods to place, commissioning planned, assigned to the fixture engineer. b: goods late. c: delivered. d: cancelled. */
  orders: Record<'a' | 'b' | 'c' | 'd', { id: string; number: number; po: string }>
  engineerName: string
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
  return { tag, company, orders: { a, b, c, d }, engineerName: engineer.name }
}

const row = (page: Page, o: { number: number }) => page.getByRole('row', { name: new RegExp(`ORD-${String(o.number).padStart(4, '0')}`) })
const open = (page: Page, role: 'admin' | 'sales' | 'engineer', s: ListSeed, extra = '') => openAs(page, role, `/orders?owner=all&q=${encodeURIComponent(s.tag)}${extra}`)

test.describe('O04: the orders list', () => {
  test('tabs are the lifecycle, with counts; every order shows its state chips', async ({ page }) => {
    const s = await seedList()
    await open(page, 'admin', s)
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Active/ })).toContainText('2')
    await expect(page.getByRole('tab', { name: /^Done/ })).toContainText('1')
    await expect(page.getByRole('tab', { name: /^Cancelled/ })).toContainText('1')
    await expect(row(page, s.orders.a)).toContainText('To place')
    await expect(row(page, s.orders.a)).toContainText('Planned')
    await expect(row(page, s.orders.a)).toContainText('Not invoiced')
    await expect(row(page, s.orders.a)).toContainText('Unpaid')
    await expect(row(page, s.orders.a)).toContainText(s.orders.a.po)
    await expect(row(page, s.orders.b)).toContainText('Late')
    await shot(page, 'o04-orders-list-1440')
    await page.getByRole('tab', { name: /^Done/ }).click()
    await expect(row(page, s.orders.c)).toContainText('Delivered')
    await expect(row(page, s.orders.a)).toHaveCount(0)
    await page.getByRole('tab', { name: /^Cancelled/ }).click()
    await expect(row(page, s.orders.d)).toBeVisible()
  })

  test('a filter for each dimension, combined: goods, commissioning, invoicing and payment', async ({ page }) => {
    const s = await seedList()
    await open(page, 'admin', s)
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toBeVisible()

    await page.getByLabel('Goods state').selectOption({ label: 'Late (1)' })
    await expect(row(page, s.orders.b)).toBeVisible()
    await expect(row(page, s.orders.a)).toHaveCount(0)
    await expect(page).toHaveURL(/goods=late/)

    // combined with commissioning: an order that is late AND planned does not exist
    await page.getByLabel('Commissioning state').selectOption({ label: 'Planned (0)' })
    await expect(page.getByText('No orders match')).toBeVisible()
    await page.getByRole('button', { name: 'Clear the filters' }).click()
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toBeVisible()

    await page.getByLabel('Commissioning state').selectOption({ label: 'Planned (1)' })
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(row(page, s.orders.b)).toHaveCount(0)
    await page.getByLabel('Invoicing state').selectOption({ label: 'Not invoiced (1)' })
    await page.getByLabel('Payment state').selectOption({ label: 'Unpaid (1)' })
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(page).toHaveURL(/commissioning=planned/)
    await expect(page).toHaveURL(/invoicing=not_invoiced/)
    await expect(page).toHaveURL(/payment=unpaid/)
    // the address carries the filters: a reload lands on the same view
    await page.reload()
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
    // none of these orders belong to the fixture salesperson
    await expect(page.getByText('None of your orders are in this list')).toBeVisible()
    await page.getByRole('button', { name: /Show everyone/ }).click()
    await expect(row(page, s.orders.a)).toBeVisible()
    await expect(page.getByRole('radio', { name: /^All/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'New order' })).toBeVisible()
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
    expect(text).not.toMatch(/Invoicing|Payment|Gross|PKR|Unpaid|Not invoiced|New order/)
    for (const h of ['Invoicing', 'Payment', 'Gross']) await expect(page.getByRole('columnheader', { name: new RegExp(h) })).toHaveCount(0)
    await expect(page.getByLabel('Invoicing state')).toHaveCount(0)
    await expect(page.getByLabel('Payment state')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New order' })).toHaveCount(0)
    expect(urls.filter(u => /order_receivables|v_order_money|invoicing_state|[,=(]gross|payments_in|invoices|expenses/.test(u.replace(/^https?:\/\/[^/]+/, '')))).toEqual([])
    expect(urls.some(u => u.includes('v_order_state'))).toBe(true)
    await shot(page, 'o04-orders-list-engineer-1440')
  })

  test('loading, an empty list and an error say what is true', async ({ page }) => {
    await openAs(page, 'admin', `/orders?owner=all&q=${encodeURIComponent('zzzz-nothing-matches')}`)
    await expect(page.getByText('No orders match')).toBeVisible()
    await page.route(/\/rest\/v1\/v_order_state/, route => route.abort())
    await page.reload()
    await expect(page.getByText("Couldn't load the orders")).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  for (const width of [1440, 375]) {
    test(`axe (WCAG 2.2 AA) and review screenshots at ${width}`, async ({ page }) => {
      const s = await seedList()
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await open(page, 'admin', s)
      await expect(row(page, s.orders.a)).toBeVisible()
      expect(await violations(page)).toEqual([])
      await shot(page, `o04-orders-list-axe-${width}`)
    })
  }
})
