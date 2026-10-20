import { expect, test, type Page } from '@playwright/test'
import { db, num, USER } from '../support/db'
import { karachiDay, order, quotedRfq, quote, rfq, setProfile, supplier, uniqueName } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { COMMON, RESILIENCE as R, amount } from '../support/text'
import { openAs } from '../../support/stack'

/*
 * What happens when things go wrong: the connection drops while saving, an answer is lost on the way back, the session runs out, a
 * button is pressed twice, two people act on the same record at once, and Undo is pressed. Each test asserts what the person sees
 * and, above all, what the database ends up holding: one record, never two, and an Undo that puts back exactly what was there.
 *
 * The promises under test (DECISIONS 2026-10-14, U07): a save carries a client-made id, so a retry after a dropped answer is not
 * repeated; a failed save keeps everything typed and says "Check your connection and try again. Trying again will not create a
 * duplicate."; the session is refreshed silently while it can be, and a person sent to sign in comes back where they were.
 */

/** The seed users' password on the LOCAL CI stack only (supabase/seed.sql); the same value e2e/support/stack.ts signs in with. */
const FIXTURE_PASSWORD = 'fixture-only-password'

const actions = (page: Page) => page.locator('[data-slot="order-actions"]')

/** The stored Supabase session in this page's localStorage, edited in place. Returns the access token before the edit. */
async function editStoredSession(page: Page, edit: { expired?: boolean; badRefresh?: boolean }): Promise<string> {
  return page.evaluate(({ expired, badRefresh }) => {
    const key = Object.keys(localStorage).find(k => /^sb-.+-auth-token$/.test(k))
    if (!key) throw new Error('no stored Supabase session')
    const s = JSON.parse(localStorage.getItem(key) as string) as { access_token: string; refresh_token: string; expires_at: number }
    const before = s.access_token
    if (expired) s.expires_at = Math.floor(Date.now() / 1000) - 120
    if (badRefresh) s.refresh_token = 'verify-not-a-refresh-token'
    localStorage.setItem(key, JSON.stringify(s))
    return before
  }, edit)
}

const storedToken = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.+-auth-token$/.test(k))
    return key ? (JSON.parse(localStorage.getItem(key) as string) as { access_token: string }).access_token : null
  })

// ------------------------------------------------------------------------------------------------ the connection drops

