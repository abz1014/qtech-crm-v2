import { describe, expect, it } from 'vitest'
import { applyDefault, applyNote, creditEvents, NO_CREDIT, refundDefault, refundNote, showCredit, type CreditSummary } from '@/features/money/credit/model'

const credit = (balance: number): CreditSummary => ({ overpaid: balance, refunded: 0, applied: 0, balance })

describe('customer credit rules (0126, 0127)', () => {
  it('the panel shows with credit to give out, or a history to read, and not otherwise', () => {
    expect(showCredit(NO_CREDIT, 0, 0)).toBe(false)
    expect(showCredit(credit(320), 0, 0)).toBe(true)
    expect(showCredit({ overpaid: 320, refunded: 320, applied: 0, balance: 0 }, 1, 0)).toBe(true)
    expect(showCredit(NO_CREDIT, 0, 1)).toBe(true)
  })

  it('a refund starts at the whole balance, never below zero', () => {
    expect(refundDefault(credit(320.5))).toBe(320.5)
    expect(refundDefault({ ...NO_CREDIT, balance: -4 })).toBe(0)
  })

  it('the refund note says what is left, refunds-all, or that it is too much', () => {
    expect(refundNote(credit(320), null)).toEqual({ kind: 'ok', text: 'This customer holds Rs 320 of credit.' })
    expect(refundNote(credit(320), 100)).toEqual({ kind: 'ok', text: 'Rs 220 of credit stays with them.' })
    expect(refundNote(credit(320), 320)).toEqual({ kind: 'ok', text: 'This refunds all of their credit.' })
    expect(refundNote(credit(320), 320.01).kind).toBe('over')
    expect(refundNote(credit(320), 0).kind).toBe('ok')
  })

  it('applying starts at the smaller of the credit and what the order owes', () => {
    expect(applyDefault(credit(120), { balance: 500 })).toBe(120)
    expect(applyDefault(credit(120), { balance: 50 })).toBe(50)
    expect(applyDefault(credit(120), null)).toBe(120)
  })

  it('the apply note checks the credit, then the order, and says no cash moves', () => {
    expect(applyNote(credit(120), null, 10).kind).toBe('ok')
    expect(applyNote(credit(120), { balance: 500 }, 121).kind).toBe('over')
    expect(applyNote(credit(120), { balance: 50 }, 60).kind).toBe('over')
    expect(applyNote(credit(120), { balance: 50 }, 50)).toEqual({ kind: 'ok', text: 'This settles the order. No cash moves.' })
    expect(applyNote(credit(120), { balance: 500 }, 120)).toEqual({ kind: 'ok', text: 'The order will still owe Rs 380. No cash moves.' })
  })

  it('refunds and applied credit are one history, newest first', () => {
    const events = creditEvents(
      [
        { id: 'r1', refundedOn: '2026-10-02', amount: 100, paidVia: 'cash', reference: 'RF-1', reason: 'goodwill', orderId: null },
        { id: 'r2', refundedOn: '2026-10-09', amount: 50, paidVia: 'bank', reference: null, reason: null, orderId: 'o1' },
      ],
      [{ id: 'a1', appliedOn: '2026-10-05', amount: 120, note: 'from the overpayment', toOrderId: 'o2' }],
    )
    expect(events.map(e => e.key)).toEqual(['r:r2', 'a:a1', 'r:r1'])
    expect(events[2].detail).toBe('cash · RF-1 · goodwill')
    expect(events[0].detail).toBeNull()
    expect(events[1]).toMatchObject({ kind: 'applied', orderId: 'o2', detail: 'from the overpayment' })
  })
})
