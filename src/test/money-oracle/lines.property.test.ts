import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convertToPaisa, formatPaisa, gstWholeRupeesPaisa, paisaToFixed, productPaisa, sumPaisa, toPaisa } from '@/lib/money'
import { lineGstPaisa, lineNetPaisa, orderTotals } from '@/features/orders/lib/orderMath'
import { basisChoices } from '@/features/orders/lib/basis'
import { computeTotals, lineGstPaisa as quoteLineGst, lineNetPaisa as quoteLineNet } from '@/features/quotations/lib/totals'
import { lineTotal, poLineAmounts, poTotal, type PrefillRow } from '@/features/purchaseOrders/lib/prefill'
import { convertP, dec, itemsTotal, lineGst, lineNet, netFromGrossPrice, productP, roundDiv, rs } from '@/test/money-oracle/oracle'
import { RUNS, linesArb, lineArb, paisaArb, priceArb, qtyArb, rateArb, scaledText } from '@/test/money-oracle/arbitraries'

/*
 * Order lines, quotation lines and PO lines: the app's arithmetic against the oracle, over thousands of random lines.
 * The database rule (DATA_MODEL 2.13; v_order_items_total, quotation_set_totals, purchase_order_set_total):
 *   line net = round(qty x price, 2), line GST = round(line net x rate / 100, 0) per line, totals are sums of rounded lines.
 */

const asLine = (l: { qty: string; price: string; rate: string }) => ({ qty: Number(l.qty), unitPriceNet: Number(l.price), gstRate: Number(l.rate) })

describe('order lines (orders/lib/orderMath) match the oracle', () => {
  it('line net = round(qty x price, 2), exactly, for any line', () => {
    fc.assert(
      fc.property(lineArb, l => {
        expect(BigInt(lineNetPaisa(asLine(l)))).toBe(lineNet(l))
      }),
      RUNS,
    )
  })

  it('line GST = round(line net x rate / 100, 0), whole rupees, exempt is 0', () => {
    fc.assert(
      fc.property(lineArb, l => {
        const gst = BigInt(lineGstPaisa(asLine(l)))
        expect(gst).toBe(lineGst(lineNet(l), l.rate))
        expect(gst % 100n).toBe(0n)
        if (l.rate === '0') expect(gst).toBe(0n)
      }),
      RUNS,
    )
  })

  it('order totals are sums of the rounded lines (never a rate applied to a sum)', () => {
    fc.assert(
      fc.property(linesArb(), lines => {
        const t = orderTotals(lines.map(asLine))
        const o = itemsTotal(lines)
        expect(toPaisa(t.net)).toBe(o.net)
        expect(toPaisa(t.gst)).toBe(o.gst)
        expect(toPaisa(t.gross)).toBe(o.gross)
      }),
      RUNS,
    )
  })

  it('half-paisa and half-rupee boundaries round away from zero (the database cases)', () => {
    expect(lineNet({ qty: '0.100', price: '0.35' })).toBe(4n) // 0.035 -> 0.04
    expect(lineNet({ qty: '0.100', price: '21.95' })).toBe(220n) // 2.195 -> 2.20
    expect(lineGst(2500n, '18')).toBe(500n) // 25.00 x 18% = 4.50 -> 5
    expect(lineGst(7500n, '18')).toBe(1400n) // 75.00 x 18% = 13.50 -> 14
    expect(BigInt(lineNetPaisa({ qty: 0.1, unitPriceNet: 0.35 }))).toBe(4n)
    expect(BigInt(lineGstPaisa({ qty: 1, unitPriceNet: 25, gstRate: 18 }))).toBe(500n)
  })

  it('D-MR1 (accepted): splitting a line may move the order GST by about Rs 1, never more than Rs 1 per split', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 400 }), priceArb, fc.integer({ min: 1, max: 399 }), (qty, price, movedRaw) => {
        const moved = Math.min(movedRaw, qty - 1)
        const whole = itemsTotal([{ qty: `${qty}.000`, price, rate: '18' }])
        const split = itemsTotal([
          { qty: `${qty - moved}.000`, price, rate: '18' },
          { qty: `${moved}.000`, price, rate: '18' },
        ])
        expect(split.net).toBe(whole.net) // whole quantities: the net never moves
        const d = split.gst - whole.gst
        expect(d >= -100n && d <= 100n).toBe(true)
      }),
      RUNS,
    )
  })
})

describe('quotation lines (quotations/lib/totals) match the oracle', () => {
  it('each line and the totals', () => {
    fc.assert(
      fc.property(linesArb(), lines => {
        const t = computeTotals(lines.map(l => ({ qty: Number(l.qty), unitPrice: Number(l.price), gstRate: Number(l.rate) })))
        const o = itemsTotal(lines)
        expect(t.net).toBe(o.net)
        expect(t.gst).toBe(o.gst)
        expect(t.gross).toBe(o.gross)
        lines.forEach((l, i) => {
          expect(quoteLineNet(Number(l.qty), Number(l.price))).toBe(lineNet(l))
          expect(quoteLineGst(lineNet(l), Number(l.rate))).toBe(lineGst(lineNet(l), l.rate))
          expect(t.lines[i].net).toBe(lineNet(l))
        })
      }),
      RUNS,
    )
  })

  it('totals per rate add up to the totals', () => {
    fc.assert(
      fc.property(linesArb(), lines => {
        const t = computeTotals(lines.map(l => ({ qty: l.qty, unitPrice: l.price, gstRate: l.rate })))
        expect(sumPaisa(t.netByRate.values())).toBe(t.net)
        expect(sumPaisa(t.gstByRate.values())).toBe(t.gst)
      }),
      RUNS,
    )
  })
})

