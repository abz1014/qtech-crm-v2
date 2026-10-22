import { expect, test } from '@playwright/test'
import { as, db, num, rpcAs, USER } from '../support/db'
import { company, karachiDay, monthBefore, monthOf, order, post, setRates } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { BOOKS, COMMON, amount } from '../support/text'

/*
 * The books for one whole month, worked out by hand, then the month closed (its P&L frozen) and reopened.
 *
 * Month-level figures (P&L, checklist, team, GST month) are global, so this file uses a month 20 months back that nothing else in
 * the suite touches, and it is the earliest month with money in it (so it is the oldest open month, the one the close button names).
 *
 *   Order A (sales owns it): 1 x 100,000 at 18% (GST 18,000) and 1 x 50,000 exempt; items net 150,000, gross 168,000.
 *     Invoice A1, day 5:  net 100,000, GST 18,000, gross 118,000 (the 18% line only).
 *     Payment P1, day 15: 59,000 by bank. Net share = round(59,000 x 100,000 / 118,000, 2) = 50,000.00; GST 9,000.00.
 *   Order B (admin owns it): 1 x 20,000 at 18%.
 *     Invoice B1, day 8:  net 20,000, GST 3,600, gross 23,600.
 *     Payment P2, day 25: 23,600 in cash. Net 20,000; GST 3,600.
 *   Expenses:
 *     E1 Rent (overhead), day 3, bank: 12,345.67
 *     E2 Supplier payment (order cost) on order A, day 10, bank: 23,600 with input tax 3,600 -> cost 20,000
 *     E3 Owner drawings (not in the P&L), day 28, bank: 7,000
 *
 *   P&L:  net in 70,000; GST in 12,600; order costs 20,000; overheads 12,345.67; result 37,654.33;
 *         not in P&L 7,000; after drawings 30,654.33; money out 42,945.67; input tax 3,600; gross received 82,600.
 *   Team: Test Sales 50,000 (1 payment); Test Admin 20,000 (1 payment).
 *   GST month: 2 invoices, net 120,000, output GST 21,600; input tax 3,600 (by payment month); nothing deposited.
 *   Checklist: bank items not ticked 4 (P1, E1, E2, E3; P2 is cash); FBR pending 2 (A1, B1); uncategorised 0.
 *   Aging at the month's last day: A1 has 59,000 left (118,000 - 59,000 applied), 0-30 days; B1 is paid.
 *
 * After the close, invoice A2 (the exempt line: net 50,000, GST 0) is made TODAY. That changes order A's net share of every payment:
 * P1 becomes round(59,000 x 150,000 / 168,000, 2) = 52,678.57. The closed month must not move (DECISIONS 2026-10-19 (2), D-MR2):
 * its P&L stays at net in 70,000 and is marked frozen, the live books say 72,678.57, and the difference (2,678.57) is shown in the
 * first open month after it. Reopening drops the snapshot, so the month then reads its live 72,678.57.
 */
const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const DRAWINGS = 'ca7e0000-0000-4000-8000-000000000016'

const M = monthBefore(karachiDay(0), 20)
const NEXT = monthBefore(karachiDay(0), 19)

interface Pnl {
  net_in: number
  gst_in: number
  order_costs: number
  overheads: number
  result: number
  non_pnl_out: number
  after_drawings: number
  cash_out_total: number
  input_tax: number
  frozen: boolean
  adj_net_in: number
}
const pnlOf = async (month: string) => (await db.view<Pnl>(`v_month_pnl?month=eq.${month}&select=*`))[0]
const live = async (month: string) => (await db.view<Pnl>(`v_month_pnl_live?month=eq.${month}&select=*`))[0]
const figures = (p: Pnl) => [p.net_in, p.gst_in, p.order_costs, p.overheads, p.result, p.non_pnl_out, p.after_drawings, p.cash_out_total, p.input_tax].map(num)

async function reopenIfClosed(month: string): Promise<void> {
  const closed = await db.rows<{ month: string }>(`closed_months?month=eq.${month}&select=month`)
  if (closed.length) await rpcAs('admin', 'reopen_month', { p_month: month, p_note: 'verify-books: leave the books open' })
}

