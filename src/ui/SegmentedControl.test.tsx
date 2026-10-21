import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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

  it('a segment may break a long label onto two lines on a phone, growing taller instead of spilling', () => {
    render(<SegmentedControl aria-label="Show" value="any" onValueChange={() => undefined} options={options} />)
    const cls = screen.getByRole('radio', { name: /Needs action/ }).className.split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['max-sm:whitespace-normal', 'max-sm:h-auto', 'max-sm:min-h-segment', 'max-sm:max-w-full']))
  })
})
