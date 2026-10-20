import { expect, test, type BrowserContext } from '@playwright/test'
import { db, num, USER } from '../support/db'
import { invoice, karachiDay, order, payment, ref } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { ORDERS, amount } from '../support/text'

/*
 * The order page, worked by hand: line totals with GST per line, the GST choices a line may take, a service-only job from planning
 * the commissioning to the invoice reminder, and cancelling an order that was already invoiced and part paid.
 */
const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Whether Today, opened fresh in `ctx`, lists `rule` for the order `orderRef`. */
async function todayLists(ctx: BrowserContext, rule: string, orderRef: string): Promise<number> {
  const page = await open(ctx, ORDERS.today.path)
  await expect(page.getByRole('heading', { level: 1, name: ORDERS.today.heading })).toBeVisible()
  await expect(page.getByText(ORDERS.today.loaded).first()).toBeVisible()
  const n = await page.locator(`li[data-rule="${rule}"]`).filter({ hasText: orderRef }).count()
  await page.close()
  return n
}

test('line totals with GST per line, and a line made exempt: the page and the database agree to the paisa', async ({ browser }, info) => {
  // line 1  3   x 1,234.55 = 3,703.65 net; GST 18% 666.657 -> 667; gross 4,370.65
  // line 2  2.5 x 4,817.30 = 12,043.25 net; GST 18% 2,167.785 -> 2,168; gross 14,211.25
  // line 3  1   x 9,999.99 = 9,999.99 net; exempt; gross 9,999.99
  // order   net 25,746.89; GST 2,835; gross 28,581.89
  const seed = await order({
    lines: [
      { description: 'Cerabar PMC51 pressure transmitter', qty: 3, price: 1234.55 },
      { description: 'Promag 10W flow meter DN80', qty: 2.5, price: 4817.3 },
      { description: 'Calibration certificate', qty: 1, price: 9999.99, gst: 0 },
    ],
    owner: 'sales',
  })
  const totals = async () => (await db.view<{ net: number; gst: number; gross: number }>(`v_order_items_total?order_id=eq.${seed.order.id}&select=net,gst,gross`)).map(t => [num(t.net), num(t.gst), num(t.gross)])[0]
  expect(await totals()).toEqual([25746.89, 2835, 28581.89])

  const sales = await signedIn(browser, info, 'sales')
  const page = await open(sales, `/orders/${seed.order.id}`)
  const table = page.getByRole('table', { name: ORDERS.items.table })
  const footer = table.getByRole('row').filter({ hasText: ORDERS.items.footer(3) })
  for (const f of [25746.89, 2835, 28581.89]) await expect(footer).toContainText(amount(f))
  for (const [desc, line] of [
    ['Cerabar PMC51', [3703.65, 667, 4370.65]],
    ['Promag 10W', [12043.25, 2168, 14211.25]],
    ['Calibration certificate', [9999.99, 0, 9999.99]],
  ] as const) {
    const row = table.getByRole('row').filter({ hasText: desc })
    for (const f of line) await expect(row).toContainText(amount(f))
  }

  // Line 2 exempt: GST 667 + 0 + 0 = 667; gross 25,746.89 + 667 = 26,413.89.
  await page.getByLabel(ORDERS.items.gstRate(2)).selectOption('0')
  await expect.poll(totals).toEqual([25746.89, 667, 26413.89])
  await expect(footer).toContainText(amount(26413.89))
  const rates = await db.rows<{ gst_rate: number }>(`order_items?order_id=eq.${seed.order.id}&select=gst_rate&order=position`)
  expect(rates.map(r => num(r.gst_rate))).toEqual([18, 0, 0])
  await sales.close()
})

test('a line offers only the GST rates the owner allows: 18% or exempt', async ({ browser }, info) => {
  test.fail(true, 'BUG-ORD-1: order lines offer 0/5/10/17/18% (src/features/orders/OrderItemsPanel.tsx:31 RATES), against the owner rule 18% or exempt')
  const seed = await order({ lines: [{ description: 'Ball valve 2 inch', qty: 1, price: 15000 }], owner: 'sales' })
  const sales = await signedIn(browser, info, 'sales')
  const page = await open(sales, `/orders/${seed.order.id}`)
  const select = page.getByLabel(ORDERS.items.gstRate(1))
  await expect(select).toBeVisible()
  const offered = await select.locator('option').allInnerTexts()
  // DECISIONS 2026-10-15 (owner, parity audit): "GST stays 18% and Exempt (0%) only". The invoice dialog only knows those two.
  expect(offered.map(o => o.trim())).toEqual([...ORDERS.items.allowedRates])
  await sales.close()
})

