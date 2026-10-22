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

/** Every visible text field (input, textarea, select, editable box) whose computed text is under 16 px, named so a failure points at it. */
async function smallInputs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel =
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select, [contenteditable="true"], [contenteditable=""]'
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 1 && r.height > 1 && parseFloat(getComputedStyle(el).fontSize) < 15.95
      })
      .map(el => `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.getAttribute('name') ?? el.getAttribute('placeholder') ?? ''}] ${getComputedStyle(el).fontSize} in #${el.closest('section')?.id ?? el.closest('[role="dialog"]')?.getAttribute('aria-labelledby') ?? '?'}`)
  })
}

// Rubric "Reading on a phone": input text is 16 px everywhere, so iOS does not zoom on a tap. The floor is in src/index.css.
test('on a phone every text field is at least 16 px (gallery page and every overlay scene)', async ({ page }, info) => {
  test.skip((info.project.use.viewport?.width ?? 1440) >= 768, 'phones only (the w375 project)')
  await openGallery(page)
  const found = await smallInputs(page)
  for (const s of SCENES) {
    await openGallery(page, `?scene=${s.scene}`)
    await s.steps?.(page)
    found.push(...(await smallInputs(page)).map(x => `${s.name}: ${x}`))
  }
  expect(found).toEqual([])
})

for (const s of SCENES) {
  test(`scene ${s.name} has no axe violations`, async ({ page }) => {
    await openGallery(page, `?scene=${s.scene}`)
    await s.steps?.(page)
    expect(await violations(page, false)).toEqual([])
  })
}
