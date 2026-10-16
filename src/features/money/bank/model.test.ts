import { describe, expect, it } from 'vitest'
import {
  applyTick,
  bankTotals,
  buildBankView,
  defaultStatementMonth,
  isMonthKey,
  olderNote,
  type RawBank,
} from '@/features/money/bank/model'

const OCT = '2026-10-01'
const SEP = '2026-09-01'

const pay = (id: string, receivedOn: string, amount: string, bankMonth: string | null = null) => ({
  id,
  receivedOn,
  amount,
  reference: 'IBFT',
  orderRef: 'ORD-0042',
  company: 'Sargodha Fertilizer Co.',
  bankMonth,
})
const exp = (id: string, paidOn: string, amount: string, bankMonth: string | null = null, over: Record<string, unknown> = {}) => ({
  id,
  paidOn,
  amount,
  inputTax: '0.00',
  categoryName: 'Salaries',
  grp: 'overhead' as const,
  note: null,
  payee: null,
  orderRef: null,
  leg: null,
  bankMonth,
  ...over,
})
const dep = (
  id: string,
  psid: string | null,
  depositedOn: string,
  amount: string,
  bankMonth: string | null = null,
  number = `INV-${id}`,
) => ({
  id,
  number,
  invoiceDate: '2026-10-07',
  company: 'Margalla Steel',
  psid,
  depositedOn,
  amount,
  bankMonth,
})
const empty: RawBank = { payments: [], expenses: [], deposits: [] }

describe('which lines a statement month shows', () => {
  it('shows ticked-this-month, unticked up to the month end, and older unticked; hides later and other-month ticks', () => {
    const raw: RawBank = {
      ...empty,
      payments: [
        pay('a', '2026-10-20', '800000', OCT), // ticked
        pay('b', '2026-10-26', '700000'), // not ticked
        pay('c', '2026-09-30', '5000'), // older, not ticked
        pay('d', '2026-11-02', '9999'), // after the month: a later statement
        pay('e', '2026-09-10', '1234', SEP), // ticked against September: not here
        pay('f', '2026-11-01', '77', OCT), // dated later but ticked against October: here
      ],
    }
    const v = buildBankView(raw, '2026-10')
    expect(v.in.ticked.map(l => l.key)).toEqual(['f', 'a'])
    expect(v.in.open.map(l => l.key)).toEqual(['b'])
    expect(v.in.older.map(l => l.key)).toEqual(['c'])
    expect(v.in.older[0].sub).toEqual(['ORD-0042', 'September, not ticked then'])
  })

  it('titles an expense with its category and payee or note, and says the group or the order and leg', () => {
    const raw: RawBank = {
      ...empty,
      expenses: [
        exp('1', '2026-10-30', '100000', null, { note: 'support staff' }),
        exp('2', '2026-10-29', '420000', null, {
          categoryName: 'Supplier payment',
          grp: 'order_cost',
          payee: 'Dubai Instrumentation FZE',
          orderRef: 'ORD-0031',
          leg: 'leg A',
        }),
        exp('3', '2026-10-15', '590000', null, {
          categoryName: 'Supplier payment',
          grp: 'order_cost',
          orderRef: 'ORD-0042',
          leg: 'leg A',
          inputTax: '90000.00',
        }),
        exp('4', '2026-10-10', '250000', null, { categoryName: 'Owner drawings', grp: 'non_pnl' }),
      ],
    }
    const open = buildBankView(raw, '2026-10').out.open
    const by = Object.fromEntries(open.map(l => [l.key, l]))
    expect(by['1']).toMatchObject({ title: 'Salaries, support staff', sub: ['Overhead'] })
    expect(by['2']).toMatchObject({ title: 'Supplier payment, Dubai Instrumentation FZE', sub: ['ORD-0031', 'leg A'] })
    expect(by['3'].sub).toEqual(['ORD-0042', 'leg A', 'input tax 90,000'])
    expect(by['4']).toMatchObject({ title: 'Owner drawings', sub: ['Not in P&L'] })
    // newest first
    expect(open.map(l => l.key)).toEqual(['1', '2', '3', '4'])
  })

  it('one line per PSID: the invoices tick together and the amount is the sum of the deposits', () => {
    const raw: RawBank = {
      ...empty,
      deposits: [
        dep('1', '4471 9038 2216', '2026-10-31', '392400'),
        dep('2', '4471 9038 2216', '2026-10-31', '71100.50'),
        dep('3', '4466 0127 5530', '2026-10-09', '54000'),
        dep('4', null, '2026-10-12', '100'),
      ],
    }
    const open = buildBankView(raw, '2026-10').out.open
    expect(open).toHaveLength(3)
    const g = open.find(l => l.key === 'psid:4471 9038 2216')
    expect(g).toMatchObject({ kind: 'fbr', ids: ['1', '2'], amount: '463500.50', title: 'FBR deposit · PSID 4471 9038 2216' })
    expect(g?.sub[0]).toBe('2 invoices: INV-1, INV-2')
    expect(g?.kids).toHaveLength(2)
    expect(open.find(l => l.key === 'invoice:4')?.title).toBe('FBR deposit · no PSID recorded')
  })

  it('a PSID group is ticked only when every invoice is; a late invoice on an old PSID stands alone', () => {
    const raw: RawBank = {
      ...empty,
      deposits: [dep('1', 'P1', '2026-10-05', '10', OCT), dep('2', 'P1', '2026-10-05', '20', null), dep('3', 'P2', '2026-10-06', '5', SEP)],
    }
    const v = buildBankView(raw, '2026-10')
    // P1: one member is ticked, one is not: not ticked as a group (tapping it ticks the rest)
    expect(v.out.open.map(l => l.key)).toEqual(['psid:P1'])
    expect(v.out.ticked).toEqual([])
    // P2 was ticked against September: not here at all
    expect([...v.out.open, ...v.out.ticked, ...v.out.older].some(l => l.key === 'psid:P2')).toBe(false)
  })
})

