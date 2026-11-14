import { expect, test, type Page } from '@playwright/test'
import { openAs, type Role } from '../support/stack'

/*
 * Forest lane D1 (Settings, mockups 75, 77, 78): one picture of each Settings page at 1440 and at 375, written to REVIEW_DIR (CI
 * uploads it as part of the e2e artifact; nothing is written locally), and checks that hold for every page: no sideways scroll on a
 * phone, the list is a card beside the page from 768, and an engineer's Company profile shows business details only (gate 2,
 * answer 10: Payment terms and the quotation and purchase order wording carry money words).
 */

/** Opens `path` at 1440 then at 375 and writes `forest-d1-<name>-<width>.png`; the window grows to the content so the picture is whole. */
async function both(page: Page, path: string, name: string): Promise<void> {
  const dir = process.env.REVIEW_DIR
  for (const [w, h] of [[1440, 900], [375, 812]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(path)
    await page.locator('#main').waitFor()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    if (w === 375) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflow, `${name}: no sideways scroll at 375`).toBeLessThanOrEqual(0)
    }
    const tall = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll('#main, #main *'))
          .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
          .map(e => e.scrollHeight + e.getBoundingClientRect().top),
        window.innerHeight,
      ),
    )
    if (tall > h) {
      await page.setViewportSize({ width: w, height: Math.min(Math.ceil(tall) + 120, 6000) })
      await page.waitForTimeout(300)
    }
    if (dir) await page.screenshot({ path: `${dir}/forest-d1-${name}-${w}.png`, fullPage: true })
  }
}

const ADMIN_PAGES: Array<[string, string]> = [
  ['/settings/company', 'company-admin'],
  ['/settings/targets', 'targets'],
  ['/settings/categories', 'categories'],
  ['/settings/product-categories', 'product-categories'],
  ['/settings/tax-deadlines', 'tax-admin'],
  ['/settings/exchange-rates', 'rates-admin'],
  ['/settings/backups', 'backups'],
  ['/settings/export', 'export'],
  ['/settings/details', 'details'],
  ['/settings/password', 'password'],
]

test.describe('Forest Settings pictures (lane D1)', () => {
  test('every admin page at 1440 and 375, and the list', async ({ page }) => {
    test.setTimeout(240_000)
    await openAs(page, 'admin', '/settings/company')
    // the list is one card on the canvas beside the page from 768
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await expect(nav).toBeVisible()
    const box = await nav.boundingBox()
    const main = await page.getByRole('heading', { level: 1, name: 'Company profile' }).boundingBox()
    expect(box && main ? main.x > box.x + box.width : false, 'the page sits beside the list').toBe(true)
    for (const [path, name] of ADMIN_PAGES) await both(page, path, name)
    // the phone list itself
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/settings')
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible()
    if (process.env.REVIEW_DIR) await page.screenshot({ path: `${process.env.REVIEW_DIR}/forest-d1-list-375.png`, fullPage: true })
  })

  for (const role of ['sales', 'engineer'] as Role[]) {
    test(`${role}: Settings home and Company profile`, async ({ page }) => {
      await openAs(page, role, '/settings')
      await both(page, '/settings', `home-${role}`)
      await both(page, '/settings/company', `company-${role}`)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/settings/company')
      await expect(page.getByRole('heading', { name: 'Business details' })).toBeVisible()
      if (role === 'engineer') {
        // gate 2, answer 10: no payment terms and no quotation or purchase order wording for an engineer
        await expect(page.getByRole('heading', { name: 'Payment terms' })).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Quotations and purchase orders' })).toHaveCount(0)
        await expect(page.locator('#main')).not.toContainText(/payment terms|purchase order terms|quotation terms/i)
      } else {
        await expect(page.getByRole('heading', { name: 'Payment terms' })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Quotations and purchase orders' })).toBeVisible()
      }
    })
  }
})
