import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * M04 and M07 end to end, against the local CI stack: the Margin panel on the order page, Money > Margins and Money > Exceptions,
 * as the fixture users through the real login form, with data set up through the REST API as the admin.
 *
 * Asserted: the supplier-price estimate (supplier price x today's rate) and that it never overwrites an expected cost that is
 * set; the Provisional mark until costs are marked complete, then Final; Margins totals only costs-complete orders and labels an
 * order with an unknown price basis; the reconciliation exceptions; and that sales and engineers get no money data, on the
 * network log AND from Row Level Security (every read empty, every write refused). Axe (WCAG 2.2 AA) at 1440 and 375.
 */
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const today = () => karachiDay(0)

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

async function setEurRate(): Promise<void> {
  await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { currency: 'EUR', rate_pkr: 300, as_of: today(), source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
}

interface Seeded {
  id: string
  number: number
  customer: string
  legId: string
}

/** An order for a new customer: two EUR-priced goods lines on one leg and one line with no supplier price. Net sale 13,000. */
async function seedOrder(opts: { flags?: string[]; lines?: { qty: number; net: number; supplierPrice: number | null }[] } = {}): Promise<Seeded> {
  const customer = uniqueName('Margin Customer')
  const co = await createCompany(customer)
  const supplier = await createCompany(uniqueName('Margin Supplier'))
  const order = await post<{ id: string; number: number }>('orders', { company_id: co.id, ...(opts.flags ? { legacy_flags: opts.flags } : {}) })
  const leg = await post('supplier_orders', { order_id: order.id, supplier_id: supplier.id, currency: 'EUR' })
  const lines = opts.lines ?? [
    { qty: 2, net: 5000, supplierPrice: 100 },
    { qty: 1, net: 3000, supplierPrice: null },
  ]
  for (const [i, l] of lines.entries()) {
    await post('order_items', {
      order_id: order.id,
      position: i,
      description: `Margin test item ${i + 1}`,
      qty: l.qty,
      unit_price_net: l.net,
      supplier_order_id: l.supplierPrice === null ? null : leg.id,
      supplier_unit_price: l.supplierPrice,
    })
  }
  return { id: order.id, number: order.number, customer, legId: leg.id }
}

const expense = (orderId: string, amount: number, note = 'test cost') =>
  post('expenses', { order_id: orderId, amount_pkr: amount, category_id: SUPPLIER_PAYMENT, paid_on: today(), description: note })

const ordRef = (n: number) => `ORD-${String(n).padStart(4, '0')}`
const digits = (s: string) => Number(s.replace(/[^0-9.]/g, ''))

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test.describe('Margin panel on the order page (admin)', () => {
  test('the estimate fills an empty expected cost once and never overwrites; costs complete turns the margin final', async ({ page }) => {
    await setEurRate()
    const o = await seedOrder()
    await openAs(page, 'admin', `/orders/${o.id}`)
    const panel = page.getByRole('region', { name: 'Margin' })
    await expect(panel.getByText('Provisional', { exact: true }).first()).toBeVisible()

    // Supplier price x today's rate: 2 x EUR 100 x 300 = PKR 60,000; the line with no supplier price is counted, not guessed.
    const estimate = panel.getByTestId('cost-estimate')
    await expect(estimate).toContainText('Supplier-price estimate: PKR 60,000 at today')
    await expect(estimate).toContainText('excludes freight, duty and service')
    await expect(estimate).toContainText('1 line has no supplier price yet')

    await panel.getByRole('button', { name: 'Use as the expected cost' }).click()
    await expect(panel.getByText('60,000').first()).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Use as the expected cost' })).toHaveCount(0)
    expect(await must(rest<{ expected_cost_pkr: number }[]>('admin', `order_costs?order_id=eq.${o.id}&select=expected_cost_pkr`))).toEqual([{ expected_cost_pkr: 60000 }])

    // A typed value stands, and the estimate (still shown as information) cannot replace it.
    await panel.getByRole('button', { name: 'Edit the expected cost' }).click()
    await panel.getByRole('textbox', { name: 'Expected cost, PKR' }).fill('55000')
    await panel.getByRole('button', { name: 'Save' }).click()
    await expect(panel.getByText('55,000').first()).toBeVisible()
    expect(await must(rest<{ expected_cost_pkr: number }[]>('admin', `order_costs?order_id=eq.${o.id}&select=expected_cost_pkr`))).toEqual([{ expected_cost_pkr: 55000 }])
    // The conditional fill the button uses matches nothing once a value exists.
    const guarded = await must(rest<unknown[]>('admin', `order_costs?order_id=eq.${o.id}&expected_cost_pkr=is.null`, { method: 'PATCH', body: { expected_cost_pkr: 1 } }))
    expect(guarded).toEqual([])

    // Costs paid out: net sale 13,000 less 10,000 so far = 3,000, still provisional.
    await expense(o.id, 10000)
    await page.reload()
    await expect(panel.getByText('Actual cost, 1 tagged expense')).toBeVisible()
    await expect(panel.locator('[data-margin-state="provisional"]')).toBeVisible()
    await expect(panel.getByTestId('margin-expenses')).toContainText('Supplier payment')
    await expect(panel.getByTestId('margin-expenses')).toContainText('10,000')

    await panel.getByRole('button', { name: 'Mark costs complete' }).click()
    await expect(panel.locator('[data-margin-state="final"]')).toBeVisible()
    await expect(panel.getByText('Complete', { exact: true }).first()).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reopen costs' })).toBeVisible()
    const done = await must(rest<{ costs_complete_at: string | null; costs_complete_by: string | null }[]>('admin', `order_costs?order_id=eq.${o.id}&select=costs_complete_at,costs_complete_by`))
    expect(done[0].costs_complete_at).not.toBeNull()
    expect(done[0].costs_complete_by).not.toBeNull()

    await panel.getByRole('button', { name: 'Reopen costs' }).click()
    await expect(panel.locator('[data-margin-state="provisional"]')).toBeVisible()
    await shot(page, 'm04-order-margin-panel-1440')
  })

  test('an order with an unknown price basis shows no margin and says why', async ({ page }) => {
    const o = await seedOrder({ flags: ['value_basis_unknown'] })
    await expense(o.id, 640000)
    await openAs(page, 'admin', `/orders/${o.id}`)
    const panel = page.getByRole('region', { name: 'Margin' })
    await expect(panel.locator('[data-margin-state="basis_unknown"]')).toBeVisible()
    await expect(panel.getByText('Not calculated')).toBeVisible()
    await expect(panel.getByText('Imported costs of PKR 640,000 are on file.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Mark costs complete' })).toBeDisabled()
  })
})

test.describe('Money > Margins (admin)', () => {
  test('only costs-complete orders are totalled; provisional margins are marked; an unknown basis is labelled and left out', async ({ page }) => {
    const done = await seedOrder({ lines: [{ qty: 1, net: 1000000, supplierPrice: null }] })
    await expense(done.id, 700000)
    await post('order_costs', { order_id: done.id, expected_cost_pkr: 650000, costs_complete_at: new Date().toISOString() })
    const prov = await seedOrder({ lines: [{ qty: 1, net: 500000, supplierPrice: null }] })
    await expense(prov.id, 100000)
    await post('order_costs', { order_id: prov.id, expected_cost_pkr: 300000 })
    const unknown = await seedOrder({ flags: ['value_basis_unknown'], lines: [{ qty: 1, net: 200000, supplierPrice: null }] })
    await expense(unknown.id, 50000)

    await openAs(page, 'admin', '/money/margins')
    await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
    await expect(page.getByText('Whole life of the order')).toBeVisible()

    const rowOf = (o: Seeded) => page.getByRole('listitem').filter({ hasText: o.customer })
    const d = rowOf(done)
    await expect(d).toContainText(ordRef(done.number))
    await expect(d).toContainText('1,000,000')
    await expect(d).toContainText('650,000')
    await expect(d).toContainText('300,000') // margin 1,000,000 - 700,000
    await expect(d).toContainText('Complete')
    const p = rowOf(prov)
    await expect(p).toContainText('Provisional')
    await expect(p.locator('[data-provisional]')).toHaveCount(1) // the dashed underline on the margin
    const u = rowOf(unknown)
    await expect(u).toContainText('Basis unknown')
    await expect(u).not.toContainText('150,000') // no margin is calculated

    // The footer adds up exactly the complete orders (read from the views, so other orders in the database count too).
    const money = await must(rest<{ order_id: string; net_sale: number; margin: number | null; margin_state: string }[]>('admin', 'v_order_money?margin_state=eq.final&select=order_id,net_sale,margin,margin_state'))
    const cancelled = await must(rest<{ id: string }[]>('admin', 'orders?cancelled_on=not.is.null&select=id'))
    const live = money.filter(m => !cancelled.some(c => c.id === m.order_id))
    const totals = page.getByTestId('margin-totals')
    await expect(totals).toContainText(`${live.length} ${live.length === 1 ? 'order' : 'orders'}`)
    expect(digits((await totals.innerText()).split('\n').find(l => /^\s*[\d,]+\s*$/.test(l)) ?? '0')).toBe(live.reduce((a, m) => a + Number(m.net_sale), 0))
    await expect(page.getByText(/provisional margins? (is|are) shown so you can see the trend/)).toBeVisible()
    await expect(page.getByText(/unknown price basis (is|are) left out until someone resolves/)).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/%|score|rating/i)
    await shot(page, 'm04-money-margins-1440')
  })
})

