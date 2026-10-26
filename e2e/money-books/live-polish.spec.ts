import { expect, test, type Page } from '@playwright/test'
import { openAs, review } from '../support/stack'

/*
 * What the owner saw on the live site on a brand-new CRM (empty database, admin, 1920x1080 desktop Chrome), 2026-10-20:
 *  1. Today: the list pane scrolled sideways under the "Just you so far" card.
 *  2. Who owes us: two (i) tips side by side after "Balance is gross, GST included".
 *  3. Orders: a stray up/down scroller at the right end of the Active / Done / Cancelled tabs.
 *  4. Amounts and counts set with a slashed zero.
 *  5. Empty lists that praise finished work nobody did ("Every order is paid in full").
 *  6. The no-target block taking the foot of Today's list.
 *
 * The admin signs in for real; then every data read answers as an EMPTY company (the session lookups still reach the stack), and the
 * team count says the admin is alone, so the screens are exactly what a first sign-in shows. Desktop Chrome draws classic scrollbars,
 * so Playwright's default --hide-scrollbars is turned off: a vertical scrollbar narrowing the pane is part of what is measured.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

async function emptyCompany(page: Page) {
  await page.route(/\/rest\/v1\//, async route => {
    const req = route.request()
    const url = req.url()
    // The session itself (the users row and the role) is real.
    if (url.includes('/rpc/current_user_role') || (url.includes('/rest/v1/users?') && /select=id(%2C|,)name/.test(url))) return route.continue()
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && !url.includes('/rpc/')) return route.continue()
    // The team head-count: just the admin.
    if (url.includes('/rest/v1/users?') && url.includes('deactivated_at')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: '[]' })
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]' })
  })
}

async function open(page: Page, path: string) {
  await page.goto(path)
  await page.locator('#main').waitFor()
  await page.waitForLoadState('networkidle')
}

test.describe('a brand-new CRM, as the admin', () => {
  test.beforeEach(async ({ page }) => {
    await openAs(page, 'admin', '/today')
    await emptyCompany(page)
  })

  test('Today: the list pane never scrolls sideways (1920, 1366, 375), and no target is one small line', async ({ page }) => {
    for (const [width, height] of [[1920, 1080], [1366, 768], [375, 812]] as const) {
      await page.setViewportSize({ width, height })
      await open(page, '/today')
      await expect(page.getByText('Just you so far')).toBeVisible()
      const m = await page.evaluate(() => {
        const list = document.querySelector('[data-today-list]') as HTMLElement
        return { listScroll: list.scrollWidth, listClient: list.clientWidth, page: document.documentElement.scrollWidth, view: window.innerWidth }
      })
      expect(m.listScroll, `Today list pane scrolls sideways at ${width}`).toBeLessThanOrEqual(m.listClient)
      expect(m.page, `page scrolls sideways at ${width}`).toBeLessThanOrEqual(m.view)

      const tile = page.getByRole('region', { name: /^Your Q\d target$/ })
      await expect(tile).toHaveText(/^No Q\d target set\. Set targets$/)
      expect((await tile.boundingBox())?.height ?? 999, `no-target line height at ${width}`).toBeLessThan(64)
      await review(page, `live-polish-today-${width}`)
    }
    await page.getByRole('link', { name: 'Set targets' }).click()
    await expect(page).toHaveURL(/\/settings\/targets$/)
  })

  test('Who owes us: ONE info tip beside the header, and an empty list says no balances yet, not "paid in full"', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await open(page, '/money/receivables')
    const note = page.getByRole('heading', { name: 'Balances', level: 2 })
    await expect(note).toBeVisible()
    expect(await note.locator('xpath=..').locator('[data-infotip]').count()).toBe(1)
    await expect(page.getByText('No balances yet')).toBeVisible()
    await expect(page.getByText(/Every order is paid in full/)).toHaveCount(0)
    await review(page, 'live-polish-receivables-1920')
  })

  test('Orders: the tab row has no scroller when its tabs fit, and the empty list is a first-use line', async ({ page }) => {
    for (const [width, height] of [[1920, 1080], [1366, 768]] as const) {
      await page.setViewportSize({ width, height })
      await open(page, '/orders')
      const tabs = page.getByRole('tablist', { name: 'Order lists' })
      await expect(tabs).toBeVisible()
      const m = await tabs.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }))
      expect(m.sw, `tabs overflow sideways at ${width}`).toBeLessThanOrEqual(m.cw)
      expect(m.sh, `tabs overflow downwards at ${width} (the stray up/down scroller)`).toBeLessThanOrEqual(m.ch)
      expect(m.oy, 'the tab row never scrolls up and down').toBe('hidden')
    }
    await expect(page.getByText('No orders yet')).toBeVisible()
    await expect(page.getByText(/Every order is done or cancelled/)).toHaveCount(0)
    await review(page, 'live-polish-orders-1366')
  })

  test('RFQs: with none open, one line true for a new CRM too, never "every quotation is out or closed"', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await open(page, '/rfqs')
    await expect(page.getByText('No open RFQs')).toBeVisible()
    await expect(page.getByText(/Every quotation is out or closed/)).toHaveCount(0)
  })

  test('amounts and counts: tabular figures in the sans, never a slashed zero', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    for (const path of ['/today', '/orders', '/money/receivables']) {
      await open(page, path)
      const styles = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.num')).map(el => {
          const s = getComputedStyle(el)
          return { family: s.fontFamily, numeric: s.fontVariantNumeric, features: s.fontFeatureSettings }
        }),
      )
      // An empty Orders list draws no number at all since its tabs lost their totals (round-2 counts rule); the others still do.
      if (path !== '/orders') expect(styles.length, `numbers on ${path}`).toBeGreaterThan(0)
      for (const s of styles) {
        expect(s.numeric, `font-variant-numeric on ${path}`).toContain('tabular-nums')
        expect(s.numeric, `font-variant-numeric on ${path}`).not.toContain('slashed-zero')
        expect(s.features, `font-feature-settings on ${path}`).not.toMatch(/zero/)
        expect(s.family, `font family on ${path}`).not.toMatch(/Mono|monospace/)
      }
    }
  })
})
