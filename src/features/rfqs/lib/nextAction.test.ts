import { describe, expect, it } from 'vitest'
import { primaryAction, quotationSent, stageChip, type PrimaryInput } from './nextAction'

const base: PrimaryInput = {
  outcome: 'open',
  hasOrder: false,
  sourcingState: 'not_floated',
  bidState: 'to_bid',
  hasPrices: false,
  quotationCount: 0,
  itemCount: 3,
  chaseable: 0,
}
const at = (over: Partial<PrimaryInput>) => ({ ...base, ...over })

describe('the one green button on the RFQ page', () => {
  it('follows the work: ask suppliers, then issue the quotation, then mark it won', () => {
    expect(primaryAction(base)).toBe('ask')
    expect(primaryAction(at({ sourcingState: 'floated_awaiting', chaseable: 2 }))).toBe('chase')
    expect(primaryAction(at({ sourcingState: 'partly_covered', hasPrices: true, chaseable: 1 }))).toBe('issue')
    expect(primaryAction(at({ sourcingState: 'covered', hasPrices: true }))).toBe('issue')
    expect(primaryAction(at({ sourcingState: 'covered', hasPrices: true, quotationCount: 1, bidState: 'bid_sent' }))).toBe('won')
  })

  it('never offers Mark won before a quotation exists; a quotation marked sent without a PDF counts', () => {
    expect(primaryAction(at({ hasPrices: true }))).not.toBe('won')
    expect(primaryAction(at({ bidState: 'bid_sent' }))).toBe('won')
    expect(primaryAction(at({ bidState: 'quotation_expired' }))).toBe('won')
    expect(quotationSent({ bidState: 'to_bid', quotationCount: 0 })).toBe(false)
    expect(quotationSent({ bidState: 'to_bid', quotationCount: 2 })).toBe(true)
  })

  it('asks other suppliers when everyone said no', () => {
    expect(primaryAction(at({ sourcingState: 'no_offer_anywhere' }))).toBe('ask')
  })

  it('has no green button when closed, won, empty, or waiting with nobody to chase', () => {
    expect(primaryAction(at({ outcome: 'closed' }))).toBe('none')
    expect(primaryAction(at({ outcome: 'won', bidState: 'bid_sent' }))).toBe('none')
    expect(primaryAction(at({ hasOrder: true }))).toBe('none')
    expect(primaryAction(at({ itemCount: 0 }))).toBe('none')
    expect(primaryAction(at({ sourcingState: 'floated_awaiting', chaseable: 0 }))).toBe('none')
  })
})

describe('the stage chip', () => {
  it('uses the board’s next-step words', () => {
    expect(stageChip(base).label).toBe('Needs suppliers')
    expect(stageChip(at({ sourcingState: 'floated_awaiting' })).label).toBe('Waiting for prices')
    expect(stageChip(at({ sourcingState: 'partly_covered' })).label).toBe('Waiting for prices')
    expect(stageChip(at({ sourcingState: 'covered' }))).toEqual({ label: 'Ready to quote', tone: 'success' })
    expect(stageChip(at({ bidState: 'bid_sent' })).label).toBe('Quotation sent')
    expect(stageChip(at({ bidState: 'quotation_expired' })).label).toBe('Quotation expired')
    expect(stageChip(at({ outcome: 'won' })).label).toBe('Won')
    expect(stageChip(at({ outcome: 'closed' })).label).toBe('Closed')
  })
})
