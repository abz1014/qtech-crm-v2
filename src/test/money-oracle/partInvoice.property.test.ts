import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toPaisa } from '@/lib/money'
import { gstForNet, gstIsShare, gstOfWholeLines, invoiceStart, lineMoneyOf, overInvoiced, type LineMoney } from '@/features/money/invoices/model'
import { invoiceFigures, matchLines, type PdfOrderLine } from '@/features/money/invoices/pdf/model'
import { itemsTotal, lineGst, lineNet, rs, sumP, type Line } from '@/test/money-oracle/oracle'
import { RUNS, linesArb } from '@/test/money-oracle/arbitraries'

/*
 * Part invoices of a mixed-rate order (HW-11) and invoicing more than is left (HW-13), against the oracle. A part invoice whose
 * net is exactly a set of whole lines must carry those lines' own GST (whole rupees per line, DATA_MODEL 2.13), the GST its
 * sales-tax invoice PDF prints line by line, so the PDF can always be printed.
 */

const n = (p: bigint): number => Number(rs(p))

const pdfLines = (lines: readonly Line[]): PdfOrderLine[] => lines.map((l, i) => ({ id: `l${i}`, description: `Line ${i + 1}`, qty: l.qty, unit: null, unitPriceNet: l.price, gstRate: l.rate }))

const startFor = (lines: readonly Line[]) => {
  const t = itemsTotal(lines)
  return invoiceStart({
    itemsNet: n(t.net),
    itemsGst: n(t.gst),
    lineCount: lines.length,
    exemptLineCount: lines.filter(l => Number(l.rate) === 0).length,
    invoicedNet: 0,
    invoicedGst: 0,
    paymentTermsDays: 30,
    lines: lines.map(l => lineMoneyOf(l.qty, l.price, l.rate)),
  })
}

/** Oracle: the distinct GST totals of every set of whole lines whose nets add up to `net` (brute force). */
function gstsOfSetsSumming(lines: readonly Line[], net: bigint): Set<bigint> {
  const out = new Set<bigint>()
  const nets = lines.map(lineNet)
  const gsts = lines.map((l, i) => lineGst(nets[i], l.rate))
  for (let mask = 1; mask < 1 << lines.length; mask++) {
    let s = 0n
    let g = 0n
    for (let i = 0; i < lines.length; i++)
      if (mask & (1 << i)) {
        s += nets[i]
        g += gsts[i]
      }
    if (s === net && s > 0n) out.add(g)
  }
  return out
}

const subsetArb = fc.tuple(linesArb(9), fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }))

