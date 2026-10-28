import { describe, expect, it } from 'vitest'
import { billPeriod, forMonthOf, forMonthHelp, linkMonthlyBills, RENT_CATEGORY_ID } from '@/features/money/expenses/forMonth'
import type { RecurringTemplate } from '@/features/money/expenses/model'

const SALARIES = 'ca7e0000-0000-4000-8000-000000000001'

describe('for-month (0087) and the rent exception (0106)', () => {
  it('a monthly bill paid on day 1 to 10 is for last month, later in the month for this month', () => {
    expect(forMonthOf('2026-10-05', SALARIES)).toBe('2026-09')
    expect(forMonthOf('2026-10-10', SALARIES)).toBe('2026-09')
    expect(forMonthOf('2026-10-11', SALARIES)).toBe('2026-10')
    expect(forMonthOf('2026-01-02')).toBe('2025-12')
  })

  it('rent is always for the month it is paid in, whatever the day', () => {
    for (const day of ['01', '05', '10', '11', '20', '31']) expect(forMonthOf(`2026-10-${day}`, RENT_CATEGORY_ID)).toBe('2026-10')
    expect(forMonthOf('2026-01-01', RENT_CATEGORY_ID)).toBe('2026-01')
  })

  it('a rent template is due for this month even on day 1 to 10; other templates keep the rule', () => {
    expect(billPeriod({ dayOfMonth: 1, categoryId: RENT_CATEGORY_ID }, '2026-10-03')).toBe('2026-10')
    expect(billPeriod({ dayOfMonth: 5, categoryId: SALARIES }, '2026-10-03')).toBe('2026-09')
    expect(billPeriod({ dayOfMonth: 5 }, '2026-10-03')).toBe('2026-09')
    expect(billPeriod({ dayOfMonth: 25, categoryId: SALARIES }, '2026-10-03')).toBe('2026-10')
  })
})

describe('linkMonthlyBills: a monthly bill entered one-off settles its template (M8)', () => {
  const tpl = (id: string, categoryId: string, over: Partial<RecurringTemplate> = {}): RecurringTemplate => ({ id, label: id, categoryId, amount: 1, dayOfMonth: 5, active: true, startMonth: null, notes: null, paidVia: null, ...over })
  const recorded = (...pairs: [string, string[]][]) => new Map(pairs.map(([p, ids]) => [p, new Set(ids)]))
  type Row = { id: string; category_id: string; paid_on: string; period?: string | null; recurring_id?: string }
  const row = (category_id: string, paid_on: string, over: Partial<Row> = {}): Row => ({ id: 'x', category_id, paid_on, ...over })

  it('salaries paid 5 Oct are for September and link the Salaries template', () => {
    const [r] = linkMonthlyBills([row(SALARIES, '2026-10-05')], [tpl('t-sal', SALARIES)], recorded(['2026-09', []], ['2026-10', []]))
    expect(r).toMatchObject({ period: '2026-09', recurring_id: 't-sal' })
  })
  it('rent counts for the month paid, even on the 5th', () => {
    const [r] = linkMonthlyBills([row(RENT_CATEGORY_ID, '2026-10-05')], [tpl('t-rent', RENT_CATEGORY_ID, { dayOfMonth: 1 })], recorded(['2026-09', []], ['2026-10', []]))
    expect(r).toMatchObject({ period: '2026-10', recurring_id: 't-rent' })
  })
  it('keeps a month the caller chose', () => {
    const [r] = linkMonthlyBills([row(SALARIES, '2026-10-05', { period: '2026-10' })], [tpl('t-sal', SALARIES, { dayOfMonth: 25 })], recorded(['2026-09', []], ['2026-10', []]))
    expect(r).toMatchObject({ period: '2026-10', recurring_id: 't-sal' })
  })
  it('a template already recorded for the month is not linked again (the unique key would refuse it)', () => {
    const [r] = linkMonthlyBills([row(SALARIES, '2026-10-05')], [tpl('t-sal', SALARIES)], recorded(['2026-09', ['t-sal']], ['2026-10', []]))
    expect(r.recurring_id).toBeUndefined()
    expect(r.period).toBe('2026-09')
  })
  it('two rows of one category settle one template once; a month not in the recorded map links nothing', () => {
    const out = linkMonthlyBills([row(SALARIES, '2026-10-05', { id: 'a' }), row(SALARIES, '2026-10-06', { id: 'b' })], [tpl('t-sal', SALARIES)], recorded(['2026-09', []]))
    expect(out.map(r => r.recurring_id)).toEqual(['t-sal', undefined])
    expect(linkMonthlyBills([row(SALARIES, '2026-03-05')], [tpl('t-sal', SALARIES)], recorded(['2026-09', []]))[0].recurring_id).toBeUndefined()
  })
  it('an ordinary category is left alone: no period, no link; an "Every month" row keeps its own', () => {
    const ordinary = row('ca7e0000-0000-4000-8000-000000000004', '2026-10-05')
    expect(linkMonthlyBills([ordinary], [], recorded(['2026-10', []]))[0]).toEqual(ordinary)
    const repeat = row(SALARIES, '2026-10-05', { recurring_id: 'mine', period: '2026-09' })
    expect(linkMonthlyBills([repeat], [tpl('t-sal', SALARIES)], recorded(['2026-09', []]))[0]).toEqual(repeat)
  })
})

describe('forMonthHelp', () => {
  it('says the rent rule for rent, the 10th rule for the rest', () => {
    expect(forMonthHelp('2026-10-05', RENT_CATEGORY_ID)).toContain('Rent is paid in advance')
    expect(forMonthHelp('2026-10-05', SALARIES)).toBe('Paid by the 10th, so last month.')
    expect(forMonthHelp('2026-10-20', SALARIES)).toBe('Paid after the 10th, so this month.')
  })
})
