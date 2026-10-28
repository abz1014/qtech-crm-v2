import { describe, expect, it } from 'vitest'
import { filingsOf, gstLine, gstLines } from '@/features/money/accounts/gstModel'
import type { GstMonthRow } from '@/features/money/monthEnd/model'

const row = (month: string, over: Partial<GstMonthRow> = {}): GstMonthRow => ({
  month,
  invoiceCount: 4,
  net: '100000.00',
  gst: '18000.00',
  psidSets: 0,
  depositedCount: 0,
  depositedAmount: '0.00',
  toDeposit: '18000.00',
  inputTax: '3000.00',
  ...over,
})

describe('GST to FBR: charged less paid on purchases is to pay', () => {
  it('subtracts in whole paisa and dates the payment (15th) and the return (18th) in the next month', () => {
    const l = gstLine(row('2026-10'), undefined, '2026-11-02')
    expect(l.toPay).toBe('15000.00')
    expect(l.credit).toBe('0.00')
    expect(l.payBy).toBe('2026-11-15')
    expect(l.returnBy).toBe('2026-11-18')
    expect(l.tone).toBe('ok')
  })
  it('amber after the 12th, red after the 15th, until every invoice carries its deposit', () => {
    expect(gstLine(row('2026-10'), undefined, '2026-11-12').tone).toBe('ok')
    expect(gstLine(row('2026-10'), undefined, '2026-11-13').tone).toBe('soon')
    expect(gstLine(row('2026-10'), undefined, '2026-11-15').tone).toBe('soon')
    expect(gstLine(row('2026-10'), undefined, '2026-11-16').tone).toBe('late')
    expect(gstLine(row('2026-10', { depositedCount: 4 }), undefined, '2026-12-30').tone).toBe('paid')
  })
  it('more GST paid on purchases than charged: nothing to pay, the rest shown as credit', () => {
    const l = gstLine(row('2026-10', { inputTax: '20000.00' }), undefined, '2026-11-02')
    expect(l.toPay).toBe('0.00')
    expect(l.credit).toBe('2000.00')
  })
  it('never "late" when input tax covers the GST charged: nothing to pay (M7)', () => {
    expect(gstLine(row('2026-10', { gst: '18000.00', inputTax: '25000.00' }), undefined, '2026-11-20').tone).toBe('nothing')
    expect(gstLine(row('2026-10', { gst: '18000.00', inputTax: '18000.00' }), undefined, '2026-11-20').tone).toBe('nothing')
    expect(gstLine(row('2026-10', { gst: '18000.00', inputTax: '17999.99' }), undefined, '2026-11-20').tone).toBe('late')
  })
  it('a reader without input tax sees charged as to pay and no purchases figure', () => {
    const l = gstLine(row('2026-10', { inputTax: null }), undefined, '2026-11-02')
    expect(l.paidOnPurchases).toBeNull()
    expect(l.toPay).toBe('18000.00')
  })
  it('a month with no GST has nothing to pay', () => {
    expect(gstLine(row('2026-10', { gst: '0.00', invoiceCount: 2 }), undefined, '2026-11-20').tone).toBe('nothing')
  })
})

describe('GST to FBR: the months and their payment slips', () => {
  it('lists the latest six months with invoices, newest first, and the running month even when empty', () => {
    const rows = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map(m => row(m))
    const lines = gstLines([...rows, row('2026-11', { invoiceCount: 0, gst: '0.00' })], [], '2026-11-03')
    expect(lines.map(l => l.month)).toEqual(['2026-11', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'])
  })
  it('collects the PSIDs and the last deposit day of a month from its invoices', () => {
    const f = filingsOf([
      { invoice_date: '2026-09-04', psid: ' 1023-4471 ', tax_deposited_on: '2026-10-14' },
      { invoice_date: '2026-09-20', psid: '1023-4471', tax_deposited_on: '2026-10-15' },
      { invoice_date: '2026-09-21', psid: '9999', tax_deposited_on: null },
      { invoice_date: '2026-10-01', psid: null, tax_deposited_on: null },
    ])
    expect(f).toEqual([
      { month: '2026-09', psids: ['1023-4471', '9999'], lastDepositedOn: '2026-10-15' },
      { month: '2026-10', psids: [], lastDepositedOn: null },
    ])
    const l = gstLine(row('2026-09', { depositedCount: 4, depositedAmount: '15000.00' }), f[0], '2026-10-20')
    expect(l.tone).toBe('paid')
    expect(l.paidOn).toBe('2026-10-15')
    expect(l.psids).toEqual(['1023-4471', '9999'])
  })
})
