import { describe, expect, it } from 'vitest'
import { navCountsFrom } from '@/app/shell/useNavCounts'
import { daysBetween } from '@/features/rfqs/lib/dateText'
import { FIXTURE_TODAY, importedStyleInputs } from './importedFixture'
import { isStale, needsYou, needsYouItems, RED_RULES, STALE_AFTER_DAYS } from './needsYou'
import { applySnoozes, buildToday, navSectionOf, RULES } from './rules'
import type { RuleKey, TodayInputs, TodayView } from './types'

/*
 * Redesign phase 0 ("stop the noise", owner approval 2026-10-22): ONE definition of "needs you", and no two counters on a screen
 * may disagree. Measured on a fictional, imported-style data set shaped like the owner's live data after the legacy import
 * (importedFixture.ts). Before this change that data set read "Today 42 · RFQs 30 · Orders 1 · Money 11", nearly all of it years
 * old; the same data now reads a handful, and every counter says the same number.
 */

/** Every counter the app draws, worked out the way each screen works it out. */
function counters(view: TodayView, role: string) {
  const nav = navCountsFrom(view, role) // top bar and phone tabs (Today only is drawn) and the pages' shared numbers
  const header = needsYouItems(view).length // Today's "N need you"
  const group = view.now.length // the "Overdue or due today" group heading and its rows
  const board = nav.rfqs ?? 0 // the RFQ board's "N need you" (NavCountsContext)
  const orders = nav.orders ?? 0 // the Orders list's "N need you" (NavCountsContext)
  const money = nav.money ?? 0
  return { badge: nav.today ?? 0, header, group, board, orders, money }
}

describe('one definition of "needs you" on imported-style data', () => {
  const ctx = importedStyleInputs()
  const view = buildToday(ctx)

  it('drops the Today count from 42 to 6: three late payments and three things due today', () => {
    const c = counters(view, 'admin')
    expect(c.badge).toBe(6)
    expect(needsYouItems(view).map(i => i.rule).sort()).toEqual(['bid_due', 'delivered_not_invoiced', 'not_floated', 'payment_overdue', 'payment_overdue', 'payment_overdue'])
  })

  it('no two counters disagree: badge = header = the rows in the group = RFQs + Orders + Money', () => {
    const c = counters(view, 'admin')
    expect(c.header).toBe(c.badge)
    expect(c.group).toBe(c.badge)
    expect(c.board + c.orders + c.money).toBe(c.badge)
    expect(c.board).toBe(view.now.filter(i => navSectionOf(i) === 'rfqs').length)
    expect(c.orders).toBe(view.now.filter(i => navSectionOf(i) === 'orders').length)
  })

  it('agrees for every role and on every day of a quarter around it (the counters can never drift apart)', () => {
    for (const role of ['admin', 'sales', 'engineer'] as const) {
      for (let d = -45; d <= 45; d += 3) {
        const today = new Date(Date.UTC(2026, 9, 22 + d)).toISOString().slice(0, 10)
        const v = buildToday({ ...ctx, today, user: { id: ctx.user.id, role } })
        const c = counters(v, role)
        expect([c.header, c.group, c.board + c.orders + c.money], `${role} on ${today}`).toEqual([c.badge, c.badge, c.badge])
        for (const i of v.now) expect(needsYou(i, today), `${i.key} on ${today}`).toBe(true)
        for (const i of [...v.soon, ...v.ready, ...v.waiting, ...v.stale, ...v.imported]) expect(needsYou(i, today) && !i.imported && !v.stale.includes(i)).toBe(false)
      }
    }
  })

  it('nothing is lost: every item a rule raised is in exactly one place (a group, Waiting, the stale fold or the imported fold)', () => {
    const raised = applySnoozes((Object.keys(RULES) as RuleKey[]).flatMap(k => RULES[k](ctx)), ctx.snoozes, ctx.today).map(i => i.key).sort()
    const shown = [...view.active, ...view.waiting, ...view.stale, ...view.imported].map(i => i.key).sort()
    expect(shown).toEqual(raised)
  })

  it('imported history raises no task: no imported order task and no stale item is counted', () => {
    expect(view.now.some(i => i.imported)).toBe(false)
    expect(view.imported.length).toBe(6) // plan commissioning + five part-invoiced orders, waiting for Review imported
    expect(view.active.some(i => i.rule === 'costs_incomplete')).toBe(false) // 18 settled imported orders: history
    expect(view.now.every(i => !isStale(i, FIXTURE_TODAY))).toBe(true)
  })

  it('a late payment is never hidden, however old (the 40-day one is still counted and red)', () => {
    const pays = view.now.filter(i => i.rule === 'payment_overdue')
    expect(pays).toHaveLength(3)
    expect(pays.every(p => p.badge.tone === 'danger')).toBe(true)
    expect(pays.map(p => p.title)).toContain('Payment late since 12 Sep 2026')
  })

  it('red only for late money or a promise to a customer that slipped within 30 days; never a count above 30 days', () => {
    for (const i of [...view.active, ...view.waiting, ...view.stale, ...view.imported]) {
      if (i.badge.tone === 'danger') {
        expect(RED_RULES.has(i.rule), i.key).toBe(true)
        if (i.rule !== 'payment_overdue') expect(daysBetween(i.actionDueOn as string, FIXTURE_TODAY), i.key).toBeLessThanOrEqual(STALE_AFTER_DAYS)
      }
      for (const text of [i.title, i.badge.text]) {
        const n = /(\d+) days? (overdue|late|old|ago)/.exec(text)
        if (n) expect(Number(n[1]), `${i.key}: "${text}"`).toBeLessThanOrEqual(STALE_AFTER_DAYS)
      }
    }
  })

  it('a sent quotation is never red', () => {
    for (const i of [...view.active, ...view.stale]) if (i.rule === 'decision_overdue') expect(i.badge.tone).not.toBe('danger')
  })
})

describe('the same rule for a fresh v2 database', () => {
  it('an empty day reads zero everywhere', () => {
    const empty: TodayInputs = { ...importedStyleInputs(), rfqs: [], inquiries: [], orders: [], receivables: [], costs: [], invoices: [] }
    const c = counters(buildToday(empty), 'admin')
    expect(c).toEqual({ badge: 0, header: 0, group: 0, board: 0, orders: 0, money: 0 })
  })
})
