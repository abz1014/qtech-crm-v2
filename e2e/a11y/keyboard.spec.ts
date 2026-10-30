import type { Page } from '@playwright/test'
import { BUGS, SCREENS, UI, asRole, knownBug, expect, focusProblems, focusSweep, focusedThing, open, openChase, seedChase, test } from './support'

/*
 * (c) Keyboard. A Tab sweep on every main screen, at the design width and at the owner's 200% zoom: each stop is visible, shows a
 * focus indicator (2.4.7), is not hidden under a sticky or fixed bar (2.4.11), and focus never falls to <body>. Then the actions
 * that are known to drop focus (2.4.3): a busy button, a row that opens a page, a dialog opened from a menu, Esc in a filter, and
 * removing a burst-sheet row; and the scroll position a new page starts at.
 */

/** Known failures per viewport and screen. */
const SWEEP_BUGS: Record<string, Record<string, keyof typeof BUGS>> = {
  // A11Y-11 (invisible focus on New RFQ) and A11Y-12 (RFQ detail obscured at 200%) are fixed.
}

const SWEEP_VIEWPORTS = [
  { name: 'at 1440x900', width: 1440, height: 900 },
  { name: 'at 200% zoom (683x330)', width: 683, height: 330 },
]

/** Puts a screen in the state worth sweeping: New RFQ with an item row, so its brand and family picks are on the page. */
async function prepare(page: Page, screen: string): Promise<void> {
  if (screen === 'New RFQ') {
    // From the keyboard: the sticky Next step bar covers the button for a pointer (BUG A11Y-12).
    await page.getByRole('button', { name: UI.addItemByHand }).focus()
    await page.keyboard.press('Enter')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
}

for (const vp of SWEEP_VIEWPORTS) {
  test.describe(`Tab sweep ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })
    for (const s of SCREENS) {
      test(`${s.name}: every stop is visible, ringed and uncovered`, async ({ page, world }) => {
        const bug = SWEEP_BUGS[vp.name]?.[s.name]
        if (bug) knownBug(BUGS[bug])
        await open(page, s.path(world))
        await prepare(page, s.name)
        expect(await focusSweep(page)).toEqual([])
      })
    }
  })
}

test.describe('Tab sweep inside overlays', () => {
  test('the burst sheet (Add expenses) at 200% zoom, where it shows cards', async ({ page }) => {
    await page.setViewportSize({ width: 683, height: 330 })
    await open(page, '/money/expenses')
    await page.getByRole('button', { name: UI.addExpenses }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await focusSweep(page, 40)).toEqual([])
  })
})

test.describe('focus after an action (2.4.3)', () => {
  test('signing in with a wrong password from the Sign in button keeps focus off <body>', async ({ browser }, info) => {
    await asRole(browser, info, null, '/login', async page => {
      await page.getByRole('textbox', { name: UI.signIn.email }).fill('sales@test.invalid')
      await page.getByLabel(UI.signIn.password).fill('not-the-password')
      await page.getByRole('button', { name: UI.signIn.submit }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText(UI.signIn.wrong)).toBeVisible()
      expect(await focusedThing(page)).not.toBe('<body>')
    })
  })

  test('the 1-tap chase on Today (a busy button) keeps focus off <body>', async ({ page }) => {
    const s = await seedChase()
    await open(page, '/todo')
    const { button } = await openChase(page, s.ref)
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: UI.undo })).toBeVisible()
    await page.waitForTimeout(500)
    expect(await focusedThing(page)).not.toBe('<body>')
  })

  test('opening a job from the Jobs list with Enter puts focus on the new page, not <body>', async ({ page, world }) => {
    await open(page, `/jobs?q=${world.rfq.number}`)
    await page.getByRole('row').filter({ hasText: `Job ${world.rfq.number}` }).first().focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(new RegExp(`/jobs/${world.rfq.number}$`))
    await page.locator('#main h1').first().waitFor({ state: 'attached' })
    await page.waitForLoadState('networkidle')
    expect(await focusedThing(page)).not.toBe('<body>')
  })

  test('a dialog opened from a row menu gives focus back when it closes', async ({ page }) => {
    await open(page, '/settings/team')
    const trigger = page.getByRole('button', { name: UI.rowActions }).first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: /job title/i }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await focusedThing(page)).not.toBe('<body>')
  })

  test('Esc twice in a table filter (clear, then leave) keeps focus off <body>', async ({ page }) => {
    await open(page, '/companies')
    const filter = page.getByRole('textbox', { name: UI.searchCompanies })
    await filter.focus()
    await filter.fill('zz')
    await page.keyboard.press('Escape')
    await expect(filter).toHaveValue('')
    await page.keyboard.press('Escape')
    expect(await focusedThing(page)).not.toBe('<body>')
  })

  test('removing a burst-sheet row leaves focus on something visible with a ring', async ({ page }) => {
    await open(page, '/money/expenses')
    await page.getByRole('button', { name: UI.addExpenses }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // The sheet focuses row 1's amount once it has opened: typing before that lands nowhere and no second row is ever added.
    await expect(page.getByRole('textbox', { name: /^Amount, (row|expense) 1$/ })).toBeFocused()
    await page.keyboard.type('450')
    await page.keyboard.press('Enter')
    await page.keyboard.type('600')
    const remove = page.getByRole('button', { name: /^Remove (row|expense) 2$/ })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(remove).toHaveCount(0)
    expect(await focusProblems(page)).toEqual([])
  })
})

test.describe('a new page starts at the top (2.4.3)', () => {
  test('moving to another screen from the tab bar resets the scroll of #main', async ({ page }) => {
    await page.setViewportSize({ width: 683, height: 330 })
    // A list page: detail pages hide the tab bar on a phone while their own action bar shows.
    await open(page, '/money/gst-register')
    await page.locator('#main').evaluate(m => (m.scrollTop = m.scrollHeight))
    expect(await page.locator('#main').evaluate(m => m.scrollTop), 'the page must be tall enough to scroll at 330px').toBeGreaterThan(0)
    await page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).locator('a[href="/companies"]').click()
    await page.waitForURL(/\/companies$/)
    await page.waitForLoadState('networkidle')
    // React Router 7 commits the new screen inside a transition: the address changes first, the list a moment later.
    await expect
      .poll(() => page.locator('#main').evaluate(m => m.scrollHeight - m.clientHeight), { message: 'Companies must be tall enough to scroll at 330px' })
      .toBeGreaterThan(0)
    expect(await page.locator('#main').evaluate(m => m.scrollTop)).toBe(0)
  })
})
