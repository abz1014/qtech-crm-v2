import { describe, expect, it } from 'vitest'
import { resolveStatus } from '@/lib/status'
import { nextStepSentence, primaryAction, quotationSent, stageKey, type PrimaryInput } from './nextAction'

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

  it('an engineer (no prices: owner decision 2026-10-22) is never given Issue quotation or Mark won; the ask or the chase stay', () => {
    const eng = (over: Partial<PrimaryInput>) => at({ ...over, prices: false })
    expect(primaryAction(eng({}))).toBe('ask')
    expect(primaryAction(eng({ sourcingState: 'floated_awaiting', chaseable: 2 }))).toBe('chase')
    expect(primaryAction(eng({ sourcingState: 'partly_covered', hasPrices: true, chaseable: 1 }))).toBe('chase')
    expect(primaryAction(eng({ sourcingState: 'covered', hasPrices: true }))).toBe('none')
    expect(primaryAction(eng({ sourcingState: 'covered', hasPrices: true, quotationCount: 1, bidState: 'bid_sent' }))).toBe('none')
    expect(primaryAction(eng({ bidState: 'bid_sent' }))).toBe('none')
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
  const word = (i: PrimaryInput) => {
    const [d, v] = stageKey(i).split(':')
    return resolveStatus(d, v)
  }
  it('is a registry key, in the board’s next-step words and tones', () => {
    expect(stageKey(base)).toBe('rfq-stage:suppliers')
    expect(word(base).label).toBe('Needs suppliers')
    expect(word(at({ sourcingState: 'floated_awaiting' })).label).toBe('Waiting for prices')
    expect(word(at({ sourcingState: 'partly_covered' })).label).toBe('Waiting for prices')
    expect(word(at({ sourcingState: 'covered' }))).toMatchObject({ label: 'Ready to quote', tone: 'warning' })
    expect(word(at({ bidState: 'bid_sent' }))).toMatchObject({ label: 'Quotation sent', tone: 'info' })
    expect(word(at({ bidState: 'quotation_expired' })).label).toBe('Quotation expired')
    expect(word(at({ outcome: 'won' })).label).toBe('Won')
    expect(word(at({ outcome: 'closed' })).label).toBe('Closed')
    expect(stageKey(at({ hasOrder: true }))).toBe('rfq-outcome:won')
  })
})

describe('the Next step sentence (the box under the title)', () => {
  const step = (over: Partial<Parameters<typeof nextStepSentence>[0]> = {}) =>
    nextStepSentence({ primary: 'none', sourcingState: 'floated_awaiting', bidState: 'to_bid', itemCount: 2, awaiting: 0, ...over })
  it('says what to do now, in the words of the green button', () => {
    expect(step({ primary: 'ask', sourcingState: 'not_floated' })).toBe('Nobody has been asked for prices yet.')
    expect(step({ primary: 'ask', sourcingState: 'no_offer_anywhere' })).toBe('No supplier asked could quote. Ask other suppliers.')
    expect(step({ primary: 'issue' })).toBe('Supplier prices are in. Send the customer a quotation.')
    expect(step({ primary: 'won', bidState: 'bid_sent', contactName: 'Kamran Zafar' })).toBe('Follow up with Kamran Zafar. Mark it won when they order, or lost.')
    expect(step({ primary: 'won', bidState: 'bid_sent' })).toBe('Follow up with the customer. Mark it won when they order, or lost.')
    expect(step({ primary: 'won', bidState: 'quotation_expired' })).toMatch(/^The quotation has expired\./)
    expect(step({ primary: 'chase', awaiting: 1 })).toBe('Waiting for prices from 1 supplier. Chase them.')
  })
  it('never says "from 0 suppliers": when everyone has replied but some priced only part, it counts the chaseable ones', () => {
    const t = step({ primary: 'chase', awaiting: 0, chaseable: 2 })
    expect(t).not.toMatch(/\b0 suppliers/)
    expect(t).toBe('2 suppliers have not priced every item. Chase them.')
    expect(step({ primary: 'chase', awaiting: 0, chaseable: 1 })).toBe('1 supplier has not priced every item. Chase them.')
    expect(step({ primary: 'chase', awaiting: 0 })).not.toMatch(/\b0 suppliers/)
  })
  it('with nothing to do, says what it is waiting for', () => {
    expect(step({ itemCount: 0 })).toBe('No items yet. Add what the customer asked for under Items.')
    expect(step({ awaiting: 3 })).toBe('Waiting for prices from 3 suppliers. Chased recently: nothing to do until they reply.')
    expect(step()).toBe('Nothing to do now.')
  })
})