test('a service-only job: plan commissioning, the engineer marks it done, then the invoice reminder, then the invoice clears it', async ({ browser }, info) => {
  // One service line: 1 x 135,000.50 net, GST 18% = 24,300.09 -> 24,300; gross 159,300.50.
  const seed = await order({ lines: [{ description: 'Commissioning and loop check, 2 days', qty: 1, price: 135000.5, service: true }], owner: 'sales', needsCommissioning: true })
  const orderRef = ref.order(seed.order.number)
  const state = async () => (await db.view<{ goods_state: string; commissioning_state: string; invoicing_state: string }>(`v_order_state?order_id=eq.${seed.order.id}&select=goods_state,commissioning_state,invoicing_state`))[0]
  expect(await state()).toEqual({ goods_state: 'n_a', commissioning_state: 'to_plan', invoicing_state: 'not_invoiced' })

  const sales = await signedIn(browser, info, 'sales')
  expect(await todayLists(sales, 'plan_commissioning', orderRef), 'Today asks the owner to plan the commissioning').toBe(1)
  expect(await todayLists(sales, 'delivered_not_invoiced', orderRef), 'nothing to invoice before the job is done').toBe(0)

  await test.step('the salesperson plans it for the engineer', async () => {
    const page = await open(sales, `/orders/${seed.order.id}`)
    const section = page.getByRole('region', { name: ORDERS.commissioning.region })
    await section.getByRole('button', { name: ORDERS.commissioning.edit, exact: true }).click()
    const d = page.getByRole('dialog')
    const planned = d.getByRole('textbox', { name: ORDERS.commissioning.plannedOn })
    await planned.fill(slashDate(karachiDay(2)))
    await planned.press('Enter')
    await d.getByRole('combobox', { name: ORDERS.commissioning.assign }).selectOption({ label: 'Test Engineer' })
    await expect.poll(() => db.count(`order_engineers?order_id=eq.${seed.order.id}&user_id=eq.${USER.engineer}&select=user_id`)).toBe(1)
    await d.getByRole('button', { name: ORDERS.commissioning.save }).click()
    await expect.poll(async () => (await db.one<{ commissioning_planned_on: string | null }>(`orders?id=eq.${seed.order.id}&select=commissioning_planned_on`)).commissioning_planned_on).toBe(karachiDay(2))
    expect((await state()).commissioning_state).toBe('planned')
    await page.close()
    expect(await todayLists(sales, 'plan_commissioning', orderRef), 'planned: the reminder goes').toBe(0)
  })

  await test.step('the engineer marks it done in one tap', async () => {
    const eng = await signedIn(browser, info, 'engineer')
    const page = await open(eng, `/orders/${seed.order.id}`)
    await page.getByRole('button', { name: ORDERS.commissioning.markDone }).click()
    await expect.poll(async () => (await db.one<{ commissioning_done_on: string | null }>(`orders?id=eq.${seed.order.id}&select=commissioning_done_on`)).commissioning_done_on).toBe(karachiDay(0))
    expect((await state()).commissioning_state).toBe('done')
    await eng.close()
  })

  await test.step('done and not invoiced: Today says so; the invoice clears it', async () => {
    expect(await todayLists(sales, 'delivered_not_invoiced', orderRef), 'a finished service job is due its invoice').toBe(1)
    const page = await open(sales, `/orders/${seed.order.id}`)
    await page.locator('[data-slot="order-actions"]').getByRole('button', { name: ORDERS.invoice.create }).click()
    const d = page.getByRole('dialog', { name: ORDERS.invoice.dialog })
    await expect(d.getByText(amount(159300.5), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: ORDERS.invoice.create }).click()
    await expect(d).toBeHidden()
    const [inv] = await db.rows<{ net_amount: number; gst_amount: number }>(`invoices?order_id=eq.${seed.order.id}&select=net_amount,gst_amount`)
    expect([num(inv.net_amount), num(inv.gst_amount)]).toEqual([135000.5, 24300])
    expect((await state()).invoicing_state).toBe('fully_invoiced')
    await page.close()
    expect(await todayLists(sales, 'delivered_not_invoiced', orderRef)).toBe(0)
  })
  await sales.close()
})

test('cancel an order that was invoiced and part paid: the balance stays owed, Exceptions flags the payment, reopen restores it', async ({ browser }, info) => {
  // 1 x 40,000.50 at 18%: GST 7,200.09 -> 7,200; gross 47,200.50. Invoiced in full; 10,000 paid; 37,200.50 still owed.
  const seed = await order({ lines: [{ description: 'Gas analyser sample pump', qty: 1, price: 40000.5 }], owner: 'sales' })
  await invoice(seed.order.id, 40000.5, 7200)
  await payment(seed.order.id, 10000)
  const receivable = async () => (await db.adminRpc<{ balance: number; settled: number }[]>('order_receivables', { p_order_id: seed.order.id })).map(r => [num(r.balance), num(r.settled)])

  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, `/orders/${seed.order.id}`)
  await page.getByRole('button', { name: ORDERS.cancel.more }).click()
  await page.getByRole('menuitem', { name: ORDERS.cancel.cancel }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('radio', { name: ORDERS.cancel.reason }).click()
  await d.getByRole('button', { name: ORDERS.cancel.cancel }).click()
  await expect(d).toBeHidden()
  await expect.poll(async () => db.one(`orders?id=eq.${seed.order.id}&select=cancelled_on,cancel_reason`)).toEqual({ cancelled_on: karachiDay(0), cancel_reason: 'customer_cancelled' })

  // D-MR3: a cancelled order with an invoice keeps its real balance; the invoice is not touched.
  expect(await receivable()).toEqual([[37200.5, 10000]])
  const [inv] = await db.rows<{ net_amount: number; gst_amount: number }>(`invoices?order_id=eq.${seed.order.id}&select=net_amount,gst_amount`)
  expect([num(inv.net_amount), num(inv.gst_amount)]).toEqual([40000.5, 7200])
  expect((await db.view<{ lifecycle: string }>(`v_order_state?order_id=eq.${seed.order.id}&select=lifecycle`))[0].lifecycle).toBe('cancelled')

  await page.goto(`/orders/${seed.order.id}`)
  await page.getByRole('button', { name: ORDERS.cancel.more }).click()
  await page.getByRole('menuitem', { name: ORDERS.cancel.reopen }).click()
  await expect.poll(async () => db.one(`orders?id=eq.${seed.order.id}&select=cancelled_on,cancel_reason`)).toEqual({ cancelled_on: null, cancel_reason: null })
  expect((await db.view<{ lifecycle: string }>(`v_order_state?order_id=eq.${seed.order.id}&select=lifecycle`))[0].lifecycle).toBe('active')
  expect(await receivable()).toEqual([[37200.5, 10000]])
  await admin.close()
})
