import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toPaisa } from '@/lib/money'
import { dueOn, gstForNet, gstOn, invoiceStart, orderDueOn, registerTotals, type GstRow } from '@/features/money/invoices/model'
import { defaultPaymentAmount, filterReceivables, paymentNote, receivableTotals, reminderDue, type ReceivableRow } from '@/features/money/payments/model'
import { marginTotals, type MarginRow } from '@/features/money/margins/model'
import { estimateExpectedCost, type EstItem } from '@/features/money/lib/costEstimate'
import { rulePaymentOverdue } from '@/features/today/rules'
import type { TodayInputs } from '@/features/today/types'
import {
  addDays,
  addWorkingDays,
  basisOf,
  daysFrom,
  dec,
  invoiceGst,
  itemsTotal,
  maxP,
  orderMoneyOf,
  receivableOf,
  roundDiv,
  rs,
  sumP,
  type Books,
  type Invoice,
  type Order,
} from '@/test/money-oracle/oracle'
import { RUNS, RUNS_HEAVY, booksArb, dateArb, edgeDateArb, linesArb, paisaArb, scaledText } from '@/test/money-oracle/arbitraries'

/*
 * Invoices, payments, balances, due dates, reminders, margins and the expected-cost suggestion: the app's pure rules against
 * the oracle. A failing property that shows a real bug is kept as `it.fails` with its BUG id (docs: the final report).
 */

const n = (p: bigint): number => Number(rs(p))

const toRow = (o: Order, books: Books, today: string): ReceivableRow => {
  const r = receivableOf(o, books, today)
  return {
    orderId: o.id,
    orderNumber: o.number,
    companyId: o.companyId,
    companyName: o.companyId,
    ownerId: o.ownerId,
    invoiceNumbers: books.invoices.filter(i => i.orderId === o.id).map(i => i.number),
    gross: n(r.gross),
    settled: n(r.settled),
    balance: n(r.balance),
    overpaidBy: n(r.overpaid),
    dueOn: r.dueOn,
    isOverdue: r.overdue,
    state: r.state,
    lastRemindedOn: null,
    reminderCount: 0,
  }
}

// ------------------------------------------------------------------------------------------------ invoices

