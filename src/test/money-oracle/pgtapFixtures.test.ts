import { describe, expect, it } from 'vitest'
import {
  CloseLedger,
  agingAsOf,
  basisOf,
  cashMonth,
  profitMonth,
  quarterMonths,
  dec,
  itemsTotal,
  livePnlFields,
  monthPnlLive,
  onPace,
  orderMoneyOf,
  payablesAsOf,
  receivableOf,
  rs,
  splitPayment,
  type Books,
  type Expense,
  type Group,
  type Invoice,
  type Leg,
  type Order,
  type Payment,
} from '@/test/money-oracle/oracle'

/*
 * The scenarios of the pgTAP files supabase/tests/0901 to 0904, run through the oracle. Each number asserted here is the one the
 * SQL test expects from the database, so the database is checked against the oracle's figures, not against itself.
 */

const order = (id: string, o: Partial<Order> = {}): Order => ({ id, number: 1, companyId: 'c', ownerId: 'admin', lines: [{ qty: '1.000', price: '1000.00', rate: '18' }], terms: null, cancelledOn: null, basisUnknown: false, costsComplete: false, expectedCost: null, ...o })
const inv = (id: string, orderId: string | null, date: string | null, net: string, gst: string, extra: Partial<Invoice> = {}): Invoice => ({ id, orderId, number: id, date, net: dec(net, 2), gst: dec(gst, 2), ...extra })
const pay = (id: string, orderId: string, date: string, amount: string, credited: string | null = 'admin'): Payment => ({ id, orderId, date, amount: dec(amount, 2), credited })
const exp = (id: string, date: string, amount: string, tax: string, grp: Group, extra: Partial<Expense> = {}): Expense => ({ id, date, amount: dec(amount, 2), inputTax: dec(tax, 2), grp, categoryId: grp, orderId: null, legId: null, supplierPayment: false, ...extra })

describe('0901 money orders', () => {
  const o1 = order('o1', {
    lines: [
      { qty: '0.100', price: '0.35', rate: '18' },
      { qty: '1.000', price: '25.00', rate: '18' },
      { qty: '3.000', price: '75.00', rate: '18' },
      { qty: '2.500', price: '100.10', rate: '0' },
      { qty: '0.100', price: '21.95', rate: '18' },
    ],
  })

  it('lines: net 502.49, GST 46, gross 548.49', () => {
    const t = itemsTotal(o1.lines)
    expect([rs(t.net), rs(t.gst), rs(t.gross)]).toEqual(['502.49', '46.00', '548.49'])
  })

  it('split on the item basis, then on the invoice basis', () => {
    const p = pay('p', 'o1', '2025-03-10', '300.00')
    const s1 = splitPayment(p, o1, basisOf(o1, []))
    expect([rs(s1.net as bigint), rs(s1.gst as bigint)]).toEqual(['274.84', '25.16'])
    const invoices = [inv('i', 'o1', '2025-03-15', '400.00', '72.00')]
    const s2 = splitPayment(p, o1, basisOf(o1, invoices))
    expect([rs(s2.net as bigint), rs(s2.gst as bigint)]).toEqual(['254.24', '45.76'])
    expect(rs(receivableOf(o1, { invoices, payments: [p], defaultTerms: 30 }, '2026-10-20').balance)).toBe('172.00')
  })

  it('balances, the Rs 1 allowance, due dates and cancelled orders', () => {
    const o2 = order('o2', { ownerId: 'sales' })
    const o3 = order('o3', { terms: 0 })
    const o4 = order('o4')
    const o5 = order('o5', { cancelledOn: '2025-02-01' })
    const o6 = order('o6', { cancelledOn: '2025-02-01' })
    const o7 = order('o7', { terms: 20 })
    const invoices = [
      inv('i2', 'o2', '2025-01-10', '1000', '180'),
      inv('i3', 'o3', '2025-01-10', '1000', '180'),
      inv('i6', 'o6', '2025-01-10', '1000', '180'),
      inv('i7a', 'o7', '2024-02-09', '500', '90'),
      inv('i7b', 'o7', '2024-03-01', '500', '90'),
    ]
    const payments = [pay('p2', 'o2', '2025-02-01', '1179'), pay('p3', 'o3', '2025-02-01', '500'), pay('p4', 'o4', '2025-02-01', '2000')]
    const books = { invoices, payments, defaultTerms: 30 }
    const r = (o: Order) => receivableOf(o, books, '2026-10-20')
    expect(r(o2)).toMatchObject({ balance: 100n, state: 'settled', dueOn: '2025-02-09', overdue: false })
    expect(r(o3)).toMatchObject({ balance: 68000n, state: 'overdue', dueOn: '2025-01-10' })
    expect(r(o4)).toMatchObject({ balance: 0n, overpaid: 82000n, state: 'settled', dueOn: null })
    expect(r(o5).listed).toBe(false)
    expect(r(o6)).toMatchObject({ listed: true, balance: 118000n })
    expect(r(o7).dueOn).toBe('2024-02-29')
  })

  it('margin and target progress', () => {
    const o2 = order('o2', { ownerId: 'sales', costsComplete: true })
    const books: Books = {
      orders: [o2],
      invoices: [inv('i2', 'o2', '2025-01-10', '1000', '180')],
      payments: [pay('p2', 'o2', '2025-02-01', '1179', 'sales')],
      expenses: [exp('e1', '2025-01-05', '590', '90', 'order_cost', { orderId: 'o2' }), exp('e2', '2025-01-06', '100', '0', 'order_cost', { orderId: 'o2' })],
      defaultTerms: 30,
    }
    const m = orderMoneyOf(o2, books, '2026-10-20')
    expect([rs(m.netSale), rs(m.actualCost), rs(m.margin as bigint), m.marginState]).toEqual(['1000.00', '600.00', '400.00', 'final'])
    const s = splitPayment(books.payments[0], o2, basisOf(o2, books.invoices))
    expect(rs(s.net as bigint)).toBe('999.15')
    expect(rs(onPace(1_000_000n, '2025-01-01', '2025-02-15'))).toBe('5111.11')
    expect(rs(onPace(1_000_000n, '2025-01-01', '2026-10-20'))).toBe('10000.00')
  })
})

