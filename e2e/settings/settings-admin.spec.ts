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
  group_id: string
  monthly_budget_pkr: number | null
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

test.describe('Settings › Expense categories (M13, groups 0082)', () => {
  const OFFICE = 'ca7e9000-0000-4000-8000-000000000001'
  const VEHICLES = 'ca7e9000-0000-4000-8000-000000000002'
  const OWNER = 'ca7e9000-0000-4000-8000-000000000006'
  const name = uniqueName('E2E Category')
  const renamed = `${name} renamed`
  const spare = uniqueName('E2E Spare')
  const mergeFrom = uniqueName('E2E Tea')
  const mergeInto = uniqueName('E2E Pantry')

  const rowOf = (page: Page, n: string) => page.locator(`[data-category="${n}"]`)
  const menuOf = async (page: Page, n: string) => {
    await page.getByRole('button', { name: `Actions for ${n}`, exact: true }).click()
    return page.getByRole('menu', { name: `Actions for ${n}`, exact: true })
  }
  const addCategory = async (page: Page, n: string, opts: { group?: string; pay?: 'Cash' | 'Bank'; budget?: string } = {}) => {
    await page.getByRole('button', { name: 'Add category' }).click()
    const dlg = page.getByRole('dialog', { name: 'Add category' })
    await dlg.getByLabel('Name', { exact: true }).fill(n)
    if (opts.group) await dlg.getByLabel('Group', { exact: true }).selectOption({ label: opts.group })
    if (opts.pay) await dlg.getByRole('radio', { name: opts.pay }).click()
    if (opts.budget) await dlg.getByLabel('Monthly budget, PKR').fill(opts.budget)
    await dlg.getByRole('button', { name: 'Add category' }).click()
    return dlg
  }

  test('lists the seeded groups in order, each with its categories, usage and this month', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await expect(page.getByRole('heading', { level: 1, name: 'Expense categories' })).toBeVisible()
    await expect(page.locator('[data-group]')).toHaveCount(6)
    expect(await page.locator('[data-group]').evaluateAll(els => els.map(e => e.getAttribute('data-group')))).toEqual([
      'Office running',
      'Vehicles',
      'Staff',
      'Bank, taxes and other',
      'Order costs',
      'Owner and loans',
    ])
    const office = page.locator('[data-group="Office running"]')
    await expect(office.locator('[data-category="Water"]')).toBeVisible()
    await expect(office.locator('[data-category="Rent"]').getByTestId('usage')).toHaveText('Usually bank · Not used yet')
    await expect(page.locator('[data-group="Vehicles"] [data-category="Token tax"]')).toBeVisible()
    await expect(page.locator('[data-group="Order costs"] [data-category="Customs duty"]')).toBeVisible()
    // every active seeded category is listed once
    const active = (await allCategories()).filter(c => c.active)
    await expect(page.locator('[data-group] [data-category]')).toHaveCount(active.length)
    await review(page, 'm13-01-list-1440')
  })

  test('add into a group with a budget, rename, move to a group of another kind, and the usual payment: each is saved', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await addCategory(page, name, { group: 'Vehicles', pay: 'Cash', budget: '5000' })
    await expect(page.getByRole('status').filter({ hasText: 'Category added' })).toBeVisible()
    await expect(page.locator(`[data-group="Vehicles"] [data-category="${name}"]`)).toBeVisible()
    const added = await categoryByName(name)
    expect(added).toMatchObject({ group_id: VEHICLES, grp: 'overhead', default_paid_via: 'cash', active: true, monthly_budget_pkr: 5000 })
    await expect(rowOf(page, name).getByTestId('budget')).toHaveText('5,000 left of 5,000')

    // a duplicate name (ignoring case) is refused on the field, nothing saved
    const dup = await addCategory(page, name.toUpperCase())
    await expect(dup.getByText('A category with this name already exists.')).toBeVisible()
    await dup.getByRole('button', { name: 'Cancel' }).click()

    // rename
    await (await menuOf(page, name)).getByRole('menuitem', { name: 'Rename' }).click()
    const ren = page.getByRole('dialog', { name: `Rename ${name}` })
    await ren.getByLabel('Name', { exact: true }).fill(renamed)
    await ren.getByRole('button', { name: 'Rename' }).click()
    await expect.poll(async () => (await categoryByName(renamed))?.id).toBe(added.id)

    // move to Owner and loans: the dialog says Profit and loss changes; the kind follows the group
    await (await menuOf(page, renamed)).getByRole('menuitem', { name: 'Move to group…' }).click()
    const mv = page.getByRole('dialog', { name: `Move ${renamed}` })
    await mv.getByLabel('Group', { exact: true }).selectOption(OWNER)
    await expect(mv.getByText('This changes Profit and loss')).toBeVisible()
    await review(page, 'm13-02-move-other-kind-1440')
    await mv.getByRole('button', { name: 'Move', exact: true }).click()
    await expect.poll(async () => (await categoryByName(renamed)).grp).toBe('non_pnl')
    expect((await categoryByName(renamed)).group_id).toBe(OWNER)
    await expect(page.locator(`[data-group="Owner and loans"] [data-category="${renamed}"]`)).toBeVisible()

    // usual payment: one choice
    await (await menuOf(page, renamed)).getByRole('menuitemradio', { name: 'Usually paid by bank' }).click()
    await expect.poll(async () => (await categoryByName(renamed)).default_paid_via).toBe('bank')
    await review(page, 'm13-03-after-edits-1440')
  })

  test('a category in use is never deleted: Archive hides it from new expenses (Undo, Bring back), the old expense keeps it', async ({ page }) => {
    const cat = await categoryByName(renamed)
    const expense = await must(rest<{ id: string }[]>('admin', 'expenses', { method: 'POST', body: { amount_pkr: 1500, category_id: cat.id } }))
    expect(expense).toHaveLength(1)

    await openAs(page, 'admin', '/settings/categories')
    await expect(rowOf(page, renamed).getByTestId('usage')).toHaveText('Usually bank · 1 use')
    const menu = await menuOf(page, renamed)
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible()
    // the database agrees: the foreign key refuses
    const del = await rest('admin', `expense_categories?id=eq.${cat.id}`, { method: 'DELETE' })
    expect(del.status).toBe(409)

    await menu.getByRole('menuitem', { name: 'Archive' }).click()
    await expect.poll(async () => (await categoryByName(renamed)).active).toBe(false)
    await expect(page.getByText(/Archived \(\d+\)/)).toBeVisible()
    // ...a new expense that names it is refused by the database, while the old expense keeps it
    const refused = await rest<{ code?: string }>('admin', 'expenses', { method: 'POST', body: { amount_pkr: 10, category_id: cat.id } })
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe('23514')
    const kept = await must(rest<{ category_id: string }[]>('admin', `expenses?id=eq.${expense[0].id}&select=category_id`))
    expect(kept[0].category_id).toBe(cat.id)
    // Undo brings it straight back
    await page.getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await categoryByName(renamed)).active).toBe(true)

    // archive again, then Bring back from the archived list
    await (await menuOf(page, renamed)).getByRole('menuitem', { name: 'Archive' }).click()
    await expect.poll(async () => (await categoryByName(renamed)).active).toBe(false)
    await page.reload()
    await page.getByText(/Archived \(\d+\)/).click()
    await review(page, 'm13-04-archived-1440')
    await (await menuOf(page, renamed)).getByRole('menuitem', { name: 'Bring back' }).click()
    await expect.poll(async () => (await categoryByName(renamed)).active).toBe(true)
  })

  test('merge moves every expense of one category into another and removes the first', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await addCategory(page, mergeFrom, { group: 'Office running', pay: 'Cash' })
    await expect(rowOf(page, mergeFrom)).toBeVisible()
    await addCategory(page, mergeInto, { group: 'Office running', pay: 'Cash' })
    await expect(rowOf(page, mergeInto)).toBeVisible()
    const from = await categoryByName(mergeFrom)
    const into = await categoryByName(mergeInto)
    expect(from.group_id).toBe(OFFICE)
    const made = await must(
      rest<{ id: string }[]>('admin', 'expenses', {
        method: 'POST',
        body: [
          { amount_pkr: 250, category_id: from.id, paid_via: 'cash', description: 'Tea' },
          { amount_pkr: 300, category_id: from.id, paid_via: 'cash', description: 'Milk' },
        ],
      }),
    )
    await page.reload()
    await (await menuOf(page, mergeFrom)).getByRole('menuitem', { name: 'Merge into…' }).click()
    const dlg = page.getByRole('dialog', { name: `Merge ${mergeFrom}` })
    await dlg.getByLabel('Merge into').selectOption(into.id)
    await expect(dlg.getByTestId('merge-summary')).toHaveText(`Moves 2 expenses and templates from "${mergeFrom}" into "${mergeInto}". "${mergeFrom}" is removed.`)
    await review(page, 'm13-05-merge-1440')
    await dlg.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Categories merged' })).toBeVisible()
    await expect(rowOf(page, mergeFrom)).toHaveCount(0)
    expect(await categoryByName(mergeFrom)).toBeUndefined()
    const moved = await must(rest<{ category_id: string }[]>('admin', `expenses?id=in.(${made.map(m => m.id).join(',')})&select=category_id`))
    expect(moved.map(m => m.category_id)).toEqual([into.id, into.id])
    await expect(rowOf(page, mergeInto).getByTestId('usage')).toHaveText('Usually cash · 2 uses')
  })

  test('a category nothing uses can be deleted after a question', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await addCategory(page, spare)
    await expect(rowOf(page, spare).getByTestId('usage')).toContainText('Not used yet')
    await (await menuOf(page, spare)).getByRole('menuitem', { name: 'Delete' }).click()
    const dlg = page.getByRole('dialog', { name: `Delete ${spare}?` })
    await expect(dlg).toContainText('Nothing uses it')
    await dlg.getByRole('button', { name: 'Delete category' }).click()
    await expect(rowOf(page, spare)).toHaveCount(0)
    expect(await categoryByName(spare)).toBeUndefined()
  })

  test('sales and engineer cannot read or change categories or groups', async ({ browser }) => {
    for (const role of ['sales', 'engineer'] as const) {
      const page = await asRole(browser, role, '/settings/categories')
      await expect(page.getByRole('heading', { name: 'Expense categories is for admins' })).toBeVisible()
      await page.context().close()
      expect(await must(rest<unknown[]>(role, 'expense_categories?select=id'))).toEqual([])
      expect(await must(rest<unknown[]>(role, 'expense_groups?select=id'))).toEqual([])
      const patch = await rest(role, 'expense_categories?name=eq.Rent', { method: 'PATCH', body: { active: false } })
      expect(patch.status === 200 ? patch.body : []).toEqual([])
      expect((await categoryByName('Rent')).active).toBe(true)
      const merge = await rest(role, 'rpc/merge_expense_categories', { method: 'POST', body: { p_from: (await categoryByName('Water')).id, p_into: (await categoryByName('Rent')).id } })
      expect(merge.status).toBeGreaterThanOrEqual(400)
      expect(await categoryByName('Water')).toBeDefined()
    }
    await login('admin')
  })

  test('axe is clean at 1440 and at 375 (menu, dialog, sheet), with 44 px row actions and no sideways scroll on a phone', async ({ page }) => {
    await openAs(page, 'admin', '/settings/categories')
    await expect(page.locator('[data-group]').first()).toBeVisible()
    expect(await axeViolations(page), 'axe at 1440').toEqual([])
    await menuOf(page, 'Water')
    expect(await axeViolations(page), 'axe at 1440, row menu open').toEqual([])
    await page.getByRole('menuitem', { name: 'Merge into…' }).click()
    await expect(page.getByRole('dialog', { name: 'Merge Water' })).toBeVisible()
    expect(await axeViolations(page), 'axe at 1440, merge dialog').toEqual([])
    await page.getByRole('button', { name: 'Cancel' }).click()

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/settings/categories')
    await page.locator('#main').waitFor()
    await expect(page.locator('[data-group]').first()).toBeVisible()
    expect(await noHorizontalScroll(page)).toBe(true)
    await review(page, 'm13-06-list-375')
    expect(await axeViolations(page), 'axe at 375').toEqual([])
    const more = page.getByRole('button', { name: 'Actions for Water', exact: true })
    const box = await more.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await more.click()
    await expect(page.getByRole('dialog', { name: 'Water' })).toBeVisible()
    await review(page, 'm13-07-row-sheet-375')
    expect(await axeViolations(page), 'axe at 375, row sheet').toEqual([])
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
