import { expect, test, type Page } from '@playwright/test'
import { karachiDay, must, openAs, rest, review } from '../support/stack'

/*
 * Layout of Money > Expenses (owner screenshots 2026-11-06): the page has ONE vertical scrollbar (the document must not scroll,
 * the top bar stays), the table bottom is reachable by scrolling <main>, the Add expenses sheet header does not wrap onto the
 * inputs, and a mouse click on Previous month shows no keyboard focus ring.
 */
const SNACKS = 'ca7e0000-0000-4000-8000-000000000005'

test.describe.configure({ mode: 'serial' })

async function seed(n: number) {
  for (let i = 0; i < n; i++) {
    await must(rest('admin', 'expenses', { method: 'POST', body: { category_id: SNACKS, paid_on: karachiDay(0), amount_pkr: 110 + i, paid_via: 'cash', description: `layout-${i}` } }))
  }
}

const docMetrics = (page: Page) =>
  page.evaluate(() => ({ scrollHeight: document.scrollingElement!.scrollHeight, inner: window.innerHeight }))

test.describe('expenses layout (2026-11-06)', () => {
  test('1707x850: one scrollbar, the top bar stays, the table bottom is reachable', async ({ page }) => {
    await seed(40)
    await page.setViewportSize({ width: 1707, height: 850 })
    await openAs(page, 'admin', '/money/expenses')
    await expect(page.locator('[data-table-root]').first()).toBeVisible()
    const m = await docMetrics(page)
    expect(m.scrollHeight).toBeLessThanOrEqual(m.inner + 1)
    await page.evaluate(() => window.scrollTo(0, 1e6))
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.locator('#main').evaluate(el => el.scrollTo(0, 1e6))
    const reach = await page.evaluate(() => {
      const main = document.getElementById('main')!.getBoundingClientRect()
      const roots = document.querySelectorAll('[data-table-root]')
      const table = roots[roots.length - 1].getBoundingClientRect()
      return { mainBottom: main.bottom, mainTop: main.top, tableBottom: table.bottom, inner: window.innerHeight }
    })
    expect(reach.tableBottom).toBeLessThanOrEqual(reach.mainBottom + 1)
    expect(reach.mainBottom).toBeGreaterThanOrEqual(reach.inner - 1)
    expect(reach.mainTop).toBeGreaterThan(0)
    await review(page, 'layout-expenses-1707')
  })

  test('a mouse click on Previous month shows no focus ring', async ({ page }) => {
    await openAs(page, 'admin', '/money/expenses')
    const prev = page.getByRole('button', { name: 'Previous month' })
    await prev.click()
    expect(await prev.evaluate(el => el.matches(':focus-visible'))).toBe(false)
  })

  for (const width of [1280, 1600, 1707]) {
    test(`the Add expenses sheet header does not wrap onto the inputs at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 })
      await openAs(page, 'admin', '/money/expenses')
      await page.getByRole('button', { name: 'Add expenses' }).click()
      const amount = page.getByRole('textbox', { name: 'Amount, row 1' })
      await expect(amount).toBeVisible()
      const header = page.locator('[role="group"][aria-label="Expense rows"] > div[aria-hidden="true"]').first()
      const h = await header.evaluate(el => {
        const rect = el.getBoundingClientRect()
        const cells = Array.from(el.children).filter(c => c.textContent?.trim()).map(c => {
          const r = c.getBoundingClientRect()
          return { text: c.textContent, bottom: r.bottom, clipped: c.scrollWidth > c.clientWidth + 1 }
        })
        return { height: rect.height, cells }
      })
      expect(h.height).toBeLessThanOrEqual(36.5)
      const top = (await amount.boundingBox())!.y
      for (const c of h.cells) {
        expect(c.bottom, c.text ?? '').toBeLessThanOrEqual(top + 0.5)
        expect(c.clipped, `${c.text} clipped`).toBe(false)
      }
      await review(page, `layout-sheet-${width}`)
    })
  }

  test('the sheet at 1024 is the card list, not a squeezed grid', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await openAs(page, 'admin', '/money/expenses')
    await page.getByRole('button', { name: 'Add expenses' }).click()
    await expect(page.getByRole('textbox', { name: 'Amount, expense 1' })).toBeVisible()
    await expect(page.locator('[role="group"][aria-label="Expense rows"] > div[aria-hidden="true"]')).toHaveCount(0)
    await review(page, 'layout-sheet-1024')
  })
})
