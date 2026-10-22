import { expect, test, type Locator, type Page } from '@playwright/test'
import { karachiDay, must, openAs, review, rest } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * Redesign phase 1 (0087), against the local CI stack: the expense gaps on top of the 0086 expense book.
 *   Quick add            "Office water Rs 500 cash" is 3 taps on Expenses; three expenses in a row 7; the row stays open
 *   For-month            a salary paid by the 10th is for last month (expenses.period), the report counts it there
 *   Cash in hand         opening, cash drawn, a cash expense, a count with its difference (admin only)
 *   Engineers' "I paid"  the engineer sends a claim with a photo; it is in no total; sales see nothing; the admin approves it
 * Each test makes its own rows with unique amounts. Fictional data only.
 */
const WATER = 'ca7e0000-0000-4000-8000-000000000018'
const FUEL = 'ca7e0000-0000-4000-8000-000000000004'
const SNACKS = 'ca7e0000-0000-4000-8000-000000000005'
const SALARIES = 'ca7e0000-0000-4000-8000-000000000001'

const today = () => karachiDay(0)
const base = () => 40000 + Math.floor(Math.random() * 7000) * 10
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDEgAVwcAEVXAgJQ6mHVAAAAAElFTkSuQmCC', 'base64')

interface ExpenseRow {
  id: string
  amount_pkr: number
  category_id: string
  paid_on: string
  paid_via: string
  period: string | null
  description: string | null
  input_tax_pkr: number
}

async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mouse: number }
    w.__mouse = 0
    document.addEventListener('mousedown', () => (w.__mouse += 1), true)
  })
}
const taps = (page: Page) => page.evaluate(() => (window as unknown as { __mouse: number }).__mouse)

/** The quick-add buttons are the most used categories of the last 30 days: make these the most used. */
async function seedUse(ids: readonly string[]) {
  for (const id of ids)
    for (let i = 0; i < 6; i++)
      await must(rest('admin', 'expenses', { method: 'POST', body: { amount_pkr: 11 + i, category_id: id, paid_on: today(), paid_via: 'cash', description: 'qa-seed' } }))
}

/** Taps a category: its button when it is one of the six, else picks it from More. */
async function pickCategory(qa: Locator, name: string) {
  const button = qa.getByRole('button', { name, exact: true })
  if (await button.count()) await button.click()
  else await qa.getByRole('combobox', { name: 'More categories' }).selectOption({ label: name })
}

