import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Numbers on screen (owner, 2026-10-20): amounts and counts showed a slashed zero, because `.num` was set in Geist Mono, whose only
 * zero is slashed. `.num` is now the sans with tabular figures (Geist's tnum zero is plain), and nothing may turn slashed-zero on.
 * The computed style in a real browser is checked by e2e/money-books/live-polish.spec.ts.
 */
const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function rule(selector: string): string {
  const at = css.indexOf(`  ${selector} {`)
  if (at < 0) throw new Error(`no ${selector} rule in index.css`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('number styling: a plain zero, tabular figures', () => {
  it('.num keeps tabular figures and is set in the sans, not the mono', () => {
    const body = rule('.num')
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums\s*;/)
    expect(body).toMatch(/font-family:\s*var\(--font-sans\)/)
    expect(body).not.toMatch(/--font-mono/)
  })

  it('nothing in the app stylesheet turns on the slashed zero', () => {
    expect(css).not.toMatch(/slashed-zero/)
    expect(css).not.toMatch(/["']zero["']/)
  })

  it('the tab row draws its hairline inside the box, so the active indicator never makes it scroll', () => {
    expect(rule('.hairline-under')).toMatch(/box-shadow:\s*inset/)
    const tabs = readFileSync(path.resolve(__dirname, 'Tabs.tsx'), 'utf8')
    expect(tabs).toMatch(/hairline-under flex gap-1 overflow-x-auto overflow-y-hidden pb-px/)
    expect(tabs).not.toMatch(/overflow-x-auto border-b/)
  })
})