describe('Create invoice (money/invoices/model) against the oracle', () => {
  it('GST on a typed net at 18% is round(net x 18%, 0); exempt is 0', () => {
    fc.assert(
      fc.property(paisaArb(), fc.boolean(), (net, exempt) => {
        expect(toPaisa(gstOn(n(net), exempt ? 'exempt' : '18'))).toBe(invoiceGst(net, exempt))
      }),
      RUNS,
    )
  })

  it('a mixed-rate part invoice carries the remaining GST in proportion to the net typed (whole rupees), ties aside', () => {
    fc.assert(
      fc.property(paisaArb(), fc.bigInt({ min: 0n, max: 1000n }), fc.bigInt({ min: 1n, max: 1000n }), (startNet, gstShare, part) => {
        // a realistic remaining GST: up to 18% of the remaining net, in whole rupees (it comes from whole-rupee line GST)
        const startGstRupees = roundDiv(startNet * 18n * gstShare, 100n * 100n * 1000n)
        const typed = roundDiv(startNet * part, 1000n)
        const startGst = startGstRupees * 100n
        // exact half-rupee ties are BUG-M8 (below); everywhere else the share must be exact
        fc.pre(typed === 0n || (2n * startGst * typed) % (2n * startNet * 100n) !== startNet * 100n)
        const want = typed > 0n ? roundDiv(startGst * typed, startNet * 100n) * 100n : 0n
        expect(toPaisa(gstForNet(n(typed), 'mixed', { net: n(startNet), gst: n(startGst) }))).toBe(want)
      }),
      RUNS,
    )
  })

  // BUG-M8: the mixed-rate share is rounded with Math.round on a floating-point quotient. At an exact half rupee the float lands
  // just below .5 and the GST is rounded DOWN where every other GST in the books rounds half away from zero (Rs 1 per invoice).
  it('BUG-M8: at an exact half rupee the mixed-rate share rounds away from zero', () => {
    const ties: Array<[bigint, bigint, bigint]> = [
      [3060n, 500n, 918n], // left 30.60 net / 5 GST, typed 9.18: 5 x 9.18 / 30.60 = 1.50 -> 2
      [3060n, 500n, 2754n], // typed 27.54: 4.50 -> 5
      [1580n, 200n, 1185n], // left 15.80 / 2, typed 11.85: 1.50 -> 2
      [3504n, 600n, 3212n], // left 35.04 / 6, typed 32.12: 5.50 -> 6
    ]
    for (const [startNet, startGst, typed] of ties) {
      expect(toPaisa(gstForNet(n(typed), 'mixed', { net: n(startNet), gst: n(startGst) }))).toBe(roundDiv(startGst * typed, startNet * 100n) * 100n)
    }
  })

  it('BUG-M8 regression: 5 x 9.18 / 30.60 = 1.50 gives GST 2 (was 1)', () => {
    expect(gstForNet(9.18, 'mixed', { net: 30.6, gst: 5 })).toBe(2)
    expect(roundDiv(500n * 918n, 3060n * 100n)).toBe(2n)
  })

  // BUG-M10: typing the net in Create invoice (or picking 18%) recomputes GST as round(net x 18%) on the WHOLE invoice, while the
  // order, the quotation and the customer's PO carry GST rounded per line (DATA_MODEL 2.13). Re-typing the full net of a many-line
  // order changes the GST (by up to Rs 0.50 a line); the invoice then no longer matches the PO, and when the gap passes Rs 1 the
  // order never reads "fully invoiced" (v_order_state), so Today and Create invoice keep offering the last rupees.
  it('BUG-M10: the full net of an 18% order, typed back in, keeps the GST of the order lines', () => {
    fc.assert(
      fc.property(linesArb(20).map(ls => ls.map(l => ({ ...l, rate: '18' }))), lines => {
        const t = itemsTotal(lines)
        const start = invoiceStart({ itemsNet: n(t.net), itemsGst: n(t.gst), lineCount: lines.length, exemptLineCount: 0, invoicedNet: 0, invoicedGst: 0, paymentTermsDays: 30 })
        expect(toPaisa(gstForNet(start.net, start.option, start))).toBe(t.gst)
      }),
      { ...RUNS, seed: 20261020 },
    )
  })

  it('BUG-M10 regression: 20 lines of 10.50 at 18% carry GST 40 (2 a line); typed back in, the invoice keeps 40 (was 38)', () => {
    const lines = Array.from({ length: 20 }, () => ({ qty: '1.000', price: '10.50', rate: '18' }))
    const t = itemsTotal(lines)
    expect(rs(t.gst)).toBe('40.00')
    const start = invoiceStart({ itemsNet: n(t.net), itemsGst: n(t.gst), lineCount: 20, exemptLineCount: 0, invoicedNet: 0, invoicedGst: 0, paymentTermsDays: 30 })
    expect(start.gst).toBe(40)
    expect(gstForNet(start.net, start.option, start)).toBe(40)
    expect(gstForNet(start.net / 2, start.option, start)).toBe(20)
  })

  it('the dialog opens with what is left: line totals less earlier invoices, never below zero', () => {
    fc.assert(
      fc.property(linesArb(), fc.array(fc.tuple(paisaArb(), paisaArb(2_000_000n)), { maxLength: 3 }), (lines, earlier) => {
        const t = itemsTotal(lines)
        const invNet = sumP(earlier.map(e => e[0]))
        const invGst = sumP(earlier.map(e => e[1]))
        const s = invoiceStart({
          itemsNet: n(t.net),
          itemsGst: n(t.gst),
          lineCount: lines.length,
          exemptLineCount: lines.filter(l => l.rate === '0').length,
          invoicedNet: n(invNet),
          invoicedGst: n(invGst),
          paymentTermsDays: null,
        })
        expect(toPaisa(s.net)).toBe(maxP(t.net - invNet, 0n))
        expect(toPaisa(s.gst)).toBe(maxP(t.gst - invGst, 0n))
        expect(toPaisa(s.gross)).toBe(maxP(t.net - invNet, 0n) + maxP(t.gst - invGst, 0n))
      }),
      RUNS,
    )
  })

  it('the first invoice on a single-rate order opens with exactly the order gross (receivable unchanged by invoicing)', () => {
    fc.assert(
      fc.property(linesArb(), lines => {
        const t = itemsTotal(lines)
        const s = invoiceStart({ itemsNet: n(t.net), itemsGst: n(t.gst), lineCount: lines.length, exemptLineCount: 0, invoicedNet: 0, invoicedGst: 0, paymentTermsDays: 30 })
        expect(toPaisa(s.gross)).toBe(t.gross)
      }),
      RUNS,
    )
  })

  it('due date = invoice date + terms, across month ends and 29 February', () => {
    fc.assert(
      fc.property(edgeDateArb, fc.integer({ min: 0, max: 365 }), (d, terms) => {
        expect(dueOn(d, terms)).toBe(addDays(d, terms))
      }),
      RUNS,
    )
    expect(dueOn('2024-01-30', 30)).toBe('2024-02-29')
    expect(dueOn('2025-01-30', 30)).toBe('2025-03-01')
    expect(dueOn('2024-12-31', 1)).toBe('2025-01-01')
  })

  // BUG-M6: the Create invoice dialog prints "Due <this invoice's date + terms>", but every money figure (order_receivables,
  // v_order_money, Today's "payment overdue", the receivables page) dates the whole order from its EARLIEST invoice
  // (DATA_MODEL section 5: "the earliest invoice date plus payment_terms_days"). On a second or part invoice the dialog promises a
  // later date than the one the books use, and the order can already be overdue when the new invoice is saved.
  it('BUG-M6: the due date the dialog shows for a later invoice is the order due date the books use', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 200 }), fc.constantFrom(0, 15, 30, 60), (first, gap, terms) => {
        const order: Order = { id: 'o', number: 1, companyId: 'c', ownerId: null, lines: [{ qty: '1.000', price: '100.00', rate: '18' }], terms, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null }
        const second = addDays(first, gap)
        const invoices: Invoice[] = [
          { id: 'a', orderId: 'o', number: 'INV-1', date: first, net: 5000n, gst: 900n },
          { id: 'b', orderId: 'o', number: 'INV-2', date: second, net: 5000n, gst: 900n },
        ]
        const books: Books = { orders: [order], invoices, payments: [], expenses: [], defaultTerms: 30 }
        expect(orderDueOn(second, first, terms)).toBe(receivableOf(order, books, second).dueOn)
      }),
      { numRuns: 200, seed: 20261020 },
    )
  })

  it('BUG-M6 regression: a second invoice shows the order due date', () => {
    // first invoice 1 Aug 2026, 30 days: the order is due 31 Aug. A second invoice on 20 Oct shows "Due 19 Nov 2026"
    const order: Order = { id: 'o', number: 1, companyId: 'c', ownerId: null, lines: [{ qty: '2.000', price: '500.00', rate: '18' }], terms: 30, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null }
    const invoices: Invoice[] = [
      { id: 'a', orderId: 'o', number: 'INV-1', date: '2026-08-01', net: 50000n, gst: 9000n },
      { id: 'b', orderId: 'o', number: 'INV-2', date: '2026-10-20', net: 50000n, gst: 9000n },
    ]
    const r = receivableOf(order, { invoices, payments: [], defaultTerms: 30 }, '2026-10-20')
    expect(orderDueOn('2026-10-20', '2026-08-01', 30)).toBe('2026-08-31') // what the dialog prints (was 19 Nov 2026)
    expect(r.dueOn).toBe('2026-08-31') // what order_receivables / Today use: already overdue on the day it is invoiced
    expect(r.overdue).toBe(true)
  })

  it('GST register totals are exact sums of the rows', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(paisaArb(), paisaArb(1_000_000n)), { maxLength: 60 }), rows => {
        const r: GstRow[] = rows.map(([net, gst], i) => ({
          invoiceId: `i${i}`,
          number: `INV-${i}`,
          invoiceDate: '2026-01-01',
          orderId: null,
          orderNumber: null,
          companyId: null,
          companyName: null,
          net: n(net),
          gst: n(gst),
          gross: n(net + gst),
          courierState: 'not_started',
          fbrState: 'pending',
          fbrException: false,
          needsAttention: false,
          psid: null,
          taxDepositedOn: null,
        }))
        const t = registerTotals(r)
        expect(toPaisa(t.net)).toBe(sumP(rows.map(x => x[0])))
        expect(toPaisa(t.gst)).toBe(sumP(rows.map(x => x[1])))
        expect(toPaisa(t.gross)).toBe(sumP(rows.map(x => x[0] + x[1])))
      }),
      RUNS,
    )
  })
})

