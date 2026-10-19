import { describe, expect, it } from 'vitest'
import {
  agingCsv,
  buildAging,
  buildChecklist,
  categoryNotes,
  buildGst,
  buildPayables,
  buildPnl,
  buildTeam,
  categoriesCsv,
  buildCategories,
  checksWithItems,
  closeButtonLabel,
  closeState,
  closedThrough,
  defaultMonthEndMonth,
  gstCsv,
  payablesCsv,
  pnlCsv,
  quarterOf,
  teamCsv,
  type AgingRow,
  type CategoryLine,
  type GstMonthRow,
  type PayableRow,
  type RawPnl,
} from '@/features/money/monthEnd/model'
import { closeWindowDay } from '@/features/money/monthEnd/format'

const STATUS = [
  { check_key: 'bank_unticked', n: 7 },
  { check_key: 'fbr_deposits_unticked', n: 2 },
  { check_key: 'uncategorised', n: 0 },
  { check_key: 'recurring_not_recorded', n: 0 },
  { check_key: 'provisional_margins', n: 3 },
  { check_key: 'fbr_pending', n: 2 },
  { check_key: 'unresolved_payments', n: 1 },
]

describe('the checklist', () => {
  it('lists the seven checks in the mockup order with their counts and links', () => {
    const cards = buildChecklist(STATUS, '2026-10')
    expect(cards.map(c => c.label)).toEqual([
      'Bank items not ticked',
      'FBR deposits not ticked',
      'Uncategorised',
      'Recurring not recorded',
      'Provisional margins',
      'FBR pending',
      'Unresolved payments',
    ])
    expect(cards.map(c => c.n)).toEqual([7, 2, 0, 0, 3, 2, 1])
    expect(checksWithItems(cards)).toBe(5)
    expect(cards[0].to).toBe('/money/month-end/bank?month=2026-10')
    expect(cards[1].unit).toBe('invoices')
    expect(cards[6].unit).toBe('payment')
    expect(cards[2].clear).toBe(true)
    expect(cards[2].unit).toBe('to do')
  })

  it('treats a missing row as a clear check, never an error', () => {
    const cards = buildChecklist([], '2026-10')
    expect(cards).toHaveLength(7)
    expect(checksWithItems(cards)).toBe(0)
  })

  it('opens on the month that just ended', () => {
    expect(defaultMonthEndMonth('2026-11-06')).toBe('2026-10')
    expect(defaultMonthEndMonth('2027-01-02')).toBe('2026-12')
  })
})

describe('closing', () => {
  const closed = new Set(['2026-08', '2026-09'])
  it('a closed month is closed', () => {
    expect(closeState('2026-09', '2026-11-06', closed, ['2026-09'])).toEqual({ kind: 'closed' })
  })
  it('the current month and later cannot be closed yet', () => {
    expect(closeState('2026-11', '2026-11-06', closed, [])).toEqual({ kind: 'not-ended' })
    expect(closeState('2026-12', '2026-11-06', closed, [])).toEqual({ kind: 'not-ended' })
  })
  it('an open month after closed ones closes on its own', () => {
    const s = closeState('2026-10', '2026-11-06', closed, ['2026-08', '2026-09', '2026-10'])
    expect(s).toEqual({ kind: 'open', through: false, earlier: [] })
    expect(closeButtonLabel('2026-10', s)).toBe('Close October')
  })
  it('an earlier open month with money in it turns the button into Close through', () => {
    const s = closeState('2026-10', '2026-11-06', new Set(['2026-08']), ['2026-08', '2026-09', '2026-10'])
    expect(s).toEqual({ kind: 'open', through: true, earlier: ['2026-09'] })
    expect(closeButtonLabel('2026-10', s)).toBe('Close through October')
  })
  it('an earlier open month with no money in it does not matter', () => {
    const s = closeState('2026-10', '2026-11-06', new Set(), ['2026-10'])
    expect(s).toMatchObject({ kind: 'open', through: false })
  })
  it('names the latest closed month', () => {
    expect(closedThrough([{ key: '2026-08', closedAt: '', closedBy: null, note: null }, { key: '2026-09', closedAt: '', closedBy: null, note: null }])).toBe('September')
    expect(closedThrough([])).toBeNull()
  })
  it('counts the day of the close window only in the first ten days of the next month', () => {
    expect(closeWindowDay('2026-10', '2026-11-06')).toBe(6)
    expect(closeWindowDay('2026-10', '2026-11-11')).toBeNull()
    expect(closeWindowDay('2026-10', '2026-10-31')).toBeNull()
    expect(closeWindowDay('2026-12', '2027-01-03')).toBe(3)
  })
})

