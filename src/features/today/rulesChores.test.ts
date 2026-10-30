import { describe, expect, it } from 'vitest'
import { needsYouItems } from './needsYou'
import { claimsFactFrom } from './api'
import { buildToday, ruleClaimsToApprove, ruleGstFbr } from './rules'
import { buildTodo } from './todoModel'
import type { ClaimsFact, GstFact, TodayInputs } from './types'

/*
 * Redesign phase 3, P3-D: the monthly chore rows. GST to FBR (owner default Q8: pay by the 15th, return by the 18th), from the 1st
 * until paid: grey, then amber after the 12th, red after the 15th. "I paid: N to approve" while engineers' claims wait.
 * Fictional data.
 */
const ctx = (today: string, o: Partial<TodayInputs> = {}): TodayInputs => ({
  today, user: { id: 'u-admin', role: 'admin' }, roleOf: () => 'admin', rfqs: [], clarifications: [], inquiries: [], legs: [], orders: [], receivables: [], monthEnd: null, snoozes: [],
  gst: { month: '2026-09-01', invoices: 5, undeposited: 3 } as GstFact, ...o,
})
const row = (today: string, o: Partial<TodayInputs> = {}) => ruleGstFbr(ctx(today, o))[0]

describe('GST to FBR', () => {
  it('is one row from the 1st, grey, saying pay by the 15th and return by the 18th', () => {
    for (const day of ['2026-10-01', '2026-10-05', '2026-10-12']) {
      const r = row(day)
      expect(r.rule).toBe('gst_fbr')
      expect(r.title).toBe('GST to FBR: September, 3 invoices to pay')
      expect(r.party).toBe('Pay by 15 Oct · return by 18 Oct')
      expect(r.badge).toEqual({ text: 'Pay by 15 Oct', tone: 'neutral' })
      expect(r.group).toBe('ready') // listed under This week, not counted: nothing is due yet
      expect(r.href).toBe('/money/gst-register')
    }
  })

  it('turns amber after the 12th, and is due today on the 15th (and counts)', () => {
    expect(row('2026-10-13').badge.tone).toBe('warning')
    expect(row('2026-10-13').group).toBe('soon')
    expect(row('2026-10-14').badge.tone).toBe('warning')
    const fifteenth = row('2026-10-15')
    expect(fifteenth.badge).toMatchObject({ text: 'Due today', tone: 'warning' })
    expect(fifteenth.group).toBe('now')
  })

  it('turns red after the 15th, still saying return by the 18th, and is counted', () => {
    const r = row('2026-10-16')
    expect(r.badge.tone).toBe('danger')
    expect(r.group).toBe('now')
    expect(r.party).toContain('return by 18 Oct')
    expect(needsYouItems(buildToday(ctx('2026-10-17'))).map(i => i.rule)).toContain('gst_fbr')
    expect(row('2026-10-20').badge.tone).toBe('danger') // still red until it is paid
  })

  it('is gone once every invoice has its deposit, or when there is no GST, or for anyone but the admin', () => {
    expect(ruleGstFbr(ctx('2026-10-16', { gst: { month: '2026-09-01', invoices: 5, undeposited: 0 } }))).toEqual([])
    expect(ruleGstFbr(ctx('2026-10-16', { gst: null }))).toEqual([])
    expect(ruleGstFbr(ctx('2026-10-16', { user: { id: 'u', role: 'sales' } }))).toEqual([])
    expect(ruleGstFbr(ctx('2026-10-16', { user: { id: 'u', role: 'engineer' } }))).toEqual([])
  })

  it('sits in the To do blocks: This week while early, Late when overdue (never hidden in the fold)', () => {
    expect(buildTodo(buildToday(ctx('2026-10-03')), '2026-10-03').week.map(i => i.rule)).toEqual(['gst_fbr'])
    expect(buildTodo(buildToday(ctx('2026-10-17')), '2026-10-17').late.map(i => i.rule)).toEqual(['gst_fbr'])
  })

  it('uses the previous month\'s name across the year end', () => {
    expect(row('2027-01-10', { gst: { month: '2026-12-01', invoices: 1, undeposited: 1 } }).title).toBe('GST to FBR: December, 1 invoice to pay')
  })
})

describe('GST to FBR: the dates come from the settings', () => {
  const settings = (payBy: string, returnBy: string) => ({ gst: { month: '2026-09-01', invoices: 5, undeposited: 3, payBy, returnBy } as GstFact })
  it('moves the whole chore when the admin changes the days', () => {
    const early = row('2026-10-16', settings('2026-10-20', '2026-10-25'))
    expect(early.party).toBe('Pay by 20 Oct · return by 25 Oct')
    expect(early.badge).toEqual({ text: 'Pay by 20 Oct', tone: 'neutral' })
    expect(early.group).toBe('ready')
    expect(row('2026-10-18', settings('2026-10-20', '2026-10-25')).badge.tone).toBe('warning')
    expect(row('2026-10-21', settings('2026-10-20', '2026-10-25')).badge.tone).toBe('danger')
  })
  it('follows a one-off date that falls in the next month', () => {
    const r = row('2026-10-28', settings('2026-11-04', '2026-11-10'))
    expect(r.badge.tone).toBe('neutral')
    expect(r.badge.text).toBe('Pay by 4 Nov')
  })
  it('is still red on the 16th with the starting days, so nothing changes until the admin edits them', () => {
    expect(row('2026-10-16').badge.tone).toBe('danger')
  })
})

describe('I paid: N to approve', () => {
  const claims = (n: number, oldestOn: string | null = '2026-10-20'): ClaimsFact => ({ pending: n, oldestOn })
  it('is one row for the admin while claims wait, with how long the oldest has waited', () => {
    const r = ruleClaimsToApprove(ctx('2026-10-26', { claims: claims(3) }))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ rule: 'claims_to_approve', title: 'I paid: 3 to approve', href: '/money/expenses', group: 'now' })
    expect(r[0].badge.text).toMatch(/6 days old/)
  })
  it('counts as needing the admin, and is not there for nobody, sales or an engineer', () => {
    expect(needsYouItems(buildToday(ctx('2026-10-26', { gst: null, claims: claims(1) }))).map(i => i.rule)).toEqual(['claims_to_approve'])
    expect(ruleClaimsToApprove(ctx('2026-10-26', { claims: claims(0) }))).toEqual([])
    expect(ruleClaimsToApprove(ctx('2026-10-26', { claims: null }))).toEqual([])
    expect(ruleClaimsToApprove(ctx('2026-10-26', { claims: claims(2), user: { id: 'u', role: 'sales' } }))).toEqual([])
    expect(ruleClaimsToApprove(ctx('2026-10-26', { claims: claims(2), user: { id: 'u', role: 'engineer' } }))).toEqual([])
  })

  it('a claim waiting more than 30 days stays in the To do count until it is handled', () => {
    const view = buildToday(ctx('2026-10-26', { gst: null, claims: claims(1, '2026-08-01') }))
    expect(needsYouItems(view).map(i => i.rule)).toEqual(['claims_to_approve'])
    expect(view.stale).toEqual([])
  })

  it('the oldest claim date is the Pakistan day, not the UTC day', () => {
    // 20:00 UTC on the 20th is 01:00 on the 21st in Pakistan
    expect(claimsFactFrom([{ created_at: '2026-10-20T20:00:00+00:00' }, { created_at: '2026-10-25T08:00:00+00:00' }])).toEqual({ pending: 2, oldestOn: '2026-10-21' })
    expect(claimsFactFrom([])).toEqual({ pending: 0, oldestOn: null })
  })
})
