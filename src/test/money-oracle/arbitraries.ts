import fc from 'fast-check'
import { addDays, basisOf, invoiceGst, itemsTotal, maxP, roundDiv, rs, type Books, type Invoice, type Line, type Order, type Payment } from '@/test/money-oracle/oracle'

/*
 * Random inputs for the money property tests. Amounts are generated as exact decimal TEXT (what Postgres stores) and the tests hand
 * the app the same value as a JSON number, the way PostgREST returns numeric. Edge values are mixed in on purpose: half-paisa and
 * half-rupee boundaries, Rs 0, one paisa, whole thousands.
 */

/** Text with exactly `scale` decimals for an integer count of the smallest unit. */
export const scaledText = (units: bigint, scale: number): string => {
  const neg = units < 0n
  const a = neg ? -units : units
  const s = a.toString().padStart(scale + 1, '0')
  const t = scale === 0 ? s : `${s.slice(0, -scale)}.${s.slice(-scale)}`
  return neg ? `-${t}` : t
}

/** Quantity, numeric(12,3), > 0: mostly whole numbers, sometimes fractional (metres, kilograms). */
export const qtyArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 500 }).map(n => `${n}.000`) },
  { weight: 2, arbitrary: fc.bigInt({ min: 1n, max: 10_000_000n }).map(u => scaledText(u, 3)) },
  { weight: 1, arbitrary: fc.constantFrom('0.001', '0.005', '0.100', '0.500', '1.500', '2.500', '0.125', '3.333') },
)

/** Unit price, numeric(14,2), >= 0 (rupees and paisa). */
export const priceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.bigInt({ min: 0n, max: 100_000_000n }).map(u => scaledText(u, 2)) },
  { weight: 1, arbitrary: fc.bigInt({ min: 0n, max: 2_000_000_000n }).map(u => scaledText(u, 2)) },
  { weight: 1, arbitrary: fc.constantFrom('0.00', '0.01', '0.35', '21.95', '25.00', '75.00', '1.05', '2.50', '1000.00', '833.33') },
)

/** GST rate in percent: 18 most of the time, exempt often, the occasional legacy rate. */
export const rateArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constant('18') },
  { weight: 3, arbitrary: fc.constant('0') },
  { weight: 1, arbitrary: fc.constantFrom('17', '16', '5', '18.50', '12.5') },
)

export const lineArb: fc.Arbitrary<Line> = fc.record({ qty: qtyArb, price: priceArb, rate: rateArb })
export const linesArb = (max = 12): fc.Arbitrary<Line[]> => fc.array(lineArb, { minLength: 1, maxLength: max })

/** A rupee amount in paisa, > 0 (payments, expenses, invoice nets), with edge values. */
export const paisaArb = (max = 50_000_000_00n): fc.Arbitrary<bigint> =>
  fc.oneof(
    { weight: 4, arbitrary: fc.bigInt({ min: 1n, max }) },
    { weight: 1, arbitrary: fc.constantFrom(1n, 50n, 99n, 100n, 2500n, 7500n, 100_000n, 118_000n) },
  )

/** A date between 2023-01-01 and 2028-12-31 (leap year 2024 and 2028 included). */
export const dateArb: fc.Arbitrary<string> = fc.integer({ min: 0, max: 2191 }).map(n => addDays('2023-01-01', n))

/** Dates biased to month ends, month starts and 29 February. */
export const edgeDateArb: fc.Arbitrary<string> = fc.oneof(
  dateArb,
  fc.constantFrom('2024-02-28', '2024-02-29', '2024-03-01', '2025-02-28', '2025-03-01', '2026-01-31', '2026-02-01', '2026-12-31', '2027-01-01', '2028-02-29'),
)

export const asNumber = (text: string): number => Number(text)
export const paisaToNumber = (p: bigint): number => Number(rs(p))

/** Many runs for the cheap pure checks; the owner asked for proof, not a sample. */
export const RUNS = { numRuns: 3000 } as const
export const RUNS_HEAVY = { numRuns: 600 } as const

// ------------------------------------------------------------------------------------------------ random books (orders, invoices, payments)

const orderArb = (i: number): fc.Arbitrary<Order> =>
  fc.record({
    lines: linesArb(6),
    terms: fc.option(fc.constantFrom(0, 7, 15, 30, 45, 60, 90), { nil: null }),
    cancelled: fc.boolean(),
    basisUnknown: fc.constantFrom(false, false, false, false, true),
    costsComplete: fc.boolean(),
    company: fc.constantFrom('c1', 'c2', 'c3'),
  }).map(r => ({
    id: `o${i}`,
    number: i + 1,
    companyId: r.company,
    ownerId: 'u1',
    lines: r.lines,
    terms: r.terms,
    cancelledOn: r.cancelled ? '2025-06-30' : null,
    basisUnknown: r.basisUnknown,
    costsComplete: r.costsComplete,
    expectedCost: null,
  }))

/** Books with up to 6 orders, each with 0 to 3 invoices (whole or part of its lines) and 0 to 4 payments. */
export const booksArb: fc.Arbitrary<Books> = fc
  .integer({ min: 1, max: 6 })
  .chain(k => fc.tuple(...Array.from({ length: k }, (_, i) => orderArb(i))))
  .chain(orders =>
    fc
      .tuple(
        ...orders.map(() =>
          fc.record({
            invoices: fc.array(fc.record({ share: fc.constantFrom(1, 2, 3, 4), date: dateArb, exempt: fc.boolean() }), { maxLength: 3 }),
            payments: fc.array(
              fc.record({ amount: fc.oneof(paisaArb(5_000_000_00n), fc.constant(-1n)), date: dateArb, credited: fc.constantFrom('u1', 'u2', null) }),
              { maxLength: 4 },
            ),
          }),
        ),
      )
      .map(per => {
        const invoices: Invoice[] = []
        const payments: Payment[] = []
        orders.forEach((o, i) => {
          const t = itemsTotal(o.lines)
          per[i].invoices.forEach((v, j) => {
            const net = roundDiv(t.net, BigInt(v.share))
            invoices.push({ id: `i${i}-${j}`, orderId: o.id, number: `INV-${i}${j}`, date: v.date, net, gst: v.exempt ? 0n : invoiceGst(net, false) })
          })
          per[i].payments.forEach((p, j) => {
            // -1 stands for "exactly the gross" so settled orders are common
            const amount = p.amount === -1n ? maxP(basisOf(o, invoices).g, 1n) : p.amount
            payments.push({ id: `p${i}-${j}`, orderId: o.id, date: p.date, amount, credited: p.credited })
          })
        })
        return { orders, invoices, payments, expenses: [], defaultTerms: 30 }
      }),
  )

