import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* Last user-facing "Rs" (decision I): the money reports say PKR. */
describe('report wording', () => {
  it('the supplier-debt tip says PKR, not Rs', () => {
    const src = readFileSync('src/features/money/monthEnd/ReportPages.tsx', 'utf8')
    expect(src).toContain('PKR 1 or less is left')
    expect(src).not.toMatch(/\bRs \d/)
  })
})
