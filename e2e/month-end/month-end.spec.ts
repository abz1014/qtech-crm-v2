import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * M10 (and M05, amended) end to end, against the local CI stack: Money > Month-end for the admin, through the real login form.
 *
 * FE-2 targets asserted here (BUILD_PLAN A6.5):
 *   Jump from a check to the fix        1 tap
 *   Monthly report viewed               1 tap (the tab)
 *   CSV export                          1 tap, one file named for the report and month
 *   Close a month (checklist reviewed)  2 taps, nothing typed
 *   Reopen                              2 taps (a reason is optional)
 * plus: the closed-month sentence reaches the person word for word, sales and engineer see nothing of Month-end (no request is made
 * and the database gives them no rows), sales still read the GST register, and axe (WCAG 2.2 AA) at 1440 and 375.
 * Each test makes its own records for last month (the page default). The close test runs last and reopens what it closed.
 */
const prevMonth = (back = 1) => {
  const [y, m] = karachiDay(0).split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - back, 1))
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(d)
  return { key, start: `${key}-01`, name, label: `${name} ${d.getUTCFullYear()}`, day: (n: number) => `${key}-${String(n).padStart(2, '0')}` }
}
const STMT = prevMonth(1)
const OLDER = prevMonth(2)

const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const SUPPLIER = 'ca7e0000-0000-4000-8000-000000000011'
const base = () => 300000 + Math.floor(Math.random() * 5000) * 10

async function newOrder(label: string) {
  const customer = await createCompany(uniqueName(label))
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } })))[0]
  return { customer, order }
}
const addPayment = (orderId: string, over: Record<string, unknown> = {}) =>
  must(rest<{ id: string }[]>('admin', 'payments_in', { method: 'POST', body: { order_id: orderId, received_on: STMT.day(20), amount: base(), ...over } })).then(r => r[0])
const addExpense = (over: Record<string, unknown> = {}) =>
  must(
    rest<{ id: string }[]>('admin', 'expenses', {
      method: 'POST',
      body: { paid_on: STMT.day(10), paid_via: 'bank', category_id: RENT, amount_pkr: base(), ...over },
    }),
  ).then(r => r[0])
const addInvoice = (orderId: string) =>
  must(
    rest<{ id: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { order_id: orderId, number: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, invoice_date: STMT.day(7), net_amount: 100000, gst_amount: 18000 },
    }),
  ).then(r => r[0])

async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mouse: number; __counting?: boolean }
    w.__mouse = 0
    if (!w.__counting) {
      w.__counting = true
      document.addEventListener('mousedown', () => (w.__mouse += 1), true)
    }
  })
}
const mouse = (page: Page) => page.evaluate(() => (window as unknown as { __mouse: number }).__mouse)

/** One tap on Export CSV: the file's name and its text. */
async function exportCsv(page: Page, scope = page.locator('main, body').first()) {
  const [download] = await Promise.all([page.waitForEvent('download'), scope.getByRole('button', { name: 'Export CSV' }).first().click()])
  const path = await download.path()
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') }
}

test.describe.configure({ mode: 'serial' })

