import { describe, expect, it } from 'vitest'
import {
  applyOwner,
  applyQuery,
  applyStep,
  askedText,
  failureLine,
  compareBoard,
  defaultOwner,
  dueText,
  isBoardShow,
  nextStepOf,
  nextStepText,
  outcomeText,
  pageSummary,
  sortBoard,
  stepCounts,
  type BidState,
  type BoardRow,
  type SourcingState,
} from '@/features/rfqs/board/model'
import { resolveStatus } from '@/lib/status'

function row(over: Partial<BoardRow> = {}): BoardRow {
  return {
    rfqId: 'r',
    number: 1,
    companyId: 'c',
    companyName: 'Acme',
    customerRef: null,
    firstItem: null,
    quotedOn: null,
    ownerId: 'u1',
    ownerName: 'Ayesha Rana',
    receivedOn: '2026-11-01',
    dueOn: '2026-12-01',
    isPriority: false,
    daysToDue: 4,
    isOverdue: false,
    outcome: 'open',
    closeReason: null,
    sourcingState: 'not_floated',
    itemsTotal: 4,
    itemsQuoted: 0,
    itemsUncovered: 0,
    floated: 0,
    clarificationState: 'none',
    toAsk: 0,
    waiting: 0,
    waitingDays: null,
    toRelay: 0,
    bidState: 'to_bid',
    ...over,
  }
}

describe('board order', () => {
  it('puts the earliest due date first, then priority, then the older number', () => {
    const rows = [
      row({ rfqId: 'late', number: 1, dueOn: '2026-12-05' }),
      row({ rfqId: 'soon-plain', number: 3, dueOn: '2026-12-01' }),
      row({ rfqId: 'soon-priority', number: 4, dueOn: '2026-12-01', isPriority: true }),
      row({ rfqId: 'soon-plain-older', number: 2, dueOn: '2026-12-01' }),
    ]
    expect(sortBoard(rows).map(r => r.rfqId)).toEqual(['soon-priority', 'soon-plain-older', 'soon-plain', 'late'])
  })

  it('puts an RFQ with no due date after every dated one, whatever its priority', () => {
    const rows = [row({ rfqId: 'none', dueOn: null, isPriority: true }), row({ rfqId: 'dated', dueOn: '2027-01-01' })]
    expect(sortBoard(rows).map(r => r.rfqId)).toEqual(['dated', 'none'])
  })

  it('does not change the list it was given', () => {
    const rows = [row({ rfqId: 'b', dueOn: '2026-12-09' }), row({ rfqId: 'a', dueOn: '2026-12-01' })]
    sortBoard(rows)
    expect(rows.map(r => r.rfqId)).toEqual(['b', 'a'])
    expect(compareBoard(rows[0], rows[1])).toBeGreaterThan(0)
  })
})