const PNL: RawPnl = {
  netIn: '3477372.88',
  gstIn: '625927.12',
  unresolvedGross: '120000.00',
  orderCosts: '2296600.00',
  overheads: '736750.00',
  result: '444022.88',
  nonPnlOut: '335000.00',
  afterDrawings: '109022.88',
  cashOutTotal: '3476350.00',
  inputTax: '108000.00',
}
const L = (o: Partial<CategoryLine> & Pick<CategoryLine, 'category' | 'grp' | 'net'>): CategoryLine => ({
  categoryId: o.category,
  sort: 0,
  count: 1,
  gross: o.net,
  inputTax: '0.00',
  paidVia: 'bank',
  ...o,
})
const LINES: CategoryLine[] = [
  L({ category: 'Salaries', grp: 'overhead', net: '540000.00', count: 4 }),
  L({ category: 'Rent', grp: 'overhead', net: '75000.00', sort: 1 }),
  L({ category: 'Fuel & travel', grp: 'overhead', net: '121750.00', sort: 2, count: 37, paidVia: 'cash', gross: '121750.00' }),
  L({ category: 'Supplier payment', grp: 'order_cost', net: '2020000.00', gross: '2110000.00', inputTax: '90000.00', count: 3 }),
  L({ category: 'Clearing', grp: 'order_cost', net: '276600.00', gross: '294600.00', inputTax: '18000.00', count: 7, sort: 1 }),
  L({ category: 'Owner drawings', grp: 'non_pnl', net: '250000.00' }),
  L({ category: 'Loan repayment', grp: 'non_pnl', net: '85000.00', sort: 1 }),
]

describe('profit and loss', () => {
  const pnl = buildPnl(
    '2026-10',
    PNL,
    { count: 6, unresolved: [{ orderRef: 'ORD-0012', amount: '120000.00', reference: 'cheque 118310' }] },
    LINES,
    { cashCount: 30, cashAmount: '89700.00', bankCount: 24, bankAmount: '3386650.00' },
  )
  it('gross received is net plus GST plus the payments not yet split', () => {
    expect(pnl.grossReceived).toBe('4223300.00')
  })
  it('totals the groups from the categories', () => {
    expect(pnl.orderCosts).toMatchObject({ count: 10, net: '2296600.00', inputTax: '108000.00', gross: '2404600.00' })
    expect(pnl.overheads.count).toBe(42)
    expect(pnl.notInPnl.total).toMatchObject({ count: 2, net: '335000.00' })
  })
  it('keeps the result and after drawings the database gave, and they tie out', () => {
    expect(pnl.result).toBe('444022.88')
    expect(pnl.afterDrawings).toBe('109022.88')
    // result less Not in P&L equals after drawings
    expect(Number(pnl.result) - Number(pnl.notInPnl.total.net)).toBeCloseTo(Number(pnl.afterDrawings), 2)
  })
  it('an empty month is zeros and says so', () => {
    const e = buildPnl('2026-11', null, { count: 0, unresolved: [] }, [], { cashCount: 0, cashAmount: '0.00', bankCount: 0, bankAmount: '0.00' })
    expect(e.result).toBe('0.00')
    expect(e.cash.allPaidCount).toBe(0)
  })
  it('the CSV has Gross, GST and net columns, and shows the unresolved row apart', () => {
    const csv = pnlCsv(pnl)
    expect(csv.headers).toEqual(['Section', 'Line', 'Count', 'Gross', 'GST or input tax', 'Net'])
    const unresolved = csv.rows.find(r => String(r[1]).startsWith('Payments not yet split'))
    expect(unresolved).toEqual(['Money in', 'Payments not yet split (excluded from net)', 1, 120000, '', ''])
    const split = csv.rows.find(r => String(r[1]).startsWith('Payments received, split'))
    expect(split).toEqual(['Money in', 'Payments received, split into net and GST', 5, 4103300, 625927.12, 3477372.88])
    expect(csv.rows.find(r => r[0] === 'After drawings')?.[5]).toBe(109022.88)
    // costs are negative numbers, never strings that Excel would read as text
    expect(csv.rows.find(r => r[1] === 'Order costs')?.[5]).toBe(-2296600)
  })
})