test('one month of books by hand: P&L, team, GST month, checklist and aging; then closed (frozen) and reopened (live)', async ({ browser }, info) => {
  // Nothing else may sit before this month, or the close button would name that older month instead (one month at a time).
  const earlier = await db.rows(`payments_in?received_on=lt.${M.start}&select=id`)
  expect(earlier, 'no payment is dated before the isolated month').toHaveLength(0)

  const tag = Math.random().toString(36).slice(2, 7)
  const a = await order({
    lines: [
      { description: `Rosemount 3051 transmitter ${tag}`, qty: 1, price: 100000 },
      { description: `Installation supervision ${tag} (exempt)`, qty: 1, price: 50000, gst: 0, service: true },
    ],
    owner: 'sales',
    orderedOn: M.day(2),
  })
  const b = await order({ lines: [{ description: `Bourdon gauge set ${tag}`, qty: 1, price: 20000 }], owner: 'admin', orderedOn: M.day(2) })
  const a1 = await post<{ id: string; number: string }>('invoices', { order_id: a.order.id, company_id: a.customer.id, number: `VB-${tag}-A1`, invoice_date: M.day(5), net_amount: 100000, gst_amount: 18000 })
  await post('invoices', { order_id: b.order.id, company_id: b.customer.id, number: `VB-${tag}-B1`, invoice_date: M.day(8), net_amount: 20000, gst_amount: 3600 })
  const p1 = await post('payments_in', { order_id: a.order.id, amount: 59000, received_on: M.day(15), paid_via: 'bank' })
  await post('payments_in', { order_id: b.order.id, amount: 23600, received_on: M.day(25), paid_via: 'cash' })
  await post('expenses', { paid_on: M.day(3), paid_via: 'bank', category_id: RENT, amount_pkr: 12345.67, description: `Office rent ${tag}` })
  await post('expenses', { paid_on: M.day(10), paid_via: 'bank', category_id: SUPPLIER_PAYMENT, amount_pkr: 23600, input_tax_pkr: 3600, order_id: a.order.id, description: `Supplier ${tag}` })
  await post('expenses', { paid_on: M.day(28), paid_via: 'bank', category_id: DRAWINGS, amount_pkr: 7000, description: `Drawings ${tag}` })

  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, BOOKS.monthEnd.pnl(M.key))

  try {
    await test.step('the P&L, as the database and the screen give it', async () => {
      const p = await pnlOf(M.start)
      expect(figures(p)).toEqual([70000, 12600, 20000, 12345.67, 37654.33, 7000, 30654.33, 42945.67, 3600])
      expect(p.frozen).toBe(false)
      const sum = page.getByRole('region', { name: BOOKS.pnl.sumBar }).first()
      await expect(sum).toContainText(amount(70000))
      // round 3: two tiles (Received after GST, Profit) plus After drawings when drawn; the 12,600 GST is a line of the statement
      await expect(page.getByRole('row', { name: /less GST inside the payments/ })).toContainText(amount(12600))
      await expect(sum).toContainText(amount(37654)) // headline figures are whole rupees
      await expect(sum).toContainText(amount(30654))
      await expect(page.getByTestId('pnl-frozen')).toHaveCount(0)
    })

    await test.step('team, GST month, expenses by category and aging', async () => {
      const team = await db.view<{ user_id: string; net_credited: number; payment_count: number }>(`v_month_team?month=eq.${M.start}&select=user_id,net_credited,payment_count`)
      const byUser = Object.fromEntries(team.map(t => [t.user_id, [num(t.net_credited), t.payment_count]]))
      expect(byUser).toEqual({ [USER.sales]: [50000, 1], [USER.admin]: [20000, 1] })
      const [g] = await db.view<{ invoice_count: number; net: number; gst: number; input_tax: number; deposited_amount: number }>(`v_gst_month?month=eq.${M.start}&select=*`)
      expect([g.invoice_count, num(g.net), num(g.gst), num(g.input_tax), num(g.deposited_amount ?? 0)]).toEqual([2, 120000, 21600, 3600, 0])
      const cats = await db.view<{ category_id: string; gross_paid: number; net_cost: number; expense_count: number }>(`v_month_expense_category?month=eq.${M.start}&select=category_id,gross_paid,net_cost,expense_count`)
      const byCat = Object.fromEntries(cats.map(c => [c.category_id, [num(c.gross_paid), num(c.net_cost), c.expense_count]]))
      expect(byCat).toEqual({ [RENT]: [12345.67, 12345.67, 1], [SUPPLIER_PAYMENT]: [23600, 20000, 1], [DRAWINGS]: [7000, 7000, 1] })
      const aging = await db.adminRpc<{ invoice_id: string; gross: number; applied: number; remaining: number; bucket: string }[]>('aging_as_of', { p_date: M.end })
      const mine = aging.filter(r => r.invoice_id === a1.id)
      expect(mine.map(r => [num(r.gross), num(r.applied), num(r.remaining), r.bucket])).toEqual([[118000, 59000, 59000, '0-30']])
      // On screen: the team report lists both people with their net, and aging lists A1 with what is left.
      await page.goto(BOOKS.monthEnd.team(M.key))
      await expect(page.locator('#main')).toContainText(amount(50000))
      await expect(page.locator('#main')).toContainText(amount(20000))
      await page.goto(BOOKS.monthEnd.aging(M.key, M.end))
      await expect(page.getByRole('row', { name: new RegExp(a.customer.name) })).toContainText(amount(59000))
    })

    await test.step('the checklist counts', async () => {
      const status = Object.fromEntries((await db.adminRpc<{ check_key: string; n: number }[]>('month_end_status', { p_month: M.start })).map(s => [s.check_key, s.n]))
      expect(status).toMatchObject({ bank_unticked: 4, fbr_pending: 2, uncategorised: 0, fbr_deposits_unticked: 0, unresolved_payments: 0 })
      await page.goto(BOOKS.monthEnd.checklist(M.key))
      await expect(page.getByTestId('check-bank_unticked').getByText('4', { exact: true }).first()).toBeVisible()
      await expect(page.getByTestId('check-fbr_pending').getByText('2', { exact: true }).first()).toBeVisible()
      // A clear check has no row of its own; it is named on the one "checks are clear" line.
      await expect(page.getByTestId('check-uncategorised')).toHaveCount(0)
      await expect(page.getByTestId('checks-clear')).toContainText(BOOKS.monthEnd.uncategorisedLabel)
    })

    await test.step('close the month: a snapshot is taken and the lock refuses an edit dated in it', async () => {
      await page.getByRole('button', { name: BOOKS.monthEnd.closeButton(M.name) }).click()
      const dialog = page.getByRole('dialog', { name: BOOKS.monthEnd.closeDialog(M.label) })
      await dialog.getByRole('button', { name: BOOKS.monthEnd.closeButton(M.name) }).click()
      await expect(page.getByTestId('lock-bar')).toContainText(BOOKS.monthEnd.closedBar(M.label))
      expect((await db.rows(`closed_months?month=eq.${M.start}&select=month`)).length).toBe(1)
      expect((await db.rows(`closed_months?month=lt.${M.start}&select=month`)).length, 'nothing earlier was closed').toBe(0)
      const snap = await db.rows<{ pnl: Record<string, number> }>(`month_snapshots?month=eq.${M.start}&select=pnl`)
      expect(snap).toHaveLength(1)
      expect(num(snap[0].pnl.net_in)).toBe(70000)
      // The lock, as the admin: changing a payment of the month, or adding an expense dated in it, is refused with the sentence.
      const edit = await as<{ code: string; message: string }>('admin', `payments_in?id=eq.${p1.id}`, { method: 'PATCH', body: { amount: 60000 } })
      expect(edit.body).toMatchObject({ code: 'P0001', message: COMMON.closedMonth(M.label) })
      const add = await as<{ code: string; message: string }>('admin', 'expenses', { method: 'POST', body: { paid_on: M.day(20), paid_via: 'cash', category_id: RENT, amount_pkr: 10 } })
      expect(add.body).toMatchObject({ code: 'P0001', message: COMMON.closedMonth(M.label) })
      expect(num((await db.one<{ amount: number }>(`payments_in?id=eq.${p1.id}&select=amount`)).amount)).toBe(59000)
    })

    await test.step('a change made after the close moves the live books but not the closed month', async () => {
      // A2: the exempt line invoiced today, in an open month.
      await post('invoices', { order_id: a.order.id, company_id: a.customer.id, number: `VB-${tag}-A2`, invoice_date: karachiDay(0), net_amount: 50000, gst_amount: 0 })
      const l = await live(M.start)
      expect(num(l.net_in)).toBe(72678.57) // 52,678.57 + 20,000
      const p = await pnlOf(M.start)
      expect(p.frozen).toBe(true)
      expect(figures(p)).toEqual([70000, 12600, 20000, 12345.67, 37654.33, 7000, 30654.33, 42945.67, 3600])
      const next = await pnlOf(NEXT.start)
      expect(num(next.adj_net_in), 'the change to the closed month is carried by the first open month after it').toBe(2678.57)
      await page.goto(BOOKS.monthEnd.pnl(M.key))
      await expect(page.getByTestId('pnl-frozen')).toBeVisible()
      const sum = page.getByRole('region', { name: BOOKS.pnl.sumBar }).first()
      await expect(sum).toContainText(amount(70000))
      await expect(sum).toContainText(amount(37654)) // headline figures are whole rupees
      // The checklist of a closed month is the one saved at the close, even after a bank tick changes the live count.
      await db.patch(`payments_in?id=eq.${p1.id}`, { bank_month: M.start })
      const status = Object.fromEntries((await db.adminRpc<{ check_key: string; n: number }[]>('month_end_status', { p_month: M.start })).map(s => [s.check_key, s.n]))
      expect(status.bank_unticked).toBe(4)
    })

    await test.step('reopen: two taps, the snapshot goes, and the month reads its live figures', async () => {
      await page.goto(BOOKS.monthEnd.checklist(M.key))
      await page.getByTestId(`closed-${M.key}`).getByRole('button', { name: BOOKS.monthEnd.reopenButton(M.label) }).click()
      await page.getByRole('dialog', { name: BOOKS.monthEnd.reopenDialog(M.label) }).getByRole('button', { name: BOOKS.monthEnd.reopenConfirm(M.name) }).click()
      await expect(page.getByTestId('lock-bar')).toHaveCount(0)
      expect(await db.rows(`closed_months?month=eq.${M.start}&select=month`)).toHaveLength(0)
      expect(await db.rows(`month_snapshots?month=eq.${M.start}&select=month`)).toHaveLength(0)
      const p = await pnlOf(M.start)
      expect(p.frozen).toBe(false)
      expect(num(p.net_in)).toBe(72678.57)
      // result = 72,678.57 - 20,000 - 12,345.67 = 40,332.90
      expect(num(p.result)).toBe(40332.9)
    })
  } finally {
    await reopenIfClosed(M.start)
    await admin.close()
  }
})