describe('filters', () => {
  const rows = [
    row({ rfqId: '1', ownerId: 'me', sourcingState: 'not_floated' }),
    row({ rfqId: '2', ownerId: 'me', sourcingState: 'floated_awaiting' }),
    row({ rfqId: '3', ownerId: 'them', sourcingState: 'partly_covered' }),
    row({ rfqId: '4', ownerId: 'them', sourcingState: 'covered' }),
    row({ rfqId: '5', ownerId: null, sourcingState: 'no_offer_anywhere' }),
  ]

  it('Mine keeps only the signed-in person’s RFQs, and an unowned RFQ is never mine', () => {
    expect(applyOwner(rows, 'mine', 'me').map(r => r.rfqId)).toEqual(['1', '2'])
    expect(applyOwner(rows, 'mine', null)).toEqual([])
    expect(applyOwner(rows, 'all', 'me')).toHaveLength(5)
  })

  it('groups by the next step: awaiting and partly priced wait for prices, nobody asked or nobody able needs suppliers', () => {
    expect(applyStep(rows, 'prices').map(r => r.rfqId)).toEqual(['2', '3'])
    expect(applyStep(rows, 'suppliers').map(r => r.rfqId)).toEqual(['1', '5'])
    expect(applyStep(rows, 'ready').map(r => r.rfqId)).toEqual(['4'])
    expect(applyStep(rows, 'all')).toHaveLength(5)
  })

  it('a sent quotation is "Quotation sent" whatever the sourcing, an expired one too', () => {
    expect(nextStepOf(row({ sourcingState: 'partly_covered', bidState: 'bid_sent' }))).toBe('sent')
    expect(nextStepOf(row({ sourcingState: 'not_floated', bidState: 'quotation_expired' }))).toBe('sent')
  })

  it('every open RFQ lands in exactly one next step, so the counts add up', () => {
    const states: SourcingState[] = ['not_floated', 'floated_awaiting', 'partly_covered', 'covered', 'no_offer_anywhere']
    const bids: BidState[] = ['to_bid', 'bid_sent', 'quotation_expired']
    for (const s of states) for (const b of bids) expect(['suppliers', 'prices', 'ready', 'sent']).toContain(nextStepOf({ sourcingState: s, bidState: b }))
    const c = stepCounts([...rows, row({ rfqId: '6', bidState: 'bid_sent' })])
    expect(c).toEqual({ all: 6, suppliers: 2, prices: 2, ready: 1, sent: 1 })
    expect(c.suppliers + c.prices + c.ready + c.sent).toBe(c.all)
  })

  it('reads the address: the old ?state values are not a filter any more', () => {
    for (const v of ['all', 'suppliers', 'prices', 'ready', 'sent', 'closed']) expect(isBoardShow(v)).toBe(true)
    for (const v of ['not-floated', 'out', 'covered', null]) expect(isBoardShow(v)).toBe(false)
  })

  it('Mine is the default for sales only', () => {
    expect(defaultOwner('sales')).toBe('mine')
    expect(defaultOwner('admin')).toBe('all')
    expect(defaultOwner('engineer')).toBe('all')
  })
})

describe('due text', () => {
  it('reads overdue in the danger tone with the days late', () => {
    expect(dueText({ dueOn: '2026-11-24', daysToDue: -3, isOverdue: true })).toEqual({ date: 'Tue 24 Nov', hint: '3 days overdue', tone: 'danger' })
    expect(dueText({ dueOn: '2026-11-26', daysToDue: -1, isOverdue: true }).hint).toBe('1 day overdue')
    // Once the quotation is sent the due date is met: no red "overdue" (R6).
    expect(dueText({ dueOn: '2026-11-26', daysToDue: -1, isOverdue: true, quotedOn: '2026-11-25' })).toEqual({ date: 'Thu 26 Nov', hint: '', tone: 'normal' })
  })
  it('warns on today and tomorrow, and stays calm beyond', () => {
    expect(dueText({ dueOn: '2026-11-27', daysToDue: 0, isOverdue: false })).toMatchObject({ hint: 'Due today', tone: 'warning' })
    expect(dueText({ dueOn: '2026-11-28', daysToDue: 1, isOverdue: false })).toMatchObject({ hint: 'Due tomorrow', tone: 'warning' })
    expect(dueText({ dueOn: '2026-12-01', daysToDue: 4, isOverdue: false })).toMatchObject({ hint: 'Due in 4 days', tone: 'normal' })
  })
  it('says so when there is no due date', () => {
    expect(dueText({ dueOn: null, daysToDue: null, isOverdue: false })).toEqual({ date: null, hint: 'No due date', tone: 'normal' })
  })
})

