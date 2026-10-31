import { UI, announcedBy, expect, liveText, markLiveRegions, open, openChase, seedChase, test } from './support'

/*
 * (d) Status messages (WCAG 4.1.3) and the Undo window (2.2.1). Screen readers announce a change inside a live region that was
 * already on the page; a region inserted together with its text is often missed (role=status most of all). So:
 *   - a toast's words must land in a live region that was waiting before the action;
 *   - the Undo toast must not be re-read every second while its countdown runs, and must say how to undo from the keyboard;
 *   - a table filter's "Showing n of m" must be announced when typing changes it.
 */

test.describe('toasts', () => {
  test('a saved toast is spoken from a live region that was already on the page', async ({ page }) => {
    await open(page, '/settings/exchange-rates')
    await markLiveRegions(page)
    await page.getByLabel(UI.rate).fill('281.5')
    await page.getByRole('button', { name: UI.saveRate }).click()
    await expect(page.getByText(UI.rateSaved).first()).toBeVisible()
    expect(await announcedBy(page, UI.rateSaved)).toBe('waiting')
  })

  test('the Undo toast is not re-read every second while its countdown runs', async ({ page }) => {
    const s = await seedChase()
    await open(page, '/todo')
    await (await openChase(page, s.ref)).button.click()
    const text = new RegExp(`${s.ref}.*marked chased|marked chased.*${s.ref}`)
    await expect(page.getByRole('button', { name: UI.undo })).toBeVisible()
    const first = await liveText(page, text)
    await page.waitForTimeout(2500)
    const later = await liveText(page, text)
    expect(first, 'the toast is in a live region').not.toBeNull()
    expect(later, 'what a screen reader reads must not change while nothing but the countdown moved').toBe(first)
  })

  test('the Undo toast tells a screen reader how to undo from the keyboard (Ctrl+Z)', async ({ page }) => {
    const s = await seedChase()
    await open(page, '/todo')
    await (await openChase(page, s.ref)).button.click()
    await expect(page.getByRole('button', { name: UI.undo })).toBeVisible()
    const said = await liveText(page, new RegExp(`${s.ref}.*marked chased|marked chased.*${s.ref}`))
    expect(said, 'the toast is in a live region').not.toBeNull()
    expect(said).toMatch(/ctrl|control|⌘|cmd/i)
  })
})

test.describe('filter result counts', () => {
  test('Companies: typing in the search announces "Showing n of m"', async ({ page, world }) => {
    await open(page, '/companies')
    await expect(page.getByText(UI.showing).first()).toBeVisible()
    await markLiveRegions(page)
    await page.getByRole('textbox', { name: UI.searchCompanies }).fill(world.customer.name)
    await expect(page.getByText(/Showing 1 of \d+/).first()).toBeVisible()
    expect(await announcedBy(page, UI.showing)).toBe('waiting')
  })
})
