import { UI, asRole, axe, expect, open, openChase, seedChase, test } from './support'

/*
 * (a) axe, strict, on the screens and states that no feature suite runs it on: Settings home, Team, My details, Company profile,
 * Exchange rates, the Recurring expenses panel and dialog, the Invoice detail dialog, the sign-in errors, No access, Not found,
 * open menus, the command palette and the Undo toast. Pages at 1440 and 375, overlays at 1440 (axe on a portalled overlay runs
 * with the landmark rule off, as every other suite does).
 */

const SETTINGS: Array<[string, string]> = [
  ['Settings home', '/settings'],
  ['Team', '/settings/team'],
  ['My details', '/settings/details'],
  ['Company profile', '/settings/company'],
  ['Exchange rates', '/settings/exchange-rates'],
]

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
]) {
  test.describe(`axe at ${viewport.width}`, () => {
    test.use({ viewport })

    for (const [name, path] of SETTINGS) {
      test(`${name}`, async ({ page }) => {
        await open(page, path)
        expect(await axe(page)).toEqual([])
      })
    }

    test('Expenses with a recurring template, and the recurring dialog', async ({ page, world }) => {
      await open(page, '/money/expenses')
      await expect(page.getByText(world.recurring).first()).toBeVisible()
      expect(await axe(page)).toEqual([])
      await page.getByRole('button', { name: UI.addRecurring }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await axe(page, { landmarks: false })).toEqual([])
    })

    test('the Invoice detail dialog', async ({ page, world }) => {
      await open(page, `/money/gst-register?invoice=${world.invoice.id}`)
      await expect(page.getByRole('dialog', { name: new RegExp(world.invoice.number) })).toBeVisible()
      expect(await axe(page, { landmarks: false })).toEqual([])
    })

    test('Team: a row menu open', async ({ page }) => {
      test.skip(viewport.width < 768, 'a phone has no row menu button on Team (its actions live in the row sheet)')
      await open(page, '/settings/team')
      await page.getByRole('button', { name: UI.rowActions }).first().click()
      await expect(page.getByRole('menu').or(page.getByRole('dialog')).first()).toBeVisible()
      expect(await axe(page, { landmarks: false })).toEqual([])
    })

    test('Team: the Add person dialog', async ({ page }) => {
      await open(page, '/settings/team')
      await page.getByRole('button', { name: UI.addPerson }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await axe(page, { landmarks: false })).toEqual([])
    })

    test('sign-in: the field errors, the wrong-password banner and the deactivated banner', async ({ browser }, info) => {
      await asRole(browser, info, null, '/login', async page => {
        await page.getByRole('button', { name: UI.signIn.submit }).click()
        await expect(page.getByRole('textbox', { name: UI.signIn.email })).toHaveAttribute('aria-invalid', 'true')
        expect(await axe(page), 'empty form').toEqual([])
        await page.getByRole('textbox', { name: UI.signIn.email }).fill('sales@test.invalid')
        await page.getByLabel(UI.signIn.password).fill('not-the-password')
        await page.getByRole('button', { name: UI.signIn.submit }).click()
        await expect(page.getByText(UI.signIn.wrong)).toBeVisible()
        expect(await axe(page), 'wrong password').toEqual([])
        await page.getByRole('textbox', { name: UI.signIn.email }).fill('deactivated@test.invalid')
        await page.getByLabel(UI.signIn.password).fill('fixture-only-password')
        await page.getByRole('button', { name: UI.signIn.submit }).click()
        await expect(page.getByText(UI.signIn.deactivated).first()).toBeVisible()
        expect(await axe(page), 'deactivated').toEqual([])
      })
    })

    test('No access (an engineer opens Money) and Not found', async ({ browser, page }, info) => {
      await asRole(browser, info, 'engineer', '/money/gst-register', async eng => {
        await eng.locator('#main h1').first().waitFor({ state: 'attached' })
        await eng.waitForLoadState('networkidle')
        expect(await axe(eng), 'no access').toEqual([])
      })
      await open(page, '/no-such-page')
      expect(await axe(page), 'not found').toEqual([])
    })
  })
}

test.describe('axe on open overlays at 1440', () => {
  test('the account menu', async ({ page }) => {
    await open(page, '/todo')
    await page.getByRole('button', { name: UI.accountMenu }).filter({ visible: true }).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    expect(await axe(page, { landmarks: false })).toEqual([])
  })

  test('the More actions menu on a company and on an order', async ({ page, world }) => {
    await open(page, `/companies/${world.customer.id}`)
    await page.getByRole('button', { name: UI.moreActions }).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    expect(await axe(page, { landmarks: false }), 'company').toEqual([])
    await page.keyboard.press('Escape')
    await open(page, `/orders/${world.order.id}`)
    await page.getByRole('button', { name: UI.moreActions }).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    expect(await axe(page, { landmarks: false }), 'order').toEqual([])
  })

  test('the command palette', async ({ page }) => {
    await open(page, '/todo')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: UI.palette })).toBeVisible()
    expect(await axe(page, { landmarks: false })).toEqual([])
  })

  test('Today with the Undo toast showing', async ({ page }) => {
    const s = await seedChase()
    await open(page, '/todo')
    await (await openChase(page, s.ref)).button.click()
    await expect(page.getByRole('button', { name: UI.undo })).toBeVisible()
    expect(await axe(page)).toEqual([])
  })
})
