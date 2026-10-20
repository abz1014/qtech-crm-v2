import { expect, test, type Page } from '@playwright/test'
import { db, num, USER } from '../support/db'
import { invoice, karachiDay, nextInvoiceNumber, order, payment, post, type OrderSeed } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { MONEY, amount, longDate } from '../support/text'
import { readClipboardWhen, resetClipboard } from '../../support/clipboard'

/*
 * Money, end to end: invoices from an order (the numbers from the series, net and GST from the lines), invoicing part and then the
 * balance, payments in (part, the rest, more than owed) and the payment reminder's figures. Every figure is worked out by hand
 * below and checked twice: on the screen, and in the database (service role).
 *
 * The order used by the invoice tests mixes GST rates, has a decimal quantity and non-round prices:
 *   line 1   3   x  1,234.55 = 3,703.65 net, GST 18% = 666.657 -> 667 (whole rupees per line, DATA_MODEL 2.13)
 *   line 2   2.5 x  4,817.30 = 12,043.25 net, GST 18% = 2,167.785 -> 2,168
 *   line 3   1   x  9,999.99 = 9,999.99 net, exempt, GST 0
 *   order    net 25,746.89, GST 2,835, gross 28,581.89
 */
const MIXED = [
  { description: 'Cerabar PMC51 pressure transmitter', qty: 3, price: 1234.55, gst: 18 },
  { description: 'Promag 10W flow meter DN80', qty: 2.5, price: 4817.3, gst: 18 },
  { description: 'Site calibration certificate (exempt)', qty: 1, price: 9999.99, gst: 0 },
]
const NET = 25746.89
const GST = 2835
const GROSS = 28581.89

const orderPage = (page: Page) => page.locator('[data-slot="order-actions"]')
const invoicesOf = (orderId: string) =>
  db.rows<{ id: string; number: string; invoice_date: string; net_amount: number; gst_amount: number; created_by: string }>(`invoices?order_id=eq.${orderId}&select=id,number,invoice_date,net_amount,gst_amount,created_by&order=created_at`)
const stateOf = async (orderId: string) => (await db.view<{ invoicing_state: string; invoiced: number; net: number; gst: number; gross: number }>(`v_order_state?order_id=eq.${orderId}&select=invoicing_state,invoiced,net,gst,gross`))[0]
const receivable = async (orderId: string) =>
  (await db.adminRpc<{ balance: number; settled: number; overpaid_by: number; payment_state: string; gross_target: number }[]>('order_receivables', { p_order_id: orderId }))[0]

