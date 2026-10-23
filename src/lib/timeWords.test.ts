import { describe, expect, it } from 'vitest'
import { ageOrSince, ageWords, agoDays, days, daysLate, daysOverdue, dueWord, inDays, overdueWords, sinceWords } from '@/lib/timeWords'

describe('time words (DESIGN_SYSTEM section 6, rule 8)', () => {
  it('counts days in words, singular for one', () => {
    expect(days(1)).toBe('1 day')
    expect(days(4)).toBe('4 days')
    expect(days(0)).toBe('0 days')
  })

  it('says how overdue', () => {
    expect(daysOverdue(3)).toBe('3 days overdue')
    expect(daysOverdue(1)).toBe('1 day overdue')
    expect(daysOverdue(0)).toBe('1 day overdue')
    expect(daysLate(3)).toBe('3 days late')
  })

  it('never counts past 30 days: it names the date instead (redesign phase 0)', () => {
    expect(overdueWords(30, '2026-09-22')).toBe('30 days overdue')
    expect(overdueWords(995, '2024-01-31')).toBe('since 31 Jan 2024')
    expect(ageOrSince(5, '2026-10-17')).toBe('5 days old')
    expect(ageOrSince(700, '2024-11-21')).toBe('since 21 Nov 2024')
    expect(sinceWords('2025-06-03')).toBe('since 3 Jun 2025')
  })

  it('says when something is due', () => {
    expect(dueWord(0)).toBe('Due today')
    expect(dueWord(1)).toBe('Due tomorrow')
    expect(dueWord(4)).toBe('Due in 4 days')
    expect(dueWord(-3)).toBe('3 days overdue')
    expect(dueWord(-1)).toBe('1 day overdue')
  })

  it('says a date ahead or behind', () => {
    expect(inDays(0)).toBe('Today')
    expect(inDays(1)).toBe('Tomorrow')
    expect(inDays(4)).toBe('In 4 days')
    expect(inDays(-3)).toBe('3 days ago')
    expect(agoDays(0)).toBe('Today')
    expect(agoDays(1)).toBe('Yesterday')
    expect(agoDays(3)).toBe('3 days ago')
  })

  it('says how old an item is', () => {
    expect(ageWords(0)).toBe('New')
    expect(ageWords(0.6)).toBe('New')
    expect(ageWords(1)).toBe('1 day old')
    expect(ageWords(5)).toBe('5 days old')
  })

  it('never abbreviates days to "d"', () => {
    const outs = [-5, -1, 0, 1, 2, 12].flatMap(n => [dueWord(n), inDays(n), agoDays(n), ageWords(n), daysOverdue(n), days(n)])
    expect(outs.filter(s => /\d+d\b/.test(s))).toEqual([])
  })
})
