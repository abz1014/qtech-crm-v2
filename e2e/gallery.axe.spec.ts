import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { openGallery, SCENES } from './support'

/*
 * axe-core in a real browser (colour contrast included, which jsdom cannot do) over the gallery page and
 * every overlay scene. The bar is zero violations: WCAG 2.2 AA plus axe's best-practice rules.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * `landmarks` is true for the gallery page and false for overlay scenes. The `region` rule ("all content
 * in a landmark") cannot hold for a Radix tooltip, popover or listbox: they portal to <body> by design,
 * outside <main>. Every other rule, colour contrast included, still runs on the scene.
 */
async function violations(page: Page, landmarks: boolean) {
  // axe schedules its own work with timers, which the frozen clock would never fire.
  await page.clock.resume()
  await page.evaluate(axeSource)
  return page.evaluate(async landmarks => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown; failureSummary?: string }> }> }> } }).axe
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
      rules: { region: { enabled: landmarks } },
    })
    // One readable line per failing node.
    return result.violations.flatMap(v =>
      v.nodes.map(n => `${v.id} (${v.impact}) ${JSON.stringify(n.target)}: ${(n.failureSummary ?? v.help).replace(/\s+/g, ' ')}`),
    )
  }, landmarks)
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