test.describe('invoices from an order', () => {
  test('create invoice on a mixed-GST order: next number, net and GST from the lines, due date from the terms, one register row', async ({ browser }, info) => {
    const seed = await order({ lines: MIXED, terms: 45, owner: 'sales' })
    const today = karachiDay(0)
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)

    await test.step('the order and its totals as the database computes them', async () => {
      const s = await stateOf(seed.order.id)
      expect([num(s.net), num(s.gst), num(s.gross)]).toEqual([NET, GST, GROSS])
      expect(s.invoicing_state).toBe('not_invoiced')
    })

    const expected = await nextInvoiceNumber()
    await test.step('the dialog opens with the next number and the amounts of every line', async () => {
      await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
      const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
      await expect(d.getByRole('textbox', { name: MONEY.invoice.number })).toHaveValue(expected)
      await expect(d.getByText(MONEY.invoice.gstMixed)).toBeVisible()
      await expect(d.getByText(amount(NET), { exact: true })).toBeVisible()
      await expect(d.getByText(amount(GST), { exact: true })).toBeVisible()
      await expect(d.getByText(amount(GROSS), { exact: true })).toBeVisible()
      await expect(d.getByText(MONEY.invoice.termsDays(45))).toBeVisible()
      await d.getByRole('button', { name: MONEY.invoice.create }).click()
      await expect(d).toBeHidden()
      await expect(page.getByRole('status').filter({ hasText: MONEY.invoice.created(expected) })).toBeVisible()
    })

    await test.step('the database holds exactly that invoice, and the order reads fully invoiced', async () => {
      const rows = await invoicesOf(seed.order.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ number: expected, invoice_date: today, created_by: USER.admin })
      expect([num(rows[0].net_amount), num(rows[0].gst_amount)]).toEqual([NET, GST])
      expect((await stateOf(seed.order.id)).invoicing_state).toBe('fully_invoiced')
      // The balance is now the invoice's gross, and the order page says so.
      const r = await receivable(seed.order.id)
      expect([num(r.gross_target), num(r.balance), r.payment_state]).toEqual([GROSS, GROSS, 'unpaid'])
      await page.reload()
      await expect(page.getByTestId('order-balance')).toHaveText(amount(GROSS))
    })

    await test.step('the GST register lists it once with the same gross', async () => {
      await page.goto(MONEY.register.path)
      const row = page.getByRole('row', { name: new RegExp(expected) })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(amount(GROSS))
      const reg = await db.view<{ net_amount: number; gst_amount: number; gross_amount: number }>(`v_gst_register?order_id=eq.${seed.order.id}&select=net_amount,gst_amount,gross_amount`)
      expect(reg.map(r => [num(r.net_amount), num(r.gst_amount), num(r.gross_amount)])).toEqual([[NET, GST, GROSS]])
    })
    await admin.close()
  })

  test('part invoice, then the balance: the GST of a mixed order is shared in proportion, and the second invoice is exactly what is left', async ({ browser }, info) => {
    const seed = await order({ lines: MIXED, owner: 'sales' })
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, `/orders/${seed.order.id}`)

    // Part: net 10,000 typed. GST = round(2,835 x 10,000 / 25,746.89) = round(1,101.10) = 1,101; gross 11,101.
    await test.step('the salesperson invoices net 10,000 of it', async () => {
      await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
      const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
      await d.getByRole('button', { name: MONEY.invoice.editAmounts }).click()
      const net = d.getByRole('textbox', { name: MONEY.invoice.net })
      await net.fill('10000')
      await net.blur()
      await expect(d.getByText(amount(1101), { exact: true })).toBeVisible()
      await expect(d.getByText(amount(11101), { exact: true })).toBeVisible()
      await d.getByRole('button', { name: MONEY.invoice.create }).click()
      await expect(d).toBeHidden()
      const rows = await invoicesOf(seed.order.id)
      expect(rows.map(r => [num(r.net_amount), num(r.gst_amount)])).toEqual([[10000, 1101]])
      expect(rows[0].created_by).toBe(USER.sales)
      expect((await stateOf(seed.order.id)).invoicing_state).toBe('part')
    })

    // The rest: net 25,746.89 - 10,000 = 15,746.89; GST 2,835 - 1,101 = 1,734; gross 17,480.89.
    await test.step('the next invoice opens with exactly what is left, and saving it makes the order fully invoiced', async () => {
      await page.reload()
      await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
      const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
      await expect(d.getByText(MONEY.invoice.whatIsLeft)).toBeVisible()
      await expect(d.getByText(amount(15746.89), { exact: true })).toBeVisible()
      await expect(d.getByText(amount(1734), { exact: true })).toBeVisible()
      await expect(d.getByText(amount(17480.89), { exact: true })).toBeVisible()
      await d.getByRole('button', { name: MONEY.invoice.create }).click()
      await expect(d).toBeHidden()
      const rows = await invoicesOf(seed.order.id)
      expect(rows.map(r => [num(r.net_amount), num(r.gst_amount)])).toEqual([
        [10000, 1101],
        [15746.89, 1734],
      ])
      // The two invoices add up to the order to the paisa.
      expect(rows.reduce((s, r) => s + Math.round(num(r.net_amount) * 100), 0)).toBe(Math.round(NET * 100))
      expect(rows.reduce((s, r) => s + num(r.gst_amount), 0)).toBe(GST)
      expect((await stateOf(seed.order.id)).invoicing_state).toBe('fully_invoiced')
    })

    await test.step('a third Create invoice says every line is already invoiced and pre-fills nothing', async () => {
      await page.reload()
      await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
      const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
      await expect(d.getByText(MONEY.invoice.fullyInvoiced)).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await invoicesOf(seed.order.id)).toHaveLength(2)
    })
    await sales.close()
  })

  test('a double click on Create invoice makes one invoice', async ({ browser }, info) => {
    const seed = await order({ lines: [{ description: 'Liquiphant FTL31 level switch', qty: 4, price: 23456.78 }] })
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)
    await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
    const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
    // 4 x 23,456.78 = 93,827.12 net; GST 18% = 16,888.88 -> 16,889; gross 110,716.12
    await expect(d.getByText(amount(110716.12), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: MONEY.invoice.create }).dblclick()
    await expect(d).toBeHidden()
    await expect.poll(async () => (await invoicesOf(seed.order.id)).length, { timeout: 5000 }).toBe(1)
    await page.waitForTimeout(1500) // a second request, if any, has landed by now
    const rows = await invoicesOf(seed.order.id)
    expect(rows.map(r => [num(r.net_amount), num(r.gst_amount)])).toEqual([[93827.12, 16889]])
    await admin.close()
  })
})

