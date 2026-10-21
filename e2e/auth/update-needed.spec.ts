import { expect, test, type Page } from '@playwright/test'

/*
 * Minimum app version (owner decision 2026-10-22, src/lib/pwa/minVersion.ts). Every build publishes /version.json; an app older
 * than its minSupported keeps reading, refuses saves before anything is sent, and shows "Update needed — tap Reload".
 * The "newer server" is simulated by answering /version.json with a minimum above this build.
 */
const PASSWORD = 'fixture-only-password'

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/today$/)
}

test.describe('update needed', () => {
  test('the build publishes its version and minimum; an up-to-date app shows no banner', async ({ page }) => {
    const res = await page.request.get('/version.json')
    expect(res.ok()).toBe(true)
    const v = (await res.json()) as { version: number; minSupported: number; build: string }
    expect(Number.isInteger(v.version)).toBe(true)
    expect(v.minSupported).toBeLessThanOrEqual(v.version)
    await signIn(page, 'sales@test.invalid')
    await expect(page.locator('[data-update-needed-banner]')).toHaveCount(0)
  })

  test('an app older than the minimum reads, refuses the save with the typed text kept, and Reload brings it up to date', async ({ page }) => {
    let newer = true
    await page.route('**/version.json', async route => {
      if (!newer) return route.fallback()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 9999, minSupported: 9999, build: 'e2e-newer' }) })
    })
    const writes: string[] = []
    page.on('request', r => {
      if (r.method() !== 'GET' && /\/rest\/v1\/companies/.test(r.url())) writes.push(r.url())
    })

    await signIn(page, 'sales@test.invalid')
    const banner = page.getByRole('alert').filter({ hasText: 'Update needed — tap Reload' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('saving is paused')

    // reading goes on
    await page.goto('/companies')
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()

    // a save is refused before it is sent; what was typed stays
    const name = `Update needed ${Date.now()}`
    await page.getByRole('button', { name: 'New company' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New company' })
    await dialog.getByRole('textbox', { name: /Company name/ }).fill(name)
    await dialog.getByRole('button', { name: 'Add company' }).click()
    await expect(dialog.getByText(/^Update needed: this copy of the app is out of date, so saving is paused\./)).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: /Company name/ })).toHaveValue(name)
    expect(writes).toEqual([])

    // Reload sits outside the dialog: close it (discarding the typing), then one tap reloads onto the current build. The
    // warn-before-clearing-typing path (a form still dirty on screen) is covered by UpdateNeededBanner.test.tsx.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Discard' }).click({ timeout: 3000 }).catch(() => {}) // asked only when typing would be lost
    await expect(dialog).toHaveCount(0)
    newer = false
    await banner.getByRole('button', { name: 'Reload' }).click()
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()
    await expect(page.locator('[data-update-needed-banner]')).toHaveCount(0)
  })
})
