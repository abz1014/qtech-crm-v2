import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, rest, uniqueName } from '../support/stack'
import { fe2, monthBefore, openPage, ordRef, readCount, resetCount, roleContext } from './support'

/*
 * P03, the admin journey: the books for a month, from the daily scraps to the close.
 *
 *   burst-enter five expenses with the keyboard only -> match the bank statement -> review the margins and the things to check ->
 *   close the month -> the closed-month sentence refuses an edit (a new expense, a delete) -> reopen the month.
 *
 * FE-2 targets (BUILD_PLAN FE-2 and A6.5), each read from the browser's own mouse and key events:
 *   Five small spends in a burst   at most 5 amounts + 6 keys, 0 mouse, one atomic request
 *   Tick a bank item               1 tap each
 *   Monthly report viewed          1 tap (the tab)
 *   Close month (checklist seen)   2 taps          Reopen   2 taps
 * The month that is closed is last month (the current month cannot be closed). Its records, and the margin and exception cases, are made
 * through the API as the admin; the burst, the ticks, the review, the close, the refusals and the reopen are all done on screen.
 */

const SNACKS = 'ca7e0000-0000-4000-8000-000000000005' // Office supplies & snacks (cash)
const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'

const today = karachiDay(0)
const STMT = monthBefore(today, 1)
const unique = () => Math.random().toString(36).slice(2, 8)

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

async function newOrder(label: string, net?: number) {
  const customer = await createCompany(uniqueName(label))
  const order = await post<{ id: string; number: number }>('orders', { company_id: customer.id })
  if (net !== undefined) {
    await post('order_items', { order_id: order.id, position: 0, description: `${label} item`, qty: 1, unit_price_net: net })
  }
  return { customer, order }
}

/** The money in and out of last month, all by bank: two payments and two expenses to tick, and one cash expense that is never listed. */
async function seedStatementMonth() {
  const note = `stmt-${unique()}`
  const p1 = await newOrder('Statement Payer One')
  const p2 = await newOrder('Statement Payer Two')
  const amounts = { p1: 412000 + Math.floor(Math.random() * 500) * 10, p2: 188000 + Math.floor(Math.random() * 500) * 10 }
  await post('payments_in', { order_id: p1.order.id, received_on: STMT.day(18), amount: amounts.p1, reference: 'IBFT 1' })
  await post('payments_in', { order_id: p2.order.id, received_on: STMT.day(21), amount: amounts.p2, reference: 'IBFT 2' })
  const e1 = `${note}-office`
  const e2 = `${note}-site`
  await post('expenses', { paid_on: STMT.day(9), paid_via: 'bank', category_id: RENT, amount_pkr: 95000, description: e1 })
  await post('expenses', { paid_on: STMT.day(14), paid_via: 'bank', category_id: RENT, amount_pkr: 31000, description: e2 })
  // the cash one the closed-month refusal is tried on later (amount 11, so its delete button is easy to name)
  await post('expenses', { paid_on: STMT.day(5), paid_via: 'cash', category_id: RENT, amount_pkr: 11, description: 'before the close' })
  return { p1, p2, amounts, e1, e2 }
}

/** Orders for the margin and exception screens: one with its costs complete, one provisional, one overpaid. */
async function seedMargins() {
  const mk = async (label: string, net: number, supplierCost: number, complete: boolean) => {
    const o = await newOrder(label, net)
    await post('expenses', { order_id: o.order.id, amount_pkr: supplierCost, category_id: SUPPLIER_PAYMENT, paid_on: today, paid_via: 'bank', description: `${label} supplier` })
    await post('order_costs', { order_id: o.order.id, expected_cost_pkr: supplierCost, ...(complete ? { costs_complete_at: new Date().toISOString() } : {}) })
    return o
  }
  const done = await mk('Margin Done', 1000000, 700000, true)
  const prov = await mk('Margin Open', 500000, 100000, false)
  const over = await newOrder('Margin Overpaid', 10000) // gross 11,800
  await post('payments_in', { order_id: over.order.id, amount: 15000, received_on: today })
  return { done, prov, over }
}

async function seedFavouriteCategory() {
  const tag = `fav-${unique()}`
  for (let i = 0; i < 4; i++) {
    await post('expenses', { paid_on: today, paid_via: 'cash', category_id: SNACKS, amount_pkr: 100 + i, description: tag })
  }
}

/** The "Ticked, money in" figure in rupees. */
async function tickedIn(page: Page): Promise<number> {
  const text = await page.getByRole('region', { name: 'Running ticked totals' }).getByText('Ticked, money in').locator('..').innerText()
  return Number((/PKR\s*([\d,.]+)/.exec(text)?.[1] ?? 'NaN').replace(/,/g, ''))
}