test('the margin of an order: net sale less costs net of input tax, provisional until costs are marked complete, then final', async ({ browser }, info) => {
  // 3 x 45,678.90 = 137,036.70 net (not invoiced: the margin uses the item net).
  // Costs tagged to the order: Supplier payment 59,000 with input tax 9,000 (cost 50,000) and Freight 7,345.67 (cost 7,345.67).
  // Actual cost 57,345.67; margin 137,036.70 - 57,345.67 = 79,691.03.
  const FREIGHT = 'ca7e0000-0000-4000-8000-000000000012'
  const seed = await order({ lines: [{ description: 'Endress+Hauser Micropilot FMR20 radar', qty: 3, price: 45678.9 }], owner: 'sales' })
  await post('expenses', { paid_on: karachiDay(0), paid_via: 'bank', category_id: SUPPLIER_PAYMENT, amount_pkr: 59000, input_tax_pkr: 9000, order_id: seed.order.id, description: 'Supplier advance' })
  await post('expenses', { paid_on: karachiDay(0), paid_via: 'cash', category_id: FREIGHT, amount_pkr: 7345.67, order_id: seed.order.id, description: 'Freight to site' })
  const m = async () => (await db.view<{ net_sale: number; actual_cost: number; margin: number; margin_state: string; costs_state: string }>(`v_order_money?order_id=eq.${seed.order.id}&select=net_sale,actual_cost,margin,margin_state,costs_state`))[0]
  expect(await m().then(r => [num(r.net_sale), num(r.actual_cost), num(r.margin), r.margin_state])).toEqual([137036.7, 57345.67, 79691.03, 'provisional'])

  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, `/orders/${seed.order.id}`)
  const panel = page.getByRole('region', { name: BOOKS.margin.panel })
  await expect(panel).toContainText(amount(79691.03))
  await expect(panel).toContainText(amount(137036.7))
  await expect(panel.getByText(BOOKS.margin.provisionalNoExpected)).toBeVisible()

  await panel.getByRole('button', { name: BOOKS.margin.markComplete }).click()
  await expect(page.getByRole('status').filter({ hasText: BOOKS.margin.markedToast })).toBeVisible()
  await expect(panel.getByText(BOOKS.margin.final)).toBeVisible()
  const costs = await db.one<{ costs_complete_at: string | null; costs_complete_by: string | null }>(`order_costs?order_id=eq.${seed.order.id}&select=costs_complete_at,costs_complete_by`)
  expect(costs.costs_complete_at).not.toBeNull()
  expect(costs.costs_complete_by).toBe(USER.admin)
  expect(await m().then(r => [num(r.margin), r.margin_state])).toEqual([79691.03, 'final'])

  // Reopen costs: provisional again, and the stamp is cleared.
  await page.goto(`/orders/${seed.order.id}`)
  await panel.getByRole('button', { name: BOOKS.margin.reopenCosts }).click()
  await expect(panel.getByText(BOOKS.margin.provisionalNoExpected)).toBeVisible()
  expect((await db.one<{ costs_complete_at: string | null }>(`order_costs?order_id=eq.${seed.order.id}&select=costs_complete_at`)).costs_complete_at).toBeNull()
  expect((await m()).margin_state).toBe('provisional')
  await admin.close()
})