describe('part invoice of whole lines (HW-11) against the oracle', () => {
  it('each line’s own net and GST are the oracle’s (round(qty x price, 2); GST whole rupees per line)', () => {
    fc.assert(
      fc.property(linesArb(12), lines => {
        for (const l of lines) {
          const m = lineMoneyOf(l.qty, l.price, l.rate)
          expect(BigInt(m.net)).toBe(lineNet(l))
          expect(BigInt(m.gst)).toBe(lineGst(lineNet(l), l.rate))
        }
      }),
      RUNS,
    )
  })

  it('a net that is one set of whole lines carries exactly those lines’ GST, and the PDF prints it with no adjustment', () => {
    fc.assert(
      fc.property(subsetArb, ([lines, pick]) => {
        const chosen = lines.filter((_, i) => pick[i])
        const net = sumP(chosen.map(lineNet))
        fc.pre(net > 0n)
        const gsts = gstsOfSetsSumming(lines, net)
        fc.pre(gsts.size === 1) // the amount alone says which lines (or every reading carries the same GST)
        const want = [...gsts][0]
        const start = startFor(lines)
        const got = toPaisa(gstForNet(n(net), start.option, start))
        expect(got).toBe(want)
        // the PDF: the lines read from the net (or ticked) add up to the stored figures with no rupee moved
        const pl = pdfLines(lines)
        const match = matchLines(pl, n(net))
        const picks = match.picks.length > 0 ? match.picks : pl.filter((_, i) => pick[i]).map(l => ({ id: l.id, qty: l.qty }))
        const fig = invoiceFigures(pl, picks, { net: n(net), gst: n(got) })
        expect(fig.ok).toBe(true)
        if (fig.ok) expect(fig.figures.adjustment).toBe(0n)
      }),
      RUNS,
    )
  })

  it('the whole order still carries the GST of the lines, and a net that is no set of lines is a share (and says so)', () => {
    fc.assert(
      fc.property(linesArb(9), lines => {
        const t = itemsTotal(lines)
        fc.pre(t.net > 0n)
        const start = startFor(lines)
        expect(toPaisa(gstForNet(start.net, start.option, start))).toBe(t.gst)
        expect(gstIsShare(start.net, start.option, start)).toBe(false)
      }),
      RUNS,
    )
  })

  it('gstOfWholeLines refuses an ambiguous amount (two sets, different GST)', () => {
    const lines: LineMoney[] = [
      { net: 1_000_000, gst: 180_000 }, // 10,000 at 18%
      { net: 1_000_000, gst: 0 }, // 10,000 exempt
    ]
    expect(gstOfWholeLines(lines, 1_000_000n)).toBeNull()
    expect(gstOfWholeLines(lines, 2_000_000n)).toBe(180_000n)
    expect(gstOfWholeLines(lines, 123n)).toBeNull()
  })

  it('HW-11 regression: 10,000 at 18% + 5,000 exempt; invoicing exactly the 18% line gives GST 1,800 (was 1,200) and the PDF prints', () => {
    const lines: Line[] = [
      { qty: '1', price: '10000.00', rate: '18' },
      { qty: '1', price: '5000.00', rate: '0' },
    ]
    const start = startFor(lines)
    expect(start.option).toBe('mixed')
    expect(gstForNet(10000, 'mixed', start)).toBe(1800)
    expect(gstForNet(5000, 'mixed', start)).toBe(0)
    expect(gstIsShare(10000, 'mixed', start)).toBe(false)
    expect(gstIsShare(7000, 'mixed', start)).toBe(true) // not whole lines: a share, the dialog says so
    const fig = invoiceFigures(pdfLines(lines), matchLines(pdfLines(lines), 10000).picks, { net: 10000, gst: 1800 })
    expect(fig.ok && fig.figures.gst).toBe(180000n)
    // the second invoice, of what is left, carries the GST left: 0
    const second = invoiceStart({ ...startForAmounts(lines), invoicedNet: 10000, invoicedGst: 1800 })
    expect(gstForNet(second.net, second.option, second)).toBe(0)
  })
})

function startForAmounts(lines: readonly Line[]) {
  const t = itemsTotal(lines)
  return {
    itemsNet: n(t.net),
    itemsGst: n(t.gst),
    lineCount: lines.length,
    exemptLineCount: lines.filter(l => Number(l.rate) === 0).length,
    invoicedNet: 0,
    invoicedGst: 0,
    paymentTermsDays: 30,
    lines: lines.map(l => lineMoneyOf(l.qty, l.price, l.rate)),
  }
}

describe('invoicing more than is left (HW-13) against the oracle', () => {
  it('a net above what is left (beyond the Rs 1 allowance) is refused and names what is left; up to it is accepted', () => {
    fc.assert(
      fc.property(linesArb(9), fc.bigInt({ min: 0n, max: 100n }), fc.bigInt({ min: -100_000n, max: 100_000n }), (lines, invoicedPct, delta) => {
        const t = itemsTotal(lines)
        fc.pre(t.net > 0n)
        const invoiced = (t.net * invoicedPct) / 100n
        const left = t.net - invoiced
        const s = invoiceStart({ ...startForAmounts(lines), invoicedNet: n(invoiced) })
        expect(toPaisa(s.net)).toBe(left)
        const typed = left + delta
        fc.pre(typed > 0n)
        const r = overInvoiced(n(typed), s, n(t.net))
        if (typed > left + 100n) expect(r === null ? null : toPaisa(r)).toBe(left)
        else expect(r).toBeNull()
      }),
      RUNS,
    )
  })

  it('HW-13 regression: 20,000 on an order of 10,000 is refused; 10,000 and 10,001 are not', () => {
    const lines: Line[] = [{ qty: '1', price: '10000.00', rate: '18' }]
    const s = startFor(lines)
    expect(overInvoiced(20000, s, 10000)).toBe(10000)
    expect(overInvoiced(10000, s, 10000)).toBeNull()
    expect(overInvoiced(10001, s, 10000)).toBeNull()
    // an order without priced lines has nothing to check against
    expect(overInvoiced(5000, { net: 0 }, 0)).toBeNull()
  })
})
