import { expect, test, type Page } from '@playwright/test'
import { openGallery, SCENES } from './support'
import { axeViolations } from './support/axe'

/*
 * axe-core in a real browser (colour contrast included, which jsdom cannot do) over the gallery page and
 * every overlay scene. The bar is zero violations: WCAG 2.2 AA plus axe's best-practice rules.
 */

/**
 * `landmarks` is true for the gallery page and false for overlay scenes. The `region` rule ("all content
 * in a landmark") cannot hold for a Radix tooltip, popover or listbox: they portal to <body> by design,
 * outside <main>. Every other rule, colour contrast included, still runs on the scene.
 */
async function violations(page: Page, landmarks: boolean) {
  // axe schedules its own work with timers, which the frozen clock would never fire.
  await page.clock.resume()
  return axeViolations(page, { landmarks })
}

test('gallery page has no axe violations', async ({ page }) => {
  await openGallery(page)
  expect(await violations(page, true)).toEqual([])
})

for (const s of SCENES) {
  test(`scene ${s.name} has no axe violations`, async ({ page }) => {
    await openGallery(page, `?scene=${s.scene}`)
    await s.steps?.(page)
    expect(await violations(page, false)).toEqual([])
  })
}
