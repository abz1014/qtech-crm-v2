import { expect, test, type Browser, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'
import { karachiDay, login, must, openAs, review, rest, uniqueName, type Role } from '../support/stack'

/*
 * M06 (Settings > Targets) and M13 (Settings > Expense categories) end to end, against the local CI stack, through the
 * real login form as the fixture users. Expectations are read back from the database through the REST API as the same
 * users, so Row Level Security is what answers.
 *
 * FE-2 target asserted here: setting a target is 1 tap on the cell plus the amount (Enter saves).
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

const [YEAR, MONTH] = karachiDay().split('-').map(Number)
const QUARTER = Math.ceil(MONTH / 3)
const cellName = (person: string, q = QUARTER) => new RegExp(`^${person}, Q${q} ${YEAR} target`)

interface TargetRow {
  id: string
  user_id: string
  year: number
  quarter: number
  target_net_pkr: number
}
interface CategoryRow {
  id: string
  name: string
  grp: string
  default_paid_via: string
  sort: number
  active: boolean
}

const targetsOf = (role: Role, userId: string) =>
  must(rest<TargetRow[]>(role, `targets?user_id=eq.${userId}&year=eq.${YEAR}&quarter=eq.${QUARTER}&select=id,user_id,year,quarter,target_net_pkr`))
const categoryByName = async (name: string) => (await must(rest<CategoryRow[]>('admin', `expense_categories?name=eq.${encodeURIComponent(name)}&select=*`)))[0]
const allCategories = () => must(rest<CategoryRow[]>('admin', 'expense_categories?select=*&order=sort.asc,name.asc'))

async function asRole(browser: Browser, role: Role, path: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await openAs(page, role, path)
  return page
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe.configure({ mode: 'serial' })

test.describe('Settings › Targets (M06)', () => {
  test('admin sets a target in 1 tap plus the amount, and it shows on that person\'s Today (and nowhere else)', async ({ page, browser }) => {
    await openAs(page, 'admin', '/settings/targets')
    await expect(page.getByRole('heading', { level: 1, name: 'Targets' })).toBeVisible()
    await expect(page.getByTestId('targets-year')).toHaveText(String(YEAR))
    // the active fixture people are rows; the deactivated one is not
    await expect(page.getByRole('rowheader', { name: /Test Sales/ })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: /Test Deactivated/ })).toHaveCount(0)
    await review(page, 'm06-01-grid-empty-1440')

    // ---- one tap, then the amount
    let taps = 0
    await page.getByRole('button', { name: cellName('Test Sales') }).click()
    taps++
    const input = page.getByRole('textbox', { name: /Test Sales, Q\d \d{4} target in rupees/ })
    await expect(input).toBeFocused() // no second tap is needed to start typing
    await page.keyboard.type('9876000')
    await page.keyboard.press('Enter')
    expect(taps).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: 'Target saved' })).toBeVisible()
    // grouped in the cell
    await expect(page.getByRole('button', { name: cellName('Test Sales') })).toContainText('9,876,000')
    const saved = await targetsOf('admin', SALES)
    expect(saved).toHaveLength(1)
    expect(Number(saved[0].target_net_pkr)).toBe(9_876_000)

    // a second person, so the grid and Today show the right figure for each
    await page.getByRole('button', { name: cellName('Test Engineer') }).click()
    await page.keyboard.type('2500000')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: cellName('Test Engineer') })).toContainText('2,500,000')
    // achieved and on pace sit beside the target, as rupee figures
    const cell = page.locator(`[data-cell="${SALES}:${QUARTER}"]`)
    await expect(cell).toContainText('Achieved')
    await expect(cell).toContainText('On pace')
    expect(await cell.textContent()).not.toMatch(/\d\s?%/)
    await review(page, 'm06-02-grid-with-targets-1440')

    // ---- Today for sales reads my_target_progress only and shows this number
    const requested: string[] = []
    const salesPage = await (async () => {
      const context = await browser.newContext()
      const p = await context.newPage()
      p.on('request', r => {
        if (r.url().includes('/rest/v1/')) requested.push(new URL(r.url()).pathname.replace('/rest/v1/', ''))
      })
      await openAs(p, 'sales', '/today')
      return p
    })()
    const tile = salesPage.getByRole('region', { name: /^Your Q\d.* target$/ }).first()
    await expect(tile).toContainText('9,876,000')
    await expect(tile).not.toContainText('2,500,000') // the engineer's figure never reaches sales
    await review(salesPage, 'm06-03-sales-today-tile-1440')
    expect(requested).toContain('rpc/my_target_progress')
    expect(requested.filter(u => /^(targets|v_target_progress)/.test(u))).toEqual([])

    // ---- the admin changes it; the next load of Today shows the change
    await page.getByRole('button', { name: cellName('Test Sales') }).click()
    await page.keyboard.type('12000000')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: cellName('Test Sales') })).toContainText('12,000,000')
    await salesPage.reload()
    await expect(salesPage.getByRole('region', { name: /^Your Q\d.* target$/ }).first()).toContainText('12,000,000')
    expect((await targetsOf('admin', SALES)).length).toBe(1) // changed in place, never a second row
    await salesPage.context().close()
  })

  test('copy last quarter fills only empty cells, never overwrites, and Undo takes it back', async ({ page }) => {
    // Previous quarter for sales and admin; the current quarter already holds a number for sales.
    const prev = QUARTER === 1 ? { year: YEAR - 1, quarter: 4 } : { year: YEAR, quarter: QUARTER - 1 }
    const ADMIN = 'a0000000-0000-4000-8000-000000000001'
    await must(
      rest('admin', 'targets?on_conflict=user_id,year,quarter', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: [
          { user_id: ADMIN, year: prev.year, quarter: prev.quarter, target_net_pkr: 3_000_000 },
          { user_id: SALES, year: prev.year, quarter: prev.quarter, target_net_pkr: 1_000_000 },
        ],
      }),
    )
    await openAs(page, 'admin', '/settings/targets')
    await expect(page.getByText(/Fills 1 empty cell in Q\d \d{4}/)).toBeVisible()
    await page.getByRole('button', { name: 'Copy last quarter' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Copied Q\d \d{4}/ })).toBeVisible()
    const admin = await targetsOf('admin', ADMIN)
    expect(Number(admin[0].target_net_pkr)).toBe(3_000_000)
    expect(Number((await targetsOf('admin', SALES))[0].target_net_pkr)).toBe(12_000_000) // untouched
    await review(page, 'm06-04-copied-1440')
    await page.getByRole('status').getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await targetsOf('admin', ADMIN)).length).toBe(0)
  })

  test('the year switches back and forward, and an emptied cell removes the target', async ({ page }) => {
    await openAs(page, 'admin', '/settings/targets')
    await page.getByRole('button', { name: 'Next year' }).click()
    await expect(page.getByTestId('targets-year')).toHaveText(String(YEAR + 1))
    await expect(page.getByRole('button', { name: /Q1 \d{4} target: Set target/ }).first()).toBeVisible() // nothing set next year yet
    await page.getByRole('button', { name: 'Previous year' }).click()
    await page.getByRole('button', { name: 'Previous year' }).click()
    await expect(page.getByTestId('targets-year')).toHaveText(String(YEAR - 1))
    await page.getByRole('button', { name: 'Next year' }).click()

    await page.getByRole('button', { name: cellName('Test Engineer') }).click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Target removed' })).toBeVisible()
    await expect.poll(async () => (await targetsOf('admin', ENGINEER)).length).toBe(0)
  })

  test('sales and engineer have no Targets page and no way to read or write targets', async ({ browser }) => {
    for (const role of ['sales', 'engineer'] as const) {
      const requested: string[] = []
      const context = await browser.newContext()
      const page = await context.newPage()
      page.on('request', r => {
        if (r.url().includes('/rest/v1/')) requested.push(new URL(r.url()).pathname.replace('/rest/v1/', ''))
      })
      await openAs(page, role, '/settings/company')
      await expect(page.getByRole('link', { name: 'Targets' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Expense categories' })).toHaveCount(0)
      await page.goto('/settings/targets')
      await expect(page.getByRole('heading', { name: 'Targets is for admins' })).toBeVisible()
      await page.goto('/settings/categories')
      await expect(page.getByRole('heading', { name: 'Expense categories is for admins' })).toBeVisible()
      if (role === 'sales') await review(page, 'm06-05-sales-no-access-1440')
      expect(requested.filter(u => /^(targets|v_target_progress|expense_categories)/.test(u))).toEqual([])
      await context.close()

      // The database says the same thing as the screen: sales never sees another person's row, and cannot write.
      const mine = await must(rest<TargetRow[]>(role, 'targets?select=user_id'))
      expect(mine.every(r => r.user_id === (role === 'sales' ? SALES : ENGINEER))).toBe(true)
      expect(await must(rest<unknown[]>(role, 'v_target_progress?select=*'))).toEqual([])
      const write = await rest(role, 'targets', { method: 'POST', body: { user_id: role === 'sales' ? SALES : ENGINEER, year: YEAR, quarter: 1, target_net_pkr: 1 } })
      expect(write.status).toBeGreaterThanOrEqual(400)
      expect(await must(rest<unknown[]>(role, 'expense_categories?select=id'))).toEqual([])
    }
  })

  test('axe is clean at 1440 and at 375, and the phone layout has no sideways scroll and 44 px cells', async ({ page }) => {
    await openAs(page, 'admin', '/settings/targets')
    await expect(page.getByRole('button', { name: cellName('Test Sales') })).toBeVisible()
    expect(await axeViolations(page), 'axe at 1440').toEqual([])
    // axe with a cell open for editing too
    await page.getByRole('button', { name: cellName('Test Engineer') }).click()
    expect(await axeViolations(page), 'axe at 1440, editing').toEqual([])
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/settings/targets')
    await page.locator('#main').waitFor()
    const cell = page.getByRole('button', { name: cellName('Test Sales') })
    await expect(cell).toBeVisible()
    const box = await cell.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(await noHorizontalScroll(page)).toBe(true)
    await review(page, 'm06-06-grid-375')
    expect(await axeViolations(page), 'axe at 375').toEqual([])
    await page.getByRole('button', { name: cellName('Test Engineer') }).click()
    await expect(page.getByRole('textbox', { name: /Test Engineer/ })).toBeFocused()
    await review(page, 'm06-07-editing-375')
    expect(await axeViolations(page), 'axe at 375, editing').toEqual([])
  })
})

test.describe('Settings › Expense categories (M13)', () => {
  const name = uniqueName('E2E Category')
  const renamed = `${name} renamed`
  const spare = uniqueName('E2E Spare')

  test('lists the seeded categories in order, with usage counts', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await expect(page.getByRole('heading', { level: 1, name: 'Expense categories' })).toBeVisible()
    await expect(page.getByText('Categories in use cannot be deleted')).toBeVisible()
    const list = page.getByRole('list', { name: 'Expense categories' })
    await expect(list.getByRole('listitem')).toHaveCount((await allCategories()).length)
    expect((await allCategories()).length).toBeGreaterThanOrEqual(17)
    await expect(list.getByRole('listitem').first()).toHaveAttribute('data-category', 'Salaries')
    await expect(list.locator('[data-category="Rent"]').getByTestId('usage')).toHaveText('Not used yet')
    await review(page, 'm13-01-list-1440')
  })

  test('add, rename, change group and paid via, and reorder: each is saved', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await page.getByLabel('New category').fill(name)
    await page.getByLabel('Group', { exact: true }).selectOption('order_cost')
    await page.getByLabel('Paid via', { exact: true }).selectOption('cash')
    await page.getByRole('button', { name: 'Add category' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Category added' })).toBeVisible()
    const row = page.locator(`[data-category="${name}"]`)
    await expect(row).toBeVisible()
    const added = await categoryByName(name)
    expect(added).toMatchObject({ grp: 'order_cost', default_paid_via: 'cash', active: true })
    // a new category goes last
    const all = await allCategories()
    expect(all[all.length - 1].id).toBe(added.id)

    // a duplicate name (ignoring case) is refused on the field
    await page.getByLabel('New category').fill(name.toUpperCase())
    await page.getByRole('button', { name: 'Add category' }).click()
    await expect(page.getByText('A category with this name already exists.')).toBeVisible()
    await page.getByLabel('New category').fill('')

    // rename
    const nameInput = page.getByLabel(`Name of ${name}`)
    await nameInput.fill(renamed)
    await nameInput.press('Enter')
    await expect.poll(async () => (await categoryByName(renamed))?.id).toBe(added.id)

    // group and paid via
    await page.getByLabel(`Group of ${renamed}`).selectOption('non_pnl')
    await expect.poll(async () => (await categoryByName(renamed)).grp).toBe('non_pnl')
    await page.getByLabel(`Default paid via for ${renamed}`).selectOption('bank')
    await expect.poll(async () => (await categoryByName(renamed)).default_paid_via).toBe('bank')

    // reorder: up moves it above the one before it, and the order is the saved order
    const before = (await allCategories()).map(c => c.id)
    await page.getByRole('button', { name: `Move ${renamed} up` }).click()
    await expect
      .poll(async () => (await allCategories()).map(c => c.id))
      .toEqual([...before.slice(0, -2), before[before.length - 1], before[before.length - 2]])
    const at = (await allCategories()).findIndex(c => c.id === added.id)
    expect(at).toBe(before.length - 2)
    await expect(page.getByRole('list', { name: 'Expense categories' }).getByRole('listitem').nth(at)).toHaveAttribute('data-category', renamed)
    // and it survives a reload
    await page.reload()
    await expect(page.getByRole('list', { name: 'Expense categories' }).getByRole('listitem').nth(at)).toHaveAttribute('data-category', renamed)
    await review(page, 'm13-02-after-edits-1440')
  })

  test('a category in use cannot be deleted: the page says so and offers Deactivate, which hides it from new expenses', async ({ page }) => {
    const cat = await categoryByName(renamed)
    const expense = await must(rest<{ id: string }[]>('admin', 'expenses', { method: 'POST', body: { amount_pkr: 1500, category_id: cat.id } }))
    expect(expense).toHaveLength(1)

    await openAs(page, 'admin', '/settings/categories')
    const row = page.locator(`[data-category="${renamed}"]`)
    await expect(row.getByTestId('usage')).toHaveText('1 use')
    await row.getByRole('button', { name: `Delete ${renamed}` }).click()
    const panel = row.getByRole('group', { name: `Delete ${renamed}` })
    await expect(panel).toContainText('so it cannot be deleted')
    await expect(panel).toContainText('Deactivate it instead')
    await expect(panel.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await review(page, 'm13-03-in-use-delete-advice-1440')

    // the database agrees: the foreign key refuses
    const del = await rest('admin', `expense_categories?id=eq.${cat.id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)

    // ---- Deactivate from the advice
    await panel.getByRole('button', { name: 'Deactivate', exact: true }).click()
    await expect(row.getByText(/hidden from new expenses/)).toBeVisible()
    await expect(row.getByRole('checkbox', { name: `${renamed} is active` })).not.toBeChecked()
    await review(page, 'm13-04-deactivated-1440')

    // ---- through the data layer: what new expenses choose from (active = true) no longer includes it
    const offered = await must(rest<CategoryRow[]>('admin', 'expense_categories?active=eq.true&select=id,name&order=sort.asc,name.asc'))
    expect(offered.map(c => c.id)).not.toContain(cat.id)
    expect(offered.length).toBe((await allCategories()).length - 1)
    // ...and a new expense that names it is refused by the database, while the old expense keeps it
    const refused = await rest<{ code?: string; message?: string }>('admin', 'expenses', { method: 'POST', body: { amount_pkr: 10, category_id: cat.id } })
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('23514')
    const kept = await must(rest<{ category_id: string }[]>('admin', `expenses?id=eq.${expense[0].id}&select=category_id`))
    expect(kept[0].category_id).toBe(cat.id)

    // ---- activate again: offered again
    await row.getByRole('checkbox', { name: `${renamed} is active` }).click()
    await expect.poll(async () => (await categoryByName(renamed)).active).toBe(true)
  })

  test('a category nothing uses can be deleted after a question', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await page.getByLabel('New category').fill(spare)
    await page.getByRole('button', { name: 'Add category' }).click()
    const row = page.locator(`[data-category="${spare}"]`)
    await expect(row.getByTestId('usage')).toHaveText('Not used yet')
    await row.getByRole('button', { name: `Delete ${spare}` }).click()
    await expect(row.getByRole('group', { name: `Delete ${spare}` })).toContainText('Nothing uses it')
    await row.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(row).toHaveCount(0)
    expect(await categoryByName(spare)).toBeUndefined()
  })

  test('sales and engineer cannot read or change categories', async ({ browser }) => {
    for (const role of ['sales', 'engineer'] as const) {
      const page = await asRole(browser, role, '/settings/categories')
      await expect(page.getByRole('heading', { name: 'Expense categories is for admins' })).toBeVisible()
      await page.context().close()
      expect(await must(rest<unknown[]>(role, 'expense_categories?select=id'))).toEqual([])
      const patch = await rest(role, 'expense_categories?name=eq.Rent', { method: 'PATCH', body: { active: false } })
      expect(patch.status === 200 ? patch.body : []).toEqual([])
      expect((await categoryByName('Rent')).active).toBe(true)
    }
    await login('admin')
  })

  test('axe is clean at 1440 and at 375, with no sideways scroll on a phone', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await expect(page.getByRole('list', { name: 'Expense categories' })).toBeVisible()
    await page.locator(`[data-category="${renamed}"]`).getByRole('button', { name: `Delete ${renamed}` }).click()
    expect(await axeViolations(page), 'axe at 1440, delete advice open').toEqual([])
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await axeViolations(page), 'axe at 1440').toEqual([])

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/settings/categories')
    await page.locator('#main').waitFor()
    await expect(page.getByRole('list', { name: 'Expense categories' })).toBeVisible()
    expect(await noHorizontalScroll(page)).toBe(true)
    await review(page, 'm13-05-list-375')
    expect(await axeViolations(page), 'axe at 375').toEqual([])
    const up = await page.getByRole('button', { name: `Move ${renamed} up` }).boundingBox()
    expect(up?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})

test.describe('Settings on a phone (UX audit 2026-10-19)', () => {
  test('/settings is the list itself, in two groups; a page has one back arrow to it, and Team goes back there too', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/settings')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect(nav).toBeVisible()
    await expect(nav).toContainText('Company')
    await expect(nav).toContainText('You')
    // no sideways-scrolling strip: every link is on screen
    for (const link of await nav.getByRole('link').all()) await expect(link).toBeInViewport({ ratio: 0.5 })
    await nav.getByRole('link', { name: 'Team' }).click()
    await expect(page).toHaveURL(/\/settings\/team$/)
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Your details' }).click()
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeHidden() // the page, not the list
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await noHorizontalScroll(page)).toBe(true)
    expect(await axeViolations(page), 'axe at 375, settings list').toEqual([])
  })
})
