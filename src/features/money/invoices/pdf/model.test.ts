import { describe, expect, it } from 'vitest'
import { toPaisa } from '@/lib/money'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { amountInWords } from '@/features/quotations/lib/totals'
import { gstOn } from '@/features/money/invoices/model'
import { buildInvoiceDoc, type InvoicePdfSource } from '@/features/money/invoices/pdf/doc'
import {
  buyerRegistered,
  invoiceFigures,
  invoiceFileName,
  invoiceReadiness,
  matchLines,
  MAX_SEARCH_LINES,
  spreadGstDifference,
  type BuyerTax,
  type PdfOrderLine,
  type ReadinessInput,
} from '@/features/money/invoices/pdf/model'

/*
 * The invoice PDF's numbers. The rule under test: the printed totals ARE the stored invoice net, GST and net + GST, to the paisa;
 * the lines add up to them exactly; a line's printed sales tax is its own whole-rupee rounding moved by at most Rs 1 (the accepted
 * +/- Rs 1 rule, DECISIONS 2026-10-19 P9 item 1). The database's own arithmetic is re-done here independently (integers only).
 */

let seq = 0
const line = (qty: number | string, price: number | string, rate: number | string = 18, unit: string | null = 'pcs'): PdfOrderLine => ({
  id: `l${++seq}`,
  description: `Item ${seq}`,
  qty,
  unit,
  unitPriceNet: price,
  gstRate: rate,
})
const all = (lines: PdfOrderLine[]) => lines.map(l => ({ id: l.id, qty: l.qty }))
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n)

// ---------------------------------------------------------------- an independent copy of the database's rounding (0014)
/** n / d rounded half away from zero, integers only. */
const divRound = (n: bigint, d: bigint) => (n >= 0n ? (2n * n + d) / (2n * d) : -((-2n * n + d) / (2n * d)))
/** round(qty x price, 2) in paisa, from qty in thousandths and price in paisa. */
const dbLineNet = (qtyThousandths: bigint, pricePaisa: bigint) => divRound(qtyThousandths * pricePaisa, 1000n)
/** round(net x rate / 100, 0) rupees, in paisa (whole-number rates). */
const dbLineGst = (netPaisa: bigint, rate: bigint) => divRound(netPaisa * rate, 10000n) * 100n

