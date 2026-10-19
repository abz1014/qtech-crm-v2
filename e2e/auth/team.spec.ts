import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

/*
 * A04 Team and A06 Company profile against the CI stack: real sign-in, the real admin-users Edge
 * Function (served by e2e.yml), the real database and RLS. Fixture users come from supabase/seed.sql.
 * The suite shares one database and runs in order; every person it creates has a unique address.
 */
const PASSWORD = 'fixture-only-password'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
const GENERATED = /^[A-HJ-NP-Za-km-z2-9]{16}$/

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** A browser context that is allowed to use the clipboard (the Copy buttons write to it). */
async function person(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', permissions: ['clipboard-read', 'clipboard-write'] })
  return { ctx, page: await ctx.newPage() }
}

async function signInAdmin(page: Page) {
  await signIn(page, 'admin@test.invalid')
  await expect(page).toHaveURL(/\/today$/)
}

async function openTeam(page: Page) {
  await page.getByRole('button', { name: 'Account menu, Test Admin' }).click()
  await page.getByRole('menuitem', { name: 'Team' }).click()
  await expect(page).toHaveURL(/\/settings\/team$/)
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible()
}

const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name })

async function rowAction(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

const readPassword = async (page: Page) => ((await page.getByTestId('generated-password').textContent()) ?? '').replace(/\s+/g, '')

test.describe('Team (A04)', () => {
  test('admin creates a person, sees the password once, then changes, resets, deactivates and reactivates them', async ({ browser }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const email = `team-${stamp}@test.invalid`
    const name = `Team Test ${stamp}`
    const admin = await person(browser)
    const { page } = admin
    await signInAdmin(page)
    await openTeam(page)

    // ---- Add person. FE-2: name and email are the only typing; the role is pre-filled.
    let actions = 0
    await page.getByRole('button', { name: 'Add person' }).click()
    actions++
    const add = page.getByRole('dialog', { name: 'Add person' })
    await expect(add.getByLabel('Role')).toHaveValue('sales')
    await add.getByLabel(/Full name/).fill(name)
    actions++
    await add.getByLabel(/Email/).fill(email)
    actions++
    await add.getByRole('button', { name: 'Create account' }).click()
    actions++

    // ---- Shown once.
    const secret = page.getByRole('dialog', { name: 'Account created' })
    await expect(secret).toBeVisible()
    const password = await readPassword(page)
    expect(password).toMatch(GENERATED)
    await expect(secret.getByRole('button', { name: 'Done' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(secret).toBeVisible() // Esc cannot throw the password away

    await secret.getByRole('button', { name: 'Copy', exact: true }).click()
    actions++
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password) // raw, no separators
    await expect(secret.getByRole('button', { name: 'Copied' })).toBeVisible()
    await secret.getByRole('button', { name: 'Done' }).click()
    actions++
    // 4 to create the account, 2 to hand the password over.
    expect(actions).toBeLessThanOrEqual(6)

    await expect(secret).toBeHidden()
    await expect(page.getByText(password)).toHaveCount(0)
    await expect(rowOf(page, name)).toContainText('Sales')
    await expect(rowOf(page, name)).toContainText('Active')
    await page.reload()
    await expect(rowOf(page, name)).toBeVisible()
    await expect(page.getByText(password)).toHaveCount(0) // gone for good, nothing stored it

    // ---- The new person signs in with it. A sales person has Settings but no Team.
    const newbie = await person(browser)
    await signIn(newbie.page, email, password)
    await expect(newbie.page).toHaveURL(/\/today$/)
    await newbie.page.getByRole('button', { name: `Account menu, ${name}` }).click()
    await expect(newbie.page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(newbie.page.getByRole('menuitem', { name: 'Team' })).toHaveCount(0)
    await newbie.page.keyboard.press('Escape')
    await newbie.page.goto('/settings/team')
    await expect(newbie.page.getByRole('heading', { name: 'Team is for admins' })).toBeVisible()

    // ---- Job title.
    await rowAction(page, name, 'Edit job title')
    await page.getByRole('dialog', { name: 'Edit job title' }).getByLabel('Job title').fill('Estimator')
    await page.getByRole('dialog', { name: 'Edit job title' }).getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Job title saved')).toBeVisible()
    await expect(rowOf(page, name)).toContainText('Estimator')

    // ---- Change role.
    await rowAction(page, name, 'Change role')
    const role = page.getByRole('dialog', { name: /Change .* role/ })
    await role.getByRole('radio', { name: /Engineer/ }).click()
    await role.getByRole('button', { name: 'Change role' }).click()
    await expect(page.getByText('Role changed to Engineer')).toBeVisible()
    await expect(rowOf(page, name)).toContainText('Engineer')

    // ---- Reset password: confirmed first, shown once, the old one stops working.
    await rowAction(page, name, 'Reset password')
    await page.getByRole('dialog', { name: /Reset .* password\?/ }).getByRole('button', { name: 'Reset password' }).click()
    const reset = page.getByRole('dialog', { name: 'Password reset' })
    await expect(reset).toBeVisible()
    const newPassword = await readPassword(page)
    expect(newPassword).toMatch(GENERATED)
    expect(newPassword).not.toBe(password)
    await expect(reset.getByRole('button', { name: 'Done' })).toBeDisabled()
    await reset.getByRole('button', { name: 'Copy sign-in message' }).click() // WhatsApp text also unlocks Done
    const message = await page.evaluate(() => navigator.clipboard.readText())
    expect(message).toContain(`Email: ${email}`)
    expect(message).toContain(`Password: ${newPassword}`)
    await reset.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText(newPassword)).toHaveCount(0)

    const old = await person(browser)
    await signIn(old.page, email, password)
    await expect(old.page.getByText('Email or password is incorrect')).toBeVisible()
    await old.ctx.close()

    // ---- Deactivate: confirmed, the open session is signed out, sign-in is refused.
    await rowAction(page, name, 'Deactivate')
    const deactivate = page.getByRole('dialog', { name: `Deactivate ${name}?` })
    await expect(deactivate.getByText(/signed out on every device/)).toBeVisible()
    await deactivate.getByRole('button', { name: /^Deactivate Team$/ }).click()
    await expect(page.getByText(`${name} deactivated`)).toBeVisible()
    await expect(rowOf(page, name)).toContainText('Deactivated')
    await expect(page.getByRole('button', { name: `Reactivate ${name}` })).toBeVisible()

    await newbie.page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(newbie.page).toHaveURL(/\/login$/)
    await expect(newbie.page.getByText('This account is deactivated')).toBeVisible()
    await signIn(newbie.page, email, newPassword)
    await expect(newbie.page).toHaveURL(/\/login$/)

    // ---- Reactivate: the same password works again.
    await page.getByRole('button', { name: `Reactivate ${name}` }).click()
    await page.getByRole('dialog', { name: `Reactivate ${name}?` }).getByRole('button', { name: 'Reactivate' }).click()
    await expect(page.getByText(`${name} reactivated`)).toBeVisible()
    await expect(rowOf(page, name)).toContainText('Active')
    await signIn(newbie.page, email, newPassword)
    await expect(newbie.page.getByRole('button', { name: `Account menu, ${name}` })).toBeVisible() // the app resumes where they were, not always /today

    await newbie.ctx.close()
    await admin.ctx.close()
  })

  test('the only active admin cannot be demoted or deactivated, and the screen says why', async ({ browser }) => {
    const { ctx, page } = await person(browser)
    await signInAdmin(page)
    await openTeam(page)

    await rowAction(page, 'Test Admin', 'Change role')
    const role = page.getByRole('dialog', { name: /Change Test Admin.* role/ })
    await expect(role.getByText('Test is the only active admin')).toBeVisible()
    await expect(role.getByRole('button', { name: 'Change role' })).toBeDisabled()
    await role.getByRole('button', { name: 'Cancel' }).click()

    await rowAction(page, 'Test Admin', 'Deactivate')
    const dialog = page.getByRole('dialog', { name: 'Deactivate Test Admin?' })
    await expect(dialog.getByText("You can't deactivate the only active admin")).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Deactivate$/ })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await ctx.close()
  })

  test('a duplicate email names who has it and keeps the rest of the form', async ({ browser }) => {
    const { ctx, page } = await person(browser)
    await signInAdmin(page)
    await openTeam(page)
    await page.getByRole('button', { name: 'Add person' }).click()
    const add = page.getByRole('dialog', { name: 'Add person' })
    await add.getByLabel(/Full name/).fill('Duplicate Person')
    await add.getByLabel(/Email/).fill('SALES@test.invalid')
    await add.getByRole('button', { name: 'Create account' }).click()
    await expect(add.getByText(/Test Sales already uses this email/)).toBeVisible()
    await expect(add.getByLabel(/Full name/)).toHaveValue('Duplicate Person')
    await expect(page.getByRole('dialog', { name: 'Account created' })).toHaveCount(0)
    await ctx.close()
  })

  for (const p of [
    { email: 'sales@test.invalid', name: 'Test Sales', role: 'sales' },
    { email: 'engineer@test.invalid', name: 'Test Engineer', role: 'engineer' },
  ]) {
    test(`${p.role} has no Team: not in the menu, and the address shows the no-access page`, async ({ page }) => {
      await signIn(page, p.email)
      await expect(page).toHaveURL(/\/today$/)
      await page.getByRole('button', { name: `Account menu, ${p.name}` }).click()
      await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Team' })).toHaveCount(0)
      await page.getByRole('menuitem', { name: 'Settings' }).click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0)

      await page.goto('/settings/team')
      await expect(page.getByRole('heading', { name: 'Team is for admins' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0)
    })
  }
})

test.describe('Company profile (A06)', () => {
  test('an admin saves two fields in three actions, blank fields stay empty, everyone else reads the same record', async ({ browser }) => {
    test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack')
    // Start from an empty profile so a retry sees the same thing as the first run.
    const reset = await fetch(`${API_URL}/rest/v1/company_profile?id=eq.1`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ legal_name: null, address: null, quotation_validity_days: 30, default_payment_terms_days: 30 }),
    })
    expect(reset.status).toBe(204)
    const admin = await person(browser)
    const { page } = admin
    await signInAdmin(page)
    await page.getByRole('button', { name: 'Account menu, Test Admin' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings\/team$/) // an admin's Settings opens on Team
    await page.getByRole('link', { name: 'Company profile' }).click()
    await expect(page.getByRole('heading', { name: 'Company profile', level: 1 })).toBeVisible()
    await expect(page.getByText("PDFs can't be issued until legal name and address are set")).toBeVisible()
    await expect(page.getByLabel('Quotation validity')).toHaveValue('30') // default pre-filled
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    // FE-2: nothing is required. Two typed fields and one press save the profile.
    let actions = 0
    await page.getByLabel(/Legal name/).fill('Q-Tech Solutions (Private) Limited')
    actions++
    await page.getByLabel(/Address/).fill('Plot 14, Korangi Industrial Area, Karachi')
    actions++
    await expect(page.getByText('2 unsaved changes: Legal name, Address')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    actions++
    expect(actions).toBe(3)
    await expect(page.getByText('Company profile saved')).toBeVisible()
    await expect(page.getByText('PDFs can be issued now.')).toBeVisible()
    await expect(page.getByText("PDFs can't be issued until legal name and address are set")).toHaveCount(0)

    // Stored as typed; the optional bank details stay null (nothing prints for them).
    const res = await fetch(`${API_URL}/rest/v1/company_profile?id=eq.1&select=legal_name,address,bank_iban,bank_name,quotation_validity_days,updated_by`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    })
    const [row] = (await res.json()) as Record<string, unknown>[]
    expect(row).toMatchObject({ legal_name: 'Q-Tech Solutions (Private) Limited', bank_iban: null, bank_name: null, quotation_validity_days: 30 })
    expect(row.updated_by).toBe('a0000000-0000-4000-8000-000000000001')

    // Audit Y1: the default payment terms are 30 days, editable here, and stored.
    await expect(page.getByLabel('Default payment terms')).toHaveValue('30')
    await page.getByLabel('Default payment terms').fill('45')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .poll(async () => {
        const r = await fetch(`${API_URL}/rest/v1/company_profile?id=eq.1&select=default_payment_terms_days`, {
          headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
        })
        return ((await r.json()) as { default_payment_terms_days: number }[])[0].default_payment_terms_days
      })
      .toBe(45)
    await page.getByLabel('Default payment terms').fill('30')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Nothing to save yet')).toBeVisible()

    // Change one more thing and discard it.
    await page.getByLabel('Quotation validity').fill('60')
    await expect(page.getByText('1 unsaved change: Quotation validity')).toBeVisible()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByLabel('Quotation validity')).toHaveValue('30')

    // A bad value is refused in place and nothing is saved.
    await page.getByLabel(/^Email/).fill('not-an-email')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Enter a valid email address, or leave it empty.')).toBeVisible()
    await page.getByRole('button', { name: 'Discard' }).click()

    // Sales reads the same values, with no way to edit.
    const sales = await person(browser)
    await signIn(sales.page, 'sales@test.invalid')
    await expect(sales.page).toHaveURL(/\/today$/)
    await sales.page.goto('/settings/company')
    await expect(sales.page.getByText('Q-Tech Solutions (Private) Limited')).toBeVisible()
    await expect(sales.page.getByText('Only an admin can edit')).toBeVisible()
    await expect(sales.page.getByRole('textbox')).toHaveCount(0)
    await expect(sales.page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)

    // And the database agrees: a sales person's direct update changes nothing.
    const token = await sales.page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'))
      return key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined
    })
    expect(token).toBeTruthy()
    const refused = await fetch(`${API_URL}/rest/v1/company_profile?id=eq.1`, {
      method: 'PATCH',
      headers: { apikey: process.env.ANON_KEY ?? SERVICE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ phone: 'hacked' }),
    })
    expect(await refused.json()).toEqual([])

    await sales.ctx.close()
    await admin.ctx.close()
  })
})
