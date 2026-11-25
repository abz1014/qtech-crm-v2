import { describe, expect, it } from 'vitest'
import { looksLikeCompanyName } from '@/features/companies/companyName'

/* Screen review 2026-11-24, item 20: only name-like text is offered as a new company. */
describe('looksLikeCompanyName', () => {
  it('a document number is not a name', () => {
    for (const t of ['PO-988374', 'po 988374', 'RFQ-0012', 'QT-26-0003', 'QT-26-0005 R0', 'QTS-12', 'INV-2311', 'INV 44', 'ORD-0002', 'Job 139', 'O-45', 'PO#4471', 'PO No. 12'])
      expect(looksLikeCompanyName(t), t).toBe(false)
  })
  it('digits, a phone number or a code word is not a name', () => {
    for (const t of ['', '   ', '988374', '0301 5550142', '+92 300 1234567', 'X988374', '26-0003A']) expect(looksLikeCompanyName(t), t).toBe(false)
  })
  it('real names stay names, with a figure, in any script, or starting like a prefix', () => {
    for (const t of ['Ibrahim Fibres', '3M', 'ABB 2', 'Plant 7 Engineering', 'Order Tech Ltd', 'Invest Pak', 'Ozone 3', 'Polymer House', 'Qtech Solutions', 'ab', 'اتحاد ٹریڈرز'])
      expect(looksLikeCompanyName(t), t).toBe(true)
  })
})
