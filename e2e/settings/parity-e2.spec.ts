import { mkdirSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { openAs, type Role } from '../support/stack'

/*
 * Part E2 of docs/design/PARITY_AUDIT.md: full-page review photographs of the Settings pages (and their empty-state siblings) at 1440 and 375,
 * for the parity audit only. They assert nothing; with no REVIEW_DIR they do nothing.
 */
const dir = process.env.REVIEW_DIR
test.skip(!dir, 'photographs are for the review folder')

const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
]

async function shoot(page: Page, name: string, w: number) {
  mkdirSync(dir!, { recursive: true })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/e2-${name}-${w}.png`, fullPage: true })
}

const PAGES: { role: Role; path: string; name: string }[] = [
  { role: 'admin', path: '/settings/company', name: 'settings-company-admin' },
  { role: 'sales', path: '/settings/company', name: 'settings-company-sales' },
  { role: 'admin', path: '/settings/categories', name: 'settings-categories' },
  { role: 'admin', path: '/settings/details', name: 'settings-details-admin' },
  { role: 'sales', path: '/settings/details', name: 'settings-details-sales' },
  { role: 'admin', path: '/settings/team', name: 'settings-team' },
  { role: 'admin', path: '/settings/targets', name: 'settings-targets' },
  { role: 'admin', path: '/settings/password', name: 'settings-password' },
  { role: 'sales', path: '/settings', name: 'settings-home-sales' },
  { role: 'admin', path: '/settings/exchange-rates', name: 'settings-rates-admin' },
]

for (const p of PAGES) {
  test(`photograph ${p.name}`, async ({ page }) => {
    await openAs(page, p.role, p.path)
    for (const { w, h } of WIDTHS) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(p.path)
      await page.locator('#main').waitFor()
      await shoot(page, p.name, w)
    }
  })
}

test('photograph company profile, complete with an unsaved change', async ({ page }) => {
  await openAs(page, 'admin', '/settings/company')
  for (const { w, h } of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/settings/company')
    await page.locator('#main').waitFor()
    await page.getByLabel(/Legal name/).fill('Q Tech Solutions (Private) Limited')
    await page.getByLabel(/^Address/).fill('Plot 14, Sector 12-B, Korangi Industrial Area, Karachi 74900, Pakistan')
    await page.getByLabel(/^Phone/).fill('+92 21 3555 0188')
    await shoot(page, 'settings-company-filled', w)
  }
})