test.describe('Money > Exceptions (admin)', () => {
  test('lists what the reconciliation finds, links the order, and exports CSV', async ({ page }) => {
    const o = await seedOrder({ lines: [{ qty: 1, net: 10000, supplierPrice: null }] }) // gross 11,800
    await post('payments_in', { order_id: o.id, amount: 15000, received_on: today() })
    const unknown = await seedOrder({ flags: ['value_basis_unknown'], lines: [{ qty: 1, net: 1000, supplierPrice: null }] })

    await openAs(page, 'admin', '/money/exceptions')
    await expect(page.getByRole('heading', { name: 'Exceptions' })).toBeVisible()
    const list = page.getByRole('list', { name: 'Exceptions' })
    const over = list.getByRole('listitem').filter({ hasText: ordRef(o.number) }).filter({ hasText: 'Payments exceed total' })
    await expect(over).toContainText('Customer payments (15,000) exceed the order')
    await expect(over).toContainText('Critical.')
    await expect(over.getByRole('link', { name: 'View order' })).toHaveAttribute('href', `/orders/${o.id}`)
    const basis = list.getByRole('listitem').filter({ hasText: ordRef(unknown.number) }).filter({ hasText: 'Price basis unknown' })
    await expect(basis).toContainText('left out of margin, GST totals and net cash')
    // Critical items come before warnings.
    const severities = await list.getByRole('listitem').evaluateAll(els => els.map(e => e.getAttribute('data-severity')))
    expect(severities.indexOf('warning')).toBeGreaterThan(severities.lastIndexOf('critical'))

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^Reconciliation_\d{4}-\d{2}-\d{2}\.csv$/)
    await shot(page, 'm07-money-exceptions-1440')
  })
})