test.describe('a save that cannot reach the server', () => {
  test('Record payment offline: the plain sentence, the amount kept, then Try again saves exactly one payment', async ({ browser }, info) => {
    test.fixme(true, 'selectors outdated by the ux/* merge (69f40fa): update RESILIENCE words in support/text-resilience.ts')
    // 1 x 61,234.45 at 18%: GST 11,022.20 -> 11,022; gross 72,256.45.
    const seed = await order({ lines: [{ description: 'Vortex flow meter DN100', qty: 1, price: 61234.45 }], owner: 'sales' })
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, `/orders/${seed.order.id}`)
    await actions(page).getByRole('button', { name: R.order.actions.recordPayment }).click()
    const d = page.getByRole('dialog', { name: R.order.paymentDialog })
    const amountBox = d.getByRole('textbox', { name: R.order.amount })
    await expect(amountBox).toHaveValue(amount(72256.45))
    await amountBox.fill('30000')
    await admin.setOffline(true)
    await d.getByRole('button', { name: R.order.savePayment }).click()
    await expect(d.getByRole('button', { name: R.tryAgain })).toBeVisible()
    await expect(amountBox).toHaveValue(amount(30000))
    expect(await db.count(`payments_in?order_id=eq.${seed.order.id}&select=id`)).toBe(0)
    await admin.setOffline(false)
    await d.getByRole('button', { name: R.tryAgain }).click()
    await expect(d).toBeHidden()
    const pays = await db.rows<{ amount: number }>(`payments_in?order_id=eq.${seed.order.id}&select=amount`)
    expect(pays.map(p => num(p.amount))).toEqual([30000])
    await admin.close()
  })

  test('Create invoice whose answer is lost on the way back: Try again does not make a second invoice', async ({ browser }, info) => {
    // 2 x 17,345.55 = 34,691.10 net; GST 6,244.398 -> 6,244; gross 40,935.10.
    const seed = await order({ lines: [{ description: 'Thermowell set, SS316', qty: 2, price: 17345.55 }], owner: 'sales' })
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, `/orders/${seed.order.id}`)
    let lost = false
    // The first POST to invoices reaches the database, then its answer is dropped: the browser sees a network failure.
    await page.route('**/rest/v1/invoices*', async route => {
      if (route.request().method() === 'POST' && !lost) {
        lost = true
        await route.fetch()
        await route.abort('failed')
        return
      }
      await route.continue()
    })
    await actions(page).getByRole('button', { name: R.order.actions.createInvoice }).click()
    const d = page.getByRole('dialog', { name: R.order.invoiceDialog })
    await expect(d.getByText(amount(40935.1), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: R.order.createInvoice }).click()
    await expect(d.getByText(COMMON.network)).toBeVisible()
    expect(lost).toBe(true)
    expect(await db.count(`invoices?order_id=eq.${seed.order.id}&select=id`), 'the first attempt did arrive').toBe(1)
    await d.getByRole('button', { name: R.tryAgain }).click()
    await expect(d).toBeHidden()
    const rows = await db.rows<{ net_amount: number; gst_amount: number }>(`invoices?order_id=eq.${seed.order.id}&select=net_amount,gst_amount`)
    expect(rows.map(r => [num(r.net_amount), num(r.gst_amount)])).toEqual([[34691.1, 6244]])
    await sales.close()
  })

  test('Add expense offline: the note and amount stay, and back online one expense is saved', async ({ browser }, info) => {
    test.fixme(true, 'selectors outdated by the ux/* merge (69f40fa): update RESILIENCE words in support/text-resilience.ts')
    const amt = 100000 + Math.floor(Math.random() * 800000) / 100
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, R.expense.path)
    await page.getByRole('button', { name: R.expense.add, exact: true }).click()
    const d = page.getByRole('dialog', { name: R.expense.dialog })
    await d.getByRole('textbox', { name: R.expense.amount }).fill(String(amt))
    await admin.setOffline(true)
    await d.getByRole('button', { name: R.expense.save }).click()
    await expect(d.getByRole('button', { name: R.tryAgain })).toBeVisible()
    await admin.setOffline(false)
    await d.getByRole('button', { name: R.tryAgain }).click()
    await expect(d).toBeHidden()
    const rows = await db.rows<{ amount_pkr: number; paid_on: string }>(`expenses?amount_pkr=eq.${amt}&select=amount_pkr,paid_on`)
    expect(rows.map(r => [num(r.amount_pkr), r.paid_on])).toEqual([[amt, karachiDay(0)]])
    await admin.close()
  })
})

// ------------------------------------------------------------------------------------------------ the session runs out

