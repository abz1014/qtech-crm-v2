import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Guard for tailwind.config.ts: the theme REPLACES spacing, so only these steps exist. `pl-7`, `gap-1.5`, `w-9` and the like generate
 * no CSS at all (the layout silently loses its gap or padding). Use a defined step or an arbitrary value (`pr-[3.5rem]`).
 * Applies to every utility that reads the spacing scale: padding, margin, gap, space, size, w, h, min-/max- sizes, inset, translate, scroll.
 */
const STEPS = new Set(['0', 'px', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'])
const PREFIXES = [
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y',
  'w', 'h', 'size', 'min-w', 'min-h', 'max-w', 'max-h',
  'inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end',
  'translate-x', 'translate-y', 'scroll-m', 'scroll-mt', 'scroll-mb', 'scroll-p', 'scroll-pt', 'scroll-pb',
  'basis', 'indent', 'border-spacing',
]
const RE = new RegExp(String.raw`(?<![\w\[/.-])((?:[a-z0-9-]+(?:/[a-z0-9-]+)?:)*)(-?)(${PREFIXES.join('|')})-(\d+(?:\.\d+)?|px)(?![\w./%\]-])`, 'g')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('Tailwind spacing steps', () => {
  it('uses only steps the theme defines', () => {
    const bad: string[] = []
    for (const file of files('src')) {
      // Strip arbitrary-value brackets' contents so `[calc(var(--x)-3)]` is never read as a class.
      const text = readFileSync(file, 'utf8').replace(/\[[^\]\s]*\]/g, '[]')
      text.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(RE)) if (!STEPS.has(m[4]!)) bad.push(`${file}:${i + 1} ${m[0]}`)
      })
    }
    expect(bad).toEqual([])
  })
})
