import { describe, expect, it } from 'vitest'
import { comparisonNote, daysSince, dueChipLabel, dueSubLabel, itemCoverage, sentLine, supplierMemoryLine } from './detailView'

describe('itemCoverage', () => {
  it('covered when priced and nobody is still to answer; partly while somebody is', () => {
    expect(itemCoverage(3, 0, 3)).toEqual({ kind: 'covered', label: 'Covered, 3 prices' })
    expect(itemCoverage(1, 0, 2).label).toBe('Covered, 1 price')
    expect(itemCoverage(1, 1, 2)).toEqual({ kind: 'partly', label: 'Partly covered, 1 price' })
    expect(itemCoverage(2, 2, 2).label).toBe('Partly covered, 2 prices')
  })
  it('uncovered once others replied and nobody priced it; "No replies yet" before that', () => {
    expect(itemCoverage(0, 1, 2)).toEqual({ kind: 'uncovered', label: 'Uncovered item' })
    expect(itemCoverage(0, 0, 0)).toEqual({ kind: 'none', label: 'No replies yet' })
    expect(itemCoverage(0, 2, 0).kind).toBe('none')
  })
})

describe('comparisonNote', () => {
  const base = { comparable: 3, basis: 'pkr' as const, notCompared: [], staleRates: [], lines: 3 }
  it('says what was compared', () => {
    expect(comparisonNote(base)).toBe("Lowest of the 3 with a rate. Compared in PKR at today's rates.")
    expect(comparisonNote({ ...base, comparable: 2, basis: 'native' })).toBe('Lowest of the 2 with a rate. Same currency, compared as quoted.')
  })
  it('names the lines left out and a stale rate, as in the mockup', () => {
    expect(comparisonNote({ ...base, comparable: 2, notCompared: ['AED'], staleRates: [{ currency: 'EUR', days: 12 }] })).toBe(
      "Lowest of the 2 with a rate. Compared in PKR at today's rates. The AED line is not compared. The EUR rate is 12 days old, so treat the gap as indicative.",
    )
    expect(comparisonNote({ ...base, notCompared: ['AED', 'GBP'] })).toContain('The AED and GBP lines are not compared.')
  })
  it('one price or none', () => {
    expect(comparisonNote({ ...base, comparable: 1, lines: 2 })).toBe('One price so far. Nothing to compare yet.')
    expect(comparisonNote({ ...base, comparable: 0, lines: 0 })).toBe('Nobody has priced this item.')
  })
})

describe('supplierMemoryLine', () => {
  it('under three asks it only states the counts', () => {
    expect(supplierMemoryLine({ asked: 2, replied: 1, median_reply_days: null }, null)?.text).toBe('Asked twice, 1 reply. Not enough history to say more.')
    expect(supplierMemoryLine({ asked: 1, replied: 0, median_reply_days: null }, 2)?.text).toBe('Asked once, no reply. Not enough history to say more.')
  })
  it('from three asks it adds the usual time, and how long this one has waited, amber when longer', () => {
    expect(supplierMemoryLine({ asked: 7, replied: 5, median_reply_days: 2 }, 5)).toEqual({ text: 'Replied 5 of 7 · usually ~2 days, now 5 days', late: true })
    expect(supplierMemoryLine({ asked: 7, replied: 5, median_reply_days: 2 }, 1)).toEqual({ text: 'Replied 5 of 7 · usually ~2 days, now 1 day', late: false })
    expect(supplierMemoryLine({ asked: 8, replied: 8, median_reply_days: 0.2 }, null)).toEqual({ text: 'Replied 8 of 8 · usually the same day', late: false })
  })
  it('says nothing with no history, and is honest about a missing median', () => {
    expect(supplierMemoryLine(null, null)).toBeNull()
    expect(supplierMemoryLine({ asked: 4, replied: 2, median_reply_days: null }, null)?.text).toContain('reply time needs 3 replies')
  })
})

describe('sentLine and dates', () => {
  it('says what happened to the enquiry', () => {
    const base = { sentOn: '2026-11-22', lastChasedOn: null, chaseCount: 0, noOfferOn: null }
    expect(sentLine({ ...base, quoteReceivedOn: '2026-11-23' })).toBe('Sent Sun 22 Nov · replied Mon 23 Nov')
    expect(sentLine({ ...base, lastChasedOn: '2026-11-25', chaseCount: 1 })).toBe('Sent Sun 22 Nov · chased Wed 25 Nov')
    expect(sentLine({ ...base, noOfferOn: '2026-11-23' })).toBe("Sent Sun 22 Nov · can't quote Mon 23 Nov")
    expect(sentLine({ ...base, sentOn: null })).toBe('Not sent yet')
  })
  it('counts whole days', () => {
    expect(daysSince('2026-11-22', '2026-11-27')).toBe(5)
    expect(daysSince('2026-11-27', '2026-11-22')).toBe(0)
  })
  it('words the deadline chip and the bid-due line', () => {
    expect(dueChipLabel(4, false)).toBe('Due in 4 days')
    expect(dueChipLabel(1, false)).toBe('Due in 1 day')
    expect(dueChipLabel(0, false)).toBe('Due today')
    expect(dueChipLabel(-2, true)).toBe('Overdue by 2 days')
    expect(dueChipLabel(20, false)).toBeNull()
    expect(dueChipLabel(null, false)).toBeNull()
    expect(dueSubLabel(4)).toBe('In 4 days')
    expect(dueSubLabel(0)).toBe('Today')
    expect(dueSubLabel(-3)).toBe('3 days ago')
  })
})