describe('expenses by category', () => {
  const v = buildCategories(LINES, { cashCount: 37, cashAmount: '121750.00', bankCount: 17, bankAmount: '0.00' })
  it('groups overheads, order costs and not in P&L in that order, categories in Settings order', () => {
    expect(v.groups.map(g => g.title)).toEqual(['Overheads', 'Order costs', 'Not in P&L'])
    expect(v.groups[0].lines.map(l => l.category)).toEqual(['Salaries', 'Rent', 'Fuel & travel'])
  })
  it('totals gross, net and input tax over every group', () => {
    expect(v.all.count).toBe(54)
    expect(v.all.inputTax).toBe('108000.00')
  })
  it('the CSV honours the paid-via filter', () => {
    expect(categoriesCsv(v, '2026-10', 'cash').rows.map(r => r[2])).toEqual(['Fuel & travel'])
    expect(categoriesCsv(v, '2026-10', 'all').rows).toHaveLength(7)
  })
})

const A = (o: Partial<AgingRow> & Pick<AgingRow, 'invoiceId' | 'bucket' | 'remaining'>): AgingRow => ({
  customer: 'Hazara Paper Board',
  invoiceNumber: 'INV-2218',
  orderRef: 'ORD-0012',
  invoiceDate: '2026-07-14',
  ageDays: 109,
  gross: o.remaining,
  applied: '0.00',
  ...o,
})

describe('aging', () => {
  const rows = [
    A({ invoiceId: 'a', bucket: '90+', remaining: '322500.00', gross: '442500.00', applied: '120000.00' }),
    A({ invoiceId: 'b', bucket: '0-30', remaining: '552240.00', ageDays: 1, invoiceNumber: 'INV-2299' }),
    A({ invoiceId: 'c', bucket: '31-60', remaining: '1111600.00', ageDays: 41, invoiceNumber: 'INV-2256', gross: '1911600.00', applied: '800000.00' }),
  ]
  const v = buildAging('2026-10-31', rows, [{ orderId: 'o', orderRef: 'ORD-0042', customer: 'Sargodha Fertilizer Co.', held: '700000.00' }])
  it('buckets what is left, oldest first, and ties out to the outstanding total', () => {
    expect(v.rows.map(r => r.invoiceId)).toEqual(['a', 'c', 'b'])
    expect(v.totals['90+']).toEqual({ amount: '322500.00', count: 1 })
    expect(v.totals['61-90']).toEqual({ amount: '0.00', count: 0 })
    expect(v.outstanding).toBe('1986340.00')
    expect(v.advanceTotal).toBe('700000.00')
  })
  it('the CSV lists advances apart, never as negative aging', () => {
    const csv = agingCsv(v)
    expect(csv.headers.slice(-4)).toEqual(['0 to 30', '31 to 60', '61 to 90', '90+'])
    const adv = csv.rows.at(-1)!
    expect(adv[2]).toBe('Advance held, not invoiced yet')
    expect(adv.slice(-4)).toEqual(['', '', '', ''])
  })
})

const P = (o: Partial<PayableRow> & Pick<PayableRow, 'legId' | 'state' | 'paidPkr'>): PayableRow => ({
  supplier: 'Alpenmark Controls GmbH',
  orderRef: 'ORD-0038',
  leg: 'leg A',
  currency: 'EUR',
  committed: null,
  rate: '327.90',
  committedPkr: null,
  owedPkr: null,
  flag: null,
  ...o,
})

