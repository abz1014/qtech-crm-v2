import { expect, test, type Page } from '@playwright/test'
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
 * 1093 px). The phone tabs fit at 320 and 375 without cutting a label. All of it at Normal and at Smaller text. Widths are
 * set here, so it runs once (w1440).
 */
/** Smaller text, as the account menu sets it: data-text="small" on <html>. */
const useText = async (page: Page, text: 'normal' | 'small') => {
  if (text === 'small') await page.evaluate(() => (document.documentElement.dataset.text = 'small'))
}

test.describe('shell widths', () => {
  for (const text of ['normal', 'small'] as const)
  for (const tabs of [5, 6]) {
    test(`the top bar fits from 768 to 1920 with ${tabs} destinations, labels in words from 1024 (${text} text)`, async ({ page }, info) => {
      test.skip(info.project.name !== 'w1440', 'the test sets its own widths')
      await openGallery(page, `?scene=shell&tabs=${tabs}`)
      await page.locator('[data-shell-scene] > nav').waitFor({ state: 'attached' })
      await useText(page, text)
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
        const at = `${tabs} destinations at ${width}, ${text} text`
        expect(m.page, `page scrolls sideways, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.barScroll, `top bar overflows, ${at}`).toBeLessThanOrEqual(m.barClient)
        expect(m.right, `something in the top bar ends past the window, ${at}`).toBeLessThanOrEqual(m.view)
        expect(m.labels, at).toBe(tabs)
        if (width >= 1024) expect(m.shownLabels, `labels shown in words, ${at}`).toBe(tabs)
      }
    })

    test(`the phone tabs fit at 320 and 375 with ${tabs} destinations (${text} text)`, async ({ page }, info) => {
      test.skip(info.project.name !== 'w1440', 'the test sets its own widths')
      await openGallery(page, `?scene=shell&tabs=${tabs}`)
      await page.locator('[data-shell-scene] > nav').waitFor({ state: 'attached' })
      await useText(page, text)
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
            // Named, so a failure points at the element that pokes out.
            offenders: Array.from(document.querySelectorAll<HTMLElement>('[data-shell-scene] *'))
              .filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
              .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} right=${Math.round(e.getBoundingClientRect().right)} w=${Math.round(e.getBoundingClientRect().width)}`)
              .slice(0, 8),
          }
        })
        const at = `${tabs} tabs at ${width}, ${text} text`
        expect(m.page, `page scrolls sideways, ${at}: ${m.offenders.join(' | ')}`).toBeLessThanOrEqual(m.view)
        expect(m.navScroll, `tab bar overflows, ${at}`).toBeLessThanOrEqual(m.navClient)
        expect(m.cut, `labels wider than their tab, ${at}`).toEqual([])
        expect(m.barRight, `phone bar ends past the window, ${at}`).toBeLessThanOrEqual(m.view)
      }
    })
  }
})

/*
 * On a touch screen the tap targets keep their size at either text size (DESIGN_SYSTEM 11): Smaller makes the words
 * smaller, never the buttons. A phone-like context (touch, mobile), so (pointer: coarse) matches.
 */
test.describe('touch targets at Smaller text', () => {
  test('controls, small buttons and segments 44, large buttons 52, rows 56; the phone bar and tabs stay 44 or taller', async ({ browser }, info) => {
    test.skip(info.project.name !== 'w1440', 'it makes its own phone context')
    const context = await browser.newContext({ ...info.project.use, viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    try {
      await openGallery(page, '?scene=shell')
      await page.locator('[data-shell-scene] > nav').waitFor({ state: 'attached' })
      for (const text of ['normal', 'small'] as const) {
        await page.evaluate(t => (t === 'small' ? (document.documentElement.dataset.text = 'small') : delete document.documentElement.dataset.text), text)
        const m = await page.evaluate(() => {
          const v = (n: string) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n))
          const heights = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(e => e.getBoundingClientRect().width > 0).map(e => Math.round(e.getBoundingClientRect().height))
          return {
            coarse: matchMedia('(pointer: coarse)').matches,
            control: v('--control-h'),
            controlLg: v('--control-lg-h'),
            controlSm: v('--control-sm-h'),
            segment: v('--segment-h'),
            row: v('--row-h'),
            touch: v('--hit-touch'),
            bar: heights('[data-shell-scene] > header:not(.hidden) button, [data-shell-scene] > header:not(.hidden) a'),
            tabs: heights('[data-shell-scene] > nav a'),
          }
        })
        expect(m.coarse, 'the context is a touch screen').toBe(true)
        expect([m.control, m.controlLg, m.controlSm, m.segment, m.row, m.touch], `${text} text`).toEqual([44, 52, 44, 44, 56, 44])
        expect(m.bar.filter(h => h < 44), `phone bar targets under 44 px, ${text} text`).toEqual([])
        expect(m.tabs.filter(h => h < 44), `tabs under 44 px, ${text} text`).toEqual([])
      }
    } finally {
      await context.close()
    }
  })
})