const monthName = (key: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00Z`))
const prevMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

test.describe.configure({ mode: 'serial' })

test.describe('expense gaps (redesign phase 1, 0087)', () => {
  test('quick add: "Office water Rs 500 cash" is 3 taps, and three in a row are 7; the row stays open', async ({ page }) => {
    await seedUse([WATER, FUEL, SNACKS])
    await openAs(page, 'admin', '/money/expenses')
    const qa = page.getByTestId('quick-add')
    await expect(qa.getByRole('button', { name: 'Water', exact: true })).toBeVisible()
    const amount = qa.getByRole('textbox', { name: 'Amount, PKR' })
    const b = base()
    await startCounting(page)
    await amount.click() // tap 1
    await page.keyboard.type('500')
    await qa.getByRole('button', { name: 'Water', exact: true }).click() // tap 2: cash comes from the category
    await expect(qa.getByRole('button', { name: 'Cash' })).toHaveAttribute('aria-pressed', 'true')
    await qa.getByRole('button', { name: 'Save', exact: true }).click() // tap 3
    await expect(amount).toHaveValue('')
    await expect(amount).toBeFocused() // the row stays open for the next one
    expect(await taps(page)).toBe(3)
    await expect.poll(async () => (await must(rest<ExpenseRow[]>('admin', `expenses?category_id=eq.${WATER}&amount_pkr=eq.500&paid_on=eq.${today()}&select=*`))).length).toBeGreaterThan(0)

    // three more in a row: amount, category, Save each (the amount box already has the focus): 6 taps, 7 with the first
    await startCounting(page)
    await amount.click()
    for (const [amt, name] of [[b + 1, 'Fuel & travel'], [b + 2, 'Office supplies & snacks'], [b + 3, 'Water']] as const) {
      await page.keyboard.type(String(amt))
      await qa.getByRole('button', { name, exact: true }).click()
      await qa.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(amount).toHaveValue('')
    }
    expect(await taps(page)).toBe(7)
    await expect(page.getByTestId('quick-total')).toContainText('Added here: 4')
    await expect(page.getByTestId('quick-total')).toContainText('by the day paid')
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=gte.${b + 1}&amount_pkr=lte.${b + 3}&select=*&order=amount_pkr`))
    expect(rows.map(r => [r.category_id, r.paid_via])).toEqual([[FUEL, 'cash'], [SNACKS, 'cash'], [WATER, 'cash']])
    await review(page, 'p1-quick-add-1440')
    expect(await axeViolations(page)).toEqual([])
  })

  test('quick add: no Supplier payment; "Has a GST invoice" saves input tax on any category', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses')
    const qa = page.getByTestId('quick-add')
    await expect(qa.getByRole('button', { name: 'Supplier payment' })).toHaveCount(0)
    await expect(qa.getByRole('combobox', { name: 'More categories' }).locator('option', { hasText: 'Supplier payment' })).toHaveCount(0)
    const amt = base() + 7
    await qa.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amt))
    await pickCategory(qa, 'Repairs & maintenance')
    await qa.getByRole('checkbox', { name: 'More: has a GST invoice' }).click()
    await qa.getByRole('textbox', { name: 'GST on this bill (input tax), PKR' }).fill('180')
    await qa.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(qa.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('')
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amt}&select=*`))
    expect(row).toMatchObject({ category_id: 'ca7e0000-0000-4000-8000-000000000007', input_tax_pkr: 180 })
  })

  test('for-month: a salary paid on the 5th is for last month; the list says so and the report counts it there', async ({ page }) => {
    const month = today().slice(0, 7)
    const last = prevMonth(month)
    const paidOn = `${month}-05`
    const amt = 150000 + base()
    await openAs(page, 'admin', '/money/expenses')
    const qa = page.getByTestId('quick-add')
    await qa.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amt))
    await pickCategory(qa, 'Salaries')
    await qa.getByLabel('Date paid').fill(paidOn)
    await expect(page.getByTestId('quick-for-month')).toContainText('This bill is for')
    await expect(page.getByTestId('quick-for-month').getByRole('combobox')).toHaveValue(last)
    await review(page, 'p1-for-month-1440')
    await qa.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(qa.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('')
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amt}&select=*`))
    expect(row).toMatchObject({ category_id: SALARIES, paid_on: paidOn, period: last })
    // the list (by the day paid) shows it in this month, "for <last month>"
    await expect(page.getByText(`for ${monthName(last).split(' ')[0]}`).first()).toBeVisible()
    // the Expenses report for last month counts it; this month's says it was paid now for another month
    await page.goto(`/money/reports/expenses?by=month&period=${last}`)
    await expect(page.getByTestId('expense-report-paid')).toContainText('paid in another month')
    await page.goto(`/money/reports/expenses?by=month&period=${month}`)
    await expect(page.getByTestId('expense-report-paid')).toContainText('paid now for another month')
  })

  test('cash in hand: opening, cash drawn, a cash expense, then a count shows the difference', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses')
    const line = page.getByTestId('cash-in-hand')
    await expect(line).toBeVisible()
    const set = line.getByRole('button', { name: 'Set opening cash' })
    if (await set.count()) {
      await set.click()
      const d = page.getByRole('dialog', { name: 'Set opening cash' })
      await d.getByRole('textbox', { name: 'Cash in the box, PKR' }).fill('20000')
      await d.getByRole('button', { name: 'Set opening cash' }).click()
      await expect(d).toBeHidden()
    }
    const before = await must(rest<{ expected_pkr: number }[]>('admin', 'rpc/cash_in_hand', { method: 'POST', body: {} }))
    const start = Number(before[0].expected_pkr)
    await line.getByRole('button', { name: 'Cash drawn' }).click()
    const t = page.getByRole('dialog', { name: 'Cash drawn from the bank' })
    await t.getByRole('textbox', { name: 'Amount drawn, PKR' }).fill('5000')
    await t.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(t).toBeHidden()
    // a cash expense through quick add
    const qa = page.getByTestId('quick-add')
    await qa.getByRole('textbox', { name: 'Amount, PKR' }).fill('1200')
    await pickCategory(qa, 'Courier & postage')
    await qa.getByRole('button', { name: 'Cash' }).click()
    await qa.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(qa.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('')
    const expected = start + 5000 - 1200
    await expect(page.getByTestId('cash-expected')).toContainText(expected.toLocaleString('en-US'))
    // count 300 less than the books expect
    await line.getByRole('button', { name: 'Count cash' }).click()
    const c = page.getByRole('dialog', { name: 'Count cash' })
    await c.getByRole('textbox', { name: 'Cash in the box, PKR' }).fill(String(expected - 300))
    await expect(c.getByTestId('count-difference')).toContainText('Short by PKR 300')
    await review(page, 'p1-count-cash-1440')
    await c.getByRole('button', { name: 'Save count' }).click()
    await expect(c).toBeHidden()
    await expect(line).toContainText('short PKR 300')
    const [last] = await must(rest<{ counted_pkr: number; expected_pkr: number; difference_pkr: number }[]>('admin', 'cash_counts?select=*&order=created_at.desc&limit=1'))
    expect([Number(last.counted_pkr), Number(last.expected_pkr), Number(last.difference_pkr)]).toEqual([expected - 300, expected, -300])
    // admin only
    expect((await rest<unknown[]>('sales', 'cash_counts?select=id')).body).toEqual([])
    expect((await rest<unknown[]>('engineer', 'rpc/cash_in_hand', { method: 'POST', body: {} })).body).toEqual([])
  })

  test('"I paid": the engineer sends a claim with a photo; it counts nowhere; sales see nothing; the admin approves it', async ({ browser }) => {
    const amt = 2000 + Math.floor(Math.random() * 900)
    const note = `Petrol to site ${amt}`
    const eng = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
    await openAs(eng, 'engineer', '/today')
    await eng.getByRole('button', { name: /Account menu/ }).click()
    await eng.getByRole('menuitem', { name: 'I paid' }).click()
    await expect(eng).toHaveURL(/\/my-expenses$/)
    await eng.getByRole('textbox', { name: 'How much, PKR' }).fill(String(amt))
    await eng.getByLabel('What for').fill(note)
    await eng.locator('input[type=file][capture]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
    await expect(eng.getByRole('button', { name: 'Remove receipt photo' })).toBeVisible()
    await review(eng, 'p1-i-paid-375')
    expect(await axeViolations(eng)).toEqual([])
    await eng.getByRole('button', { name: 'Send for approval' }).click()
    await expect(eng.getByText(note)).toBeVisible()
    await expect(eng.getByText('Waiting').first()).toBeVisible()
    // phone: nothing scrolls sideways and inputs are 16 px or more
    expect(await eng.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await eng.evaluate(() => Math.min(...Array.from(document.querySelectorAll('input:not([type=file]), select')).map(e => parseFloat(getComputedStyle(e).fontSize))))).toBeGreaterThanOrEqual(16)

    const [claim] = await must(rest<{ id: string; status: string; amount_pkr: number }[]>('engineer', `expense_claims?note=eq.${encodeURIComponent(note)}&select=*`))
    expect(claim.status).toBe('pending')
    // the engineer cannot approve, and sales see no claim
    expect((await rest('engineer', 'rpc/approve_expense_claim', { method: 'POST', body: { p_claim: claim.id, p_category: FUEL, p_paid_how: 'cash_back' } })).status).toBeGreaterThanOrEqual(400)
    expect((await rest<unknown[]>('sales', 'expense_claims?select=id')).body).toEqual([])
    // a pending claim is not an expense
    expect(await must(rest<ExpenseRow[]>('admin', `expenses?description=ilike.${encodeURIComponent(`${note}*`)}&select=id`))).toEqual([])
    await eng.close()

    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
    await openAs(page, 'admin', '/money/expenses')
    const review1 = page.getByTestId('claims-review')
    await expect(review1).toContainText('To approve')
    const row = page.getByTestId(`claim-${claim.id}`)
    await expect(row).toContainText(note)
    await expect(row.getByRole('button', { name: 'Receipt' })).toBeVisible()
    await row.getByRole('combobox', { name: /^Category for / }).selectOption({ label: 'Fuel & travel' })
    await row.getByRole('combobox', { name: /^Paid back/ }).selectOption({ label: 'Cash given back' })
    await review(page, 'p1-to-approve-1440')
    await row.getByRole('button', { name: /^Approve / }).click()
    await expect(row).toHaveCount(0)
    const [e] = await must(rest<ExpenseRow[]>('admin', `expenses?description=ilike.${encodeURIComponent(`${note}*`)}&select=*`))
    expect(e).toMatchObject({ amount_pkr: amt, category_id: FUEL, paid_via: 'cash', paid_on: today() })
    const [after] = await must(rest<{ status: string; paid_how: string }[]>('engineer', `expense_claims?id=eq.${claim.id}&select=status,paid_how`))
    expect(after).toEqual({ status: 'approved', paid_how: 'cash_back' })
    await page.close()
  })

  test('phone 320 and 375: Expenses with quick add does not scroll sideways and its inputs are 16 px', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await openAs(page, 'admin', '/money/expenses')
      await expect(page.getByTestId('quick-add')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${width}`).toBe(true)
      const sizes = await page.getByTestId('quick-add').evaluate(el => Array.from(el.querySelectorAll('input:not([type=file]):not([type=checkbox]), select, button:not([role=checkbox])')).map(e => parseFloat(getComputedStyle(e).fontSize)))
      expect(Math.min(...sizes), `quick add text at ${width}`).toBeGreaterThanOrEqual(16)
      if (width === 375) await review(page, 'p1-quick-add-375')
    }
  })
})
