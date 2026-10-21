import { devices, expect, test } from '@playwright/test'

/*
 * Owner report 2026-10-22: on a phone, adding a team member does not work. This drives the real phone flow
 * (Android Chrome profile: 412 px, touch) against the CI stack: sign in as the admin, Settings > Team, tap Add,
 * fill the form, Create account, and the one-time password shows.
 */
const PASSWORD = 'fixture-only-password'

test.use({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:4173' })

test('admin adds a person on a phone', async ({ page }) => {
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  const failed: string[] = []
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })

  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@test.invalid')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).tap()
  await expect(page).toHaveURL(/\/today$/)

  await page.goto('/settings/team')
  const add = page.getByRole('button', { name: /^Add( person)?$/ }).first()
  await expect(add).toBeVisible()
  await expect(add).toBeEnabled()
  await add.tap()

  const dialog = page.getByRole('dialog', { name: 'Add person' })
  await expect(dialog).toBeVisible()
  const stamp = Date.now()
  await dialog.getByLabel(/Full name/).fill(`Phone Person ${stamp}`)
  await dialog.getByLabel(/Email/).fill(`phone-${stamp}@test.invalid`)
  const create = dialog.getByRole('button', { name: 'Create account' })
  await create.scrollIntoViewIfNeeded()
  await create.tap()

  await expect(page.getByRole('dialog', { name: 'Account created' }), `console: ${consoleErrors.join(' | ')} | failed: ${failed.join(' | ')}`).toBeVisible({ timeout: 20_000 })
})
