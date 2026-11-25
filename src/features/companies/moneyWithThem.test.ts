import { describe, expect, it } from 'vitest'
import { moneyWithThem, type MoneyLine } from '@/features/companies/moneyWithThem'

const shown = (lines: MoneyLine[]) => lines.map(l => [l.label, l.amount])

/*
 * Review 2026-11-24, screen 07: two orders, ORD-0011 worth 118,000 paid 150,000 (32,000 over, 4,000 of it refunded) and ORD-0012
 * worth 23,600 unpaid. The old card read Total 141,600, Received 150,000, Balance 23,600 beside a credit of 28,000.
 */
describe('Money with them adds up', () => {
  const money = { receivable: 141600, settled: 150000, balance: 23600, overpaid: 28000, orders: 2 }
  const credit = { overpaid: 28000, refunded: 4000, applied: 0, balance: 28000 }

  it('the screen 07 case: total less received plus refunded is the balance due less the credit held', () => {
    expect(shown(moneyWithThem(money, credit))).toEqual([
      ['Orders total, GST included', '141600.00'],
      ['Received', '150000.00'],
      ['Refunded to them', '4000.00'],
      ['Balance due on orders', '23600.00'],
      ['Credit they hold', '28000.00'],
      ['Credit left after the balance due', '4400.00'],
    ])
    // 141,600 - 150,000 + 4,000 = -4,400 = 23,600 - 28,000: the statement of account closes 4,400 in their favour
  })

  it('after the Apply credit dialog puts 23,600 against ORD-0012, received does not count that credit a second time', () => {
    const after = moneyWithThem(
      { receivable: 141600, settled: 173600, balance: 0, overpaid: 4400, orders: 2 },
      { overpaid: 4400, refunded: 4000, applied: 23600, balance: 4400 },
    )
    expect(shown(after)).toEqual([
      ['Orders total, GST included', '141600.00'],
      ['Received', '150000.00'],
      ['Refunded to them', '4000.00'],
      ['Balance due on orders', '0.00'],
      ['Credit they hold', '4400.00'],
      ['Credit left after the balance due', '4400.00'],
    ])
  })

  it('no credit: three lines, the balance due in bold', () => {
    const lines = moneyWithThem({ receivable: 1000, settled: 400, balance: 600, overpaid: 0, orders: 1 }, { overpaid: 0, refunded: 0, applied: 0, balance: 0 })
    expect(shown(lines)).toEqual([
      ['Orders total, GST included', '1000.00'],
      ['Received', '400.00'],
      ['Balance due on orders', '600.00'],
    ])
    expect(lines.find(l => l.key === 'due')?.strong).toBe(true)
  })

  it('credit smaller than the balance due: what is still due after it', () => {
    const lines = moneyWithThem({ receivable: 2000, settled: 1500, balance: 1000, overpaid: 500, orders: 2 }, { overpaid: 500, refunded: 0, applied: 0, balance: 500 })
    expect(lines.at(-1)).toMatchObject({ label: 'Still due after their credit', amount: '500.00', strong: true })
  })

  it('an imported order reviewed as settled though unpaid is its own line, so the card still adds up', () => {
    const lines = moneyWithThem({ receivable: 5000, settled: 3000, balance: 0, overpaid: 0, orders: 1 }, { overpaid: 0, refunded: 0, applied: 0, balance: 0 })
    expect(shown(lines)).toContainEqual(['Closed in Review imported', '2000.00'])
  })

  it('the credit could not be read: only the total and the balance due', () => {
    expect(shown(moneyWithThem(money, null))).toEqual([
      ['Orders total, GST included', '141600.00'],
      ['Balance due on orders', '23600.00'],
    ])
  })
})