describe('0902 money aging', () => {
  const invoices = [
    inv('a1-1', 'A1', '2025-01-01', '1000', '180'),
    inv('a1-2', 'A1', '2025-02-15', '500', '90'),
    inv('a1-3', 'A1', '2025-03-20', '200', '36'),
    ...['2025-05-31', '2025-05-30', '2025-05-01', '2025-04-30', '2025-04-01', '2025-03-31'].map((d, i) => inv(`a2-${i}`, 'A2', d, '100', '18')),
    inv('a4', 'A4', '2025-01-05', '1000', '180'),
    inv('old-paid', null, '2024-06-01', '1000', '180', { settledBeforeCutover: true }),
    inv('old-open', null, '2024-06-01', '500', '90'),
  ]
  const payments = [
    pay('p1', 'A1', '2025-01-20', '1000'),
    pay('p2', 'A1', '2025-03-01', '500'),
    pay('p3', 'A1', '2025-04-05', '300'),
    pay('p4', 'A3', '2025-03-10', '5000'),
    pay('p5', 'A4', '2025-01-20', '1179.50'),
  ]

  it('FIFO on 31 March 2025', () => {
    const a = agingAsOf('2025-03-31', { invoices, payments }).invoices.filter(i => i.orderId === 'A1')
    expect(a.map(i => [i.invoiceId, rs(i.applied), rs(i.remaining), i.age, i.bucket])).toEqual([
      ['a1-2', '320.00', '270.00', 44, '31-60'],
      ['a1-3', '0.00', '236.00', 11, '0-30'],
    ])
  })

  it('bucket edges on 30 June 2025, advances, legacy invoices, the Rs 0.50 residual', () => {
    const a = agingAsOf('2025-06-30', { invoices, payments })
    expect(a.invoices.filter(i => i.orderId === 'A2').sort((x, y) => x.age - y.age).map(i => `${i.age}=${i.bucket}`)).toEqual(['30=0-30', '31=31-60', '60=31-60', '61=61-90', '90=61-90', '91=90+'])
    expect(a.advances).toEqual([{ orderId: 'A3', held: 500000n }])
    expect(a.invoices.find(i => i.invoiceId === 'old-paid')).toBeUndefined()
    expect(a.invoices.find(i => i.invoiceId === 'old-open')).toMatchObject({ remaining: 59000n, applied: 0n, bucket: '90+' })
    // BUG-M3 (fixed): the order receivables call settled (paid to within Rs 1) has no aging row, here or in aging_as_of
    expect(a.invoices.find(i => i.orderId === 'A4')).toBeUndefined()
    expect(receivableOf(order('A4'), { invoices, payments, defaultTerms: 30 }, '2025-06-30').state).toBe('settled')
  })
})

