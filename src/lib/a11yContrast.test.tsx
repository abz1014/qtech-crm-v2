import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { ToggleButton } from '@/ui/ToggleButton'

/*
 * State contrast guard (a11y audit, section 7.5). axe measures the colours of what is painted, so it never sees a selected state
 * that is too faint to tell from its neighbours, a tone text on a selected row, or the focus ring on a tinted surface. These pairs
 * are worked out here from the tokens in src/index.css and from the classes the primitives really render, so a token change or a
 * class change that makes a state unreadable fails CI.
 *
 * Thresholds (WCAG 2.2): 4.5:1 for text (1.4.3, the app's text is 12 to 16 px), 3:1 for the visual cue that says which item is
 * selected and for the focus ring (1.4.11). A known failure is an `it.fails` naming its BUG id (the a11y e2e suite's register,
 * e2e/a11y/support.ts): it must fail until the bug is fixed, and then the `.fails` comes off.
 */

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

/** The :root tokens between tokens:start and tokens:end, with var() references resolved to colours. */
function tokens(): Record<string, string> {
  const css = read('src/index.css')
  const block = css.slice(css.indexOf('/* tokens:start */'), css.indexOf('/* tokens:end */'))
  const rootBlock = block.slice(block.indexOf(':root {'), block.indexOf('}', block.indexOf(':root {')))
  const raw: Record<string, string> = {}
  for (const m of rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)) raw[m[1]] = m[2].trim()
  const resolve = (v: string, depth = 0): string => {
    const ref = v.match(/^var\(--([\w-]+)\)$/)
    if (!ref || depth > 10) return v
    const next = raw[ref[1]]
    if (next === undefined) throw new Error(`token --${ref[1]} is not defined`)
    return resolve(next, depth + 1)
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]))
}
const T = tokens()

/** Tailwind colour names (tailwind.config.ts) to the token they read. */
function tokenOfClass(name: string): string | null {
  const direct: Record<string, string> = {
    canvas: 'bg-canvas',
    surface: 'bg-surface',
    sunken: 'bg-sunken',
    selected: 'bg-selected',
    fg: 'fg',
    'fg-2': 'fg-2',
    'fg-muted': 'fg-muted',
    'fg-disabled': 'fg-disabled',
    line: 'border',
    'line-strong': 'border-strong',
    'line-input': 'border-input',
    primary: 'primary',
    'primary-foreground': 'on-primary',
    'brand-green': 'brand-green',
  }
  if (direct[name]) return direct[name]
  if (/^tone-[a-z]+-(fg|bg)$/.test(name)) return name
  return null
}