test('admin: burst expenses, the bank statement, the margins, and a month closed and reopened', async ({ browser }, info) => {
  await seedFavouriteCategory()
  const stmt = await seedStatementMonth()
  const m = await seedMargins()
  const ctx = await roleContext(browser, info, 'admin')
  const sentence = `${STMT.label} is closed. An admin can reopen it.`
  const closeName = new RegExp(`^Close (through )?${STMT.name}$`)

  // ---- 1. Burst entry, keyboard only -------------------------------------------------------------------------------------------------
  await test.step('five small spends in a burst: 5 amounts + 6 keys, 0 mouse, one request', async () => {
    const page = await openPage(ctx, '/money/expenses')
    const posts: string[] = []
    page.on('request', r => {
      if (r.method() === 'POST' && r.url().includes('/rest/v1/expenses')) posts.push(r.url())
    })
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, row 1' })).toBeFocused()
    // category = the most used of the last 30 days, date = today, paid via = the category's: nothing to set
    await expect(page.getByRole('combobox', { name: 'Category, row 1' })).toHaveValue('Office supplies & snacks')
    const base = 30000 + Math.floor(Math.random() * 6000) * 10
    const amounts = [1, 2, 3, 4, 5].map(i => base + i)
    await resetCount(page)
    for (const [i, a] of amounts.entries()) {
      await page.keyboard.type(String(a))
      if (i < amounts.length - 1) await page.keyboard.press('Enter')
    }
    await expect(page.getByRole('textbox', { name: /^Amount, row/ })).toHaveCount(5)
    await expect(page.getByText('carried')).toHaveCount(4)
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await readCount(page)
    fe2('Burst: amounts typed', amounts.length, 5)
    fe2('Burst: named keys (4 Enter + Ctrl+Enter)', c.keys.length, 6)
    fe2('Burst: mouse presses after the sheet is open', c.mouse, 0)
    fe2('Burst: requests', posts.length, 1)
    expect(posts).toHaveLength(1)
    const rows = await must(rest<{ amount_pkr: number; category_id: string; paid_on: string; paid_via: string }[]>('admin', `expenses?amount_pkr=gte.${base + 1}&amount_pkr=lte.${base + 5}&select=amount_pkr,category_id,paid_on,paid_via&order=amount_pkr`))
    expect(rows.map(r => r.amount_pkr)).toEqual(amounts)
    expect(rows.every(r => r.category_id === SNACKS && r.paid_on === today && r.paid_via === 'cash')).toBe(true)
    await page.close()
  })

  // ---- 2. Tick the bank statement -------------------------------------------------------------------------------------------------------
  await test.step('tick the bank statement: one tap per item, and the ticked total moves', async () => {
    const page = await openPage(ctx, `/money/month-end/bank?month=${STMT.key}`)
    await expect(page.getByRole('group', { name: 'Statement month' })).toBeVisible()
    const rowsToTick = [
      page.getByRole('checkbox', { name: new RegExp(stmt.p1.customer.name) }),
      page.getByRole('checkbox', { name: new RegExp(stmt.p2.customer.name) }),
      page.getByTestId('bank-out').getByRole('checkbox', { name: new RegExp(`Rent, ${stmt.e1}`) }),
      page.getByTestId('bank-out').getByRole('checkbox', { name: new RegExp(`Rent, ${stmt.e2}`) }),
    ]
    for (const r of rowsToTick) await expect(r).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('bank-out').getByText('before the close')).toHaveCount(0) // cash is never listed
    const before = await tickedIn(page)
    await resetCount(page)
    for (const r of rowsToTick) {
      await r.click()
      await expect(r).toHaveAttribute('aria-checked', 'true')
    }
    fe2('Bank tick: four items, one tap each', (await readCount(page)).mouse, 4)
    await expect.poll(async () => (await tickedIn(page)) - before).toBe(stmt.amounts.p1 + stmt.amounts.p2)
    const ticked = await must(rest<{ bank_month: string | null }[]>('admin', `payments_in?order_id=in.(${stmt.p1.order.id},${stmt.p2.order.id})&select=bank_month`))
    expect(ticked.map(t => t.bank_month)).toEqual([STMT.start, STMT.start])
    const spent = await must(rest<{ bank_month: string | null }[]>('admin', `expenses?description=in.(${stmt.e1},${stmt.e2})&select=bank_month`))
    expect(spent.map(t => t.bank_month)).toEqual([STMT.start, STMT.start])
    await page.close()
  })

  // ---- 3. Margins and exceptions --------------------------------------------------------------------------------------------------------
  await test.step('review the margins and the exceptions', async () => {
    const page = await openPage(ctx, '/money/margins')
    await expect(page.getByRole('heading', { name: 'Order margins' })).toBeVisible()
    const rowOf = (o: { customer: { name: string } }) => page.getByRole('listitem').filter({ hasText: o.customer.name })
    const d = rowOf(m.done)
    await expect(d).toContainText(ordRef(m.done.order.number))
    await expect(d).toContainText('300,000') // 1,000,000 net less 700,000 paid out
    await expect(d).toContainText('Costs complete')
    const p = rowOf(m.prov)
    await expect(p).toContainText(ordRef(m.prov.order.number))
    await expect(p).toContainText('Margin not final')
    await expect(p.locator('[data-provisional]')).toHaveCount(1)
    // Things to check (the old Exceptions tab) is one row of the Month end checklist: one tap from there.
    await page.goto(`/money/month-end?month=${STMT.key}`)
    const row = page.getByTestId('check-things_to_check')
    await expect(row).toBeVisible()
    await resetCount(page)
    await row.getByRole('link').click()
    await expect(page.getByRole('heading', { name: 'Things to check', level: 2 })).toBeVisible()
    fe2('Month end to Things to check', (await readCount(page)).mouse, 1)
    const over = page.getByRole('list', { name: 'Things to check' }).getByRole('listitem').filter({ hasText: ordRef(m.over.order.number) }).filter({ hasText: 'Payments exceed total' })
    await expect(over).toContainText('Customer payments (15,000) exceed the order')
    await expect(over.getByRole('link', { name: 'View order' })).toHaveAttribute('href', `/orders/${m.over.order.id}`)
    await page.close()
  })

  // ---- 4 to 6. Close the month, try an edit, reopen --------------------------------------------------------------------------------------
  const page = await openPage(ctx, `/money/month-end?month=${STMT.key}`)

  await test.step('the checklist knows the bank is ticked; closing the month is 2 taps', async () => {
    await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: /^Month end/ })).toHaveAttribute('aria-current', 'page')
    // nothing left to tick: a clear check is not listed, it is named on the "clear" line
    await expect(page.getByTestId('check-bank_unticked')).toHaveCount(0)
    await expect(page.getByTestId('checks-clear')).toContainText('Not matched to the bank statement')
    const closeBtn = page.getByRole('button', { name: closeName })
    await expect(closeBtn).toBeEnabled()
    await resetCount(page)
    await closeBtn.click()
    const d = page.getByRole('dialog', { name: `Close ${STMT.label}?` })
    await expect(d.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveCount(7)
    await d.getByRole('button', { name: closeName }).click()
    await expect(page.getByTestId('lock-bar')).toContainText(`${STMT.label} is closed.`)
    fe2('Close the month (checklist reviewed): the button, then the confirmation', (await readCount(page)).mouse, 2)
    const closed = await must(rest<{ month: string }[]>('admin', 'closed_months?select=month'))
    expect(closed.map(c => c.month)).toContain(STMT.start)
  })

  await test.step('the closed-month sentence refuses an edit, word for word', async () => {
    // A new expense dated in the closed month: the sentence sits under the date and the entry is kept.
    const amount = 70000 + Math.floor(Math.random() * 9000)
    await page.goto('/money/expenses?add=1') // the one-expense dialog (the screen's own button opens the burst sheet)
    await page.getByRole('textbox', { name: 'Amount, PKR' }).fill(String(amount))
    await page.getByRole('textbox', { name: 'Date paid' }).fill(`05/${STMT.key.slice(5)}/${STMT.key.slice(0, 4)}`)
    await page.getByRole('button', { name: 'Save expense' }).click()
    await expect(page.getByText(sentence)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue(amount.toLocaleString('en-US'))
    expect(await must(rest<{ id: string }[]>('admin', `expenses?amount_pkr=eq.${amount}&select=id`))).toHaveLength(0)

    // Deleting one that is already in the closed month gets the same sentence, and the row stays.
    await page.goto('/money/expenses')
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByText('before the close')).toHaveCount(1)
    await page.getByRole('button', { name: /^Delete Rent of 11/ }).click()
    await page.getByRole('button', { name: 'Delete expense' }).click()
    await expect(page.getByText(sentence)).toBeVisible()
    expect(await must(rest<{ id: string }[]>('admin', `expenses?description=eq.${encodeURIComponent('before the close')}&select=id`))).toHaveLength(1)

    // The database says the same, in the same words, to anything that tries.
    const refused = await rest<{ message: string; code: string }>('admin', 'expenses', {
      method: 'POST',
      body: { paid_on: STMT.day(15), paid_via: 'bank', category_id: RENT, amount_pkr: 500 },
    })
    expect(refused.body).toMatchObject({ code: 'P0001', message: sentence })
  })

  await test.step('reopen the month: 2 taps, and the books accept an edit again', async () => {
    await page.goto(`/money/month-end?month=${STMT.key}`)
    await expect(page.getByTestId('lock-bar')).toContainText(`${STMT.label} is closed.`)
    await resetCount(page)
    await page.getByTestId(`closed-${STMT.key}`).getByRole('button', { name: `Reopen ${STMT.label}` }).click()
    await page.getByRole('dialog', { name: `Reopen ${STMT.label}?` }).getByRole('button', { name: `Reopen ${STMT.name}` }).click()
    await expect(page.getByTestId('lock-bar')).toHaveCount(0)
    fe2('Reopen the month: the list button, then the confirmation', (await readCount(page)).mouse, 2)
    const closed = await must(rest<{ month: string }[]>('admin', 'closed_months?select=month'))
    expect(closed.map(c => c.month)).not.toContain(STMT.start)
    // the same write that was refused now goes through (and is taken back, to leave the books as they were)
    const ok = await post<{ id: string }>('expenses', { paid_on: STMT.day(15), paid_via: 'bank', category_id: RENT, amount_pkr: 500, description: 'after the reopen' })
    await must(rest('admin', `expenses?id=eq.${ok.id}`, { method: 'DELETE', prefer: 'return=minimal' }))
  })

  await ctx.close()
})
