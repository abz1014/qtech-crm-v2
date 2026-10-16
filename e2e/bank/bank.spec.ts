import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * M12 end to end, against the local CI stack: Money > Month-end > Bank tick for the admin, through the real login form.
 *
 * FE-2 targets asserted here (BUILD_PLAN A6.5):
 *   Tick a bank item            1 tap, 1 request
 *   Tick a whole PSID group     1 tap, 1 request, every invoice of the PSID ticked
 *   Undo                        1 tap on the same row
 * plus: cash items never listed, older unticked items listed, the running totals tie to the rows, the page still ticks in a
 * closed month (bank_month is exempt from the lock), a refused write puts the line back and shows the sentence, sales and
 * engineer get the no-access page and make no data request, and axe (WCAG 2.2 AA) at 1440 and 375.
 * Each test makes its own records for the statement month (last month, the page default). The closed-month test runs last.
 */
const today = () => karachiDay(0)
const prevMonth = (back = 1) => {
  const [y, m] = today().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - back, 1))
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return { key, start: `${key}-01`, day: (n: number) => `${key}-${String(n).padStart(2, '0')}` }
}
const STMT = prevMonth(1)
const OLDER = prevMonth(2)

const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const FUEL = 'ca7e0000-0000-4000-8000-000000000004' // cash by default
const base = () => 300000 + Math.floor(Math.random() * 5000) * 10

async function newOrder(label: string) {
  const customer = await createCompany(uniqueName(label))
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } })))[0]
  return { customer, order }
}
const addPayment = (orderId: string, over: Record<string, unknown>) =>
  must(
    rest<{ id: string }[]>('admin', 'payments_in', {
      method: 'POST',
      body: { order_id: orderId, received_on: STMT.day(20), amount: 1000, ...over },
    }),
  ).then(r => r[0])
const addExpense = (over: Record<string, unknown>) =>
  must(
    rest<{ id: string }[]>('admin', 'expenses', {
      method: 'POST',
      body: { paid_on: STMT.day(10), paid_via: 'bank', category_id: RENT, amount_pkr: 1000, ...over },
    }),
  ).then(r => r[0])
const addDeposit = (orderId: string, psid: string, amount: number, day = 25) =>
  must(
    rest<{ id: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: {
        order_id: orderId,
        number: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        invoice_date: STMT.day(7),
        net_amount: amount * 5,
        gst_amount: amount,
        psid,
        tax_deposited_on: STMT.day(day),
        tax_deposit_amount: amount,
      },
    }),
  ).then(r => r[0])

const get = <T>(path: string) => must(rest<T[]>('admin', path))

async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mouse: number }
    w.__mouse = 0
    document.addEventListener('mousedown', () => (w.__mouse += 1), true)
  })
}
const mouse = (page: Page) => page.evaluate(() => (window as unknown as { __mouse: number }).__mouse)

/** The "Ticked, money in" figure in rupees. */
async function tickedTotal(page: Page): Promise<number> {
  const text = await page.getByRole('region', { name: 'Running ticked totals' }).getByText('Ticked, money in').locator('..').innerText()
  return Number((/PKR\s*([\d,.]+)/.exec(text)?.[1] ?? 'NaN').replace(/,/g, ''))
}