function rgb(colour: string): [number, number, number] {
  const hex = colour.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) as [number, number, number]
  const fn = colour.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  throw new Error(`not a colour: ${colour}`)
}
function luminance(colour: string): number {
  const [r, g, b] = rgb(colour).map(v => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio between two tokens (names without the leading --). */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(T[a]), luminance(T[b])].sort((p, q) => q - p)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

/**
 * The colour a class list paints for one property, in a given state: `prefixes` are the variants that apply in that state (for
 * example `data-[state=checked]:`), the last matching class wins as in the generated CSS. Size classes (text-xs, border-2) are
 * skipped because they name no colour.
 */
function paint(className: string, prop: 'bg' | 'border' | 'text', prefixes: string[] = []): string | null {
  let base: string | null = null
  let state: string | null = null
  for (const cls of className.split(/\s+/)) {
    const variant = prefixes.find(p => cls.startsWith(p))
    const bare = variant ? cls.slice(variant.length) : cls.includes(':') ? null : cls
    if (!bare?.startsWith(`${prop}-`)) continue
    const named = tokenOfClass(bare.slice(prop.length + 1))
    // tailwind.config.ts maps text-primary to --primary-text (darker than the button fill).
    const token = prop === 'text' && named === 'primary' ? 'primary-text' : named
    if (!token) continue
    // A state variant is more specific than the base class, so it wins whatever their order.
    if (variant) state = token
    else base = token
  }
  return state ?? base
}

/** The strongest cue that tells a selected item from the track it sits on and from an unselected item: fill or edge. */
function selectedCue(selected: { bg: string | null; border: string | null }, track: string, unselected: { bg: string | null; border: string | null }) {
  const fill = selected.bg ?? track
  const cues: Array<[string, number]> = [
    ['selected fill against the track', contrast(fill, track)],
    ['selected fill against an unselected fill', contrast(fill, unselected.bg ?? track)],
  ]
  if (selected.border && selected.border !== unselected.border) {
    cues.push(['selected edge against the track', contrast(selected.border, track)])
    cues.push(['selected edge against its own fill', contrast(selected.border, fill)])
  }
  return cues.sort((a, b) => b[1] - a[1])[0]
}

describe('tokens are readable (sanity)', () => {
  it('reads the colour tokens from src/index.css', () => {
    for (const t of ['bg-surface', 'bg-selected', 'bg-sunken', 'fg', 'fg-muted', 'border-strong', 'brand-green', 'tone-warning-fg']) expect(T[t], t).toMatch(/^#|^rgb/)
  })
})

describe('SegmentedControl: the selected segment', () => {
  const view = () => {
    render(<SegmentedControl aria-label="Which" value="a" onValueChange={() => undefined} options={[{ value: 'a', label: 'Open' }, { value: 'b', label: 'Closed' }]} />)
    const track = screen.getByRole('radiogroup').className
    const on = screen.getByRole('radio', { name: 'Open' }).className
    const off = screen.getByRole('radio', { name: 'Closed' }).className
    const checked = ['data-[state=checked]:']
    return {
      track: paint(track, 'bg') ?? 'bg-surface',
      selected: { bg: paint(on, 'bg', checked), border: paint(on, 'border', checked), text: paint(on, 'text', checked) },
      unselected: { bg: paint(off, 'bg'), border: paint(off, 'border'), text: paint(off, 'text') },
    }
  }

  // BUG A11Y-16: white fill on bg-selected is 1.16:1 and the border-strong edge 1.30:1; the text colour is the only cue.
  it('A11Y-16 fixed: is told apart by a 3:1 fill or edge (WCAG 1.4.11)', () => {
    const v = view()
    const [cue, ratio] = selectedCue(v.selected, v.track, v.unselected)
    expect(ratio, `best cue: ${cue}`).toBeGreaterThanOrEqual(3)
  })

  it('keeps its text and the unselected text readable on the track (4.5:1)', () => {
    const v = view()
    expect(contrast(v.selected.text ?? 'fg', v.selected.bg ?? v.track)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(v.unselected.text ?? 'fg', v.track)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('ToggleButton: pressed against not pressed', () => {
  const classes = (pressed: boolean) => {
    const { unmount } = render(
      <ToggleButton pressed={pressed} onPressedChange={() => undefined}>
        Lowest only
      </ToggleButton>,
    )
    const c = screen.getByRole('button', { name: 'Lowest only' }).className
    unmount()
    return { bg: paint(c, 'bg'), border: paint(c, 'border'), text: paint(c, 'text') }
  }

  // BUG A11Y-16 (same cue): pressed is bg-selected on a white page (1.16:1) and a border-input edge where it was border-strong (2.27:1).
  it('A11Y-16 fixed: pressed is told apart by a 3:1 fill or edge (WCAG 1.4.11)', () => {
    const on = classes(true)
    const off = classes(false)
    const page = 'bg-surface'
    const cues = [contrast(on.bg ?? page, page), contrast(on.bg ?? page, off.bg ?? page), on.border && off.border ? contrast(on.border, off.border) : 1]
    expect(Math.max(...cues), `fill vs page ${cues[0]}, fill vs unpressed ${cues[1]}, edge vs unpressed edge ${cues[2]}`).toBeGreaterThanOrEqual(3)
  })
})

describe('Money views: the current view in the strip', () => {
  const src = read('src/features/money/MoneyFrame.tsx')
  // The lit view's classes (`active ? 'on' : 'off'` or `on ? 'on' : 'off'`) and the strip's own classes, whatever the layout.
  const pick = src.match(/(?:=== active|\bon) \? '([^']+)' : '([^']+)'/)
  const strip = src.match(/aria-label="Money views"\s+className="([^"]+)"/)

  it('the guard can still find the strip and its active and inactive classes', () => {
    expect(pick, 'MoneyFrame.tsx changed shape: update this guard').not.toBeNull()
    expect(strip, 'MoneyFrame.tsx changed shape: update this guard').not.toBeNull()
  })

  // BUG A11Y-16 (same cue): the active view is the same white-on-bg-selected segment.
  it('A11Y-16 fixed: the current view is told apart by a 3:1 fill or edge (WCAG 1.4.11)', () => {
    const track = paint(strip?.[1] ?? '', 'bg') ?? 'bg-surface'
    const on = { bg: paint(pick?.[1] ?? '', 'bg'), border: paint(pick?.[1] ?? '', 'border') }
    const off = { bg: paint(pick?.[2] ?? '', 'bg'), border: paint(pick?.[2] ?? '', 'border') }
    const [cue, ratio] = selectedCue(on, track, off)
    expect(ratio, `best cue: ${cue}`).toBeGreaterThanOrEqual(3)
  })
})

describe('a selected table row (DataTable) and the text that sits on it', () => {
  const src = read('src/ui/DataTable.tsx')
  const rowBg = src.match(/ticked \|\| active \? '(bg-[\w-]+)'/)?.[1]
  const selectedRow = rowBg ? (tokenOfClass(rowBg.slice(3)) ?? 'bg-selected') : 'bg-selected'
  const hoverRow = 'bg-sunken'

  it('the guard can still find the selected-row background in DataTable.tsx', () => {
    expect(rowBg, 'DataTable.tsx changed shape: update this guard').toBeTruthy()
  })

  const texts = ['fg', 'fg-2', 'fg-muted', 'primary-text', 'tone-neutral-fg', 'tone-info-fg', 'tone-success-fg', 'tone-danger-fg']
  for (const text of texts) {
    it(`${text} text stays at 4.5:1 on a selected row and on the hover row (WCAG 1.4.3)`, () => {
      expect(contrast(text, selectedRow)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(text, hoverRow)).toBeGreaterThanOrEqual(4.5)
    })
  }

  // A11Y-17 (was 4.34:1) is fixed on main by the ux/foundation token changes; this now guards it.
  it('A11Y-17 fixed: tone-warning-fg text stays at 4.5:1 on a selected row (WCAG 1.4.3)', () => {
    expect(contrast('tone-warning-fg', selectedRow)).toBeGreaterThanOrEqual(4.5)
  })

  it('tone-warning-fg text stays at 4.5:1 on the hover row', () => {
    expect(contrast('tone-warning-fg', hoverRow)).toBeGreaterThanOrEqual(4.5)
  })

  it('the 3 px brand-green edge of the open row is 3:1 on the selected row (WCAG 1.4.11)', () => {
    expect(contrast('brand-green', selectedRow)).toBeGreaterThanOrEqual(3)
  })
})

describe('the focus ring (brand-green) on every surface it can sit on (WCAG 1.4.11)', () => {
  const surfaces = ['bg-surface', 'bg-canvas', 'bg-sunken', 'bg-selected', 'tone-neutral-bg', 'tone-info-bg', 'tone-success-bg', 'tone-warning-bg', 'tone-danger-bg', 'tone-ink-bg']
  for (const s of surfaces) {
    it(`3:1 on ${s}`, () => {
      expect(contrast('brand-green', s)).toBeGreaterThanOrEqual(3)
    })
  }

  // A11Y-18 (fixed): the danger toast is filled with tone-danger-fg, where the green ring was 1.49:1. Controls inside a toast
  // now draw their ring in the toast's own ink (focus-visible:outline-<token>); that ring must be 3:1 on the danger fill.
  it('A11Y-18 fixed: 3:1 on the danger toast (tone-danger-fg fill)', () => {
    const toast = read('src/ui/Toast.tsx')
    const fill = toast.match(/tone === 'danger' \? '(bg-[\w-]+)/)?.[1]
    expect(fill, 'Toast.tsx changed shape: update this guard').toBeTruthy()
    const rings = [...toast.matchAll(/focus-visible:outline-([\w-]+)/g)].map(m => m[1])
    expect(rings.length, 'every control in a toast sets its own ring colour').toBeGreaterThanOrEqual(3)
    for (const r of rings) expect(contrast(tokenOfClass(r) ?? r, tokenOfClass(fill!.slice(3)) ?? 'tone-danger-fg'), r).toBeGreaterThanOrEqual(3)
  })
})

/*
 * Highlighted rows and tints (rubric "Contrast": secondary text at least 7:1 and labels at least 4.5:1, including on highlighted
 * rows). A coloured second line ("1 day overdue", "Quotation due") can sit on white, on the hover row, on a selected row or inside
 * any tinted panel, so every tone text must clear 7:1 on all of them. Green text (links, text-primary) is a label: 4.5:1 is the rule,
 * and 5:1 is kept so it never sits on the edge. The button fill (--primary) only ever carries white text.
 */
describe('tone text and green text on highlighted rows and tints', () => {
  const backgrounds = ['bg-surface', 'bg-canvas', 'bg-sunken', 'bg-selected', 'tone-neutral-bg', 'tone-info-bg', 'tone-success-bg', 'tone-warning-bg', 'tone-danger-bg']
  const secondary = ['fg-muted', 'tone-neutral-fg', 'tone-info-fg', 'tone-success-fg', 'tone-warning-fg', 'tone-danger-fg']
  for (const text of secondary) {
    it(`${text} is at least 7:1 on every background it can sit on`, () => {
      const low = backgrounds.map(b => [b, contrast(text, b)] as const).filter(([, r]) => r < 7)
      expect(low, low.map(([b, r]) => `${text} on ${b}: ${r}:1`).join(', ')).toEqual([])
    })
  }
  it('green text (primary-text) is at least 5:1 on every background it can sit on', () => {
    const low = backgrounds.map(b => [b, contrast('primary-text', b)] as const).filter(([, r]) => r < 5)
    expect(low, low.map(([b, r]) => `primary-text on ${b}: ${r}:1`).join(', ')).toEqual([])
  })
  it('a green link inside a sentence is told apart from the text around it: 3:1 against fg (axe link-in-text-block)', () => {
    expect(contrast('primary-text', 'fg')).toBeGreaterThanOrEqual(3)
  })
  it('white text stays at 4.5:1 on the green button and on every tone used as a fill', () => {
    for (const fill of ['primary', 'primary-hover', 'primary-active', 'tone-info-fg', 'tone-success-fg', 'tone-warning-fg', 'tone-danger-fg']) {
      expect(contrast('on-primary', fill), fill).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('tailwind.config.ts maps text-primary to --primary-text, not to the button fill', () => {
    expect(read('tailwind.config.ts')).toMatch(/textColor:[\s\S]*primary:\s*\{\s*DEFAULT:\s*v\('primary-text'\)/)
  })
})
