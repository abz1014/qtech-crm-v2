import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'

/*
 * One way to run axe in every e2e suite. Colour contrast is measured on the pixels the browser has painted, so an element
 * that is still fading or sliding in (a Radix dialog or a phone bottom sheet) is measured with blended colours that are
 * not the design tokens, and the test fails for a reason no person could ever see. So, before axe runs:
 *   1. the page is switched to prefers-reduced-motion: reduce (the design system already turns its animations off then);
 *   2. every finite animation and transition still running is waited for, then two frames are let through.
 * Looping animations (the skeleton pulse) are not waited for: they never finish, and reduced motion stops them anyway.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

/** Reduced motion on, so animations are off from here on. Safe to call more than once. */
export async function reduceMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** Waits until no finite animation or transition is running (at most `timeoutMs`), then two animation frames. */
export async function waitForAnimationsToFinish(page: Page, timeoutMs = 3000): Promise<void> {
  await page.evaluate(async limit => {
    const deadline = performance.now() + limit
    const running = () =>
      document.getAnimations().filter(a => {
        const t = a.effect?.getComputedTiming()
        return a.playState === 'running' && t !== undefined && Number.isFinite(t.endTime)
      })
    while (running().length > 0 && performance.now() < deadline) {
      await Promise.race([Promise.all(running().map(a => a.finished.catch(() => undefined))), new Promise(r => setTimeout(r, 100))])
    }
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  }, timeoutMs)
}

export interface AxeOptions {
  /**
   * Keep the `region` rule ("all content in a landmark") on. Off for overlay scenes only: a Radix dialog, popover or
   * tooltip is portalled to <body> by design, outside <main>. Default true.
   */
  landmarks?: boolean
}

/** Runs axe (WCAG 2.2 AA plus best practice, colour contrast included) and returns one readable line per failing node. */
export async function axeViolations(page: Page, opts: AxeOptions = {}): Promise<string[]> {
  await reduceMotion(page)
  await waitForAnimationsToFinish(page)
  await page.evaluate(axeSource)
  return page.evaluate(
    async ({ tags, landmarks }) => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown; failureSummary?: string }> }> }> } }).axe
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
        rules: { region: { enabled: landmarks } },
      })
      return result.violations.flatMap(v =>
        v.nodes.map(n => `${v.id} (${v.impact}) ${JSON.stringify(n.target)}: ${(n.failureSummary ?? v.help).replace(/\s+/g, ' ')}`),
      )
    },
    { tags: AXE_TAGS, landmarks: opts.landmarks ?? true },
  )
}