// ------------------------------------------------------------------------------------------------ payments and balances

describe('record payment and receivables (money/payments/model) against the oracle', () => {
  const kindOf = (balance: bigint, amount: bigint): 'settles' | 'part' | 'over' => {
    const after = balance - amount
    return after < -100n ? 'over' : after <= 100n ? 'settles' : 'part'
  }

  it('the dialog opens with the balance due (nothing when nothing is due)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), b => {
        const v = defaultPaymentAmount({ balance: n(b) })
        expect(v === null ? null : toPaisa(v)).toBe(b > 0n ? b : null)
      }),
      RUNS,
    )
  })

  it('the note says settles / part / over exactly where the database will call the order settled (Rs 1 allowance)', () => {
    fc.assert(
      fc.property(paisaArb(), fc.bigInt({ min: -300n, max: 300n }), (balance, delta) => {
        const amount = balance + delta
        fc.pre(amount > 0n)
        const note = paymentNote({ gross: n(balance), settled: 0, balance: n(balance), invoiced: true, prior: [] }, n(amount))
        expect(note.kind).toBe(kindOf(balance, amount))
      }),
      RUNS,
    )
  })

  it('the part-payment sentence states exactly what stays due', () => {
    fc.assert(
      fc.property(paisaArb(), paisaArb(), (balance, amount) => {
        fc.pre(balance - amount > 100n)
        const note = paymentNote({ gross: n(balance), settled: 0, balance: n(balance), invoiced: true, prior: [] }, n(amount))
        const m = /PKR ([\d,.]+) will still be due/.exec(note.text)
        expect(m).not.toBeNull()
        expect(toPaisa((m as RegExpExecArray)[1].replace(/,/g, ''))).toBe(balance - amount)
      }),
      RUNS,
    )
  })

  it('balance, overpaid and state of every order follow the oracle; the totals add up exactly', () => {
    fc.assert(
      fc.property(booksArb, dateArb, (books, today) => {
        const rows = books.orders.filter(o => receivableOf(o, books, today).listed).map(o => toRow(o, books, today))
        const t = receivableTotals(rows, today)
        const open = books.orders.map(o => receivableOf(o, books, today)).filter(r => r.listed && r.state !== 'settled')
        expect(toPaisa(t.outstanding)).toBe(sumP(open.map(r => r.balance)))
        expect(toPaisa(t.overdue)).toBe(sumP(open.filter(r => r.overdue).map(r => r.balance)))
        expect(t.openCount).toBe(open.length)
        expect(toPaisa(t.gross)).toBe(sumP(open.map(r => r.gross)))
        expect(toPaisa(t.settled)).toBe(sumP(open.map(r => r.settled)))
        // the three open groups partition the outstanding total
        expect(toPaisa(t.overdue) + toPaisa(t.notYetDue) + toPaisa(t.notInvoiced)).toBe(toPaisa(t.outstanding))
        expect(filterReceivables(rows, 'settled').length + filterReceivables(rows, 'open').length).toBe(rows.length)
      }),
      RUNS_HEAVY,
    )
  })

  it('oracle invariants: settled within Rs 1, overdue only after the due date, never both balance and overpaid', () => {
    fc.assert(
      fc.property(booksArb, dateArb, (books, today) => {
        for (const o of books.orders) {
          const r = receivableOf(o, books, today)
          expect(r.balance === 0n || r.overpaid === 0n).toBe(true)
          expect(r.balance - r.overpaid).toBe(r.gross - r.settled)
          if (r.state === 'settled') expect(r.balance <= 100n).toBe(true)
          if (r.overdue) expect(r.dueOn !== null && r.dueOn < today).toBe(true)
        }
      }),
      RUNS_HEAVY,
    )
  })

  // BUG-M5: Receivables counts an order as "due a reminder" 7 CALENDAR days after the last reminder; Today's payment-overdue item
  // comes back only 7 WORKING days after it (rules.ts chaseState / addBusinessDays). The two screens disagree for 2 to 4 days after
  // every reminder: the Receivables header says "1 due a reminder" while Today shows the order as waiting.
  it('BUG-M5: Receivables "due a reminder" and Today\'s payment-overdue item agree on the same day', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 20 }), (reminded, after) => {
        const today = addDays(reminded, after)
        const row: ReceivableRow = {
          orderId: 'o1',
          orderNumber: 1,
          companyId: 'c',
          companyName: 'C',
          ownerId: 'admin',
          invoiceNumbers: ['INV-1'],
          gross: 1180,
          settled: 0,
          balance: 1180,
          overpaidBy: 0,
          dueOn: addDays(reminded, -40),
          isOverdue: true,
          state: 'overdue',
          lastRemindedOn: reminded,
          reminderCount: 1,
        }
        const ctx = {
          today,
          user: { id: 'admin', role: 'admin' },
          roleOf: () => 'admin',
          receivables: [{ orderId: 'o1', orderNumber: 1, ownerId: 'admin', customerName: 'C', balance: 1180, settled: 0, dueOn: row.dueOn, isOverdue: true, lastRemindedOn: reminded, reminderCount: 1 }],
        } as unknown as TodayInputs
        const items = rulePaymentOverdue(ctx)
        const todayActive = items.length === 1 && !items[0].waiting
        expect(todayActive).toBe(reminderDue(row, today))
      }),
      { numRuns: 400, seed: 20261020 },
    )
  })

  it('BUG-M5 regression: reminded Mon 5 Oct 2026; on Mon 12 Oct both screens wait until Wed 14 Oct', () => {
    const row = { state: 'overdue', lastRemindedOn: '2026-10-05' } as ReceivableRow
    expect(reminderDue(row, '2026-10-12')).toBe(false)
    expect(reminderDue(row, '2026-10-14')).toBe(true)
    const ctx = {
      today: '2026-10-12',
      user: { id: 'admin', role: 'admin' },
      roleOf: () => 'admin',
      receivables: [{ orderId: 'o1', orderNumber: 1, ownerId: 'admin', customerName: 'C', balance: 1180, settled: 0, dueOn: '2026-08-31', isOverdue: true, lastRemindedOn: '2026-10-05', reminderCount: 1 }],
    } as unknown as TodayInputs
    const items = rulePaymentOverdue(ctx)
    expect(items[0].waiting?.nextNudgeOn).toBe('2026-10-14')
    expect(addWorkingDays('2026-10-05', 7)).toBe('2026-10-14')
  })

  it('Today raises a reminded order again exactly 7 working days after the reminder', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 20 }), (reminded, after) => {
        const today = addDays(reminded, after)
        const ctx = {
          today,
          user: { id: 'admin', role: 'admin' },
          roleOf: () => 'admin',
          receivables: [{ orderId: 'o1', orderNumber: 1, ownerId: 'admin', customerName: 'C', balance: 1180, settled: 0, dueOn: addDays(reminded, -40), isOverdue: true, lastRemindedOn: reminded, reminderCount: 1 }],
        } as unknown as TodayInputs
        const items = rulePaymentOverdue(ctx)
        expect(items.length === 1 && !items[0].waiting).toBe(today >= addWorkingDays(reminded, 7))
      }),
      { numRuns: 400, seed: 20261020 },
    )
  })
})

