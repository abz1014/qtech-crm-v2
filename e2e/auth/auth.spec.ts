import { expect, test, type Page } from '@playwright/test'

// Fixture users come from supabase/seed.sql (local stack only, @test.invalid addresses).
const PASSWORD = 'fixture-only-password'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const service = (path: string, init: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

test.describe('sign-in and role landing', () => {
  const people = [
    { email: 'admin@test.invalid', name: 'Test Admin', role: 'Admin', money: true },
    { email: 'sales@test.invalid', name: 'Test Sales', role: 'Sales', money: true },
    { email: 'engineer@test.invalid', name: 'Test Engineer', role: 'Engineer', money: false },
  ]

  for (const p of people) {
    test(`${p.role} lands on Today with the right navigation`, async ({ page }) => {
      await signIn(page, p.email)
      await expect(page).toHaveURL(/\/todo$/)
      await page.getByRole('button', { name: `Account menu, ${p.name}` }).click()
      await expect(page.getByRole('menu', { name: 'Account' }).getByText(p.role, { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      const money = page.getByRole('link', { name: 'Money' })
      if (p.money) await expect(money.first()).toBeVisible()
      else await expect(money).toHaveCount(0)
    })
  }

  test('an engineer who opens Money gets the no-access page, not the screen', async ({ page }) => {
    await signIn(page, 'engineer@test.invalid')
    await expect(page).toHaveURL(/\/todo$/)
    await page.goto('/money')
    await expect(page.getByText(/is for admins|not available to your role|no access|don.t have access/i).first()).toBeVisible()
  })

  test('a wrong password shows one message and stays on /login', async ({ page }) => {
    await signIn(page, 'sales@test.invalid', 'not-the-password')
    await expect(page.getByText('Email or password is incorrect')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the session survives a reload and Sign out returns to /login', async ({ page }) => {
    await signIn(page, 'sales@test.invalid')
    await expect(page).toHaveURL(/\/todo$/)
    await page.reload()
    await expect(page).toHaveURL(/\/todo$/)
    await page.getByRole('button', { name: 'Account menu, Test Sales' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/todo')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the deactivated fixture user is signed out straight away with the reason', async ({ page }) => {
    await signIn(page, 'deactivated@test.invalid')
    await expect(page.getByText('This account is deactivated')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/todo')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a person deactivated while signed in is signed out on their next request', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack')
    const email = `short-lived-${Date.now()}@test.invalid`
    const created = await service('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    })
    expect(created.status).toBe(200)
    const { id } = (await created.json()) as { id: string }
    const profile = await service('/rest/v1/users', { method: 'POST', body: JSON.stringify({ id, name: 'Short Lived', role: 'sales' }) })
    expect(profile.status).toBe(201)

    await signIn(page, email)
    await expect(page).toHaveURL(/\/todo$/)

    // An admin deactivates them (the users row is what current_user_role() reads).
    const patch = await service(`/rest/v1/users?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ deactivated_at: new Date().toISOString() }),
    })
    expect(patch.status).toBe(204)

    // Their next request: the window regains focus and the session re-checks.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('This account is deactivated')).toBeVisible()
  })
})
