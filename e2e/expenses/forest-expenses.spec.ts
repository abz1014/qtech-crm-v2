import { expect, test, type Page } from '@playwright/test'
import { karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'

/*
 * Forest lane C5 (expenses, mockups 60-expenses, 61-add-expenses, 62-claims-recurring, 63-my-expenses): pictures of Money > Expenses,
 * the Add expenses sheet, the Add expense dialog and I paid (engineer and sales), written to REVIEW_DIR (CI uploads it; nothing is
 * written locally). Each width is checked for sideways scroll, so a long payee, note or category never runs off a phone. Synthetic data.
 */
const SNACKS = 'ca7e0000-0000-4000-8000-000000000005'
const FUEL = 'ca7e0000-0000-4000-8000-000000000004'
const UTILITIES = 'ca7e0000-0000-4000-8000-000000000003'
const FREIGHT = 'ca7e0000-0000-4000-8000-000000000012'

const rpc = (role: Role, fn: string, body: unknown) => rest(role, `rpc/${fn}`, { method: 'POST', body })

/** No sideways scroll, then the whole page (the window grown to the content: #main scrolls inside a one-viewport shell). */
async function shoot(page: Page, name: string, w: number, h: number, dialog = false): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name}: no sideways scroll at ${w}`).toBeLessThanOrEqual(0)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  if (!dialog) {
    const tall = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll('#main, #main *'))
          .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
          .map(e => e.scrollHeight + e.getBoundingClientRect().top),
        window.innerHeight,
      ),
    )
    if (tall > h) {
      await page.setViewportSize({ width: w, height: Math.min(Math.ceil(tall) + 120, 6000) })
      await page.waitForTimeout(300)
    }
  }
  await page.screenshot({ path: `${dir}/forest-c5-${name}-${w}.png`, fullPage: !dialog })
  await page.setViewportSize({ width: w, height: h })
}

const WIDTHS = [
  [1440, 900],
  [768, 1024],
  [375, 812],
  [320, 640],
] as const

test.describe.configure({ mode: 'serial' })

test('Forest expenses: the page, the sheet, the dialog and I paid, at 1440, 768, 375 and 320', async ({ page, browser }) => {
  test.setTimeout(300_000)
  const today = karachiDay(0)
  const rows = [
    { category_id: FREIGHT, paid_on: today, amount_pkr: 1850, paid_via: 'cash', description: 'Courier to Multan' },
    { category_id: FUEL, paid_on: karachiDay(-1), amount_pkr: 12400, paid_via: 'cash', description: 'Diesel for the site van, Sheikhupura and back, with toll at the motorway plaza' },
    { category_id: SNACKS, paid_on: karachiDay(-2), amount_pkr: 640, paid_via: 'cash', description: 'Tea and biscuits' },
    { category_id: UTILITIES, paid_on: karachiDay(-2), amount_pkr: 24000, paid_via: 'bank', description: 'Electricity, office' },
  ]
  for (const body of rows) await must(rest('admin', 'expenses', { method: 'POST', body }))
  await must(rest('admin', 'recurring_expenses', { method: 'POST', body: { label: uniqueName('Internet'), category_id: UTILITIES, amount: 9500, day_of_month: 1 } }))

  // claims: two waiting from the engineer, one from sales, one approved as owed, one not approved (the engineer's own list shows each)
  const [waiting] = await must(rest<{ id: string }[]>('engineer', 'expense_claims', { method: 'POST', body: { amount_pkr: 8400, note: 'Fuel for the site visit to Pak-Meridian Integrated Process Automation, Sheikhupura' } }))
  expect(waiting.id).toBeTruthy()
  const [owed] = await must(rest<{ id: string }[]>('engineer', 'expense_claims', { method: 'POST', body: { amount_pkr: 6250, note: 'Customer lunch' } }))
  await must(rpc('admin', 'owe_expense_claim', { p_claim: owed.id, p_category: FUEL }))
  const [refused] = await must(rest<{ id: string }[]>('engineer', 'expense_claims', { method: 'POST', body: { amount_pkr: 300, note: 'Parking' } }))
  await must(rest('admin', `expense_claims?id=eq.${refused.id}`, { method: 'PATCH', body: { status: 'rejected', reject_reason: 'Parking is paid by the customer on this job' } }))

  await openAs(page, 'admin', '/money/expenses')
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/money/expenses')
    await expect(page.locator('[data-table-root]').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    await shoot(page, 'expenses', w, h)
  }

  for (const [w, h] of [WIDTHS[0], WIDTHS[2]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/money/expenses?burst=1')
    // the sheet is a table of rows from 1280 wide and a card per expense below it
    const amount = page.getByRole('textbox', { name: /^Amount, (row|expense) 1$/ })
    await expect(amount).toBeVisible()
    await amount.fill('4500')
    await page.waitForTimeout(300)
    await shoot(page, 'add-expenses', w, h, true)

    await page.goto('/money/expenses?add=1')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await shoot(page, 'add-expense', w, h, true)
  }

  for (const role of ['engineer', 'sales'] as const) {
    // sales's own claim is taken back straight after its pictures: another spec asserts that sales see no claim
    const [mine] = role === 'sales' ? await must(rest<{ id: string }[]>('sales', 'expense_claims', { method: 'POST', body: { amount_pkr: 1200, note: 'Taxi to the client meeting' } })) : [null]
    // a fresh context per role: the admin's session would skip the sign-in form
    const ctx = await browser.newContext()
    const mePage = await ctx.newPage()
    try {
      await openAs(mePage, role, '/my-expenses')
      for (const [w, h] of [WIDTHS[0], WIDTHS[2]]) {
        await mePage.setViewportSize({ width: w, height: h })
        await mePage.goto('/my-expenses')
        await expect(mePage.locator('#main')).toBeVisible()
        await mePage.waitForLoadState('networkidle')
        await mePage.waitForTimeout(400)
        await shoot(mePage, `ipaid-${role}`, w, h)
      }
    } finally {
      await ctx.close()
      if (mine) await must(rest('sales', `expense_claims?id=eq.${mine.id}`, { method: 'DELETE' }))
    }
  }
})
