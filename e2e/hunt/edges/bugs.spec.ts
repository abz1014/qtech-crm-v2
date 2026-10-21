import { expect, test, type Page } from '@playwright/test'
import { seedWorld, type World } from '../../verify-roles/fixtures'
import { service } from '../../verify-roles/lib'
import { contextAs, settle, vp } from './lib'

/*
 * The confirmed bugs of the edge-case hunt (round 1), one reproducing test each, marked test.fail with the HE id. Each test asserts
 * the EXPECTED behaviour, so it fails today; when the bug is fixed Playwright reports "expected to fail but passed" and the mark
 * comes off. Details: the hunt report (HE-n entries). Local CI stack and fictional data only.
 */
let world: World
test.beforeAll(async () => {
  world = await seedWorld('HX')
})

async function paymentDialog(page: Page, orderId: string) {
  await page.goto(`/money/receivables?pay=1&order=${orderId}`)
  await settle(page)
  const d = page.getByRole('dialog', { name: 'Record payment' })
  await d.getByLabel('Amount received, PKR').waitFor()
  return d
}

async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('HE-1 an Orders link with an old or hand-typed filter value (?invoicing=open) crashes the whole screen', async ({ browser }, info) => {
  test.fail(true, 'HE-1: OrdersListPage passes ?invoicing= straight to the status lookup, which throws UnknownStatusError')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/orders?invoicing=open&payment=unpaid')
  await settle(page)
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible()
  await context.close()
})

test('HE-2 with no signal, the lazily loaded search palette failing to download takes down the whole app and the typing', async ({ browser }, info) => {
  test.fail(true, 'HE-2: PaletteHost loads CommandPalette with plain React lazy() on idle; a failed chunk reaches the root error boundary')
  const context = await contextAs(browser, info, 'sales', vp('w1366'), { serviceWorkers: 'block' })
  const page = await context.newPage()
  // The palette chunk cannot be fetched (offline before it was ever downloaded).
  await page.route(/\/assets\/CommandPalette-[^/]+\.js$/, r => r.abort('internetdisconnected'))
  await page.goto('/companies?new=1')
  const d = page.getByRole('dialog', { name: 'New company' })
  await d.getByRole('textbox', { name: /Company name/ }).fill('Hunt Offline Typing Ltd')
  await page.waitForTimeout(4000) // the idle-time palette load happens and fails
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  await expect(d.getByRole('textbox', { name: /Company name/ })).toHaveValue('Hunt Offline Typing Ltd')
  await context.close()
})

test('HE-3 Record payment accepts a received date in the year 2200 (and 1900) without a word', async ({ browser }, info) => {
  test.fail(true, 'HE-3: DateInput accepts 1900..2200 and RecordPaymentDialog only checks the date is not empty')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('1000')
  await d.getByLabel('Date received').fill('1/1/2200')
  await d.getByLabel('Date received').press('Tab')
  await d.getByRole('button', { name: 'Save payment' }).click()
  await page.waitForTimeout(1500)
  const rows = (await (await service(`/rest/v1/payments_in?order_id=eq.${world.order.id}&received_on=eq.2200-01-01&select=id`)).json()) as unknown[]
  expect(rows, 'a payment dated 1 Jan 2200 was stored').toHaveLength(0)
  await context.close()
})

