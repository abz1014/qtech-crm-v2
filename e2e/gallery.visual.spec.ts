import { expect, test } from '@playwright/test'
import { openGallery, SCENES } from './support'

/*
 * Visual regression for /dev/gallery (U09). One screenshot per gallery section (so a diff points at
 * the primitive that changed) and one per overlay scene, at 1440 and at 375 (the two projects).
 * A deliberate change to a primitive updates these baselines in the same PR: docs/design/VISUAL_TESTS.md.
 */
const SECTIONS = ['foundations', 'forms', 'navigation', 'feedback', 'status', 'money', 'sumbar', 'rfq', 'cards', 'register', 'cash', 'margins', 'rail', 'more', 'tooltip', 'overlays']

test.describe('gallery sections', () => {
  for (const id of SECTIONS) {
    test(`section ${id}`, async ({ page }) => {
      await openGallery(page)
      const section = page.locator(`section#${id}`)
      await expect(section).toBeVisible()
      await expect(section).toHaveScreenshot(`section-${id}.png`)
    })
  }

  test('the page does not scroll sideways', async ({ page }) => {
    await openGallery(page)
    // Elements poking past the viewport, outside any scroll container, named so a failure points at one.
    const offenders = await page.evaluate(() => {
      const w = document.documentElement.clientWidth
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('main *'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > w + 0.5 && !el.closest('[class*="overflow-"]')) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} right=${Math.round(r.right)} in #${el.closest('section')?.id}`)
        }
      }
      return out.slice(0, 10)
    })
    expect(offenders).toEqual([])
  })
})

test.describe('overlay scenes', () => {
  for (const s of SCENES) {
    test(`scene ${s.name}`, async ({ page }) => {
      await openGallery(page, `?scene=${s.scene}`)
      await s.steps?.(page)
      await expect(page).toHaveScreenshot(`scene-${s.name}.png`)
    })
  }
})
