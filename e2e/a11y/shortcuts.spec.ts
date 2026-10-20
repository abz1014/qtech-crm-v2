import type { Page } from '@playwright/test'
import { BUGS, UI, expect, focusedThing, knownBug, open, test } from './support'

/*
 * (e) Single-key shortcuts (WCAG 2.1.4, level A). The first test documents what the app does today, so a change to it is noticed:
 * N opens New RFQ, C opens Capture, G then T goes to Today and / jumps to a table's filter, from anywhere outside a text field
 * (focus on a link or a button counts as "anywhere"). The second is the criterion: a single printable key may act only if the
 * person can turn it off or remap it, or it acts only while its own control has focus.
 */

/** Presses a key with focus on a plain link in the main navigation (not a text field, not the control the key belongs to). */
async function pressOnNavLink(page: Page, key: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link').first().focus()
  await page.keyboard.press(key)
}

test('documents today\'s single-key shortcuts: N, C, G then T, and /, outside text fields', async ({ page }) => {
  test.info().annotations.push({ type: 'behaviour', description: 'N -> /rfqs/new, C -> Capture sheet, G T -> /today, / -> table filter; active with focus on any link or button' })
  await open(page, '/today')
  await pressOnNavLink(page, 'n')
  await expect(page).toHaveURL(/\/rfqs\/new$/)

  await open(page, '/today')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('c')
  await expect(page.getByRole('dialog', { name: UI.capture })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: UI.capture })).toBeHidden()

  await open(page, '/rfqs')
  await pressOnNavLink(page, 'g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/today$/)

  await open(page, '/rfqs')
  await pressOnNavLink(page, '/')
  expect(await focusedThing(page)).toMatch(/Filter RFQs/)

  // Inside a text field the keys are only text.
  await open(page, '/companies')
  const search = page.getByRole('textbox', { name: UI.searchCompanies })
  await search.focus()
  await page.keyboard.type('nc')
  await expect(search).toHaveValue('nc')
  await expect(page).toHaveURL(/\/companies$/)
})

test('a single printable key never acts unless the person can turn it off (WCAG 2.1.4)', async ({ page }) => {
  knownBug(BUGS.shortcuts)
  // Either a setting turns single-key shortcuts off (then N must do nothing), or N needs a modifier or its own control's focus.
  await open(page, '/settings/details')
  const setting = page.getByRole('checkbox', { name: UI.shortcutsSetting }).or(page.getByRole('switch', { name: UI.shortcutsSetting }))
  if ((await setting.count()) > 0 && (await setting.first().isChecked())) await setting.first().click()
  await open(page, '/today')
  await pressOnNavLink(page, 'n')
  await page.waitForTimeout(500)
  expect(new URL(page.url()).pathname, 'N moved the page with no way to turn it off').not.toBe('/rfqs/new')
})
