import { describe, expect, it } from 'vitest'
import { figureEm, fitFigure, sumFitVars } from '@/features/money/fit'

describe('big figures stay whole (audit 1, blocker 2)', () => {
  it('measures a figure by its digits and its narrow separators', () => {
    expect(figureEm('0')).toBe(0.62)
    expect(figureEm('1,000')).toBe(2.78)
    // 12 digits and 3 commas: wider than any 7-digit figure
    expect(figureEm('104,116,750,088')).toBeGreaterThan(figureEm('9,878,205'))
  })

  it('never breaks the figure and steps the size down from the token to fit its box', () => {
    const s = fitFigure('104,116,750,088', 'var(--text-hero)', '3.5rem')
    expect(s.whiteSpace).toBe('nowrap')
    expect(s.fontSize).toBe(`min(var(--text-hero), calc((100cqi - 3.5rem) / ${figureEm('104,116,750,088')}))`)
  })

  it('sizes a row of tiles from its widest figure, with a floor for short ones', () => {
    expect(sumFitVars(['7', null, '0'])).toEqual({ '--sum-em': '4' })
    expect(sumFitVars(['116,436,078,065', '7'])).toEqual({ '--sum-em': String(figureEm('116,436,078,065')) })
  })
})
