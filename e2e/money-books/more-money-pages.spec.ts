import { expect, test } from '@playwright/test'
import { openAs } from '../support/stack'

/*
 * Navigation review: Margins, Mistakes to fix, Bank check, Review imported and GST to FBR were reachable only through Lock a month.
 * Under the Money tabs an admin now has a "More money pages" row of links to them; sales never see it.
 */
const PAGES = [
  ['Margins', /\/money\/margins$/],
  ['Mistakes to fix', /\/money\/exceptions$/],
  ['Bank check', /\/money\/month-end\/bank$/],
  ['Review imported', /\/money\/review-imported$/],
  ['GST to FBR', /\/money\/accounts\/gst$/],
  ['Profitability', /\/money\/profit$/],
] as const

test('admin reaches each of the six money pages from a Money tab in one click', async ({ page }) => {
  await openAs(page, 'admin', '/money/receivables')
  const row = page.getByRole('group', { name: 'More money pages' })
  await expect(row).toBeVisible()
  for (const [name, url] of PAGES) {
    await page.goto('/money/receivables')
    await page.getByRole('group', { name: 'More money pages' }).getByRole('link', { name }).click()
    await expect(page).toHaveURL(url)
    await page.locator('#main').waitFor()
  }
})

test('sales have no More money pages row', async ({ page }) => {
  await openAs(page, 'sales', '/money/receivables')
  await expect(page.getByRole('navigation', { name: 'Money views' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'More money pages' })).toHaveCount(0)
})