test.describe('who sees money', () => {
  test('sales and engineers make no money request and Row Level Security gives them nothing', async ({ browser }) => {
    const o = await seedOrder()
    await expense(o.id, 1234)
    await post('order_costs', { order_id: o.id, expected_cost_pkr: 5000 })
    const MONEY = /\/rest\/v1\/(v_order_money|v_order_basis|order_costs|expenses|payments_in|v_payment_net|v_cash_month)\b/
    for (const role of ['sales', 'engineer'] as const) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const seen: string[] = []
      page.on('request', r => {
        if (MONEY.test(r.url())) seen.push(`${r.method()} ${r.url()}`)
      })
      await openAs(page, role, `/orders/${o.id}`)
      await expect(page.getByRole('heading', { name: ordRef(o.number) }).or(page.getByText(ordRef(o.number)).first())).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('region', { name: 'Margin' })).toHaveCount(0)
      for (const path of ['/money/margins', '/money/exceptions']) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await expect(page.getByRole('heading', { name: 'Order margins' })).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Exceptions' })).toHaveCount(0)
      }
      expect(seen, `${role}: no money table or view is requested`).toEqual([])
      await context.close()

      // The database agrees: every money read is empty and every write is refused, whatever the app does.
      for (const t of ['v_order_money', 'v_order_basis', 'order_costs', 'expenses', 'payments_in', 'v_payment_net', 'v_cash_month']) {
        const r = await rest<unknown[]>(role, `${t}?select=*&limit=5`)
        expect(r.status === 200 ? r.body : [], `${role} reads ${t}`).toEqual([])
      }
      const write = await rest(role, 'order_costs', { method: 'POST', body: { order_id: o.id, expected_cost_pkr: 1 } })
      expect(write.status, `${role} cannot write order_costs`).toBeGreaterThanOrEqual(400)
      const upd = await rest<unknown[]>(role, `order_costs?order_id=eq.${o.id}`, { method: 'PATCH', body: { expected_cost_pkr: 1 } })
      expect(upd.status === 200 ? upd.body : [], `${role} cannot update order_costs`).toEqual([])
    }
    // Nothing was changed by those attempts.
    expect(await must(rest<{ expected_cost_pkr: number }[]>('admin', `order_costs?order_id=eq.${o.id}&select=expected_cost_pkr`))).toEqual([{ expected_cost_pkr: 5000 }])
  })
})

for (const width of [1440, 375]) {
  test.describe(`axe at ${width}`, () => {
    test('the Margin panel, Money > Margins and Money > Exceptions have no violations', async ({ page }) => {
      await setEurRate()
      const o = await seedOrder()
      await expense(o.id, 4000)
      await post('payments_in', { order_id: o.id, amount: 20000, received_on: today() })
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await openAs(page, 'admin', `/orders/${o.id}`)
      await expect(page.getByRole('region', { name: 'Margin' })).toBeVisible()
      await expect(page.getByTestId('cost-estimate')).toBeVisible()
      expect(await axeViolations(page), 'order page').toEqual([])
      await shot(page, `m04-order-margin-panel-${width}`)
      await page.goto('/money/margins')
      await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
      expect(await axeViolations(page), 'margins').toEqual([])
      await shot(page, `m04-money-margins-${width}`)
      await page.goto('/money/exceptions')
      await expect(page.getByRole('heading', { name: 'Exceptions' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Exceptions' })).toBeVisible()
      expect(await axeViolations(page), 'exceptions').toEqual([])
      await shot(page, `m07-money-exceptions-${width}`)
    })
  })
}