test('HE-4 Record payment: the toast shows the amount as typed (PKR 100.555) while PKR 100.56 is stored', async ({ browser }, info) => {
  test.fail(true, 'HE-4: RecordPaymentDialog toast uses v.amount.toLocaleString; the field keeps 3 decimals, the database rounds to 2')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('100.555')
  await d.getByRole('button', { name: 'Save payment' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Recorded payment' }).first()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('PKR 100.56')
  await context.close()
})

test('HE-5 amounts in toasts drop the paisa zero: "PKR 12,345.5" instead of "PKR 12,345.50"', async ({ browser }, info) => {
  test.fail(true, 'HE-5: toasts format with toLocaleString (RecordPaymentDialog, ExpenseDialog, ExpensesTab, TargetsPage), not formatPaisa')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('12345.5')
  await d.getByRole('button', { name: 'Save payment' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Recorded payment' }).first()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('PKR 12,345.50')
  await context.close()
})

test('HE-6 the error summary says "needs a value" for a field that HAS a value (zero, negative, too long)', async ({ browser }, info) => {
  test.fail(true, 'HE-6: Form.tsx ErrorSummary always ends with " needs a value." whatever the field error is')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('-500')
  await d.getByRole('button', { name: 'Save payment' }).click()
  await expect(d.getByText(/Fix 1 field to continue/)).toBeVisible()
  await expect(d).not.toContainText('needs a value')
  await context.close()
})

test('HE-7 an amount too large for the database says "Something went wrong ... Try again" (trying again can never work)', async ({ browser }, info) => {
  test.fail(true, 'HE-7: numeric overflow (22003) falls to the default branch of mapPgError; no client maximum on amounts or rates')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('99999999999999')
  await d.getByRole('button', { name: 'Save payment' }).click()
  await expect(d.getByText(/Couldn.t save the payment|too large|Fix 1 field/).first()).toBeVisible()
  await expect(d).not.toContainText('Something went wrong')
  await context.close()
})

test('HE-8 an amount of 0.001 passes the form, then the server refuses it with a vague message', async ({ browser }, info) => {
  test.fail(true, 'HE-8: the amount schema checks > 0 but not >= 0.01; the database check answers with the generic 23514 sentence')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  const d = await paymentDialog(page, world.order.id)
  await d.getByLabel('Amount received, PKR').fill('0.001')
  await d.getByRole('button', { name: 'Save payment' }).click()
  await page.waitForTimeout(1500)
  await expect(d).not.toContainText('One of the values is not allowed')
  await context.close()
})

test('HE-9 a hand-entered exchange rate dated in 2200 is saved and the toast hides the year ("for Wed 1 Jan")', async ({ browser }, info) => {
  test.fail(true, 'HE-9: AddRateCard accepts any as-of date; the toast formats the day without the year; v_fx_latest then ignores it')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/settings/exchange-rates')
  await settle(page)
  await page.getByLabel('Rate, PKR for 1 unit').fill('281.5')
  await page.getByLabel('As of').fill('1/1/2200')
  await page.getByLabel('As of').press('Tab')
  await page.getByRole('button', { name: 'Save rate' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Rate saved' }).first()
  await expect(toast).toBeVisible()
  // Expected: refused as a typo, or at least the toast names the year it was saved for.
  await expect(toast).toContainText('2200')
  await context.close()
})

test('HE-10 the exchange rate toast shows 9 decimals (281.123456789) while 6 are stored', async ({ browser }, info) => {
  test.fail(true, 'HE-10: AddRateCard toasts formatRate(typed) instead of the stored numeric(.., 6) value')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/settings/exchange-rates')
  await settle(page)
  await page.getByLabel('Rate, PKR for 1 unit').fill('281.123456789')
  await page.getByRole('button', { name: 'Save rate' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Rate saved' }).first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toContainText('281.123456789')
  await context.close()
})

test('HE-11 RFQ intake: a quantity too big for the database (9999999999) is accepted on screen, then Save fails with "Something went wrong"', async ({ browser }, info) => {
  test.fail(true, 'HE-11: intake has no maximum quantity; float_rfq answers 400 (numeric(12,3) overflow) and the screen gives the generic sentence')
  const context = await contextAs(browser, info, 'sales', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/rfqs/new')
  await settle(page)
  await page.getByRole('combobox', { name: 'Company' }).fill(world.company.name)
  await page.getByRole('option', { name: new RegExp(world.tag) }).first().click()
  await paste(page, 'Pressure gauge 0-10 bar 9999999999 nos')
  await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Save without asking' }).click()
  await page.waitForTimeout(2000)
  await expect(page.getByText('Something went wrong. Nothing was saved.').first()).toHaveCount(0)
  await context.close()
})

test('HE-12 Targets: typing junk ("abc") over a saved target and pressing Enter DELETES the target', async ({ browser }, info) => {
  test.fail(true, 'HE-12: TargetsPage CellEditor treats an unreadable amount (NumberInput reports null) as "empty", and empty + Enter removes')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/settings/targets')
  await settle(page)
  const cell = page.getByRole('button', { name: /Test Engineer, Q1 \d{4} target: / })
  await cell.click()
  await page.getByLabel(/Test Engineer, Q1 \d{4} target in rupees/).fill('500000')
  await page.getByLabel(/Test Engineer, Q1 \d{4} target in rupees/).press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Target saved' }).first()).toBeVisible()
  await cell.click()
  await page.getByLabel(/Test Engineer, Q1 \d{4} target in rupees/).fill('abc')
  await page.getByLabel(/Test Engineer, Q1 \d{4} target in rupees/).press('Enter')
  await page.waitForTimeout(1000)
  await expect(page.getByRole('status').filter({ hasText: 'Target removed' })).toHaveCount(0)
  await context.close()
})

test('HE-13 the "Paste or photo" (Capture) dialog at 1366: Tab moves focus out of the open dialog', async ({ browser }, info) => {
  test.fail(true, 'HE-13: the Capture sheet does not trap focus on desktop')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/today')
  await settle(page)
  await page.getByRole('button', { name: /Paste or photo/ }).first().click()
  const d = page.getByRole('dialog', { name: /Paste or photo/ })
  await expect(d).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
    expect(inside, `Tab ${i + 1} left the dialog`).toBe(true)
  }
  await context.close()
})

test('HE-14 closing Help (Account menu > Help) with Esc drops focus on the page body', async ({ browser }, info) => {
  test.fail(true, 'HE-14: focus is not returned to the Account menu button after the Help dialog closes')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/orders')
  await settle(page)
  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: /Help/ }).first().click()
  await expect(page.getByRole('dialog', { name: /Help/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: /Help/ })).toHaveCount(0)
  const tag = await page.evaluate(() => document.activeElement?.tagName)
  expect(tag).not.toBe('BODY')
  await context.close()
})

test('HE-15 a name starting with an emoji gets a broken avatar ("H�" for "Hunt Emoji 😀")', async ({ browser }, info) => {
  test.fail(true, 'HE-15: src/lib/initials.ts takes [0] of each word, which is half of a surrogate pair for an emoji')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/settings/team')
  await settle(page)
  await page.getByRole('button', { name: 'Add person' }).first().click()
  const d = page.getByRole('dialog', { name: 'Add person' })
  await d.getByLabel('Full name').fill('Hunt Avatar 😀')
  await d.getByLabel('Email').fill(`hunt-avatar-${Date.now()}@test.invalid`)
  await d.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/This password is shown once/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/settings/team')
  await settle(page)
  const row = page.getByRole('row').filter({ hasText: 'Hunt Avatar' }).first()
  await expect(row).toBeVisible()
  const text = await row.innerText()
  expect(/[\uD800-\uDFFF]|�/u.test(text.replace(/\p{Extended_Pictographic}/gu, '')), `row text: ${text}`).toBe(false)
  await context.close()
})

test('HE-16 Companies list at 768 wide: long company names run under the Role badge', async ({ browser }, info) => {
  test.fail(true, 'HE-16: the Company column is narrower than the name and the badge column overlaps it (no ellipsis)')
  const context = await contextAs(browser, info, 'admin', vp('w768'))
  const page = await context.newPage()
  await page.goto('/companies')
  await settle(page)
  await expect(page.locator('#main').getByText(world.supplier.name).first()).toBeVisible()
  const overlap = await page.evaluate(() => {
    const out: string[] = []
    for (const row of Array.from(document.querySelectorAll('#main [role="row"], #main tr'))) {
      const cells = Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"], td, th'))
      if (cells.length < 2) continue
      const badge = Array.from(cells[1].querySelectorAll('*')).find(e => e.children.length === 0 && /^(Customer|Supplier|Prospect)/.test((e as HTMLElement).innerText ?? ''))
      if (!badge) continue
      // The painted text of the name cell (a Range is not clipped by the cell), against the badge's box.
      const range = document.createRange()
      range.selectNodeContents(cells[0])
      const t = range.getBoundingClientRect()
      const b = badge.getBoundingClientRect()
      if (t.right > b.left + 1 && t.top < b.bottom && t.bottom > b.top) out.push((cells[0] as HTMLElement).innerText.split('\n')[0])
    }
    return out
  })
  expect(overlap).toEqual([])
  await context.close()
})

test('HE-17 the phone number field takes any text ("call me 📞") and saves it', async ({ browser }, info) => {
  test.fail(true, 'HE-17: MyDetailsPage and TeamDialogs phone schema checks only the length')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/settings/details')
  await settle(page)
  await page.getByLabel('Phone').fill('call me 📞')
  await page.getByRole('button', { name: /Save/ }).click()
  await page.waitForTimeout(2000)
  await page.reload()
  await settle(page)
  await expect(page.getByLabel('Phone')).not.toHaveValue('call me 📞')
  await context.close()
})

test('HE-18 Add expense: the error summary shows the internal field name "inputTax"', async ({ browser }, info) => {
  test.fail(true, 'HE-18: ExpenseDialog passes no label for inputTax to <Form labels>, so the summary prints the schema key')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/money/expenses?add=1')
  await settle(page)
  const d = page.getByRole('dialog', { name: 'Add expense' })
  await d.getByLabel('Amount, PKR').fill('-500')
  await d.getByRole('button', { name: /Save expense/ }).click()
  await expect(d.getByText(/Fix \d fields? to continue/)).toBeVisible()
  await expect(d).not.toContainText('inputTax')
  await context.close()
})

test('HE-19 phone Back with a More menu open on an order leaves the order page', async ({ browser }, info) => {
  test.fail(true, 'HE-19: menus (Popover) do not take part in useBackToClose, unlike dialogs and sheets')
  const context = await contextAs(browser, info, 'sales', vp('w375'))
  const page = await context.newPage()
  await page.goto('/today')
  await settle(page)
  await page.goto(`/orders/${world.order.id}`)
  await settle(page)
  await page.getByRole('button', { name: /^More( actions)?$/ }).first().click()
  await expect(page.getByRole('menu').first()).toBeVisible()
  await page.goBack()
  await page.waitForTimeout(1000)
  expect(new URL(page.url()).pathname).toBe(`/orders/${world.order.id}`)
  await context.close()
})

test('HE-20 a mistyped record link (/companies/zzz) says "Check your connection" instead of "this link is wrong"', async ({ browser }, info) => {
  test.fail(true, 'HE-20: the malformed id makes PostgREST answer 400 (invalid uuid), which the page shows as a load failure')
  const context = await contextAs(browser, info, 'sales', vp('w1366'))
  const page = await context.newPage()
  for (const path of ['/companies/zzz', '/rfqs/not-a-uuid', '/orders/123']) {
    await page.goto(path)
    await settle(page)
    await page.waitForTimeout(1000)
    await expect(page.locator('#main')).not.toContainText(/Check your connection|did not finish/)
  }
  await context.close()
})

test('HE-21 Month end opens for a future month from the link (?month=2030-01) and lists bank lines "to match" for January 2030', async ({ browser }, info) => {
  test.fail(true, 'HE-21: useMonthEnd and BankTickPage accept any YYYY-MM; Reports clamps to this month, these do not')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/money/month-end?month=2030-01')
  await settle(page)
  await expect(page.locator('#main')).not.toContainText(/Jan(uary)? 2030/)
  await context.close()
})

test('HE-22 the Overdue-by-age report link with an impossible as-of day (2026-02-30) fails to load instead of falling back', async ({ browser }, info) => {
  test.fail(true, 'HE-22: ?asof= is passed to aging_as_of unchecked; the RPC answers 400')
  const context = await contextAs(browser, info, 'admin', vp('w1366'))
  const page = await context.newPage()
  await page.goto('/money/reports/aging?month=2026-02&asof=2026-02-30')
  await settle(page)
  await expect(page.locator('#main')).not.toContainText(/did not load/)
  await context.close()
})
