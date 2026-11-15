import { describe, expect, it } from 'vitest'
import { fitEms } from '@/ui/moneyFit'
import { SUM_FIT, sumFitVars } from '@/features/money/fit'

describe('summary tiles never cut a figure (audit 1, blocker 2)', () => {
  it('sizes a row of tiles from its widest figure, with a floor for short ones', () => {
    expect(sumFitVars(['7', null, '0'])).toEqual({ '--sum-em': '4' })
    expect(sumFitVars(['116,436,078,065', '7'])).toEqual({ '--sum-em': String(fitEms('116,436,078,065')) })
  })

  it('lets the tiles wrap, each as wide as that figure needs', () => {
    expect(SUM_FIT).toContain('flex-wrap')
    expect(SUM_FIT).toContain('var(--sum-em)*var(--text-xl)')
  })
})