test('we owe a supplier: the leg total in USD at the rate, less the supplier payment made from the leg', async ({ browser }, info) => {
  // The leg: 3 x USD 612.35 = 1,837.05 and 2 x USD 98.10 = 196.20; committed USD 2,033.25.
  // At USD 280.25: round(2,033.25 x 280.25, 2) = round(569,818.3125, 2) = 569,818.31 PKR.
  // A supplier payment of 300,000 from the leg (no input tax) leaves 269,818.31 owed: more than 3%, so "owing", part paid.
  const today = karachiDay(0)
  await setRates({ USD: 280.25 })
  const sup = await company('Verify Valve Supplier', { country: 'United States' })
  const seed = await order({
    suppliers: [{ supplier: sup, currency: 'USD' }],
    lines: [
      { description: 'Fisher 667 actuator spare kit', qty: 3, price: 210000, leg: 0, supplierPrice: 612.35 },
      { description: 'Positioner feedback arm', qty: 2, price: 33000, leg: 0, supplierPrice: 98.1 },
    ],
  })
  await db.patch(`supplier_orders?id=eq.${seed.legs[0].id}`, { placed_on: today })

  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, `/orders/${seed.order.id}`)
  await expect(page.getByTestId('leg-A-total')).toContainText(amount(2033.25))
  await expect(page.getByTestId('leg-A')).toContainText(amount(569818))

  // The supplier order's Add expense is "Pay <supplier>" in its menu, named by the supplier (no leg letters on screen since the UX merges).
  await page.getByTestId('leg-A').getByRole('button', { name: BOOKS.owe.moreFor(sup.name) }).click()
  await page.getByRole('menuitem', { name: BOOKS.owe.payFor(sup.name) }).click()
  const d = page.getByRole('dialog', { name: BOOKS.owe.dialog })
  await expect(d.getByRole('combobox', { name: BOOKS.owe.category })).toHaveValue(BOOKS.owe.supplierPayment)
  await d.getByRole('textbox', { name: BOOKS.owe.amount }).fill('300000')
  await d.getByRole('button', { name: BOOKS.owe.save }).click()
  await expect(d).toBeHidden()
  const [e] = await db.rows<{ amount_pkr: number; supplier_order_id: string; payee_id: string; category_id: string; order_id: string }>(`expenses?supplier_order_id=eq.${seed.legs[0].id}&select=*`)
  expect(e).toMatchObject({ supplier_order_id: seed.legs[0].id, payee_id: sup.id, category_id: SUPPLIER_PAYMENT, order_id: seed.order.id })
  expect(num(e.amount_pkr)).toBe(300000)

  const rows = await db.adminRpc<{ supplier_order_id: string; committed: number; fx_rate: number; committed_pkr: number; paid_pkr: number; owed_pkr: number; state: string }[]>('payables_as_of', { p_date: today })
  const leg = rows.find(r => r.supplier_order_id === seed.legs[0].id)
  expect(leg && [num(leg.committed), num(leg.fx_rate), num(leg.committed_pkr), num(leg.paid_pkr), num(leg.owed_pkr), leg.state]).toEqual([2033.25, 280.25, 569818.31, 300000, 269818.31, 'owing'])

  await page.goto(BOOKS.monthEnd.owe(monthOf(today).key))
  const row = page.getByRole('row', { name: new RegExp(sup.name) })
  await expect(row).toContainText(amount(2033.25, { always: true }))
  // round 3: five columns; the PKR value of the commitment is the rate tooltip, not a column
  await expect(row).toContainText(amount(300000))
  await expect(row).toContainText(amount(269818))
  await expect(row).toContainText(BOOKS.owe.partPaid)
  await admin.close()
})
