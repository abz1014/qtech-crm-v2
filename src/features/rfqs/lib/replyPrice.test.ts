import { describe, expect, it } from 'vitest'
import { parseReplyPrice, replyPriceProblem } from '@/features/rfqs/lib/replyPrice'

describe('parseReplyPrice (HW-48)', () => {
  it.each([
    ['1200', 1200],
    ['1,200', 1200],
    ['PKR 1,200/-', 1200],
    ['Rs. 1,200', 1200],
    ['1,200/-', 1200],
    ['USD 12.50', 12.5],
    ['-5', -5],
    ['abc', null],
    ['12 pcs', null],
    ['', null],
  ])('%j reads %j', (text, n) => {
    expect(parseReplyPrice(text)).toBe(n)
  })
})

describe('replyPriceProblem (HW-48)', () => {
  it('says why in a sentence, and nothing for a good price or an empty box', () => {
    expect(replyPriceProblem('')).toBeNull()
    expect(replyPriceProblem('PKR 1,200/-')).toBeNull()
    expect(replyPriceProblem('-5')).toBe("A price can't be below zero.")
    expect(replyPriceProblem('0')).toBe('Type a price above zero, or leave it empty.')
    expect(replyPriceProblem('twelve')).toBe('Type the price as a number, like 1200.')
  })
})
