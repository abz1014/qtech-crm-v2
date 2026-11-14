import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessToday } from '@/lib/dates'
import { DEFAULT_GST_DEADLINES, gstDatesFor } from '@/features/settings/gstDeadlines'
import { needsYouItems } from './needsYou'
import { buildToday } from './rules'
import type { GstFact, TodayInputs } from './types'

/*
 * Process audit 6 (0121): a month whose GST was never deposited stays on To do until it is done. It is late money owed to FBR, so,
 * like a late customer payment, it never ages into the grey "Older than 30 days" fold. Regression for the E2E that broke on
 * 15 Nov 2026 Karachi time: the September row reached 31 days past its 15 Oct pay-by date and the August row had always been folded.
 * The clock is fixed and "today" comes from the app's own business date (Asia/Karachi), so UTC and Karachi midnights are both covered.
 * Fictional data.
 */
afterEach(() => vi.useRealTimers())

const at = (iso: string): string => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
  return businessToday()
}
const fact = (month: string): GstFact => ({ month, invoices: 1, undeposited: 1, ...gstDatesFor(DEFAULT_GST_DEADLINES, month) })
const ctx = (today: string, earlier: GstFact[]): TodayInputs => ({
  today, user: { id: 'u-admin', role: 'admin' }, roleOf: () => 'admin', rfqs: [], clarifications: [], inquiries: [], legs: [], orders: [], receivables: [], monthEnd: null, snoozes: [],
  gst: { ...fact('2026-10-01'), undeposited: 0, earlier },
})

describe('an older month of undeposited GST stays on To do, whatever the day', () => {
  const moments = [
    ['2026-11-14T18:59:59Z', '2026-11-14'], // 14 Nov 23:59:59 Karachi
    ['2026-11-14T19:00:00Z', '2026-11-15'], // 15 Nov 00:00 Karachi (still 14 Nov in UTC)
    ['2026-11-15T12:00:00Z', '2026-11-15'],
    ['2026-11-19T06:00:00Z', '2026-11-19'], // after the 18th
    ['2026-12-01T06:00:00Z', '2026-12-01'],
    ['2027-03-31T06:00:00Z', '2027-03-31'], // months later, still there
  ] as const
  for (const [iso, day] of moments) {
    it(`at ${iso} (${day} in Karachi) every owing month is in the counted list, red, not folded`, () => {
      const today = at(iso)
      expect(today).toBe(day)
      const view = buildToday(ctx(today, [fact('2026-08-01'), fact('2026-09-01')]))
      const rows = view.active.filter(i => i.rule === 'gst_fbr')
      expect(rows.map(r => r.title)).toEqual(['GST to FBR: August, 1 invoice to pay', 'GST to FBR: September, 1 invoice to pay'])
      expect(rows.every(r => r.group === 'now' && r.badge.tone === 'danger')).toBe(true)
      expect(view.stale.filter(i => i.rule === 'gst_fbr')).toEqual([])
      expect(needsYouItems(view).filter(i => i.rule === 'gst_fbr')).toHaveLength(2)
    })
  }
})
