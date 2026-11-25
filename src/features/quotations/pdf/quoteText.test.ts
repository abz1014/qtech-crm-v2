import { describe, expect, it } from 'vitest'
import { deliveryLine, footerAddress, inquiryDay, itemDetail, paymentLine, quoteDay, toLine, validityLine } from '@/features/quotations/pdf/quoteText'
import { quotationRef } from '@/features/quotations/lib/refs'
import { normalizeQuoteCode, quoteCodeProblem, suggestQuoteCode } from '@/features/companies/quoteCode'

describe('quotation PDF words (owner template)', () => {
  it('writes the dates as the template does', () => {
    expect(quoteDay('2026-11-23')).toBe('23-Nov-26')
    expect(quoteDay('2027-01-05')).toBe('05-Jan-27')
    expect(inquiryDay('2026-11-21')).toBe('21-11-2026')
  })

  it('says the validity in weeks when it is whole weeks, else in days', () => {
    expect(validityLine('2026-11-23', '2026-12-07')).toBe('2 Weeks.')
    expect(validityLine('2026-11-23', '2026-11-30')).toBe('1 Week.')
    expect(validityLine('2026-11-23', '2026-12-23')).toBe('30 Days.')
    expect(validityLine('2026-11-23', '2026-11-24')).toBe('1 Day.')
  })

  it('takes the delivery from the quotation, or from the lead times', () => {
    expect(deliveryLine('Ex works Lahore', ['2 weeks'])).toEqual({ line: 'Ex works Lahore.', perItem: false })
    expect(deliveryLine(null, ['4 weeks', '4 Weeks'])).toEqual({ line: '4 weeks.', perItem: false })
    expect(deliveryLine(null, ['4 weeks', '8 weeks'])).toEqual({ line: 'Mentioned against each item.', perItem: true })
    expect(deliveryLine(null, ['4 weeks', null])).toEqual({ line: 'Mentioned against each item.', perItem: true })
    expect(deliveryLine(null, [null, ' '])).toEqual({ line: null, perItem: false })
  })

  it('reads payment terms as days of credit, or prints them as typed, or falls back to the company default', () => {
    expect(paymentLine('30', 15)?.text).toBe('Payment Terms: 30 Days Credit.')
    expect(paymentLine('45 days', 15)?.text).toBe('Payment Terms: 45 Days Credit.')
    expect(paymentLine('50% advance', 15)?.text).toBe('Payment Terms: 50% advance.')
    expect(paymentLine(null, 30)?.text).toBe('Payment Terms: 30 Days Credit.')
    expect(paymentLine('', 0)).toBeNull()
  })

  it('addresses the contact with a title and designation', () => {
    expect(toLine('Imran Sample', 'Purchase Officer')).toBe('Mr. Imran Sample (Purchase Officer),')
    expect(toLine('Engr. Sana Example', null)).toBe('Engr. Sana Example,')
    expect(toLine(null, 'Buyer')).toBeNull()
  })

  it('puts the item in capitals with bold-label detail lines and the brand as Make', () => {
    expect(itemDetail('Laser sensor\nModel: LS-10\nSpecs: 10 to 30 VDC\nCondition: Brand New', 'Acme', null)).toEqual({
      title: 'LASER SENSOR',
      lines: [
        { label: 'Model', text: 'LS-10' },
        { label: 'Specs', text: '10 to 30 VDC' },
        { label: 'Make', text: 'ACME' },
        { label: 'Condition', text: 'Brand New' },
      ],
    })
    expect(itemDetail('Gland M20\nMake: Other', 'Acme', '2 weeks').lines).toEqual([
      { label: 'Make', text: 'Other' },
      { label: 'Delivery', text: '2 weeks' },
    ])
    expect(itemDetail('Plain item\nsecond line', null, null).lines).toEqual([{ label: null, text: 'second line' }])
  })

  it('splits the footer address into two lines', () => {
    expect(footerAddress('12 Sample Road, Block C\nModel Town, Lahore')).toEqual(['12 Sample Road, Block C', 'Model Town, Lahore'])
    expect(footerAddress('12 Sample Road, Model Town, Lahore')).toEqual(['12 Sample Road', 'Model Town, Lahore'])
    expect(footerAddress(null)).toEqual([])
  })
})

describe('quotation numbers (0147)', () => {
  it('prints QTS-<code>-<number> for a coded quotation and the old QT-YY-NNNN otherwise', () => {
    expect(quotationRef(4810, '2026-11-23', undefined, 'TQA')).toBe('QTS-TQA-4810')
    expect(quotationRef(4810, '2026-11-23', 2, 'TQA')).toBe('QTS-TQA-4810 R2')
    expect(quotationRef(42, '2026-11-23')).toBe('QT-26-0042')
    expect(quotationRef(42, '2026-11-23', 1, null)).toBe('QT-26-0042 R1')
  })

  it('suggests a customer code from the initials, moved on when it is taken', () => {
    expect(suggestQuoteCode('Tasman Quarry Allied Limited')).toBe('TQAL')
    expect(suggestQuoteCode('Sample Fibres (Pvt.) Limited')).toBe('SFL')
    expect(suggestQuoteCode('Acme')).toBe('ACM')
    expect(suggestQuoteCode('Bank of the North')).toBe('BN')
    expect(suggestQuoteCode('Sample Fibres Limited', new Set(['SFL']))).toBe('SFLA')
  })

  it('checks a typed code', () => {
    expect(normalizeQuoteCode(' s f l ')).toBe('SFL')
    expect(quoteCodeProblem('sfl')).toBeNull()
    expect(quoteCodeProblem('S')).toBe('Use 2 to 6 letters.')
    expect(quoteCodeProblem('SF1')).toBe('Use letters only, for example IFL.')
    expect(quoteCodeProblem('')).toBe('Enter the customer code, for example IFL.')
  })
})
