import { describe, expect, it } from 'vitest'
import {
  applyOwner,
  applyQuery,
  failureLine,
  applyState,
  clarificationDetail,
  compareBoard,
  defaultOwner,
  dueText,
  filterOf,
  pageSummary,
  sortBoard,
  sourcingDetail,
  stateCounts,
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

  it('groups awaiting and partly covered as "out for offers"', () => {
    expect(applyState(rows, 'out').map(r => r.rfqId)).toEqual(['2', '3'])
    expect(applyState(rows, 'no-offer').map(r => r.rfqId)).toEqual(['5'])
    expect(applyState(rows, 'all')).toHaveLength(5)
  })

  it('every sourcing state lands in exactly one filter, so the counts add up', () => {
    const states: SourcingState[] = ['not_floated', 'floated_awaiting', 'partly_covered', 'covered', 'no_offer_anywhere']
    for (const s of states) expect(filterOf(s)).toBeTruthy()
    const c = stateCounts(rows)
    expect(c).toEqual({ all: 5, 'not-floated': 1, out: 2, covered: 1, 'no-offer': 1 })
    expect(c['not-floated'] + c.out + c.covered + c['no-offer']).toBe(c.all)
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
  })
  it('warns on today and tomorrow, and stays calm beyond', () => {
    expect(dueText({ dueOn: '2026-11-27', daysToDue: 0, isOverdue: false })).toMatchObject({ hint: 'Due today', tone: 'warning' })
    expect(dueText({ dueOn: '2026-11-28', daysToDue: 1, isOverdue: false })).toMatchObject({ hint: 'Due tomorrow', tone: 'warning' })
    expect(dueText({ dueOn: '2026-12-01', daysToDue: 4, isOverdue: false })).toMatchObject({ hint: 'in 4 days', tone: 'normal' })
  })
  it('says so when there is no due date', () => {
    expect(dueText({ dueOn: null, daysToDue: null, isOverdue: false })).toEqual({ date: null, hint: 'No due date', tone: 'normal' })
  })
})

describe('chip details', () => {
  it('shows how many items have a price once something is floated', () => {
    expect(sourcingDetail(row({ sourcingState: 'partly_covered', itemsQuoted: 2, itemsTotal: 5 }))).toBe('2 of 5')
    expect(sourcingDetail(row({ sourcingState: 'not_floated' }))).toBeUndefined()
    expect(sourcingDetail(row({ sourcingState: 'no_offer_anywhere' }))).toBeUndefined()
  })
  it('counts questions, with days for the ones the customer has had', () => {
    expect(clarificationDetail(row({ clarificationState: 'to_ask', toAsk: 2 }))).toBe('2')
    expect(clarificationDetail(row({ clarificationState: 'waiting_on_customer', waiting: 2, waitingDays: 6 }))).toBe('2 · 6d')
    expect(clarificationDetail(row({ clarificationState: 'answers_to_relay', toRelay: 1 }))).toBe('1')
    expect(clarificationDetail(row())).toBeUndefined()
  })
})

describe('status words come from the U05 registry', () => {
  it('every value the board can show resolves, so none renders as an unstyled chip', () => {
    for (const v of ['not_floated', 'floated_awaiting', 'partly_covered', 'covered', 'no_offer_anywhere']) expect(() => resolveStatus('sourcing', v)).not.toThrow()
    for (const v of ['to_ask', 'waiting_on_customer', 'answers_to_relay']) expect(() => resolveStatus('clarification', v)).not.toThrow()
    for (const v of ['to_bid', 'bid_sent', 'quotation_expired']) expect(() => resolveStatus('bid', v)).not.toThrow()
    for (const v of ['open', 'won', 'closed']) expect(() => resolveStatus('rfq-outcome', v)).not.toThrow()
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
  const rows = [row({ number: 177, companyName: 'Indus Textile Mills', customerRef: 'ENQ-2211' }), row({ number: 178, companyName: 'Punjab Cement' })]
  it('needs every word, matching number, customer or customer ref', () => {
    expect(applyQuery(rows, '').length).toBe(2)
    expect(applyQuery(rows, 'rfq-0177')).toHaveLength(1)
    expect(applyQuery(rows, '178')).toHaveLength(1)
    expect(applyQuery(rows, 'indus enq')).toHaveLength(1)
    expect(applyQuery(rows, 'indus cement')).toHaveLength(0)
  })
  it('reads like the drawing, with a stable six-digit reference', () => {
    const at = Date.UTC(2026, 10, 27, 4, 41)
    expect(failureLine(at, 'down')).toMatch(/^Request failed · Fri 27 Nov, 09:41 · reference [0-9a-f]{6}$/)
    expect(failureLine(at, 'down')).toBe(failureLine(at, 'down'))
  })
})
