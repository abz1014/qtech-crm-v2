import { mkdirSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'

/*
 * The Forest cohesion review after round 4 (polish-d): pictures of every Settings page (admin, sales, engineer), Team (list, Add person,
 * the one-time password, Deactivate, the phone sheet), Help (list, an answer), the Keyboard shortcuts sheet, the command palette (idle,
 * typing, results) at 1440, 375 and 320 (phones are touch devices, as a real phone is), the History panel, the shell (rail and top bar,
 * the phone bars for admin and engineer) and a sample of earlier screens for cross-app consistency. Written to REVIEW_DIR as
 * `pd-<name>-<width>.png` (CI uploads it; nothing is written locally). Each picture is checked for sideways scroll (soft). Synthetic
 * data only; a very long company name and person name test the wrapping. Named zz- so it runs after the settings specs that count rows.
 */
const RENT = 'ca7e0000-0000-4000-8000-000000000002'
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase()

async function pic(page: Page, name: string, opts: { grow?: boolean } = {}): Promise<void> {
  const size = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.waitForTimeout(500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${size.width}: no sideways scroll`).toBeLessThanOrEqual(0)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  if (opts.grow !== false) {
    const tall = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll('#main, #main *'))
          .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
          .map(e => e.scrollHeight + e.getBoundingClientRect().top),
        window.innerHeight,
      ),
    )
    if (tall > size.height) {
      await page.setViewportSize({ width: size.width, height: Math.min(Math.ceil(tall) + 120, 8000) })
      await page.waitForTimeout(300)
    }
  }
  await page.screenshot({ path: `${dir}/pd-${name}-${size.width}.png`, fullPage: true, animations: 'disabled', caret: 'hide' })
  await page.setViewportSize(size)
}

async function screen(page: Page, name: string, path: string): Promise<void> {
  await page.goto(path)
  await page.locator('#main').waitFor()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined)
  await pic(page, name)
}

const SIZES = { 1440: [1440, 900], 1024: [1024, 768], 768: [768, 1024], 375: [375, 812], 320: [320, 640] } as const
type Width = keyof typeof SIZES

/** A signed-in page at `width`; phones are touch devices (as a real phone is), so touch-only rules show. */
async function as(browser: Browser, role: Role, width: Width, path = '/todo') {
  const [w, h] = SIZES[width]
  const phone = width < 768
  const ctx = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: w, height: h },
    hasTouch: phone,
    isMobile: phone,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await ctx.newPage()
  await openAs(page, role, path)
  return { page, close: () => ctx.close() }
}

const ADMIN_PAGES: Array<[string, string]> = [
  ['/settings/company', 'company-admin'],
  ['/settings/targets', 'targets'],
  ['/settings/categories', 'categories'],
  ['/settings/product-categories', 'product-categories'],
  ['/settings/tax-deadlines', 'tax'],
  ['/settings/exchange-rates', 'rates'],
  ['/settings/backups', 'backups'],
  ['/settings/export', 'export'],
  ['/settings/details', 'details-admin'],
  ['/settings/password', 'password-admin'],
]


test.describe('Forest review pictures (round 4)', () => {
  test.setTimeout(600_000)
  let company = ''
  let expenseTag = ''
  let expenseAmount = 0

  test.beforeAll(async () => {
    company = (await createCompany(uniqueName('Pakistan Petroleum Refinery and Industrial Gases (Private) Limited, Karachi Works'))).name
    await createCompany(uniqueName('Kestrel Power'))
    expenseTag = `pd-${unique()}`
    expenseAmount = 4000 + Math.floor(Math.random() * 900)
    const [row] = await must(
      rest<{ id: string }[]>('admin', 'expenses', {
        method: 'POST',
        body: { paid_on: karachiDay(0), paid_via: 'cash', amount_pkr: expenseAmount + 1, category_id: RENT, description: expenseTag },
      }),
    )
    await must(rest('admin', `expenses?id=eq.${row.id}`, { method: 'PATCH', body: { amount_pkr: expenseAmount }, prefer: 'return=minimal' }))
  })

  for (const width of [1440, 375] as Width[]) {
    test(`Settings, every page as admin at ${width}`, async ({ browser }) => {
      const { page, close } = await as(browser, 'admin', width, '/settings')
      if (width === 375) await screen(page, 'settings-list', '/settings')
      for (const [path, name] of ADMIN_PAGES) await screen(page, name, path)
      await close()
    })

    for (const role of ['sales', 'engineer'] as Role[]) {
      test(`Settings as ${role} at ${width}`, async ({ browser }) => {
        const { page, close } = await as(browser, role, width, '/settings')
        await screen(page, `settings-home-${role}`, '/settings')
        await screen(page, `company-${role}`, '/settings/company')
        await screen(page, `details-${role}`, '/settings/details')
        await close()
      })
    }

    test(`Team at ${width}: list, Add person, the password, Deactivate, the phone sheet`, async ({ browser }) => {
      const { page, close } = await as(browser, 'admin', width, '/settings/team')
      await expect(page.getByRole('button', { name: 'Add person' })).toBeEnabled()
      await pic(page, 'team')
      const stamp = `${Date.now()}${width}`
      const name = `Zarghuna Khanzada Abbasi Rehmatullah Qureshi ${stamp}`
      await page.getByRole('button', { name: 'Add person' }).click()
      const add = page.getByRole('dialog', { name: 'Add person' })
      await add.getByLabel(/Full name/).fill(name)
      await add.getByLabel(/Email/).fill(`pd-${stamp}@test.invalid`)
      await add.getByLabel(/Job title/).fill('Senior instrumentation and commissioning engineer')
      await pic(page, 'team-add', { grow: false })
      await add.getByRole('button', { name: 'Create account' }).click()
      const secret = page.getByRole('dialog', { name: 'Account created' })
      await expect(secret).toBeVisible({ timeout: 20_000 })
      await pic(page, 'team-password', { grow: false })
      // Done waits until the one-time password was copied
      await secret.getByRole('button', { name: 'Copy', exact: true }).click()
      await secret.getByRole('button', { name: 'Done' }).click()
      if (width === 1440) {
        await page.getByRole('button', { name: `Actions for ${name}` }).click()
        await pic(page, 'team-menu', { grow: false })
        await page.getByRole('menuitem', { name: 'Deactivate' }).click()
      } else {
        await page.locator('tr[data-card]', { hasText: name }).click()
        await pic(page, 'team-sheet', { grow: false })
        await page.getByRole('button', { name: 'Deactivate' }).click()
      }
      await expect(page.getByRole('dialog', { name: `Deactivate ${name}?` })).toBeVisible()
      await pic(page, 'team-deactivate', { grow: false })
      await page.keyboard.press('Escape')
      await close()
    })

    test(`Help and shortcuts at ${width}`, async ({ browser }) => {
      const { page, close } = await as(browser, 'sales', width, '/todo?help=')
      const help = page.getByRole('dialog', { name: 'Help' })
      await expect(help).toBeVisible()
      await pic(page, 'help', { grow: false })
      await help.getByRole('button', { name: 'Log a new RFQ' }).first().click()
      await expect(help.getByRole('heading', { name: /Log a new RFQ/ })).toBeFocused()
      await pic(page, 'help-answer', { grow: false })
      await page.keyboard.press('Escape')
      await expect(help).toBeHidden()
      await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => undefined)
      await page.keyboard.press('Shift+Slash')
      const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
      if (await sheet.isVisible({ timeout: 3000 }).catch(() => false)) await pic(page, 'shortcuts', { grow: false })
      await close()
    })

    test(`History panel at ${width}`, async ({ browser }) => {
      const { page, close } = await as(browser, 'admin', width, `/money/expenses?q=${expenseTag}`)
      await page.getByRole('button', { name: new RegExp(`^More for Rent of ${expenseAmount}$`) }).click()
      await page.getByRole('menuitem', { name: 'History' }).click()
      const panel = page.getByRole('dialog', { name: 'History' })
      await expect(panel.getByTestId('history-entry').first()).toBeVisible()
      await pic(page, 'history', { grow: false })
      await close()
    })

    test(`Shell and earlier screens at ${width}`, async ({ browser }) => {
      for (const role of ['admin', 'engineer'] as Role[]) {
        const { page, close } = await as(browser, role, width)
        await screen(page, `home-${role}`, '/todo')
        if (role === 'admin') {
          await screen(page, 'companies', '/companies')
          await screen(page, 'sell', '/jobs?lane=sell')
          await screen(page, 'money', '/money')
          await screen(page, 'expenses', '/money/expenses')
        } else {
          await screen(page, 'jobs-engineer', '/jobs')
          await screen(page, 'ipaid-engineer', '/my-expenses')
        }
        await close()
      }
    })
  }

  for (const width of [1024, 768] as Width[]) {
    test(`Team and History at ${width}`, async ({ browser }) => {
      const { page, close } = await as(browser, 'admin', width, '/settings/team')
      await expect(page.getByRole('button', { name: 'Add person' })).toBeEnabled()
      await expect(page.getByRole('table', { name: 'Team' }).getByRole('row').nth(1)).toBeVisible()
      await pic(page, 'team')
      await page.goto(`/money/expenses?q=${expenseTag}`)
      await page.getByRole('button', { name: new RegExp(`^More for Rent of ${expenseAmount}$`) }).click()
      await page.getByRole('menuitem', { name: 'History' }).click()
      await expect(page.getByRole('dialog', { name: 'History' }).getByTestId('history-entry').first()).toBeVisible()
      await pic(page, 'history', { grow: false })
      await close()
    })
  }

  for (const width of [1440, 375, 320] as Width[]) {
    test(`Command palette at ${width}: idle, typing, results`, async ({ browser }) => {
      const { page, close } = await as(browser, 'admin', width)
      await page.keyboard.press('Control+k')
      const box = page.getByPlaceholder('Search or jump to')
      await expect(box).toBeFocused()
      await pic(page, 'palette-idle', { grow: false })
      await box.pressSequentially('Pak', { delay: 30 })
      await pic(page, 'palette-typing', { grow: false })
      await box.pressSequentially(company.slice(3, 20), { delay: 10 })
      await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
      await page.waitForLoadState('networkidle')
      await pic(page, 'palette-results', { grow: false })
      await close()
    })
  }
})
