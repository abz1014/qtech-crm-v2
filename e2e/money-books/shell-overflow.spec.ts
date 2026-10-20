import { expect, test } from '@playwright/test'
import { openAs } from '../support/stack'

/*
 * The app shell must never be wider than the window. At exactly 1280 px the top bar (full labels, the four counts, the 280 px search,
 * Capture and the account) was 7 px too wide, and because the shell is one grid, the top bar and main area took the whole page with them.
 * Since the bigger default text (DECISIONS 2026-10-19) the main screens are checked on a phone (375) and at 1280, 1366 and 1440, as admin
 * (the widest bar: every destination and every count); the top bar alone is also checked at 1024 (a 1366 laptop at 125%) and 1920.
 */
const SCREENS = ['/today', '/rfqs', '/orders', '/companies', '/money/receivables', '/money/gst-register', '/money/month-end', '/money/reports']

const measure = () => {
  // The shell's bars only: a page may draw its own <header> inside #main.
  const bars = Array.from(document.querySelectorAll('header')).filter(h => !h.closest('#main') && h.getBoundingClientRect().width > 0)
  const ends = (el: Element) => Math.max(el.getBoundingClientRect().right, ...Array.from(el.querySelectorAll('*')).map(e => e.getBoundingClientRect().right))
  return {
    page: document.documentElement.scrollWidth,
    view: window.innerWidth,
    bar: bars.length ? Math.max(...bars.map(ends)) : 0,
    barOverflow: bars.some(h => h.scrollWidth > h.clientWidth + 1),
    main: document.querySelector('#main')?.getBoundingClientRect().right ?? 0,
    mainScroll: document.querySelector('#main')?.scrollWidth ?? 0,
    mainClient: document.querySelector('#main')?.clientWidth ?? 0,
  }
}

test.describe('shell width', () => {
  test('no page scrolls sideways at 375, 1280, 1366 or 1440, and the top bar stays inside the window', async ({ page }) => {
    await openAs(page, 'admin', '/today')
    for (const width of [375, 1280, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of SCREENS) {
        await page.goto(path)
        await page.locator('#main').waitFor()
        await page.waitForLoadState('networkidle')
        const m = await page.evaluate(measure)
        const at = `${path} at ${width}`
        expect(m.page, `page width, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.bar, `top bar, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.barOverflow, `top bar scrolls inside itself, ${at}`).toBe(false)
        expect(m.main, `main area, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.mainScroll, `main scrolls sideways, ${at}`).toBeLessThanOrEqual(m.mainClient + 1)
      }
    }
  })

  test('the top bar fits at 1024 and 1920 with every label in words', async ({ page }) => {
    await openAs(page, 'admin', '/today')
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/today')
      await page.locator('#main').waitFor()
      await page.waitForLoadState('networkidle')
      const m = await page.evaluate(measure)
      expect(m.bar, `top bar at ${width}`).toBeLessThanOrEqual(m.view)
      expect(m.barOverflow, `top bar scrolls inside itself at ${width}`).toBe(false)
      const nav = page.getByRole('navigation', { name: 'Main' }).first()
      for (const name of ['Today', 'RFQs', 'Orders', 'Companies', 'Money']) {
        const box = await nav.getByRole('link', { name: new RegExp(`^${name}`) }).locator('[data-nav-label]').boundingBox()
        expect(box?.width ?? 0, `${name} shown in words at ${width}`).toBeGreaterThan(2)
      }
    }
  })
})
