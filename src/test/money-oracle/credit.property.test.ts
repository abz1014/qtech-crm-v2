import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { maxP, minP, sumP, type Paisa } from '@/test/money-oracle/oracle'

/*
 * The oracle for customer credit (0126, 0127), written from the rules and not from the app:
 *   settled(order)   cash received + WHT deducted + credit applied to it
 *   receivable       max(gross - settled, 0)                overpaid   max(settled - gross, 0)
 *   credit balance   sum of the customer's overpaid - refunds - credit applied
 *   cash             in = payments received; out = refunds (a refund is cash out, applied credit moves no cash)
 * and the identity that ties them together: what came in less what was refunded equals what the orders hold as settled (up to their
 * gross) plus the credit balance. Random runs of payments, credit notes, refunds and applied credit never break it, a refund or an
 * application never makes the balance negative, an application moves the receivable by exactly its amount, and a refund moves no
 * receivable.
 */
interface Order {
  gross: Paisa
  paid: Paisa
  applied: Paisa
}
interface Books {
  orders: Order[]
  refunded: Paisa
}

const settled = (o: Order): Paisa => o.paid + o.applied
const receivable = (o: Order): Paisa => maxP(o.gross - settled(o), 0n)
const overpaid = (o: Order): Paisa => maxP(settled(o) - o.gross, 0n)
const balance = (b: Books): Paisa => sumP(b.orders.map(overpaid)) - b.refunded - sumP(b.orders.map(o => o.applied))
const totalReceivable = (b: Books): Paisa => sumP(b.orders.map(receivable))
const cashIn = (b: Books): Paisa => sumP(b.orders.map(o => o.paid))
const heldAgainstOrders = (b: Books): Paisa => sumP(b.orders.map(o => minP(settled(o), o.gross)))

type Op =
  | { kind: 'pay'; order: number; amount: Paisa }
  | { kind: 'creditNote'; order: number; amount: Paisa }
  | { kind: 'refund'; amount: Paisa }
  | { kind: 'apply'; order: number; amount: Paisa }

const paisa = fc.integer({ min: 1, max: 2_000_000 }).map(n => BigInt(n))
const opArb = (orders: number): fc.Arbitrary<Op> =>
  fc.oneof(
    fc.record({ kind: fc.constant('pay' as const), order: fc.nat(orders - 1), amount: paisa }),
    fc.record({ kind: fc.constant('creditNote' as const), order: fc.nat(orders - 1), amount: paisa }),
    fc.record({ kind: fc.constant('refund' as const), amount: paisa }),
    fc.record({ kind: fc.constant('apply' as const), order: fc.nat(orders - 1), amount: paisa }),
  )

const grossArb = fc.integer({ min: 100_00, max: 5_000_000 }).map(n => BigInt(n))

/** Runs one op the way the database does; returns whether it was allowed (refused ops change nothing). */
function run(b: Books, op: Op): boolean {
  if (op.kind === 'pay') {
    b.orders[op.order].paid += op.amount
    return true
  }
  if (op.kind === 'creditNote') {
    const o = b.orders[op.order]
    if (op.amount > o.gross) return false // a credit note cannot exceed the invoice
    o.gross -= op.amount
    return true
  }
  if (op.kind === 'refund') {
    if (op.amount > balance(b)) return false // record_refund: refund_exceeds_credit
    b.refunded += op.amount
    return true
  }
  const o = b.orders[op.order]
  if (op.amount > balance(b) || op.amount > receivable(o)) return false // apply_credit: credit_exceeds_balance / credit_exceeds_order
  o.applied += op.amount
  return true
}

describe('the credit oracle', () => {
  it('cash in less refunds is what the orders hold plus the credit balance, after any run of operations', () => {
    const runArb = fc.array(grossArb, { minLength: 1, maxLength: 4 }).chain(grosses => fc.tuple(fc.constant(grosses), fc.array(opArb(grosses.length), { maxLength: 40 })))
    fc.assert(
      fc.property(runArb, ([grosses, ops]) => {
        const books: Books = { orders: grosses.map(g => ({ gross: g, paid: 0n, applied: 0n })), refunded: 0n }
        for (const op of ops) {
          const beforeBalance = balance(books)
          const beforeReceivable = totalReceivable(books)
          const beforeCash = cashIn(books)
          const ok = run(books, op)
          expect(balance(books) >= 0n).toBe(true)
          expect(cashIn(books) - books.refunded).toBe(heldAgainstOrders(books) + balance(books))
          if (!ok) {
            expect(balance(books)).toBe(beforeBalance)
            expect(totalReceivable(books)).toBe(beforeReceivable)
          } else if (op.kind === 'refund') {
            expect(balance(books)).toBe(beforeBalance - op.amount)
            expect(totalReceivable(books)).toBe(beforeReceivable)
            expect(cashIn(books)).toBe(beforeCash)
          } else if (op.kind === 'apply') {
            expect(balance(books)).toBe(beforeBalance - op.amount)
            expect(totalReceivable(books)).toBe(beforeReceivable - op.amount)
            expect(cashIn(books)).toBe(beforeCash)
          }
        }
      }),
      { numRuns: 400, seed: 20261030 },
    )
  })

  it('worked example: 1,500 paid on a 1,180 order, refund 200, apply 120, a credit note of 118 adds 118 of credit', () => {
    const b: Books = { orders: [{ gross: 118_000n, paid: 150_000n, applied: 0n }, { gross: 50_000n, paid: 0n, applied: 0n }], refunded: 0n }
    expect(balance(b)).toBe(32_000n)
    expect(run(b, { kind: 'refund', amount: 20_000n })).toBe(true)
    expect(run(b, { kind: 'apply', order: 1, amount: 12_000n })).toBe(true)
    expect(balance(b)).toBe(0n)
    expect(run(b, { kind: 'apply', order: 1, amount: 1n })).toBe(false)
    expect(receivable(b.orders[1])).toBe(38_000n)
    expect(run(b, { kind: 'creditNote', order: 0, amount: 11_800n })).toBe(true)
    expect(balance(b)).toBe(11_800n)
  })
})
