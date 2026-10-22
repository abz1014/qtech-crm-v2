import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { must, openAs, rest, review, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * Money > Reports > Expenses (owner request 2026-10-22), end to end on the local stack. Expenses are seeded through the API in
 * April to June 2023 (months no other test uses) under a category made for the run, then the report must show, for the month
 * and for the quarter, exactly the sum of the entries the database holds (and of the seeded ones for the run's category), the
 * per-detail lines (fuel per car), the drill-down to the entries, the CSV, and nothing for sales or engineers.
 */
const OFFICE = 'ca7e9000-0000-4000-8000-000000000001'
const VEHICLES = 'ca7e9000-0000-4000-8000-000000000002'
const whole = (n: number) => Math.round(n).toLocaleString('en-US')

interface Row {
  amount_pkr: number
  paid_on: string
}

async function category(name: string, group: string): Promise<string> {
  const [c] = await must(rest<{ id: string }[]>('admin', 'expense_categories', { method: 'POST', body: { name, group_id: group, grp: 'overhead', default_paid_via: 'cash', sort: 900 } }))
  return c.id
}
async function add(categoryId: string, paid_on: string, amount_pkr: number, description: string | null, paid_via = 'cash') {
  await must(rest('admin', 'expenses', { method: 'POST', body: { category_id: categoryId, paid_on, amount_pkr, description, paid_via } }))
}
async function spentBetween(from: string, to: string): Promise<number> {
  const rows = await must(rest<Row[]>('admin', `expenses?paid_on=gte.${from}&paid_on=lte.${to}&select=amount_pkr,paid_on`))
  return rows.reduce((s, r) => s + Number(r.amount_pkr), 0)
}
async function csvOf(page: Page, name: string) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).first().click()])
  return { file: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') }
}

test.describe.configure({ mode: 'serial' })

test.describe('expenses report (2026-10-22)', () => {
  const fuel = uniqueName('Fuel report')
  const water = uniqueName('Water report')
  let fuelId = ''

  test.beforeAll(async () => {
    fuelId = await category(fuel, VEHICLES)
    const waterId = await category(water, OFFICE)
    await add(fuelId, '2023-04-05', 9000, 'LEA-1234')
    await add(fuelId, '2023-04-19', 7800.5, 'lea-1234 ')
    await add(fuelId, '2023-04-21', 3200, 'LEB-5678')
    await add(waterId, '2023-04-03', 1150, 'Office water')
    await add(waterId, '2023-05-03', 1150, 'Office water', 'bank')
    await add(fuelId, '2023-06-10', 5000, 'LEA-1234')
  })

  test('a month: the total is the sum of its entries; the run category, its details and its entries', async ({ page }) => {
    const total = await spentBetween('2023-04-01', '2023-04-30')
    expect(total).toBeGreaterThanOrEqual(21150.5)
    await openAs(page, 'admin', '/money/reports/expenses?by=month&period=2023-04')
    await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible()
    await expect(page.getByTestId('expense-report-total')).toContainText(whole(total))
    await expect(page.getByRole('table', { name: /^Where the money went/ }).getByRole('row').filter({ hasText: /^Total/ })).toContainText(whole(total))

    const row = page.getByRole('table', { name: /^Where the money went/ }).getByRole('row').filter({ hasText: fuel })
    await expect(row).toContainText(whole(20000.5))
    await row.click()
    const drill = page.getByTestId('expense-report-drill')
    await expect(drill).toContainText('LEA-1234')
    await expect(drill).toContainText(whole(16800.5)) // LEA-1234 twice: case and spaces ignored
    await expect(drill).toContainText(whole(3200))
    await expect(drill.getByRole('listitem').filter({ hasText: 'LEB-5678' })).toHaveCount(2) // the detail line and the entry
    await page.waitForLoadState('networkidle')
    await review(page, 'expense-report-month-1440')
    expect(await axeViolations(page)).toEqual([])

    const csv = await csvOf(page, 'Export CSV')
    expect(csv.file).toBe('expenses-2023-04.csv')
    expect(csv.text.split('\n')[0]).toContain('"Section"')
    expect(csv.text).toContain(fuel)

    await page.getByRole('radio', { name: 'By detail' }).click()
    await expect(page.getByTestId('expense-report-by-detail')).toContainText('LEA-1234')
  })

  test('a quarter: the sum of its three months, and the run category over the quarter', async ({ page }) => {
    const total = await spentBetween('2023-04-01', '2023-06-30')
    await openAs(page, 'admin', '/money/reports/expenses?by=quarter&period=2023-Q2')
    await expect(page.getByTestId('expense-report-period')).toContainText('Q2 2023')
    await expect(page.getByTestId('expense-report-total')).toContainText(whole(total))
    await expect(page.getByRole('table', { name: /^Where the money went/ }).getByRole('row').filter({ hasText: fuel })).toContainText(whole(25000.5))
    await expect(page.getByTestId('expense-report-trend')).toBeVisible()
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByTestId('expense-report-total')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await page.waitForLoadState('networkidle')
    await review(page, 'expense-report-quarter-375')
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
  })

  test('the Report select opens it on the month kept, and the old Expenses by category address lands on it', async ({ page }) => {
    await openAs(page, 'admin', '/money/reports?month=2023-04')
    await page.getByTestId('report-picker').selectOption('expenses')
    await expect(page).toHaveURL(/\/money\/reports\/expenses\?month=2023-04/)
    await expect(page.getByTestId('expense-report-period')).toContainText('April 2023')
    await page.goto('/money/reports/categories?month=2023-05')
    await expect(page).toHaveURL(/\/money\/reports\/expenses\?by=month&period=2023-05/)
  })

  // one test per role: each gets its own browser context, so signing in as the second role is a fresh login
  for (const role of ['sales', 'engineer'] as const) {
    test(`${role} does not get the report`, async ({ page }) => {
      await openAs(page, role, '/money/reports/expenses?by=month&period=2023-04')
      await expect(page.getByTestId('expense-report-total')).toHaveCount(0)
      const r = await rest<Row[]>(role, 'expenses?paid_on=gte.2023-04-01&select=amount_pkr')
      if (r.status < 300) expect(r.body, role).toEqual([]) // rows hidden by row security, or the request refused outright
    })
  }
})