describe('supplier prices and PO lines (lib/money, purchaseOrders/lib/prefill) match the oracle', () => {
  const supplierPriceArb = fc.bigInt({ min: 0n, max: 5_000_000_000n }).map(u => scaledText(u, 4)) // numeric(14,4)

  it('productPaisa: qty x a 4-decimal supplier price, rounded once to the paisa', () => {
    fc.assert(
      fc.property(qtyArb, supplierPriceArb, (q, p) => {
        expect(productPaisa(Number(q), Number(p))).toBe(productP(q, p, 4))
        expect(productPaisa(q, p)).toBe(productP(q, p, 4))
      }),
      RUNS,
    )
  })

  it('productPaisa: a typed PO price of up to 6 decimals', () => {
    fc.assert(
      fc.property(qtyArb, fc.bigInt({ min: 0n, max: 50_000_000_000n }).map(u => scaledText(u, 6)), (q, p) => {
        expect(productPaisa(q, p)).toBe(productP(q, p, 6))
      }),
      RUNS,
    )
  })

  it('a PO line, the PO total and the printed amounts equal purchase_order_set_total (sum of rounded lines)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(qtyArb, supplierPriceArb), { minLength: 1, maxLength: 10 }), rows => {
        const prefill: PrefillRow[] = rows.map(([q, p], i) => ({
          orderItemId: `i${i}`,
          position: i,
          description: 'x',
          qty: Number(q),
          unit: null,
          unitPrice: Number(p),
          source: 'order',
          sourceNumber: null,
          sourceRevision: null,
          sourceOn: null,
        }))
        const want = rows.reduce((s, [q, p]) => s + productP(q, p, 4), 0n)
        expect(toPaisa(poTotal(prefill, {}))).toBe(want)
        const printed = poLineAmounts(rows.map(([q, p]) => ({ qty: q, unit_price: p })))
        expect(toPaisa(printed.total)).toBe(want)
        rows.forEach(([q, p], i) => {
          expect(toPaisa(lineTotal(Number(q), Number(p)) as number)).toBe(productP(q, p, 4))
          expect(toPaisa(printed.amounts[i])).toBe(productP(q, p, 4))
        })
      }),
      RUNS,
    )
  })

  it('gstWholeRupeesPaisa is the per-line GST rule', () => {
    fc.assert(
      fc.property(paisaArb(), rateArb, (net, rate) => {
        expect(gstWholeRupeesPaisa(net, Number(rate))).toBe(lineGst(net, rate))
      }),
      RUNS,
    )
  })
})

describe('conversion and display rounding (lib/money) match the oracle', () => {
  const rateArb6 = fc.bigInt({ min: 1n, max: 2_000_000_000n }).map(u => scaledText(u, 6)) // numeric(14,6), > 0

  it('convertToPaisa: foreign amount x rate, rounded once', () => {
    fc.assert(
      fc.property(paisaArb(), rateArb6, (foreign, rate) => {
        expect(convertToPaisa(rs(foreign), rate)).toBe(convertP(foreign, dec(rate, 6)))
        expect(convertToPaisa(Number(rs(foreign)), Number(rate))).toBe(convertP(foreign, dec(rate, 6)))
      }),
      RUNS,
    )
  })

  it("formatPaisa 'never' rounds to whole rupees half away from zero; the paisa modes keep every digit", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }), p => {
        const whole = roundDiv(p, 100n)
        const shown = formatPaisa(p, 'never').replace(/,/g, '').replace('−', '-')
        expect(BigInt(shown)).toBe(whole)
        expect(toPaisa(formatPaisa(p, 'always').replace(/,/g, '').replace('−', '-'))).toBe(p)
        expect(toPaisa(paisaToFixed(p))).toBe(p)
      }),
      RUNS,
    )
  })

  it('toPaisa reads a numeric(14,2) JSON number exactly, and sums exactly', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -99_999_999_999_99n, max: 99_999_999_999_99n }), { maxLength: 50 }), ps => {
        expect(sumPaisa(ps.map(p => Number(rs(p))))).toBe(ps.reduce((a, b) => a + b, 0n))
      }),
      RUNS,
    )
  })
})

describe('resolve value basis preview (orders/lib/basis) matches resolve_value_basis', () => {
  it("'gross' divides each unit price by 1 + rate / 100 to the paisa; the totals follow the line rules", () => {
    fc.assert(
      fc.property(linesArb(8), lines => {
        const c = basisChoices(lines.map(asLine), null)
        const resolved = lines.map(l => ({ ...l, price: rs(netFromGrossPrice(dec(l.price, 2), l.rate)) }))
        const o = itemsTotal(resolved)
        expect(toPaisa(c.gross.net)).toBe(o.net)
        expect(toPaisa(c.gross.gst)).toBe(o.gst)
        const asNet = itemsTotal(lines)
        expect(toPaisa(c.net.net)).toBe(asNet.net)
        expect(toPaisa(c.net.gross)).toBe(asNet.gross)
      }),
      RUNS,
    )
  })
})
