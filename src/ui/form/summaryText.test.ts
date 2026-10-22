import { describe, expect, it } from 'vitest'
import { humaniseFieldName, summaryLine } from '@/ui/form/summaryText'

describe('form summary text (hunt HE-6, HE-18)', () => {
  it('repeats the field message as a sentence, never "needs a value" for a field that has one', () => {
    expect(summaryLine('The amount must be above zero')).toBe('The amount must be above zero.')
    expect(summaryLine('Keep it short.')).toBe('Keep it short.')
    expect(summaryLine(undefined)).toBe('needs a value.')
    expect(summaryLine('  ')).toBe('needs a value.')
  })
  it('turns a schema key into words', () => {
    expect(humaniseFieldName('inputTax')).toBe('Input tax')
    expect(humaniseFieldName('lines.0.qty')).toBe('Qty')
    expect(humaniseFieldName('paid_on')).toBe('Paid on')
  })
})