test.describe('month-end (M10)', () => {
  test('a check links to its fix in one tap, and the bank and checklist counts agree', async ({ page }) => {
    const { order } = await newOrder('Check Payer')
    await addPayment(order.id)
    await addExpense()
    await openAs(page, 'admin', `/money/month-end?month=${STMT.key}`)
    const card = page.getByTestId('check-bank_unticked')
    await expect(card).toContainText('Bank items not ticked')
    await expect(card.locator('span.num').first()).not.toHaveText('0')
    await expect(page.getByRole('navigation', { name: 'Month-end views' }).getByRole('link', { name: /^Checklist/ })).toHaveAttribute('aria-current', 'page')
    await startCounting(page)
    await card.getByRole('link', { name: 'Open bank tick' }).click()
    await expect(page).toHaveURL(new RegExp(`/money/month-end/bank\\?month=${STMT.key}`))
    expect(await mouse(page)).toBe(1)
  })

  test('every report is one tap on its tab and one tap on Export CSV', async ({ page }) => {
    const { order } = await newOrder('Report Payer')
    await addPayment(order.id)
    await addExpense({ description: 'office rent' })
    await addExpense({ category_id: SUPPLIER, amount_pkr: 11800, input_tax_pkr: 1800 })
    await addInvoice(order.id)
    await openAs(page, 'admin', `/money/month-end?month=${STMT.key}`)
    const nav = page.getByRole('navigation', { name: 'Month-end views' })
    const reports: { tab: string; file: string; header: string; shows: RegExp }[] = [
      { tab: 'P&L', file: `profit-and-loss-${STMT.key}.csv`, header: 'Section', shows: new RegExp(`Result for ${STMT.name}`) },
      { tab: 'Expenses by category', file: `expenses-by-category-${STMT.key}.csv`, header: 'Month', shows: /Overheads/ },
      { tab: 'Aging', file: `aging-${STMT.key}.csv`, header: 'As of', shows: /Aging of what customers owe/ },
      { tab: 'We owe', file: `we-owe-${STMT.key}.csv`, header: 'As of', shows: /What we owe suppliers/ },
      { tab: 'GST/FBR', file: `gst-and-fbr-${STMT.key}.csv`, header: 'Invoice month', shows: /GST and FBR, by invoice month/ },
      { tab: 'Team', file: `team-${STMT.key}.csv`, header: 'Month', shows: /Team: net cash credited/ },
    ]
    for (const r of reports) {
      await startCounting(page)
      await nav.getByRole('link', { name: new RegExp(`^${r.tab.replace('/', '\\/')}`) }).click()
      await expect(page.getByText(r.shows).first()).toBeVisible()
      expect(await mouse(page), `${r.tab}: tab is one tap`).toBe(1)
      await expect(page).toHaveURL(new RegExp(`month=${STMT.key}`))
      await page.waitForLoadState('networkidle')
      const csv = await exportCsv(page)
      expect(await mouse(page), `${r.tab}: tab and CSV are two taps in all`).toBe(2)
      expect(csv.name).toBe(r.file)
      expect(csv.text.split('\n')[0]).toContain(`"${r.header}"`)
    }
  })

  test('the P&L shows the payment with no net split apart, and its CSV carries Gross, GST and Net columns', async ({ page }) => {
    await openAs(page, 'admin', `/money/month-end/pnl?month=${STMT.key}`)
    await expect(page.getByText('less payments not yet split')).toBeVisible()
    await expect(page.getByText('not revenue')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Not in P&L' })).toBeVisible()
    const csv = await exportCsv(page)
    expect(csv.text.split('\n')[0]).toBe('"Section","Line","Count","Gross","GST or input tax","Net"')
    expect(csv.text).toContain('Payments not yet split (excluded from net)')
    expect(csv.text).toContain(`Result for ${STMT.label}`)
    await review(page, 'm10-pnl-1440')
  })

  test('the GST/FBR report lists output GST and input tax side by side, admin only', async ({ page }) => {
    const { order } = await newOrder('Gst Payer')
    await addInvoice(order.id)
    await addExpense({ category_id: SUPPLIER, amount_pkr: 11800, input_tax_pkr: 1800 })
    await openAs(page, 'admin', `/money/month-end/gst?month=${STMT.key}`)
    await expect(page.getByText('Output GST and input tax, side by side')).toBeVisible()
    const csv = await exportCsv(page)
    expect(csv.text.split('\n')[0]).toContain('"Input tax paid"')
    await review(page, 'm10-gst-fbr-1440')
  })

  test('sales and engineer: no Month-end, no month-end request, and no rows from the database; sales still read the GST register', async ({ browser }) => {
    test.setTimeout(90_000)
    for (const role of ['sales', 'engineer'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
      const seen: string[] = []
      page.on('request', r => {
        if (/\/rest\/v1\/(closed_months|v_month_pnl|v_month_expense_category|v_month_team|payments_in|expenses)|\/rpc\/(month_end_status|aging_as_of|payables_as_of|close_month|close_months_through|reopen_month)/.test(r.url())) seen.push(r.url())
      })
      await openAs(page, role, `/money/month-end?month=${STMT.key}`)
      for (const path of ['', '/pnl', '/categories', '/aging', '/owe', '/gst', '/team']) {
        if (path) await page.goto(`/money/month-end${path}?month=${STMT.key}`)
        await expect(page.getByRole('heading', { name: /is for admins|not available to your role/ })).toBeVisible()
      }
      expect(seen, `${role} must not fetch month-end data`).toEqual([])
      if (role === 'sales') {
        await openAs(page, role, '/money/gst-register')
        await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: /Month-end/ })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0)
      }
      await page.close()
      for (const view of ['v_month_pnl', 'v_month_expense_category', 'v_month_team', 'closed_months?select=month']) {
        expect((await rest<unknown[]>(role, `${view}${view.includes('?') ? '' : '?select=*'}`)).body, `${role} ${view}`).toEqual([])
      }
      for (const fn of ['month_end_status', 'aging_as_of', 'payables_as_of']) {
        const res = await rest<unknown>(role, `rpc/${fn}`, { method: 'POST', body: fn === 'month_end_status' ? { p_month: STMT.start } : { p_date: STMT.day(28) } })
        expect(res.status === 200 ? res.body : []).toEqual([])
      }
      const close = await rest(role, 'rpc/close_month', { method: 'POST', body: { p_month: STMT.start } })
      expect(close.status).toBeGreaterThanOrEqual(400)
    }
  })

  test('axe at 1440 and 375, with the review screenshots', async ({ page }) => {
    await openAs(page, 'admin', `/money/month-end?month=${STMT.key}`)
    await expect(page.getByTestId('check-bank_unticked')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await review(page, 'm10-checklist-1440')
    expect(await axeViolations(page)).toEqual([])
    for (const path of ['pnl', 'categories', 'aging', 'owe', 'gst', 'team']) {
      await page.goto(`/money/month-end/${path}?month=${STMT.key}`)
      await page.waitForLoadState('networkidle')
      expect(await axeViolations(page), path).toEqual([])
    }
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/money/month-end?month=${STMT.key}`)
    await expect(page.getByTestId('check-bank_unticked').or(page.getByRole('navigation', { name: 'Checklist' }))).toBeVisible()
    await page.waitForLoadState('networkidle')
    await review(page, 'm10-checklist-375')
    expect(await axeViolations(page)).toEqual([])
    await page.goto(`/money/month-end/pnl?month=${STMT.key}`)
    await page.waitForLoadState('networkidle')
    await review(page, 'm10-pnl-375')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  // ---- last: close, see the sentence, reopen ------------------------------------------------------------------

  test('close is two taps, the lock holds with the exact sentence, reopen is two taps', async ({ page }) => {
    await addExpense({ paid_on: OLDER.day(12), description: 'older month' })
    await addExpense({ description: 'last month' })
    await openAs(page, 'admin', `/money/month-end?month=${STMT.key}`)
    const closeBtn = page.getByRole('button', { name: new RegExp(`^Close (through )?${STMT.name}$`) })
    await expect(closeBtn).toBeEnabled()
    await startCounting(page)
    await closeBtn.click()
    const dialog = page.getByRole('dialog', { name: `Close ${STMT.label}?` })
    await expect(dialog.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveCount(7)
    await review(page, 'm10-close-dialog-1440')
    await dialog.getByRole('button', { name: new RegExp(`^Close (through )?${STMT.name}$`) }).click()
    await expect(page.getByTestId('lock-bar')).toContainText(`${STMT.label} is closed.`)
    expect(await mouse(page)).toBe(2)
    const closed = await must(rest<{ month: string }[]>('admin', 'closed_months?select=month'))
    expect(closed.map(c => c.month)).toContain(STMT.start)
    await review(page, 'm10-closed-1440')

    // the database's own sentence, word for word
    const refused = await rest<{ message: string; code: string }>('admin', 'expenses', {
      method: 'POST',
      body: { paid_on: STMT.day(15), paid_via: 'bank', category_id: RENT, amount_pkr: 500 },
    })
    expect(refused.body).toMatchObject({ code: 'P0001', message: `${STMT.label} is closed. An admin can reopen it.` })

    // reopen: the list's button (1), then this dialog's (2)
    await startCounting(page)
    await page.getByTestId(`closed-${STMT.key}`).getByRole('button', { name: `Reopen ${STMT.label}` }).click()
    const reopen = page.getByRole('dialog', { name: `Reopen ${STMT.label}?` })
    await review(page, 'm10-reopen-dialog-1440')
    await reopen.getByRole('button', { name: `Reopen ${STMT.name}` }).click()
    await expect(page.getByTestId('lock-bar')).toHaveCount(0)
    expect(await mouse(page)).toBe(2)
    const after = await must(rest<{ month: string }[]>('admin', 'closed_months?select=month'))
    expect(after.map(c => c.month)).not.toContain(STMT.start)
    // leave the books as found
    await rest('admin', 'rpc/reopen_month', { method: 'POST', body: { p_month: OLDER.start }, prefer: 'return=minimal' })
  })
})
