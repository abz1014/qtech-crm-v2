import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test, type Page } from '@playwright/test'

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

/**
 * axe "incomplete" (needs review) results that are a real failure every time, so strict runs fail on them like violations:
 *  - aria-prohibited-attr: an aria-label or aria-labelledby on an element whose role cannot be named (a plain div, span or p).
 *    axe files it under "needs review" only because the element also has text, which a screen reader reads instead: the label
 *    is silently dropped, which is the bug (WCAG 1.3.1, 4.1.2).
 *  - aria-valid-attr-value, only for an aria-labelledby or aria-describedby that points at an id nothing on the page has. The
 *    name or description it was meant to give is silently lost (1.3.1, 4.1.2). Its other "needs review" cases are left out:
 *    aria-controls on a popup trigger (every closed Radix menu has one) and aria-current values are not reliably wrong.
 * Not included, because they are often fine: color-contrast (text over an image or a gradient; logged as a warning instead),
 * target-size (partly covered targets), th-has-data-cells, aria-allowed-attr, skip-link and the rest of axe's review list.
 */
export const STRICT_INCOMPLETE: Record<string, (check: { id: string; data?: unknown }) => boolean> = {
  'aria-prohibited-attr': () => true,
  'aria-valid-attr-value': c => {
    const d = c.data as { messageKey?: string; needsReview?: string } | undefined
    return c.id === 'aria-valid-attr-value' && d?.messageKey === 'noId' && /^aria-(labelledby|describedby)=/.test(d.needsReview ?? '')
  },
}

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
  /**
   * Also fail on the STRICT_INCOMPLETE "needs review" results. Default: on when A11Y_STRICT=1. The a11y suite (e2e/a11y) always
   * runs strict. A11Y_STRICT=report keeps the other suites passing and prints each strict-only finding as an `A11Y-STRICT` line
   * (how the findings on the older suites are collected until they are fixed and strict can be on for everyone).
   */
  strict?: boolean
}

interface AxeCheck {
  id: string
  data?: unknown
  message?: string
}
interface AxeNode {
  target: unknown
  failureSummary?: string
  any?: AxeCheck[]
  all?: AxeCheck[]
  none?: AxeCheck[]
}
interface AxeResult {
  id: string
  impact: string | null
  help: string
  nodes: AxeNode[]
}

const line = (r: AxeResult, n: AxeNode, prefix = '') =>
  `${prefix}${r.id} (${r.impact}) ${JSON.stringify(n.target)}: ${(n.failureSummary ?? r.help).replace(/\s+/g, ' ')}`

/** Runs axe (WCAG 2.2 AA plus best practice, colour contrast included) and returns one readable line per failing node. */
export async function axeViolations(page: Page, opts: AxeOptions = {}): Promise<string[]> {
  const mode = process.env.A11Y_STRICT
  const strict = opts.strict ?? mode === '1'
  const report = !strict && mode === 'report'
  await reduceMotion(page)
  await waitForAnimationsToFinish(page)
  await page.evaluate(axeSource)
  const { violations, incomplete } = await page.evaluate(
    async ({ tags, landmarks, review }) => {
      const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: AxeResult[]; incomplete: AxeResult[] }> } }).axe
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        // "incomplete" is asked for in full (every node) only when it is going to be read.
        resultTypes: review ? ['violations', 'incomplete'] : ['violations'],
        rules: { region: { enabled: landmarks } },
      })
      return { violations: result.violations, incomplete: review ? result.incomplete : [] }
    },
    { tags: AXE_TAGS, landmarks: opts.landmarks ?? true, review: strict || report },
  )
  const out = violations.flatMap(v => v.nodes.map(n => line(v, n)))
  if (!strict && !report) return out

  const extra: string[] = []
  for (const r of incomplete) {
    const keep = STRICT_INCOMPLETE[r.id]
    if (keep) {
      for (const n of r.nodes) if ([...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].some(c => keep(c))) extra.push(line(r, n, 'needs-review: '))
    } else if (r.id === 'color-contrast') {
      for (const n of r.nodes) console.warn(`A11Y-WARN ${line(r, n)}`)
    }
  }
  if (report) {
    const where = (() => {
      try {
        return test.info().titlePath.join(' > ')
      } catch {
        return 'outside a test'
      }
    })()
    for (const e of extra) console.warn(`A11Y-STRICT [${where}] ${page.url()} ${e}`)
    return out
  }
  return [...out, ...extra]
}
