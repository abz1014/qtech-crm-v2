import { describe, expect, it } from 'vitest'
import { FIXTURE_TODAY, importedStyleInputs } from './importedFixture'
import { needsYouItems } from './needsYou'
import { buildToday } from './rules'
import { ACTION_LABEL, MAX_ROWS, NOT_OURS_UNTIL, blockOf, buildTodo, moreText, opensMessage, secondAction } from './todoModel'
import type { TodayItem, TodayView } from './types'

/*
 * To do (redesign phase 3, P3-A): the blocks are a split of the SAME list the counter counts, so Late + Today can never disagree
 * with the badge. Measured on the imported-style data set (importedFixture.ts, fictional).
 */
const view = buildToday(importedStyleInputs())
const today = FIXTURE_TODAY
const all = (m: ReturnType<typeof buildTodo>) => [...m.late, ...m.today, ...m.week, ...m.more]

describe('To do blocks', () => {
  it('Late + Today are exactly the items that need you (the badge number), before any cap', () => {
    const m = buildTodo(view, today, 999)
    expect(m.late.length + m.today.length).toBe(needsYouItems(view).length)
    expect(m.more).toEqual(expect.not.arrayContaining(needsYouItems(view)))
  })

  it('Late holds what is past its date, Today what is due today', () => {
    const m = buildTodo(view, today, 999)
    for (const i of m.late) expect(i.actionDueOn! < today).toBe(true)
    for (const i of m.today) expect(i.actionDueOn! >= today || i.actionDueOn === null).toBe(true)
    for (const i of m.week) expect(i.group).not.toBe('now')
  })

  it('shows at most 7 rows and folds the rest, dropping nothing', () => {
    const m = buildTodo(view, today)
    expect(m.late.length + m.today.length + m.week.length).toBeLessThanOrEqual(MAX_ROWS)
    const full = buildTodo(view, today, 999)
    expect(m.total).toBe(full.total)
    expect(new Set(all(m).map(i => i.key))).toEqual(new Set(all(full).map(i => i.key)))
  })

  it('late money first, then a promise to a customer, then the rest; the cap cuts the end of that order', () => {
    const m = buildTodo(view, today, 2)
    const shown = [...m.late, ...m.today, ...m.week]
    expect(shown).toHaveLength(2)
    if (m.late.length >= 2) expect(m.late[0].rule).toBe('payment_overdue')
    expect(m.more.length).toBe(buildTodo(view, today, 999).total - 2)
  })

  it('an empty block is empty (the screen draws nothing for it)', () => {
    const empty: TodayView = { now: [], soon: [], ready: [], waiting: [], active: [], stale: [], imported: [] }
    const m = buildTodo(empty, today)
    expect([m.late, m.today, m.week, m.more].every(a => a.length === 0)).toBe(true)
    expect(m.total).toBe(0)
  })

  it('dated work beyond the week is not a task yet: it goes to the fold, not into This week', () => {
    const far: TodayItem = { ...view.now[0], key: 'far', group: 'ready', actionDueOn: '2099-01-01' }
    const undated: TodayItem = { ...view.now[0], key: 'undated', group: 'ready', actionDueOn: null }
    const m = buildTodo({ ...view, now: [], soon: [], ready: [far, undated] }, today, 999)
    expect(m.week.map(i => i.key)).toEqual(['undated'])
    expect(m.more.map(i => i.key)).toEqual(['far'])
  })

  it('names what is folded: "N more this week" only when nothing late or due today is in it', () => {
    const m = buildTodo(view, today, 2)
    expect(moreText({ more: [{ ...view.soon[0] }, { ...view.soon[0] }] })).toBe('2 more this week')
    expect(moreText({ more: [view.now[0]] })).toBe('1 more')
    expect(moreText(m)).toMatch(/^\d+ more/)
  })

  it('blockOf follows the date', () => {
    expect(blockOf({ group: 'now', actionDueOn: '2026-10-01' }, '2026-10-20')).toBe('late')
    expect(blockOf({ group: 'now', actionDueOn: '2026-10-20' }, '2026-10-20')).toBe('today')
    expect(blockOf({ group: 'soon', actionDueOn: '2026-10-22' }, '2026-10-20')).toBe('week')
  })
})

describe('the row buttons', () => {
  it('every rule has its own button words', () => {
    for (const label of Object.values(ACTION_LABEL)) expect(label.trim().length).toBeGreaterThan(0)
    expect(ACTION_LABEL.payment_overdue).toBe('Copy reminder')
    expect(ACTION_LABEL.not_floated).toBe('Ask suppliers')
    expect(ACTION_LABEL.bid_due).toBe('Send quotation')
    expect(ACTION_LABEL.delivered_not_invoiced).toBe('Create invoice')
  })

  it('Record payment is the admin\'s second button on a late payment, and nobody else gets it', () => {
    expect(secondAction({ rule: 'payment_overdue', orderId: 'o1' }, 'admin')).toEqual({ label: 'Record payment', href: '/money/receivables?pay=1&order=o1' })
    expect(secondAction({ rule: 'payment_overdue', orderId: 'o1' }, 'sales')).toBeNull()
    expect(secondAction({ rule: 'payment_overdue', orderId: 'o1' }, 'engineer')).toBeNull()
    expect(secondAction({ rule: 'chase_customer', orderId: undefined }, 'admin')).toBeNull()
  })

  it('only the rules that prepare a message open it beside the list', () => {
    expect(['chase_customer', 'chase_supplier', 'goods_late', 'payment_overdue'].every(r => opensMessage(r as never))).toBe(true)
    expect(opensMessage('not_floated')).toBe(false)
  })

  it('"Not ours to chase" uses a far-future date, because snoozes.until_on is NOT NULL', () => {
    expect(NOT_OURS_UNTIL > '2090-01-01').toBe(true)
  })
})
