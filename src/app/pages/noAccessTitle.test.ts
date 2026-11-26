import { describe, expect, it } from 'vitest'
import { areaVerb, noAccessTitle } from '@/app/pages/noAccessTitle'

describe('the no-access heading reads as a sentence (screen review 2026-11-24, item 25)', () => {
  it('a plural area takes "are"', () => {
    for (const a of ['Expense categories', 'Exchange rates', 'Targets', 'Tax deadlines', 'Product categories', 'Money reports', 'Backups and usage', 'Mistakes to fix', 'Payments'])
      expect(areaVerb(a), a).toBe('are')
  })

  it('a singular area keeps "is"', () => {
    for (const a of ['Money', 'Team', 'Archive', 'New RFQ', 'New company', 'GST to FBR', 'Bank check', 'Profitability', 'Lock a month', 'I paid', 'Export data', 'Weekly review'])
      expect(areaVerb(a), a).toBe('is')
  })

  it('names who the area is for', () => {
    expect(noAccessTitle('Expense categories', ['admin'])).toBe('Expense categories are for admins')
    expect(noAccessTitle('Money', ['admin', 'sales'])).toBe('Money is for admins and sales')
  })
})
