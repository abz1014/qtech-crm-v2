import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, openAs, uniqueName } from '../support/stack'

/*
 * Home, Team: open jobs per person (owner 2026-11-17), against the real stack. The admin sees under the salesperson's name how many
 * open jobs are theirs and where each stands, opens a job from there, and follows "See all" / "Show in Jobs" to the Jobs list filtered
 * to that person, where their job is listed and the admin's own is not. Sales has no Person filter. Fictional data.
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'
const ADMIN = 'a0000000-0000-4000-8000-000000000001'

test("the admin sees a team member's open jobs and where each stands, from Home's Team view", async ({ page, browser }) => {
  const theirs = await createRfq((await createCompany(uniqueName('Team Jobs Sales'))).id, { owner_id: SALES })
  const mine = await createRfq((await createCompany(uniqueName('Team Jobs Admin'))).id, { owner_id: ADMIN })

  await openAs(page, 'admin', '/todo?view=team')
  const panel = page.locator(`[data-open-jobs="${SALES}"]`)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: /Open jobs/ })).toBeVisible()
  await expect(panel.locator('[data-open-count]')).toHaveText(/^[1-9]\d*$/)
  // every listed job says where it stands, in the Jobs list's words ("RFQ · suppliers not asked yet")
  const first = panel.locator('a[data-team-job]').first()
  await expect(first.locator('[data-stands]')).toHaveText(/^(RFQ|Quotation|Order|Supplier order|Delivery|Invoice|Payment|Not started)\b/)

  // all of them: Jobs filtered to the salesperson
  await panel.getByRole('link', { name: /^(See all \d+ open jobs|Show in Jobs)$/ }).click()
  await expect(page).toHaveURL(new RegExp(`/jobs\\?person=${SALES}`))
  await expect(page.getByTestId('person-filter')).toHaveValue(SALES)
  await expect(page.getByRole('row', { name: new RegExp(`Job ${theirs.number}\\b`) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(`Job ${mine.number}\\b`) })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Mine' })).toHaveCount(0)

  // back on Home, a job opens its job page
  await page.goto('/todo?view=team')
  const job = page.locator(`[data-open-jobs="${SALES}"] a[data-team-job]`).first()
  const key = await job.getAttribute('data-team-job')
  await job.click()
  await expect(page).toHaveURL(new RegExp(`/jobs/${key}$`))

  // sales: no Person filter
  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await openAs(p2, 'sales', `/jobs?person=${ADMIN}`)
  await expect(p2.getByRole('radio', { name: 'Mine' })).toBeVisible()
  await expect(p2.getByTestId('person-filter')).toHaveCount(0)
  await ctx.close()
})

/** No sideways scroll at this width; with REVIEW_DIR set (CI), a full-page picture for the owner. */
async function picture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400)
  const width = page.viewportSize()?.width ?? 1440
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name} at ${width}: no sideways scroll`).toBeLessThanOrEqual(0)
  const dir = process.env.REVIEW_DIR
  if (dir) await page.screenshot({ path: `${dir}/team-jobs/${name}-${width}.png`, fullPage: true })
}

test('pictures: Team with open jobs and Jobs filtered to a person, at 1440 and 375', async ({ page }) => {
  test.setTimeout(120_000)
  for (const name of ['Fictional Textiles Ltd', 'Sample Cement Works', 'Demo Sugar Mills', 'Example Paper Board']) {
    await createRfq((await createCompany(uniqueName(name))).id, { owner_id: SALES })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await openAs(page, 'admin', '/todo?view=team')
  await expect(page.locator(`[data-open-jobs="${SALES}"] a[data-team-job]`).first()).toBeVisible()
  await picture(page, 'home-team')
  await page.goto(`/jobs?person=${SALES}`)
  await expect(page.getByTestId('person-filter')).toHaveValue(SALES)
  await expect(page.getByRole('row').nth(1)).toBeVisible()
  await picture(page, 'jobs-person')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/todo?view=team')
  await expect(page.locator(`[data-open-jobs="${SALES}"] a[data-team-job]`).first()).toBeVisible()
  await picture(page, 'home-team')
  await page.goto(`/jobs?person=${SALES}`)
  await expect(page.getByTestId('person-filter')).toHaveValue(SALES)
  await picture(page, 'jobs-person')
})