describe('0903 money payables', () => {
  const o = order('P1')
  const legs: Leg[] = [
    { id: 'L1', orderId: 'P1', currency: 'PKR', placedOn: '2025-03-01', priced: [['2.000', '1000.5000'], ['3.000', '333.3333']], po: null },
    { id: 'L2', orderId: 'P1', currency: 'USD', placedOn: '2025-03-01', priced: [['1.000', '100.0000']], po: null },
    { id: 'L3', orderId: 'P1', currency: 'USD', placedOn: '2025-03-01', priced: [['3.000', '9.0000']], po: { total: 3002n, currency: 'EUR' } },
    { id: 'L8', orderId: 'P1', currency: 'PKR', placedOn: '2025-03-01', priced: [['1.000', '1000.0000']], po: null },
    { id: 'L9', orderId: 'P1', currency: 'PKR', placedOn: '2025-03-01', priced: [['1.000', '1000.0000']], po: null },
  ]
  const rates = [
    { currency: 'USD', rate: '280.000000', asOf: '2025-02-01', manual: false },
    { currency: 'USD', rate: '279.500000', asOf: '2025-03-03', manual: false },
    { currency: 'USD', rate: '281.250000', asOf: '2025-03-03', manual: true },
    { currency: 'EUR', rate: '300.000000', asOf: '2025-03-01', manual: true },
  ]
  const sp = (id: string, date: string, amount: string, tax: string, legId: string): Expense => exp(id, date, amount, tax, 'order_cost', { legId, supplierPayment: true, orderId: 'P1' })
  const expenses = [sp('x1', '2025-03-05', '2360', '360', 'L1'), sp('x2', '2025-04-10', '1000', '0', 'L1'), exp('fr', '2025-03-06', '500', '0', 'order_cost', { legId: 'L1' }), sp('x8', '2025-03-07', '970', '0', 'L8'), sp('x9', '2025-03-07', '969.99', '0', 'L9')]
  const at = (d: string, leg: string) => payablesAsOf(d, legs, [o], expenses, rates).find(p => p.legId === leg)

  it('the legs on the dates the SQL test reads', () => {
    expect(at('2025-03-31', 'L1')).toMatchObject({ committedPkr: 300100n, paid: 200000n, owed: 100100n, state: 'owing' })
    expect(at('2025-04-30', 'L1')).toMatchObject({ paid: 300000n, owed: 100n, state: 'settled' })
    expect(at('2025-03-02', 'L2')).toMatchObject({ rate: '280.000000', committedPkr: 2800000n })
    expect(at('2025-03-03', 'L2')).toMatchObject({ rate: '281.250000', committedPkr: 2812500n, state: 'owing' })
    expect(at('2025-04-02', 'L2')?.rate).toBe('281.250000')
    expect(at('2025-04-03', 'L2')).toMatchObject({ state: 'no_rate', rate: null, committedPkr: null })
    expect(at('2025-03-10', 'L3')).toMatchObject({ currency: 'EUR', committedPkr: 900600n })
    expect(at('2025-03-31', 'L8')).toMatchObject({ owed: 3000n, state: 'settled' })
    expect(at('2025-03-31', 'L9')).toMatchObject({ owed: 3001n, state: 'owing' })
  })
})

