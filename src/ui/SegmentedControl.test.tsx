import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '@/ui/SegmentedControl'

/*
 * Rubric "Getting around on a phone": no sideways-scrolling filter strips. Below 640 px (Tailwind `sm`) the track wraps its
 * segments onto another row; only from 640 px up may a too-narrow track scroll inside itself. jsdom has no layout, so this reads
 * the classes the track and its segments render (the screen audit measures real strips at 320 and 375 px).
 */
const options = [
  { value: 'any', label: 'Any' },
  { value: 'needs', label: 'Needs action', needs: 3 },
  { value: 'waiting', label: 'Waiting' },
]

describe('SegmentedControl on a phone', () => {
  for (const mode of ['radio', 'tabs'] as const) {
    it(`${mode}: the track wraps below 640 px and scrolls only from 640 px up`, () => {
      render(<SegmentedControl aria-label="Show" mode={mode} value="any" onValueChange={() => undefined} options={options} />)
      const track = screen.getByRole(mode === 'radio' ? 'radiogroup' : 'tablist')
      const cls = track.className.split(/\s+/)
      expect(cls).toContain('flex-wrap')
      expect(cls).not.toContain('overflow-x-auto')
      expect(cls).not.toContain('overflow-x-scroll')
      expect(cls).toContain('sm:overflow-x-auto')
      expect(cls).toContain('sm:flex-nowrap')
    })
  }

  it('a caller that asks for flex-wrap wraps at every width and never scrolls (Today tabs)', () => {
    render(<SegmentedControl aria-label="Show" className="flex-wrap" value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radiogroup').className.split(/\s+/)
    expect(cls).toContain('flex-wrap')
    expect(cls).not.toContain('sm:flex-nowrap')
    expect(cls).not.toContain('sm:overflow-x-auto')
  })

  it('two to four options sit on one row of equal columns on a phone; five wrap', () => {
    const { unmount } = render(<SegmentedControl aria-label="Show" value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radiogroup').className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['max-sm:inline-grid', 'max-sm:grid-flow-col', 'max-sm:auto-cols-fr']))
    expect(screen.getByRole('radio', { name: 'Any' }).className.split(/\s+/)).toContain('max-sm:px-2')
    unmount()
    const five = ['a', 'b', 'c', 'd', 'e'].map(v => ({ value: v, label: v.toUpperCase() }))
    render(<SegmentedControl aria-label="Five" value="a" onValueChange={() => undefined} options={five} />)
    const fiveCls = screen.getByRole('radiogroup').className.split(/\s+/)
    expect(fiveCls).toContain('flex-wrap')
    expect(fiveCls).not.toContain('max-sm:inline-grid')
    expect(fiveCls).not.toContain('max-sm:grid-flow-col')
    // wrapping rows: a segment is never wider than the track
    expect(screen.getByRole('radio', { name: 'A' }).className.split(/\s+/)).toContain('max-sm:max-w-full')
  })

  it('fill: the phone row is a full-width grid', () => {
    render(<SegmentedControl aria-label="Show" fill value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radiogroup').className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['w-full', 'max-sm:grid', 'max-sm:grid-flow-col', 'max-sm:auto-cols-fr']))
  })

  it('a segment may break a long label onto two lines on a phone, growing taller instead of spilling', () => {
    render(<SegmentedControl aria-label="Show" value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radio', { name: /Needs action/ }).className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['max-sm:whitespace-normal', 'max-sm:h-auto', 'max-sm:min-h-segment']))
  })
})

describe('SegmentedControl: one phone row only when it fits (measured before paint)', () => {
  const proto = HTMLElement.prototype
  const saved = { sw: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'), cw: Object.getOwnPropertyDescriptor(proto, 'clientWidth') }
  afterEach(() => {
    if (saved.sw) Object.defineProperty(proto, 'scrollWidth', saved.sw)
    if (saved.cw) Object.defineProperty(proto, 'clientWidth', saved.cw)
    vi.unstubAllGlobals()
  })
  const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }))

  it('words that fit keep equal columns', () => {
    phone()
    render(<SegmentedControl aria-label="Show" value="any" onValueChange={() => undefined} options={options} />)
    expect(screen.getByRole('radiogroup').className.split(/\s+/)).toContain('max-sm:auto-cols-fr')
  })

  it('a segment whose words spill gives up equal columns, then the row, and wraps', () => {
    phone()
    // every box reports more content than room: no one-row layout can hold it
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 50 })
    render(<SegmentedControl aria-label="Show" value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radiogroup').className.split(/\s+/)
    expect(cls).not.toContain('max-sm:inline-grid')
    expect(cls).toContain('flex-wrap')
  })
})
