import { expect, test, type Page } from '@playwright/test'
import { karachiDay, must, openAs, rest } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * Owner request 2026-10-20, end to end on the local stack: "Office water, Rs 500, cash" added on a phone with a category that does
 * not exist yet, in under 4 taps (taps are the page's own mouse presses: typing and the keyboard's Enter are not taps), then seen in
 * this month's and this quarter's money out on Money > Reports > In vs out, which agrees with the database views.
 *   Before this change the same entry took about 12 taps: Settings, Expense categories, the name field, the paid-via menu (2),
 *   Add, Money, Expenses, Add expenses, the category field, the category, Save.
 */
const unique = () => Math.random().toString(36).slice(2, 7)
const whole = (n: number) => Math.round(n).toLocaleString('en-US').replace('-', '−')

async function countTaps(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __taps: number }
    w.__taps = 0
    document.addEventListener('mousedown', () => (w.__taps += 1), true)
  })
}
const taps = (page: Page) => page.evaluate(() => (window as unknown as { __taps: number }).__taps)

interface FlowRow {
  month: string
  money_in: number
  money_out: number
}

test.describe.configure({ mode: 'serial' })

test.describe('in vs out (owner request 2026-10-20)', () => {
  const name = `Office water ${unique()}`

  test('phone: "Office water Rs 500 cash" with a new category in under 4 taps', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.getByRole('button', { name: 'Add expenses' })).toBeVisible()
    await countTaps(page)

    await page.getByRole('button', { name: 'Add expenses' }).click() // tap 1
    const amount = page.getByRole('textbox', { name: 'Amount, expense 1' })
    await expect(amount).toBeFocused()
    await page.keyboard.type('500')
    await page.keyboard.press('Enter') // the keyboard's Next: to the category
    await expect(page.getByRole('combobox', { name: 'Category, expense 1' })).toBeFocused()
    await page.keyboard.type(name)
    await page.getByRole('option', { name: new RegExp(`Create “${name}”.*paid in cash`) }).click() // tap 2
    await expect(page.getByRole('combobox', { name: 'Category, expense 1' })).toHaveValue(name)
    await expect(page.getByRole('button', { name: /^Paid via, expense 1: Cash/ })).toBeVisible()
    await page.getByRole('button', { name: /^Save 1 expense/ }).click() // tap 3
    await expect(page.getByRole('dialog')).toBeHidden()

    const n = await taps(page)
    expect(n, `taps to add a small expense with a new category: ${n}`).toBeLessThan(4)

    const [cat] = await must(rest<{ id: string; grp: string; default_paid_via: string }[]>('admin', `expense_categories?name=eq.${encodeURIComponent(name)}&select=id,grp,default_paid_via`))
    expect(cat).toMatchObject({ grp: 'overhead', default_paid_via: 'cash' })
    const rows = await must(rest<{ amount_pkr: number; paid_via: string; paid_on: string }[]>('admin', `expenses?category_id=eq.${cat.id}&select=amount_pkr,paid_via,paid_on`))
    expect(rows).toEqual([{ amount_pkr: 500, paid_via: 'cash', paid_on: karachiDay(0) }])
  })

  test("it is in this month's and this quarter's money out, and the screen agrees with the database", async ({ page }) => {
    const today = karachiDay(0)
    const month = today.slice(0, 7)
    const q = Math.ceil(Number(month.slice(5)) / 3)
    const first = (q - 1) * 3 + 1
    const qMonths = [0, 1, 2].map(i => `${month.slice(0, 4)}-${String(first + i).padStart(2, '0')}-01`)
    const flows = await must(rest<FlowRow[]>('admin', `v_month_cash_flow?month=in.(${qMonths.join(',')})&select=month,money_in,money_out`))
    const of = (m: string) => flows.find(f => f.month === m)
    const monthOut = of(`${month}-01`)?.money_out ?? 0
    const quarterOut = qMonths.reduce((s, m) => s + Number(of(m)?.money_out ?? 0), 0)
    const quarterIn = qMonths.reduce((s, m) => s + Number(of(m)?.money_in ?? 0), 0)
    expect(monthOut).toBeGreaterThanOrEqual(500)

    await openAs(page, 'admin', '/money/reports')
    // Reports opens on the month that just ended; its In vs out line links there. This month is one tap on the arrow.
    await page.getByRole('link', { name: 'In vs out' }).first().click()
    await expect(page.getByRole('heading', { name: 'In vs out', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page).toHaveURL(new RegExp(`period=${month}`))
    await expect(page.getByTestId('in-out-explainer')).toContainText('Profit (invoiced basis)')
    await expect(page.getByTestId('cash-out')).toContainText(whole(Number(monthOut)))
    const table = page.getByRole('table', { name: /^Money out by category/ })
    await expect(table.getByText(name)).toBeVisible()
    await expect(page.getByTestId('in-out-why')).toContainText('Why profit and cash differ')
    expect(await axeViolations(page)).toEqual([])

    await page.getByRole('radio', { name: 'Quarter' }).click()
    await expect(page).toHaveURL(new RegExp(`by=quarter&period=${month.slice(0, 4)}-Q${q}`))
    await expect(page.getByTestId('cash-out')).toContainText(whole(quarterOut))
    await expect(page.getByTestId('cash-in')).toContainText(whole(quarterIn))
    await expect(page.getByRole('table', { name: /^Money out by category/ }).getByText(name)).toBeVisible()
    await expect(page.getByRole('table', { name: 'The last 4 quarters' })).toBeVisible()

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByTestId('cash-out')).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
  })

  test('sales and engineers do not get the report', async ({ page }) => {
    await openAs(page, 'sales', '/money/reports/in-out')
    await expect(page.getByTestId('cash-out')).toHaveCount(0)
    const r = await rest<FlowRow[]>('sales', 'v_month_cash_flow?select=month')
    expect(r.body).toEqual([])
  })
})