describe('0904 money month', () => {
  const m1 = order('M1', { ownerId: 'sales' })
  const m2 = order('M2', { lines: [{ qty: '1.000', price: '500.00', rate: '0' }] })
  const m3 = order('M3', { basisUnknown: true })
  const m4 = order('M4', { lines: [{ qty: '1.000', price: '0.00', rate: '18' }] })
  const base: Books = {
    orders: [m1, m2, m3, m4],
    invoices: [inv('MON-0001', 'M1', '2025-01-31', '1000', '180'), inv('MON-0002', 'M2', '2025-02-01', '500', '0')],
    payments: [
      pay('PA', 'M1', '2025-01-31', '590', 'sales'),
      pay('PB', 'M1', '2025-02-01', '590', 'sales'),
      pay('PM2', 'M2', '2025-01-15', '200', null),
      pay('PM3', 'M3', '2025-01-20', '300'),
      pay('PM4', 'M4', '2025-01-21', '50'),
    ],
    expenses: [
      exp('sal', '2025-01-31', '10000', '0', 'overhead'),
      exp('rent', '2025-01-31', '5000', '0', 'overhead'),
      exp('sup', '2025-01-10', '1180', '180', 'order_cost', { orderId: 'M1' }),
      exp('draw', '2025-01-05', '2000', '0', 'non_pnl'),
      exp('frt', '2025-02-01', '300', '0', 'order_cost', { orderId: 'M1' }),
    ],
    defaultTerms: 30,
  }

  it('January and February 2025', () => {
    const j = monthPnlLive('2025-01', base)
    expect([j.netIn, j.gstIn, j.unresolvedGross, j.orderCosts, j.overheads, j.nonPnl, j.result, j.afterDrawings, j.cashOut, j.inputTax].map(rs)).toEqual([
      '700.00', '90.00', '350.00', '1000.00', '15000.00', '2000.00', '-15300.00', '-17300.00', '18180.00', '180.00',
    ])
    const f = monthPnlLive('2025-02', base)
    expect([f.netIn, f.gstIn, f.orderCosts, f.result].map(rs)).toEqual(['500.00', '90.00', '300.00', '200.00'])
  })

  it('close January, a later exempt February invoice moves it, reopen, close through February', () => {
    const books: Books = { ...base, invoices: [...base.invoices] }
    const ledger = new CloseLedger(livePnlFields(books))
    ledger.close('2025-01')
    books.invoices.push(inv('MON-0003', 'M1', '2025-02-10', '180', '0'))
    expect(rs(ledger.shown('2025-01').result)).toBe('-15300.00')
    expect(rs(livePnlFields(books)('2025-01').netIn)).toBe('711.91')
    const feb = ledger.shown('2025-02')
    expect([feb.own.netIn, feb.adjust.netIn, feb.adjust.gstIn, feb.result].map(rs)).toEqual(['511.91', '11.91', '-11.91', '223.82'])
    expect(rs(ledger.shown('2025-01').result + feb.result)).toBe('-15076.18')
    ledger.reopen('2025-01')
    expect(rs(ledger.shown('2025-01').result)).toBe('-15288.09')
    expect(rs(ledger.shown('2025-02').result)).toBe('211.91')
    ledger.close('2025-01')
    ledger.close('2025-02')
    expect([ledger.shown('2025-01').result, ledger.shown('2025-02').result, ledger.shown('2025-02').adjust.netIn].map(rs)).toEqual(['-15288.09', '211.91', '0.00'])
  })
})