describe('next step words', () => {
  it('says what is behind the step in plain words', () => {
    expect(nextStepText(row({ sourcingState: 'not_floated' }))).toEqual({ step: 'suppliers', label: 'Needs suppliers', detail: 'Nobody asked yet', tone: 'now' })
    expect(nextStepText(row({ sourcingState: 'no_offer_anywhere' })).detail).toBe('Every supplier asked said no')
    expect(nextStepText(row({ sourcingState: 'floated_awaiting', floated: 3 })).detail).toBe('Asked 3 suppliers')
    expect(nextStepText(row({ sourcingState: 'partly_covered', itemsQuoted: 2, itemsTotal: 5 })).detail).toBe('2 of 5 items priced')
    expect(nextStepText(row({ sourcingState: 'covered', itemsTotal: 4 }))).toMatchObject({ label: 'Ready to quote', detail: 'All 4 items have a price', tone: 'now' })
    expect(nextStepText(row({ sourcingState: 'covered', itemsTotal: 1 })).detail).toBe('The item has a price')
    expect(nextStepText(row({ bidState: 'bid_sent', quotedOn: '2026-11-26' }))).toMatchObject({ label: 'Quotation sent', detail: 'Sent Thu 26 Nov', tone: 'waiting' })
    expect(nextStepText(row({ bidState: 'quotation_expired' }))).toMatchObject({ step: 'sent', label: 'Quotation expired', detail: 'Revise it or mark it won', tone: 'now' })
  })
  it('adds the customer questions to the line when there are any', () => {
    expect(nextStepText(row({ sourcingState: 'partly_covered', itemsQuoted: 1, itemsTotal: 2, clarificationState: 'waiting_on_customer', waiting: 2 })).detail).toBe(
      '1 of 2 items priced · waiting on the customer for 2 answers',
    )
    expect(nextStepText(row({ clarificationState: 'to_ask', toAsk: 1 })).detail).toBe('Nobody asked yet · 1 question to ask the customer')
    expect(nextStepText(row({ sourcingState: 'covered', clarificationState: 'answers_to_relay', toRelay: 1 })).detail).toBe('All 4 items have a price · 1 answer to pass on to suppliers')
  })
  it('names what was asked for, shortened, with how many more', () => {
    expect(askedText(row({ firstItem: 'Cerabar PMC71 pressure transmitter', itemsTotal: 4 }))).toBe('Cerabar PMC71 pressure transmitter + 3 more')
    expect(askedText(row({ firstItem: 'Gauge', itemsTotal: 1 }))).toBe('Gauge')
    expect(askedText(row({ firstItem: `A ${'very long words '.repeat(10)}`, itemsTotal: 1 }), 20)).toBe('A very long words v…')
    expect(askedText(row({ firstItem: null, itemsTotal: 3 }))).toBe('3 items')
    expect(askedText(row({ firstItem: null, itemsTotal: 0 }))).toBe('No items yet')
  })
})

describe('status words come from the U05 registry', () => {
  it('the rfq-outcome dimension still knows every outcome', () => {
    for (const v of ['open', 'won', 'closed']) expect(() => resolveStatus('rfq-outcome', v)).not.toThrow()
  })
})

describe('the closed list says the outcome in words (L3)', () => {
  it('a closed RFQ reads as its reason, a won one as Won', () => {
    expect(outcomeText(row({ outcome: 'closed', closeReason: 'price' }))).toBe('Lost on price')
    expect(outcomeText(row({ outcome: 'closed', closeReason: 'competitor' }))).toBe('Lost to a competitor')
    expect(outcomeText(row({ outcome: 'closed', closeReason: 'customer_cancelled' }))).toBe('Customer cancelled')
    expect(outcomeText(row({ outcome: 'closed', closeReason: 'something_new' }))).toBe('Other reason')
    expect(outcomeText(row({ outcome: 'closed', closeReason: null }))).toBe('Closed, no reason given')
    expect(outcomeText(row({ outcome: 'won', closeReason: null }))).toBe('Won')
  })
})

describe('pager text', () => {
  it('reads as a range', () => {
    expect(pageSummary(0, 25, 61)).toBe('Showing 1 to 25 of 61')
    expect(pageSummary(2, 25, 61)).toBe('Showing 51 to 61 of 61')
    expect(pageSummary(0, 25, 0)).toBe('Nothing to show')
  })
})

describe('filter box and failure line', () => {
  const rows = [row({ number: 177, companyName: 'Indus Textile Mills', customerRef: 'ENQ-2211', firstItem: 'Belimo damper actuator' }), row({ number: 178, companyName: 'Punjab Cement' })]
  it('needs every word, matching number, customer, customer ref or what was asked', () => {
    expect(applyQuery(rows, '').length).toBe(2)
    expect(applyQuery(rows, 'rfq-0177')).toHaveLength(1)
    expect(applyQuery(rows, '178')).toHaveLength(1)
    expect(applyQuery(rows, 'indus enq')).toHaveLength(1)
    expect(applyQuery(rows, 'belimo')).toHaveLength(1)
    expect(applyQuery(rows, 'indus cement')).toHaveLength(0)
  })
  it('reads like the drawing, with a stable six-digit reference', () => {
    const at = Date.UTC(2026, 10, 27, 4, 41)
    expect(failureLine(at, 'down')).toMatch(/^Request failed · Fri 27 Nov, 09:41 · reference [0-9a-f]{6}$/)
    expect(failureLine(at, 'down')).toBe(failureLine(at, 'down'))
  })
})
