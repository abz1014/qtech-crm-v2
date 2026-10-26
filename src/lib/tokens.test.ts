import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/* Rules about docs/design/tokens.css that the parity script (scripts/check-token-parity.mjs) does not check. */
const css = readFileSync(path.resolve(__dirname, '../../docs/design/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first block that opens with `head {`, braces balanced. */
function block(head: string): string {
  const at = css.indexOf(`${head} {`)
  if (at < 0) throw new Error(`no "${head}" block in tokens.css`)
  let depth = 0
  let out = ''
  for (const ch of css.slice(at + head.length + 1)) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0 && ch === '}') break
    out += ch
  }
  return out
}
const px = (body: string, name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(body)?.[1] ?? NaN)

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('touch targets do not depend on the text size (DESIGN_SYSTEM 11)', () => {
  const coarse = block('@media (pointer: coarse)')

  it('the coarse-pointer block sets the touch heights once, for both text sizes', () => {
    expect(coarse).not.toContain('data-text')
    expect(px(coarse, '--control-h')).toBeGreaterThanOrEqual(44)
    expect(px(coarse, '--control-lg-h')).toBeGreaterThanOrEqual(44)
    expect(px(coarse, '--control-sm-h')).toBeGreaterThanOrEqual(44)
    expect(px(coarse, '--segment-h')).toBeGreaterThanOrEqual(44)
    expect(px(coarse, '--row-h')).toBeGreaterThanOrEqual(48)
  })

  it('it comes after the Smaller block, so it wins at equal specificity', () => {
    expect(css.indexOf('@media (pointer: coarse)')).toBeGreaterThan(css.indexOf('[data-text="small"] {'))
  })

  it('--hit-touch is 44 at every size', () => {
    expect(px(block(':root'), '--hit-touch')).toBe(44)
    expect(block('[data-text="small"]')).not.toContain('--hit-touch')
  })
})

describe('Larger text (owner yes, L1-X)', () => {
  const large = block('[data-text="large"]')
  it('reads at 18 px, timestamps at 16, and no control is shorter than the default', () => {
    expect(px(large, '--text-base')).toBe(18)
    expect(px(large, '--text-sm')).toBe(18)
    expect(px(large, '--text-stamp')).toBe(16)
    expect(px(large, '--control-h')).toBeGreaterThanOrEqual(44)
    expect(px(large, '--control-sm-h')).toBeGreaterThanOrEqual(44)
    expect(px(large, '--segment-h')).toBeGreaterThanOrEqual(44)
    expect(large).not.toContain('--hit-touch')
  })
  it('sits before the coarse-pointer block, so a phone keeps its 44 px floor at every text size', () => {
    expect(css.indexOf('[data-text="large"] {')).toBeLessThan(css.indexOf('@media (pointer: coarse)'))
  })
})

describe('the neutral ramp', () => {
  it('gets darker with every step, so the names say which grey is darker', () => {
    const ramp = [...block(':root').matchAll(/--neutral-(\d+):\s*(#[0-9a-f]{6})/gi)].map(m => [Number(m[1]), m[2]] as const).sort((a, b) => a[0] - b[0])
    expect(ramp.length).toBeGreaterThan(10)
    const out: string[] = []
    for (let i = 1; i < ramp.length; i++) if (luminance(ramp[i][1]) >= luminance(ramp[i - 1][1])) out.push(`--neutral-${ramp[i][0]} is not darker than --neutral-${ramp[i - 1][0]}`)
    expect(out).toEqual([])
  })
})
