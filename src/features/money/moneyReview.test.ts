import { describe, expect, it } from 'vitest'
import { estimateExpectedCost } from '@/features/money/lib/costEstimate'
import { gstForNet, invoiceStart } from '@/features/money/invoices/model'
import { buildPnl, PAYABLE_STATE_LABEL, pnlCsv, ZERO_PNL } from '@/features/money/monthEnd/model'
import { lineGstPaisa, lineNetPaisa, orderTotals } from '@/features/orders/lib/orderMath'
import { lineTotal, poLineAmounts, poTotal, type PrefillRow } from '@/features/purchaseOrders/lib/prefill'
import { gstWholeRupeesPaisa, productPaisa } from '@/lib/money'

/*
 * Money review (docs/MONEY_REVIEW.md). Each block is one bug the review found: the test failed before the fix and names the
 * database rule it now agrees with. The database is the authority:
 *   order line net   round(qty x unit_price_net, 2)           (v_order_items_total, 0014)
 *   order line GST   round(line net x rate / 100, 0)          (whole rupees per line, 0014)
 *   PO line / total  round(qty x unit_price, 2), summed        (purchase_order_set_total, 0022)
 * Postgres numeric rounds half away from zero on exact decimals; a float product such as 1.005 x 100 = 100.49999999999999 does not.
 */

describe('MR-1 exact decimal products (lib/money)', () => {
  it('rounds qty x price to the paisa the way numeric does, half away from zero', () => {
    expect(productPaisa(1, 1.005)).toBe(101n)
    expect(productPaisa(0.1, 0.35)).toBe(4n)
    expect(productPaisa(0.015, 491)).toBe(737n)
    expect(productPaisa('2.5', '21.15')).toBe(5288n)
    expect(productPaisa(3, '12.3456')).toBe(3704n)
    expect(productPaisa(6, 214)).toBe(128400n)
  })
  it('GST to whole rupees per line, half away from zero', () => {
    expect(gstWholeRupeesPaisa(2500n, 18)).toBe(500n) // 25.00 x 18% = 4.50 -> 5
    expect(gstWholeRupeesPaisa(2400n, 18)).toBe(400n) // 4.32 -> 4
    expect(gstWholeRupeesPaisa(5000n, 0)).toBe(0n)
  })
})

describe('MR-2 order line display matches v_order_items_total (orders/lib/orderMath)', () => {
  it('a fractional quantity rounds the line net like the database (0.1 x 0.35 = 0.035 -> 0.04)', () => {
    expect(lineNetPaisa({ qty: 0.1, unitPriceNet: 0.35 })).toBe(4)
    expect(lineNetPaisa({ qty: 0.015, unitPriceNet: 491 })).toBe(737)
    expect(lineNetPaisa({ qty: 0.1, unitPriceNet: 21.95 })).toBe(220)
  })
  it('the order total is the sum of the database-rounded lines', () => {
    const t = orderTotals([
      { qty: 0.1, unitPriceNet: 0.35, gstRate: 18 },
      { qty: 0.1, unitPriceNet: 10.35, gstRate: 18 },
    ])
    expect(t.net).toBe(1.08) // 0.04 + 1.04
    expect(lineGstPaisa({ qty: 2, unitPriceNet: 12.5, gstRate: 18 })).toBe(500) // 25.00 -> GST 4.50 -> 5
  })
})

describe('MR-3 PO line totals match purchase_order_set_total (purchaseOrders/lib/prefill and the PO PDF)', () => {
  const row = (qty: number, price: number): PrefillRow => ({
    orderItemId: `i${qty}-${price}`,
    position: 0,
    description: 'x',
    qty,
    unit: null,
    unitPrice: price,
    source: 'order',
    sourceNumber: null,
    sourceRevision: null,
    sourceOn: null,
  })
  it('qty 1 at USD 1.005 is 1.01 on the PO, not 1.00', () => {
    expect(lineTotal(1, 1.005)).toBe(1.01)
    expect(poTotal([row(1, 1.005), row(1, 2.675)], {})).toBe(3.69)
  })
  it('the PDF lines and total are the stored total', () => {
    const p = poLineAmounts([
      { qty: 1, unit_price: 1.005 },
      { qty: '1', unit_price: '2.675' },
    ])
    expect(p.amounts).toEqual([1.01, 2.68])
    expect(p.total).toBe(3.69)
  })
})