test.describe('the session', () => {
  test('an expired access token is refreshed silently: the page stays, and a save made straight after works', async ({ page }) => {
    const seed = await order({ lines: [{ description: 'Level switch, vibrating fork', qty: 3, price: 8765.43 }], owner: 'sales' })
    await openAs(page, 'sales', `/orders/${seed.order.id}`)
    const before = await editStoredSession(page, { expired: true })
    await page.reload()
    await page.locator('#main').waitFor()
    await expect(page).toHaveURL(new RegExp(`/orders/${seed.order.id}$`))
    await expect.poll(() => storedToken(page)).not.toBe(before)
    // 3 x 8,765.43 = 26,296.29 net; GST 4,733.33 -> 4,733; gross 31,029.29
    await actions(page).getByRole('button', { name: R.order.actions.createInvoice }).click()
    const d = page.getByRole('dialog', { name: R.order.invoiceDialog })
    await expect(d.getByText(amount(31029.29), { exact: true })).toBeVisible()
    await d.getByRole('button', { name: R.order.createInvoice }).click()
    await expect(d).toBeHidden()
    expect(await db.count(`invoices?order_id=eq.${seed.order.id}&select=id`)).toBe(1)
  })

  test('a session that can no longer be refreshed sends the person to sign in, and signing in brings them back to the same page', async ({ page }) => {
    const seed = await order({ lines: [{ description: 'Gauge isolation valve', qty: 5, price: 1999.99 }], owner: 'sales' })
    const path = `/orders/${seed.order.id}`
    await openAs(page, 'sales', path)
    await editStoredSession(page, { expired: true, badRefresh: true })
    await page.reload()
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel(R.signIn.email).fill('sales@test.invalid')
    await page.getByLabel(R.signIn.password, { exact: true }).fill(FIXTURE_PASSWORD)
    await page.getByRole('button', { name: R.signIn.button }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await page.locator('#main').waitFor()
    // Nothing was half-saved on the way: the order is as it was.
    expect(await db.count(`invoices?order_id=eq.${seed.order.id}&select=id`)).toBe(0)
  })
})

// ------------------------------------------------------------------------------------------------ pressed twice

test.describe('a double press makes one record', () => {
  test('New company: a double click on Add company makes one company', async ({ browser }, info) => {
    const name = uniqueName('Verify Double Textile')
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, R.company.path)
    await page.getByRole('button', { name: R.company.newCompany }).first().click()
    const d = page.getByRole('dialog', { name: R.company.dialog })
    await d.getByRole('textbox', { name: R.company.name }).fill(name)
    await d.getByRole('button', { name: R.company.add }).dblclick()
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/)
    await page.waitForTimeout(1500)
    expect(await db.count(`companies?name=eq.${encodeURIComponent(name)}&select=id`)).toBe(1)
    await sales.close()
  })

  test('Add expense: a double click on Save expense saves one expense', async ({ browser }, info) => {
    test.fixme(true, 'selectors outdated by the ux/* merge (69f40fa): update RESILIENCE words in support/text-resilience.ts')
    const amt = 900000 + Math.floor(Math.random() * 800000) / 100
    const admin = await signedIn(browser, info, 'admin')
    const page = await open(admin, R.expense.path)
    await page.getByRole('button', { name: R.expense.add, exact: true }).click()
    const d = page.getByRole('dialog', { name: R.expense.dialog })
    await d.getByRole('textbox', { name: R.expense.amount }).fill(String(amt))
    await d.getByRole('button', { name: R.expense.save }).dblclick()
    await expect(d).toBeHidden()
    await page.waitForTimeout(1500)
    expect(await db.count(`expenses?amount_pkr=eq.${amt}&select=id`)).toBe(1)
    await admin.close()
  })

  test('Issue PO: a double click in the dialog issues one purchase order', async ({ browser }, info) => {
    await setProfile(true)
    const sup = await supplier('Verify Double PO Supplier', 'Pakistan')
    const seed = await order({ suppliers: [{ supplier: sup, currency: 'PKR' }], lines: [{ description: 'Cable gland M20, brass', qty: 40, price: 650, leg: 0, supplierPrice: 412.5 }] })
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, `/orders/${seed.order.id}`)
    await page.getByTestId('leg-A').getByRole('button', { name: R.order.issuePoOnLeg('A') }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByRole('heading', { name: R.order.issuePoDialog })).toBeVisible()
    await d.getByRole('button', { name: R.order.issuePo }).dblclick()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    const pos = await db.rows<{ total: number; revision: number }>(`purchase_orders?supplier_order_id=eq.${seed.legs[0].id}&select=total,revision`)
    // 40 x 412.50 = 16,500.00
    expect(pos.map(p => [num(p.total), p.revision])).toEqual([[16500, 0]])
    await sales.close()
  })
})

// ------------------------------------------------------------------------------------------------ two people at once

