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

test('admin on a phone reaches each of the six money pages from the "All Money pages" sheet, which ticks the page and closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openAs(page, 'admin', '/money/receivables')
  // the phone has one switcher row, not the five tabs and the row of links
  await expect(page.getByRole('group', { name: 'More money pages' })).toHaveCount(0)
  await expect(page.getByTestId('money-switcher')).toBeVisible()
  await page.getByTestId('money-switcher').click()
  const sheet = page.getByRole('dialog', { name: 'Money pages' })
  await expect(sheet.getByRole('link', { name: 'To collect' })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  for (const [name, url] of PAGES) {
    await page.goto('/money/receivables')
    await page.getByTestId('money-switcher').click()
    await page.getByRole('dialog', { name: 'Money pages' }).getByRole('link', { name }).click()
    await expect(page).toHaveURL(url)
    await page.locator('#main').waitFor()
    await expect(page.getByRole('dialog', { name: 'Money pages' })).toHaveCount(0)
    // route focus (useRouteFocus) still moves into the new page, not back to the closed sheet's opener
    await expect(page.locator('#main :focus, #main:focus')).toHaveCount(1)
  }
})

test('sales have no More money pages row', async ({ page }) => {
  await openAs(page, 'sales', '/money/receivables')
  await expect(page.getByRole('navigation', { name: 'Money views' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'More money pages' })).toHaveCount(0)
})

test('sales on a phone have their three tabs and no switcher', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openAs(page, 'sales', '/money/receivables')
  await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link')).toHaveCount(3)
  await expect(page.getByTestId('money-switcher')).toHaveCount(0)
})