describe('running totals', () => {
  it('adds ticked and unticked in paisa, counts a group once, and counts the older', () => {
    const raw: RawBank = {
      payments: [
        pay('a', '2026-10-20', '800000.10', OCT),
        pay('b', '2026-10-19', '637200.20', OCT),
        pay('c', '2026-10-26', '700000'),
        pay('d', '2026-09-30', '120000'),
      ],
      expenses: [exp('1', '2026-10-01', '440000', OCT), exp('2', '2026-10-30', '4200'), exp('3', '2026-09-30', '1150')],
      deposits: [dep('x', 'P', '2026-10-31', '392400', OCT), dep('y', 'P', '2026-10-31', '71100', OCT)],
    }
    const t = bankTotals(buildBankView(raw, '2026-10'))
    expect(t.tickedIn).toEqual({ amount: '1437200.30', count: 2 })
    expect(t.tickedOut).toEqual({ amount: '903500.00', count: 2 }) // 440000 + one PSID group of 463500
    expect(t.openIn).toEqual({ amount: '820000.00', count: 2 })
    expect(t.openOut).toEqual({ amount: '5350.00', count: 2, older: 1 })
  })

  it('is all zeros for an empty month', () => {
    const t = bankTotals(buildBankView(empty, '2026-10'))
    expect(t.tickedIn).toEqual({ amount: '0.00', count: 0 })
    expect(t.openOut).toEqual({ amount: '0.00', count: 0, older: 0 })
  })
})

describe('ticking', () => {
  it('moves a line to ticked and back', () => {
    const raw: RawBank = { ...empty, payments: [pay('a', '2026-10-20', '100')] }
    const line = buildBankView(raw, '2026-10').in.open[0]
    const ticked = applyTick(raw, line, '2026-10')
    expect(ticked.payments[0].bankMonth).toBe(OCT)
    expect(buildBankView(ticked, '2026-10').in.ticked).toHaveLength(1)
    const undone = applyTick(ticked, line, null)
    expect(undone.payments[0].bankMonth).toBeNull()
    expect(buildBankView(undone, '2026-10').in.open).toHaveLength(1)
  })

  it('ticks every invoice of a PSID group', () => {
    const raw: RawBank = { ...empty, deposits: [dep('1', 'P', '2026-10-05', '10'), dep('2', 'P', '2026-10-05', '20')] }
    const line = buildBankView(raw, '2026-10').out.open[0]
    const next = applyTick(raw, line, '2026-10')
    expect(next.deposits.map(d => d.bankMonth)).toEqual([OCT, OCT])
    expect(buildBankView(next, '2026-10').out.ticked).toHaveLength(1)
  })
})

describe('months', () => {
  it('defaults to last month, across a year end', () => {
    expect(defaultStatementMonth('2026-11-06')).toBe('2026-10')
    expect(defaultStatementMonth('2026-01-03')).toBe('2025-12')
  })
  it('reads only real month keys', () => {
    expect(isMonthKey('2026-10')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('nope')).toBe(false)
    expect(isMonthKey(null)).toBe(false)
  })
  it('words the older note by month', () => {
    expect(olderNote('2026-09-30')).toBe('September, not ticked then')
  })
})