test.describe('two people on the same record', () => {
  test('both create the invoice for the same order from dialogs opened at the same time: the order is not invoiced twice', async ({ browser }, info) => {
    // 1 x 52,000.40 at 18%: GST 9,360.07 -> 9,360; gross 61,360.40.
    const seed = await order({ lines: [{ description: 'Analyser shelter air conditioner', qty: 1, price: 52000.4 }], owner: 'sales' })
    const a = await signedIn(browser, info, 'admin')
    const b = await signedIn(browser, info, 'sales')
    const pa = await open(a, `/orders/${seed.order.id}`)
    const pb = await open(b, `/orders/${seed.order.id}`)
    for (const p of [pa, pb]) {
      await actions(p).getByRole('button', { name: R.order.actions.createInvoice }).click()
      await expect(p.getByRole('dialog', { name: R.order.invoiceDialog }).getByText(amount(61360.4), { exact: true })).toBeVisible()
    }
    await pa.getByRole('dialog', { name: R.order.invoiceDialog }).getByRole('button', { name: R.order.createInvoice }).click()
    await expect(pa.getByRole('dialog', { name: R.order.invoiceDialog })).toBeHidden()
    await pb.getByRole('dialog', { name: R.order.invoiceDialog }).getByRole('button', { name: R.order.createInvoice }).click()
    await pb.waitForTimeout(2000)
    const rows = await db.rows<{ net_amount: number; created_by: string }>(`invoices?order_id=eq.${seed.order.id}&select=net_amount,created_by`)
    // SUSPECTED BUG: nothing at save time re-checks what is left to invoice, so the second dialog adds a second full invoice.
    expect(rows.map(r => num(r.net_amount)), 'the order must be invoiced once, not twice').toEqual([52000.4])
    await a.close()
    await b.close()
  })

  test('both press Mark won on the same RFQ from pages opened at the same time: one order, not two', async ({ browser }, info) => {
    test.fail(true, 'BUG-CONC-1: convert_rfq_to_order is idempotent per dialog id only; two dialogs make two orders for one RFQ (supabase/migrations/0050_split_order_item.sql:44-56)')
    const seed = await quotedRfq({ items: [{ description: 'Ultrasonic level transmitter 10 m', qty: 2, price: 48500, supplierPrice: 39000 }] })
    const a = await signedIn(browser, info, 'sales')
    const b = await signedIn(browser, info, 'admin')
    const pa = await open(a, `/rfqs/${seed.rfq.id}`)
    const pb = await open(b, `/rfqs/${seed.rfq.id}`)
    for (const p of [pa, pb]) {
      await p.locator('[data-slot="mark-won"]').getByRole('button', { name: R.rfq.markWon }).click()
      await expect(p.getByRole('dialog').getByRole('heading', { name: R.rfq.wonDialog })).toBeVisible()
    }
    await pa.getByRole('dialog').getByRole('button', { name: R.rfq.createOrder }).click()
    await expect(pa).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    await pb.getByRole('dialog').getByRole('button', { name: R.rfq.createOrder }).click()
    await pb.waitForTimeout(2500)
    const orders = await db.rows<{ id: string }>(`orders?rfq_id=eq.${seed.rfq.id}&select=id`)
    // SUSPECTED BUG: convert_rfq_to_order is idempotent per dialog (its order id), not per RFQ, so a second dialog makes a second order.
    expect(orders, 'one RFQ is won once').toHaveLength(1)
    await a.close()
    await b.close()
  })

  test('two people chase the same supplier from stale pages: both chases count and the last one names its sender', async ({ browser }, info) => {
    test.fixme(true, 'selectors outdated by the ux/* merge (69f40fa): update RESILIENCE words in support/text-resilience.ts')
    const r = await rfq({ items: [{ description: 'Coriolis meter DN25', qty: 1 }] })
    const sup = await supplier('Verify Chase Supplier', 'China')
    const inq = await quote(r.rfq.id, sup, [], 'CNY', 6)
    const a = await signedIn(browser, info, 'admin')
    const b = await signedIn(browser, info, 'sales')
    const pa = await open(a, `/rfqs/${r.rfq.id}`)
    const pb = await open(b, `/rfqs/${r.rfq.id}`)
    await pa.getByRole('button', { name: R.rfq.chase(sup.name), exact: true }).click()
    await expect(pa.getByRole('status').filter({ hasText: R.rfq.chaseCopied })).toBeVisible()
    await pb.getByRole('button', { name: R.rfq.chase(sup.name), exact: true }).click()
    await expect(pb.getByRole('status').filter({ hasText: R.rfq.chaseCopied })).toBeVisible()
    await expect
      .poll(() => db.one<{ chase_count: number; last_chased_on: string; last_chased_by: string }>(`supplier_inquiries?id=eq.${inq.id}&select=chase_count,last_chased_on,last_chased_by`))
      .toEqual({ chase_count: 2, last_chased_on: karachiDay(0), last_chased_by: USER.sales })
    await a.close()
    await b.close()
  })
})

