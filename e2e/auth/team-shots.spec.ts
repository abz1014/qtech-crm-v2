import { expect, test, type Page } from '@playwright/test'

/*
 * Forest lane D2 pictures: Team (mockup 76) as the admin, written to REVIEW_DIR (CI uploads it; nothing is written locally). One person
 * with a very long name is added through the real dialog (the password dialog is pictured, then copied and closed) and deactivated, so
 * the list shows an active row, a deactivated (quiet) row and long-name wrapping. Every width is checked for sideways scroll.
 */
const PASSWORD = 'fixture-only-password'

async function picture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400)
  const width = page.viewportSize()?.width ?? 1440
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${width}: no sideways scroll`).toBeLessThanOrEqual(0)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  const h = page.viewportSize()?.height ?? 900
  const tall = await page.evaluate(() =>
    Math.max(
      ...Array.from(document.querySelectorAll('#main, #main *'))
        .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
        .map(e => e.scrollHeight + e.getBoundingClientRect().top),
      window.innerHeight,
    ),
  )
  if (tall > h) {
    await page.setViewportSize({ width, height: Math.min(Math.ceil(tall) + 120, 6000) })
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${dir}/forest-d2-team-${name}-${width}.png`, fullPage: true })
  await page.setViewportSize({ width, height: h })
}

test('Team pictures at 1440, 1024, 768, 375 and 320', async ({ browser }) => {
  test.setTimeout(150_000)
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@test.invalid')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/todo$/)

  await page.goto('/settings/team')
  await expect(page.getByRole('table', { name: 'Team' })).toBeVisible()

  // a person with a very long name, added through the dialog (the one-time password is pictured, copied, then closed)
  const stamp = Date.now()
  const name = `Zarghuna Khanzada Abbasi Rehmatullah Qureshi ${stamp}`
  await page.getByRole('button', { name: 'Add person' }).click()
  const add = page.getByRole('dialog', { name: 'Add person' })
  await add.getByLabel(/Full name/).fill(name)
  await add.getByLabel(/Email/).fill(`d2-shots-${stamp}@test.invalid`)
  await add.getByLabel(/Job title/).fill('Senior instrumentation and commissioning engineer')
  await picture(page, 'add')
  await add.getByRole('button', { name: 'Create account' }).click()
  const secret = page.getByRole('dialog', { name: 'Account created' })
  await expect(secret).toBeVisible({ timeout: 20_000 })
  await picture(page, 'password')
  await secret.getByRole('button', { name: 'Copy', exact: true }).click()
  await picture(page, 'password-copied')
  await secret.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Deactivate' }).click()
  const deact = page.getByRole('dialog', { name: `Deactivate ${name}?` })
  await picture(page, 'deactivate')
  await deact.getByRole('button', { name: /^Deactivate/ }).click()
  await expect(page.getByRole('button', { name: `Reactivate ${name}` })).toBeVisible()

  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/settings/team')
    await expect(page.getByRole('table', { name: 'Team' })).toBeVisible()
    await picture(page, 'list')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: /^Actions for / }).first().click()
  await picture(page, 'menu')
  await page.keyboard.press('Escape')
  await ctx.close()

  for (const [w, h] of [[375, 812], [320, 640]] as const) {
    const phone = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', viewport: { width: w, height: h }, hasTouch: true, isMobile: true })
    const p = await phone.newPage()
    await p.goto('/login')
    await p.getByLabel('Email').fill('admin@test.invalid')
    await p.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await p.getByRole('button', { name: 'Sign in' }).click()
    await expect(p).toHaveURL(/\/todo$/)
    await p.goto('/settings/team')
    await expect(p.getByRole('button', { name: 'Add person' })).toBeEnabled()
    await expect(p.locator('tr[data-card]').first()).toBeVisible()
    await picture(p, 'list')
    await p.locator('tr[data-card]').first().click()
    await picture(p, 'sheet')
    await phone.close()
  }
})
