import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, login, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * M03 and M11 end to end, against the local CI stack: Money > Expenses for the admin, through the real login form.
 *
 * FE-2 targets asserted here (BUILD_PLAN A6.5):
 *   One expense, default category      1 amount + Enter
 *   Five small spends in a burst       at most 5 amounts + 6 keys, 0 mouse
 *   Recurring expense                  1 tap
 *   Supplier payment from a leg        2 taps
 *   Phone, "Office tea Rs 500 cash" with a category that does not exist yet: 3 taps (Add expenses, Create, Save) (0086)
 * plus the closed-month refusal (month closed by the admin first), the engineer and sales having no access, and axe
 * (WCAG 2.2 AA) at 1440 and 375. Since the owner decision of 2026-10-19 the screen has ONE add button, "Add expenses" (the burst
 * sheet, as quick for one row); the one-expense dialog is what an order or a supplier order opens (/money/expenses?add=1...). Each test makes its own records with unique notes; the closed-month tests run last
 * because closing a month is permanent until it is reopened (and the suite reopens it).
 */
const SNACKS = 'ca7e0000-0000-4000-8000-000000000005' // Office supplies & snacks (cash)
const FUEL = 'ca7e0000-0000-4000-8000-000000000004' // Fuel & travel (cash)
const SALARIES = 'ca7e0000-0000-4000-8000-000000000001'
const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const UTILITIES = 'ca7e0000-0000-4000-8000-000000000003'
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'
const FREIGHT = 'ca7e0000-0000-4000-8000-000000000012'
/** 0087 for-month: a bill paid on day 1 to 10 is for the month before. */
const forMonthOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  if (d > 10) return day.slice(0, 7)
  const p = new Date(Date.UTC(y, m - 2, 1))
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`
}

const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)
/** A per-run base for amounts, so a retried test never meets the rows of its first attempt. */
const base = () => 20000 + Math.floor(Math.random() * 7000) * 10

interface ExpenseRow {
  id: string
  amount_pkr: number
  category_id: string
  paid_on: string
  paid_via: string
  description: string | null
  input_tax_pkr: number
  order_id: string | null
  supplier_order_id: string | null
  payee_id: string | null
  recurring_id: string | null
  period: string | null
}

const addExpense = (body: Record<string, unknown>) =>
  must(rest<ExpenseRow[]>('admin', 'expenses', { method: 'POST', body: { paid_on: today(), paid_via: 'cash', ...body } })).then(r => r[0])

const byNote = (note: string) => must(rest<ExpenseRow[]>('admin', `expenses?description=ilike.${encodeURIComponent(`${note}*`)}&select=*&order=amount_pkr`))

/** Make "Office supplies & snacks" the most used category of the last 30 days, so the default is the one in the mockup. */
async function seedFavourite() {
  const tag = `fav-${unique()}`
  for (let i = 0; i < 4; i++) await addExpense({ amount_pkr: 100 + i, category_id: SNACKS, description: tag })
}

/** What a keyboard-only person does is counted from the page itself: named keys pressed and mouse presses, after `start`. */
async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: string[]; __mouse: number }
    w.__keys = []
    w.__mouse = 0
    document.addEventListener('keydown', e => e.key.length > 1 && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key) && w.__keys.push(e.key), true)
    document.addEventListener('mousedown', () => (w.__mouse += 1), true)
  })
}
const counted = (page: Page) => page.evaluate(() => ({ keys: (window as unknown as { __keys: string[] }).__keys, mouse: (window as unknown as { __mouse: number }).__mouse }))

const expensesRequests = (page: Page) => {
  const posts: string[] = []
  page.on('request', r => {
    if (r.method() === 'POST' && r.url().includes('/rest/v1/expenses')) posts.push(r.url())
  })
  return posts
}

// A 2x2 PNG, enough for the photo path (it is read, shrunk if that helps, uploaded and recorded).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDEgAVwcAEVXAgJQ6mHVAAAAAElFTkSuQmCC', 'base64')

test.describe.configure({ mode: 'serial' })

test.describe('expenses (M03, M11)', () => {
  test('the screen has one add button, and one expense through it is one amount and Ctrl+Enter', async ({ page }) => {
    await seedFavourite()
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.getByRole('button', { name: /^Add expense/ })).toHaveCount(1)
    const posts = expensesRequests(page)
    const amount = 30000 + base()
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Office supplies & snacks')
    await startCounting(page)
    await page.keyboard.type(String(amount))
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(c.keys).toEqual(['Enter']) // 1 amount + Ctrl+Enter
    expect(c.mouse).toBe(0)
    expect(posts).toHaveLength(1)
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount}&select=*`))
    expect(row).toMatchObject({ category_id: SNACKS, paid_via: 'cash', paid_on: today() })
  })

  test('one expense in the default category is one amount and Enter (the one-expense dialog)', async ({ page }) => {
    await seedFavourite()
    await openAs(page, 'admin', '/money/expenses?add=1')
    const posts = expensesRequests(page)
    const amount = page.getByRole('textbox', { name: 'Amount, PKR' })
    await expect(amount).toBeFocused()
    // the pre-fills: most used category, today, paid via from the category
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('Office supplies & snacks')
    await expect(page.getByText('Most used in the last 30 days')).toBeVisible()
    await review(page, 'm03-add-expense-dialog-1440')
    await startCounting(page)
    await page.keyboard.type('450')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(c.keys).toEqual(['Enter']) // 1 amount + Enter
    expect(c.mouse).toBe(0)
    expect(posts).toHaveLength(1)
    // 450 is saved (the note is empty, so find it by amount and today)
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.450&paid_on=eq.${today()}&select=*`))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toMatchObject({ category_id: SNACKS, paid_via: 'cash', input_tax_pkr: 0 })
  })

  test('five small spends in a burst: at most 5 amounts and 6 keys, 0 mouse, one request', async ({ page }) => {
    await seedFavourite()
    await openAs(page, 'admin', '/money/expenses')
    const posts = expensesRequests(page)
    await page.getByRole('button', { name: 'Add expenses' }).click()
    const first = page.getByRole('textbox', { name: 'Amount, row 1' })
    await expect(first).toBeFocused()
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Office supplies & snacks')
    // filled in for you: a dashed edge, no "most used" tag on the cell (R2-12)
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveClass(/border-dashed/)
    await startCounting(page)
    const b = base()
    const amounts = [b + 1, b + 2, b + 3, b + 4, b + 5]
    for (const [i, a] of amounts.entries()) {
      await page.keyboard.type(String(a))
      if (i < amounts.length - 1) await page.keyboard.press('Enter')
    }
    await expect(page.getByRole('textbox', { name: /^Amount, row/ })).toHaveCount(5)
    await expect(page.getByRole('combobox', { name: 'Category, row 5' })).toHaveClass(/border-dashed/) // carried down, no tag
    await review(page, 'm11-burst-sheet-1440')
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(amounts).toHaveLength(5)
    expect(c.keys.length).toBeLessThanOrEqual(6)
    expect(c.keys).toEqual(['Enter', 'Enter', 'Enter', 'Enter', 'Enter']) // 4 Enters + Ctrl+Enter
    expect(c.mouse).toBe(0)
    // one atomic request, five rows, each with its own client id
    expect(posts).toHaveLength(1)
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=gte.${b + 1}&amount_pkr=lte.${b + 5}&select=*&order=amount_pkr`))
    expect(rows.map(r => r.amount_pkr)).toEqual(amounts)
    expect(rows.every(r => r.category_id === SNACKS && r.paid_via === 'cash' && r.paid_on === today())).toBe(true)
  })

  test('X1: an order cost typed in the burst sheet is tagged to its order from the keyboard; the tag is optional and Tab skips it', async ({ page }) => {
    const customer = await createCompany(uniqueName('Tag Customer'))
    const supplier = await createCompany(uniqueName('Tag Supplier'))
    const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } }))
    const [leg] = await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, reference: `PO${unique()}` } }))
    const tagged = base() + 31
    const untagged = base() + 32
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).not.toHaveValue('')
    await startCounting(page)
    await page.keyboard.type(String(tagged))
    await page.keyboard.press('Tab') // category
    await page.keyboard.type('freight') // 0087: a supplier payment is never typed here (one door: Pay)
    await page.keyboard.press('Tab') // date (the highlighted category is taken)
    await page.keyboard.press('Tab') // paid via
    await page.keyboard.press('Tab') // detail
    await page.keyboard.press('Tab') // order
    await expect(page.getByRole('combobox', { name: 'Order, row 1' })).toBeFocused()
    await page.keyboard.type(String(order.number))
    await expect(page.getByRole('option', { name: new RegExp(`ORD-0*${order.number}(?![0-9])`) }).first()).toBeVisible()
    await page.keyboard.press('Tab') // takes the first match and moves on
    await expect(page.getByRole('combobox', { name: 'Order, row 1' })).toHaveValue(new RegExp(`^ORD-0*${order.number}$`))
    await page.keyboard.press('Shift+Tab') // back into the order cell, which now holds a tag
    await page.keyboard.press('Enter') // an Enter in a filled row adds the next one
    await expect(page.getByRole('textbox', { name: 'Amount, row 2' })).toBeFocused()
    await page.keyboard.type(String(untagged))
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab') // category, date, paid via, note, the empty Order cell, then the photo button
    await expect(page.getByRole('button', { name: 'Add receipt photo, row 2' })).toBeFocused()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await counted(page)).mouse).toBe(0)
    const [t] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${tagged}&select=*`))
    expect(t).toMatchObject({ category_id: FREIGHT, order_id: order.id })
    expect(leg.id).toBeTruthy()
    const [u] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${untagged}&select=*`))
    expect(u).toMatchObject({ order_id: null, supplier_order_id: null })
  })

  test('the date typed is the date saved, with no waiting between the last key and Ctrl+Enter', async ({ page }) => {
    // A day of this month that is not today, so a lost date would show as today's.
    const t = today()
    const day = t.endsWith('-02') ? '03' : '02'
    const typed = `${day}/${t.slice(5, 7)}/${t.slice(0, 4)}`
    const iso = `${t.slice(0, 8)}${day}`
    const amount = base() + 77
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    // no assertion between these keys: the save must read what is on screen, not what the rows have heard of
    await page.keyboard.type(String(amount))
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.type(typed)
    await page.keyboard.press('Control+Enter') // still inside the date cell
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount}&select=paid_on`))).map(r => r.paid_on)).toEqual([iso])

    // and the same with the cursor already out of the cell
    const amount2 = amount + 1
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await page.keyboard.type(String(amount2))
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.type(typed)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount2}&select=paid_on`))).map(r => r.paid_on)).toEqual([iso])
  })

  test('a click on Save with a category half-typed saves the highlighted category; text that matches nothing is not saved', async ({ page }) => {
    const amount = base() + 88
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await page.keyboard.type(String(amount))
    await page.keyboard.press('Tab')
    await page.keyboard.type('zzz')
    await page.getByRole('button', { name: /^Save/ }).click()
    await expect(page.getByText('No category matches "zzz"')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('zzz')
    expect(await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount}&select=id`))).toHaveLength(0)
    // now half-type a real one and click Save: the highlighted match is taken, as Tab takes it
    await page.getByRole('combobox', { name: 'Category, row 1' }).fill('sal')
    await page.getByRole('button', { name: /^Save/ }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount}&select=category_id`))
    expect(rows).toHaveLength(1)
    expect(rows[0].category_id).toBe(SALARIES)
  })

  test('a different category is two or three letters, and paid via follows it', async ({ page }) => {
    await seedFavourite()
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await startCounting(page)
    const a = base() + 6
    await page.keyboard.type(String(a))
    await page.keyboard.press('Tab')
    await page.keyboard.type('fu')
    await expect(page.getByRole('option', { name: /Fuel & travel/ })).toBeVisible()
    await expect(page.getByText(/^\d+ of \d+$/)).toBeVisible() // 0086 seeds more categories; earlier tests may add one with fu in it
    await review(page, 'm11-burst-typeahead-1440')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Fuel & travel')
    // salaries is a bank category: the row's paid via follows it
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await counted(page)).mouse).toBe(0)
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${a}&select=*`))
    expect(row).toMatchObject({ category_id: FUEL, paid_via: 'cash' })
  })

  test('a receipt photo from the burst sheet is stored in expense-receipts and recorded', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses')
    const a = base() + 7
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await page.getByRole('textbox', { name: 'Amount, row 1' }).fill(String(a))
    await page.getByRole('dialog').locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('button', { name: 'Remove receipt photo, row 1' })).toBeVisible()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${a}&select=*`))
    await expect
      .poll(async () => (await must(rest<{ bucket: string; path: string }[]>('admin', `attachments?expense_id=eq.${row.id}&select=bucket,path`))).length)
      .toBe(1)
    const [att] = await must(rest<{ bucket: string; path: string }[]>('admin', `attachments?expense_id=eq.${row.id}&select=bucket,path`))
    expect(att.bucket).toBe('expense-receipts')
    expect(att.path.startsWith(`${row.id}/`)).toBe(true)
  })

  test('input tax is collapsed and optional on Freight and Clearing; any other category takes it through "Has a GST invoice" (0087)', async ({ page }) => {
    const amt = 590000 + base() + 8
    await openAs(page, 'admin', '/money/expenses?add=1')
    await expect(page.getByText('Input tax, optional')).toHaveCount(0)
    const category = page.getByRole('combobox', { name: 'Category' })
    await category.click()
    await page.keyboard.type('frei')
    await page.keyboard.press('Tab')
    await expect(category).toHaveValue('Freight')
    await page.getByRole('button', { name: /Input tax, optional/ }).click()
    await page.getByRole('textbox', { name: 'Input tax, PKR' }).fill('90,000')
    await page.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amt))
    await expect(page.getByText('Cost in margin and P&L')).toBeVisible()
    await review(page, 'm03-input-tax-1440')
    await page.getByRole('button', { name: 'Save expense' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amt}&select=*`))
    expect(row).toMatchObject({ category_id: FREIGHT, input_tax_pkr: 90000, paid_via: 'bank' })
    // any other category: no input tax field until "Has a GST invoice" is ticked
    await page.goto('/money/expenses?add=1')
    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.keyboard.type('rent')
    await page.keyboard.press('Tab')
    await expect(page.getByText('Input tax, optional')).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'More: has a GST invoice' }).click()
    await expect(page.getByRole('textbox', { name: 'Input tax, PKR' })).toBeVisible()
  })

  test('Supplier payment is offered nowhere but Pay: not in the dialog, not in the burst sheet (one door, 0087)', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses?add=1')
    await page.getByRole('combobox', { name: 'Category' }).click()
    await page.keyboard.type('supplier pay')
    await expect(page.getByRole('option', { name: /^Supplier payment/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await page.getByRole('combobox', { name: 'Category, row 1' }).click()
    await page.keyboard.type('supplier pay')
    await expect(page.getByRole('option', { name: /^Supplier payment/ })).toHaveCount(0)
    await expect(page.getByTestId('quick-add').getByRole('button', { name: 'Supplier payment' })).toHaveCount(0)
  })

  test('from a leg: Pay <supplier>, the one door for a supplier payment; the amount starts at the balance, 2 taps (0087)', async ({ page }) => {
    const customer = await createCompany(uniqueName('Leg Customer'))
    const supplier = await createCompany(uniqueName('Leg Supplier'))
    const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } })))[0]
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id } })))[0]
    await openAs(page, 'admin', '/today')
    const note = 'Owed (about) on 30 Nov, from We owe suppliers'
    await page.goto(`/money/expenses?add=1&order=${order.id}&leg=${leg.id}&amount=384497&note=${encodeURIComponent(note)}`)
    const dialog = page.getByRole('dialog', { name: `Pay ${supplier.name}` })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Supplier payment')
    await expect(dialog.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('384,497')
    await expect(dialog).toContainText(note)
    await review(page, 'm03-pay-supplier-1440')
    await startCounting(page)
    await dialog.getByRole('button', { name: 'Save payment' }).click() // tap 2 (tap 1 was Pay on the leg)
    await expect(page.getByRole('dialog')).toBeHidden()
    expect((await counted(page)).mouse).toBe(1)
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?order_id=eq.${order.id}&select=*`))
    expect(row).toMatchObject({ amount_pkr: 384497, category_id: SUPPLIER_PAYMENT, supplier_order_id: leg.id, payee_id: supplier.id, paid_via: 'bank', paid_on: today() })
  })

  test('Pay a foreign supplier: the amount in their currency, the PKR debited, bank charges as their own expense (0087)', async ({ page }) => {
    const customer = await createCompany(uniqueName('Fx Customer'))
    const supplier = await createCompany(uniqueName('Fx Supplier GmbH'))
    const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } })))[0]
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'EUR' } })))[0]
    await openAs(page, 'admin', '/today')
    await page.goto(`/money/expenses?add=1&order=${order.id}&leg=${leg.id}`)
    const dialog = page.getByRole('dialog', { name: `Pay ${supplier.name}` })
    await dialog.getByRole('textbox', { name: 'Paid in EUR' }).fill('2,430')
    await dialog.getByRole('textbox', { name: 'PKR debited from the bank' }).fill('765,450')
    await expect(dialog).toContainText('That is PKR 315 per EUR')
    await dialog.getByRole('textbox', { name: 'Bank charges, PKR' }).fill('3,250')
    await dialog.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const rows = await must(rest<(ExpenseRow & { fx_currency: string | null; fx_amount: number | null })[]>('admin', `expenses?order_id=eq.${order.id}&select=*&order=amount_pkr.desc`))
    expect(rows.map(r => [r.category_id, r.amount_pkr, r.fx_currency, r.fx_amount, r.supplier_order_id])).toEqual([
      [SUPPLIER_PAYMENT, 765450, 'EUR', 2430, leg.id],
      ['ca7e0000-0000-4000-8000-000000000008', 3250, null, null, null],
    ])
  })

  test('from an order: the last category used on it', async ({ page }) => {
    const customer = await createCompany(uniqueName('Order Customer'))
    const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id } })))[0]
    await addExpense({ amount_pkr: 1234, category_id: FUEL, order_id: order.id, description: `ord-${unique()}` })
    await openAs(page, 'admin', `/money/expenses?add=1&order=${order.id}`)
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('Fuel & travel')
    await expect(page.getByText(/Last used on ORD-/)).toBeVisible()
  })

  test('the list: by month with totals, search, filters by group, category and paid via, edit and delete', async ({ page }) => {
    const tag = `list-${unique()}`
    const [x1, x2, x3] = [base() + 11, base() + 12, base() + 13]
    await addExpense({ amount_pkr: x1, category_id: RENT, paid_via: 'bank', description: `${tag} a` })
    await addExpense({ amount_pkr: x2, category_id: SNACKS, paid_via: 'cash', description: `${tag} b` })
    await addExpense({ amount_pkr: x3, category_id: SUPPLIER_PAYMENT, paid_via: 'bank', input_tax_pkr: 333, description: `${tag} c` })
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.getByText(`${tag} a`)).toBeVisible()
    await expect(page.getByText(`${tag} c`)).toBeVisible()
    await review(page, 'm03-expenses-list-1440')
    // search: every word must match (the detail and the category here), kept in ?q=. A single letter would also match "bank".
    const search = page.getByRole('textbox', { name: 'Search expenses' })
    await search.fill(`${tag} snacks`)
    await expect(page).toHaveURL(/[?&]q=/)
    await expect(page.getByText(`${tag} b`)).toBeVisible()
    await expect(page.getByText(`${tag} a`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear search' }).click()
    // filter (the Filters sheet): group, then category, then paid via
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Filter expenses' })
    await sheet.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'Order costs' })
    await expect(page.getByText(`${tag} c`)).toBeVisible()
    await expect(page.getByText(`${tag} a`)).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Clear' }).click()
    await sheet.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Office supplies & snacks' })
    await expect(page.getByText(`${tag} b`)).toBeVisible()
    await expect(page.getByText(`${tag} a`)).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Clear' }).click()
    await sheet.getByRole('combobox', { name: 'Paid via' }).selectOption('bank')
    await expect(page.getByText(`${tag} a`)).toBeVisible()
    await expect(page.getByText(`${tag} b`)).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Clear' }).click()
    await page.keyboard.press('Escape')
    // one month total, in the toolbar beside the month; the rows sit under their groups
    await expect(page.getByTestId('expenses-month-total')).toContainText(/PKR [\d,]+ · \d+ expenses/)
    await expect(page.getByRole('table', { name: 'Expenses' }).getByRole('cell', { name: /^Order costs · \d+$/ })).toBeVisible()
    // edit (the row's menu)
    await page.getByRole('button', { name: new RegExp(`^More for Rent of ${x1}$`) }).click()
    await page.getByRole('menuitem', { name: 'Edit expense' }).click()
    const amount = page.getByRole('textbox', { name: 'Amount, PKR' })
    await expect(amount).toHaveValue(x1.toLocaleString('en-US'))
    await amount.fill('1,500')
    await page.getByRole('button', { name: 'Save expense' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(`${tag} a`)).toBeVisible()
    expect((await byNote(`${tag} a`))[0].amount_pkr).toBe(1500)
    // delete (the row's menu): one confirm that names the expense, Cancel keeps it, Delete removes it at once and for good
    const del = async () => {
      await page.getByRole('button', { name: new RegExp(`^More for Office supplies & snacks of ${x2}$`) }).click()
      await page.getByRole('menuitem', { name: 'Delete expense' }).click()
    }
    await del()
    await expect(page.getByTestId('delete-expense-what')).toContainText(`Office supplies & snacks · PKR ${x2.toLocaleString('en-US')}`)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(`${tag} b`)).toBeVisible()
    expect(await byNote(`${tag} b`)).toHaveLength(1)
    await del()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Expense deleted')).toBeVisible()
    await expect(page.getByText(`${tag} b`)).toHaveCount(0)
    expect(await byNote(`${tag} b`)).toHaveLength(0)
  })

  for (const [label, size] of [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
    test(`delete at ${label}: open the expense, Delete expense, confirm; the total drops and stays down after a reload`, async ({ page }) => {
      const tag = `del${label}-${unique()}`
      const x = base() + 21
      await addExpense({ amount_pkr: x, category_id: SNACKS, paid_via: 'cash', description: `${tag} twice` })
      await addExpense({ amount_pkr: x, category_id: SNACKS, paid_via: 'cash', description: `${tag} twice` }) // entered twice by mistake
      await page.setViewportSize(size)
      await openAs(page, 'admin', '/money/expenses')
      await expect(page.getByText(`${tag} twice`)).toHaveCount(2)
      const total = page.getByTestId('expenses-month-total')
      const count = async () => Number(/(\d+) expenses/.exec((await total.textContent()) ?? '')?.[1])
      const before = await count()
      const sum = async () => Number(/PKR ([\d,]+)/.exec((await total.textContent()) ?? '')?.[1].replace(/,/g, ''))
      const sumBefore = await sum()
      // a tap on the row (the card on a phone) opens the dialog, which has Delete
      await page.getByText(`${tag} twice`).first().click()
      const dialog = page.getByRole('dialog', { name: 'Edit expense' })
      await dialog.getByRole('button', { name: 'Delete expense' }).click()
      await page.getByRole('dialog', { name: 'Delete this expense?' }).getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Expense deleted')).toBeVisible()
      await expect(page.getByText(`${tag} twice`)).toHaveCount(1)
      await expect.poll(count).toBe(before - 1)
      await page.reload()
      await expect(page.getByText(`${tag} twice`)).toHaveCount(1)
      await expect.poll(count).toBe(before - 1)
      await expect.poll(sum).toBe(sumBefore - x)
      expect(await byNote(`${tag} twice`)).toHaveLength(1)
      if (label === '375') {
        // the card has its own visible "⋯" with Edit and Delete, at least 44px
        const more = page.getByRole('button', { name: new RegExp(`^More for Office supplies & snacks of ${x}$`) })
        const box = await more.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
        await more.click()
        await page.getByRole('menuitem', { name: 'Delete expense' }).click()
        await page.getByRole('dialog', { name: 'Delete this expense?' }).getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(page.getByText(`${tag} twice`)).toHaveCount(0)
        expect(await byNote(`${tag} twice`)).toHaveLength(0)
      }
    })
  }

  test('History: an edited amount shows "Amount", the old and new values and who changed it', async ({ page }) => {
    const tag = `hist-${unique()}`
    const was = base() + 21
    await addExpense({ amount_pkr: was, category_id: RENT, paid_via: 'bank', description: tag })
    const me = (await login('admin')).user as { id: string }
    const [admin] = await must(rest<{ name: string }[]>('admin', `users?id=eq.${me.id}&select=name`))
    await openAs(page, 'admin', `/money/expenses?q=${tag}`)
    const rowMenu = () => page.getByRole('button', { name: new RegExp(`^More for Rent of ${was}$`) })
    await rowMenu().click()
    await page.getByRole('menuitem', { name: 'Edit expense' }).click()
    await page.getByRole('textbox', { name: 'Amount, PKR' }).fill('500')
    await page.getByRole('button', { name: 'Save expense' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(tag)).toBeVisible()
    await page.getByRole('button', { name: /^More for Rent of 500$/ }).click()
    await page.getByRole('menuitem', { name: 'History' }).click()
    const panel = page.getByRole('dialog', { name: 'History' })
    await expect(panel).toBeVisible()
    const newest = panel.getByTestId('history-entry').first()
    await expect(newest).toContainText(`Amount: PKR ${was.toLocaleString('en-US')} → PKR 500`)
    await expect(newest).toContainText(admin.name)
    await expect(panel.getByText(`Entered by ${admin.name}`)).toBeVisible()
    await review(page, 'history-panel-1440')
    expect(await axeViolations(page)).toEqual([])
    // the same on a phone: a bottom sheet, with its text at 16 px
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(newest).toBeVisible()
    expect(await newest.locator('ul li').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await review(page, 'history-panel-375')
  })

  test('recurring is one tap, and only once for a month', async ({ page }) => {
    const label = `Internet ${unique()}`
    const [tpl] = await must(
      rest<{ id: string }[]>('admin', 'recurring_expenses', { method: 'POST', body: { label, category_id: UTILITIES, amount: 9500, day_of_month: 1 } }),
    )
    await openAs(page, 'admin', '/money/expenses')
    const item = page.getByTestId(`recurring-${label}`)
    await expect(item).toBeVisible()
    await review(page, 'm03-recurring-1440')
    await startCounting(page)
    await item.getByRole('button', { name: `Record ${label}` }).click()
    await expect(item.getByText('Recorded')).toBeVisible()
    expect((await counted(page)).mouse).toBe(1) // 1 tap
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?recurring_id=eq.${tpl.id}&select=*`))
    expect(rows).toHaveLength(1)
    // 0087 for-month: a template due on day 1 (to 10) pays LAST month's bill, so it is recorded for last month
    const billMonth = forMonthOf(`${today().slice(0, 7)}-01`)
    expect(rows[0]).toMatchObject({ amount_pkr: 9500, category_id: UTILITIES, period: billMonth, description: label })
    await expect(item).toContainText(`for ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${billMonth}-01T00:00:00Z`))}`)
    // (recurring_id, period) is unique: a second record for the month is refused by the database
    const again = await rest('admin', 'expenses', { method: 'POST', body: { amount_pkr: 9500, category_id: UTILITIES, paid_via: 'bank', recurring_id: tpl.id, period: billMonth } })
    expect(again.status).toBe(409)
    // and the template can be added and edited from the panel
    await page.getByRole('button', { name: 'Add recurring' }).click()
    const name = `Rent ${unique()}`
    await page.getByRole('textbox', { name: 'Name' }).fill(name)
    await page.getByRole('textbox', { name: 'Amount, PKR' }).fill('75,000')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId(`recurring-${name}`)).toBeVisible()
    await expect(page.getByTestId(`recurring-${name}`).getByRole('button', { name: `Record ${name}` })).toBeVisible()
  })

  test('sales and engineer get no access, and the database refuses them too', async ({ browser }) => {
    for (const role of ['sales', 'engineer'] as const) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
      const seen: string[] = []
      page.on('request', r => {
        if (/\/rest\/v1\/(expenses|expense_categories|recurring_expenses)/.test(r.url())) seen.push(r.url())
      })
      await openAs(page, role, '/money/expenses')
      await expect(page.getByRole('heading', { name: / is for / })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add expenses' })).toHaveCount(0)
      expect(seen, `${role} must not fetch expense data`).toEqual([])
      await page.close()
      // Row Level Security answers the same way: nothing to read, nothing to write
      const read = await rest<unknown[]>(role, 'expenses?select=id')
      expect(read.body).toEqual([])
      const write = await rest(role, 'expenses', { method: 'POST', body: { amount_pkr: 1, category_id: SNACKS, paid_via: 'cash' } })
      expect(write.status).toBeGreaterThanOrEqual(400)
    }
  })

  test('axe at 1440: the list, the single dialog and the burst sheet', async ({ page }) => {
    await seedFavourite()
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.getByRole('button', { name: 'Add expenses' })).toBeVisible()
    await expect(page.getByTestId('expenses-month-total')).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.goto('/money/expenses?add=1')
    await expect(page.getByRole('textbox', { name: 'Amount, PKR' })).toBeFocused()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await page.keyboard.type('450')
    await page.keyboard.press('Enter')
    await page.keyboard.type('600')
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
  })

  test('axe at 375: the list and the burst list with its camera button', async ({ page }) => {
    await seedFavourite()
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.getByRole('button', { name: 'Add expenses' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await review(page, 'm03-expenses-list-375')
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Add expenses' }).click()
    const first = page.getByRole('textbox', { name: 'Amount, expense 1' })
    await expect(first).toBeVisible()
    await first.fill('450')
    await page.getByRole('button', { name: 'Add a row' }).click()
    await page.getByRole('textbox', { name: 'Amount, expense 2' }).fill('600')
    // the camera button is a 44 px tap target
    const cam = page.getByRole('button', { name: 'Take a receipt photo, expense 2' })
    const box = await cam.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await page.locator('input[type=file][capture]').nth(1).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('button', { name: 'Remove receipt photo, expense 2' })).toBeVisible()
    await review(page, 'm11-burst-list-375')
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    await page.getByRole('button', { name: /^Save 2 expenses/ }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect.poll(async () => (await must(rest<ExpenseRow[]>('admin', 'expenses?amount_pkr=eq.600&select=id'))).length).toBeGreaterThan(0)
  })

  test('phone: "Office tea Rs 500 cash" with a category that does not exist yet is 3 taps, filed under Office running', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/money/expenses')
    const name = `Office tea ${unique()}`
    const posts = expensesRequests(page)
    await startCounting(page)
    await page.getByRole('button', { name: 'Add expenses' }).click() // tap 1
    const amount = page.getByRole('textbox', { name: 'Amount, expense 1' })
    await expect(amount).toBeFocused()
    await page.keyboard.type('500')
    await page.keyboard.press('Enter') // the keyboard's Next: to the category
    await expect(page.getByRole('combobox', { name: 'Category, expense 1' })).toBeFocused()
    await page.keyboard.type(name)
    await expect(page.getByText('Office running', { exact: true }).last()).toBeVisible() // "Goes under Office running"
    await review(page, 'm11-burst-create-375')
    await page.getByRole('option', { name: /^Create .*paid in cash$/ }).click() // tap 2
    await expect(page.getByRole('combobox', { name: 'Category, expense 1' })).toHaveValue(name)
    await page.getByRole('button', { name: /^Save 1 expense · PKR 500$/ }).click() // tap 3
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(c.mouse).toBe(3)
    expect(posts).toHaveLength(1)
    const [cat] = await must(rest<{ id: string; group_id: string; default_paid_via: string; grp: string }[]>('admin', `expense_categories?name=eq.${encodeURIComponent(name)}&select=*`))
    expect(cat).toMatchObject({ group_id: 'ca7e9000-0000-4000-8000-000000000001', grp: 'overhead', default_paid_via: 'cash' })
    const rows = await must(rest<ExpenseRow[]>('admin', `expenses?category_id=eq.${cat.id}&select=*`))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount_pkr: 500, paid_via: 'cash', paid_on: today() })
  })

  test('"Monthly" on a row adds a recurring template and links the expense to it, so it is not due again this month', async ({ page }) => {
    const label = `Office rent ${unique()}`
    const amount = 70000 + base()
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    await page.keyboard.type(String(amount))
    await page.getByRole('combobox', { name: 'Detail, row 1' }).fill(label)
    await page.getByRole('group', { name: 'Row 1' }).getByRole('checkbox', { name: 'Monthly' }).click()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const [tpl] = await must(rest<{ id: string; amount: number; day_of_month: number; start_month: string; active: boolean }[]>('admin', `recurring_expenses?label=eq.${encodeURIComponent(label)}&select=*`))
    // 0087 for-month: a row paid on day 1 to 10 is last month's bill, and the template starts there
    expect(tpl).toMatchObject({ amount, active: true, start_month: forMonthOf(today()), day_of_month: Math.min(Number(today().slice(8, 10)), 28) })
    const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${amount}&select=*`))
    expect(row).toMatchObject({ recurring_id: tpl.id, period: forMonthOf(today()) })
    // the recurring panel shows it recorded for this month (no Record button)
    const item = page.getByTestId(`recurring-${label}`)
    await expect(item).toBeVisible()
    await expect(item.getByText('Recorded')).toBeVisible()
    await expect(item.getByRole('button', { name: `Record ${label}` })).toHaveCount(0)
  })

  // ---- last: closing a month is permanent until it is reopened -----------------------------------------------

  test.describe('a closed month', () => {
    const prev = (() => {
      const [y, m] = today().split('-').map(Number)
      const d = new Date(Date.UTC(y, m - 2, 1))
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      return {
        start: `${key}-01`,
        day: `${key}-05`,
        typed: `05/${key.slice(5)}/${key.slice(0, 4)}`,
        label: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d),
      }
    })()
    const sentence = `${prev.label} is closed. An admin can reopen it.`

    test.beforeAll(async () => {
      // beforeAll runs again when a failed test restarts the worker; a second seed row would make the list ambiguous
      // ("before the close" twice), so the row is made only if the month does not hold it already.
      const seeded = await must(rest<ExpenseRow[]>('admin', `expenses?description=eq.${encodeURIComponent('before the close')}&paid_on=eq.${prev.day}&select=id`))
      if (seeded.length === 0) await addExpense({ amount_pkr: 11, category_id: RENT, paid_on: prev.day, paid_via: 'bank', description: 'before the close' })
      await must(rest('admin', 'rpc/close_months_through', { method: 'POST', body: { p_month: prev.start }, prefer: 'return=minimal' }))
    })
    test.afterAll(async () => {
      await rest('admin', 'rpc/reopen_month', { method: 'POST', body: { p_month: prev.start }, prefer: 'return=minimal' })
    })

    test('the burst sheet shows the sentence on the offending row; the other rows stay; nothing is saved', async ({ page }) => {
      const tag = `closed-${unique()}`
      const [c1, c2, c3] = [base() + 21, base() + 22, base() + 23]
      await openAs(page, 'admin', '/money/expenses')
      await page.getByRole('button', { name: 'Add expenses' }).click()
      await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
      // categories must have loaded before the keystrokes: "sal" resolves against that list
      await expect(page.getByRole('combobox', { name: 'Category, row 1' })).not.toHaveValue('')
      await page.keyboard.type(String(c1))
      await page.keyboard.press('Enter')
      await page.keyboard.type(String(c2))
      await page.keyboard.press('Enter')
      await page.keyboard.type(String(c3))
      await page.keyboard.press('Tab') // category
      await page.keyboard.type('sal')
      await page.keyboard.press('Tab') // date
      await expect(page.getByRole('combobox', { name: 'Category, row 3' })).toHaveValue('Salaries')
      await expect(page.getByRole('textbox', { name: 'Date, row 3' })).toBeFocused()
      await page.keyboard.type(prev.typed)
      await expect(page.getByRole('textbox', { name: 'Date, row 3' })).toHaveValue(prev.typed)
      await page.keyboard.press('Tab') // paid via
      // The cell reads the typed date one tick after it loses focus and then shows it in words ("Sat 5 Sep", in the closed month's own name). Saving before
      // that tick saves the old date, so wait for the words: input events are served before timers on a busy runner.
      await expect(page.getByRole('textbox', { name: 'Date, row 3' })).toHaveValue(new RegExp(`\\b5 ${prev.label.slice(0, 3)}`))
      await page.keyboard.press('Tab') // detail
      await page.keyboard.type(tag)
      await page.keyboard.press('Control+Enter')
      const alert = page.getByRole('alert').filter({ hasText: sentence })
      await expect(alert).toBeVisible()
      await expect(alert).toContainText('Nothing was saved')
      await expect(alert).toContainText('The other 2 rows are still here')
      await expect(page.getByText('1 row needs a change')).toBeVisible()
      // every row keeps what it held
      await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toHaveValue(c1.toLocaleString('en-US'))
      await expect(page.getByRole('textbox', { name: 'Amount, row 2' })).toHaveValue(c2.toLocaleString('en-US'))
      await expect(page.getByRole('textbox', { name: 'Amount, row 3' })).toHaveValue(c3.toLocaleString('en-US'))
      await expect(page.getByRole('combobox', { name: 'Detail, row 3' })).toHaveValue(tag)
      await review(page, 'm11-burst-closed-month-1440')
      // the whole save was refused
      expect((await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=in.(${c1},${c2})&select=id`))).length).toBe(0)
      expect(await byNote(tag)).toHaveLength(0)
      // fixing the date (today) lets the same sheet save all three
      await page.getByRole('textbox', { name: 'Date, row 3' }).fill('today')
      await page.getByRole('combobox', { name: 'Detail, row 3' }).focus()
      await expect(alert).toBeHidden() // the date was read on leaving it, which clears the row's error
      await page.keyboard.press('Control+Enter')
      await expect(page.getByRole('dialog')).toBeHidden()
      expect((await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=in.(${c1},${c2},${c3})&select=id`))).length).toBeGreaterThanOrEqual(3)
    })

    test('the single dialog shows the plain sentence under the date and keeps every entry', async ({ page }) => {
      const z = base() + 31
      await openAs(page, 'admin', '/money/expenses?add=1')
      await page.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(z))
      await page.getByRole('textbox', { name: 'Date paid' }).fill(prev.typed)
      await page.getByRole('button', { name: 'Add a detail' }).click()
      await page.getByRole('combobox', { name: 'Detail' }).fill('kept in the form')
      await page.getByRole('button', { name: 'Save expense' }).click()
      await expect(page.getByText(sentence)).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue(z.toLocaleString('en-US'))
      await expect(page.getByRole('combobox', { name: 'Detail' })).toHaveValue('kept in the form')
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      await review(page, 'm03-closed-month-dialog-1440')
      expect((await must(rest<ExpenseRow[]>('admin', `expenses?amount_pkr=eq.${z}&select=id`))).length).toBe(0)
    })

    test('the list locks a closed month: one line says so, no row can be edited or deleted', async ({ page }) => {
      await openAs(page, 'admin', '/money/expenses')
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(page.getByText('before the close')).toHaveCount(1)
      await expect(page.getByTestId('expenses-closed')).toContainText(`${prev.label} is closed.`)
      await expect(page.getByRole('link', { name: 'Open Month end' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^More for Rent of 11/ })).toHaveCount(0)
      await expect(page.getByText('Locked, the month is closed').first()).toBeAttached()
      // the database refuses too
      const [row] = await must(rest<ExpenseRow[]>('admin', `expenses?description=eq.${encodeURIComponent('before the close')}&select=*`))
      const res = await rest('admin', `expenses?id=eq.${row.id}`, { method: 'DELETE' })
      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })
})
