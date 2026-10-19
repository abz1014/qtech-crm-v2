import { expect, test } from '@playwright/test'
import { openAs } from '../support/stack'

/*
 * The app shell must never be wider than the window. At exactly 1280 px the top bar (full labels, the four counts, the 280 px search,
 * Capture and the account) was 7 px too wide, and because the shell is one grid, the top bar and main area took the whole page with them.
 * Checked at 1280, 1366 and 1440 on the main screens, as admin (the widest bar: five destinations and every count).
 */
const SCREENS = ['/today', '/rfqs', '/orders', '/companies', '/money/receivables', '/money/gst-register', '/reports']

test.describe('shell width', () => {
  test('no page scrolls sideways at 1280, 1366 or 1440, and the top bar stays inside the window', async ({ page }) => {
    await openAs(page, 'admin', '/today')
    for (const width of [1280, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of SCREENS) {
        await page.goto(path)
        await page.locator('#main').waitFor()
        await page.waitForLoadState('networkidle')
        const m = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          view: window.innerWidth,
          bar: document.querySelector('header')?.getBoundingClientRect().right ?? 0,
          main: document.querySelector('#main')?.getBoundingClientRect().right ?? 0,
          mainScroll: document.querySelector('#main')?.scrollWidth ?? 0,
          mainClient: document.querySelector('#main')?.clientWidth ?? 0,
        }))
        const at = `${path} at ${width}`
        expect(m.page, `page width, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.bar, `top bar, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.main, `main area, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.mainScroll, `main scrolls sideways, ${at}`).toBeLessThanOrEqual(m.mainClient + 1)
      }
    }
  })
})