describe('what we owe', () => {
  const rows = [
    P({ legId: '1', state: 'settled', committedPkr: '1114860.00', paidPkr: '1100000.00', owedPkr: '0.00' }),
    P({ legId: '2', state: 'owing', committedPkr: '796797.00', paidPkr: '0.00', owedPkr: '796797.00' }),
    P({ legId: '3', state: 'owing', committedPkr: '1447680.00', paidPkr: '1120000.00', owedPkr: '327680.00', currency: 'USD' }),
    P({ legId: '4', state: 'settled', committedPkr: '250000.00', paidPkr: '262000.00', owedPkr: '0.00', flag: 'overpaid', currency: 'PKR' }),
  ]
  const v = buildPayables('2026-10-31', rows)
  it('adds what is owed on open legs only, and sorts owing first', () => {
    expect(v.owed).toBe('1124477.00')
    expect(v.owedCount).toBe(2)
    expect(v.rows.map(r => r.legId)).toEqual(['2', '3', '1', '4'])
  })
  it('reconciles committed less paid with open + settled - paid over', () => {
    const lhs = Number(v.owed) + Number(v.settledLeft) - Number(v.paidOver)
    expect(lhs).toBeCloseTo(Number(v.committed) - Number(v.paid), 2)
    expect(v.settledCount).toBe(2)
    expect(v.paidOver).toBe('12000.00')
  })
  it('the CSV marks a paid-over leg', () => {
    expect(payablesCsv(v).rows.find(r => r[3] === 'leg A' && r[4] === 'PKR')?.at(-1)).toBe('Settled (≈) (paid over)')
  })
})

const G = (month: string, o: Partial<GstMonthRow> = {}): GstMonthRow => ({
  month,
  invoiceCount: 3,
  net: '3702500.00',
  gst: '666450.00',
  psidSets: 2,
  depositedCount: 2,
  depositedAmount: '476640.00',
  toDeposit: '189810.00',
  inputTax: '108000.00',
  ...o,
})

describe('GST and FBR', () => {
  const all = [G('2026-11'), G('2026-10'), G('2026-09', { gst: '459900.00' }), G('2026-08'), G('2026-07')]
  it('shows the selected month and the two before it, newest first, with their total', () => {
    const v = buildGst('2026-10', all, true)
    expect(v.rows.map(r => r.month)).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(v.selected?.month).toBe('2026-10')
    expect(v.total.invoiceCount).toBe(9)
    expect(v.total.gst).toBe('1792800.00')
  })
  it('output GST and input tax are never netted: both stay as their own columns', () => {
    const v = buildGst('2026-10', all, true)
    expect(gstCsv(v).headers.at(-1)).toBe('Input tax paid')
    expect(gstCsv(v).rows[0].slice(2, 4)).toEqual([3702500, 666450])
  })
  it('without input tax (anyone but the admin) the column and the figures are gone from the CSV', () => {
    const v = buildGst('2026-10', all.map(r => ({ ...r, inputTax: null })), false)
    expect(gstCsv(v).headers).not.toContain('Input tax paid')
    expect(gstCsv(v).rows[0]).toHaveLength(8)
    expect(v.total.inputTax).toBeNull()
  })
})

describe('team', () => {
  const v = buildTeam(
    '2026-10',
    '2026-11-06',
    [
      { userId: 'u1', name: 'Ayesha Rana', payments: 3, net: '2542372.88', quarterNet: '2542372.88', quarterTarget: '6000000.00' },
      { userId: 'u2', name: 'Farhan Malik', payments: 2, net: '935000.00', quarterNet: '935000.00', quarterTarget: '2500000.00' },
    ],
    [
      { userId: 'u1', name: 'Ayesha Rana', role: 'sales' },
      { userId: 'u2', name: 'Farhan Malik', role: 'admin' },
      { userId: 'u3', name: 'Bilal Chaudhry', role: 'engineer' },
    ],
    [{ orderRef: 'ORD-0012', amount: '120000.00', reference: null }],
  )
  it('lists everyone, credited or not, largest first, and the total ties to Net in', () => {
    expect(v.rows.map(r => r.name)).toEqual(['Ayesha Rana', 'Farhan Malik', 'Bilal Chaudhry'])
    expect(v.rows[2].net).toBeNull()
    expect(v.credited).toBe('3477372.88')
    expect(v.creditedPayments).toBe(5)
    expect(v.creditedPeople).toBe(2)
    expect(v.unresolved).toBe('120000.00')
  })
  it('counts the days left in the quarter', () => {
    expect(quarterOf('2026-10', '2026-11-06')).toEqual({ quarter: 4, end: '2026-12-31', daysLeft: 55 })
    expect(v.daysLeft).toBe(55)
  })
  it('the CSV writes blanks, not zeros, for a person with no credit and no target', () => {
    expect(teamCsv(v, '2026-10').rows[2]).toEqual(['October 2026', 'Bilal Chaudhry', 'engineer', 0, '', '', ''])
  })
})