describe('0079 in vs out', () => {
  const o1 = order('o1', { lines: [{ qty: '1.000', price: '10000.00', rate: '18' }], ownerId: 'sales' })
  const o2 = order('o2', { lines: [{ qty: '1.000', price: '1000.00', rate: '18' }], ownerId: 'sales' })
  const books: Books = {
    orders: [o1, o2],
    invoices: [inv('ivo', 'o1', '2020-01-10', '10000.00', '1800.00')],
    payments: [
      pay('p1', 'o1', '2019-12-31', '5900.00'),
      pay('p2', 'o1', '2020-01-01', '3000.50'),
      pay('p3', 'o1', '2020-03-31', '1000.00'),
      pay('p4', 'o1', '2020-04-01', '700.00'),
      { ...pay('pv', 'o1', '2020-02-10', '2000.00'), voided: true },
    ],
    expenses: [
      exp('e1', '2019-12-15', '4000.00', '600.00', 'order_cost', { orderId: 'o1', supplierPayment: true }),
      exp('e2', '2020-01-05', '1500.00', '0', 'overhead'),
      exp('e3', '2020-01-25', '2500.00', '0', 'overhead'),
      exp('e4', '2020-03-31', '500.00', '0', 'overhead'),
      exp('e5', '2020-03-10', '10000.00', '0', 'non_pnl'),
      exp('e6', '2020-04-01', '800.00', '0', 'overhead'),
      exp('e7', '2020-04-20', '300.00', '0', 'order_cost', { orderId: 'o2' }),
    ],
    defaultTerms: 30,
  }
  const cash = (m: string) => cashMonth(m, books)
  const sumQ = (key: string, f: (m: string) => bigint) => quarterMonths(key).reduce((s, m) => s + f(m), 0n)

  it('cash by month, gross, the voided payment left out', () => {
    expect(['2019-12', '2020-01', '2020-02', '2020-03', '2020-04'].map(m => [rs(cash(m).in), cash(m).payments, rs(cash(m).out), cash(m).expenses])).toEqual([
      ['5900.00', 1, '4000.00', 1],
      ['3000.50', 1, '4000.00', 2],
      ['0.00', 0, '0.00', 0],
      ['1000.00', 1, '10500.00', 2],
      ['700.00', 1, '1100.00', 2],
    ])
  })

  it('quarters: Q4 2019 net 1,900.00; Q1 2020 in 4,000.50, out 14,500.00, net -10,499.50', () => {
    expect(rs(sumQ('2019-Q4', m => cash(m).in - cash(m).out))).toBe('1900.00')
    expect([sumQ('2020-Q1', m => cash(m).in), sumQ('2020-Q1', m => cash(m).out), sumQ('2020-Q1', m => cash(m).in - cash(m).out)].map(rs)).toEqual(['4000.50', '14500.00', '-10499.50'])
    expect([sumQ('2020-Q2', m => cash(m).in), sumQ('2020-Q2', m => cash(m).out)].map(rs)).toEqual(['700.00', '1100.00'])
  })

  it('GST: the cash P&L takes 900.00 out of December; cash in keeps it', () => {
    const p = monthPnlLive('2019-12', books)
    expect([rs(p.netIn), rs(p.gstIn), rs(p.orderCosts)]).toEqual(['5000.00', '900.00', '3400.00'])
  })

  it('profit, invoiced basis, month by month and the Q1 2020 total', () => {
    const row = (m: string) => {
      const p = profitMonth(m, books)
      return [p.sales, p.salesGst, p.orderCosts, p.overheads, p.profit, p.orderCostsPaid, p.nonPnlPaid, p.inputTaxPaid].map(rs)
    }
    expect(row('2019-12')).toEqual(['0.00', '0.00', '0.00', '0.00', '0.00', '3400.00', '0.00', '600.00'])
    expect(row('2020-01')).toEqual(['10000.00', '1800.00', '3400.00', '4000.00', '2600.00', '0.00', '0.00', '0.00'])
    expect(row('2020-03')).toEqual(['0.00', '0.00', '0.00', '500.00', '-500.00', '0.00', '10000.00', '0.00'])
    expect(row('2020-04')).toEqual(['0.00', '0.00', '0.00', '800.00', '-800.00', '300.00', '0.00', '0.00'])
    expect(rs(sumQ('2020-Q1', m => profitMonth(m, books).profit))).toBe('2100.00')
  })

  it('cancelling the never-invoiced order lets its held cost count in the cancel month', () => {
    const cancelled = { ...books, orders: [o1, { ...o2, cancelledOn: '2020-05-15' }] }
    expect([profitMonth('2020-05', cancelled).orderCosts, profitMonth('2020-05', cancelled).profit].map(rs)).toEqual(['300.00', '-300.00'])
  })
})