// ------------------------------------------------------------------------------------------------ Undo puts back exactly what was there

test.describe('Undo restores the record exactly', () => {
  test('leg stamps: Undo of Mark placed clears placed and the expected date it set; Undo of Delivered clears delivered and received', async ({ browser }, info) => {
    const sup = await supplier('Verify Undo Supplier', 'Pakistan')
    const seed = await order({ suppliers: [{ supplier: sup }], lines: [{ description: 'Pressure gauge 0-16 bar', qty: 6, price: 3150, leg: 0, supplierPrice: 2100 }] })
    const leg = seed.legs[0].id
    const dates = () => db.one<{ placed_on: string | null; expected_on: string | null; delivered_on: string | null; received_on: string | null }>(`supplier_orders?id=eq.${leg}&select=placed_on,expected_on,delivered_on,received_on`)
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, `/orders/${seed.order.id}`)
    const legA = page.getByTestId('leg-A')

    await legA.getByRole('button', { name: R.order.markPlaced('A') }).click()
    await expect.poll(async () => (await dates()).placed_on).toBe(karachiDay(0))
    const placed = await dates()
    expect(placed.expected_on, 'Mark placed fills the expected date').not.toBeNull()
    await page.getByRole('status').getByRole('button', { name: R.undo }).first().click()
    await expect.poll(dates).toEqual({ placed_on: null, expected_on: null, delivered_on: null, received_on: null })

    // Placed again (an earlier placed date, so Delivered is offered), then Delivered and its Undo.
    await db.patch(`supplier_orders?id=eq.${leg}`, { placed_on: karachiDay(-9), expected_on: karachiDay(-1) })
    await page.reload()
    await legA.getByRole('button', { name: R.order.deliveredToday('A') }).click()
    await expect.poll(async () => (await dates()).delivered_on).toBe(karachiDay(0))
    expect((await dates()).received_on).toBe(karachiDay(0))
    await page.getByRole('status').getByRole('button', { name: R.undo }).first().click()
    await expect.poll(dates).toEqual({ placed_on: karachiDay(-9), expected_on: karachiDay(-1), delivered_on: null, received_on: null })
    await sales.close()
  })

  test('a supplier chase: Undo puts the count and the date back; the chaser becomes unknown, as documented', async ({ browser }, info) => {
    const r = await rfq({ items: [{ description: 'Magnetic level gauge 1.2 m', qty: 2 }] })
    const sup = await supplier('Verify Undo Chase Supplier', 'Pakistan')
    const inq = await quote(r.rfq.id, sup, [], 'PKR', 8)
    // An earlier chase by the admin, four days ago.
    await db.patch(`supplier_inquiries?id=eq.${inq.id}`, { chase_count: 1, last_chased_on: karachiDay(-4), last_chased_by: USER.admin })
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, `/rfqs/${r.rfq.id}`)
    await page.getByRole('button', { name: R.rfq.chase(sup.name), exact: true }).click()
    const toast = page.getByRole('status').filter({ hasText: R.rfq.chaseCopied })
    await expect(toast).toBeVisible()
    await expect.poll(() => db.one(`supplier_inquiries?id=eq.${inq.id}&select=chase_count,last_chased_on,last_chased_by`)).toEqual({
      chase_count: 2,
      last_chased_on: karachiDay(0),
      last_chased_by: USER.sales,
    })
    await toast.getByRole('button', { name: R.undo }).click()
    // 0065: an Undo leaves the actor empty ("a missing name is better than a wrong one").
    await expect.poll(() => db.one(`supplier_inquiries?id=eq.${inq.id}&select=chase_count,last_chased_on,last_chased_by`)).toEqual({
      chase_count: 1,
      last_chased_on: karachiDay(-4),
      last_chased_by: null,
    })
    await sales.close()
  })
})