// ------------------------------------------------------------------------------------------------ margins

describe('margins (money/margins/model and v_order_money rules) against the oracle', () => {
  it('only final margins are added up; provisional and basis-unknown are counted, never summed', () => {
    fc.assert(
      fc.property(booksArb, fc.array(fc.tuple(fc.nat({ max: 5 }), paisaArb(1_000_000_00n), fc.bigInt({ min: 0n, max: 100n })), { maxLength: 12 }), (base, ex) => {
        const books: Books = {
          ...base,
          expenses: ex.map(([oi, amount, taxPct], i) => ({
            id: `e${i}`,
            date: '2026-01-10',
            amount,
            inputTax: roundDiv(amount * taxPct, 1000n),
            grp: 'order_cost',
            categoryId: 'supplier',
            orderId: base.orders[oi % base.orders.length].id,
            legId: null,
            supplierPayment: true,
          })),
        }
        const today = '2026-10-20'
        const om = books.orders.map(o => orderMoneyOf(o, books, today))
        const rows: MarginRow[] = om.map((m, i) => ({
          orderId: books.orders[i].id,
          orderNumber: books.orders[i].number,
          companyName: 'C',
          orderedOn: null,
          basis: 'items',
          netSale: n(m.netSale),
          expectedCost: null,
          actualCost: n(m.actualCost),
          margin: m.margin === null ? null : n(m.margin),
          state: m.marginState,
        }))
        const t = marginTotals(rows)
        const fin = om.filter(m => m.marginState === 'final')
        expect(t.orders).toBe(fin.length)
        expect(toPaisa(t.margin)).toBe(sumP(fin.map(m => m.margin as bigint)))
        expect(toPaisa(t.netSale)).toBe(sumP(fin.map(m => m.netSale)))
        expect(toPaisa(t.actualCost)).toBe(sumP(fin.map(m => m.actualCost)))
        expect(t.provisional).toBe(om.filter(m => m.marginState === 'provisional').length)
        expect(t.basisUnknown).toBe(om.filter(m => m.marginState === 'basis_unknown').length)
        // margin = net sale less net cost (input tax never a cost)
        for (const m of fin) expect(m.margin).toBe(m.netSale - m.actualCost)
      }),
      RUNS_HEAVY,
    )
  })
})