describe('the checklist data lines (migration 0064, g2-month-end "Checklist")', () => {
  const DETAILS = {
    bank_unticked: { in_n: 2, in_amount: 820000, out_n: 5, out_amount: 526100, prior_n: 1, prior_first: '2026-09', prior_last: '2026-09' },
    fbr_deposits_unticked: { amount: 463500, groups: 1 },
    uncategorised: { amount: 0 },
    recurring_not_recorded: { total: 4, names: [] },
    provisional_margins: { numbers: [34, 29, 26] },
    fbr_pending: { amount: 481410, invoices: [{ number: 'INV-2291', month: '2026-10' }, { number: 'INV-2256', month: '2026-09' }] },
    unresolved_payments: { amount: 120000, orders: 1, first: { order_id: 'o-12', order_number: 12, reference: 'cheque 118310' } },
  }
  const cards = buildChecklist(STATUS, '2026-10', DETAILS)
  it('says what each count is made of, in the words of the mockup', () => {
    expect(cards.map(c => c.sub)).toEqual([
      '2 money in (PKR 820,000), 5 money out (PKR 526,100), 1 of it from September. Items still in transit are expected.',
      'PKR 463,500 in 1 PSID group. One tick covers the whole group.',
      'Every expense has a category, and an order where it needs one.',
      'All 4 recurring templates have an October expense.',
      'Settled by 31 October, costs not marked complete: ORD-0034, ORD-0029, ORD-0026.',
      'PKR 481,410 GST not deposited: INV-2291 (Oct), INV-2256 (Sep).',
      'PKR 120,000 counts in gross but is not split into net. ORD-0012, cheque 118310.',
    ])
  })
  it('prints figures and references in the mono face', () => {
    expect(cards[0].parts).toContainEqual({ mono: 'PKR 820,000' })
    expect(cards[4].parts).toContainEqual({ mono: 'ORD-0034' })
  })
  it('opens the one order a single unresolved payment belongs to, and names the PSID groups', () => {
    expect(cards[6].linkLabel).toBe('Open ORD-0012')
    expect(cards[6].to).toBe('/orders/o-12')
    expect(cards[1].linkLabel).toBe('Tick the PSID group')
    expect(buildChecklist(STATUS, '2026-10', { ...DETAILS, fbr_deposits_unticked: { amount: 5, groups: 2 } })[1].linkLabel).toBe('Tick the PSID groups')
  })
  it('lists the commonest few and says how many more', () => {
    const more = buildChecklist([{ check_key: 'provisional_margins', n: 5 }], '2026-10', { provisional_margins: { numbers: [9, 8, 7] } })
    expect(more[4].sub).toBe('Settled by 31 October, costs not marked complete: ORD-0009, ORD-0008, ORD-0007 and 2 more.')
    const rec = buildChecklist([{ check_key: 'recurring_not_recorded', n: 2 }], '2026-10', { recurring_not_recorded: { total: 4, names: ['Office rent', 'Internet'] } })
    expect(rec[3].sub).toBe('No October expense yet for Office rent, Internet.')
  })
  it('falls back to the fixed wording when the figures did not load', () => {
    const plainCards = buildChecklist(STATUS, '2026-10')
    expect(plainCards[0].sub).toMatch(/^Bank payments and expenses dated up to month end/)
    expect(plainCards[6].linkLabel).toBe('Open receivables')
  })
})

describe('the category notes', () => {
  it('lists the commonest three labels of a category, commonest first', () => {
    const rows = [
      ...['Tea', 'Tea', 'Tea', 'Biscuits', 'Biscuits', 'Water', 'Stationery'].map(label => ({ categoryId: 'c1', label })),
      { categoryId: 'c2', label: null },
      { categoryId: 'c2', label: '  ' },
    ]
    expect(categoryNotes(rows)).toEqual({ c1: 'Tea, Biscuits, Stationery' })
  })
})