describe('invoiceFigures: the whole order, as the create dialog pre-fills it (stored = the lines)', () => {
  it('prints the stored net, GST and gross exactly, and the lines add up to them', () => {
    const lines = [line(2, '1250.50'), line('3.5', '333.33', 18, 'm'), line(1, '99999.99')]
    // what v_order_items_total gives and the dialog stores
    const nets = [dbLineNet(2000n, 125050n), dbLineNet(3500n, 33333n), dbLineNet(1000n, 9999999n)]
    const gsts = nets.map(n => dbLineGst(n, 18n))
    const stored = { net: Number(sum(nets)) / 100, gst: Number(sum(gsts)) / 100 }
    const r = invoiceFigures(lines, all(lines), stored)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = r.figures
    expect(f.net).toBe(toPaisa(stored.net))
    expect(f.gst).toBe(toPaisa(stored.gst))
    expect(f.gross).toBe(toPaisa(stored.net) + toPaisa(stored.gst))
    expect(f.lines.map(l => l.net)).toEqual(nets)
    expect(f.lines.map(l => l.gst)).toEqual(gsts)
    expect(sum(f.lines.map(l => l.net))).toBe(f.net)
    expect(sum(f.lines.map(l => l.gst))).toBe(f.gst)
    expect(sum(f.lines.map(l => l.gross))).toBe(f.gross)
    expect(f.adjustment).toBe(0n)
    expect(f.adjustedLines).toEqual([])
    expect(f.byRate).toEqual([{ ratePercent: 18, net: f.net, gst: f.gst }])
  })

  it('keeps 3.5 m at 333.33 to the paisa (1166.655 rounds half away from zero to 1166.66, as Postgres does)', () => {
    const l = line('3.5', '333.33')
    const r = invoiceFigures([l], all([l]), { net: '1166.66', gst: '210' })
    expect(r.ok && r.figures.lines[0].net).toBe(116666n)
    expect(r.ok && r.figures.lines[0].gst).toBe(21000n) // 209.9988 -> 210
  })

  it('an exempt line carries no tax and is listed under 0%', () => {
    const lines = [line(1, 1000), line(2, 500, 0)]
    const r = invoiceFigures(lines, all(lines), { net: 2000, gst: 180 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.figures.lines.map(l => [l.exempt, l.gst])).toEqual([
      [false, 18000n],
      [true, 0n],
    ])
    expect(r.figures.byRate).toEqual([
      { ratePercent: 18, net: 100000n, gst: 18000n },
      { ratePercent: 0, net: 100000n, gst: 0n },
    ])
  })
})

describe('the +/- Rs 1 rule: stored GST that differs from the lines’ own rounding', () => {
  it('adds the missing rupee to the line rounded down the most (GST on the total, from "Edit the amounts")', () => {
    // three lines of 2.50: each line's own tax 0.45 rounds to 0; GST on the total 7.50 is 1.35, rounded 1
    const lines = [line(1, '2.50'), line(1, '2.50'), line(1, '2.50')]
    const stored = { net: 7.5, gst: gstOn(7.5, '18') }
    expect(stored.gst).toBe(1)
    const r = invoiceFigures(lines, all(lines), stored)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.figures.lines.map(l => l.ownGst)).toEqual([0n, 0n, 0n])
    expect(r.figures.lines.map(l => l.gst)).toEqual([100n, 0n, 0n])
    expect(r.figures.adjustment).toBe(100n)
    expect(r.figures.adjustedLines).toEqual([1])
    expect(r.figures.gst).toBe(100n)
    expect(sum(r.figures.lines.map(l => l.gross))).toBe(r.figures.gross)
  })

  it('takes a rupee off the line rounded up the most', () => {
    // 2.80 at 18% is 0.504 (rounds to 1) on each line; 8.40 at 18% is 1.512 (rounds to 2)
    const lines = [line(1, '2.80'), line(1, '2.79'), line(1, '2.81')]
    const own = lines.map(l => dbLineGst(toPaisa(l.unitPriceNet), 18n))
    expect(own).toEqual([100n, 100n, 100n])
    const r = invoiceFigures(lines, all(lines), { net: '8.40', gst: 2 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // residuals: 0.504-1, 0.5022-1, 0.5058-1: the 2.79 line (0.5022) was rounded up the most
    expect(r.figures.lines.map(l => l.gst)).toEqual([100n, 0n, 100n])
    expect(r.figures.adjustedLines).toEqual([2])
  })

  it('never moves a line by more than Rs 1, and spreads a larger difference one rupee per line', () => {
    const lines = Array.from({ length: 5 }, () => line(1, '2.50'))
    const r = invoiceFigures(lines, all(lines), { net: '12.50', gst: 2 }) // own 0 each; 12.50 x 18% = 2.25 -> 2
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.figures.lines.map(l => l.gst)).toEqual([100n, 100n, 0n, 0n, 0n])
    expect(r.figures.lines.every(l => l.gst - l.ownGst <= 100n && l.ownGst - l.gst <= 100n)).toBe(true)
  })

  it('carries an imported invoice’s paisa on one line', () => {
    const lines = [line(1, 1000), line(1, 500)]
    const r = invoiceFigures(lines, all(lines), { net: 1500, gst: '270.37' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(sum(r.figures.lines.map(l => l.gst))).toBe(27037n)
    expect(r.figures.adjustment).toBe(37n)
  })

  it('refuses a difference that cannot be rounding (more than Rs 1 per taxed line)', () => {
    const lines = [line(1, 1000), line(1, 500, 0)]
    const r = invoiceFigures(lines, all(lines), { net: 1500, gst: 182 })
    expect(r).toEqual({ ok: false, problem: { kind: 'gst-differs', linesGst: 18000n, invoiceGst: 18200n, taxableLines: 1 } })
  })

  it('never touches an exempt or a free line, and never takes a line below zero', () => {
    expect(spreadGstDifference([{ net: 100000n, ownGst: 0n, ratePercent: 0 }], 100n)).toBeNull()
    expect(spreadGstDifference([{ net: 0n, ownGst: 0n, ratePercent: 18 }], 100n)).toBeNull()
    expect(spreadGstDifference([{ net: 250n, ownGst: 0n, ratePercent: 18 }], -100n)).toBeNull()
    expect(
      spreadGstDifference(
        [
          { net: 100000n, ownGst: 0n, ratePercent: 0 },
          { net: 250n, ownGst: 0n, ratePercent: 18 },
          { net: 280n, ownGst: 100n, ratePercent: 18 },
        ],
        -100n,
      ),
    ).toEqual([0n, 0n, -100n])
  })

  it('holds for random orders: stored = the lines, or stored GST = 18% of the total', () => {
    // a small fixed-seed generator, so a failure is reproducible
    let s = 20261020
    const rnd = (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s % n
    }
    for (let k = 0; k < 400; k++) {
      const n = 1 + rnd(12)
      const exempt = rnd(4) === 0
      const lines = Array.from({ length: n }, () => {
        const qtyT = BigInt(1 + rnd(50_000)) // thousandths: 0.001 to 50
        const price = BigInt(rnd(5_000_000)) // paisa: 0 to 49,999.99
        return { l: line(Number(qtyT) / 1000, (Number(price) / 100).toFixed(2), exempt && rnd(2) === 0 ? 0 : 18), qtyT, price }
      })
      const nets = lines.map(x => dbLineNet(x.qtyT, x.price))
      const gsts = lines.map((x, i) => (Number(x.l.gstRate) > 0 ? dbLineGst(nets[i], 18n) : 0n))
      const net = sum(nets)
      const ls = lines.map(x => x.l)

      // A: the create dialog's pre-fill (v_order_items_total): nothing moves
      const a = invoiceFigures(ls, all(ls), { net: (Number(net) / 100).toFixed(2), gst: (Number(sum(gsts)) / 100).toFixed(2) })
      expect(a.ok).toBe(true)
      if (a.ok) {
        expect(a.figures.net).toBe(net)
        expect(a.figures.gst).toBe(sum(gsts))
        expect(a.figures.lines.map(l => l.gst)).toEqual(gsts)
      }

      // B: "Edit the amounts" with 18%: GST on the total. Reconciles within Rs 1 a line whenever every line is taxed.
      if (ls.every(l => Number(l.gstRate) > 0) && net > 0n) {
        const storedGst = divRound(net * 18n, 10000n) * 100n
        const b = invoiceFigures(ls, all(ls), { net: (Number(net) / 100).toFixed(2), gst: (Number(storedGst) / 100).toFixed(2) })
        expect(b.ok).toBe(true)
        if (b.ok) {
          expect(b.figures.gst).toBe(storedGst)
          expect(sum(b.figures.lines.map(l => l.gst))).toBe(storedGst)
          expect(sum(b.figures.lines.map(l => l.gross))).toBe(net + storedGst)
          for (const l of b.figures.lines) {
            const d = l.gst - l.ownGst
            expect(d >= -100n && d <= 100n).toBe(true)
            expect(l.gross).toBe(l.net + l.gst)
          }
        }
      }
    }
  })
})

describe('invoiceFigures: blocked, never a wrong PDF', () => {
  it('when the picked lines do not add up to the invoice net', () => {
    const lines = [line(1, 1000), line(1, 500)]
    expect(invoiceFigures(lines, [{ id: lines[0].id, qty: 1 }], { net: 1500, gst: 270 })).toEqual({
      ok: false,
      problem: { kind: 'net-differs', linesNet: 100000n, invoiceNet: 150000n },
    })
  })

  it('when nothing is picked', () => {
    expect(invoiceFigures([line(1, 1)], [], { net: 1, gst: 0 })).toEqual({ ok: false, problem: { kind: 'no-lines' } })
  })

  it('when a quantity is zero or above the order’s', () => {
    const l = line(10, 150.25, 18, 'm')
    expect(invoiceFigures([l], [{ id: l.id, qty: 0 }], { net: 0, gst: 0 })).toMatchObject({ ok: false, problem: { kind: 'bad-qty', max: 10 } })
    expect(invoiceFigures([l], [{ id: l.id, qty: 11 }], { net: 0, gst: 0 })).toMatchObject({ ok: false, problem: { kind: 'bad-qty' } })
  })

  it('prints a part delivery: 4 of 10 m', () => {
    const l = line(10, '150.25', 18, 'm')
    const r = invoiceFigures([l], [{ id: l.id, qty: 4 }], { net: 601, gst: 108 })
    expect(r.ok && r.figures.lines[0]).toMatchObject({ qty: 4, net: 60100n, gst: 10800n, gross: 70900n })
  })
})

describe('matchLines: which of the order’s lines an invoice covers', () => {
  it('every line when they add up to the invoice (free lines included)', () => {
    const lines = [line(1, 1000), line(1, 0), line(2, 250)]
    expect(matchLines(lines, 1500)).toEqual({ how: 'whole-order', picks: all(lines) })
  })

  it('the one set of whole lines that adds up to a part invoice', () => {
    const lines = [line(1, 1000), line(1, 700), line(2, 250)]
    expect(matchLines(lines, 1500)).toEqual({ how: 'matched', picks: [{ id: lines[0].id, qty: 1 }, { id: lines[2].id, qty: 2 }] })
  })

  it('asks when two sets add up to it', () => {
    const lines = [line(1, 500), line(1, 500), line(1, 900)]
    expect(matchLines(lines, 500).how).toBe('ambiguous')
  })

  it('asks when no set of whole lines does (a part quantity or a typed amount)', () => {
    expect(matchLines([line(10, 100), line(1, 7)], 400).how).toBe('none')
  })

  it('does not search a very long order', () => {
    const lines = Array.from({ length: MAX_SEARCH_LINES + 1 }, (_, i) => line(1, i + 1))
    expect(matchLines(lines, 3).how).toBe('none')
    expect(matchLines(lines, (MAX_SEARCH_LINES + 1) * (MAX_SEARCH_LINES + 2) / 2).how).toBe('whole-order')
  })
})

// ---------------------------------------------------------------- what must be filled in first

const SELLER = { legal_name: 'Q-Tech Engineering (Pvt) Ltd', address: 'Karachi', ntn: '1234567-8', strn: '17-00-1234-567-89' }
const BUYER: BuyerTax = { name: 'Acme Cement', ntn: '7654321-0', strn: '32-77-8761-234-56', salesTaxRegistered: true, invoiceAddress: 'Plot 4, SITE, Karachi' }
const ready = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  seller: SELLER,
  buyer: BUYER,
  siteAddress: null,
  invoice: { number: 'INV-0012', invoiceDate: '2026-10-20', orderId: 'o1' },
  orderFlags: [],
  ...over,
})

describe('invoiceReadiness (section 23(1) Sales Tax Act 1990)', () => {
  it('is ready with everything filled in', () => {
    expect(invoiceReadiness(ready())).toEqual({ gaps: [], warnings: [] })
  })

  it('blocks on the supplier’s name, address, NTN and STRN', () => {
    const r = invoiceReadiness(ready({ seller: { legal_name: ' ', address: null, ntn: null, strn: '' } }))
    expect(r.gaps.map(g => g.where)).toEqual(['company-profile', 'company-profile', 'company-profile', 'company-profile'])
    expect(r.gaps.map(g => g.text).join(' | ')).toMatch(/legal name.*address.*NTN.*STRN/)
  })

  it('blocks on a registered buyer with no STRN, naming the buyer', () => {
    const r = invoiceReadiness(ready({ buyer: { ...BUYER, strn: null } }))
    expect(r.gaps).toEqual([{ where: 'buyer', text: 'Acme Cement’s STRN (it is registered for sales tax)' }])
  })

  it('asks whether the buyer is registered when nobody has said and there is no STRN', () => {
    const r = invoiceReadiness(ready({ buyer: { ...BUYER, strn: null, salesTaxRegistered: null } }))
    expect(r.gaps).toEqual([{ where: 'buyer', text: 'whether Acme Cement is registered for sales tax' }])
  })

  it('takes an STRN as registered when the status was never set', () => {
    expect(buyerRegistered({ salesTaxRegistered: null, strn: '123' })).toBe(true)
    expect(buyerRegistered({ salesTaxRegistered: false, strn: '123' })).toBe(false)
    expect(buyerRegistered({ salesTaxRegistered: null, strn: ' ' })).toBeNull()
  })

  it('prints for an unregistered buyer without an NTN, with a warning only', () => {
    const r = invoiceReadiness(ready({ buyer: { ...BUYER, ntn: null, strn: null, salesTaxRegistered: false } }))
    expect(r.gaps).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })

  it('uses the delivery site address when the company has no invoice address, and blocks with neither', () => {
    expect(invoiceReadiness(ready({ buyer: { ...BUYER, invoiceAddress: null }, siteAddress: 'Kotri plant' })).gaps).toEqual([])
    expect(invoiceReadiness(ready({ buyer: { ...BUYER, invoiceAddress: null } })).gaps).toEqual([{ where: 'buyer', text: 'Acme Cement’s address' }])
  })

  it('blocks a register-only imported invoice (no order, no number) and an order whose prices may include GST', () => {
    const r = invoiceReadiness(ready({ invoice: { number: null, invoiceDate: '2019-03-01', orderId: null }, orderFlags: ['value_basis_unknown'] }))
    expect(r.gaps.map(g => g.where)).toEqual(['invoice', 'invoice', 'order'])
  })
})

// ---------------------------------------------------------------- the document

const PROFILE: CompanyProfile = {
  ...SELLER,
  phone: null,
  email: null,
  website: null,
  bank_name: null,
  bank_account_title: null,
  bank_iban: null,
  quotation_validity_days: 30,
  default_payment_terms_days: 30,
  quotation_terms: null,
  po_terms: null,
  updated_at: '2026-10-20T00:00:00Z',
}

function source(over: Partial<InvoicePdfSource> = {}): InvoicePdfSource {
  const lines = [line(2, '1250.50'), line(1, 700, 0)]
  return {
    invoice: { id: 'i1', number: ' INV-0012 ', invoiceDate: '2026-10-20', net: '3201.00', gst: '450.00', orderId: 'o1' },
    order: { id: 'o1', number: 38, customerPo: '4500012345', orderedOn: '2026-10-01', paymentTermsDays: 45, legacyFlags: [] },
    buyer: { id: 'c1', ...BUYER },
    site: { name: 'Kotri plant', address: 'Kotri' },
    lines,
    otherInvoices: [],
    ...over,
  }
}

describe('buildInvoiceDoc', () => {
  it('builds the document from the stored figures', () => {
    const src = source()
    const r = buildInvoiceDoc(src, PROFILE, all(src.lines), 'original')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.doc
    expect(d.number).toBe('INV-0012')
    expect(d.orderRef).toBe('ORD-0038')
    expect(d.customerPo).toBe('4500012345')
    expect(d.poDate).toBe('2026-10-01')
    expect(d.dueOn).toBe('2026-12-04') // 20 Oct + 45 days
    expect(d.buyer).toEqual({ name: 'Acme Cement', address: 'Plot 4, SITE, Karachi', ntn: '7654321-0', strn: '32-77-8761-234-56', registered: true })
    expect(d.figures.net).toBe(320100n)
    expect(d.figures.gst).toBe(45000n)
    expect(d.figures.gross).toBe(365100n)
    expect(d.words).toBe(amountInWords(365100n))
    expect(d.words).toBe('Three thousand six hundred fifty-one rupees only.')
  })

  it('uses the company’s default terms when the order has none, and no PO date without a PO', () => {
    const src = source({ order: { id: 'o1', number: 38, customerPo: null, orderedOn: '2026-10-01', paymentTermsDays: null, legacyFlags: [] } })
    const r = buildInvoiceDoc(src, PROFILE, all(src.lines), 'duplicate')
    expect(r.ok && [r.doc.dueOn, r.doc.poDate, r.doc.copy]).toEqual(['2026-11-19', null, 'duplicate'])
  })

  it('is not built while something is missing, and says what', () => {
    const src = source({ buyer: { id: 'c1', ...BUYER, strn: null } })
    const r = buildInvoiceDoc(src, PROFILE, all(src.lines), 'original')
    expect(r.ok).toBe(false)
    expect(r.readiness.gaps).toHaveLength(1)
  })

  it('is not built when the lines do not add up, and says by how much', () => {
    const src = source()
    const r = buildInvoiceDoc(src, PROFILE, [{ id: src.lines[0].id, qty: 2 }], 'original')
    expect(r).toMatchObject({ ok: false, problem: { kind: 'net-differs', linesNet: 250100n, invoiceNet: 320100n } })
  })
})

describe('invoiceFileName', () => {
  it('names the file after the invoice number and the copy', () => {
    expect(invoiceFileName('INV-0012', 'original')).toBe('INV-0012.pdf')
    expect(invoiceFileName('QT/2026/12 ', 'duplicate')).toBe('QT-2026-12-duplicate.pdf')
    expect(invoiceFileName('///', 'original')).toBe('invoice.pdf')
  })
})
