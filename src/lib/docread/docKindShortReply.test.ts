import { describe, expect, it } from 'vitest'
import { classifyDoc, NOT_A_SUPPLIER_QUOTE, NOT_AN_ENQUIRY } from './docKind'

// A short supplier price reply that has a quantity: the price cue beats the quantity cue (synthetic text only).
describe('classifyDoc: a short price reply with a quantity is not an enquiry', () => {
  it.each([
    'Hi, ball valve DN50 x 6 pcs, price 45 each, lead time 2 weeks. Regards',
    'Qty 6 nos. Price: 45/pc. Stock available.',
    'Hello, unit price is 45 for 6 pcs of ball valve DN50.',
    'Ball valve DN50, qty 6, unit price 45.00',
  ])('%s -> a quotation', text => {
    expect(classifyDoc(text).kind).toBe('supplier-quote')
  })

  it.each([
    '6 nos ball valve DN50 @ 45 each',
    'Ball valve DN50 - 6 pcs - 45 per pc',
    'ball valve DN50 6 pcs\nRs 4500 per pc',
    'Price for 6 nos ball valve is 4500 per no',
    'Ball valve DN50 6 pcs @ 45 USD',
  ])('%s -> undecided, so a pasted reply is not held as an enquiry', text => {
    const { kind } = classifyDoc(text)
    expect(kind).toBe('unknown')
    expect(NOT_A_SUPPLIER_QUOTE).not.toContain(kind)
    expect(NOT_AN_ENQUIRY).not.toContain(kind)
  })
})

describe('classifyDoc: a quantity with no price cue, or a customer asking, is still an enquiry', () => {
  it.each([
    '6 pcs ball valve DN50',
    'Ball valve DN50 - 6 pcs\nPressure gauge 0-10 bar - 12 nos',
    'Please quote 6 pcs ball valve DN50, our target price is 45 each',
    'Need 6 pcs ball valve DN50. Last price was 45 each, please quote',
    'Kindly quote: 6 pcs ball valve DN50 @ 45 each if possible',
    'Qty 6 nos ball valve DN50, last price 45 each',
  ])('%s -> an enquiry', text => {
    expect(classifyDoc(text).kind).toBe('rfq')
  })
})
