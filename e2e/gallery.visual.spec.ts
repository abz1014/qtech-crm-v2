import { expect, test } from '@playwright/test'
import { openGallery, SCENES } from './support'

/*
 * Visual regression for /dev/gallery (U09). One screenshot per gallery section (so a diff points at
 * the primitive that changed) and one per overlay scene, at 1440 and at 375 (the two projects).
 * A deliberate change to a primitive updates these baselines in the same PR: docs/design/VISUAL_TESTS.md.
 */
const SECTIONS = ['foundations', 'textsize', 'forms', 'navigation', 'feedback', 'status', 'money', 'sumbar', 'rfq', 'cards', 'register', 'cash', 'margins', 'rail', 'more', 'tooltip', 'infotip', 'overlays']

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

/*
 * The shell at the bigger default text (DECISIONS 2026-10-19). The top bar never scrolls or spills sideways from 768 to
 * 1920, with five destinations and with six, and keeps every label in words from 1024 up (a 1366 laptop at 125% is
 * 1093 px). The phone tabs fit at 320 and 375 without cutting a label. Widths are set here, so it runs once (w1440).
 */
test.describe('shell widths', () => {
  for (const tabs of [5, 6]) {
    test(`the top bar fits from 768 to 1920 with ${tabs} destinations, labels in words from 1024`, async ({ page }, info) => {
      test.skip(info.project.name !== 'w1440', 'the test sets its own widths')
      await openGallery(page, `?scene=shell&tabs=${tabs}`)
      await page.locator('[data-shell-scene] > nav').waitFor({ state: 'attached' })
      for (const width of [768, 1024, 1093, 1280, 1366, 1440, 1536, 1920]) {
        await page.setViewportSize({ width, height: 800 })
        const m = await page.evaluate(() => {
          const bar = document.querySelector<HTMLElement>('[data-shell-scene] > header')!
          const labels = Array.from(bar.querySelectorAll<HTMLElement>('[data-nav-label]'))
          return {
            view: document.documentElement.clientWidth,
            page: document.documentElement.scrollWidth,
            barScroll: bar.scrollWidth,
            barClient: bar.clientWidth,
            right: Math.max(...Array.from(bar.querySelectorAll<HTMLElement>('*')).map(e => e.getBoundingClientRect().right)),
            shownLabels: labels.filter(l => l.getBoundingClientRect().width > 2).length,
            labels: labels.length,
          }
        })
        const at = `${tabs} destinations at ${width}`
        expect(m.page, `page scrolls sideways, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.barScroll, `top bar overflows, ${at}`).toBeLessThanOrEqual(m.barClient)
        expect(m.right, `something in the top bar ends past the window, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.labels, at).toBe(tabs)
        if (width >= 1024) expect(m.shownLabels, `labels shown in words, ${at}`).toBe(tabs)
      }
    })

    test(`the phone tabs fit at 320 and 375 with ${tabs} destinations`, async ({ page }, info) => {
      test.skip(info.project.name !== 'w1440', 'the test sets its own widths')
      await openGallery(page, `?scene=shell&tabs=${tabs}`)
      await page.locator('[data-shell-scene] > nav').waitFor({ state: 'attached' })
      for (const width of [320, 360, 375]) {
        await page.setViewportSize({ width, height: 700 })
        const m = await page.evaluate(() => {
          const tabsNav = document.querySelector<HTMLElement>('[data-shell-scene] > nav')!
          const bar = document.querySelector<HTMLElement>('[data-shell-scene] > header:not(.hidden)')
          const cut = Array.from(tabsNav.querySelectorAll<HTMLElement>('a')).filter(a => {
            const label = a.querySelector<HTMLElement>('span.whitespace-nowrap')!
            const r = label.getBoundingClientRect()
            const c = a.getBoundingClientRect()
            return r.left < c.left - 0.5 || r.right > c.right + 0.5
          })
          return {
            view: document.documentElement.clientWidth,
            page: document.documentElement.scrollWidth,
            navScroll: tabsNav.scrollWidth,
            navClient: tabsNav.clientWidth,
            cut: cut.map(a => a.textContent),
            barRight: bar ? Math.max(...Array.from(bar.querySelectorAll<HTMLElement>('*')).map(e => e.getBoundingClientRect().right)) : 0,
          }
        })
        const at = `${tabs} tabs at ${width}`
        expect(m.page, `page scrolls sideways, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.navScroll, `tab bar overflows, ${at}`).toBeLessThanOrEqual(m.navClient)
        expect(m.cut, `labels wider than their tab, ${at}`).toEqual([])
        expect(m.barRight, `phone bar ends past the window, ${at}`).toBeLessThanOrEqual(m.view)
      }
    })
  }
})
