import { expect, test, type Page } from '@playwright/test'

/*
 * Learnability (spec 5.3) against the CI stack: a person the admin has just added sees the first-use states (one button
 * each) instead of praise for an empty list, and Help opens from the account menu and the palette; Back closes it.
 * The new person is made through the real admin-users function, with a unique address, as in team.spec.ts.
 */
const PASSWORD = 'fixture-only-password'

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/todo$/)
}

test('a new sales person sees first-use states, and Help opens from the menu and the palette', async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const email = `help-${stamp}@test.invalid`
  const name = `Help Test ${stamp}`

  const admin = await (await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })).newPage()
  await signIn(admin, 'admin@test.invalid')
  await admin.goto('/settings/team')
  await admin.getByRole('button', { name: 'Add person' }).first().click()
  const add = admin.getByRole('dialog', { name: 'Add person' })
  await add.getByLabel(/Full name/).fill(name)
  await add.getByLabel(/Email/).fill(email)
  await add.getByRole('button', { name: 'Create account' }).click()
  const secret = admin.getByRole('dialog', { name: 'Account created' })
  await expect(secret).toBeVisible()
  const password = ((await admin.getByTestId('generated-password').textContent()) ?? '').replace(/\s+/g, '')
  expect(password).not.toBe('')

  const page = await (await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })).newPage()
  await signIn(page, email, password)

  // Today: what it is for, one button.
  await expect(page.getByText('Your work shows up here', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New RFQ' }).first()).toBeVisible()

  // an old bookmark (even one with the retired ?old=1 on it) opens the Jobs list, which says what is true for a new person
  await page.goto('/rfqs?old=1')
  await expect(page).toHaveURL(/\/jobs$/)
  await expect(page.getByText(/^(No open jobs|None of your jobs are open)$/)).toBeVisible()
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/jobs$/)

  // Help from the account menu; Back closes it.
  await page.goto('/todo')
  await page.getByRole('button', { name: `Account menu, ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Help' }).click()
  const help = page.getByRole('dialog', { name: 'Help' })
  await expect(help).toBeVisible()
  await expect(page).toHaveURL(/[?&]help=/)
  await page.goBack()
  await expect(help).toBeHidden()
  await expect(page).toHaveURL(/\/todo$/)

  // Help from the palette.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('help')
  await palette.getByText('Open Help', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeHidden()
})