// ------------------------------------------------------------------------------------------------ expected-cost suggestion

describe('expected-cost suggestion (money/lib/costEstimate) against the oracle', () => {
  const supplierPrice = fc.bigInt({ min: 0n, max: 50_000_000n }).map(u => scaledText(u, 4))
  const qty = fc.oneof(fc.integer({ min: 1, max: 50 }).map(q => `${q}.000`), fc.bigInt({ min: 1n, max: 100_000n }).map(u => scaledText(u, 3)))
  const rate6 = fc.bigInt({ min: 1_000_000n, max: 400_000_000n }).map(u => scaledText(u, 6))

  /** round(round(sum qty x price, 2) x rate, 2) per leg, summed: the rule the file states, in exact decimals. */
  const oracleLeg = (lines: Array<[string, string]>, rate: string | null): { amount: bigint; pkr: bigint | null } => {
    const amount = roundDiv(lines.reduce((s, [q, p]) => s + dec(q, 3) * dec(p, 4), 0n), 100_000n)
    return { amount, pkr: rate === null ? amount : roundDiv(amount * dec(rate, 6), 1_000_000n) }
  }

  const cases = fc.record({ pkr: fc.array(fc.tuple(qty, supplierPrice), { minLength: 1, maxLength: 5 }), usd: fc.array(fc.tuple(qty, supplierPrice), { minLength: 1, maxLength: 5 }), rate: rate6 })

  const run = (c: { pkr: Array<[string, string]>; usd: Array<[string, string]>; rate: string }) => {
    const items: EstItem[] = [
      ...c.pkr.map(([q, p], i) => ({ id: `a${i}`, qty: Number(q), supplierUnitPrice: Number(p), legId: 'L1', isService: false })),
      ...c.usd.map(([q, p], i) => ({ id: `b${i}`, qty: Number(q), supplierUnitPrice: Number(p), legId: 'L2', isService: false })),
    ]
    const est = estimateExpectedCost({ items, legs: [{ id: 'L1', currency: 'PKR' }, { id: 'L2', currency: 'USD' }], pos: [], rates: { USD: { rate: Number(c.rate), ageDays: 3 } } })
    const a = oracleLeg(c.pkr, null)
    const b = oracleLeg(c.usd, c.rate)
    return { est, a, b }
  }

  it('whole-rupee and whole-cent prices (the common case) are exact', () => {
    fc.assert(
      fc.property(
        fc.record({
          pkr: fc.array(fc.tuple(fc.integer({ min: 1, max: 50 }).map(q => `${q}.000`), fc.integer({ min: 0, max: 5_000_000 }).map(p => `${p}.0000`)), { minLength: 1, maxLength: 5 }),
          usd: fc.array(fc.tuple(fc.integer({ min: 1, max: 50 }).map(q => `${q}.000`), fc.integer({ min: 0, max: 500_000 }).map(c => scaledText(BigInt(c) * 100n, 4))), { minLength: 1, maxLength: 5 }),
          rate: fc.integer({ min: 100, max: 400 }).map(r => `${r}.000000`),
        }),
        c => {
          const { est, a, b } = run(c)
          expect(toPaisa(est.legs.find(l => l.legId === 'L1')?.pkr as number)).toBe(a.pkr)
          expect(toPaisa(est.legs.find(l => l.legId === 'L2')?.pkr as number)).toBe(b.pkr)
          expect(toPaisa(est.pkr as number)).toBe((a.pkr as bigint) + (b.pkr as bigint))
        },
      ),
      RUNS,
    )
  })

  // BUG-M7: the expected-cost suggestion multiplies and rounds in floating point (Math.round(n * 100) / 100), the error MR-1 removed
  // everywhere else: 1 x 1.005 suggests 1.00 where the exact rule round(round(qty x price, 2) x rate, 2) gives 1.01, and the
  // error is then multiplied by the exchange rate on a foreign leg.
  it('BUG-M7: any supplier price with paisa/cents: the suggestion equals the exact rule', () => {
    fc.assert(
      fc.property(cases, c => {
        const { est, a, b } = run(c)
        expect(toPaisa(est.legs.find(l => l.legId === 'L1')?.pkr as number)).toBe(a.pkr)
        expect(toPaisa(est.legs.find(l => l.legId === 'L2')?.pkr as number)).toBe(b.pkr)
      }),
      { ...RUNS, seed: 20261020 },
    )
  })

  it('BUG-M7 regression: 1 x 1.005 suggests 1.01 (was 1.00)', () => {
    const est = estimateExpectedCost({ items: [{ id: 'a', qty: 1, supplierUnitPrice: 1.005, legId: 'L1', isService: false }], legs: [{ id: 'L1', currency: 'PKR' }], pos: [], rates: {} })
    expect(oracleLeg([['1.000', '1.0050']], null).pkr).toBe(101n) // the exact rule: 1.01
    expect(est.pkr).toBe(1.01)
  })
})

describe('oracle self-checks', () => {
  it('basis switches to the invoices as soon as one exists; payments split net + GST = amount', () => {
    fc.assert(
      fc.property(booksArb, books => {
        for (const o of books.orders) {
          const b = basisOf(o, books.invoices)
          expect(b.basis === 'invoice').toBe(books.invoices.some(i => i.orderId === o.id))
          expect(daysFrom('2024-02-28', '2024-03-01')).toBe(2)
        }
      }),
      { numRuns: 100 },
    )
  })
})