test.describe('payments in', () => {
  /*
   * One line, 1 x 84,321.45 net, GST 18% = 15,177.861 -> 15,178; gross 99,499.45. Invoiced in full today, owned by the salesperson.
   *   payment 1   40,000.00          -> settled 40,000.00, balance 59,499.45, part
   *   payment 2   59,499.45 (prefill) -> settled 99,499.45, balance 0, settled
   *   payment 3    5,000.55          -> settled 104,500.00, balance 0, overpaid by 5,000.55
   */
  async function seedInvoiced(): Promise<OrderSeed> {
    const seed = await order({ lines: [{ description: 'Prosonic FMU41 level transmitter', qty: 1, price: 84321.45 }], owner: 'sales' })
    await invoice(seed.order.id, 84321.45, 15178)
    return seed
  }

  test('a part payment, the rest, then more than is owed: balances, states, the credited person and the Exceptions list', async ({ browser }, info) => {
    const seed = await seedInvoiced()
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)
    const dialog = page.getByRole('dialog', { name: MONEY.payment.dialog })
    const amountBox = dialog.getByRole('textbox', { name: MONEY.payment.amount })

    await test.step('part payment of 40,000', async () => {
      await expect(page.getByTestId('order-balance')).toHaveText(amount(99499.45))
      await orderPage(page).getByRole('button', { name: MONEY.order.recordPayment }).click()
      await expect(amountBox).toHaveValue(amount(99499.45))
      await amountBox.fill('40000')
      await expect(dialog.getByTestId('payment-note')).toHaveText(MONEY.payment.part(amount(40000), amount(99499.45), amount(59499.45)))
      await dialog.getByRole('button', { name: MONEY.payment.save }).click()
      await expect(dialog).toBeHidden()
      const r = await receivable(seed.order.id)
      expect([num(r.settled), num(r.balance), r.payment_state]).toEqual([40000, 59499.45, 'part'])
      await expect(page.getByTestId('order-balance')).toHaveText(amount(59499.45))
    })

    await test.step('the rest: the amount opens at the balance and the note names the earlier payment', async () => {
      await orderPage(page).getByRole('button', { name: MONEY.order.recordPayment }).click()
      await expect(amountBox).toHaveValue(amount(59499.45))
      await expect(dialog.getByTestId('payment-note')).toContainText(MONEY.payment.settlesAfter(amount(59499.45), amount(99499.45), amount(40000)))
      await dialog.getByRole('button', { name: MONEY.payment.save }).click()
      await expect(dialog).toBeHidden()
      const r = await receivable(seed.order.id)
      expect([num(r.settled), num(r.balance), num(r.overpaid_by), r.payment_state]).toEqual([99499.45, 0, 0, 'settled'])
      await expect(page.getByTestId('order-balance')).toHaveText(amount(0))
    })

    await test.step('more than is owed: the dialog says so, the payment is kept, and Exceptions reports it', async () => {
      await orderPage(page).getByRole('button', { name: MONEY.order.recordPayment }).click()
      await expect(amountBox).toHaveValue('') // nothing is due
      await amountBox.fill('5000.55')
      await expect(dialog.getByTestId('payment-note')).toHaveText(MONEY.payment.over(amount(5000.55)))
      await dialog.getByRole('button', { name: MONEY.payment.save }).click()
      await expect(dialog).toBeHidden()
      const r = await receivable(seed.order.id)
      expect([num(r.settled), num(r.balance), num(r.overpaid_by), r.payment_state]).toEqual([104500, 0, 5000.55, 'settled'])
      const money = await db.view<{ overpaid_by: number; settled: number }>(`v_order_money?order_id=eq.${seed.order.id}&select=overpaid_by,settled`)
      expect(num(money[0].overpaid_by)).toBe(5000.55)
    })

    await test.step('the database holds the three payments, each credited to the order owner (the salesperson)', async () => {
      const pays = await db.rows<{ amount: number; received_on: string; paid_via: string; credited_user_id: string; created_by: string }>(
        `payments_in?order_id=eq.${seed.order.id}&select=amount,received_on,paid_via,credited_user_id,created_by&order=created_at`,
      )
      expect(pays.map(p => num(p.amount))).toEqual([40000, 59499.45, 5000.55])
      for (const p of pays) expect(p).toMatchObject({ received_on: karachiDay(0), paid_via: 'bank', credited_user_id: USER.sales, created_by: USER.admin })
    })
    await admin.close()
  })

  test('a double click on Save payment records one payment', async ({ browser }, info) => {
    const seed = await seedInvoiced()
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)
    await orderPage(page).getByRole('button', { name: MONEY.order.recordPayment }).click()
    const dialog = page.getByRole('dialog', { name: MONEY.payment.dialog })
    await expect(dialog.getByRole('textbox', { name: MONEY.payment.amount })).toHaveValue(amount(99499.45))
    await dialog.getByRole('button', { name: MONEY.payment.save }).dblclick()
    await expect(dialog).toBeHidden()
    await page.waitForTimeout(1500)
    const pays = await db.rows<{ amount: number }>(`payments_in?order_id=eq.${seed.order.id}&select=amount`)
    expect(pays.map(p => num(p.amount))).toEqual([99499.45])
    await admin.close()
  })

  test('the payment reminder states the balance after a part payment and the days overdue, and Undo restores the invoice exactly', async ({ browser }, info) => {
    // Invoiced 50 days ago on 30-day terms: due 20 days ago. Gross 99,499.45, paid 12,345.67 -> balance 87,153.78.
    const seed = await order({ lines: [{ description: 'Prosonic FMU41 level transmitter', qty: 1, price: 84321.45 }], owner: 'sales', terms: 30 })
    const invDate = karachiDay(-50)
    const due = karachiDay(-20)
    const inv = await invoice(seed.order.id, 84321.45, 15178, invDate)
    await payment(seed.order.id, 12345.67, karachiDay(-10))
    const r = await receivable(seed.order.id)
    expect([num(r.balance), r.payment_state]).toEqual([87153.78, 'overdue'])

    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, MONEY.receivables.path)
    await page.getByRole('row', { name: new RegExp(seed.customer.name) }).click()
    const panel = page.getByTestId('reminder-panel')
    const text = panel.getByTestId('reminder-text')
    await expect(text).toContainText(MONEY.reminder.invoice(inv.number))
    await expect(text).toContainText(MONEY.reminder.balance(amount(87153.78)))
    await expect(text).toContainText(MONEY.reminder.afterPayment(amount(12345.67)))
    await expect(text).toContainText(MONEY.reminder.fellDue(longDate(due), 20))

    const before = await db.one<{ last_reminded_on: string | null; reminder_count: number; updated_at: string }>(`invoices?id=eq.${inv.id}&select=last_reminded_on,reminder_count,updated_at`)
    expect([before.last_reminded_on, before.reminder_count]).toEqual([null, 0])
    await resetClipboard(page)
    await panel.getByRole('button', { name: MONEY.reminder.copy }).click()
    await expect(panel.getByText(MONEY.reminder.recorded)).toBeVisible()
    await readClipboardWhen(page, MONEY.reminder.balance(amount(87153.78)))
    const stamped = await db.one<{ last_reminded_on: string | null; reminder_count: number }>(`invoices?id=eq.${inv.id}&select=last_reminded_on,reminder_count`)
    expect(stamped).toEqual({ last_reminded_on: karachiDay(0), reminder_count: 1 })
    await panel.getByRole('button', { name: MONEY.reminder.undo }).click()
    await expect(panel.getByRole('button', { name: MONEY.reminder.copy })).toBeVisible()
    await expect.poll(() => db.one(`invoices?id=eq.${inv.id}&select=last_reminded_on,reminder_count`)).toEqual({ last_reminded_on: null, reminder_count: 0 })
    // Nothing else on the invoice moved: the amounts are as issued.
    const after = await db.one<{ net_amount: number; gst_amount: number; invoice_date: string }>(`invoices?id=eq.${inv.id}&select=net_amount,gst_amount,invoice_date`)
    expect([num(after.net_amount), num(after.gst_amount), after.invoice_date]).toEqual([84321.45, 15178, invDate])
    await admin.close()
  })

  test('an advance before any invoice: the balance runs on the order lines, and the invoice made afterwards leaves exactly the rest to pay', async ({ browser }, info) => {
    // 2 x 31,250.25 = 62,500.50 net; GST 18% = 11,250.09 -> 11,250; gross 73,750.50. Advance 20,000 -> 53,750.50 due.
    const seed = await order({ lines: [{ description: 'Memosens CPS11E pH sensor', qty: 2, price: 31250.25 }], owner: 'sales' })
    await post('payments_in', { order_id: seed.order.id, amount: 20000, received_on: karachiDay(-3) })
    let r = await receivable(seed.order.id)
    expect([num(r.gross_target), num(r.settled), num(r.balance), r.payment_state]).toEqual([73750.5, 20000, 53750.5, 'part'])
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)
    await expect(page.getByTestId('order-balance')).toHaveText(amount(53750.5))
    await orderPage(page).getByRole('button', { name: MONEY.order.createInvoice }).click()
    const d = page.getByRole('dialog', { name: MONEY.invoice.dialog })
    await expect(d.getByText(amount(73750.5), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: MONEY.invoice.create }).click()
    await expect(d).toBeHidden()
    r = await receivable(seed.order.id)
    // The invoice is the whole order, so the advance counts against it: 73,750.50 - 20,000 = 53,750.50, nothing overpaid.
    expect([num(r.gross_target), num(r.settled), num(r.balance), num(r.overpaid_by)]).toEqual([73750.5, 20000, 53750.5, 0])
    await page.reload()
    await expect(page.getByTestId('order-balance')).toHaveText(amount(53750.5))
    await admin.close()
  })
})
