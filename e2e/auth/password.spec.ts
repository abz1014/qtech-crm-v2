import { expect, test, type Page } from '@playwright/test'
import { axeViolations } from '../support/axe'

/*
 * Change password against the CI stack. A throwaway person is created per test, so the shared fixture
 * passwords are never touched. Needs SERVICE_ROLE_KEY from `supabase status` (CI exports it).
 */
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
const OLD = 'old-fixture-password-1'
const NEW = 'brand-new-passphrase-2'

const service = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

async function makePerson(): Promise<{ email: string; name: string }> {
  const email = `pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.invalid`
  const name = 'Pat Password'
  const created = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: OLD, email_confirm: true }) })
  expect(created.status).toBe(200)
  const { id } = (await created.json()) as { id: string }
  const profile = await service('/rest/v1/users', { method: 'POST', body: JSON.stringify({ id, name, role: 'sales' }) })
  expect(profile.status).toBe(201)
  return { email, name }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function openChangePassword(page: Page, name: string) {
  await page.getByRole('button', { name: `Account menu, ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Change password' }).click()
  await expect(page).toHaveURL(/\/settings\/password$/)
  await expect(page.getByRole('heading', { name: 'Change password', level: 1 })).toBeVisible()
}

test.describe('change your own password', () => {
  test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack')

  test('the screen passes axe', async ({ page }) => {
    const { email, name } = await makePerson()
    await signIn(page, email, OLD)
    await expect(page).toHaveURL(/\/today$/)
    await openChangePassword(page, name)
    expect(await axeViolations(page)).toEqual([])
  })

  test('a wrong current password and a short new one are refused in plain words', async ({ page }) => {
    const { email, name } = await makePerson()
    await signIn(page, email, OLD)
    await openChangePassword(page, name)

    await page.getByLabel('Current password', { exact: true }).fill('not-my-password-1')
    await page.getByLabel('New password', { exact: true }).fill('too-short')
    await page.getByLabel('Confirm new password', { exact: true }).fill('too-short')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Use at least 12 characters.').first()).toBeVisible()

    await page.getByLabel('New password', { exact: true }).fill(NEW)
    await page.getByLabel('Confirm new password', { exact: true }).fill(NEW)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Current password is incorrect.')).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/password$/)
  })

  test('changing it keeps the session, then the new password signs in and the old one fails', async ({ page }) => {
    const { email, name } = await makePerson()
    await signIn(page, email, OLD)
    await expect(page).toHaveURL(/\/today$/)
    await openChangePassword(page, name)

    await page.getByLabel('Current password', { exact: true }).fill(OLD)
    await page.getByLabel('New password', { exact: true }).fill(NEW)
    await page.getByLabel('Confirm new password', { exact: true }).fill(NEW)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Password changed')).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/password$/)

    await page.getByRole('button', { name: `Account menu, ${name}` }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await signIn(page, email, OLD)
    await expect(page.getByText('Email or password is incorrect')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)

    await signIn(page, email, NEW)
    await expect(page).toHaveURL(/\/today$/)
  })
})
