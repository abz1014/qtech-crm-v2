import { describe, expect, it } from 'vitest'
import { nudgeInfo } from '@/features/today/ContextPane'
import { chaseState, cooldownDays, THRESHOLDS } from '@/features/today/rules'
import type { TodayItem } from '@/features/today/types'

const item = { rule: 'chase_supplier' } as TodayItem

describe('nudgeInfo (the "returns on" promised under the draft)', () => {
  it('a supplier chase promises the same return date the rule uses when the supplier is slow (median + 1)', () => {
    const today = '2026-11-23' // Monday
    const dueOn = '2026-12-31'
    const slow = { replied: 3, medianReplyDays: 4 } // the rule waits max(2, 4 + 1) = 5 working days
    const rule = chaseState({ lastTouchOn: today, waitDays: cooldownDays(Math.max(THRESHOLDS.supplierChaseMinDays, 5), dueOn, today), chased: true, today })
    const n = nudgeInfo(item, dueOn, today, slow)
    expect(n.returnsOn).toBe(rule.nextNudgeOn) // Mon 30 Nov, not Wed 25 Nov
    expect(n.why).toBe('5 working days')
  })

  it('a supplier with too few replies keeps the 2-day wait', () => {
    const n = nudgeInfo(item, '2026-12-31', '2026-11-23', { replied: 2, medianReplyDays: 9 })
    expect(n.returnsOn).toBe('2026-11-25')
    expect(n.why).toBe('2 working days')
  })
})
