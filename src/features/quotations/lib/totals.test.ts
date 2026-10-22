import { describe, expect, it } from 'vitest'
import { amountInWords, computeTotals, lineGstPaisa, lineNetPaisa } from '@/features/quotations/lib/totals'
import { addDays, isExpired, quotationRef } from '@/features/quotations/lib/refs'

describe('quotation totals', () => {
  it('matches the approved PDF (QT-26-0042 R2): net 1,383,000, GST 248,940, gross 1,631,940', () => {
    const t = computeTotals([
      { qty: 2, unitPrice: 148500, gstRate: 18 },
      { qty: 1, unitPrice: 468000, gstRate: 18 },
      { qty: 3, unitPrice: 206000, gstRate: 18 },
    ])
    expect(t.lines.map(l => l.net)).toEqual([29_700_000n, 46_800_000n, 61_800_000n])
    expect(t.net).toBe(138_300_000n)
    expect(t.gst).toBe(24_894_000n)
    expect(t.gross).toBe(163_194_000n)
    expect(t.gstByRate.get('18')).toBe(24_894_000n)
  })

  it('rounds the line net to the paisa, half away from zero', () => {
    expect(lineNetPaisa('3.5', '0.33')).toBe(116n) // 1.155 -> 1.16
    expect(lineNetPaisa('2.5', '10.01')).toBe(2503n) // 25.025 -> 25.03
    expect(lineNetPaisa(0.333, 100)).toBe(3330n)
    expect(lineNetPaisa('1.005', '1.00')).toBe(101n)
  })

  it('rounds GST per line to whole rupees, and the total is the sum of the rounded lines', () => {
    // 100.50 x 18% = 18.09 -> 18 per line. Three such lines: 54, not round(301.50 x 0.18 = 54.27) = 54 (same here), so use a case that differs.
    expect(lineGstPaisa(10050n, 18)).toBe(1800n)
    // Net 2.50 at 18% = 0.45 -> 0 rupees; net 2.80 at 18% = 0.504 -> 1 rupee.
    expect(lineGstPaisa(250n, 18)).toBe(0n)
    expect(lineGstPaisa(280n, 18)).toBe(100n)
    const t = computeTotals([
      { qty: 1, unitPrice: 2.8, gstRate: 18 },
      { qty: 1, unitPrice: 2.8, gstRate: 18 },
    ])
    expect(t.gst).toBe(200n) // 1 + 1, where 18% of 5.60 = 1.008 would give 1
    expect(t.net).toBe(560n)
  })

  it('treats a half rupee of GST as rounding up (half away from zero)', () => {
    // 2.78 x 18% = 0.5004 -> 1; 2.7 x 18% = 0.486 -> 0; 50.00 x 1% = 0.50 -> 1
    expect(lineGstPaisa(5000n, 1)).toBe(100n)
    expect(lineGstPaisa(278n, 18)).toBe(100n)
    expect(lineGstPaisa(270n, 18)).toBe(0n)
  })

  it('GST exempt: a 0 % line has no GST, and it is kept apart from the taxed lines', () => {
    const t = computeTotals([
      { qty: 1, unitPrice: 1000, gstRate: 18 },
      { qty: 2, unitPrice: 500, gstRate: 0 },
    ])
    expect(t.lines[1]).toEqual({ priced: true, net: 100_000n, gst: 0n, gross: 100_000n })
    expect(t.net).toBe(200_000n)
    expect(t.gst).toBe(18_000n)
    expect(t.gross).toBe(218_000n)
    expect(t.netByRate.get('0')).toBe(100_000n)
    expect(t.gstByRate.has('0')).toBe(true)
    expect(t.gstByRate.get('0')).toBe(0n)
  })

  it('an unpriced line adds nothing and is not counted', () => {
    const t = computeTotals([
      { qty: 1, unitPrice: null, gstRate: 18 },
      { qty: 1, unitPrice: 100, gstRate: 18 },
    ])
    expect(t.pricedLines).toBe(1)
    expect(t.lines[0].priced).toBe(false)
    expect(t.net).toBe(10_000n)
  })

  it('a price of 0 is a price (free of charge), not a missing one', () => {
    const t = computeTotals([{ qty: 1, unitPrice: 0, gstRate: 18 }])
    expect(t.pricedLines).toBe(1)
    expect(t.gross).toBe(0n)
  })
})

describe('very large amounts (HW-2)', () => {
  it('a 22-digit price is computed, not thrown', () => {
    const t = computeTotals([{ qty: 1, unitPrice: 1e22, gstRate: 18 }])
    expect(t.net).toBe(10n ** 22n * 100n)
    expect(t.gst).toBe(18n * 10n ** 20n * 100n)
  })
})

describe('amount in words', () => {
  it('reads the gross of the approved PDF', () => {
    expect(amountInWords(163_194_000n)).toBe('One million six hundred thirty-one thousand nine hundred forty rupees only.')
  })
  it('handles small, round and paise amounts', () => {
    expect(amountInWords(0n)).toBe('Zero rupees only.')
    expect(amountInWords(100n)).toBe('One rupee only.')
    expect(amountInWords(2_100_000n)).toBe('Twenty-one thousand rupees only.')
    expect(amountInWords(10_050n)).toBe('One hundred rupees and fifty paise only.')
  })
})

describe('references and validity', () => {
  it('dresses the number as QT-YY-NNNN with an optional revision', () => {
    expect(quotationRef(42, '2026-11-26')).toBe('QT-26-0042')
    expect(quotationRef(42, '2026-11-26', 2)).toBe('QT-26-0042 R2')
  })
  it('adds days on the calendar and counts a quotation expired only after its last day', () => {
    expect(addDays('2026-11-27', 30)).toBe('2026-12-27')
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19')
    expect(isExpired('2026-12-27', '2026-12-27')).toBe(false)
    expect(isExpired('2026-12-26', '2026-12-27')).toBe(true)
  })
})