function writes(page: Page) {
  const seen: string[] = []
  page.on('request', r => {
    if (r.method() === 'PATCH' && /\/rest\/v1\/(payments_in|expenses|invoices)/.test(r.url()))
      seen.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  return seen
}

test.describe.configure({ mode: 'serial' })

test.describe('bank tick (M12)', () => {
  test('one tap ticks a payment: one request, the totals move, the same tap undoes it', async ({ page }) => {
    const { customer, order } = await newOrder('Tick Payer')
    const amount = base()
    const p = await addPayment(order.id, { amount, reference: 'IBFT 1' })
    await openAs(page, 'admin', '/money/month-end/bank')
    await expect(page.getByRole('group', { name: 'Statement month' })).toBeVisible()
    const row = page.getByRole('checkbox', { name: new RegExp(customer.name) })
    await expect(row).toHaveAttribute('aria-checked', 'false')
    const seen = writes(page)
    const before = await tickedTotal(page)
    await startCounting(page)
    await row.click()
    await expect(row).toHaveAttribute('aria-checked', 'true')
    await expect
      .poll(async () => (await get<{ bank_month: string | null }>(`payments_in?id=eq.${p.id}&select=bank_month`))[0].bank_month)
      .toBe(STMT.start)
    expect(await mouse(page)).toBe(1)
    expect(seen).toEqual(['PATCH /rest/v1/payments_in'])
    // the ticked total moved by exactly this amount
    await expect.poll(async () => (await tickedTotal(page)) - before).toBe(amount)
    // undo is the same tap
    await row.click()
    await expect(row).toHaveAttribute('aria-checked', 'false')
    await expect
      .poll(async () => (await get<{ bank_month: string | null }>(`payments_in?id=eq.${p.id}&select=bank_month`))[0].bank_month)
      .toBeNull()
    expect(await mouse(page)).toBe(2)
  })

  test('one tap ticks a whole PSID group: both invoices, one request, and it counts once', async ({ page }) => {
    const { order } = await newOrder('Psid Customer')
    const psid = `PSID ${Math.floor(Math.random() * 1e8)}`
    const a = await addDeposit(order.id, psid, 39240)
    const b = await addDeposit(order.id, psid, 7110)
    await openAs(page, 'admin', '/money/month-end/bank')
    const group = page.getByRole('checkbox', { name: new RegExp(`FBR deposit · PSID ${psid}`) })
    await expect(group).toContainText('2 invoices')
    await expect(group).toContainText('46,350')
    const seen = writes(page)
    await startCounting(page)
    await group.click()
    await expect(group).toHaveAttribute('aria-checked', 'true')
    await expect
      .poll(async () =>
        (await get<{ tax_bank_month: string | null }>(`invoices?id=in.(${a.id},${b.id})&select=tax_bank_month`)).map(r => r.tax_bank_month),
      )
      .toEqual([STMT.start, STMT.start])
    expect(await mouse(page)).toBe(1)
    expect(seen).toEqual(['PATCH /rest/v1/invoices'])
    await review(page, 'm12-bank-tick-psid-ticked-1440')
    await group.click()
    await expect
      .poll(async () =>
        (await get<{ tax_bank_month: string | null }>(`invoices?id=in.(${a.id},${b.id})&select=tax_bank_month`)).map(r => r.tax_bank_month),
      )
      .toEqual([null, null])
  })

  test('a bank expense is listed and ticked; a cash expense never appears; older unticked items come after', async ({ page }) => {
    const note = `bank-${Math.random().toString(36).slice(2, 7)}`
    const bank = await addExpense({ amount_pkr: base(), description: note, category_id: RENT })
    await addExpense({ amount_pkr: 4321, description: `cash-${note}`, category_id: FUEL, paid_via: 'cash' })
    const old = await addExpense({ amount_pkr: 1150, description: `old-${note}`, paid_on: OLDER.day(28), category_id: RENT })
    await openAs(page, 'admin', '/money/month-end/bank')
    const out = page.getByTestId('bank-out')
    await expect(out.getByRole('checkbox', { name: new RegExp(`Rent, ${note}`) }).first()).toBeVisible()
    await expect(out.getByText(`cash-${note}`)).toHaveCount(0)
    // the older one sits under its own heading, with the month it belongs to
    await expect(out.getByText('Older, not ticked in an earlier month')).toBeVisible()
    const oldRow = out.getByRole('checkbox', { name: new RegExp(`old-${note}`) })
    await expect(oldRow).toContainText('not ticked then')
    await oldRow.click()
    await expect
      .poll(async () => (await get<{ bank_month: string | null }>(`expenses?id=eq.${old.id}&select=bank_month`))[0].bank_month)
      .toBe(STMT.start)
    expect((await get<{ bank_month: string | null }>(`expenses?id=eq.${bank.id}&select=bank_month`))[0].bank_month).toBeNull()
  })

  test('the month can be changed, and a link with ?month= lands on it', async ({ page }) => {
    await openAs(page, 'admin', `/money/month-end/bank?month=${OLDER.key}`)
    await expect(page.getByRole('group', { name: 'Statement month' })).toContainText(
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${OLDER.start}T00:00:00Z`)),
    )
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page).toHaveURL(new RegExp(`month=${STMT.key}`))
  })

  test('a refused write puts the line back and shows the closed-month sentence', async ({ page }) => {
    const { customer, order } = await newOrder('Refused Payer')
    await addPayment(order.id, { amount: base() })
    await openAs(page, 'admin', '/money/month-end/bank')
    const sentence = 'September 2026 is closed. An admin can reopen it.'
    await page.route('**/rest/v1/payments_in*', route =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'P0001', message: sentence, details: null, hint: null }),
          })
        : route.continue(),
    )
    const row = page.getByRole('checkbox', { name: new RegExp(customer.name) })
    await row.click()
    await expect(page.getByRole('alert').filter({ hasText: sentence })).toBeVisible()
    await expect(row).toHaveAttribute('aria-checked', 'false')
    await review(page, 'm12-bank-tick-refused-1440')
  })

  test('sales and engineer get no access, make no data request, and the database refuses them too', async ({ browser }) => {
    for (const role of ['sales', 'engineer'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
      const seen: string[] = []
      page.on('request', r => {
        if (/\/rest\/v1\/(payments_in|expenses|expense_categories)/.test(r.url())) seen.push(r.url())
      })
      await openAs(page, role, '/money/month-end/bank')
      await expect(page.getByRole('heading', { name: 'Bank tick is for admins' })).toBeVisible()
      await expect(page.getByTestId('bank-in')).toHaveCount(0)
      expect(seen, `${role} must not fetch bank data`).toEqual([])
      await page.close()
      expect((await rest<unknown[]>(role, 'payments_in?select=id')).body).toEqual([])
      expect((await rest<unknown[]>(role, 'expenses?select=id')).body).toEqual([])
      const write = await rest(role, `expenses?id=eq.00000000-0000-4000-8000-000000000000`, {
        method: 'PATCH',
        body: { bank_month: STMT.start },
      })
      expect(write.status === 200 ? write.body : []).toEqual([])
    }
  })

  test('axe at 1440 and 375, with the review screenshots', async ({ page }) => {
    const { order } = await newOrder('Axe Customer')
    await addPayment(order.id, { amount: base() })
    await addPayment(order.id, { amount: base() + 1, bank_month: STMT.start, received_on: STMT.day(8), reference: 'Cheque 004398' })
    await addExpense({ amount_pkr: base(), description: 'support staff', category_id: RENT })
    await addDeposit(order.id, `PSID ${Math.floor(Math.random() * 1e8)}`, 12000)
    await openAs(page, 'admin', '/money/month-end/bank')
    await expect(page.getByTestId('bank-state')).toContainText('not ticked')
    await page.waitForLoadState('networkidle')
    await review(page, 'm12-bank-tick-1440')
    expect(await axeViolations(page)).toEqual([])
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForLoadState('networkidle')
    await review(page, 'm12-bank-tick-375')
    expect(await axeViolations(page)).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
  })

  // ---- last: closing a month is permanent until it is reopened -----------------------------------------------

  test.describe('a closed month', () => {
    test.beforeAll(async () => {
      await must(rest('admin', 'rpc/close_months_through', { method: 'POST', body: { p_month: STMT.start }, prefer: 'return=minimal' }))
    })
    test.afterAll(async () => {
      for (const m of [STMT.start, OLDER.start])
        await rest('admin', 'rpc/reopen_month', { method: 'POST', body: { p_month: m }, prefer: 'return=minimal' })
    })

    test('ticking still works: the tick is not part of the lock', async ({ page }) => {
      await openAs(page, 'admin', '/money/month-end/bank')
      const key = await page.getByTestId('bank-in').getByRole('checkbox', { checked: false }).first().getAttribute('data-key')
      const row = page.locator(`[data-key="${key}"]`)
      await row.click()
      await expect(row).toHaveAttribute('aria-checked', 'true')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(row).toHaveAttribute('aria-checked', 'true')
      expect((await get<{ bank_month: string | null }>('payments_in?select=bank_month&bank_month=not.is.null&limit=1')).length).toBe(1)
    })
  })
})