describe('MR-4 expected-cost suggestion after a split (money/lib/costEstimate)', () => {
  it('a line split off a PO-ed leg is not counted twice: the PO price applies to the quantity still on the line', () => {
    // PO for leg A was issued for 10 at 100. Then split_order_item moved 4 to leg B at 90 (A8 allows a split after a PO).
    const e = estimateExpectedCost({
      items: [
        { id: '1', qty: 6, supplierUnitPrice: 100, legId: 'A', isService: false },
        { id: '2', qty: 4, supplierUnitPrice: 90, legId: 'B', isService: false },
      ],
      legs: [
        { id: 'A', currency: 'PKR' },
        { id: 'B', currency: 'PKR' },
      ],
      pos: [{ legId: 'A', currency: 'PKR', lines: [{ orderItemId: '1', qty: 10, unitPrice: 100 }] }],
      rates: {},
    })
    expect(e.pkr).toBe(960) // 6 x 100 + 4 x 90, not 10 x 100 + 4 x 90 = 1,360
  })
})

describe('MR-5 part invoice on a mixed-rate order (money/invoices/model)', () => {
  it('typing a smaller net scales the GST of what is left instead of keeping all of it', () => {
    // 500 at 18% (GST 90) and 500 exempt: 1,000 net, 90 GST left to invoice. Invoicing half of it carries half the GST.
    const start = invoiceStart({ itemsNet: 1000, itemsGst: 90, lineCount: 2, exemptLineCount: 1, invoicedNet: 0, invoicedGst: 0, paymentTermsDays: 30 })
    expect(start.option).toBe('mixed')
    expect(gstForNet(500, 'mixed', start)).toBe(45)
    expect(gstForNet(1000, 'mixed', start)).toBe(90)
    expect(gstForNet(500, '18', start)).toBe(90)
    expect(gstForNet(500, 'exempt', start)).toBe(0)
  })
})

describe('MR-8 a change to a closed month is shown where it lands (owner decision D-MR2, money/monthEnd/model)', () => {
  const via = { cashCount: 0, cashAmount: '0.00', bankCount: 0, bankAmount: '0.00' }
  const raw = { ...ZERO_PNL, netIn: '0.00', result: '180.00', afterDrawings: '180.00', adjustResult: '180.00', adjustNonPnl: '0.00', frozenAt: null }
  it('the P&L carries the adjustment, and its CSV has a line for it so the rows add up to the result', () => {
    const v = buildPnl('2026-02', raw, { count: 0, unresolved: [] }, [], via)
    expect(v.adjustResult).toBe('180.00')
    const row = pnlCsv(v).rows.find(r => r[1] === 'Changes to closed months, counted this month')
    expect(row).toEqual(['Adjustment', 'Changes to closed months, counted this month', '', '', '', 180])
  })
  it('a closed month says it is frozen; an open month with no change has no adjustment line', () => {
    expect(buildPnl('2026-01', { ...ZERO_PNL, frozenAt: '2026-02-03T10:00:00Z' }, { count: 0, unresolved: [] }, [], via).frozenAt).toBe('2026-02-03T10:00:00Z')
    const plain = buildPnl('2026-03', ZERO_PNL, { count: 0, unresolved: [] }, [], via)
    expect(plain.adjustResult).toBe('0.00')
    expect(pnlCsv(plain).rows.some(r => r[0] === 'Adjustment')).toBe(false)
  })
  it('we owe calls a leg with no usable rate "Needs a rate" (D-MR4)', () => {
    expect(PAYABLE_STATE_LABEL.no_rate).toBe('Needs a rate')
  })
})
